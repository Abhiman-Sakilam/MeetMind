/** Markdown for meeting-end: one block per STT segment, readable in UI and exports. */
export function formatTranscriptMarkdown(
  rows: { speaker?: string; text?: string; at?: string | null }[],
): string {
  if (!rows?.length) return '';
  return rows
    .map((t) => {
      const speaker = (t.speaker || 'You').trim();
      const body = (t.text || '').trim();
      if (!body) return '';
      const at = t.at
        ? new Date(t.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
        : '';
      const header = at ? `**${speaker}** · *${at}*` : `**${speaker}**`;
      return `${header}\n\n${body}`;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
}
