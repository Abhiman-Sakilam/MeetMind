import { useCallback, useRef } from 'react';
import type { Participant } from '../types';

export function useRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const startRecording = useCallback(
    (localStream: MediaStream, participants: Map<string, Participant>) => {
      if (recorderRef.current) return;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const dest = audioCtx.createMediaStreamDestination();

      if (localStream.getAudioTracks().length > 0) {
        audioCtx.createMediaStreamSource(localStream).connect(dest);
      }

      participants.forEach((p) => {
        if (p.stream && p.stream.getAudioTracks().length > 0) {
          audioCtx.createMediaStreamSource(p.stream).connect(dest);
        }
      });

      const combinedStream = new MediaStream([
        ...localStream.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ]);

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm';

      const recorder = new MediaRecorder(combinedStream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meetmind-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
      };

      recorder.start(1000);
      recorderRef.current = recorder;
    },
    [],
  );

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    stopRecording();
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
  }, [stopRecording]);

  return { startRecording, stopRecording, cleanup };
}
