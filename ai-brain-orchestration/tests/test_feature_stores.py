import unittest

from app.notes_store import NotesStore
from app.screen_context_store import ScreenContextStore


class FeatureStoresTests(unittest.TestCase):
    def test_notes_store_partition_and_lifecycle(self):
        store = NotesStore()
        store.start("u1", "r1")
        store.append("u1", "r1", "first note")
        store.append("u1", "r1", "second note")
        self.assertTrue(store.get("u1", "r1").active)
        self.assertEqual(len(store.get("u1", "r1").notes), 2)
        self.assertEqual(len(store.get("u2", "r1").notes), 0)
        store.stop("u1", "r1")
        self.assertFalse(store.get("u1", "r1").active)

    def test_screen_context_update_and_retrieve(self):
        store = ScreenContextStore()
        store.update(
            "u1",
            "r1",
            "s1",
            image_base64="abc",
            mime_type="image/png",
            name="shot.png",
            question="what is on screen?",
            answer="A dashboard",
        )
        ctx = store.get("u1", "r1", "s1")
        self.assertEqual(ctx.last_image_base64, "abc")
        self.assertEqual(ctx.last_answer, "A dashboard")
        self.assertEqual(store.get("u1", "r1", "s2").last_image_base64, "")


if __name__ == "__main__":
    unittest.main()
