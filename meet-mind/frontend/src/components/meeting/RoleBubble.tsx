import type { AssistantMessage } from '../../types';

interface RoleBubbleProps {
  message: AssistantMessage;
  onFollowUpClick?: (question: string) => void;
}

const SIGNAL_LABELS: Record<string, string> = {
  decision: 'decision',
  risk: 'risk flagged',
  disagreement: 'disagreement',
  assertion: 'assertion',
  'on-demand': 'on demand',
  entry: 'entering role',
};

export function RoleBubble({ message, onFollowUpClick }: RoleBubbleProps) {
  const signalLabel = SIGNAL_LABELS[message.signal_type ?? ''] ?? message.signal_type ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '4px 0' }}>
      <div style={{
        borderRadius: 14,
        border: '1px solid rgba(245,158,11,0.35)',
        background: 'rgba(245,158,11,0.04)',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px',
          background: 'rgba(245,158,11,0.08)',
          borderBottom: '1px solid rgba(245,158,11,0.15)',
        }}>
          <span style={{ fontSize: '.75rem' }}>🎭</span>
          <span style={{ fontSize: '.68rem', fontWeight: 700, color: '#f59e0b', letterSpacing: '.03em' }}>
            {message.role_name}
          </span>
          {signalLabel && (
            <>
              <span style={{ color: 'rgba(245,158,11,0.4)', fontSize: '.65rem' }}>•</span>
              <span style={{ fontSize: '.62rem', color: 'rgba(245,158,11,0.6)' }}>[{signalLabel}]</span>
            </>
          )}
        </div>
        <div style={{
          padding: '10px 12px',
          fontSize: '.83rem', lineHeight: 1.55,
          color: 'rgba(255,255,255,.88)',
          whiteSpace: 'pre-wrap',
        }}>
          {message.content}
        </div>
      </div>

      {message.follow_up_questions && message.follow_up_questions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 2 }}>
          {message.follow_up_questions.map((q, i) => (
            <button
              key={i}
              onClick={() => onFollowUpClick?.(q)}
              style={{
                padding: '4px 10px', borderRadius: 100,
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.28)',
                color: '#f59e0b', fontSize: '.68rem', cursor: 'pointer',
                transition: 'all .15s',
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
