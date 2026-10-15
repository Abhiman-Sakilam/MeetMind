import { useRef, useCallback, useEffect } from 'react';
import { useMeetingStore } from '../store/meetingStore';
import {
  matchWake,
  wakeOccurrenceKey,
  wakeRetryDelayMs,
  getSpeechRecognitionCtor,
} from '../lib/wakeWord';
import { finalizedTextFromSpeechEvent, filterTranscriptNoise } from '../lib/transcriptDisplay';
import { stopTts } from './useAssistantChat';
import type { AssistantMessage } from '../types';

interface UseWakeWordParams {
  addAssistantMessage: (msg: AssistantMessage) => void;
  setVoiceAiMode: (enabled: boolean) => void;
  submitAutoNoteChunk: (chunk: string) => void;
  startVoiceRecordingRef: React.RefObject<() => Promise<void>>;
  isRecordingVoiceRef: React.MutableRefObject<boolean>;
  voiceAiMode: boolean;
}

export function useWakeWord({
  addAssistantMessage,
  setVoiceAiMode,
  submitAutoNoteChunk,
  startVoiceRecordingRef,
  isRecordingVoiceRef,
  voiceAiMode,
}: UseWakeWordParams) {
  const wakeRecognitionRef = useRef<SpeechRecognition | null>(null);
  const wakeCooldownUntilRef = useRef(0);
  const lastWakeKeyRef = useRef('');
  const wakeErrorAttemptsRef = useRef(0);
  const wakePausedForVoiceRef = useRef(false);
  const wakeRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeWordListeningRef = useRef(false);
  const scheduleWakeRestartRef = useRef<() => void>(() => {});

  useEffect(() => {
    wakeWordListeningRef.current = voiceAiMode;
  }, [voiceAiMode]);

  const clearWakeRestartTimer = useCallback(() => {
    if (wakeRestartTimerRef.current) {
      clearTimeout(wakeRestartTimerRef.current);
      wakeRestartTimerRef.current = null;
    }
  }, []);

  const stopWakeRecognition = useCallback(() => {
    clearWakeRestartTimer();
    const r = wakeRecognitionRef.current;
    wakeRecognitionRef.current = null;
    if (!r) return;
    try {
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      r.stop();
    } catch {
      try {
        r.abort();
      } catch {
        /* ignore */
      }
    }
  }, [clearWakeRestartTimer]);

  // Wake stays alive across meeting-recording and notes modes; only command
  // capture (isRecordingVoiceRef) and explicit pause suspend it.
  const scheduleWakeRestart = useCallback(() => {
    clearWakeRestartTimer();
    if (
      !wakeWordListeningRef.current ||
      wakePausedForVoiceRef.current ||
      isRecordingVoiceRef.current
    ) {
      return;
    }
    wakeRestartTimerRef.current = setTimeout(() => {
      wakeRestartTimerRef.current = null;
      if (
        !wakeWordListeningRef.current ||
        wakePausedForVoiceRef.current ||
        isRecordingVoiceRef.current
      ) {
        return;
      }
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) return;
      const r = new Ctor();
      r.continuous = true;
      r.interimResults = true;
      r.lang = 'en-US';
      r.onresult = (event: SpeechRecognitionEvent) => {
        if (!wakeWordListeningRef.current) return;
        // Only use the last few results so "Hey Jarvis" isn't pushed out of the detection window
        // during long note-taking sessions where event.results accumulates indefinitely.
        let heard = '';
        const recentStart = Math.max(0, event.results.length - 6);
        for (let i = recentStart; i < event.results.length; i++) {
          heard += event.results[i][0].transcript;
        }
        const heardTrim = heard.trim();
        let finalizedChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result.isFinal) continue;
          finalizedChunk += ` ${result[0].transcript}`;
        }
        finalizedChunk = finalizedChunk.trim();
        let hasFinalInBatch = false;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            hasFinalInBatch = true;
            break;
          }
        }
        if (!wakePausedForVoiceRef.current && !isRecordingVoiceRef.current) {
          const finalizedLine = finalizedTextFromSpeechEvent(event);
          const display = finalizedLine ? filterTranscriptNoise(finalizedLine) : '';
          useMeetingStore.getState().setVoiceToolbarTranscript(display, 'listening');
        }
        if (wakePausedForVoiceRef.current) return;
        if (isRecordingVoiceRef.current) return;
        const wakeWindow = heardTrim.slice(-200);
        const wm = matchWake(wakeWindow);
        const occKey = wakeOccurrenceKey(wakeWindow, wm);
        const withinCooldown = Date.now() < wakeCooldownUntilRef.current;
        const alreadyFired = occKey !== '' && occKey === lastWakeKeyRef.current;
        const wakeMatched = wm.matched && !withinCooldown && !alreadyFired;

        if (wakeMatched) {
          /* Skip auto-note — this chunk is a Jarvis command. */
        } else if (hasFinalInBatch && finalizedChunk && !wm.matched) {
          void submitAutoNoteChunk(finalizedChunk);
        }
        if (!wakeMatched) return;
        lastWakeKeyRef.current = occKey;
        wakeErrorAttemptsRef.current = 0;
        wakeCooldownUntilRef.current = Date.now() + 1200;
        stopTts(); // barge-in: cut Jarvis mid-sentence so the user can speak
        wakePausedForVoiceRef.current = true;
        stopWakeRecognition();
        addAssistantMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: 'Listening for your question…',
          timestamp: new Date(),
          type: 'text',
        });
        void startVoiceRecordingRef.current();
      };
      r.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          addAssistantMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content:
              'Microphone blocked for voice AI mode. Allow mic for this site, then toggle Voice AI again.',
            timestamp: new Date(),
            type: 'text',
          });
          setVoiceAiMode(false);
          return;
        }
        if (event.error === 'network' || event.error === 'audio-capture') {
          const delay = wakeRetryDelayMs(wakeErrorAttemptsRef.current++);
          if (delay < 0) {
            addAssistantMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content:
                'Voice AI: microphone/network kept failing. Toggle Voice AI again to retry.',
              timestamp: new Date(),
              type: 'text',
            });
            setVoiceAiMode(false);
            return;
          }
          wakeRestartTimerRef.current = setTimeout(() => {
            wakeRestartTimerRef.current = null;
            scheduleWakeRestartRef.current();
          }, delay);
        }
      };
      r.onend = () => {
        if (wakeRecognitionRef.current !== r) return;
        wakeRecognitionRef.current = null;
        scheduleWakeRestartRef.current();
      };
      wakeRecognitionRef.current = r;
      try {
        r.start();
      } catch {
        scheduleWakeRestartRef.current();
      }
    }, 280);
  }, [
    addAssistantMessage,
    clearWakeRestartTimer,
    stopWakeRecognition,
    submitAutoNoteChunk,
    startVoiceRecordingRef,
    isRecordingVoiceRef,
    setVoiceAiMode,
  ]);

  useEffect(() => {
    scheduleWakeRestartRef.current = scheduleWakeRestart;
  }, [scheduleWakeRestart]);

  // Watchdog: if wake word should be running but recognition stopped, restart it
  useEffect(() => {
    if (!voiceAiMode) return;
    const id = setInterval(() => {
      if (
        wakeWordListeningRef.current &&
        !wakePausedForVoiceRef.current &&
        !isRecordingVoiceRef.current &&
        wakeRecognitionRef.current === null &&
        wakeRestartTimerRef.current === null
      ) {
        scheduleWakeRestartRef.current();
      }
    }, 5000);
    return () => clearInterval(id);
  }, [voiceAiMode, wakePausedForVoiceRef, isRecordingVoiceRef]);

  return {
    wakePausedForVoiceRef,
    wakeWordListeningRef,
    stopWakeRecognition,
    scheduleWakeRestart,
  };
}
