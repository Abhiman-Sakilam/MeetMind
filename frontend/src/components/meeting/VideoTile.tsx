import { useEffect, useRef } from 'react';
import { MicOff, VideoOff } from 'lucide-react';
import clsx from 'clsx';
import { useMeetingStore } from '../../store/meetingStore';

interface VideoTileProps {
  stream: MediaStream | null;
  name: string;
  isMuted?: boolean;
  isVideoOff?: boolean;
  isSpeaking?: boolean;
  isLocal?: boolean;
  isScreenShare?: boolean;
  /** Large stage tile: full frame visible (screen share spotlight) */
  spotlight?: boolean;
  /** Solo main stage: camera-off uses page2-style tile (no tiny circle in empty frame) */
  stageLayout?: boolean;
}

const SPEAKING_BAR_HEIGHTS = [8, 11, 9];

export function VideoTile({
  stream,
  name,
  isMuted = false,
  isVideoOff = false,
  isSpeaking = false,
  isLocal = false,
  isScreenShare = false,
  spotlight = false,
  stageLayout = false,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const voiceAiMode = useMeetingStore((s) => s.voiceAiMode);
  const isAssistantOpen = useMeetingStore((s) => s.isAssistantOpen);
  const listeningAura = voiceAiMode || isAssistantOpen;

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, isVideoOff]);

  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const bgGradients = [
    'from-indigo-600 to-purple-700',
    'from-emerald-600 to-teal-700',
    'from-rose-600 to-pink-700',
    'from-amber-600 to-orange-700',
    'from-cyan-600 to-blue-700',
  ];
  const gradientIdx =
    name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % bgGradients.length;

  const showStageAvatar = stageLayout && isVideoOff;
  const useRingOffset = !spotlight && !(stageLayout && isVideoOff);

  return (
    <div
      className={clsx(
        'relative rounded-2xl overflow-hidden bg-surface-800 transition-all duration-300 group',
        spotlight && 'flex-1 min-h-0 flex flex-col rounded-xl',
        stageLayout && 'h-full min-h-0 w-full flex flex-col',
        isSpeaking && useRingOffset && 'ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-surface-900',
        isSpeaking && stageLayout && isVideoOff && 'ring-2 ring-emerald-400/50 ring-inset',
      )}
    >
      {/* Video */}
      {stream && !isVideoOff ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={clsx(
            'w-full h-full',
            isScreenShare || spotlight ? 'object-contain bg-black' : 'object-cover',
            isLocal && !isScreenShare && '-scale-x-100',
            spotlight && 'min-h-0 flex-1',
          )}
        />
      ) : showStageAvatar ? (
        <div className="jarvis-user-stage-bg relative flex min-h-0 flex-1 flex-col items-center justify-center px-4">
          <div
            className={clsx(
              'jarvis-user-avatar-stage flex shrink-0 items-center justify-center font-bold text-[var(--accent-spatial)]',
              listeningAura && 'jarvis-user-avatar-stage--listening',
            )}
            style={{ fontFamily: "'Syne', 'Outfit', sans-serif" }}
          >
            {initials}
          </div>
          <p
            className="mt-5 text-xs font-medium uppercase tracking-[0.18em] text-cyan-400/70"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Camera off
          </p>
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-800 to-surface-900">
          <div
            className={clsx(
              'flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br text-2xl font-bold text-white shadow-xl sm:h-28 sm:w-28 sm:text-3xl',
              bgGradients[gradientIdx],
            )}
          >
            {initials}
          </div>
        </div>
      )}

      {/* Gradient overlay at bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />

      {/* Name + indicators */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-3">
        <div className="flex items-center gap-2">
          {isSpeaking && (
            <span className="flex h-3 items-end gap-[2px]">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="w-[3px] animate-pulse rounded-full bg-emerald-400"
                  style={{
                    height: `${SPEAKING_BAR_HEIGHTS[i - 1]}px`,
                    animationDelay: `${i * 0.15}s`,
                  }}
                />
              ))}
            </span>
          )}
          <span className="text-sm font-medium text-white drop-shadow-lg">
            {name}
            {isLocal && <span className="ml-1.5 text-xs text-surface-300">(You)</span>}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {isMuted && (
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/80 backdrop-blur-sm">
              <MicOff size={14} className="text-white" />
            </span>
          )}
          {isVideoOff && (
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-600/80 backdrop-blur-sm">
              <VideoOff size={14} className="text-white" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
