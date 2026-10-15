import { test, expect } from 'vitest';
import {
  matchWake,
  containsWakePhrase,
  wakeOccurrenceKey,
  wakeRetryDelayMs,
} from './wakeWord';

test('mid-sentence jarvis matches (low confidence)', () => {
  const m = matchWake('so then jarvis can you summarize');
  expect(m.matched).toBe(true);
  expect(m.confidence).toBe('low');
  expect(m.index).toBeGreaterThan(0);
});

test('hey jarvis matches high confidence', () => {
  expect(matchWake('hey jarvis').confidence).toBe('high');
});

test('sentence-start jarvis is high confidence', () => {
  expect(matchWake('jarvis, summarize').confidence).toBe('high');
});

test('homophone garvis matches', () => {
  expect(matchWake('ok garvis help').matched).toBe(true);
});

test('embedded in longer word does not match', () => {
  expect(matchWake('the jarvisian era').matched).toBe(false);
});

test('no name does not match', () => {
  expect(matchWake('summarize the meeting').matched).toBe(false);
});

test('containsWakePhrase wrapper still works for finalized boundary case', () => {
  expect(containsWakePhrase('hey jarvis')).toBe(true);
});

test('same utterance yields same key', () => {
  const t = 'so then jarvis can you help';
  const k1 = wakeOccurrenceKey(t, matchWake(t));
  const k2 = wakeOccurrenceKey(t + ' more words', matchWake(t + ' more words'));
  expect(k1).toBe(k2);
});

test('new wake later in stream yields different key', () => {
  const a = 'hey jarvis';
  const b = 'hey jarvis ... later hey jarvis again';
  expect(wakeOccurrenceKey(a, matchWake(a)))
    .not.toBe(wakeOccurrenceKey(b, matchWake(b)));
});

test('no match yields empty key', () => {
  expect(wakeOccurrenceKey('nothing here', matchWake('nothing here'))).toBe('');
});

test('backoff grows then caps', () => {
  expect(wakeRetryDelayMs(0)).toBe(300);
  expect(wakeRetryDelayMs(1)).toBe(600);
  expect(wakeRetryDelayMs(4)).toBe(4800);
  expect(wakeRetryDelayMs(5)).toBe(-1);
});
