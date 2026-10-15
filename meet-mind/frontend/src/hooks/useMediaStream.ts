import { useCallback, useEffect, useRef, useState } from 'react';

interface UseMediaStreamOptions {
  video?: boolean;
  audio?: boolean;
}

export function useMediaStream(opts: UseMediaStreamOptions = { video: true, audio: true }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: opts.video
          ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
          : false,
        audio: opts.audio
          ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : false,
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setError(null);
      return mediaStream;
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera/microphone permission denied. Please allow access.'
          : 'Could not access camera or microphone.';
      setError(message);
      return null;
    }
  }, [opts.video, opts.audio]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return { stream, error, start, stop };
}
