# SPDX-License-Identifier: GPL-3.0-or-later
"""Private desktop tools for the Preview button. No global Node/npm install.

Runs in a background Blender Python process, so downloading, verification and
package installation never block Blender's UI. Node archive hashes come from
https://nodejs.org/dist/v24.22.3/SHASUMS256.txt (reviewed 2026-11-11).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

NODE_VERSION = "24.22.3"
NODE_ARCHIVES = {
    ("Darwin", "arm64"): ("darwin-arm64.tar.gz", "ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd"),
    ("Darwin", "x64"): ("darwin-x64.tar.gz", "977614af0504c81045e7fd85596dbca0e5f951b96681516dadafedcca8c447f7"),
    ("Linux", "arm64"): ("linux-arm64.tar.gz", "261af2af250dfd7e9f25cf151d1b2713a0adf8f10a9ad116c4947f68627affe8"),
    ("Linux", "x64"): ("linux-x64.tar.gz", "061ec3e3062115705b56b51fa9cc330ab50d34b6969387d4e4b1a50c6809acc2"),
    ("Windows", "arm64"): ("win-arm64.zip", "b3cc74a295b39d4f273271e96f58c06dd2b35757ca12abec64c7d0598b434f14"),
    ("Windows", "x64"): ("win-x64.zip", "e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f"),
}


def progress(label: str, fraction: float = 0.02) -> None:
    print("##blendlink " + json.dumps({"fraction": fraction, "label": label}), flush=True)


def runtime_platform() -> tuple[str, str]:
    machine = platform.machine().lower()
    arch = {"aarch64": "arm64", "arm64": "arm64", "amd64": "x64", "x86_64": "x64"}.get(machine, machine)
    key = (platform.system(), arch)
    if key not in NODE_ARCHIVES:
        raise RuntimeError("Automatic preview setup supports Windows, macOS and Linux on x64/arm64. "
                           "Use the Blendlink CLI on this platform instead.")
    return key


def runtime_paths(root: Path, system: str) -> tuple[Path, Path]:
    if system == "Windows":
        return root / "node.exe", root / "node_modules/npm/bin/npm-cli.js"
    return root / "bin/node", root / "lib/node_modules/npm/bin/npm-cli.js"


def valid_runtime(root: Path, system: str, archive_hash: str) -> bool:
    node, npm = runtime_paths(root, system)
    try:
        if not npm.is_file() or (root / ".blendlink-runtime").read_text() != archive_hash:
            return False
        result = subprocess.run([str(node), "--version"], capture_output=True, text=True, timeout=15,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return result.returncode == 0 and result.stdout.strip() == "v" + NODE_VERSION
    except (OSError, subprocess.SubprocessError):
        return False


def extract_runtime(archive: Path, destination: Path, expected_root: str) -> Path:
    """Refuse traversal, special files and links escaping the signed tree."""
    base = destination.resolve()

    def safe(name: str) -> Path:
        path = (base / name).resolve()
        if not path.is_relative_to(base / expected_root):
            raise RuntimeError("The preview runtime archive contains an unsafe path")
        return path

    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as bundle:
            for item in bundle.infolist():
                safe(item.filename)
                if (item.external_attr >> 16) & 0o170000 == 0o120000:
                    raise RuntimeError("The preview runtime ZIP contains an unexpected link")
            bundle.extractall(base)
    else:
        with tarfile.open(archive, "r:gz") as bundle:
            for item in bundle.getmembers():
                path = safe(item.name)
                if item.issym():
                    safe(str(path.parent.relative_to(base) / item.linkname))
                elif item.islnk():
                    safe(item.linkname)
                elif not (item.isfile() or item.isdir()):
                    raise RuntimeError("The preview runtime archive contains an unexpected file type")
                item.mode &= 0o755
            if hasattr(tarfile, "data_filter"):
                bundle.extractall(base, filter="data")
            else:
                bundle.extractall(base)  # All members/links validated above (older test Python).
    return base / expected_root


def ensure_runtime(cache: Path, *, online: bool = True) -> tuple[Path, Path]:
    system, arch = runtime_platform()
    suffix, expected_hash = NODE_ARCHIVES[(system, arch)]
    name = f"node-v{NODE_VERSION}-{suffix}"
    root_name = name.removesuffix(".tar.gz").removesuffix(".zip")
    root = cache / root_name
    if valid_runtime(root, system, expected_hash):
        return runtime_paths(root, system)
    if not online:
        raise RuntimeError("First preview needs a small tools download. Enable Allow Online Access "
                           "in Blender Preferences → System, then click Preview Website again.")
    cache.mkdir(parents=True, exist_ok=True)
    progress("Setting up preview tools · downloading Node " + NODE_VERSION)
    with tempfile.TemporaryDirectory(prefix=".setup-", dir=cache) as temporary:
        work = Path(temporary)
        archive = work / name
        digest = hashlib.sha256()
        request = urllib.request.Request("https://nodejs.org/dist/v" + NODE_VERSION + "/" + name,
                                         headers={"User-Agent": "Blendlink desktop setup"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response, archive.open("wb") as output:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > 150 * 1024 * 1024:
                        raise RuntimeError("The preview tools download exceeded its expected size")
                    digest.update(chunk)
                    output.write(chunk)
                    if total % (5 * 1024 * 1024) == 0:
                        progress(f"Setting up preview tools · {total // (1024 * 1024)} MB downloaded")
        except (OSError, urllib.error.URLError) as error:
            raise RuntimeError("Could not download preview tools. Check your connection and retry Preview Website. "
                               + str(error)) from error
        if digest.hexdigest() != expected_hash:
            raise RuntimeError("The preview tools download failed its SHA-256 check. Retry Preview Website; "
                               "the unverified download was not installed.")
        progress("Setting up preview tools · verifying and unpacking")
        unpacked = extract_runtime(archive, work / "unpacked", root_name)
        (unpacked / ".blendlink-runtime").write_text(expected_hash)
        if not valid_runtime(unpacked, system, expected_hash):
            raise RuntimeError("The downloaded preview tools could not start on this computer")
        # Another Blender window may have completed setup while we downloaded.
        if not valid_runtime(root, system, expected_hash):
            if root.exists():
                shutil.rmtree(root)
            try:
                unpacked.rename(root)
            except OSError:
                if not valid_runtime(root, system, expected_hash):
                    raise
    return runtime_paths(root, system)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--cli")
    parser.add_argument("--blender", required=True)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    import re
    if re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", args.version) is None:
        raise RuntimeError("The installed Blendlink extension has an invalid compiler version")
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        raise RuntimeError("No preview action was requested")
    cache = Path(args.cache).resolve()
    node, npm = ensure_runtime(cache, online=not args.offline)
    env = os.environ.copy()
    env["PATH"] = str(node.parent) + os.pathsep + env.get("PATH", "")
    env["BLENDLINK_BLENDER"] = args.blender
    env["npm_config_update_notifier"] = "false"
    env["npm_config_cache"] = str(cache / "npm")
    if args.offline:
        env["npm_config_offline"] = "true"
    if args.cli:
        parts = [str(node), str(Path(args.cli).resolve()), *command]
    else:
        progress("Setting up Blendlink " + args.version + " · first use may take a moment")
        parts = [str(node), str(npm), "exec", "--yes", "--registry=https://registry.npmjs.org/",
                 *( ["--offline"] if args.offline else [] ),
                 "--package=blendlink@" + args.version, "--", "blendlink", *command]
    progress({
        "preview": "Opening your website preview",
        "export": "Preparing your website export",
        "publish": "Preparing the Final website build",
        "compile": "Compiling your saved scene",
        "plan": "Checking atlas fit",
    }.get(command[0], "Starting Blendlink"))
    # On POSIX replace this background Blender so cancellation reaches the CLI.
    if os.name != "nt":
        os.execve(node, parts, env)
    return subprocess.call(parts, env=env, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


if __name__ == "__main__":
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--python" in sys.argv else sys.argv[1:]
    try:
        raise SystemExit(main(arguments))
    except (OSError, RuntimeError) as error:
        progress("Website tools need attention")
        print("Blendlink setup failed: " + str(error), flush=True)
        raise SystemExit(1)
