from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path


class SpaceSourceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(__file__).resolve().parent

    def test_space_never_contains_a_checkpoint_or_literal_token(self) -> None:
        forbidden_suffixes = {".ckpt", ".pt", ".pth", ".safetensors"}
        self.assertFalse(
            [path for path in self.root.rglob("*") if path.suffix in forbidden_suffixes]
        )
        for path in self.root.glob("*.py"):
            self.assertIsNone(
                re.search(r"hf_[A-Za-z0-9]{20,}", path.read_text(encoding="utf-8"))
            )

    def test_application_source_parses(self) -> None:
        ast.parse((self.root / "app.py").read_text(encoding="utf-8"))
        ast.parse((self.root / "build_bundle.py").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
