import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from threading import Thread
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from services.inference import pff_service as service
from services.inference.tabpfn_bridge import TabPFNRuntime


class TabPFNBridgeTests(unittest.TestCase):
    def test_tabpfn_request_from_public_origin_is_rejected(self):
        server = service.LocalServer(("127.0.0.1", 0), service.Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = Request(f"http://127.0.0.1:{server.server_port}/inference", data=b'{"modelId":"tabpfn"}', headers={"Content-Type": "application/json", "Origin": "https://dfaroughy.github.io"})
            with patch.object(service, "cached_inference") as inference:
                with self.assertRaises(HTTPError) as denied:
                    urlopen(request, timeout=2)
                self.assertEqual(denied.exception.code, 403)
                inference.assert_not_called()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_hosted_import_does_not_enable_tabpfn_even_with_environment(self):
        with patch.object(service, "LOCAL_TABPFN", None), patch.dict("os.environ", {"PFF_LOCAL_TABPFN": "1"}):
            self.assertNotIn("tabpfn", service.service_status()["models"])
            with self.assertRaises(ValueError):
                service.requested_model({"modelId": "tabpfn"})

    def test_local_registration_does_not_change_pythia_runtimes(self):
        runtime = TabPFNRuntime()
        with patch.object(service, "LOCAL_TABPFN", runtime):
            self.assertEqual(service.requested_model({"modelId": "tabpfn"}), "tabpfn")
            self.assertEqual(service.service_status()["models"]["tabpfn"]["label"], "TabPFN")
            self.assertEqual(service.requested_model({"modelId": "pythia"}), "pythia")

    def test_worker_is_separate_and_vpc_uses_all_returned_curves(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            repo = root / "tabpfn_pk"
            (repo / "tabpfn_pk").mkdir(parents=True)
            (repo / "tabpfn_pk/dashboard.py").write_text("# fixture")
            (repo / "uv.lock").write_text("fixture")
            (repo / "models/tabpfn-3.5").mkdir(parents=True)
            (repo / "models/tabpfn-3.5/model.json").write_text(json.dumps({"sha256": "abc"}))
            with patch.dict("os.environ", {"TABPFN_PK_REPO": str(repo)}):
                runtime = TabPFNRuntime()
            study = {"id": "fixture", "dose": 10, "doseUnit": "mg", "route": "oral", "timeUnit": "h", "concentrationUnit": "ng/mL", "subjects": [
                {"id": str(i), "points": [[0, 0], [1, 3+i], [2, 1+i]]} for i in range(3)]}
            request = {"modelId": "tabpfn", "study": study, "nDraws": 5, "seed": 1}
            curves = [[float(i+1), float(i+1)/2] for i in range(5)]
            raw = {"queryTime": [1, 2], "generatedConcentration": curves, "checkpointId": "tabpfn", "provenance": {"runtimeSeconds": 1}}
            with patch.object(runtime, "metadata", return_value={"ready": True}), patch("services.inference.tabpfn_bridge.subprocess.run", return_value=SimpleNamespace(returncode=0, stdout=json.dumps(raw))) as worker:
                result = runtime.infer(request, root / "cache", service.build_cohort)
                self.assertEqual(result["generatedConcentration"], curves)
                self.assertEqual(result["vpc"]["generatedIndividuals"], 5)
                self.assertEqual(result["vpc"]["effectiveBins"], 2)
                self.assertTrue(all(p["nObservations"] == 3 for p in result["vpc"]["points"]))
                self.assertNotIn("solver", result["request"])
                self.assertEqual(worker.call_args.args[0][0], str(repo.resolve() / ".venv/bin/python"))
                self.assertNotIn("shell", worker.call_args.kwargs)
                self.assertEqual(runtime.infer(request, root / "cache", service.build_cohort), result)
                self.assertEqual(worker.call_count, 1)
                runtime.infer({**request, "seed": 2}, root / "cache", service.build_cohort)
                self.assertEqual(worker.call_count, 2)
                # New sampler source must invalidate an old response even when
                # request and checkpoint are unchanged.
                (repo / "tabpfn_pk/conditional.py").write_text("# new time-aware sampler")
                updated = runtime.infer(request, root / "cache", service.build_cohort)
                self.assertNotEqual(updated["inferenceId"], result["inferenceId"])
                self.assertEqual(worker.call_count, 3)


if __name__ == "__main__":
    unittest.main()
