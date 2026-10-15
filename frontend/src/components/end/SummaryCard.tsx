import { Brain } from 'lucide-react';
import { MarkdownMessage } from '../meeting/MarkdownMessage';

interface Props {
  summary: string;
}

export function SummaryCard({ summary }: Props) {
  return (
    <div className="bento-card bento-summary interactable" style={{ animationDelay: '.3s', overflowY: 'auto' }}>
      <div className="card-label">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'inherit' }}><Brain size={14} /> Meeting</span>
        <span>Summary</span>
      </div>
      {summary?.trim() ? (
        <div className="insight-text" style={{ fontSize: '.92rem', lineHeight: 1.7, marginTop: '.75rem' }}>
          <MarkdownMessage content={summary} />
        </div>
      ) : (
        <p style={{ opacity: .4, fontStyle: 'italic', fontSize: '.88rem' }}>No summary generated.</p>
      )}
    </div>
  );
}
