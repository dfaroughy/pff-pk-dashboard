from __future__ import annotations

import ast
import hashlib
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.huggingface_space.build_bundle import MANIFEST, build_bundle


class SpaceSourceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(__file__).resolve().parent

    def test_space_never_contains_a_checkpoint_or_literal_token(self) -> None:
        forbidden_suffixes = {".ckpt", ".pt", ".pth", ".safetensors"}
        self.assertFalse(
            [path for path in self.root.rglob("*") if path.suffix in forbidden_suffixes]
        )
        for path in self.root.glob("*.py"):
            self.assertIsNone(re.search(r"hf_[A-Za-z0-9]{20,}", path.read_text(encoding="utf-8")))

    def test_application_source_parses(self) -> None:
        ast.parse((self.root / "app.py").read_text(encoding="utf-8"))
        ast.parse((self.root / "build_bundle.py").read_text(encoding="utf-8"))

    def test_runtime_dependency_input_is_cpu_only(self) -> None:
        requirements = (self.root / "requirements.in").read_text(encoding="utf-8")
        self.assertIn("torch==2.8.0+cpu", requirements)
        self.assertIn("gradio[oauth,mcp]==6.2.0", requirements)
        self.assertIn("spaces", requirements)
        self.assertNotIn("pharmpy-core", requirements)

    def test_public_solver_is_fixed(self) -> None:
        tree = ast.parse((self.root / "app.py").read_text(encoding="utf-8"))
        assignment = next(
            node
            for node in tree.body
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name) and target.id == "PUBLIC_SOLVER"
                for target in node.targets
            )
        )
        self.assertEqual(ast.literal_eval(assignment.value), {"method": "heun", "steps": 8})


class BundleSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.pff = self.root / "model"
        self.synthetic = self.root / "prior"
        (self.pff / "pff_pk").mkdir(parents=True)
        (self.pff / "pff_pk" / "__init__.py").write_text("")
        (self.synthetic / "synthetic_priors" / "schemas").mkdir(parents=True)
        (self.synthetic / "synthetic_priors" / "schemas" / "contracts.py").write_text("# contract\n")
        self.output = self.root / "bundle"

    def test_provenance_hashes_and_managed_replacement(self):
        build_bundle(self.pff, self.synthetic, self.output)
        manifest = json.loads((self.output / MANIFEST).read_text())
        self.assertEqual(set(manifest["sources"]), {"dashboard", "pff_pk", "synthetic_priors"})
        for name, digest in manifest["sha256"].items():
            self.assertEqual(hashlib.sha256((self.output / name).read_bytes()).hexdigest(), digest)
        build_bundle(self.pff, self.synthetic, self.output)

    def test_refuses_sources_parents_home_and_unknown_output(self):
        for output in (self.pff, self.pff / "bundle", self.root, Path.home(), Path("/")):
            with self.assertRaises(ValueError):
                build_bundle(self.pff, self.synthetic, output)
        self.output.mkdir()
        sentinel = self.output / "keep.txt"
        sentinel.write_text("keep")
        with self.assertRaisesRegex(ValueError, "manifest"):
            build_bundle(self.pff, self.synthetic, self.output)
        self.assertEqual(sentinel.read_text(), "keep")

    def test_refuses_symlink(self):
        self.output.symlink_to(self.pff, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symbolic link"):
            build_bundle(self.pff, self.synthetic, self.output)

    def test_refuses_to_erase_extra_or_modified_files(self):
        build_bundle(self.pff, self.synthetic, self.output)
        extra = self.output / "user-notes.txt"
        extra.write_text("preserve")
        with self.assertRaisesRegex(ValueError, "modified/unrecognized"):
            build_bundle(self.pff, self.synthetic, self.output)
        self.assertEqual(extra.read_text(), "preserve")

    def test_rejects_accidental_checkpoint_in_package(self):
        (self.pff / "pff_pk" / "accidental.ckpt").write_bytes(b"weights")
        with self.assertRaisesRegex(ValueError, "weights"):
            build_bundle(self.pff, self.synthetic, self.output)
        self.assertFalse(self.output.exists())

    def test_failed_assembly_preserves_existing_bundle(self):
        build_bundle(self.pff, self.synthetic, self.output)
        original = (self.output / MANIFEST).read_bytes()
        with patch(
            "services.huggingface_space.build_bundle.shutil.copy2", side_effect=OSError("test")
        ):
            with self.assertRaises(OSError):
                build_bundle(self.pff, self.synthetic, self.output)
        self.assertEqual((self.output / MANIFEST).read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
