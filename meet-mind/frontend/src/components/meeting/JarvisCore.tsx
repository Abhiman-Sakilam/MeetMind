import { useMeetingStore } from '../../store/meetingStore';
import clsx from 'clsx';

export function JarvisCore() {
  const voiceAiMode = useMeetingStore((s) => s.voiceAiMode);
  const isAssistantOpen = useMeetingStore((s) => s.isAssistantOpen);
  const voiceToolbarPhase = useMeetingStore((s) => s.voiceToolbarPhase);
  const soloStage = useMeetingStore((s) => s.participants.size === 0);

  if (soloStage) return null;

  const listening = voiceAiMode || isAssistantOpen;
  const active = voiceToolbarPhase === 'dictating' || voiceToolbarPhase === 'transcribing';

  return (
    <div className={clsx('jarvis-core interactable', listening && 'listening', active && 'active-voice')}>
      {/* Concentric animated rings */}
      <div className="jc-ring jc-ring-1" />
      <div className="jc-ring jc-ring-2" />
      <div className="jc-ring jc-ring-3" />

      {/* Center: animated waveform when speaking, orb when idle */}
      <div className="jc-center">
        {active ? (
          <div className="jc-waveform">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <span key={i} className={`jc-bar jc-bar-${i}`} />
            ))}
          </div>
        ) : (
          <div className={clsx('core-orb', listening && 'core-orb--listening')} />
        )}
      </div>
    </div>
  );
}
