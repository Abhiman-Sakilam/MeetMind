import { BookOpen } from 'lucide-react';

interface Props {
  topics: string[];
  keywords: string[];
}

export function TopicsCard({ topics, keywords }: Props) {
  const empty = topics.length === 0 && keywords.length === 0;
  return (
    <div className="bento-card bento-topics interactable" style={{ animationDelay: '.2s' }}>
      <div className="card-label">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'inherit' }}><BookOpen size={14} /> Topics &</span>
        <span>Keywords</span>
      </div>
      {empty && (
        <p style={{ opacity: .55, fontSize: '.88rem', fontStyle: 'italic' }}>No topics detected for this session.</p>
      )}
      {topics.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '.75rem' }}>
          {topics.map((t, i) => (
            <span key={`t-${i}`} className="participant-tag highlight" style={{ fontSize: '.95rem', padding: '.5rem 1rem' }}>{t}</span>
          ))}
        </div>
      )}
      {keywords.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginTop: '.9rem' }}>
          {keywords.map((k, i) => (
            <span key={`k-${i}`} className="participant-tag" style={{ fontSize: '.72rem', opacity: .7, padding: '.3rem .65rem' }}>{k}</span>
          ))}
        </div>
      )}
    </div>
  );
}
