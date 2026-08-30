#!/usr/bin/env python3
"""Fail a public release that contains private markers or risky artifacts."""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping
from pathlib import Path


PRIVATE_MARKERS_ENV = "SDCC_PRIVATE_MARKERS_JSON"
BLOCKED_SUFFIXES = {".csv", ".zip", ".pem", ".key", ".p12", ".pfx"}
BLOCKED_NAMES = {".env", "cookies.txt", "local storage", "login data"}
SKIP_PARTS = {".git", "__pycache__", ".pytest_cache"}
ALLOWED_PNG_ROOTS = (Path("assets/brand"), Path("extension/icons"), Path("store-assets"))
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def valid_allowed_png(path: Path, relative: Path) -> bool:
    if path.suffix.lower() != ".png" or not any(relative.is_relative_to(root) for root in ALLOWED_PNG_ROOTS):
        return False
    data = path.read_bytes()
    return len(data) >= 24 and data.startswith(PNG_SIGNATURE) and data[12:16] == b"IHDR" and all(
        value > 0 for value in (int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big"))
    )


def load_private_markers(environment: Mapping[str, str] | None = None) -> tuple[str, ...]:
    source = os.environ if environment is None else environment
    raw = source.get(PRIVATE_MARKERS_ENV, "").strip()
    if not raw:
        return ()
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"{PRIVATE_MARKERS_ENV} must be a JSON array") from error
    if not isinstance(values, list) or any(not isinstance(value, str) or not value.strip() for value in values):
        raise ValueError(f"{PRIVATE_MARKERS_ENV} must be a JSON array of non-empty strings")
    return tuple(dict.fromkeys(value.strip().lower() for value in values))


def check_project(root: Path, markers: tuple[str, ...] = ()) -> list[str]:
    failures: list[str] = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if any(part in SKIP_PARTS for part in relative.parts) or not path.is_file():
            continue
        lower_name = path.name.lower()
        if lower_name in BLOCKED_NAMES or path.suffix.lower() in BLOCKED_SUFFIXES:
            failures.append(f"blocked artifact: {relative}")
            continue
        if valid_allowed_png(path, relative):
            continue
        try:
            text = path.read_text(encoding="utf-8").lower()
        except UnicodeDecodeError:
            failures.append(f"unexpected binary file: {relative}")
            continue
        for marker in markers:
            if marker in text:
                failures.append(f"private marker in {relative}")
                break
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument(
        "--require-private-policy",
        action="store_true",
        help=f"fail when {PRIVATE_MARKERS_ENV} is not configured",
    )
    args = parser.parse_args()
    try:
        markers = load_private_markers()
    except ValueError as error:
        print(f"Public release safety check failed:\n- {error}")
        return 1
    failures = []
    if args.require_private_policy and not markers:
        failures.append(f"protected marker policy missing: {PRIVATE_MARKERS_ENV}")
    failures.extend(check_project(args.root.resolve(), markers))
    if failures:
        print("Public release safety check failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("Public release safety check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
