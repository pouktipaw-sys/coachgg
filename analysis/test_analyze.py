"""Tests des fonctions pures de l'analyseur : python -m unittest discover -s analysis"""
import unittest

import numpy as np

from analyze import detect_activity, detect_grey, frame_saturation, minimap_rise, segments


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

    def test_overlay_in_colour_does_not_hide_death_screen(self):
        # Écran de mort grisé, mais webcam et chat du streamer restés en couleur (≈ 30 % de l'image).
        colour = np.zeros((100, 160, 3), np.uint8); colour[:] = (40, 160, 60)
        grey = np.full((100, 160, 3), 90, np.uint8)
        grey[0:45, 0:55] = (30, 60, 230); grey[60:100, 100:160] = (200, 40, 160)
        ratio = frame_saturation(grey) / frame_saturation(colour)
        self.assertLess(ratio, 0.1)  # la moyenne, elle, restait au-dessus de 0,3

    def test_short_clip_death_kept(self):
        sat = np.full(60, 98.0)
        sat[18:24] = 24.0  # 3 s d'écran grisé dans un clip coupé
        sat[56:60] = 22.0  # 2 s à la toute fin de la vidéo
        found = detect_grey(sat, fps=2)[0]
        self.assertEqual([(g["startIdx"], g["endIdx"]) for g in found], [(18, 23), (56, 59)])

    def test_real_clip_profile(self):
        # Valeurs mesurées sur un vrai clip de stream (2 i/s) : morts à 9 s et 28 s (coupée par la fin).
        sat = np.array([100, 100, 100, 97, 95, 96, 94, 94, 90, 85, 80, 77, 72, 72, 76, 75, 82, 87, 26, 26, 32, 38, 38, 40, 50, 61, 71,
                        115, 112, 108, 106, 102, 100, 101, 100, 99, 103, 103, 102, 102, 102, 102, 102, 104, 103, 92, 103, 103, 99, 101,
                        105, 102, 101, 102, 102, 94, 26, 28, 30], float)
        found = detect_grey(sat, fps=2)[0]
        self.assertEqual([(g["startIdx"], g["endIdx"]) for g in found], [(18, 23), (56, 58)])

    def test_dim_scene_without_deep_grey_ignored(self):
        sat = np.full(60, 100.0)
        sat[20:30] = 42.0  # scène sombre : sous 45 % mais jamais sous 35 %
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


class TestRefineGreyStart(unittest.TestCase):
    def test_first_index_ignores_isolated_flash(self):
        from analyze import first_grey_index
        self.assertEqual(first_grey_index([90, 20, 90, 90, 20, 20, 20, 20], 30), 4)
        self.assertIsNone(first_grey_index([90, 90, 20, 20], 30))


class TestChipRows(unittest.TestCase):
    def test_wraps_chips_to_panel_width(self):
        from PIL import Image, ImageDraw
        from render_clip import chip_rows, font
        d = ImageDraw.Draw(Image.new("RGB", (10, 10)))
        chips = [{"text": "1 contre 2", "tone": "bad"}, {"text": "Niv. 7 vs 9", "tone": "bad"}, {"text": "1 850 or en poche", "tone": "warn"}]
        rows = chip_rows(d, chips, font(13), 10_000)
        self.assertEqual(len(rows), 1)
        rows = chip_rows(d, chips, font(13), 120)
        self.assertEqual([len(r) for r in rows], [1, 1, 1])
        self.assertEqual(rows[0][0][1], (248, 113, 113))
