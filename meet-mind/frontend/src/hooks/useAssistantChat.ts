import { useState, useRef, useCallback, useEffect } from 'react';
import { useMeetingStore } from '../store/meetingStore';
import { api, ApiError } from '../services/api';
import type { AssistantMessage } from '../types';

type BrainStatus = 'checking' | 'ok' | 'offline';

function sanitizeAssistantReplyText(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  return t.replace(/\n+_[A-Z0-9_]+_\s*$/i, '').trim();
}

function stripMarkdownForTts(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')       // code fences
    .replace(/`[^`]*`/g, '')              // inline code
    .replace(/#{1,6}\s+/g, '')            // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1')   // bold
    .replace(/\*([^*]+)\*/g, '$1')       // italic
    .replace(/~~([^~]+)~~/g, '$1')       // strikethrough
    .replace(/^\s*[-*+]\s+/gm, '')       // bullet list markers
    .replace(/^\s*\d+\.\s+/gm, '')       // ordered list markers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text only
    .replace(/[•·‣▸▹◦]/g, '')           // unicode bullets
    .replace(/\n{2,}/g, '. ')            // paragraph breaks → pause
    .replace(/\n/g, ' ')                 // remaining newlines
    .replace(/\s{2,}/g, ' ')             // collapse whitespace
    .trim();
}

/** Phrases aligned with ai-brain-orchestration screen routing (+ common variants). */
function matchesScreenCaptureIntent(text: string): boolean {
  const lower = text.toLowerCase();
  const phrases = [
    'screenshot',
    'screen shot',
    'screen analysis',
    'analyze the screen',
    'analyze my screen',
    'check the screen',
    'check my screen',
    'look at the screen',
    'look at my screen',
    'what is on the screen',
    "what's on the screen",
    'whats on the screen',
    'what do you see on the screen',
  ];
  return phrases.some((p) => lower.includes(p));
}

async function captureFrameFromMediaStream(stream: MediaStream): Promise<Blob> {
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== 'live') {
    throw new Error('No live video track on stream.');
  }
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  await new Promise<void>((resolve) => {
    if (video.readyState >= 2) resolve();
    else video.onloadeddata = () => resolve();
  });
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot capture screenshot canvas context.');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) throw new Error('Could not encode screenshot.');
  return blob;
}

function normalizeNotesFromArtifacts(
  notes: unknown,
): { text: string; ts: number }[] {
  if (!Array.isArray(notes)) return [];
  return notes
    .map((n) => {
      if (!n || typeof n !== 'object') return null;
      const text = typeof (n as { text?: unknown }).text === 'string' ? (n as { text: string }).text : '';
      const tsRaw = (n as { ts?: unknown }).ts;
      let ts: number;
      if (typeof tsRaw === 'number' && !Number.isNaN(tsRaw)) {
        ts = tsRaw;
      } else {
        const coerced = Number(tsRaw);
        ts = Number.isFinite(coerced) ? coerced : Date.now();
      }
      return text ? { text, ts } : null;
    })
    .filter((n): n is { text: string; ts: number } => Boolean(n));
}

let _ttsAudio: HTMLAudioElement | null = null;
let _ttsWarned = false;

function canUseBrowserSpeech(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

function speakWithBrowserTts(text: string) {
  if (!canUseBrowserSpeech()) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  u.pitch = 1;
  u.volume = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export function stopTts() {
  if (_ttsAudio) {
    _ttsAudio.pause();
    _ttsAudio.currentTime = 0;
    if (_ttsAudio.src) URL.revokeObjectURL(_ttsAudio.src);
    _ttsAudio = null;
  }
  if (canUseBrowserSpeech()) {
    window.speechSynthesis.cancel();
  }
}

useMeetingStore.subscribe((state, prevState) => {
  if (prevState.ttsEnabled && !state.ttsEnabled) stopTts();
});

function playTts(text: string) {
  if (!text.trim()) return;
  if (!useMeetingStore.getState().ttsEnabled) return;
  const ttsText = stripMarkdownForTts(text);
  if (!ttsText) return;
  // Only speak the introductory sentence(s); the full reply is shown in chat
  const sentences = ttsText.match(/[^.!?]+[.!?]+/g) || [ttsText];
  const spoken = sentences.slice(0, 2).join(' ').trim() || ttsText.slice(0, 200);
  api.ttsSynthesize(spoken).then((blob) => {
    if (!blob) {
      if (canUseBrowserSpeech()) {
        speakWithBrowserTts(spoken);
      } else if (!_ttsWarned) {
        _ttsWarned = true;
        useMeetingStore.getState().addAssistantMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: 'TTS backend is unavailable and browser speech is not supported in this browser.',
          timestamp: new Date(),
          type: 'text',
        });
      }
      return;
    }
    if (!useMeetingStore.getState().ttsEnabled) return;
    stopTts();
    const url = URL.createObjectURL(blob);
    _ttsAudio = new Audio(url);
    _ttsAudio.play().catch(() => {
      // Browser blocked autoplay or audio output failed; fallback to SpeechSynthesis.
      if (canUseBrowserSpeech()) {
        speakWithBrowserTts(text);
      }
    });
    _ttsAudio.onended = () => URL.revokeObjectURL(url);
  }).catch(() => {});
}

type LocalCommandType = 'mute_mic' | 'unmute_mic' | 'stop_camera' | 'start_camera' | 'start_recording' | 'stop_recording' | 'voice_off';

export function detectLocalCommand(text: string): LocalCommandType | null {
  const t = text.toLowerCase().trim();
  if (/\b(mute\s+(my\s+)?(mic|microphone)|mute\s+me)\b/.test(t)) return 'mute_mic';
  if (/\b(unmute\s+(my\s+)?(mic|microphone)|unmute\s+me)\b/.test(t)) return 'unmute_mic';
  if (/\b(stop|turn\s+off|disable)\s+(my\s+)?(camera|video)\b/.test(t)) return 'stop_camera';
  if (/\b(start|turn\s+on|enable)\s+(my\s+)?(camera|video)\b/.test(t)) return 'start_camera';
  if (/\b(start\s+recording|record\s+(the\s+)?meeting)\b/.test(t)) return 'start_recording';
  if (/\b(stop\s+recording)\b/.test(t)) return 'stop_recording';
  if (/\b(turn\s+off\s+(voice\s+ai|jarvis)|disable\s+voice\s+ai|stop\s+listening)\b/.test(t)) return 'voice_off';
  return null;
}

export function executeLocalCommand(
  cmd: LocalCommandType,
  addMessage: (msg: import('../types').AssistantMessage) => void,
) {
  const store = useMeetingStore.getState();
  const reply = (text: string) =>
    addMessage({ id: crypto.randomUUID(), role: 'assistant', content: text, timestamp: new Date(), type: 'text' });

  switch (cmd) {
    case 'mute_mic':
      if (!store.isMuted) store.toggleMute();
      reply('Microphone muted.');
      break;
    case 'unmute_mic':
      if (store.isMuted) store.toggleMute();
      reply('Microphone unmuted.');
      break;
    case 'stop_camera':
      if (!store.isVideoOff) store.toggleVideo();
      reply('Camera turned off.');
      break;
    case 'start_camera':
      if (store.isVideoOff) store.toggleVideo();
      reply('Camera turned on.');
      break;
    case 'start_recording':
      store.setRecording(true);
      reply('Recording started.');
      break;
    case 'stop_recording':
      store.setRecording(false);
      reply('Recording stopped.');
      break;
    case 'voice_off':
      store.setVoiceAiMode(false);
      reply('Voice AI turned off. You can re-enable it from the toolbar.');
      break;
  }
}

interface UseAssistantChatParams {
  assistantUserId: string;
  effectiveRoomId: string;
  addAssistantMessage: (msg: AssistantMessage) => void;
  isAssistantOpen: boolean;
  setNotesModeActive: (active: boolean) => void;
}

export function useAssistantChat({
  assistantUserId,
  effectiveRoomId,
  addAssistantMessage,
  isAssistantOpen,
  setNotesModeActive,
}: UseAssistantChatParams) {
  const { userName, persona } = useMeetingStore();

  const [isChatSending, setIsChatSending] = useState(false);
  const [brainStatus, setBrainStatus] = useState<BrainStatus>('checking');
  const sessionIdRef = useRef(crypto.randomUUID());
  const sttWarmupStartedRef = useRef(false);

  const applyAssistantUiResponse = useCallback(
    (res: {
      ui_event?: string | null;
      notes_state?: 'on' | 'off' | null;
      artifacts?: Record<string, unknown> | null;
      intent?: string | null;
      reply?: string;
    }) => {
      if (res.notes_state === 'on') setNotesModeActive(true);
      if (res.notes_state === 'off') setNotesModeActive(false);
      const ui = res.ui_event || '';
      if (ui === 'NOTES_OPEN') {
        useMeetingStore.getState().openNotesPanel();
        const notesRaw = res.artifacts?.notes;
        if (Array.isArray(notesRaw)) {
          useMeetingStore.getState().setNotesItems(normalizeNotesFromArtifacts(notesRaw));
        }
      } else if (ui === 'NOTES_CLOSE') {
        useMeetingStore.getState().closeNotesPanel();
      } else if (ui === 'NOTES_UPDATE') {
        const notesRaw = res.artifacts?.notes;
        if (Array.isArray(notesRaw)) {
          useMeetingStore.getState().setNotesItems(normalizeNotesFromArtifacts(notesRaw));
          if (res.artifacts?.cleaned) {
            useMeetingStore.getState().setNotesCleaned(true);
          }
        } else {
          const note = typeof res.artifacts?.note === 'string' ? res.artifacts.note : '';
          if (note) {
            useMeetingStore.getState().appendNoteItem({ text: note, ts: Date.now() });
          }
        }
      } else if (ui === 'NOTES_RAW_CHUNK') {
        const chunk = typeof res.artifacts?.raw_chunk === 'string' ? res.artifacts.raw_chunk : '';
        if (chunk) {
          useMeetingStore.getState().appendNoteItem({ text: chunk, ts: Date.now() });
        }
      } else if (ui === 'ROLE_ACTIVATED') {
        const roleData = res.artifacts?.role_activated as
          | { name: string; description: string; sensitivity: string }
          | undefined;
        if (roleData?.name) {
          const sensitivity =
            roleData.sensitivity === 'major_only' || roleData.sensitivity === 'frequent'
              ? roleData.sensitivity
              : 'smart';
          useMeetingStore.getState().setActiveRole({
            name: roleData.name,
            description: roleData.description,
            sensitivity,
          });
        }
      } else if (ui === 'ROLE_EXITED') {
        useMeetingStore.getState().clearActiveRole();
      }

      // Show structured insight overlay for action items, summary, brainstorm, decision
      const intent = (res.intent || '').toUpperCase();
      const reply = res.reply || '';
      if (reply) {
        if (intent.includes('ACTION') || intent.includes('TASK')) {
          useMeetingStore.getState().setActiveInsight({ type: 'action_items', title: 'Action Items', content: reply });
        } else if (intent.includes('SUMMARY') || intent.includes('FINALIZE')) {
          useMeetingStore.getState().setActiveInsight({ type: 'summary', title: 'Meeting Summary', content: reply });
        } else if (intent.includes('BRAINSTORM')) {
          useMeetingStore.getState().setActiveInsight({ type: 'brainstorm', title: 'Brainstorm Ideas', content: reply });
        } else if (intent.includes('DECISION')) {
          useMeetingStore.getState().setActiveInsight({ type: 'decision', title: 'Decision Analysis', content: reply });
        }
      }
    },
    [setNotesModeActive],
  );

  const checkBrain = useCallback(async () => {
    setBrainStatus('checking');
    try {
      await api.assistantBrainHealth();
      setBrainStatus('ok');
    } catch {
      setBrainStatus('offline');
    }
  }, []);

  useEffect(() => {
    if (isAssistantOpen) void checkBrain();
  }, [isAssistantOpen, checkBrain]);

  useEffect(() => {
    if (!isAssistantOpen) return;
    if (sttWarmupStartedRef.current) return;
    sttWarmupStartedRef.current = true;

    const warmup = async () => {
      try {
        const stt = await api.assistantSttStatus();
        if (stt.loaded) return;
        const configured = (stt.device || 'cpu').toLowerCase();
        const isLarge =
          (stt.model || '').includes('large') || (stt.model || '').includes('Large');
        const timeHint = isLarge
          ? 'First-time download can take 10–30+ minutes without a Hugging Face token (rate limits). Leave this tab open.'
          : 'First load is often 1–5 minutes (download + init).';
        const prepHint =
          configured === 'cuda'
            ? `Preparing voice model on GPU… ${timeHint} (If the stack is CPU-only Docker, the server falls back to CPU automatically.)`
            : `Preparing voice model… ${timeHint}`;
        addAssistantMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: prepHint,
          timestamp: new Date(),
          type: 'text',
        });
        const warm = await api.assistantSttWarmup();
        const ranOn = warm.device || stt.runtime_device || configured;
        addAssistantMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: `Voice model is ready (running on ${ranOn}).`,
          timestamp: new Date(),
          type: 'text',
        });
      } catch (e) {
        const detail =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Unknown error';
        addAssistantMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: `Voice model warmup failed: ${detail}. If you use Docker without NVIDIA GPU support, set STT_DEVICE=cpu in .env or add docker-compose.gpu.yml. Smaller models (e.g. distil-medium.en) need less RAM.`,
          timestamp: new Date(),
          type: 'text',
        });
      }
    };

    void warmup();
  }, [isAssistantOpen, addAssistantMessage]);

  const captureScreenshotBlob = useCallback(async (): Promise<Blob> => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' } as MediaTrackConstraints,
      audio: false,
    });
    try {
      return await captureFrameFromMediaStream(stream);
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }, []);

  const resolveScreenshotBlob = useCallback(async (): Promise<Blob> => {
    const ss = useMeetingStore.getState().screenStream;
    if (ss?.getVideoTracks().some((t) => t.readyState === 'live')) {
      return captureFrameFromMediaStream(ss);
    }
    return captureScreenshotBlob();
  }, [captureScreenshotBlob]);

  const deliverScreenAnalyzeResult = useCallback(
    async (screenshot: Blob, question: string, filename: string) => {
      const res = await api.assistantScreenAnalyze({
        screenshot,
        filename,
        user_id: assistantUserId,
        room_id: effectiveRoomId,
        user_name: userName || 'Guest',
        question,
        session_id: sessionIdRef.current,
      });
      const screenReply = sanitizeAssistantReplyText(
        typeof res.reply === 'string' ? res.reply : '',
      );
      addAssistantMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: screenReply,
        timestamp: new Date(),
        type: 'text',
      });
      applyAssistantUiResponse(res);
      if (screenReply) playTts(screenReply);
    },
    [addAssistantMessage, assistantUserId, effectiveRoomId, applyAssistantUiResponse, userName],
  );

  const maybeRunScreenCommand = useCallback(
    async (text: string): Promise<boolean> => {
      if (!matchesScreenCaptureIntent(text)) return false;
      if (!effectiveRoomId) return false;
      let screenshot: Blob;
      try {
        screenshot = await resolveScreenshotBlob();
      } catch {
        return false;
      }
      await deliverScreenAnalyzeResult(screenshot, text, 'wake-screenshot.png');
      return true;
    },
    [effectiveRoomId, resolveScreenshotBlob, deliverScreenAnalyzeResult],
  );

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || isChatSending) return;
    if (!effectiveRoomId) {
      addAssistantMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: 'No room id — cannot reach the assistant.',
        timestamp: new Date(),
        type: 'text',
      });
      return;
    }

    const userMsg: AssistantMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date(),
      type: 'text',
    };
    addAssistantMessage(userMsg);

    // Handle local Jarvis commands before marking as sending — no spinner flash
    const localCommand = detectLocalCommand(text);
    if (localCommand) {
      executeLocalCommand(localCommand, addAssistantMessage);
      return;
    }

    setIsChatSending(true);
    try {
      if (await maybeRunScreenCommand(text)) {
        setBrainStatus('ok');
        return; // finally will still run
      }
      const storeState = useMeetingStore.getState();
      const startTime = storeState.startTime;
      const durationMin = startTime ? Math.floor((Date.now() - startTime.getTime()) / 60000) : undefined;
      const res = await api.assistantExecute({
        user_id: assistantUserId,
        room_id: effectiveRoomId,
        user_name: userName || 'Guest',
        text,
        session_id: sessionIdRef.current,
        source: 'chat',
        trigger: 'manual',
        persona,
        context: {
          response_style: 'auto',
          persona: storeState.persona,
          meeting_title: storeState.meetingTitle,
          participants: Array.from(storeState.participants.values()).map((p) => p.name),
          duration_min: durationMin,
          notes_active: storeState.notesPanelOpen,
          transcript_history: storeState.spokenTranscript ? storeState.spokenTranscript.slice(-4000) : undefined,
        },
      });

      const replyText = sanitizeAssistantReplyText(
        typeof res.reply === 'string' ? res.reply : '',
      );
      const content =
        replyText ||
        '(No reply text from Jarvis — check AI Brain logs and OPENAI_API_KEY.)';

      addAssistantMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        timestamp: new Date(),
        type: 'text',
      });
      applyAssistantUiResponse(res);
      if (replyText) playTts(replyText);
      setBrainStatus('ok');
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Request failed';
      addAssistantMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: `Assistant error: ${msg}. If you use Docker, set AI_BRAIN_BASE_URL on the backend and ensure the brain is running.`,
        timestamp: new Date(),
        type: 'text',
      });
      void checkBrain();
    } finally {
      setIsChatSending(false);
    }
  }, [isChatSending, effectiveRoomId, assistantUserId, userName, addAssistantMessage, maybeRunScreenCommand, applyAssistantUiResponse, checkBrain]);

  const sendPersonaSwitchAnnouncement = useCallback(
    async (newPersona: string) => {
      try {
        const res = await api.assistantExecute({
          user_id: assistantUserId,
          room_id: effectiveRoomId,
          user_name: userName,
          text: `__persona_switch_to_${newPersona}__`,
          session_id: sessionIdRef.current,
          trigger: 'persona_switch',
          source: 'chat',
          persona: newPersona,
        });
        if (res.reply) {
          addAssistantMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: res.reply,
            timestamp: new Date(),
            type: 'text',
          });
          playTts(res.reply);
        }
      } catch {
        // Announcement failure is non-critical
      }
    },
    [assistantUserId, effectiveRoomId, userName, addAssistantMessage],
  );

  return {
    isChatSending,
    brainStatus,
    setBrainStatus,
    sessionIdRef,
    checkBrain,
    applyAssistantUiResponse,
    maybeRunScreenCommand,
    handleSend,
    sanitizeAssistantReplyText,
    playTts,
    sendPersonaSwitchAnnouncement,
  };
}
