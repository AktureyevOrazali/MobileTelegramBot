import os
import unittest

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv


class AdminSeedTests(unittest.TestCase):
    def test_admin_seed_keeps_readable_name(self):
        load_dotenv("backend/.env")

        from backend import database  # noqa: F401 - import runs seed checks

        expected = "".join(
            chr(code)
            for code in [1040, 1076, 1084, 1080, 1085, 1080, 1089, 1090, 1088, 1072, 1090, 1086, 1088]
        )
        conn = psycopg2.connect(
            dbname=os.getenv("DB_NAME"),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD"),
            host=os.getenv("DB_HOST"),
            port=os.getenv("DB_PORT"),
        )
        try:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT name FROM users WHERE login = %s", ("admin",))
            row = cur.fetchone()
        finally:
            conn.close()

        self.assertIsNotNone(row)
        self.assertEqual(row["name"], expected)


if __name__ == "__main__":
    unittest.main()
