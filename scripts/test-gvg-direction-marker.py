"""Offline regression fixtures. Never imports a worker or contacts production."""

import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "ops/gvg-reco"
FIXTURES = ROOT / "scripts/fixtures/gvg-direction"
sys.path.insert(0, str(ENGINE))
import arrow_marker


class DirectionChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        reference = json.loads((FIXTURES / "reference.json").read_text())
        cls.fixtures = []
        with np.load(FIXTURES / "real-cell-contexts.npz", allow_pickle=False) as contexts:
            for capture in reference["captures"]:
                for position, direction in capture["directions"].items():
                    key = capture["file"][:-4] + "_" + position
                    cls.fixtures.append((key, direction, contexts[key]))

    def test_real_pointers(self):
        self.assertEqual(len(self.fixtures), 25)
        for key, expected, image in self.fixtures:
            with self.subTest(key=key):
                self.assertEqual(arrow_marker.inspect_pointer(image)["direction"], expected)

    def test_four_directions(self):
        for key, expected, image in self.fixtures:
            for turns in range(4):
                with self.subTest(key=key, turns=turns):
                    rotated = np.ascontiguousarray(np.rot90(image, turns))
                    direction = arrow_marker.DIRECTIONS[(arrow_marker.DIRECTIONS.index(expected) + turns) % 4]
                    self.assertEqual(arrow_marker.inspect_pointer(rotated)["direction"], direction)

    def test_compression_resolution_and_alignment(self):
        for key, expected, image in self.fixtures:
            variants = []
            for quality in (85, 60):
                ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
                self.assertTrue(ok)
                variants.append(cv2.imdecode(jpeg, cv2.IMREAD_COLOR))
            for side in (80, 160):
                variants.append(cv2.resize(cv2.resize(image, (side, side), interpolation=cv2.INTER_AREA), (120, 120)))
            for dx, dy in ((2, -2), (-2, 2)):
                variants.append(cv2.warpAffine(image, np.float32([[1, 0, dx], [0, 1, dy]]), (120, 120), borderMode=cv2.BORDER_REPLICATE))
            for index, variant in enumerate(variants):
                with self.subTest(key=key, variant=index):
                    self.assertEqual(arrow_marker.inspect_pointer(variant)["direction"], expected)

    def test_portrait_colours_do_not_decide_direction(self):
        yy, xx = np.indices((120, 120))
        interior = (xx - 60) ** 2 + (yy - 60) ** 2 <= 30 ** 2
        for key, expected, image in self.fixtures:
            for colour in ((245, 245, 245), (80, 210, 250), (60, 15, 15)):
                changed = image.copy()
                changed[interior] = colour
                with self.subTest(key=key, colour=colour):
                    self.assertEqual(arrow_marker.inspect_pointer(changed)["direction"], expected)

    def test_missing_and_ambiguous_markers_are_rejected(self):
        for key, expected, image in self.fixtures:
            oriented = np.ascontiguousarray(np.rot90(image, -arrow_marker.DIRECTIONS.index(expected)))
            missing = oriented.copy()
            missing[36:85, 97:120] = (30, 235, 50)
            ambiguous = oriented.copy()
            ambiguous[30:90, 0:25] = np.rot90(oriented, 2)[30:90, 0:25]
            with self.subTest(key=key):
                self.assertEqual(arrow_marker.inspect_pointer(missing)["direction"], "unknown")
                self.assertEqual(arrow_marker.inspect_pointer(ambiguous)["direction"], "unknown")

    def test_invalid_contexts(self):
        for image in (None, np.zeros((8, 8, 3), np.uint8), np.zeros((120, 120, 3), np.uint8), np.full((120, 120, 3), 255, np.uint8)):
            self.assertEqual(arrow_marker.inspect_pointer(image)["direction"], "unknown")

    def test_engine_integration_keeps_hero_threshold_and_rejects_uncertainty(self):
        spec = importlib.util.spec_from_file_location("gvg_direction_engine", ENGINE / "b1_towers_responsive_probe_reco.py")
        engine = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(engine)
        self.assertEqual(engine.MIN_MARGIN, .018)
        image = np.zeros((120, 120, 3), np.uint8)
        uncertain = {"direction": "unknown", "reason": "cell_arrow_ambiguous", "scores": {d: 0.0 for d in arrow_marker.DIRECTIONS}, "margin": 0.0, "candidates": []}
        with patch.object(engine, "cell_rect_from_grid", return_value=(10, 10, 110, 110)), patch.object(engine, "detect_cell_arrow", return_value=uncertain):
            result = engine.detect_direction(image, {}, {}, {})
        self.assertEqual(result[0], "unknown")


if __name__ == "__main__":
    unittest.main(verbosity=2)
