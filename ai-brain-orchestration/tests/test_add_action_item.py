import unittest
from datetime import datetime
from app.agents.add_action_item_agent import run_add_action_item_agent

NOW = datetime(2026, 7, 10, 9, 0)


class AddActionItemTests(unittest.TestCase):
    def test_virat_match(self):
        out = run_add_action_item_agent(
            "add a match with virat tomorrow at 8am to action items", NOW)
        self.assertIn("virat", out["title"].lower())
        self.assertNotIn("action items", out["title"].lower())
        self.assertNotIn("tomorrow", out["title"].lower())
        self.assertEqual(out["due_date"], "2026-07-11T08:00:00")
        self.assertEqual(out["items"][0]["title"], out["title"])
        self.assertEqual(out["items"][0]["due_date"], "2026-07-11T08:00:00")

    def test_remind_me_no_time(self):
        out = run_add_action_item_agent("remind me to email the report", NOW)
        self.assertIn("email the report", out["title"].lower())
        self.assertIsNone(out["due_date"])
        self.assertNotIn("due_date", out["items"][0])


if __name__ == "__main__":
    unittest.main()
