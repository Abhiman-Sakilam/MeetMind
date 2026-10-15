import unittest
from datetime import datetime
from app.agents.date_resolver import resolve_due_datetime

NOW = datetime(2026, 7, 10, 9, 0)  # Friday


class DateResolverTests(unittest.TestCase):
    def test_tomorrow_at_8am(self):
        self.assertEqual(resolve_due_datetime("a match tomorrow at 8am", NOW),
                         datetime(2026, 7, 11, 8, 0))

    def test_today_24h(self):
        self.assertEqual(resolve_due_datetime("call today at 20:00", NOW),
                         datetime(2026, 7, 10, 20, 0))

    def test_weekday_next_occurrence(self):
        # Friday NOW -> next Monday
        self.assertEqual(resolve_due_datetime("meeting on monday at 10am", NOW),
                         datetime(2026, 7, 13, 10, 0))

    def test_date_only_defaults_9am(self):
        self.assertEqual(resolve_due_datetime("lunch tomorrow", NOW),
                         datetime(2026, 7, 11, 9, 0))

    def test_no_datetime_returns_none(self):
        self.assertIsNone(resolve_due_datetime("buy milk", NOW))

    def test_clock_already_passed_today_rolls_tomorrow(self):
        # 8am < 9am now, no explicit day -> next day
        self.assertEqual(resolve_due_datetime("ping me at 8am", NOW),
                         datetime(2026, 7, 11, 8, 0))


if __name__ == "__main__":
    unittest.main()
