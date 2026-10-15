import { Mic, ChevronDown } from 'lucide-react';
import { MarkdownMessage } from '../meeting/MarkdownMessage';

interface Props {
  transcript: string;
}

export function TranscriptCard({ transcript }: Props) {
  const empty = !transcript?.trim();
  return (
    <div className="bento-card bento-transcript interactable" style={{ animationDelay: '.6s' }}>
      {empty ? (
        <>
          <div className="card-label">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'inherit' }}><Mic size={14} /> Spoken</span>
            <span>Transcript</span>
          </div>
          <p style={{ opacity: .55, fontSize: '.88rem', fontStyle: 'italic' }}>No spoken transcript captured.</p>
        </>
      ) : (
        <details className="disclosure">
          <summary>
            <span className="card-label" style={{ marginBottom: 0 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'inherit' }}><Mic size={14} /> Spoken</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>Transcript <ChevronDown size={14} className="chev" /></span>
            </span>
          </summary>
          <div className="insight-text" style={{ marginTop: '.75rem', fontSize: '.85rem', lineHeight: 1.6 }}>
            <MarkdownMessage content={transcript} />
          </div>
        </details>
      )}
    </div>
  );
}
