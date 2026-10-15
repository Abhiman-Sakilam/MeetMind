import { useRef, useCallback, useEffect } from 'react';
import { useMeetingStore } from '../store/meetingStore';
import { api } from '../services/api';
import type { AssistantMessage } from '../types';

interface UseAutoNotesParams {
  assistantUserId: string;
  effectiveRoomId: string;
  addAssistantMessage: (msg: AssistantMessage) => void;
}

const NOTE_DEBOUNCE_MS = 3000;
const ACTION_EXTRACT_CHUNK_INTERVAL = 15;

const NOISE_PATTERNS = /^(uh+|um+|hmm+|ah+|oh+|er+|like|yeah|so|okay|ok|huh|mhm|right|well|hey|you know)[\s.,!?]*$/i;

function cleanNoteChunk(raw: string): string {
  return raw
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .join(' ')
    .replace(/\s([.,!?;:])/g, '$1')
    .replace(/([.,!?;:]){2,}/g, '$1')
    .trim();
}

function isNoiseOnly(text: string): boolean {
  const cleaned = text.replace(/[.,!?;:\s]+/g, ' ').trim();
  if (cleaned.length < 3) return true;
  const words = cleaned.split(/\s+/);
  if (words.length <= 2 && words.every((w) => NOISE_PATTERNS.test(w))) return true;
  return false;
}

async function extractActionItemsFromTranscript(userId: string, roomId: string, sessionId: string) {
  try {
    const transcript = useMeetingStore.getState().spokenTranscript;
    if (!transcript || transcript.split(' ').length < 20) return;
    const res = await api.assistantExecute({
      user_id: userId,
      room_id: roomId,
      text: 'Extract any action items, decisions, or commitments from the meeting so far.',
      session_id: sessionId || undefined,
      trigger: 'auto',
      source: 'chat',
      context: { transcript_history: transcript.slice(-4000), silent: true },
    });
    if (!res.reply) return;
    const intent = (res.intent || '').toUpperCase();
    if (intent.includes('ACTION') || intent.includes('TASK')) {
      useMeetingStore.getState().setActiveInsight({ type: 'action_items', title: 'Action Items', content: res.reply });
    } else if (intent.includes('DECISION')) {
      useMeetingStore.getState().setActiveInsight({ type: 'decision', title: 'Decisions', content: res.reply });
    }
  } catch {
    // silent — don't disturb the user for background extraction failures
  }
}

export function useAutoNotes({
  assistantUserId,
  effectiveRoomId,
  addAssistantMessage,
}: UseAutoNotesParams) {
  const notesModeActiveRef = useRef(false);
  const lastAutoNoteChunkRef = useRef('');
  const autoNoteFailCountRef = useRef(0);
  const pendingNoteChunksRef = useRef<string[]>([]);
  const noteFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunkCountRef = useRef(0);

  const flushNoteChunks = useCallback(async () => {
    const chunks = pendingNoteChunksRef.current;
    pendingNoteChunksRef.current = [];
    if (!chunks.length || !effectiveRoomId) return;
    const raw = chunks.join(' ').trim();
    const text = cleanNoteChunk(raw);
    if (!text || isNoiseOnly(text) || text === lastAutoNoteChunkRef.current) return;
    lastAutoNoteChunkRef.current = text;
    try {
      const res = await api.notesAppendRaw({
        user_id: assistantUserId,
        room_id: effectiveRoomId,
        text,
      });
      autoNoteFailCountRef.current = 0;
      useMeetingStore.getState().appendSpokenTranscript(text);
      if (res.chunk_count > 0 && notesModeActiveRef.current) {
        useMeetingStore.getState().appendNoteItem({ text, ts: Date.now() });
      }
      // Periodically extract action items and decisions from transcript
      chunkCountRef.current += 1;
      if (chunkCountRef.current % ACTION_EXTRACT_CHUNK_INTERVAL === 0 && effectiveRoomId) {
        void extractActionItemsFromTranscript(assistantUserId, effectiveRoomId, '');
      }
    } catch {
      autoNoteFailCountRef.current += 1;
      if (autoNoteFailCountRef.current === 3) {
        addAssistantMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: 'Auto-note capture is having trouble reaching the AI brain. Notes may be incomplete.',
          timestamp: new Date(),
          type: 'text',
        });
      }
    }
  }, [addAssistantMessage, assistantUserId, effectiveRoomId]); // sessionIdRef intentionally omitted — always passing '' for background extraction

  const submitAutoNoteChunk = useCallback(
    (chunk: string) => {
      const text = cleanNoteChunk(chunk);
      if (!text || isNoiseOnly(text)) return;
      pendingNoteChunksRef.current.push(text);
      if (noteFlushTimerRef.current) clearTimeout(noteFlushTimerRef.current);
      noteFlushTimerRef.current = setTimeout(() => { void flushNoteChunks(); }, NOTE_DEBOUNCE_MS);
    },
    [flushNoteChunks],
  );

  const setNotesModeActive = useCallback((active: boolean) => {
    notesModeActiveRef.current = active;
    lastAutoNoteChunkRef.current = '';
    autoNoteFailCountRef.current = 0;
    if (!active) {
      pendingNoteChunksRef.current = [];
      if (noteFlushTimerRef.current) {
        clearTimeout(noteFlushTimerRef.current);
        noteFlushTimerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (noteFlushTimerRef.current) {
        clearTimeout(noteFlushTimerRef.current);
      }
    };
  }, []);

  return {
    notesModeActiveRef,
    submitAutoNoteChunk,
    setNotesModeActive,
  };
}
