# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual ZIP-isolated helper exercised by compositor_vector_component_check.py.
"""ZIP-isolated source extraction; this is not a numerical pixel oracle."""
import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import zipfile


def verify_packaged_component(source, scene, graph, fingerprint, canonical):
    source = Path(source).resolve()
    assert source.is_dir(), "Build the actual extension payload before package qualification"
    prefix = "isolated_compositor_component_addon"
    with tempfile.TemporaryDirectory(prefix="blendlink-compositor-component-packed-") as temporary:
        root = Path(temporary)
        archive, installed = root / "blendlink.zip", root / prefix
        with zipfile.ZipFile(archive, "w") as bundle:
            for path in source.rglob("*"):
                if path.is_file() and "__pycache__" not in path.parts:
                    bundle.write(path, path.relative_to(source))
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(installed)
        required = ["compositor_graph.py", "compositor_vector_component.py"]
        assert all((installed / name).is_file() for name in required)
        spec = importlib.util.spec_from_file_location(prefix, installed / "__init__.py",
            submodule_search_locations=[str(installed)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[prefix] = module
        try:
            spec.loader.exec_module(module)
            packed = __import__(prefix + ".compositor_graph", fromlist=["extract"])
            assert Path(packed.__file__).resolve().is_relative_to(installed.resolve())
            for index in range(3):
                for transport in ["default", "literal", "reroute", "group-default", "group-literal"]:
                    graph("field", index, transport)
                    before = fingerprint()
                    expected = canonical.extract(scene)
                    actual = packed.extract(scene)
                    assert actual == expected and actual["status"] == "extracted", (index, transport, actual)
                    assert before == fingerprint(), "ZIP source extraction changed authored data"
            helper = packed._sibling("compositor_vector_component")
            assert Path(helper.__file__).resolve().is_relative_to(installed.resolve())
            return {"status": "qualified-zip-source", "sourcePreserved": True,
                "indices": [0, 1, 2], "transports": ["default", "literal", "reroute", "group-default", "group-literal"],
                "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "modules": {name: hashlib.sha256((installed / name).read_bytes()).hexdigest() for name in required}}
        finally:
            for name in list(sys.modules):
                if name == prefix or name.startswith(prefix + "."):
                    del sys.modules[name]
