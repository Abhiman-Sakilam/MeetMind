"""Unit tests for all 7 specialized agents using a mocked LLM."""
import json
import unittest


class _FakeLLM:
    """Minimal mock that returns whatever JSON is registered for a task key."""

    def __init__(self, responses: dict[str, dict]):
        self._responses = responses

    def invoke(self, messages):
        # Identify task from payload in HumanMessage
        payload_str = messages[-1].content
        try:
            data = json.loads(payload_str)
        except Exception:
            data = {}

        task = data.get("task") or data.get("role") or "default"
        result = self._responses.get(task, self._responses.get("default", {}))
        return _FakeResp(json.dumps(result))


class _FakeResp:
    def __init__(self, content: str):
        self.content = content


class TestSummaryAgent(unittest.TestCase):
    def test_returns_reply_and_intent(self):
        from app.agents.summary_agent import run_summary_agent

        llm = _FakeLLM({
            "meeting_summary": {"reply": "Great meeting.", "intent": "GET_SUMMARY", "actions": []}
        })
        out = run_summary_agent(
            llm,
            text="Give me a summary",
            context={"memory": {}, "context": {}, "user_name": "Alice"},
            summary_type="manual",
            full_transcript="[Alice]: We decided to launch next month.",
        )
        self.assertEqual(out["reply"], "Great meeting.")
        self.assertEqual(out["intent"], "GET_SUMMARY")
        self.assertEqual(out["actions"], [])

    def test_fallback_on_empty_reply(self):
        from app.agents.summary_agent import run_summary_agent

        llm = _FakeLLM({"meeting_summary": {"reply": "", "intent": "GET_SUMMARY", "actions": []}})
        out = run_summary_agent(
            llm, text="summary", context={}, summary_type="manual", full_transcript="something"
        )
        self.assertEqual(out["reply"], "Here is the latest summary.")


class TestActionItemsAgent(unittest.TestCase):
    def test_extracts_clean_items(self):
        from app.agents.action_items_agent import run_action_items_agent

        llm = _FakeLLM({
            "extract_action_items": {
                "reply": "1. Fix the bug",
                "items": [
                    {"title": "Fix the bug", "priority": "high"},
                    {"title": "Write tests", "priority": "medium", "assigned_to": "Bob"},
                    {"title": "TBD task", "priority": "low", "assigned_to": "TBD"},
                ],
                "actions": [],
            }
        })
        out = run_action_items_agent(llm, text="list action items", context={})
        # All 3 items included (title "TBD task" is valid); only TBD field values are stripped
        self.assertEqual(len(out["items"]), 3)
        self.assertEqual(out["items"][0]["title"], "Fix the bug")
        self.assertEqual(out["items"][1]["assigned_to"], "Bob")
        # "TBD task" keeps its title but assigned_to=TBD is stripped from the dict
        self.assertEqual(out["items"][2]["title"], "TBD task")
        self.assertNotIn("assigned_to", out["items"][2])

    def test_tbd_values_stripped(self):
        from app.agents.action_items_agent import run_action_items_agent

        llm = _FakeLLM({
            "extract_action_items": {
                "reply": "Tasks",
                "items": [{"title": "Deploy", "priority": "high", "due_date": "TBD"}],
                "actions": [],
            }
        })
        out = run_action_items_agent(llm, text="action items", context={})
        self.assertNotIn("due_date", out["items"][0])


class TestBrainstormAgent(unittest.TestCase):
    def test_returns_ideas(self):
        from app.agents.brainstorm_agent import run_brainstorm_agent

        llm = _FakeLLM({
            "brainstorm": {"reply": "1. Idea A\n2. Idea B", "actions": []}
        })
        out = run_brainstorm_agent(llm, text="brainstorm product names", context={})
        self.assertIn("Idea A", out["reply"])
        self.assertEqual(out["actions"], [])

    def test_fallback_reply(self):
        from app.agents.brainstorm_agent import run_brainstorm_agent

        llm = _FakeLLM({"brainstorm": {"reply": "", "actions": []}})
        out = run_brainstorm_agent(llm, text="ideas", context={})
        self.assertEqual(out["reply"], "Here are some ideas.")


class TestDecisionAgent(unittest.TestCase):
    def test_returns_options_and_recommendation(self):
        from app.agents.decision_agent import run_decision_agent

        llm = _FakeLLM({
            "help_decide": {
                "reply": "Option A wins.",
                "options": [{"label": "A", "pros": "fast", "cons": "costly"}],
                "recommendation": "Go with A",
                "actions": [],
            }
        })
        out = run_decision_agent(llm, text="should we launch now?", context={})
        self.assertEqual(out["recommendation"], "Go with A")
        self.assertEqual(len(out["options"]), 1)

    def test_empty_options_still_valid(self):
        from app.agents.decision_agent import run_decision_agent

        llm = _FakeLLM({"help_decide": {"reply": "Hard call.", "options": [], "recommendation": "", "actions": []}})
        out = run_decision_agent(llm, text="decide", context={})
        self.assertEqual(out["options"], [])
        self.assertEqual(out["reply"], "Hard call.")


class TestRoleAgent(unittest.TestCase):
    def test_returns_reply_and_role(self):
        from app.agents.role_agent import run_role_agent

        llm = _FakeLLM({
            "role_play": {
                "reply": "As an investor, I see risk.",
                "role": "investor",
                "actions": [],
            }
        })
        out = run_role_agent(
            llm,
            text="act as investor",
            role_name="investor",
            role_description="A venture capitalist focused on growth metrics",
            context={},
        )
        self.assertEqual(out["role"], "investor")
        self.assertIn("investor", out["reply"])

    def test_role_name_fallback(self):
        from app.agents.role_agent import run_role_agent

        llm = _FakeLLM({"role_play": {"reply": "Challenging assumptions.", "role": "", "actions": []}})
        out = run_role_agent(
            llm,
            text="devil's advocate",
            role_name="devil's advocate",
            role_description="A constructive challenger who questions assumptions",
            context={},
        )
        self.assertEqual(out["role"], "devil's advocate")  # falls back to role_name


class TestNotesFilterAgent(unittest.TestCase):
    def test_sections_structure(self):
        from app.agents.notes_agent import filter_key_points

        llm = _FakeLLM({
            "default": {
                "sections": [
                    {"heading": "Product", "points": ["Launch in Q3.", "Focus on mobile."]},
                    {"heading": "Team", "points": ["Bob handles backend."]},
                ]
            }
        })
        result = filter_key_points(llm, "We plan to launch in Q3 and focus on mobile. Bob handles backend.")
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["section"], "Product")
        self.assertEqual(result[2]["section"], "Team")

    def test_empty_transcript_returns_empty(self):
        from app.agents.notes_agent import filter_key_points

        llm = _FakeLLM({"default": {"sections": []}})
        result = filter_key_points(llm, "")
        self.assertEqual(result, [])

    def test_raw_fallback_on_llm_failure(self):
        from app.agents.notes_agent import filter_key_points

        class _BrokenLLM:
            def invoke(self, _):
                raise RuntimeError("model down")

        result = filter_key_points(_BrokenLLM(), "Decision made. Budget approved.")
        self.assertGreater(len(result), 0)


class TestScreenAgent(unittest.TestCase):
    def test_no_image_returns_apology(self):
        from app.agents.screen_agent import run_screen_agent

        llm = _FakeLLM({
            "default": {
                "reply": "No image attached.",
                "intent": "SCREEN_ANALYSIS",
                "actions": [],
            }
        })
        out = run_screen_agent(
            llm,
            question="What is on screen?",
            mime_type="image/png",
            name="shot.png",
            image_base64=None,
            prior_context={},
        )
        self.assertEqual(out["intent"], "SCREEN_ANALYSIS")
        self.assertTrue(len(out["reply"]) > 0)

    def test_plain_text_reply_accepted(self):
        """Vision models sometimes ignore JSON formatting — plain text should still return a reply."""
        from app.agents.screen_agent import run_screen_agent

        class _PlainTextLLM:
            def invoke(self, _):
                return _FakeResp("The screen shows a dashboard with green charts.")

        out = run_screen_agent(
            _PlainTextLLM(),
            question="Describe screen.",
            mime_type="image/png",
            name="screen.png",
            image_base64="A" * 300,  # long enough to trigger vision path
            prior_context={},
        )
        self.assertIn("dashboard", out["reply"])


if __name__ == "__main__":
    unittest.main()
