"""Assemble a deployable Space from the canonical dashboard and model sources."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def copy_tree(source: Path, destination: Path) -> None:
    shutil.copytree(
        source,
        destination,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pff-repo", type=Path, required=True)
    parser.add_argument("--synthetic-repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    here = Path(__file__).resolve().parent
    output = arguments.output.resolve()
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for name in ("app.py", "README.md", "requirements.txt"):
        shutil.copy2(here / name, output / name)

    copy_tree(arguments.pff_repo.resolve() / "pff_pk", output / "pff_pk")
    service = output / "services" / "inference"
    service.mkdir(parents=True)
    for name in ("pff_service.py", "pharmpy_vpc.py"):
        shutil.copy2(here.parent / "inference" / name, service / name)
    (output / "services" / "__init__.py").touch()
    (service / "__init__.py").touch()

    contracts = arguments.synthetic_repo.resolve() / "synthetic_priors" / "contracts.py"
    synthetic = output / "synthetic_priors"
    synthetic.mkdir()
    shutil.copy2(contracts, synthetic / "contracts.py")
    (synthetic / "__init__.py").write_text(
        '"""Minimal synthetic-prior contract required by PFF inference."""\n',
        encoding="utf-8",
    )
    print(output)


if __name__ == "__main__":
    main()
