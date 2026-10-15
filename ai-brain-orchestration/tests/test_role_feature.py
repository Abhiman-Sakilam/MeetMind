import time
import unittest

from pydantic import ValidationError

from app.schemas import (
    RoleExitRequest,
    RoleExitResponse,
    RoleSetRequest,
    RoleSetResponse,
    RoleWatchRequest,
    RoleWatchResponse,
)
from app.session_store import ActiveRole, SessionStore


class TestActiveRoleDataclass(unittest.TestCase):
    def test_defaults(self):
        role = ActiveRole(
            name="VC",
            description="A venture capitalist focused on SaaS metrics and unit economics",
        )
        self.assertEqual(role.sensitivity, "smart")
        self.assertEqual(role.last_proactive_at, 0.0)
        self.assertEqual(role.last_chunk_hash, "")
        self.assertGreater(role.activated_at, 0)


class TestSessionStoreRoleMethods(unittest.TestCase):
    def setUp(self):
        self.store = SessionStore()
        self.store.clear("u1", "r1")

    def test_set_and_get_role(self):
        role = ActiveRole(name="VC", description="Venture capitalist focused on SaaS")
        self.store.set_role("u1", "r1", role)
        retrieved = self.store.get_role("u1", "r1")
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.name, "VC")

    def test_get_role_returns_none_when_unset(self):
        self.assertIsNone(self.store.get_role("unknown", "unknown"))

    def test_clear_role(self):
        self.store.set_role("u1", "r1", ActiveRole(name="VC", description="Venture capitalist"))
        self.store.clear_role("u1", "r1")
        self.assertIsNone(self.store.get_role("u1", "r1"))

    def test_update_proactive(self):
        self.store.set_role("u1", "r1", ActiveRole(name="VC", description="Venture capitalist"))
        self.store.update_proactive("u1", "r1", "abc123")
        role = self.store.get_role("u1", "r1")
        self.assertGreater(role.last_proactive_at, 0)
        self.assertEqual(role.last_chunk_hash, "abc123")

    def test_set_role_does_not_erase_session_turns(self):
        self.store.append_turn("u1", "r1", "user", "hello")
        self.store.set_role("u1", "r1", ActiveRole(name="VC", description="Venture capitalist"))
        ctx = self.store.get_context_window("u1", "r1")
        self.assertTrue(len(ctx["recent_turns"]) > 0)


class TestRoleSchemas(unittest.TestCase):
    def test_role_set_request_validation(self):
        req = RoleSetRequest(
            user_id="u1", room_id="r1",
            role_name="Venture Capitalist",
            role_description="Series B investor focused on SaaS metrics and unit economics",
        )
        self.assertEqual(req.sensitivity, "smart")

    def test_role_set_request_rejects_short_description(self):
        with self.assertRaises(ValidationError):
            RoleSetRequest(
                user_id="u1", room_id="r1",
                role_name="VC",
                role_description="short",
            )

    def test_role_set_request_rejects_invalid_sensitivity(self):
        with self.assertRaises(ValidationError):
            RoleSetRequest(
                user_id="u1", room_id="r1",
                role_name="VC",
                role_description="Series B investor focused on SaaS metrics",
                sensitivity="invalid_value",
            )

    def test_role_watch_response_defaults(self):
        resp = RoleWatchResponse(respond=False)
        self.assertEqual(resp.reply, "")
        self.assertIsNone(resp.signal)
        self.assertEqual(resp.follow_up_questions, [])

    def test_role_exit_response_defaults(self):
        resp = RoleExitResponse(reply="exited")
        self.assertTrue(resp.deactivated)


import json


class _FakeLangChainResponse:
    def __init__(self, content: str):
        self.content = content


class _WatcherDecisionLLM:
    def __init__(self, **kwargs): pass
    def invoke(self, messages):
        return _FakeLangChainResponse(json.dumps({"respond": True, "signal": "decision"}))


class _WatcherRiskLLM:
    def __init__(self, **kwargs): pass
    def invoke(self, messages):
        return _FakeLangChainResponse(json.dumps({"respond": True, "signal": "risk"}))


class _WatcherNoSignalLLM:
    def __init__(self, **kwargs): pass
    def invoke(self, messages):
        return _FakeLangChainResponse(json.dumps({"respond": False, "signal": None}))


class TestWatcherAgent(unittest.TestCase):
    def test_short_chunk_always_returns_false(self):
        from app.agents.watcher_agent import run_watcher_agent
        result = run_watcher_agent(
            _WatcherDecisionLLM(),
            chunk="Too short",
            role_name="VC",
            role_description="Venture capitalist",
            sensitivity="smart",
        )
        self.assertFalse(result["respond"])

    def test_smart_sensitivity_allows_decision(self):
        from app.agents.watcher_agent import run_watcher_agent
        long_chunk = "okay everyone let us vote right now should we go with option A or move to option B for the entire platform architecture this is a critical decision"
        result = run_watcher_agent(
            _WatcherDecisionLLM(),
            chunk=long_chunk,
            role_name="VC",
            role_description="Venture capitalist",
            sensitivity="smart",
        )
        self.assertTrue(result["respond"])
        self.assertEqual(result["signal"], "decision")

    def test_smart_sensitivity_allows_risk(self):
        from app.agents.watcher_agent import run_watcher_agent
        long_chunk = "we are taking a significant risk here by not testing this approach before launching to a hundred thousand users globally"
        result = run_watcher_agent(
            _WatcherRiskLLM(),
            chunk=long_chunk,
            role_name="VC",
            role_description="Venture capitalist",
            sensitivity="smart",
        )
        self.assertTrue(result["respond"])

    def test_major_only_sensitivity_blocks_risk(self):
        from app.agents.watcher_agent import run_watcher_agent
        long_chunk = "we are taking a significant risk here by not testing this approach before launching to a hundred thousand users globally"
        result = run_watcher_agent(
            _WatcherRiskLLM(),
            chunk=long_chunk,
            role_name="VC",
            role_description="Venture capitalist",
            sensitivity="major_only",
        )
        self.assertFalse(result["respond"])

    def test_major_only_sensitivity_allows_decision(self):
        from app.agents.watcher_agent import run_watcher_agent
        long_chunk = "okay everyone let us vote right now should we go with option A or move to option B for the entire platform"
        result = run_watcher_agent(
            _WatcherDecisionLLM(),
            chunk=long_chunk,
            role_name="VC",
            role_description="Venture capitalist",
            sensitivity="major_only",
        )
        self.assertTrue(result["respond"])

    def test_no_signal_returns_false(self):
        from app.agents.watcher_agent import run_watcher_agent
        long_chunk = "hey everyone how are you doing today let us just do a quick check in before we get started with the main agenda"
        result = run_watcher_agent(
            _WatcherNoSignalLLM(),
            chunk=long_chunk,
            role_name="VC",
            role_description="Venture capitalist",
            sensitivity="smart",
        )
        self.assertFalse(result["respond"])

    def test_chunk_hash_is_deterministic(self):
        from app.agents.watcher_agent import chunk_hash
        h1 = chunk_hash("hello world meeting transcript")
        h2 = chunk_hash("hello world meeting transcript")
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 16)


class _RoleAgentLLM:
    def __init__(self, **kwargs): pass
    def invoke(self, messages):
        prompt = messages[0].content
        if "Role-Play Agent" in prompt:
            return _FakeLangChainResponse(json.dumps({
                "reply": "As a VC, I see significant execution risk here.",
                "role": "Venture Capitalist",
                "signal_type": "decision",
                "follow_up_questions": ["What is your 12-month NRR?", "Who owns enterprise sales?"],
                "actions": [],
            }))
        return _FakeLangChainResponse(json.dumps({"reply": "ok"}))


class TestRoleAgent(unittest.TestCase):
    def test_returns_required_fields(self):
        from app.agents.role_agent import run_role_agent
        out = run_role_agent(
            _RoleAgentLLM(),
            text="We are deciding to pivot to B2C",
            role_name="Venture Capitalist",
            role_description="Series B investor focused on SaaS metrics and unit economics",
            signal_type="decision",
            context={"memory": {}, "context": {}, "user_name": "Alice"},
        )
        self.assertIn("reply", out)
        self.assertIn("role", out)
        self.assertIn("signal_type", out)
        self.assertIn("follow_up_questions", out)
        self.assertIsInstance(out["follow_up_questions"], list)
        self.assertEqual(out["signal_type"], "decision")

    def test_follow_up_questions_populated(self):
        from app.agents.role_agent import run_role_agent
        out = run_role_agent(
            _RoleAgentLLM(),
            text="We are deciding to pivot",
            role_name="Venture Capitalist",
            role_description="Series B investor focused on SaaS metrics",
            signal_type="decision",
            context={},
        )
        self.assertEqual(len(out["follow_up_questions"]), 2)

    def test_default_signal_type_on_demand(self):
        from app.agents.role_agent import run_role_agent
        out = run_role_agent(
            _RoleAgentLLM(),
            text="Tell me your view",
            role_name="Venture Capitalist",
            role_description="Series B investor focused on SaaS metrics",
            context={},
        )
        self.assertIn("signal_type", out)


from unittest.mock import patch


class _FullFakeLLM:
    """Combined fake that handles all agent prompts including new role variants."""
    def __init__(self, **kwargs): pass
    def invoke(self, messages):
        prompt = messages[0].content
        if "Intent Router" in prompt:
            return _FakeLangChainResponse(json.dumps({"route": "GENERAL"}))
        if "Role-Play Agent" in prompt:
            return _FakeLangChainResponse(json.dumps({
                "reply": "As a VC, here is my take.",
                "role": "Venture Capitalist",
                "signal_type": "entry",
                "follow_up_questions": [],
                "actions": [],
            }))
        if "Role Watcher" in prompt:
            return _FakeLangChainResponse(json.dumps({"respond": True, "signal": "decision"}))
        return _FakeLangChainResponse(json.dumps({"reply": "ok", "intent": "GENERAL", "actions": []}))


@patch("app.orchestrator.settings.groq_api_key", "test-key")
@patch("app.orchestrator.ChatGroq", _FullFakeLLM)
class TestOrchestratorRoleIntegration(unittest.TestCase):
    def setUp(self):
        from app.orchestrator import SESSION_STORE
        SESSION_STORE.clear("u1", "r1")

    def test_exit_role_fast_path_clears_role(self):
        from app.orchestrator import SESSION_STORE, run_execute
        from app.schemas import ExecuteRequest
        SESSION_STORE.set_role("u1", "r1", ActiveRole(
            name="VC", description="Venture capitalist focused on SaaS"
        ))
        req = ExecuteRequest(user_id="u1", room_id="r1", text="Hey Jarvis exit role", source="voice")
        res = run_execute(req)
        self.assertIsNone(SESSION_STORE.get_role("u1", "r1"))
        self.assertEqual(res.ui_event, "ROLE_EXITED")

    def test_play_role_activates_session_state(self):
        from app.orchestrator import SESSION_STORE, run_execute
        from app.schemas import ExecuteRequest
        req = ExecuteRequest(
            user_id="u1", room_id="r1",
            text="act as a venture capitalist",
            source="voice",
        )
        res = run_execute(req)
        role = SESSION_STORE.get_role("u1", "r1")
        self.assertIsNotNone(role)
        self.assertEqual(res.ui_event, "ROLE_ACTIVATED")
        self.assertIn("role_activated", (res.artifacts or {}))

    def test_role_injected_in_system_prompt(self):
        from app.orchestrator import SESSION_STORE, _build_system_prompt
        from app.schemas import ExecuteRequest
        SESSION_STORE.set_role("u1", "r1", ActiveRole(
            name="VC", description="Venture capitalist focused on SaaS"
        ))
        req = ExecuteRequest(user_id="u1", room_id="r1", text="what do you think", source="chat")
        prompt = _build_system_prompt(req)
        self.assertIn("VC", prompt)
        self.assertIn("ACTIVE ROLE", prompt)


from fastapi.testclient import TestClient


@patch("app.main.settings.ai_brain_service_token", "")
@patch("app.orchestrator.settings.groq_api_key", "test-key")
@patch("app.orchestrator.ChatGroq", _FullFakeLLM)
class TestRoleRoutes(unittest.TestCase):
    def setUp(self):
        from app.main import app
        from app.orchestrator import SESSION_STORE
        self.client = TestClient(app)
        SESSION_STORE.clear("u2", "r2")

    def test_role_set_creates_role(self):
        from app.orchestrator import SESSION_STORE
        res = self.client.post("/v1/role/set", json={
            "user_id": "u2", "room_id": "r2",
            "role_name": "Venture Capitalist",
            "role_description": "Series B investor focused on SaaS metrics and unit economics",
            "sensitivity": "smart",
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("reply", data)
        self.assertEqual(data["role_name"], "Venture Capitalist")
        self.assertTrue(data["activated"])
        self.assertIsNotNone(SESSION_STORE.get_role("u2", "r2"))

    def test_role_exit_clears_role(self):
        from app.orchestrator import SESSION_STORE
        SESSION_STORE.set_role("u2", "r2", ActiveRole(
            name="VC", description="Venture capitalist focused on SaaS"
        ))
        res = self.client.post("/v1/role/exit", json={"user_id": "u2", "room_id": "r2"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["deactivated"])
        self.assertIsNone(SESSION_STORE.get_role("u2", "r2"))

    def test_role_watch_no_active_role_returns_false(self):
        res = self.client.post("/v1/role/watch", json={
            "user_id": "u2", "room_id": "r2",
            "transcript_chunk": "We are deciding to pivot to consumer now so let us all vote on this immediately please",
        })
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["respond"])

    def test_role_watch_rate_limit(self):
        from app.orchestrator import SESSION_STORE
        SESSION_STORE.set_role("u2", "r2", ActiveRole(
            name="VC",
            description="Venture capitalist focused on SaaS",
            last_proactive_at=time.time(),
        ))
        res = self.client.post("/v1/role/watch", json={
            "user_id": "u2", "room_id": "r2",
            "transcript_chunk": "We are deciding to pivot to consumer now so let us all vote on this immediately please",
        })
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["respond"])

    def test_role_set_validates_short_description(self):
        res = self.client.post("/v1/role/set", json={
            "user_id": "u2", "room_id": "r2",
            "role_name": "VC",
            "role_description": "short",
        })
        self.assertEqual(res.status_code, 422)
