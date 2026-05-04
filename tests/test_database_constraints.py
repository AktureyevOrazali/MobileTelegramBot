import unittest
from unittest.mock import patch

from backend import database


class DatabaseConstraintTests(unittest.TestCase):
    def test_ensure_check_constraint_recreates_existing_named_constraint(self):
        executed_queries: list[str] = []

        with (
            patch.object(database, "_constraint_exists", return_value=True),
            patch.object(database, "execute", side_effect=lambda query, params=None: executed_queries.append(query)),
        ):
            database._ensure_check_constraint(
                "survey_sessions",
                constraint_name="chk_survey_sessions_status_known",
                expression='"status" IS NULL OR "status" IN (\'current\')',
                not_valid=False,
            )

        self.assertTrue(
            any("DROP CONSTRAINT IF EXISTS" in query for query in executed_queries),
            executed_queries,
        )
        self.assertTrue(
            any("ADD CONSTRAINT" in query and "CHECK" in query for query in executed_queries),
            executed_queries,
        )


if __name__ == "__main__":
    unittest.main()
