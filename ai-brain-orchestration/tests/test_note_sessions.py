import json
import unittest

from app.notes_store import NotesState, NoteSession, NotesStore


class NoteSessionShapeTests(unittest.TestCase):
    def test_state_defaults_to_no_sessions_and_inactive(self):
        state = NotesState()
        self.assertFalse(state.active)
        self.assertEqual(state.sessions, [])

    def test_notes_property_aggregates_filtered_across_sessions(self):
        state = NotesState(
            active=False,
            sessions=[
                NoteSession(id="s1", title="A", filtered_notes=[{"text": "x", "section": "", "ts": 1.0}]),
                NoteSession(id="s2", title="B", filtered_notes=[{"text": "y", "section": "", "ts": 2.0}]),
            ],
        )
        texts = [n["text"] for n in state.notes]
        self.assertEqual(texts, ["x", "y"])

    def test_notes_property_falls_back_to_raw_chunks(self):
        state = NotesState(
            active=True,
            sessions=[NoteSession(id="s1", title=None, raw_chunks=["hello", "world"])],
        )
        texts = [n["text"] for n in state.notes]
        self.assertEqual(texts, ["hello", "world"])

    def test_raw_transcript_concatenates_active_session(self):
        state = NotesState(
            active=True,
            sessions=[NoteSession(id="s1", title=None, raw_chunks=["a b", "c"])],
        )
        self.assertEqual(state.raw_transcript(), "a b c")


class NotesStoreLifecycleTests(unittest.TestCase):
    def test_start_creates_new_session_each_time(self):
        store = NotesStore()
        store.start("u1", "r1")
        store.append_raw("u1", "r1", "first")
        store.stop("u1", "r1")
        store.start("u1", "r1")
        store.append_raw("u1", "r1", "second")
        state = store.get("u1", "r1")
        self.assertEqual(len(state.sessions), 2)
        self.assertEqual(state.sessions[0].raw_chunks, ["first"])
        self.assertEqual(state.sessions[1].raw_chunks, ["second"])
        self.assertTrue(state.active)

    def test_append_raw_targets_last_session_only(self):
        store = NotesStore()
        store.start("u1", "r1")
        store.append_raw("u1", "r1", "alpha")
        store.append_raw("u1", "r1", "beta")
        state = store.get("u1", "r1")
        self.assertEqual(state.sessions[-1].raw_chunks, ["alpha", "beta"])

    def test_stop_sets_stopped_at_and_inactive(self):
        store = NotesStore()
        store.start("u1", "r1")
        store.append_raw("u1", "r1", "x")
        before = store.get("u1", "r1").sessions[-1].started_at
        store.stop("u1", "r1")
        state = store.get("u1", "r1")
        self.assertFalse(state.active)
        self.assertIsNotNone(state.sessions[-1].stopped_at)
        self.assertGreaterEqual(state.sessions[-1].stopped_at, before)

    def test_set_filtered_writes_to_last_session(self):
        store = NotesStore()
        store.start("u1", "r1")
        store.append_raw("u1", "r1", "hi there")
        store.set_filtered("u1", "r1", [{"text": "Hi there.", "section": "Intro", "ts": 1.0}])
        state = store.get("u1", "r1")
        self.assertEqual(state.sessions[-1].filtered_notes, [{"text": "Hi there.", "section": "Intro", "ts": 1.0}])


class RedisSerializationTests(unittest.TestCase):
    def test_serialize_round_trip(self):
        store = NotesStore()
        # serialize a state by reaching into the internal helpers via public API
        store.start("u1", "r1")
        store.append_raw("u1", "r1", "hello")
        store.set_filtered("u1", "r1", [{"text": "Hello.", "section": "", "ts": 1.0}])
        store.set_session_title("u1", "r1", "Greeting")
        store.stop("u1", "r1")
        state = store.get("u1", "r1")

        # Use the same shape that _redis_save writes
        from app.notes_store import _state_to_dict, _state_from_dict
        encoded = _state_to_dict(state)
        decoded = _state_from_dict(json.loads(json.dumps(encoded)))
        self.assertEqual(decoded.active, state.active)
        self.assertEqual(len(decoded.sessions), 1)
        self.assertEqual(decoded.sessions[0].title, "Greeting")
        self.assertEqual(decoded.sessions[0].raw_chunks, ["hello"])
        self.assertEqual(decoded.sessions[0].filtered_notes, [{"text": "Hello.", "section": "", "ts": 1.0}])

    def test_legacy_payload_migrates_into_single_session(self):
        from app.notes_store import _state_from_dict
        legacy = {
            "active": False,
            "raw_chunks": ["a", "b"],
            "filtered_notes": [{"text": "A.", "section": "", "ts": 1.0}],
            "updated_at": 123.4,
        }
        decoded = _state_from_dict(legacy)
        self.assertEqual(len(decoded.sessions), 1)
        self.assertEqual(decoded.sessions[0].id, "legacy")
        self.assertEqual(decoded.sessions[0].raw_chunks, ["a", "b"])
        self.assertEqual(decoded.sessions[0].filtered_notes, [{"text": "A.", "section": "", "ts": 1.0}])


if __name__ == "__main__":
    unittest.main()
