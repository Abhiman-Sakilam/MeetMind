import { useState } from 'react';
import { Check, CheckSquare } from 'lucide-react';
import type { MeetingActionItem } from '../../types';
import { api } from '../../services/api';
import { useMeetingStore } from '../../store/meetingStore';

interface Props {
  roomName: string;
  items: MeetingActionItem[];
}

export function ActionItemsCard({ roomName, items }: Props) {
  const setItemStatus = useMeetingStore(s => s.setActionItemStatus);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="bento-card bento-action-items interactable" style={{ animationDelay: '.5s' }}>
        <div className="card-label">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'inherit' }}><CheckSquare size={14} /> Action</span>
        <span>Items</span>
      </div>
        <p style={{ opacity: .4, fontSize: '.88rem', fontStyle: 'italic' }}>No action items extracted.</p>
      </div>
    );
  }

  const toggle = async (item: MeetingActionItem) => {
    const next = item.status === "completed" ? "pending" : "completed";
    setItemStatus(item.id, next);          // optimistic
    setError(null);
    try {
      await api.toggleActionItem(roomName, item.id, next);
    } catch (e) {
      setItemStatus(item.id, item.status); // revert
      setError(e instanceof Error ? e.message : "Failed to update");
      setTimeout(() => setError(null), 3000);
    }
  };

  // Pending first, completed at the bottom
  const ordered = [...items].sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed"));

  return (
    <div className="bento-card bento-action-items interactable" style={{ animationDelay: '.5s' }}>
      <div className="card-label">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'inherit' }}><CheckSquare size={14} /> Action</span>
        <span>Items</span>
      </div>
      {error && (
        <div style={{ padding: '.4rem .8rem', marginBottom: '.6rem', borderRadius: 8, background: 'rgba(255,68,68,.1)', border: '1px solid rgba(255,68,68,.25)', color: '#ff6b6b', fontSize: '.78rem' }}>{error}</div>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: '.4rem 0 0 0', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {ordered.map((item) => {
          const done = item.status === "completed";
          return (
            <li key={item.id}
                onClick={() => toggle(item)}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '.65rem',
                  padding: '.6rem .85rem',
                  borderRadius: 12,
                  border: `1px solid ${done ? 'rgba(250,97,20,.3)' : 'rgba(255,255,255,.08)'}`,
                  background: done ? 'rgba(250,97,20,.06)' : 'rgba(0,0,0,.3)',
                  opacity: done ? .55 : 1,
                  transition: 'all .15s',
                }}>
              <div style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2,
                background: done ? '#fa6114' : 'transparent',
                border: `1px solid ${done ? '#fa6114' : 'rgba(255,255,255,.25)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{done && <Check size={10} style={{ color: '#000' }} />}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.86rem', color: 'rgba(255,255,255,.9)', textDecoration: done ? 'line-through' : 'none' }}>{item.title}</div>
                <div style={{ fontSize: '.7rem', color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
                  {item.assigned_to ? `@${item.assigned_to}` : 'unassigned'}
                  {item.due_date ? ` · ${new Date(item.due_date).toLocaleDateString()}` : ''}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
