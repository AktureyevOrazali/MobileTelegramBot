import unittest

from backend import survey_analytics


class SurveyAnalyticsTests(unittest.TestCase):
    def test_summarize_completed_survey_scores_counts_one_score_per_session(self):
        summary = survey_analytics.summarize_completed_survey_scores(
            [
                {
                    "session_id": 1,
                    "session_status": "completed",
                    "numeric_score": 5,
                    "created_at": "2026-04-10T10:00:00+00:00",
                },
                {
                    "session_id": 1,
                    "session_status": "completed",
                    "numeric_score": 1,
                    "created_at": "2026-04-10T10:02:00+00:00",
                },
                {
                    "session_id": 2,
                    "session_status": "submitted",
                    "numeric_score": 5,
                    "created_at": "2026-04-11T10:00:00+00:00",
                },
                {
                    "session_id": 2,
                    "session_status": "submitted",
                    "numeric_score": 4,
                    "created_at": "2026-04-11T10:02:00+00:00",
                },
                {
                    "session_id": 3,
                    "session_status": "current",
                    "numeric_score": 1,
                    "created_at": "2026-04-12T10:00:00+00:00",
                },
            ]
        )

        self.assertEqual(summary["score_count"], 2)
        self.assertEqual(summary["average_score"], 3.75)
        self.assertEqual(summary["positive_count"], 1)
        self.assertEqual(summary["neutral_count"], 1)
        self.assertEqual(summary["negative_count"], 0)
        self.assertEqual(summary["positive_share"], 0.5)
        self.assertEqual(summary["neutral_share"], 0.5)
        self.assertEqual(summary["negative_share"], 0)
        self.assertEqual(
            summary["monthly_satisfaction"],
            [{"month": "2026-04", "average_score": 3.75, "count": 2}],
        )


if __name__ == "__main__":
    unittest.main()
