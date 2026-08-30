#!/usr/bin/env python3
"""Build a deterministic, allowlisted extension ZIP and SHA-256 checksum."""

from __future__ import annotations

import argparse
import hashlib
import tempfile
import zipfile
from pathlib import Path

try:
    from .check_release import PRIVATE_MARKERS_ENV, check_project, load_private_markers
except ImportError:
    from check_release import PRIVATE_MARKERS_ENV, check_project, load_private_markers


ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = ("LICENSE", "PRIVACY.md", "README.md", "SECURITY.md", "manifest.json")
RELEASE_TREES = {
    "examples": {".json"},
    "extension": {".css", ".html", ".js", ".png"},
    "schemas": {".json"},
    "src": {".js"},
}
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def release_files(root: Path) -> list[Path]:
    files = [root / name for name in ROOT_FILES]
    for directory, suffixes in RELEASE_TREES.items():
        base = root / directory
        files.extend(
            path for path in base.rglob("*")
            if path.is_file() and not path.is_symlink() and path.suffix.lower() in suffixes
        )
    missing = [path.relative_to(root) for path in files if not path.is_file()]
    if missing:
        raise ValueError(f"release allowlist contains missing files: {missing}")
    return sorted(set(files), key=lambda path: path.relative_to(root).as_posix())


def build_release(root: Path, output: Path, markers: tuple[str, ...] = (), require_private_policy: bool = False) -> str:
    failures = check_project(root, markers)
    if require_private_policy and not markers:
        failures.insert(0, f"protected marker policy missing: {PRIVATE_MARKERS_ENV}")
    if failures:
        raise ValueError("; ".join(failures))

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".zip", delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        with zipfile.ZipFile(temporary_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for source in release_files(root):
                relative = source.relative_to(root).as_posix()
                info = zipfile.ZipInfo(relative, date_time=ZIP_TIMESTAMP)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, source.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        temporary_path.replace(output)
    finally:
        temporary_path.unlink(missing_ok=True)

    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(f"{output.suffix}.sha256").write_text(f"{digest}  {output.name}\n", encoding="ascii")
    return digest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--require-private-policy", action="store_true")
    args = parser.parse_args()
    markers = load_private_markers()
    try:
        digest = build_release(ROOT, args.output.resolve(), markers, args.require_private_policy)
    except ValueError as error:
        print(f"Release package failed: {error}")
        return 1
    print(f"Release package: {args.output.resolve()}")
    print(f"SHA-256: {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
