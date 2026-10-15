import { useMeetingStore } from '../../store/meetingStore';
import { api } from '../../services/api';

interface RoleStatusBadgeProps {
  assistantUserId: string;
  effectiveRoomId: string;
  userName: string;
  onExited: (reply: string) => void;
}

const SENSITIVITY_LABELS: Record<string, string> = {
  major_only: 'major decisions only',
  smart: 'smart (decisions, risks, disagreements)',
  frequent: 'frequent (any strong assertion)',
};

export function RoleStatusBadge({
  assistantUserId,
  effectiveRoomId,
  userName,
  onExited,
}: RoleStatusBadgeProps) {
  const activeRole = useMeetingStore((s) => s.activeRole);
  const clearActiveRole = useMeetingStore((s) => s.clearActiveRole);

  if (!activeRole) return null;

  const tooltip =
    `${activeRole.name} — interjects on ${SENSITIVITY_LABELS[activeRole.sensitivity] ?? activeRole.sensitivity}\n` +
    activeRole.description;

  async function handleExit() {
    try {
      const res = await api.roleExit({
        user_id: assistantUserId,
        room_id: effectiveRoomId,
        user_name: userName,
      });
      clearActiveRole();
      onExited(res.reply);
    } catch {
      clearActiveRole();
      onExited('Role ended.');
    }
  }

  return (
    <div
      title={tooltip}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 4px 4px 10px', borderRadius: 100,
        background: 'rgba(245,158,11,0.12)',
        border: '1px solid rgba(245,158,11,0.35)',
      }}
    >
      <span style={{ fontSize: '.75rem' }}>🎭</span>
      <span style={{
        fontSize: '.65rem', fontWeight: 700, color: '#f59e0b',
        maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{activeRole.name}</span>
      <button
        onClick={() => { void handleExit(); }}
        title="Exit role"
        aria-label={`Exit ${activeRole.name} role`}
        style={{
          width: 22, height: 22, borderRadius: '50%', border: 'none',
          background: 'rgba(245,158,11,0.2)', color: '#f59e0b',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '.65rem', lineHeight: 1, padding: 0,
        }}
      >✕</button>
    </div>
  );
}
