# SPDX-License-Identifier: GPL-3.0-or-later
"""Exercise real Blender packing and the environment publication boundary."""
import importlib.util
import tempfile
from pathlib import Path

import bpy


def main():
    path = Path(__file__).resolve().parents[2] / "blendlink/blender/export_scene.py"
    spec = importlib.util.spec_from_file_location("environment_payload_exporter", path)
    exporter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exporter)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with tempfile.TemporaryDirectory(prefix="blendlink-environment-payload-") as directory:
        root = Path(directory)
        generated = bpy.data.images.new("Generated sky", width=16, height=8, float_buffer=True)
        generated.generated_color = (0.04, 0.08, 0.16, 1.0)
        generated.filepath_raw = str(root / "sky.hdr")
        # Reproduce the actual exported-byte mismatch on every supported
        # Blender version. In 5.2 a lazy generated-color buffer reset HDR to
        # PNG on save; explicitly choose PNG here so fixed/older Blender
        # versions still exercise the publisher with that same bad input.
        generated.file_format = "PNG"
        generated.save()
        generated.pack()
        packed = bytes(generated.packed_file.data)
        assert packed.startswith(b"\x89PNG"), "fixture must reproduce Blender's generated-image packing"
        recipe = {"environment": {"source": "image", "imageName": generated.name}}
        before = (generated.filepath, generated.file_format, packed)
        try:
            exporter.publish_environment(recipe, str(root / "bad.glb"))
        except SystemExit as error:
            message = str(error)
            assert generated.name in message and "PNG" in message and "reload" in message, message
        else:
            raise AssertionError("published PNG bytes as HDR instead of explaining how to reload the saved HDR")
        assert not list(root.glob("bad.glb.environment.*")), "failed validation must not publish bytes"
        assert before == (generated.filepath, generated.file_format, bytes(generated.packed_file.data))

        # Loading the saved file, then packing, retains the original radiance bytes.
        for format_name, extension, magic in (
            ("HDR", "hdr", b"#?RADIANCE"),
            ("OPEN_EXR", "exr", b"\x76\x2f\x31\x01"),
        ):
            source = root / f"valid.{extension}"
            image = bpy.data.images.new(f"Source {extension}", width=16, height=8, float_buffer=True)
            image.filepath_raw = str(source)
            image.file_format = format_name
            image.save()
            payload = source.read_bytes()
            assert payload.startswith(magic)
            loaded = bpy.data.images.load(str(source), check_existing=False)
            recipe["environment"]["imageName"] = loaded.name
            for packed_source in (False, True):
                if packed_source:
                    loaded.pack()
                result = exporter.publish_environment(recipe, str(root / f"{extension}-{packed_source}.glb"))
                assert result["format"] == extension
                assert result["source"] == ("packed" if packed_source else "linked")
                assert Path(result["path"]).read_bytes() == payload

            # A mislabeled linked file must fail too, even if its image metadata says HDR/EXR.
            loaded.unpack(method="REMOVE")
            source.write_bytes(packed)
            try:
                exporter.publish_environment(recipe, str(root / "mislabeled.glb"))
            except SystemExit as error:
                assert "PNG" in str(error)
            else:
                raise AssertionError("accepted a mislabeled linked environment")
            assert not list(root.glob("mislabeled.glb.environment.*"))
    print("BLENDLINK_ENVIRONMENT_PAYLOAD_PASSED")


main()
