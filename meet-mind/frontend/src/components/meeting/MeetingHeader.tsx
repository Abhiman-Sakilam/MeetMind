import { useEffect, useState, useCallback, useRef } from 'react';
import { Copy, Users, Check } from 'lucide-react';
import { useMeetingStore } from '../../store/meetingStore';
import { api } from '../../services/api';

type PersonaKey = 'friendly' | 'professional' | 'witty' | 'calm' | 'hacker' | 'motivator';

const PERSONA_OPTIONS: { key: PersonaKey; emoji: string; label: string }[] = [
  { key: 'friendly',     emoji: '🔥', label: 'Friendly' },
  { key: 'professional', emoji: '🎩', label: 'Professional' },
  { key: 'witty',        emoji: '😏', label: 'Witty' },
  { key: 'calm',         emoji: '🧘', label: 'Calm' },
  { key: 'hacker',       emoji: '💻', label: 'Hacker' },
  { key: 'motivator',    emoji: '💪', label: 'Motivator' },
];

interface MeetingHeaderProps {
  onPersonaChange?: (newPersona: PersonaKey) => void;
}

export function MeetingHeader({ onPersonaChange }: MeetingHeaderProps) {
  const { roomId, meetingTitle, startTime, participants, isRecording, persona, setPersona, localClientUserId, addAssistantMessage, userName } = useMeetingStore();
  const [elapsed, setElapsed] = useState('00:00');
  const [copied, setCopied] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!startTime) return;
    const iv = setInterval(() => {
      const diff = Math.floor((Date.now() - startTime.getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(iv);
  }, [startTime]);

  useEffect(() => {
    if (!personaOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setPersonaOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [personaOpen]);

  const copyRoomId = useCallback(async () => {
    if (!roomId) return;
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomId]);

  const handlePersonaSelect = useCallback(async (key: PersonaKey) => {
    setPersona(key);
    setPersonaOpen(false);
    onPersonaChange?.(key);
    if (!roomId || !localClientUserId) return;
    try {
      const res = await api.assistantExecute({
        user_id: localClientUserId,
        room_id: roomId,
        user_name: userName,
        text: '__persona_switch__',
        trigger: 'persona_switch',
        persona: key,
      });
      addAssistantMessage({
        id: `persona-switch-${Date.now()}`,
        role: 'assistant',
        content: res.reply,
        timestamp: new Date(),
        type: 'text',
      });
    } catch {
      // announcement is non-critical — swallow silently
    }
  }, [setPersona, onPersonaChange, roomId, localClientUserId, userName, addAssistantMessage]);

  const activePersona = PERSONA_OPTIONS.find((p) => p.key === persona) ?? PERSONA_OPTIONS[0];
  const participantCount = participants.size + 1;

  return (
    <header style={{ position: 'absolute', top: '1.5rem', left: '1.5rem', right: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 100 }}>
      {/* Logo */}
      <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 900, letterSpacing: '-1px', fontSize: '1.2rem', textTransform: 'uppercase' }}>Meet-Mind-Synthesis</div>

      {/* Centre pill */}
      <div className="room-info-pill">
        <div className="live-dot" />
        <div className="room-timer">{elapsed}</div>
        {isRecording && <>
          <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,.12)' }} />
          <span style={{ fontSize: '.7rem', letterSpacing: 2, color: '#ff4444' }}>● REC</span>
        </>}
        <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,.12)' }} />
        <span style={{ fontSize: '.72rem', letterSpacing: 2, opacity: .7, fontFamily: "'Outfit',sans-serif" }}>
          {meetingTitle || roomId?.slice(0, 8).toUpperCase()}
        </span>
      </div>

      {/* Right actions */}
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 100, padding: '.4rem 1rem', fontSize: '.72rem', opacity: .7 }}>
          <Users size={13} />
          <span>{participantCount}</span>
        </div>

        {/* Persona picker */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setPersonaOpen((v) => !v)}
            title={`Jarvis Persona: ${activePersona.label}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: personaOpen ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.05)',
              border: '1px solid rgba(255,255,255,.1)',
              borderRadius: 100,
              padding: '.4rem .75rem',
              fontSize: '1rem',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
          >
            <span role="img" aria-label={activePersona.label}>{activePersona.emoji}</span>
          </button>

          {personaOpen && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              background: '#1a1a2e',
              border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 12,
              padding: '6px 0',
              minWidth: 180,
              boxShadow: '0 8px 32px rgba(0,0,0,.5)',
              zIndex: 200,
            }}>
              <div style={{ padding: '6px 14px 8px', fontSize: '.65rem', letterSpacing: 2, opacity: .5, textTransform: 'uppercase', fontFamily: "'Outfit',sans-serif" }}>
                Jarvis Persona
              </div>
              {PERSONA_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => handlePersonaSelect(opt.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '7px 14px',
                    background: persona === opt.key ? 'rgba(255,255,255,.08)' : 'transparent',
                    border: 'none',
                    color: 'rgba(255,255,255,.85)',
                    fontSize: '.82rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,.06)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = persona === opt.key ? 'rgba(255,255,255,.08)' : 'transparent'; }}
                >
                  <span style={{ fontSize: '.7rem', opacity: persona === opt.key ? 1 : 0 }}>●</span>
                  <span role="img" aria-label={opt.label}>{opt.emoji}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={copyRoomId} title="Copy meeting ID"
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 100, padding: '.4rem 1rem', fontSize: '.72rem', color: 'rgba(255,255,255,.7)', cursor: 'pointer' }}>
          {copied ? <Check size={12} style={{ color: '#00ffcc' }} /> : <Copy size={12} />}
          <span style={{ fontFamily: 'monospace' }}>{roomId?.slice(0, 8)}…</span>
        </button>
      </div>
    </header>
  );
}
