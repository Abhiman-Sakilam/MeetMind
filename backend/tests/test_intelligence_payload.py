import unittest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import init_db, async_session
from app.models import Meeting, Note


class IntelligencePayloadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await init_db()
        async with async_session() as db:
            self.meeting = Meeting(
                room_name="intel-test-room",
                title="Test",
                topics=["Q4 Planning", "Vision 2027"],
                keywords=["marketing", "pricing"],
            )
            db.add(self.meeting)
            await db.flush()
            db.add(Note(meeting_id=self.meeting.id, content="Point A", type="key_point:Marketing",
                        session_id="s1", session_title="Q4 Marketing Strategy"))
            db.add(Note(meeting_id=self.meeting.id, content="Point B", type="key_point:Marketing",
                        session_id="s1", session_title="Q4 Marketing Strategy"))
            db.add(Note(meeting_id=self.meeting.id, content="Old point", type="key_point"))  # no session
            await db.commit()

    async def test_response_includes_topics_keywords_and_session_fields_on_notes(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/meetings/intel-test-room/intelligence")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["topics"], ["Q4 Planning", "Vision 2027"])
        self.assertEqual(body["keywords"], ["marketing", "pricing"])

        notes = body["notes"]
        with_session = [n for n in notes if n.get("session_id")]
        self.assertEqual(len(with_session), 2)
        self.assertEqual(with_session[0]["session_id"], "s1")
        self.assertEqual(with_session[0]["session_title"], "Q4 Marketing Strategy")
        # legacy note has null session_id
        legacy = [n for n in notes if not n.get("session_id")]
        self.assertEqual(len(legacy), 1)


if __name__ == "__main__":
    unittest.main()
