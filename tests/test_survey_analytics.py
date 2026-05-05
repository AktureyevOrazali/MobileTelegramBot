import unittest

from backend import survey_analytics


class SurveyAnalyticsTests(unittest.TestCase):
    def test_summarize_question_analytics_covers_all_question_types(self):
        summary = survey_analytics.summarize_question_analytics(
            [
                {
                    "question_id": 1,
                    "question_text": "Rate service",
                    "question_type": "scale",
                    "topic": "service",
                    "sort_order": 1,
                    "numeric_score": 5,
                    "raw_text": "",
                    "selected_options": [],
                    "selected_employee_name": None,
                    "option_labels_by_id": {},
                },
                {
                    "question_id": 1,
                    "question_text": "Rate service",
                    "question_type": "scale",
                    "topic": "service",
                    "sort_order": 1,
                    "numeric_score": 3,
                    "raw_text": "",
                    "selected_options": [],
                    "selected_employee_name": None,
                    "option_labels_by_id": {},
                },
                {
                    "question_id": 2,
                    "question_text": "Training",
                    "question_type": "multi_choice",
                    "topic": "training",
                    "sort_order": 2,
                    "numeric_score": None,
                    "raw_text": "",
                    "selected_options": ["webinars", "videos"],
                    "selected_employee_name": None,
                    "option_labels_by_id": {"webinars": "Webinars", "videos": "Videos"},
                },
                {
                    "question_id": 3,
                    "question_text": "Comment",
                    "question_type": "text_comment",
                    "topic": "comment",
                    "sort_order": 3,
                    "numeric_score": None,
                    "raw_text": "Need faster replies",
                    "selected_options": [],
                    "selected_employee_name": None,
                    "option_labels_by_id": {},
                },
                {
                    "question_id": 4,
                    "question_text": "Employee exclusion",
                    "question_type": "employee_exclusion",
                    "topic": "employee_exclusion",
                    "sort_order": 4,
                    "numeric_score": None,
                    "raw_text": "Operator One",
                    "selected_options": [],
                    "selected_employee_name": "Operator One",
                    "option_labels_by_id": {},
                },
                {
                    "question_id": 9,
                    "question_text": "Ninth question",
                    "question_type": "single_choice",
                    "topic": "extra",
                    "sort_order": 9,
                    "numeric_score": None,
                    "raw_text": "",
                    "selected_options": ["yes"],
                    "selected_employee_name": None,
                    "option_labels_by_id": {"yes": "Yes"},
                },
            ]
        )

        self.assertEqual([item["question_id"] for item in summary], [1, 2, 3, 4, 9])
        self.assertEqual(summary[0]["answer_count"], 2)
        self.assertEqual(summary[0]["average_score"], 4.0)
        self.assertEqual(summary[0]["score_distribution"], [{"label": "5", "count": 1}, {"label": "3", "count": 1}])
        self.assertEqual(summary[1]["top_answers"], [{"label": "Videos", "count": 1}, {"label": "Webinars", "count": 1}])
        self.assertEqual(summary[2]["top_answers"], [{"label": "Need faster replies", "count": 1}])
        self.assertEqual(summary[3]["top_answers"], [{"label": "Operator One", "count": 1}])
        self.assertEqual(summary[4]["top_answers"], [{"label": "Yes", "count": 1}])

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
