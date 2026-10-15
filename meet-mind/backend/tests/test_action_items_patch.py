import asyncio
import unittest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import init_db, engine
from app.models import Meeting, ActionItem
from app.database import async_session


class ActionItemsPatchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await init_db()
        # Seed a meeting and an action item
        async with async_session() as db:
            self.meeting = Meeting(room_name="patch-test-room", title="Test")
            db.add(self.meeting)
            await db.flush()
            self.item = ActionItem(meeting_id=self.meeting.id, title="Send Q4 deck", status="pending")
            db.add(self.item)
            await db.commit()
            await db.refresh(self.item)
            self.item_id = self.item.id

    async def test_happy_path_completes_item(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.patch(
                f"/api/meetings/patch-test-room/action_items/{self.item_id}",
                json={"status": "completed"},
            )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "completed")

    async def test_bad_status_returns_400(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.patch(
                f"/api/meetings/patch-test-room/action_items/{self.item_id}",
                json={"status": "weird"},
            )
        self.assertEqual(r.status_code, 400)

    async def test_wrong_meeting_returns_404(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.patch(
                f"/api/meetings/does-not-exist/action_items/{self.item_id}",
                json={"status": "completed"},
            )
        self.assertEqual(r.status_code, 404)

    async def test_wrong_item_returns_404(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.patch(
                "/api/meetings/patch-test-room/action_items/does-not-exist",
                json={"status": "completed"},
            )
        self.assertEqual(r.status_code, 404)


if __name__ == "__main__":
    unittest.main()
