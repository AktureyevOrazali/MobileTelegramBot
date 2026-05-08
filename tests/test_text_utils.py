import unittest

from backend.text_utils import repair_text


class TextUtilsTests(unittest.TestCase):
    def test_repair_text_handles_latin_marker_mojibake(self):
        self.assertEqual(
            repair_text("PђPґPјPёPЅPёCЃC‚CЂP°C‚PѕCЂ"),
            "Администратор",
        )


if __name__ == "__main__":
    unittest.main()
