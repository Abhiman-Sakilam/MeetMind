/**
 * Wake phrases: "Hey Jarvis" or "Jarvis" open the voice command window.
 * Matching is lenient for browser STT mis-hearings (garvis, jervis, etc.).
 */
function normalizeWake(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Name-like tokens that often appear when users say "Jarvis". */
const NAME_TOKEN =
  '(jarvis|jarvus|jervis|jarvice|garvis|barvis|darvis|carvis|gervis)';

export type WakeMatch = { matched: boolean; index: number; confidence: 'high' | 'low' };

const NAME_GLOBAL = new RegExp(`\\b${NAME_TOKEN}\\b`, 'g');

/**
 * Tiered wake matcher. Anchors on the LAST name-token occurrence (the most
 * recent utterance in a growing interim window), then classifies confidence:
 * high = explicit summon ("hey jarvis", sentence-start, comma-adjacent),
 * low = bare name anywhere mid-sentence.
 */
export function matchWake(text: string): WakeMatch {
  const collapsed = normalizeWake(text);
  if (!collapsed) return { matched: false, index: -1, confidence: 'low' };
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  NAME_GLOBAL.lastIndex = 0;
  while ((m = NAME_GLOBAL.exec(collapsed)) !== null) last = m;
  if (!last) return { matched: false, index: -1, confidence: 'low' };

  const idx = last.index;
  const before = collapsed.slice(Math.max(0, idx - 8), idx);
  const after = collapsed.slice(idx + last[0].length);
  const highPrefix = /\b(hi|hey|hello|okay|ok|yo)\s+$/.test(before);
  const punctBefore = /[,.]\s*$/.test(before);
  const commaAfter = /^\s*,/.test(after);
  const atStart = idx === 0;
  const confidence: 'high' | 'low' =
    highPrefix || punctBefore || commaAfter || atStart ? 'high' : 'low';
  return { matched: true, index: idx, confidence };
}

/**
 * Stable id for a single spoken wake within a recognition session. Uses the
 * matched token plus a short window of the words that precede it, so the same
 * "jarvis" re-seen as the interim result grows keeps one identity, while a
 * genuinely new "jarvis" later in the stream gets a different one.
 */
export function wakeOccurrenceKey(text: string, match: WakeMatch): string {
  if (!match.matched) return '';
  const collapsed = normalizeWake(text);
  const start = Math.max(0, match.index - 24);
  return collapsed.slice(start, match.index + 8);
}

/** Exponential backoff for restarting wake recognition after transient errors. */
export function wakeRetryDelayMs(attempt: number): number {
  if (attempt >= 5) return -1;
  return Math.min(5000, 300 * 2 ** attempt);
}

export function containsWakePhrase(text: string): boolean {
  return matchWake(text).matched;
}

/**
 * Interim results only: conservative prefix so we can start listening before the
 * browser finalizes "Jarvis" (reduces missed wakes).
 */
export function containsInterimWakeHint(text: string): boolean {
  return matchWake(text).matched;
}

export function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function isWakeWordSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}
