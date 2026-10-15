import { useMeetingStore } from '../../store/meetingStore';
import { VideoTile } from './VideoTile';

export function VideoGrid() {
  const {
    localStream,
    screenStream,
    userName,
    localClientUserId,
    activeScreenUserId,
    isMuted,
    isVideoOff,
    isScreenSharing,
    participants,
  } = useMeetingStore();

  const remoteParticipants = Array.from(participants.values());

  const spotlight = ((): { stream: MediaStream; name: string; isLocal: boolean } | null => {
    if (activeScreenUserId && localClientUserId === activeScreenUserId && isScreenSharing && screenStream) {
      return { stream: screenStream, name: `${userName || 'You'} (Screen)`, isLocal: true };
    }
    if (activeScreenUserId) {
      const p = remoteParticipants.find((r) => r.id === activeScreenUserId && r.screenStream);
      if (p?.screenStream) return { stream: p.screenStream, name: `${p.name} (Screen)`, isLocal: false };
    }
    if (isScreenSharing && screenStream) {
      return { stream: screenStream, name: `${userName || 'You'} (Screen)`, isLocal: true };
    }
    const remotePresenter = remoteParticipants.find((r) => r.isScreenSharing && r.screenStream);
    if (remotePresenter?.screenStream) {
      return { stream: remotePresenter.screenStream, name: `${remotePresenter.name} (Screen)`, isLocal: false };
    }
    return null;
  })();

  const allParticipants = [
    { id: 'local', stream: localStream, name: userName || 'You', isMuted, isVideoOff, isLocal: true, isSpeaking: false },
    ...remoteParticipants.map((p) => ({
      id: p.id,
      stream: p.stream ?? null,
      name: p.name,
      isMuted: p.isMuted,
      isVideoOff: p.isVideoOff,
      isLocal: false,
      isSpeaking: p.isSpeaking ?? false,
    })),
  ];

  const count = allParticipants.length;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const isSolo = count === 1;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Screen share spotlight overlay */}
      {spotlight && (
        <div
          style={{
            position: 'absolute',
            top: '8%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '65%',
            height: '55%',
            zIndex: 45,
            borderRadius: 16,
            overflow: 'hidden',
            border: '2px solid var(--accent-spatial)',
            boxShadow: '0 0 40px rgba(0,255,204,0.3)',
          }}
        >
          <VideoTile
            stream={spotlight.stream}
            name={spotlight.name}
            isMuted={false}
            isVideoOff={false}
            isLocal={spotlight.isLocal}
            isScreenShare
            spotlight
          />
        </div>
      )}

      {/* Responsive participant grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 8,
          width: '100%',
          height: '100%',
          padding: 8,
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }}
      >
        {allParticipants.map((p) => {
          const speaking = p.isSpeaking || (p.isLocal && !p.isMuted && !isSolo);
          return (
            <div
              key={p.id}
              style={{
                position: 'relative',
                minHeight: 0,
                borderRadius: 16,
                overflow: 'hidden',
                background: 'linear-gradient(135deg, rgba(20,20,20,.6), rgba(5,5,5,.9))',
                border: `1px solid ${speaking ? 'rgba(0,255,204,.55)' : 'rgba(255,255,255,.1)'}`,
                boxShadow: speaking ? '0 0 24px rgba(0,255,204,.18)' : '0 4px 20px rgba(0,0,0,.4)',
                transition: 'border-color .3s, box-shadow .3s',
                pointerEvents: 'auto',
              }}
            >
              <VideoTile
                stream={p.stream}
                name={p.name}
                isMuted={p.isMuted}
                isVideoOff={p.isVideoOff}
                isLocal={p.isLocal}
                isSpeaking={p.isSpeaking}
                stageLayout={isSolo}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
