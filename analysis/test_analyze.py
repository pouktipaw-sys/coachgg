"""Tests des fonctions pures de l'analyseur : python -m unittest discover -s analysis"""
import unittest

import numpy as np

from analyze import detect_activity, detect_grey, minimap_rise, segments


class Segments(unittest.TestCase):
    def test_merge_and_min_length(self):
        m = np.array([0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 0], bool)
        self.assertEqual(segments(m, min_len=3), [(1, 5)])  # trou de 1 fusionné
        self.assertEqual(segments(m, min_len=1, max_gap=0), [(1, 2), (4, 5), (9, 9)])


class Grey(unittest.TestCase):
    def test_detects_desaturated_segment(self):
        sat = np.full(60, 120.0)
        sat[20:34] = 10.0  # 7 s à 2 i/s
        found, base, warn = detect_grey(sat, fps=2)
        self.assertEqual(warn, [])
        self.assertEqual(len(found), 1)
        self.assertEqual((found[0]["startIdx"], found[0]["endIdx"]), (20, 33))
        self.assertEqual(found[0]["confidence"], "MEDIUM")

    def test_short_dip_ignored(self):
        sat = np.full(60, 120.0)
        sat[10:13] = 10.0  # 1,5 s
        self.assertEqual(detect_grey(sat, fps=2)[0], [])

    def test_disabled_on_greyish_video(self):
        found, _, warn = detect_grey(np.full(40, 10.0), fps=2)
        self.assertEqual(found, [])
        self.assertTrue(warn)


class Activity(unittest.TestCase):
    def test_peak_and_exclusion(self):
        m = np.full(80, 2.0)
        m[30:40] = 20.0
        m[60:70] = 15.0
        acts, _ = detect_activity(m, fps=2, exclude=[(55, 75)])
        self.assertEqual(len(acts), 1)
        self.assertTrue(28 <= acts[0]["startIdx"] <= 31)


class Minimap(unittest.TestCase):
    def test_rise_and_centroid_before_event(self):
        masks = [np.zeros((20, 20), bool) for _ in range(60)]
        for i in range(40, 50):
            masks[i][2:5, 15:18] = True  # nouveaux marqueurs en haut à droite
        red = np.array([m.mean() for m in masks])
        r = minimap_rise(red, masks, start=50, ctx=20)
        self.assertGreater(r["rise"], 0.01)
        self.assertAlmostEqual(r["centroid"]["x"], 16 / 20, places=2)
        self.assertAlmostEqual(r["centroid"]["y"], 3 / 20, places=2)
        self.assertLess(r["peakIdx"], 50)  # jamais après l'événement


if __name__ == "__main__":
    unittest.main()
