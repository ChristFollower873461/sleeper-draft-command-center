import tempfile
import unittest
import zipfile
from pathlib import Path

from tools.check_release import check_project, load_private_markers
from tools.package_release import build_release


class ReleaseSafetyTests(unittest.TestCase):
    def test_public_scaffold_passes_its_own_gate(self) -> None:
        root = Path(__file__).resolve().parents[1]
        self.assertEqual(check_project(root), [])

    def test_private_marker_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = "synthetic-private-marker"
            (root / "leak.txt").write_text(marker, encoding="utf-8")
            self.assertEqual(check_project(root, (marker,)), ["private marker in leak.txt"])

    def test_private_policy_loads_only_from_environment(self) -> None:
        markers = load_private_markers({"SDCC_PRIVATE_MARKERS_JSON": '["Synthetic Marker"]'})
        self.assertEqual(markers, ("synthetic marker",))

    def test_ranking_csv_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "rankings.csv").write_text("rank,player\n1,Example\n", encoding="utf-8")
            self.assertEqual(check_project(root), ["blocked artifact: rankings.csv"])

    def test_release_package_is_deterministic_and_allowlisted(self) -> None:
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.zip"
            second = Path(directory) / "second.zip"
            self.assertEqual(build_release(root, first), build_release(root, second))
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                names = archive.namelist()
            self.assertIn("manifest.json", names)
            self.assertIn("extension/state-client.js", names)
            self.assertTrue(all(not name.startswith(("tests/", "tools/", "docs/")) for name in names))


if __name__ == "__main__":
    unittest.main()
