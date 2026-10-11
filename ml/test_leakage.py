"""Leakage guards for the offline benchmark. Run: .venv/bin/python -I -m unittest discover -s ml -p 'test_*.py'"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import train_benchmark as tb  # noqa: E402


class LeakageTests(unittest.TestCase):
    def test_allowlist_passes(self):
        tb.assert_no_leakage(tb.FEATURES)

    def test_forbidden_columns_fail(self):
        for col in ["target_kaggle_total", "target_reconstructed", "dream_team_label", "captain_label", "toss_winner", "match_winner", "player_of_match", "baseline_pred"]:
            with self.assertRaises(ValueError, msg=col):
                tb.assert_no_leakage([col])

    def test_splits_are_chronological(self):
        import pandas as pd
        df = pd.read_csv(tb.PROCESSED / "features_ipl.csv", usecols=["split", "match_date"])
        lab = df[df.split.isin(["train", "validation", "test"])]
        self.assertLess(lab[lab.split == "train"].match_date.max(), lab[lab.split == "validation"].match_date.min())
        self.assertLess(lab[lab.split == "validation"].match_date.max(), lab[lab.split == "test"].match_date.min())


if __name__ == "__main__":
    unittest.main()
