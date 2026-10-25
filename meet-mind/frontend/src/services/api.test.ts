import { test, expect, vi, afterEach } from 'vitest';

// api.ts reads window.location at import time; vitest runs in plain Node here.
vi.hoisted(() => {
  (globalThis as { window?: unknown }).window = { location: { origin: 'http://test' } };
});

import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

test('listMeetings unwraps the paginated envelope from GET /api/meetings', async () => {
  const meeting = { id: 'm1', roomName: 'a1b2c3d4e5f6', title: 'Sync', status: 'active', createdAt: null, endedAt: null, durationMinutes: null };
  stubFetch({ total: 1, page: 1, limit: 20, pages: 1, meetings: [meeting] });
  expect(await api.listMeetings()).toEqual([meeting]);
});

test('listMeetings returns an empty list when meetings is missing', async () => {
  stubFetch({ total: 0, page: 1, limit: 20, pages: 1 });
  expect(await api.listMeetings()).toEqual([]);
});
