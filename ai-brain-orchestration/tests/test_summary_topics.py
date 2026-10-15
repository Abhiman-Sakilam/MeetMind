import json
import unittest
from unittest.mock import MagicMock
from app.agents.summary_agent import run_summary_agent


class _FakeMsg:
    def __init__(self, content: str):
        self.content = content


class SummaryTopicsTests(unittest.TestCase):
    def test_returns_topics_and_keywords_arrays(self):
        llm = MagicMock()
        llm.invoke.return_value = _FakeMsg(json.dumps({
            "reply": "## Overview\n...",
            "intent": "GET_SUMMARY",
            "actions": [],
            "topics": ["Q4 Planning", "Vision 2027"],
            "keywords": ["marketing", "pricing"],
        }))
        out = run_summary_agent(
            llm,
            text="summarize",
            context={},
            summary_type="final",
            full_transcript="lots of text",
        )
        self.assertEqual(out["topics"], ["Q4 Planning", "Vision 2027"])
        self.assertEqual(out["keywords"], ["marketing", "pricing"])

    def test_missing_keys_default_to_empty(self):
        llm = MagicMock()
        llm.invoke.return_value = _FakeMsg(json.dumps({"reply": "ok"}))
        out = run_summary_agent(llm, text="x", context={}, summary_type="manual")
        self.assertEqual(out["topics"], [])
        self.assertEqual(out["keywords"], [])

    def test_non_list_values_coerced_to_empty(self):
        llm = MagicMock()
        llm.invoke.return_value = _FakeMsg(json.dumps({"reply": "ok", "topics": "not a list", "keywords": None}))
        out = run_summary_agent(llm, text="x", context={}, summary_type="manual")
        self.assertEqual(out["topics"], [])
        self.assertEqual(out["keywords"], [])
