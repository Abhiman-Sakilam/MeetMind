const VOWEL_RE = /[aeiouyAEIOUY]/;

/** Tokens that look like random consonant noise from flaky browser STT. */
function isLikelyGibberishToken(token: string): boolean {
  const t = token.replace(/[^a-zA-Z']/g, '');
  if (t.length < 5) return false;
  if (t.length > 22) return true;
  if (!VOWEL_RE.test(t)) return true;
  const vowels = (t.match(/[aeiouyAEIOUY]/g) ?? []).length;
  if (vowels / t.length < 0.14) return true;
  return false;
}

/**
 * Light cleanup for live captions / toolbar: drop garbage tokens, trim length.
 */
export function filterTranscriptNoise(raw: string, maxLen = 480): string {
  const words = raw.split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !isLikelyGibberishToken(w));
  let out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (out.length > maxLen) {
    out = `…${out.slice(-(maxLen - 1))}`;
  }
  return out;
}

/** Concatenate only finalized Web Speech segments (stable, less noisy than interim). */
export function finalizedTextFromSpeechEvent(event: SpeechRecognitionEvent): string {
  let out = '';
  for (let i = 0; i < event.results.length; i++) {
    const result = event.results[i];
    if (!result.isFinal) continue;
    out += result[0].transcript;
  }
  return out.trim();
}
