import json
import unittest
from unittest.mock import patch

from app.orchestrator import NOTES_STORE, SCREEN_STORE, SESSION_STORE, run_execute
from app.schemas import ExecuteRequest


class _FakeLangChainResponse:
    def __init__(self, content: str):
        self.content = content


class _FakeChatGroq:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    def invoke(self, messages):
        prompt = messages[0].content
        payload = messages[1].content
        try:
            data = json.loads(payload)
        except (json.JSONDecodeError, ValueError):
            # Plain-text persona acknowledgement calls — return a simple string reply.
            return _FakeLangChainResponse("Acknowledged.")
        if "Intent Router" in prompt:
            text = str(data.get("text", "")).lower()
            if "start taking notes" in text:
                return _FakeLangChainResponse(json.dumps({"route": "START_NOTES"}))
            if "stop taking notes" in text:
                return _FakeLangChainResponse(json.dumps({"route": "STOP_NOTES"}))
            if "show notes" in text or "show me notes" in text:
                return _FakeLangChainResponse(json.dumps({"route": "SHOW_NOTES"}))
            if "screenshot" in text:
                return _FakeLangChainResponse(json.dumps({"route": "SCREEN_CAPTURE_ANALYZE"}))
            if "meeting_end" in str(data.get("meeting_phase", "")):
                return _FakeLangChainResponse(json.dumps({"route": "SUMMARY_FINAL"}))
            return _FakeLangChainResponse(json.dumps({"route": "GENERAL"}))
        if "Summary Agent" in prompt:
            return _FakeLangChainResponse(
                json.dumps({"reply": "summary ok", "intent": "GET_SUMMARY", "actions": []})
            )
        if "extract_note" in str(data.get("task", "")):
            return _FakeLangChainResponse(
                json.dumps({"title": "Api Contract", "note": "Finalize the API contract today."})
            )
        if "raw_transcript" in str(data):
            return _FakeLangChainResponse(
                json.dumps({"notes": [{"title": "Key Point", "text": "Finalize the API contract today."}]})
            )
        if "Screen Analysis Agent" in prompt:
            return _FakeLangChainResponse(
                json.dumps({"reply": "screen analyzed", "intent": "SCREEN_ANALYSIS", "actions": []})
            )
        if "Role-Play Agent" in prompt:
            return _FakeLangChainResponse(
                json.dumps({"reply": "investor perspective: looks promising", "role": "investor", "actions": []})
            )
        if "Brainstorm Agent" in prompt:
            return _FakeLangChainResponse(
                json.dumps({"reply": "1. Idea A\n2. Idea B\n3. Idea C", "actions": []})
            )
        if "Decision Support Agent" in prompt:
            return _FakeLangChainResponse(
                json.dumps({"reply": "Option A is better", "options": [], "recommendation": "Go with A", "actions": []})
            )
        if "Action Items Agent" in prompt:
            return _FakeLangChainResponse(
                json.dumps({"reply": "1. Deploy app - John - Friday", "items": [{"title": "Deploy app", "assigned_to": "John", "due_date": "Friday", "priority": "high"}], "actions": []})
            )
        return _FakeLangChainResponse(json.dumps({"reply": "ok", "intent": "SMALL_TALK", "actions": []}))


class OrchestratorTests(unittest.TestCase):
    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_run_execute_persists_memory(self):
        req1 = ExecuteRequest(user_id="u1", room_id="r1", user_name="A", text="hello", source="chat")
        res1 = run_execute(req1)
        self.assertEqual(res1.reply, "ok")

        req2 = ExecuteRequest(user_id="u1", room_id="r1", user_name="A", text="follow up", source="voice")
        res2 = run_execute(req2)
        self.assertEqual(res2.reply, "ok")

        context = SESSION_STORE.get_context_window("u1", "r1")
        self.assertGreaterEqual(len(context["recent_turns"]), 2)

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_notes_lifecycle_and_append(self):
        start = ExecuteRequest(
            user_id="u2",
            room_id="r2",
            user_name="A",
            text="Hey Jarvis, start taking notes",
            source="voice",
        )
        start_res = run_execute(start)
        self.assertEqual(start_res.notes_state, "on")
        self.assertEqual(start_res.ui_event, "NOTES_OPEN")

        note_turn = ExecuteRequest(
            user_id="u2",
            room_id="r2",
            user_name="A",
            text="Capture this point: finalize the API contract today",
            source="voice",
        )
        note_res = run_execute(note_turn)
        self.assertEqual(note_res.intent, "APPEND_NOTE_RAW")
        self.assertEqual(note_res.ui_event, "NOTES_RAW_CHUNK")
        self.assertTrue(sum(len(s.raw_chunks) for s in NOTES_STORE.get("u2", "r2").sessions))

        stop = ExecuteRequest(
            user_id="u2",
            room_id="r2",
            user_name="A",
            text="Hey Jarvis, stop taking notes",
            source="voice",
        )
        stop_res = run_execute(stop)
        self.assertEqual(stop_res.notes_state, "off")
        self.assertEqual(stop_res.ui_event, "NOTES_CLOSE")
        self.assertTrue(stop_res.artifacts and stop_res.artifacts.get("notes"))

        show = ExecuteRequest(
            user_id="u2",
            room_id="r2",
            user_name="A",
            text="Show me notes",
            source="chat",
        )
        show_res = run_execute(show)
        self.assertEqual(show_res.intent, "SHOW_NOTES")
        self.assertEqual(show_res.ui_event, "NOTES_OPEN")
        self.assertIn("Finalize the API contract today.", show_res.reply)
        self.assertTrue(show_res.artifacts and show_res.artifacts.get("notes"))

        restart = ExecuteRequest(
            user_id="u2",
            room_id="r2",
            user_name="A",
            text="Hey Jarvis, start taking notes",
            source="voice",
        )
        restart_res = run_execute(restart)
        self.assertEqual(restart_res.notes_state, "on")

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_start_notes_idempotent_while_active(self):
        NOTES_STORE.start("u4", "r4")
        NOTES_STORE.append_raw("u4", "r4", "existing note")
        req = ExecuteRequest(
            user_id="u4",
            room_id="r4",
            user_name="A",
            text="Hey Jarvis, start taking notes",
            source="voice",
        )
        res = run_execute(req)
        self.assertEqual(res.notes_state, "on")
        state = NOTES_STORE.get("u4", "r4")
        self.assertEqual(sum(len(s.raw_chunks) for s in state.sessions), 1, "Should NOT clear existing raw chunks if already active")

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_empty_text_returns_empty_input(self):
        req = ExecuteRequest(user_id="u5", room_id="r5", user_name="A", text="   ", source="chat")
        res = run_execute(req)
        self.assertEqual(res.intent, "EMPTY_INPUT")

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_brainstorm_route(self):
        req = ExecuteRequest(
            user_id="u6", room_id="r6", user_name="A",
            text="Jarvis, brainstorm ideas for our product launch",
            source="voice",
        )
        res = run_execute(req)
        self.assertEqual(res.intent, "BRAINSTORM")
        self.assertIn("Idea", res.reply)

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_devils_advocate_route(self):
        req = ExecuteRequest(
            user_id="u7", room_id="r7", user_name="A",
            text="Jarvis, play devil's advocate on this plan",
            source="voice",
        )
        res = run_execute(req)
        self.assertEqual(res.intent, "DEVIL_ADVOCATE")

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_help_decide_route(self):
        req = ExecuteRequest(
            user_id="u8", room_id="r8", user_name="A",
            text="Jarvis, help us decide between React and Vue",
            source="voice",
        )
        res = run_execute(req)
        self.assertEqual(res.intent, "HELP_DECIDE")

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_action_items_route(self):
        req = ExecuteRequest(
            user_id="u9", room_id="r9", user_name="A",
            text="Jarvis, list action items from this meeting",
            source="voice",
        )
        res = run_execute(req)
        self.assertEqual(res.intent, "ACTION_ITEMS")
        self.assertTrue(res.artifacts and res.artifacts.get("items"))

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_play_role_route(self):
        req = ExecuteRequest(
            user_id="u10", room_id="r10", user_name="A",
            text="Jarvis, act as an investor and evaluate our pitch",
            source="voice",
        )
        res = run_execute(req)
        self.assertEqual(res.intent, "PLAY_ROLE")

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_screen_analysis_follow_up_memory(self):
        req = ExecuteRequest(
            user_id="u3",
            room_id="r3",
            user_name="A",
            text="Take screenshot and explain this chart",
            source="voice",
            session_id="s1",
            attachments=[
                {
                    "kind": "image",
                    "mime_type": "image/png",
                    "data_base64": "ZmFrZQ==",
                    "name": "shot.png",
                }
            ],
        )
        res = run_execute(req)
        self.assertEqual(res.intent, "SCREEN_ANALYSIS")
        self.assertTrue(bool(res.artifacts and res.artifacts.get("has_image")))
        ctx = SCREEN_STORE.get("u3", "r3", "s1")
        self.assertTrue(bool(ctx.last_image_base64))


class RoutingTests(unittest.TestCase):
    def test_keyword_strong_phrase_start_notes(self):
        from app.orchestrator import _keyword_route
        route, matched = _keyword_route("please start taking notes now")
        self.assertEqual(route, "START_NOTES")
        self.assertEqual(matched, "start taking notes")

    def test_keyword_ignores_weak_be_a(self):
        from app.orchestrator import _keyword_route
        # "be a" must NOT trigger PLAY_ROLE anymore
        self.assertIsNone(_keyword_route("could you be a bit quieter")[0])

    def test_keyword_ignores_passing_next_steps(self):
        from app.orchestrator import _keyword_route
        self.assertIsNone(_keyword_route("we discussed the next steps briefly")[0])

    def test_keyword_word_boundary_not_substring(self):
        from app.orchestrator import _keyword_route
        # "noted" should not fire the note family
        self.assertIsNone(_keyword_route("he noted the time")[0])

    def test_meeting_end_is_phase_decision(self):
        from app.orchestrator import _route_intent
        req = ExecuteRequest(user_id="u", room_id="r", text="wrap up", meeting_phase="meeting_end")
        route, info = _route_intent(None, req, {})
        self.assertEqual(route, "SUMMARY_FINAL")
        self.assertEqual(info.decided_by, "phase")

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_cancel_intent_ack_no_agent(self):
        req = ExecuteRequest(user_id="u", room_id="r", text="never mind, cancel that", user_name="A")
        res = run_execute(req)
        self.assertEqual(res.intent, "CANCEL")
        self.assertTrue(bool(res.reply))
        self.assertIsNotNone(res.routing)
        self.assertEqual(res.routing.decided_by, "keyword")

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_repeat_returns_last_assistant_reply(self):
        uid, rid = "u-rep", "r-rep"
        SESSION_STORE.clear(uid, rid)
        SESSION_STORE.append_turn(uid, rid, "user", "hello")
        SESSION_STORE.append_turn(uid, rid, "assistant", "The budget is 42k.")
        req = ExecuteRequest(user_id=uid, room_id=rid, text="say that again")
        res = run_execute(req)
        self.assertIn("42k", res.reply)
        self.assertEqual(res.intent, "REPEAT")


class ActionItemsSourceTests(unittest.TestCase):
    def test_agent_payload_includes_transcript_and_notes(self):
        from app.agents import action_items_agent as aia
        captured = {}

        class _Rec:
            def invoke(self, messages):
                captured["payload"] = messages[1].content
                return type("R", (), {"content": '{"reply":"ok","items":[]}'})()

        aia.run_action_items_agent(
            _Rec(), text="what are the action items",
            context={}, full_transcript="[A]: ship the report by friday",
            notes_text="- call the vendor",
        )
        self.assertIn("ship the report by friday", captured["payload"])
        self.assertIn("call the vendor", captured["payload"])


class AddActionItemRouteTests(unittest.TestCase):
    def test_keyword_routes_to_add(self):
        from app.orchestrator import _keyword_route
        self.assertEqual(
            _keyword_route("add a match with virat tomorrow at 8am to action items")[0],
            "ADD_ACTION_ITEM",
        )

    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_add_action_item_returns_item(self):
        req = ExecuteRequest(
            user_id="u-add", room_id="r-add",
            text="add a match with virat tomorrow at 8am to action items",
        )
        res = run_execute(req)
        self.assertEqual(res.intent, "ADD_ACTION_ITEM")
        self.assertTrue(res.artifacts and res.artifacts.get("items"))
        self.assertIn("virat", res.artifacts["items"][0]["title"].lower())


class RecallTests(unittest.TestCase):
    @patch("app.orchestrator.settings.groq_api_key", "test-key")
    @patch("app.orchestrator.ChatGroq", _FakeChatGroq)
    def test_general_payload_includes_transcript(self):
        from app.orchestrator import TRANSCRIPT_STORE
        uid, rid = "u-rec", "r-rec"
        TRANSCRIPT_STORE.clear(uid, rid)
        TRANSCRIPT_STORE.append(uid, rid, "I have a Virat match tomorrow", speaker="A")
        captured = {}
        orig = _FakeChatGroq.invoke

        def spy(self, messages):
            captured["user"] = messages[1].content
            return orig(self, messages)

        with patch.object(_FakeChatGroq, "invoke", spy):
            run_execute(ExecuteRequest(user_id=uid, room_id=rid,
                                       text="what did I say about the Virat match?"))
        self.assertIn("Virat match tomorrow", captured["user"])


if __name__ == "__main__":
    unittest.main()
