import unittest

from backend import survey_analytics


class SurveyAnalyticsTests(unittest.TestCase):
    def test_normalize_score_to_five_point_scale_supports_custom_ranges(self):
        self.assertEqual(survey_analytics.normalize_score_to_five_point_scale(1, {"min": 1, "max": 10}), 1.0)
        self.assertEqual(survey_analytics.normalize_score_to_five_point_scale(5.5, {"min": 1, "max": 10}), 3.0)
        self.assertEqual(survey_analytics.normalize_score_to_five_point_scale(10, {"min": 1, "max": 10}), 5.0)

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

    def test_summarize_question_analytics_merges_same_questions_from_template_versions(self):
        summary = survey_analytics.summarize_question_analytics(
            [
                {
                    "question_id": 10,
                    "question_text": "Rate consultation quality",
                    "question_type": "scale",
                    "topic": "consultation_quality",
                    "sort_order": 1,
                    "numeric_score": 5,
                    "raw_text": "",
                    "selected_options": [],
                    "selected_employee_name": None,
                    "option_labels_by_id": {},
                },
                {
                    "question_id": 20,
                    "question_text": "Rate consultation quality",
                    "question_type": "scale",
                    "topic": "consultation_quality",
                    "sort_order": 1,
                    "numeric_score": 3,
                    "raw_text": "",
                    "selected_options": [],
                    "selected_employee_name": None,
                    "option_labels_by_id": {},
                },
            ]
        )

        self.assertEqual(len(summary), 1)
        self.assertEqual(summary[0]["question_id"], 10)
        self.assertEqual(summary[0]["answer_count"], 2)
        self.assertEqual(summary[0]["average_score"], 4.0)
        self.assertEqual(summary[0]["score_distribution"], [{"label": "5", "count": 1}, {"label": "3", "count": 1}])

    def test_summarize_question_analytics_keeps_only_current_constructor_questions(self):
        current_question_key = survey_analytics.question_group_key(
            {
                "question_id": 200,
                "question_text": "Current question",
                "question_type": "scale",
                "topic": "current",
            }
        )

        summary = survey_analytics.summarize_question_analytics(
            [
                {
                    "question_id": 100,
                    "question_text": "Old deleted question",
                    "question_type": "scale",
                    "topic": "old",
                    "sort_order": 1,
                    "numeric_score": 1,
                    "raw_text": "",
                    "selected_options": [],
                    "selected_employee_name": None,
                    "option_labels_by_id": {},
                },
                {
                    "question_id": 200,
                    "question_text": "Current question",
                    "question_type": "scale",
                    "topic": "current",
                    "sort_order": 2,
                    "numeric_score": 5,
                    "raw_text": "",
                    "selected_options": [],
                    "selected_employee_name": None,
                    "option_labels_by_id": {},
                },
            ],
            allowed_question_keys={current_question_key},
        )

        self.assertEqual([item["question_text"] for item in summary], ["Current question"])
        self.assertEqual(summary[0]["average_score"], 5.0)

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
