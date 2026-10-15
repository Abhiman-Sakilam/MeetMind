import { useRef, useCallback, useEffect } from 'react';
import { useMeetingStore } from '../store/meetingStore';
import { api } from '../services/api';
import type { AssistantMessage, ActiveRole } from '../types';

const WATCH_INTERVAL_MS = 12_000;
/** Consecutive watch failures before we tell the user the role is degraded. */
const DEGRADED_AFTER_FAILURES = 3;

function roleChunkHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

interface UseRoleModeParams {
  assistantUserId: string;
  effectiveRoomId: string;
  addAssistantMessage: (msg: AssistantMessage) => void;
}

export function useRoleMode({
  assistantUserId,
  effectiveRoomId,
  addAssistantMessage,
}: UseRoleModeParams) {
  const activeRole = useMeetingStore((s) => s.activeRole);
  const transcriptBufferRef = useRef<string[]>([]);
  const lastHashRef = useRef('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failCountRef = useRef(0);
  const degradedNotifiedRef = useRef(false);

  // Re-sync with the brain once on mount — fixes "ghost role" where a page
  // reload drops the local badge while the brain still holds the role.
  useEffect(() => {
    if (!effectiveRoomId) return;
    let cancelled = false;
    void api.roleState(assistantUserId, effectiveRoomId).then((res) => {
      if (cancelled) return;
      const store = useMeetingStore.getState();
      if (res.active && !store.activeRole) {
        const sensitivity: ActiveRole['sensitivity'] =
          res.sensitivity === 'major_only' || res.sensitivity === 'frequent'
            ? res.sensitivity
            : 'smart';
        store.setActiveRole({
          name: res.role_name,
          description: res.role_description,
          sensitivity,
        });
      } else if (!res.active && store.activeRole) {
        store.clearActiveRole();
      }
    }).catch(() => {
      // Best-effort sync — brain may be briefly unavailable on mount.
    });
    return () => { cancelled = true; };
  }, [assistantUserId, effectiveRoomId]);

  const submitRoleChunk = useCallback((chunk: string) => {
    if (!useMeetingStore.getState().activeRole) return;
    const trimmed = chunk.trim();
    if (!trimmed) return;
    transcriptBufferRef.current.push(trimmed);
    const joined = transcriptBufferRef.current.join(' ');
    const words = joined.split(/\s+/);
    if (words.length > 500) {
      transcriptBufferRef.current = [words.slice(-400).join(' ')];
    }
  }, []);

  const tick = useCallback(async () => {
    const role = useMeetingStore.getState().activeRole;
    if (!role || !effectiveRoomId) return;
    const chunk = transcriptBufferRef.current.join(' ').trim();
    if (!chunk) return;
    const h = roleChunkHash(chunk);
    if (h === lastHashRef.current) return;
    lastHashRef.current = h;
    try {
      const res = await api.roleWatch({
        user_id: assistantUserId,
        room_id: effectiveRoomId,
        transcript_chunk: chunk,
      });
      failCountRef.current = 0;
      degradedNotifiedRef.current = false;
      if (res.respond && res.reply) {
        addAssistantMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: res.reply,
          timestamp: new Date(),
          type: 'role',
          role_name: res.role_name ?? role.name,
          signal_type: res.signal ?? 'on-demand',
          follow_up_questions: res.follow_up_questions ?? [],
        });
      }
    } catch {
      // Surface persistent failures once instead of silently doing nothing —
      // otherwise the user believes the role is listening when it isn't.
      failCountRef.current += 1;
      if (failCountRef.current >= DEGRADED_AFTER_FAILURES && !degradedNotifiedRef.current) {
        degradedNotifiedRef.current = true;
        addAssistantMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: `🎭 ${role.name} can't reach the AI Brain right now — proactive interjections are paused. The role will resume automatically when the connection recovers.`,
          timestamp: new Date(),
          type: 'text',
        });
      }
    }
  }, [addAssistantMessage, assistantUserId, effectiveRoomId]);

  useEffect(() => {
    if (activeRole) {
      intervalRef.current = setInterval(() => { void tick(); }, WATCH_INTERVAL_MS);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      transcriptBufferRef.current = [];
      lastHashRef.current = '';
      failCountRef.current = 0;
      degradedNotifiedRef.current = false;
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [activeRole, tick]);

  return { submitRoleChunk };
}
