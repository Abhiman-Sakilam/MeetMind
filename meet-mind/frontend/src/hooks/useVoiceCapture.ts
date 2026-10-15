import { useState, useRef, useCallback, useEffect } from 'react';
import { useMeetingStore } from '../store/meetingStore';
import { api, ApiError } from '../services/api';
import { getSpeechRecognitionCtor, isWakeWordSupported, matchWake } from '../lib/wakeWord';
import { filterTranscriptNoise } from '../lib/transcriptDisplay';
import type { AssistantMessage } from '../types';
import { detectLocalCommand, executeLocalCommand, stopTts } from './useAssistantChat';

const VAD_END_SILENCE_MS = 1400;
const VAD_MIN_RECORDING_MS = 900;
const VAD_RMS_THRESHOLD = 0.02;
const VAD_MAX_RECORDING_MS = 120_000;

function flushAndStopMediaRecorder(rec: MediaRecorder | null) {
  if (!rec || rec.state !== 'recording') return;
  try { rec.requestData(); } catch { /* ignore */ }
  try { rec.stop(); } catch { /* ignore */ }
}

function sanitizeReply(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  return t.replace(/\n+_[A-Z0-9_]+_\s*$/i, '').trim();
}

interface UseVoiceCaptureParams {
  assistantUserId: string;
  effectiveRoomId: string;
  addAssistantMessage: (msg: AssistantMessage) => void;
  checkBrain: () => Promise<void>;
  setBrainStatus: (s: 'checking' | 'ok' | 'offline') => void;
  applyAssistantUiResponse: (res: {
    ui_event?: string | null;
    notes_state?: 'on' | 'off' | null;
    artifacts?: Record<string, unknown> | null;
  }) => void;
  maybeRunScreenCommand: (text: string) => Promise<boolean>;
  playTts: (text: string) => void;
  stopWakeRecognition: () => void;
  scheduleWakeRestart: () => void;
  wakePausedForVoiceRef: React.MutableRefObject<boolean>;
  wakeWordListeningRef: React.MutableRefObject<boolean>;
  sessionIdRef: React.RefObject<string>;
}

export function useVoiceCapture({
  assistantUserId,
  effectiveRoomId,
  addAssistantMessage,
  checkBrain,
  setBrainStatus,
  applyAssistantUiResponse,
  maybeRunScreenCommand,
  playTts,
  stopWakeRecognition,
  scheduleWakeRestart,
  wakePausedForVoiceRef,
  wakeWordListeningRef,
  sessionIdRef,
}: UseVoiceCaptureParams) {
  const { userName } = useMeetingStore();

  const [isVoiceSending, setIsVoiceSending] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [liveCaption, setLiveCaption] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const captionRecognitionRef = useRef<SpeechRecognition | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const lastVoiceAtRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const maxRecordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveCaptionRef = useRef('');
  const liveCaptionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startVoiceRecordingRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    liveCaptionRef.current = liveCaption;
  }, [liveCaption]);

  const { setVoiceToolbarTranscript } = useMeetingStore();

  useEffect(() => {
    if (!isRecordingVoice) return;
    setVoiceToolbarTranscript(liveCaption, 'dictating');
  }, [liveCaption, isRecordingVoice, setVoiceToolbarTranscript]);

  const stopCaptionRecognitionForRecording = useCallback(() => {
    if (liveCaptionDebounceRef.current != null) {
      clearTimeout(liveCaptionDebounceRef.current);
      liveCaptionDebounceRef.current = null;
    }
    const c = captionRecognitionRef.current;
    captionRecognitionRef.current = null;
    if (!c) return;
    try {
      c.onresult = null;
      c.onerror = null;
      c.onend = null;
      c.stop();
    } catch {
      try { c.abort(); } catch { /* ignore */ }
    }
  }, []);

  const stopVadMonitoring = useCallback(() => {
    if (vadRafRef.current != null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (maxRecordingTimerRef.current != null) {
      clearTimeout(maxRecordingTimerRef.current);
      maxRecordingTimerRef.current = null;
    }
    voiceAnalyserRef.current = null;
    const ctx = voiceAudioContextRef.current;
    voiceAudioContextRef.current = null;
    if (ctx && ctx.state !== 'closed') {
      void ctx.close();
    }
  }, []);

  useEffect(() => {
    return () => {
      stopCaptionRecognitionForRecording();
      stopVadMonitoring();
    };
  }, [stopCaptionRecognitionForRecording, stopVadMonitoring]);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      activeStreamRef.current?.getTracks().forEach((t) => t.stop());
      activeStreamRef.current = null;
    };
  }, []);

  const isRecordingVoiceRef = useRef(false);
  const bargeInRestartRef = useRef(false);

  const startVoiceRecording = useCallback(async () => {
    if (isRecordingVoiceRef.current) return;
    isRecordingVoiceRef.current = true;
    stopTts(); // if Jarvis was speaking, cut it — the user is talking now
    wakePausedForVoiceRef.current = true;
    stopWakeRecognition();
    setLiveCaption('');
    if (!effectiveRoomId) {
      wakePausedForVoiceRef.current = false;
      if (wakeWordListeningRef.current) {
        scheduleWakeRestart();
      }
      addAssistantMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: 'No room id — cannot start voice request.',
        timestamp: new Date(),
        type: 'text',
      });
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      voiceChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) voiceChunksRef.current.push(e.data);
        console.debug('[voice] ondataavailable', {
          size: e.data.size,
          totalChunks: voiceChunksRef.current.length,
          mimeType,
          recorderState: recorder.state,
        });
      };

      recorder.onstop = async () => {
        console.debug('[voice] onstop', {
          chunks: voiceChunksRef.current.length,
          bargeIn: bargeInRestartRef.current,
          mimeType,
        });
        isRecordingVoiceRef.current = false;
        setIsRecordingVoice(false);
        setLiveCaption('');
        stopCaptionRecognitionForRecording();
        stopVadMonitoring();
        stream?.getTracks().forEach((t) => t.stop());

        // Barge-in: caller interrupted with a fresh "jarvis" — begin a new
        // capture instead of sending the dropped audio. wakePausedForVoiceRef
        // stays true across the handoff, so the wake recognizer is not resumed.
        if (bargeInRestartRef.current) {
          bargeInRestartRef.current = false;
          addAssistantMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: 'Restarting — go ahead.',
            timestamp: new Date(),
            type: 'text',
          });
          await startVoiceRecordingRef.current();
          return;
        }

        const blob = new Blob(voiceChunksRef.current, { type: mimeType });
        console.debug('[voice] blob built', { size: blob.size, type: blob.type, chunks: voiceChunksRef.current.length });
        if (!blob.size) {
          addAssistantMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content:
              'No audio was captured (empty clip). After "Jarvis", speak for at least a second, wait for silence to end recording, or check the mic is unmuted.',
            timestamp: new Date(),
            type: 'text',
          });
          if (useMeetingStore.getState().voiceAiMode) {
            useMeetingStore.getState().setVoiceToolbarTranscript('', 'listening');
          }
          wakePausedForVoiceRef.current = false;
          if (wakeWordListeningRef.current) {
            scheduleWakeRestart();
          }
          return;
        }
        const preview = liveCaptionRef.current.trim();
        if (preview && await maybeRunScreenCommand(preview)) {
          setBrainStatus('ok');
          useMeetingStore.getState().clearVoiceToolbar();
          wakePausedForVoiceRef.current = false;
          if (wakeWordListeningRef.current) {
            scheduleWakeRestart();
          }
          return;
        }
        useMeetingStore.getState().setVoiceToolbarTranscript(
          (preview ? filterTranscriptNoise(preview) : '') ||
            'Sending audio to Jarvis (Whisper + brain)…',
          'transcribing',
        );
        setIsVoiceSending(true);
        // Resume wake NOW so a mid-response "Jarvis" is heard while the brain works.
        wakePausedForVoiceRef.current = false;
        if (wakeWordListeningRef.current) scheduleWakeRestart();
        try {
          console.debug('[voice] POST voice/execute', {
            blobSize: blob.size, room: effectiveRoomId, user: assistantUserId,
          });
          const res = await api.assistantVoiceExecute({
            audio: blob,
            filename: 'voice.webm',
            user_id: assistantUserId,
            room_id: effectiveRoomId,
            user_name: userName || 'Guest',
            session_id: sessionIdRef.current,
            response_style: 'auto',
          });
          addAssistantMessage({
            id: crypto.randomUUID(),
            role: 'user',
            content: `🎤 ${filterTranscriptNoise(res.transcript.trim())}`,
            timestamp: new Date(),
            type: 'text',
          });
          // Handle local commands (mute, camera, recording, voice-off) without brain
          const voiceCmd = detectLocalCommand(res.transcript);
          if (voiceCmd) {
            executeLocalCommand(voiceCmd, addAssistantMessage);
            setBrainStatus('ok');
            return;
          }
          if (await maybeRunScreenCommand(res.transcript)) {
            setBrainStatus('ok');
            return;
          }
          const replyText = sanitizeReply(
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
                : 'Voice request failed';
          addAssistantMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: `Voice assistant error: ${msg}`,
            timestamp: new Date(),
            type: 'text',
          });
          void checkBrain();
        } finally {
          setIsVoiceSending(false);
          // Only reset wake state if a NEW capture didn't start during this request.
          if (!isRecordingVoiceRef.current) {
            wakePausedForVoiceRef.current = false;
            if (useMeetingStore.getState().voiceAiMode && isWakeWordSupported()) {
              useMeetingStore.getState().setVoiceToolbarTranscript('', 'listening');
            } else {
              useMeetingStore.getState().clearVoiceToolbar();
            }
            if (wakeWordListeningRef.current) {
              scheduleWakeRestart();
            }
          }
        }
      };

      let vadBuffer: Uint8Array<ArrayBuffer> | null = null;
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const audioContext = new Ctx();
          voiceAudioContextRef.current = audioContext;
          if (audioContext.state === 'suspended') {
            await audioContext.resume();
          }
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.45;
          source.connect(analyser);
          voiceAnalyserRef.current = analyser;
          vadBuffer = new Uint8Array(analyser.fftSize);
        }
      } catch {
        voiceAnalyserRef.current = null;
        voiceAudioContextRef.current = null;
      }

      maxRecordingTimerRef.current = setTimeout(() => {
        maxRecordingTimerRef.current = null;
        flushAndStopMediaRecorder(recorderRef.current);
      }, VAD_MAX_RECORDING_MS);

      const startLiveCaption = () => {
        const Ctor = getSpeechRecognitionCtor();
        if (!Ctor) return;
        if (captionRecognitionRef.current) return;
        const cap = new Ctor();
        cap.continuous = true;
        cap.interimResults = true;
        cap.lang = 'en-US';
        cap.onresult = (event: SpeechRecognitionEvent) => {
          let t = '';
          for (let j = 0; j < event.results.length; j++) {
            t += event.results[j][0].transcript;
          }
          const cleaned = filterTranscriptNoise(t.trim());
          // Barge-in: a NEW "jarvis" spoken mid-command drops this capture and
          // starts a fresh one. Grace period ignores the wake that opened it.
          const sinceStart = Date.now() - recordingStartedAtRef.current;
          if (
            !bargeInRestartRef.current &&
            sinceStart > 1500 &&
            matchWake(t).matched
          ) {
            bargeInRestartRef.current = true;
            voiceChunksRef.current = [];
            flushAndStopMediaRecorder(recorderRef.current);
            return;
          }
          if (liveCaptionDebounceRef.current != null) {
            clearTimeout(liveCaptionDebounceRef.current);
          }
          liveCaptionDebounceRef.current = setTimeout(() => {
            liveCaptionDebounceRef.current = null;
            setLiveCaption(cleaned);
          }, 95);
        };
        cap.onerror = () => {};
        cap.onend = () => {
          if (captionRecognitionRef.current !== cap) return;
          captionRecognitionRef.current = null;
          if (recorderRef.current?.state === 'recording') {
            window.setTimeout(() => {
              if (recorderRef.current?.state === 'recording') {
                startLiveCaption();
              }
            }, 150);
          }
        };
        captionRecognitionRef.current = cap;
        try {
          cap.start();
        } catch {
          captionRecognitionRef.current = null;
        }
      };
      startLiveCaption();

      recorder.start(250);
      setIsRecordingVoice(true);
      recordingStartedAtRef.current = Date.now();
      lastVoiceAtRef.current = Date.now();

      const vadTick = () => {
        const rec = recorderRef.current;
        const an = voiceAnalyserRef.current;
        if (!rec || rec.state !== 'recording') {
          return;
        }
        const now = Date.now();
        if (an && vadBuffer) {
          an.getByteTimeDomainData(vadBuffer);
          let sum = 0;
          for (let i = 0; i < vadBuffer.length; i++) {
            const x = (vadBuffer[i] - 128) / 128;
            sum += x * x;
          }
          const rms = Math.sqrt(sum / vadBuffer.length);
          if (rms >= VAD_RMS_THRESHOLD) {
            lastVoiceAtRef.current = now;
          }
        }
        if (
          an &&
          now - recordingStartedAtRef.current >= VAD_MIN_RECORDING_MS &&
          now - lastVoiceAtRef.current >= VAD_END_SILENCE_MS
        ) {
          flushAndStopMediaRecorder(rec);
          return;
        }
        if (now - recordingStartedAtRef.current >= VAD_MAX_RECORDING_MS) {
          flushAndStopMediaRecorder(rec);
          return;
        }
        vadRafRef.current = requestAnimationFrame(vadTick);
      };
      vadRafRef.current = requestAnimationFrame(vadTick);
    } catch (e) {
      isRecordingVoiceRef.current = false;
      stream?.getTracks().forEach((t) => t.stop());
      activeStreamRef.current = null;
      stopCaptionRecognitionForRecording();
      stopVadMonitoring();
      wakePausedForVoiceRef.current = false;
      if (wakeWordListeningRef.current) {
        scheduleWakeRestart();
      }
      addAssistantMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: e instanceof Error ? e.message : 'Microphone permission denied.',
        timestamp: new Date(),
        type: 'text',
      });
    }
  }, [
    effectiveRoomId,
    assistantUserId,
    userName,
    addAssistantMessage,
    checkBrain,
    setBrainStatus,
    stopWakeRecognition,
    scheduleWakeRestart,
    stopCaptionRecognitionForRecording,
    stopVadMonitoring,
    maybeRunScreenCommand,
    applyAssistantUiResponse,
    playTts,
    wakePausedForVoiceRef,
    wakeWordListeningRef,
    sessionIdRef,
  ]);

  useEffect(() => {
    startVoiceRecordingRef.current = startVoiceRecording;
  }, [startVoiceRecording]);

  return {
    isVoiceSending,
    isRecordingVoice,
    liveCaption,
    startVoiceRecording,
    startVoiceRecordingRef,
  };
}
