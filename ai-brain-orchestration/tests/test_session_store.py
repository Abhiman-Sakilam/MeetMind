import unittest

from app.session_store import SessionStore


class SessionStoreTests(unittest.TestCase):
    def test_shared_context_chat_and_voice(self):
        store = SessionStore(max_tokens=2000, keep_last_turns=8)
        store.append_turn("u1", "r1", "user", "chat hello")
        store.append_turn("u1", "r1", "assistant", "chat response")
        store.append_turn("u1", "r1", "user", "voice follow up")

        context = store.get_context_window("u1", "r1")
        recent_turns = context["recent_turns"]
        self.assertEqual(len(recent_turns), 3)
        self.assertEqual(recent_turns[-1]["text"], "voice follow up")

    def test_summarize_when_budget_exceeded(self):
        store = SessionStore(max_tokens=30, keep_last_turns=2)
        for idx in range(7):
            store.append_turn("u2", "room", "user", f"long message number {idx} " * 5)
            store.append_turn("u2", "room", "assistant", f"assistant reply number {idx} " * 5)

        context = store.get_context_window("u2", "room")
        self.assertTrue(context["summary"])
        self.assertLessEqual(len(context["recent_turns"]), 2)


if __name__ == "__main__":
    unittest.main()
