import { NotebookPen } from 'lucide-react';
import type { MeetingNote } from '../../types';

interface Props {
  notes: MeetingNote[];
}

interface Group {
  id: string;
  title: string;
  notes: MeetingNote[];
  startTs: number;
  endTs: number;
}

// Defensive: a summary blob should never reach the Notes panel (backend filters
// type="summary:*"), but guard against legacy rows so raw markdown never shows.
function looksLikeSummaryDump(text: string): boolean {
  const t = text.trim();
  if (t.length > 400) return true;
  return /\*\*(Overview|Key Discussion Points|Decisions Made|Action Items|Open Questions)\*\*/i.test(t);
}

function groupBySession(notes: MeetingNote[]): Group[] {
  const map = new Map<string, Group>();
  for (const n of notes) {
    if (!n.text?.trim() || looksLikeSummaryDump(n.text)) continue;
    const id = n.session_id ?? "__ungrouped__";
    const title = n.session_title ?? (id === "__ungrouped__" ? "Ungrouped" : "Notes Session");
    if (!map.has(id)) {
      map.set(id, { id, title, notes: [], startTs: n.ts || 0, endTs: n.ts || 0 });
    }
    const g = map.get(id)!;
    g.notes.push(n);
    if (n.ts && n.ts < g.startTs) g.startTs = n.ts;
    if (n.ts && n.ts > g.endTs) g.endTs = n.ts;
  }
  // Real sessions first, ungrouped last
  return [...map.values()].sort((a, b) => {
    if (a.id === "__ungrouped__") return 1;
    if (b.id === "__ungrouped__") return -1;
    return a.startTs - b.startTs;
  });
}

// Group a session's notes by their topic heading so the panel reads as a
// structured outline instead of one flat bullet list.
function groupBySection(notes: MeetingNote[]): { section: string; points: MeetingNote[] }[] {
  const map = new Map<string, MeetingNote[]>();
  for (const n of notes) {
    const key = (n.section || '').trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  return [...map.entries()].map(([section, points]) => ({ section, points }));
}

function fmtTime(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Render **bold** inline without pulling in a block-level markdown renderer.
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i} style={{ color: 'rgba(255,255,255,.95)', fontWeight: 700 }}>{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export function NotesCard({ notes }: Props) {
  const groups = groupBySession(notes);

  if (groups.length === 0) {
    return (
      <div className="bento-card bento-notes interactable" style={{ animationDelay: '.4s', overflowY: 'auto' }}>
        <div className="card-label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'inherit' }}><NotebookPen size={14} /> Meeting</span>
          <span>Notes</span>
        </div>
        <p style={{ opacity: .4, fontSize: '.88rem', fontStyle: 'italic' }}>No notes captured. Turn on Notes mode during the meeting to capture key points.</p>
      </div>
    );
  }

  return (
    <div className="bento-card bento-notes interactable" style={{ animationDelay: '.4s', overflowY: 'auto' }}>
      <div className="card-label">📝 Meeting <span>Notes</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', marginTop: '.5rem' }}>
        {groups.map((g) => {
          const sections = groupBySection(g.notes);
          return (
            <details key={g.id} open style={{
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,.08)',
              background: g.id === "__ungrouped__" ? 'rgba(255,255,255,.02)' : 'rgba(0,0,0,.3)',
              padding: '.65rem .9rem',
            }}>
              <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '.85rem', fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>
                  {g.title}
                </span>
                <span style={{ fontSize: '.7rem', color: 'rgba(255,255,255,.4)' }}>
                  {g.startTs ? `${fmtTime(g.startTs)} → ${fmtTime(g.endTs)}` : ''}
                </span>
              </summary>
              <div style={{ marginTop: '.6rem', display: 'flex', flexDirection: 'column', gap: '.7rem' }}>
                {sections.map((sec, si) => (
                  <div key={si}>
                    {sec.section && (
                      <div style={{
                        fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '.05em', color: 'rgba(255,176,103,.75)', marginBottom: '.3rem',
                      }}>
                        {sec.section}
                      </div>
                    )}
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                      {sec.points.map((n, i) => (
                        <li key={i} style={{ fontSize: '.83rem', color: 'rgba(255,255,255,.78)', lineHeight: 1.55 }}>
                          <InlineText text={n.text} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
