import { useEffect, useRef, useState } from 'react';
import { useMeetingStore } from '../../store/meetingStore';
import { api } from '../../services/api';
import type { ActiveRole } from '../../types';

interface RoleSetupModalProps {
  assistantUserId: string;
  effectiveRoomId: string;
  userName: string;
  onClose: () => void;
  onActivated: (reply: string) => void;
}

/** One-click starting points — fills the form, user can still edit before activating. */
const ROLE_PRESETS: { name: string; description: string }[] = [
  {
    name: 'Investor',
    description:
      'A sharp venture investor who probes business models, market size, unit economics and traction. Pushes for evidence behind every growth claim.',
  },
  {
    name: "Devil's Advocate",
    description:
      'A constructive challenger who questions every assumption, pokes holes in ideas, and steelman-then-attacks proposals before they ship.',
  },
  {
    name: 'Customer',
    description:
      'A demanding end customer focused on real-world value, usability and pricing. Asks "what does this actually do for me?" at every turn.',
  },
  {
    name: 'Security Expert',
    description:
      'A seasoned security architect who spots attack surfaces, data-handling risks and compliance gaps in any plan or feature discussion.',
  },
  {
    name: 'CTO',
    description:
      'A pragmatic CTO weighing technical feasibility, architecture trade-offs, team capacity and long-term maintenance cost of every proposal.',
  },
];

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,.05)',
  border: '1px solid rgba(255,255,255,.12)', borderRadius: 10,
  padding: '.55rem .75rem', fontSize: '.83rem', color: '#fff', outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '.72rem', textTransform: 'uppercase',
  letterSpacing: '.07em', color: 'rgba(255,255,255,.4)', marginBottom: 6,
};

export function RoleSetupModal({
  assistantUserId,
  effectiveRoomId,
  userName,
  onClose,
  onActivated,
}: RoleSetupModalProps) {
  const setActiveRole = useMeetingStore((s) => s.setActiveRole);
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [sensitivity, setSensitivity] = useState<ActiveRole['sensitivity']>('smart');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  const nameValid = roleName.trim().length >= 1 && roleName.trim().length <= 60;
  const descValid = roleDescription.trim().length >= 20 && roleDescription.trim().length <= 1000;
  const isValid = nameValid && descValid;

  // Focus the name field on open; Esc closes.
  useEffect(() => {
    nameInputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function applyPreset(p: { name: string; description: string }) {
    setRoleName(p.name);
    setRoleDescription(p.description);
    setError('');
  }

  async function handleActivate() {
    if (!isValid || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.roleSet({
        user_id: assistantUserId,
        room_id: effectiveRoomId,
        user_name: userName,
        role_name: roleName.trim(),
        role_description: roleDescription.trim(),
        sensitivity,
      });
      setActiveRole({ name: roleName.trim(), description: roleDescription.trim(), sensitivity });
      onActivated(res.reply);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to activate role');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-modal-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
            void handleActivate();
          }
        }}
        style={{
          background: 'rgba(10,14,26,0.98)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          width: '100%', maxWidth: 440,
          margin: '0 1rem', padding: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <span id="role-modal-title" style={{ fontSize: '.95rem', fontWeight: 700, color: '#f59e0b' }}>🎭 Set Role</span>
          <button onClick={onClose} aria-label="Close role setup" style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            color: 'rgba(255,255,255,.5)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem',
          }}>×</button>
        </div>

        {/* Quick presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '1.1rem' }}>
          {ROLE_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => applyPreset(p)}
              style={{
                padding: '.3rem .65rem', borderRadius: 100, fontSize: '.68rem',
                background: roleName === p.name ? 'rgba(245,158,11,.18)' : 'rgba(255,255,255,.05)',
                border: roleName === p.name ? '1px solid rgba(245,158,11,.45)' : '1px solid rgba(255,255,255,.1)',
                color: roleName === p.name ? '#f59e0b' : 'rgba(255,255,255,.6)',
                cursor: 'pointer', transition: 'all .15s',
              }}
            >{p.name}</button>
          ))}
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>Role name</label>
          <input
            ref={nameInputRef}
            type="text" maxLength={60} value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
            placeholder="e.g. Venture Capitalist"
            style={inputStyle}
          />
          <p style={{ fontSize: '.62rem', color: 'rgba(255,255,255,.3)', marginTop: 4 }}>{roleName.length}/60</p>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>Character description</label>
          <textarea
            rows={4} maxLength={1000} value={roleDescription}
            onChange={(e) => setRoleDescription(e.target.value)}
            placeholder="Describe how this character thinks, what they focus on, their specific perspective and expertise..."
            style={{ ...inputStyle, resize: 'none', fontFamily: 'inherit' }}
          />
          <p style={{
            fontSize: '.62rem', marginTop: 4,
            color: roleDescription.length > 0 && !descValid ? '#f59e0b' : 'rgba(255,255,255,.3)',
          }}>
            {roleDescription.length}/1000 (minimum 20 characters)
          </p>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={labelStyle}>Proactive intervention</label>
          <select
            value={sensitivity}
            onChange={(e) => setSensitivity(e.target.value as ActiveRole['sensitivity'])}
            style={inputStyle}
          >
            <option value="major_only">Major only — decisions only</option>
            <option value="smart">Smart — decisions, risks, disagreements (recommended)</option>
            <option value="frequent">Frequent — any strong assertion</option>
          </select>
        </div>

        {error && <p role="alert" style={{ fontSize: '.78rem', color: '#f87171', marginBottom: '1rem' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '.55rem', borderRadius: 10,
            border: '1px solid rgba(255,255,255,.12)',
            background: 'transparent', color: 'rgba(255,255,255,.5)',
            fontSize: '.82rem', cursor: 'pointer',
          }}>Cancel</button>
          <button
            onClick={() => { void handleActivate(); }}
            disabled={!isValid || loading}
            style={{
              flex: 1, padding: '.55rem', borderRadius: 10, border: 'none',
              background: isValid && !loading ? '#f59e0b' : 'rgba(245,158,11,0.25)',
              color: isValid && !loading ? '#000' : 'rgba(245,158,11,0.4)',
              fontWeight: 700, fontSize: '.82rem',
              cursor: isValid && !loading ? 'pointer' : 'not-allowed',
            }}
          >{loading ? 'Activating…' : 'Activate Role'}</button>
        </div>
      </div>
    </div>
  );
}
