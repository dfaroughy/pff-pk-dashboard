"""Build a provenance-recorded Space without deleting arbitrary output paths."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

MANIFEST = "bundle-manifest.json"
FORMAT = "pff-space-bundle-v1"


def file_hashes(root: Path) -> dict[str, str]:
    hashes = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("bundle content must not contain symbolic links")
        if path.is_file() and path.name != MANIFEST:
            hashes[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes


def revision(root: Path) -> dict:
    def git(*args):
        result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)
        return result.stdout.strip() if result.returncode == 0 else None

    return {"commit": git("rev-parse", "HEAD"), "workingTreeStatus": git("status", "--porcelain")}


def build_bundle(pff_repo: Path, synthetic_repo: Path, output: Path) -> Path:
    here = Path(__file__).resolve().parent
    roots = [pff_repo.resolve(), synthetic_repo.resolve(), here.parents[1]]
    if output.is_symlink():
        raise ValueError("output must not be a symbolic link")
    output = output.resolve()
    if output in (Path.home(), Path(output.anchor)):
        raise ValueError("output cannot be a home or filesystem root")
    if any(output == root or output in root.parents or root in output.parents for root in roots):
        raise ValueError("output must be outside all source repositories")
    if output.exists():
        try:
            manifest = json.loads((output / MANIFEST).read_text())
            managed = manifest["format"] == FORMAT and manifest["sha256"] == file_hashes(output)
        except (OSError, ValueError, KeyError, TypeError):
            managed = False
        if not managed:
            raise ValueError(
                "refusing to replace modified/unrecognized output; choose a new output (manifest mismatch)"
            )
    contracts = roots[1] / "synthetic_priors" / "schemas" / "contracts.py"
    if not (roots[0] / "pff_pk" / "__init__.py").is_file() or not contracts.is_file():
        raise ValueError("missing model package or synthetic contracts")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".pff-bundle-", dir=output.parent) as temporary:
        stage = Path(temporary) / "new"
        stage.mkdir()
        for name in ("app.py", "README.md", "requirements.txt", "requirements.in"):
            shutil.copy2(here / name, stage / name)
        shutil.copytree(
            roots[0] / "pff_pk",
            stage / "pff_pk",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
        )
        service = stage / "services" / "inference"
        service.mkdir(parents=True)
        shutil.copy2(here.parent / "inference" / "pff_service.py", service / "pff_service.py")
        shutil.copy2(here.parent / "inference" / "censored_vpc.py", service / "censored_vpc.py")
        shutil.copy2(here.parent / "inference" / "synthetic_service.py", service / "synthetic_service.py")
        (stage / "services" / "__init__.py").touch()
        (service / "__init__.py").touch()
        shutil.copytree(roots[1] / "synthetic_priors", stage / "synthetic_priors",
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"))
        for path in stage.rglob("*"):
            if path.name.startswith(".env") or path.suffix in {
                ".ckpt",
                ".pt",
                ".pth",
                ".safetensors",
            }:
                raise ValueError(
                    "model weights or environment files must not enter a public bundle"
                )
        files = file_hashes(stage)
        (stage / MANIFEST).write_text(
            json.dumps(
                {
                    "format": FORMAT,
                    "sources": {
                        name: revision(root)
                        for name, root in zip(
                            ("pff_pk", "synthetic_priors", "dashboard"), roots, strict=True
                        )
                    },
                    "sha256": files,
                },
                indent=2,
            )
            + "\n"
        )
        backup = Path(temporary) / "previous"
        if output.exists():
            output.rename(backup)
        try:
            stage.rename(output)
        except BaseException:
            if backup.exists():
                backup.rename(output)
            raise
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pff-repo", type=Path, required=True)
    parser.add_argument("--synthetic-repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(build_bundle(args.pff_repo, args.synthetic_repo, args.output))


if __name__ == "__main__":
    main()
