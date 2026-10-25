import unittest

import httpx

from app import elevenlabs_client, stt, tts
from app.config import Settings, settings


def _install_mock(handler):
    elevenlabs_client._client = httpx.AsyncClient(
        base_url="https://api.elevenlabs.io/v1",
        transport=httpx.MockTransport(handler),
    )


class ProviderResolutionTests(unittest.TestCase):
    def test_auto_uses_elevenlabs_when_key_set(self):
        s = Settings(elevenlabs_api_key="sk_test", stt_provider="auto", tts_provider="auto")
        self.assertEqual((s.stt_provider, s.tts_provider), ("elevenlabs", "elevenlabs"))

    def test_auto_falls_back_to_local_without_key(self):
        s = Settings(elevenlabs_api_key="", stt_provider="auto", tts_provider="auto")
        self.assertEqual((s.stt_provider, s.tts_provider), ("local", "local"))

    def test_explicit_local_wins_over_key(self):
        s = Settings(elevenlabs_api_key="sk_test", stt_provider="LOCAL", tts_provider="elevenlabs")
        self.assertEqual((s.stt_provider, s.tts_provider), ("local", "elevenlabs"))


class ElevenLabsVoiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._saved = (settings.stt_provider, settings.tts_provider)
        settings.stt_provider = "elevenlabs"
        settings.tts_provider = "elevenlabs"

    async def asyncTearDown(self):
        settings.stt_provider, settings.tts_provider = self._saved
        await elevenlabs_client.aclose()

    async def test_stt_sends_audio_and_keyterms(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["path"] = request.url.path
            seen["body"] = request.read()
            return httpx.Response(200, json={"text": " Hey Jarvis, summarize. "})

        _install_mock(handler)
        text = await stt.transcribe_audio_bytes(b"OPUSDATA", ".webm")
        self.assertEqual(text, "Hey Jarvis, summarize.")
        self.assertEqual(seen["path"], "/v1/speech-to-text")
        self.assertIn(b"OPUSDATA", seen["body"])
        self.assertIn(settings.elevenlabs_stt_model.encode(), seen["body"])
        self.assertIn(b"Hey Jarvis", seen["body"])

    async def test_stt_auth_error_maps_to_stt_error(self):
        _install_mock(lambda r: httpx.Response(401, json={"detail": "bad key"}))
        with self.assertRaises(stt.STTError) as ctx:
            await stt.transcribe_audio_bytes(b"x", ".webm")
        self.assertIn("ELEVENLABS_API_KEY", str(ctx.exception))

    async def test_tts_returns_mp3(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertTrue(request.url.path.endswith(f"/text-to-speech/{settings.elevenlabs_voice_id}"))
            return httpx.Response(200, content=b"ID3mp3")

        _install_mock(handler)
        self.assertEqual(await tts.synthesize("Hello there."), b"ID3mp3")
        self.assertEqual(tts.tts_media_type(), "audio/mpeg")

    async def test_tts_quota_error_maps_to_tts_error(self):
        _install_mock(lambda r: httpx.Response(429, text="quota"))
        with self.assertRaises(tts.TTSError):
            await tts.synthesize("Hello")

    async def test_cloud_status_needs_no_model_load(self):
        self.assertTrue(stt.is_model_loaded())
        warm = await stt.warmup_model()
        self.assertEqual(warm["device"], "elevenlabs")
        self.assertEqual(tts.tts_status()["status"], "ok")
        self.assertTrue(tts.is_tts_available())


if __name__ == "__main__":
    unittest.main()
