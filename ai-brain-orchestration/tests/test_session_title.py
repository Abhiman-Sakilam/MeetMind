import unittest
from unittest.mock import MagicMock
from app.agents.notes_agent import generate_session_title


class _FakeMsg:
    def __init__(self, content: str):
        self.content = content


class GenerateSessionTitleTests(unittest.TestCase):
    def test_returns_clean_title_from_llm(self):
        llm = MagicMock()
        llm.invoke.return_value = _FakeMsg('{"title": "Q4 Marketing Strategy"}')
        notes = [{"text": "We will boost ads", "section": "Marketing", "ts": 1.0}]
        title = generate_session_title(llm, notes)
        self.assertEqual(title, "Q4 Marketing Strategy")

    def test_fallback_on_llm_error(self):
        llm = MagicMock()
        llm.invoke.side_effect = RuntimeError("boom")
        title = generate_session_title(llm, [{"text": "hello", "section": "", "ts": 1.0}])
        self.assertEqual(title, "Notes Session")

    def test_fallback_when_empty_input(self):
        llm = MagicMock()
        title = generate_session_title(llm, [])
        self.assertEqual(title, "Notes Session")
        llm.invoke.assert_not_called()

    def test_strips_quotes_and_periods(self):
        llm = MagicMock()
        llm.invoke.return_value = _FakeMsg('{"title": "\\"Pricing Discussion.\\""}')
        title = generate_session_title(llm, [{"text": "x", "section": "", "ts": 1.0}])
        self.assertEqual(title, "Pricing Discussion")
