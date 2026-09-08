"""Fetch and verify the immutable public service sources used by dashboard CI."""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


def main():
    dashboard = Path(__file__).resolve().parents[1]
    release = json.loads((dashboard / "services/huggingface_space/release.json").read_text())
    repository, revision = release["repository"], release["revision"]
    if not re.fullmatch(r"[\w-]+/[\w.-]+", repository) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("release must specify a repository and immutable commit")
    target = Path(sys.argv[1]).resolve()
    target.mkdir(parents=True, exist_ok=False)
    subprocess.run(["git", "init", str(target)], check=True)
    subprocess.run(["git", "-C", str(target), "fetch", "--depth=1",
                    f"https://huggingface.co/spaces/{repository}", revision], check=True)
    subprocess.run(["git", "-C", str(target), "checkout", "--detach", "FETCH_HEAD"], check=True)
    manifest = json.loads((target / "bundle-manifest.json").read_text())
    if manifest["format"] != "pff-space-bundle-v1":
        raise ValueError("unsupported source manifest")
    for name, expected in manifest["sha256"].items():
        path = target / name
        if path.is_symlink() or not path.resolve().is_relative_to(target):
            raise ValueError(f"unsafe manifest path: {name}")
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"source checksum mismatch: {name}")
    print(f"Verified {len(manifest['sha256'])} files at {repository}@{revision}")


if __name__ == "__main__":
    main()
