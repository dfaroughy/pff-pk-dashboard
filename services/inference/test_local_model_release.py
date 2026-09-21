"""Lightweight local release wiring checks; no weights or GPU required."""
import json
import unittest

from services.inference.pff_service import (
    DEFAULT_COVARIATES_DIRECTORY,
    PFF_ROOT,
    REPOSITORY_ROOT,
    configured_path,
)


class LocalCovariatesReleaseTests(unittest.TestCase):
    def test_default_directory_matches_best_checkpoint_manifest(self):
        release = REPOSITORY_ROOT / "models/pythia_covariates_v7_step112000"
        manifest = json.loads((release / "manifest.json").read_text())
        self.assertEqual(manifest["globalStep"], 112000)
        self.assertEqual(manifest["releaseScope"], "local-only")
        self.assertEqual(manifest["modelId"], "pythia_covariates")
        self.assertEqual(
            PFF_ROOT / manifest["localCheckpointRelativeToPffPk"],
            DEFAULT_COVARIATES_DIRECTORY / "step-000112000.ckpt",
        )
        self.assertTrue((release / "inference.yaml").is_file())

    def test_hosted_checkpoint_override_still_takes_precedence(self):
        from pathlib import Path
        from unittest.mock import patch
        with patch.dict("os.environ", {"PFF_COVARIATES_CHECKPOINT": "/hosted/model.ckpt"}):
            self.assertEqual(
                configured_path("PFF_COVARIATES_CHECKPOINT", None,
                                DEFAULT_COVARIATES_DIRECTORY / "step-000112000.ckpt"),
                Path("/hosted/model.ckpt"),
            )


if __name__ == "__main__":
    unittest.main()
