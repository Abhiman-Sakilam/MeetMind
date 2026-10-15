# Jarvis Wake Robustness + Brain Intent Routing Implementation Plan

**Goal:** Make "Jarvis" wake reliably mid-sentence in any mode (incl. barge-in), and make the brain's intent router accurate, traceable, and cover Cancel/Repeat.

**Architecture:** Part A (meet-mind React frontend) — one tiered pure matcher `matchWake`, wake decoupled from recording/notes, error-recovery backoff instead of auto-disable, barge-in via the caption recognizer that already runs during capture. Part B (ai-brain-orchestration FastAPI) — keyword tier keeps only strong word-boundary phrases and returns a decision object; everything weak falls to the LLM router; a `routing` debug field is attached to every response; two new intents CANCEL + REPEAT.

**Tech Stack:** TypeScript + Vite 8 + Vitest (frontend); Python 3.11 + FastAPI + Pydantic + LangChain/Groq + pytest (backend).

## Global Constraints

- Must not break existing features (project guidelines). All changes additive / behavior-preserving.
- Do NOT optimize routing latency; the LLM router still runs on ambiguous input.
- Frontend: keep Chrome/Edge + https requirement; keep manual "Voice AI" toggle and "Jarvis" summon button behavior.
- Backend: `meeting_end` → `SUMMARY_FINAL` short-circuit must be preserved; `reply`/`intent`/`actions`/`artifacts`/`ui_event` semantics unchanged.
- Repo is **not** git-initialized. Before Task A0, run `git init` in the project root once, OR treat each "Commit" step as a logical checkpoint (stage + review) without failing the task.
- New keyword matching is word-boundary based (`\b`), never bare substring.

---

## Part A — Wake Robustness (meet-mind/frontend)

File map:
- `meet-mind/frontend/package.json` — add vitest devDep + `test` script (Task A0)
- `meet-mind/frontend/vitest.config.ts` — new (Task A0)
- `meet-mind/frontend/src/lib/wakeWord.ts` — add `matchWake` + dedupe/backoff helpers (Tasks A1, A2, A3)
- `meet-mind/frontend/src/lib/wakeWord.test.ts` — new unit tests (Tasks A1, A2, A3)
- `meet-mind/frontend/src/hooks/useWakeWord.ts` — use matcher, debounce, error recovery, decouple modes (Task A4)
- `meet-mind/frontend/src/hooks/useVoiceCapture.ts` — barge-in via caption scan (Task A5)

---

### Task A0: Vitest test harness

**Files:**
- Modify: `meet-mind/frontend/package.json`
- Create: `meet-mind/frontend/vitest.config.ts`

**Interfaces:**
- Produces: `npm test` runs vitest in `src/**/*.test.ts`.

- [ ] **Step 1: Add vitest dev dependency**

Run: `cd meet-mind/frontend && npm install -D vitest@^2`
Expected: `vitest` added under devDependencies.

- [ ] **Step 2: Add test script to `package.json`**

In the `"scripts"` block add:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Sanity test**

Create `meet-mind/frontend/src/lib/_smoke.test.ts`:
```ts
import { test, expect } from 'vitest';
test('vitest runs', () => { expect(1 + 1).toBe(2); });
```
Run: `cd meet-mind/frontend && npm test`
Expected: 1 passing test.

- [ ] **Step 5: Remove smoke test + commit**

```bash
rm meet-mind/frontend/src/lib/_smoke.test.ts
git add meet-mind/frontend/package.json meet-mind/frontend/vitest.config.ts meet-mind/frontend/package-lock.json
git commit -m "chore(frontend): add vitest harness"
```

---

### Task A1: `matchWake` tiered matcher

**Files:**
- Modify: `meet-mind/frontend/src/lib/wakeWord.ts`
- Test: `meet-mind/frontend/src/lib/wakeWord.test.ts`

**Interfaces:**
- Produces:
  - `type WakeMatch = { matched: boolean; index: number; confidence: 'high' | 'low' }`
  - `matchWake(text: string): WakeMatch` — `index` is the char offset of the matched name token in the normalized string (-1 when no match).
  - `containsWakePhrase(text)` and `containsInterimWakeHint(text)` remain exported, now thin wrappers (unchanged return type `boolean`).

- [ ] **Step 1: Write failing tests** — `meet-mind/frontend/src/lib/wakeWord.test.ts`

```ts
import { test, expect } from 'vitest';
import { matchWake, containsWakePhrase } from './wakeWord';

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
```

- [ ] **Step 2: Run to verify fail**

Run: `cd meet-mind/frontend && npm test -- wakeWord`
Expected: FAIL — `matchWake` is not exported.

- [ ] **Step 3: Implement `matchWake` in `wakeWord.ts`**

Keep the existing `normalizeWake`, `NAME_TOKEN`, `getSpeechRecognitionCtor`, `isWakeWordSupported`. Add above the existing `containsWakePhrase`:

```ts
export type WakeMatch = { matched: boolean; index: number; confidence: 'high' | 'low' };

const HIGH_PATTERNS = [
  new RegExp(`\\b(hi|hey|hello|okay|ok|yo)\\s+${NAME_TOKEN}\\b`),
  new RegExp(`^${NAME_TOKEN}\\b`),
  new RegExp(`\\b${NAME_TOKEN}\\s*[,]`),
  new RegExp(`[,.]\\s*${NAME_TOKEN}\\b`),
];
const LOW_PATTERN = new RegExp(`\\b${NAME_TOKEN}\\b`);

/** Tiered wake matcher: high = explicit summon, low = bare name anywhere. */
export function matchWake(text: string): WakeMatch {
  const collapsed = normalizeWake(text);
  if (!collapsed) return { matched: false, index: -1, confidence: 'low' };
  for (const re of HIGH_PATTERNS) {
    const m = collapsed.match(re);
    if (m) return { matched: true, index: m.index ?? 0, confidence: 'high' };
  }
  const low = collapsed.match(LOW_PATTERN);
  if (low) return { matched: true, index: low.index ?? 0, confidence: 'low' };
  return { matched: false, index: -1, confidence: 'low' };
}
```

Then replace the bodies of the two existing exports to delegate (keep their names/signatures):

```ts
export function containsWakePhrase(text: string): boolean {
  return matchWake(text).matched;
}

export function containsInterimWakeHint(text: string): boolean {
  return matchWake(text).matched;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd meet-mind/frontend && npm test -- wakeWord`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add meet-mind/frontend/src/lib/wakeWord.ts meet-mind/frontend/src/lib/wakeWord.test.ts
git commit -m "feat(wake): tiered matchWake, mid-sentence detection"
```

---

### Task A2: Per-occurrence dedupe helper

**Files:**
- Modify: `meet-mind/frontend/src/lib/wakeWord.ts`
- Test: `meet-mind/frontend/src/lib/wakeWord.test.ts`

**Interfaces:**
- Produces: `wakeOccurrenceKey(text: string, match: WakeMatch): string` — a stable id for one spoken wake, so a re-scanned sliding window does not double-fire. Empty string when `!match.matched`.

- [ ] **Step 1: Append failing tests** to `wakeWord.test.ts`

```ts
import { wakeOccurrenceKey } from './wakeWord';

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
```

- [ ] **Step 2: Run to verify fail**

Run: `cd meet-mind/frontend && npm test -- wakeWord`
Expected: FAIL — `wakeOccurrenceKey` not exported.

- [ ] **Step 3: Implement in `wakeWord.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `cd meet-mind/frontend && npm test -- wakeWord`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add meet-mind/frontend/src/lib/wakeWord.ts meet-mind/frontend/src/lib/wakeWord.test.ts
git commit -m "feat(wake): per-occurrence dedupe key"
```

---

### Task A3: Backoff helper for error recovery

**Files:**
- Modify: `meet-mind/frontend/src/lib/wakeWord.ts`
- Test: `meet-mind/frontend/src/lib/wakeWord.test.ts`

**Interfaces:**
- Produces: `wakeRetryDelayMs(attempt: number): number` — exponential backoff, `attempt` 0-based, capped at 5000 ms; returns -1 when `attempt >= 5` (give up).

- [ ] **Step 1: Append failing tests**

```ts
import { wakeRetryDelayMs } from './wakeWord';

test('backoff grows then caps', () => {
  expect(wakeRetryDelayMs(0)).toBe(300);
  expect(wakeRetryDelayMs(1)).toBe(600);
  expect(wakeRetryDelayMs(4)).toBe(4800);
  expect(wakeRetryDelayMs(5)).toBe(-1);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd meet-mind/frontend && npm test -- wakeWord`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

```ts
/** Exponential backoff for restarting wake recognition after transient errors. */
export function wakeRetryDelayMs(attempt: number): number {
  if (attempt >= 5) return -1;
  return Math.min(5000, 300 * 2 ** attempt);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd meet-mind/frontend && npm test -- wakeWord`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add meet-mind/frontend/src/lib/wakeWord.ts meet-mind/frontend/src/lib/wakeWord.test.ts
git commit -m "feat(wake): retry backoff helper"
```

---

### Task A4: Wire wake hook — debounce, cooldown, error recovery, mode decoupling

**Files:**
- Modify: `meet-mind/frontend/src/hooks/useWakeWord.ts`

**Interfaces:**
- Consumes: `matchWake`, `wakeOccurrenceKey`, `wakeRetryDelayMs`, `getSpeechRecognitionCtor` from `../lib/wakeWord`.
- Produces: unchanged hook return shape (`wakePausedForVoiceRef`, `wakeWordListeningRef`, `stopWakeRecognition`, `scheduleWakeRestart`).

- [ ] **Step 1: Import the new helpers**

Change the import at the top from `containsWakePhrase, containsInterimWakeHint, getSpeechRecognitionCtor` to:
```ts
import {
  matchWake,
  wakeOccurrenceKey,
  wakeRetryDelayMs,
  getSpeechRecognitionCtor,
} from '../lib/wakeWord';
```

- [ ] **Step 2: Add dedupe + attempt refs**

Next to the existing refs (near `wakeCooldownUntilRef`), add:
```ts
  const lastWakeKeyRef = useRef('');
  const wakeErrorAttemptsRef = useRef(0);
```

- [ ] **Step 3: Replace the wake-detection block in `onresult`**

Replace the current `wakeMatched` computation and its `if (wakeMatched) { ... }` skip / auto-note branch (the block spanning the `const wakeWindow = heardTrim.slice(-200);` line through the `void submitAutoNoteChunk(finalizedChunk);` branch) with:

```ts
        const wakeWindow = heardTrim.slice(-200);
        const wm = matchWake(wakeWindow);
        const occKey = wakeOccurrenceKey(wakeWindow, wm);
        const withinCooldown = Date.now() < wakeCooldownUntilRef.current;
        const alreadyFired = occKey !== '' && occKey === lastWakeKeyRef.current;
        const wakeMatched = wm.matched && !withinCooldown && !alreadyFired;

        if (wakeMatched) {
          /* Skip auto-note — this chunk is a Jarvis command. */
        } else if (hasFinalInBatch && finalizedChunk && !wm.matched) {
          void submitAutoNoteChunk(finalizedChunk);
        }
        if (!wakeMatched) return;
        lastWakeKeyRef.current = occKey;
        wakeErrorAttemptsRef.current = 0;
```

Then change the cooldown line that follows from `Date.now() + 4500` to:
```ts
        wakeCooldownUntilRef.current = Date.now() + 1200;
```
(Leave the rest of the fire path — `wakePausedForVoiceRef.current = true; stopWakeRecognition(); addAssistantMessage(...); void startVoiceRecordingRef.current();` — unchanged.)

- [ ] **Step 4: Error recovery instead of disabling Voice AI**

In the `r.onerror` handler, replace the `audio-capture` and `network` branches (currently each calls `setVoiceAiMode(false)`) with backoff-retry:

```ts
        if (event.error === 'network' || event.error === 'audio-capture') {
          const delay = wakeRetryDelayMs(wakeErrorAttemptsRef.current++);
          if (delay < 0) {
            addAssistantMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content:
                'Voice AI: microphone/network kept failing. Toggle Voice AI again to retry.',
              timestamp: new Date(),
              type: 'text',
            });
            setVoiceAiMode(false);
            return;
          }
          wakeRestartTimerRef.current = setTimeout(() => {
            wakeRestartTimerRef.current = null;
            scheduleWakeRestartRef.current();
          }, delay);
          return;
        }
```
Keep the `not-allowed` / `service-not-allowed` branch as-is (genuine permission denial → disable). `wakeErrorAttemptsRef.current` is reset to 0 on a successful wake (Step 3).

- [ ] **Step 5: Confirm mode decoupling (no code if already true)**

Verify the watchdog `useEffect` and `scheduleWakeRestart` gate only on `wakeWordListeningRef`/`wakePausedForVoiceRef`/`isRecordingVoiceRef` — NOT on meeting `isRecording`. They already do. Add a one-line comment above `scheduleWakeRestart`:
```ts
  // Wake stays alive across meeting-recording and notes modes; only command
  // capture (isRecordingVoiceRef) and explicit pause suspend it.
```

- [ ] **Step 6: Type-check**

Run: `cd meet-mind/frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `cd meet-mind/frontend && npm run dev`, open in Chrome on localhost, enable Voice AI. Verify:
- Say a long sentence with "jarvis" in the middle → "Listening for your question…" appears.
- Start meeting recording, then say "hey jarvis" → still wakes (wake not turned off).
- Say "jarvis" twice quickly → wakes each time (cooldown 1.2 s), no double-fire on one utterance.

- [ ] **Step 8: Commit**

```bash
git add meet-mind/frontend/src/hooks/useWakeWord.ts
git commit -m "feat(wake): mid-sentence + debounce + error recovery, decoupled from recording"
```

---

### Task A5: Barge-in during command capture

**Files:**
- Modify: `meet-mind/frontend/src/hooks/useVoiceCapture.ts`

**Interfaces:**
- Consumes: `matchWake` from `../lib/wakeWord` (file already imports `getSpeechRecognitionCtor, isWakeWordSupported`).
- Produces: no signature change; adds barge-in restart of the in-flight capture.

- [ ] **Step 1: Add `matchWake` to the existing wakeWord import**

Change `import { getSpeechRecognitionCtor, isWakeWordSupported } from '../lib/wakeWord';` to:
```ts
import { getSpeechRecognitionCtor, isWakeWordSupported, matchWake } from '../lib/wakeWord';
```

- [ ] **Step 2: Detect a fresh wake in the live caption during capture**

Locate the caption recognizer `onresult` handler inside the recording flow (the one that updates `liveCaption` / `setLiveCaption`). After it computes the interim/final caption text (call it `captionText`), add — guarded so the very first words that triggered this capture are ignored via a short grace period:

```ts
        // Barge-in: a NEW "jarvis" spoken mid-command restarts capture as a fresh command.
        const sinceStart = Date.now() - recordingStartedAtRef.current;
        if (sinceStart > 1500 && matchWake(captionText).matched) {
          void restartVoiceCaptureForBargeIn();
          return;
        }
```

- [ ] **Step 3: Implement `restartVoiceCaptureForBargeIn`**

Add near the `startVoiceRecordingRef` definition:

```ts
  const restartVoiceCaptureForBargeIn = useCallback(async () => {
    // Drop the current (interrupted) recording without sending it to the brain,
    // then immediately begin a new capture window.
    voiceChunksRef.current = [];
    flushAndStopMediaRecorder(recorderRef.current);
    stopVadMonitoring();
    setLiveCaption('');
    addAssistantMessage({
      id: crypto.randomUUID(),
      role: 'system',
      content: 'Restarting — go ahead.',
      timestamp: new Date(),
      type: 'text',
    });
    await startVoiceRecordingRef.current();
  }, [addAssistantMessage, stopVadMonitoring]);
```

(`recordingStartedAtRef` is already set at capture start for VAD max-duration; reuse it. If a grep shows it is not set at the very start of `startVoiceRecording`, add `recordingStartedAtRef.current = Date.now();` as the first line there.)

- [ ] **Step 4: Guard against send-after-barge-in**

In the recorder `onstop`/send path, if `voiceChunksRef.current` is empty (barge-in cleared it) skip the POST. Add at the start of the blob-assembly logic:
```ts
      if (voiceChunksRef.current.length === 0) return;
```

- [ ] **Step 5: Type-check**

Run: `cd meet-mind/frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

`npm run dev`, enable Voice AI, say "hey jarvis", wait for "Listening…", start answering, then say "hey jarvis" again mid-answer → "Restarting — go ahead." appears and a new capture starts; the interrupted audio is not sent.

- [ ] **Step 7: Commit**

```bash
git add meet-mind/frontend/src/hooks/useVoiceCapture.ts
git commit -m "feat(wake): barge-in restarts capture on fresh wake"
```

---

## Part B — Brain Intent Routing (ai-brain-orchestration)

File map:
- `ai-brain-orchestration/app/schemas.py` — add `RoutingInfo`, `routing` field (Task B1)
- `ai-brain-orchestration/app/orchestrator.py` — strong-only keyword tier + decision object, LLM decision, attach routing, CANCEL/REPEAT (Tasks B2, B3, B4)
- `ai-brain-orchestration/tests/test_orchestrator.py` — routing + intent tests (Tasks B2, B4)

---

### Task B1: `RoutingInfo` schema + response field

**Files:**
- Modify: `ai-brain-orchestration/app/schemas.py`

**Interfaces:**
- Produces:
  - `class RoutingInfo(BaseModel)` with `route: str`, `decided_by: str`, `matched: str | None = None`, `confidence: str = "low"`, `reason: str | None = None`.
  - `ExecuteResponse.routing: RoutingInfo | None = None` (additive, optional).

- [ ] **Step 1: Add `RoutingInfo` above `ExecuteResponse` in `schemas.py`**

```python
class RoutingInfo(BaseModel):
    route: str
    decided_by: str  # "keyword" | "llm" | "phase"
    matched: str | None = None
    confidence: str = "low"  # "high" | "low"
    reason: str | None = None
```

- [ ] **Step 2: Add the field to `ExecuteResponse`**

After the `artifacts` field, add:
```python
    routing: RoutingInfo | None = Field(
        default=None,
        description="Internal routing debug info (route, decided_by, matched, confidence, reason).",
    )
```

- [ ] **Step 3: Import check**

Run: `cd ai-brain-orchestration && python -c "from app.schemas import RoutingInfo, ExecuteResponse; ExecuteResponse(reply='x')"`
Expected: no error.

- [ ] **Step 4: Commit**

```bash
git add ai-brain-orchestration/app/schemas.py
git commit -m "feat(routing): RoutingInfo schema + optional response field"
```

---

### Task B2: Strong-only keyword tier returning a decision

**Files:**
- Modify: `ai-brain-orchestration/app/orchestrator.py`
- Test: `ai-brain-orchestration/tests/test_orchestrator.py`

**Interfaces:**
- Produces:
  - `_keyword_route(text: str) -> tuple[str | None, str | None]` — `(route, matched_phrase)` for a strong word-boundary phrase, else `(None, None)`.
  - `_llm_route(llm, req, memory) -> str` — the extracted LLM classification (route string only; refined to a tuple in Task B3).
  - `_route_intent(llm, req, memory) -> tuple[str, RoutingInfo]` (was `-> str`).

- [ ] **Step 1: Write failing tests** — append to `tests/test_orchestrator.py`

```python
from app.orchestrator import _route_intent, _keyword_route
from app.schemas import ExecuteRequest


def _req(text, **kw):
    return ExecuteRequest(user_id="u", room_id="r", text=text, **kw)


def test_keyword_strong_phrase_start_notes():
    route, matched = _keyword_route("please start taking notes now")
    assert route == "START_NOTES"
    assert matched == "start taking notes"


def test_keyword_ignores_weak_be_a():
    # "be a" must NOT trigger PLAY_ROLE anymore
    assert _keyword_route("could you be a bit quieter")[0] is None


def test_keyword_ignores_passing_next_steps():
    assert _keyword_route("we discussed the next steps briefly")[0] is None


def test_keyword_word_boundary_not_substring():
    # "noted" should not fire the note family
    assert _keyword_route("he noted the time")[0] is None


def test_meeting_end_is_phase_decision():
    route, info = _route_intent(None, _req("wrap up", meeting_phase="meeting_end"), {})
    assert route == "SUMMARY_FINAL"
    assert info.decided_by == "phase"
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ai-brain-orchestration && pytest tests/test_orchestrator.py -k "keyword or phase" -v`
Expected: FAIL — `_keyword_route` not defined; `_route_intent` returns str not tuple.

- [ ] **Step 3: Add `_keyword_route` and refactor `_route_intent`**

Add the import: in the `from app.schemas import (...)` block add `RoutingInfo`.

Add a strong-phrase table + matcher above `_route_intent`:

```python
# Strong, explicit multi-word phrases only. Weak/ambiguous cues (e.g. "be a",
# a passing "next steps") are intentionally NOT here — they go to the LLM router.
_STRONG_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("START_NOTES", ("start taking notes", "start notes", "begin notes",
                     "take notes", "note this down", "start tracking notes")),
    ("STOP_NOTES", ("stop taking notes", "stop notes", "end notes",
                    "finish notes", "stop tracking notes")),
    ("SHOW_NOTES", ("show notes", "show me the notes", "show me my notes",
                    "read the notes", "view notes", "display notes")),
    ("SCREEN_CAPTURE_ANALYZE", ("analyze the screen", "look at the screen",
                                "look at my screen", "read my screen",
                                "screen capture", "take a screenshot")),
    ("DEVIL_ADVOCATE", ("devils advocate", "play devils advocate",
                        "poke holes", "argue against")),
    ("BRAINSTORM", ("brainstorm", "generate ideas", "come up with ideas",
                    "give me ideas", "suggest ideas")),
    ("HELP_DECIDE", ("help me decide", "help us decide", "which option",
                     "compare options", "pros and cons")),
    ("ACTION_ITEMS", ("action items", "list the tasks", "task list",
                      "todo list", "to do list", "assign tasks")),
    ("EXIT_ROLE", ("exit role", "stop role", "end role", "leave role",
                   "stop acting", "stop playing", "be yourself")),
    ("PLAY_ROLE", ("act as", "play the role", "pretend you are", "roleplay",
                   "role play", "take the role", "speak as")),
    ("CANCEL", ("never mind", "nevermind", "cancel that", "scrap that",
                "forget it", "cancel it")),
    ("REPEAT", ("say that again", "repeat that", "come again",
                "what did you say", "repeat please")),
]


def _keyword_route(text: str) -> tuple[str | None, str | None]:
    """Return (route, matched_phrase) for a strong word-boundary phrase, else (None, None)."""
    lower = _normalize(text)
    for route, phrases in _STRONG_KEYWORDS:
        for phrase in phrases:
            if re.search(rf"\b{re.escape(phrase)}\b", lower):
                return route, phrase
    return None, None
```

Move the existing LLM body (the `payload = json.dumps(...)` block through the `return "GENERAL"` except-handler at the end of the current `_route_intent`) into a new helper that returns just the route string:

```python
def _llm_route(llm: BaseChatModel, req: ExecuteRequest, memory: dict[str, object]) -> str:
    payload = json.dumps(
        {
            "text": req.text,
            "source": req.source or "chat",
            "trigger": req.trigger,
            "meeting_phase": req.meeting_phase,
            "context": req.context or {},
            "memory": memory,
        },
        ensure_ascii=False,
    )
    try:
        res = llm.invoke([SystemMessage(content=ROUTER_PROMPT), HumanMessage(content=payload)])
        raw = res.content if isinstance(res.content, str) else "{}"
        data = json.loads(raw)
        route = str(data.get("route", "GENERAL")).strip().upper()
        allowed = {
            "SUMMARY_NOW", "SUMMARY_PERIODIC", "SUMMARY_FINAL",
            "START_NOTES", "STOP_NOTES", "SHOW_NOTES", "SCREEN_CAPTURE_ANALYZE",
            "PLAY_ROLE", "BRAINSTORM", "HELP_DECIDE", "DEVIL_ADVOCATE",
            "ACTION_ITEMS", "GENERAL",
        }
        return route if route in allowed else "GENERAL"
    except Exception as exc:
        logger.warning("Router classification failed, defaulting to GENERAL: %s", exc)
        return "GENERAL"
```

Replace the whole body of `_route_intent` with:

```python
def _route_intent(llm: BaseChatModel, req: ExecuteRequest, memory: dict[str, object]) -> tuple[str, RoutingInfo]:
    # meeting_end is unambiguous — beats any keyword in the text.
    if (req.meeting_phase or "").lower() == "meeting_end":
        return "SUMMARY_FINAL", RoutingInfo(route="SUMMARY_FINAL", decided_by="phase", confidence="high")

    kw_route, matched = _keyword_route(req.text)
    if kw_route:
        return kw_route, RoutingInfo(route=kw_route, decided_by="keyword", matched=matched, confidence="high")

    route = _llm_route(llm, req, memory)
    return route, RoutingInfo(route=route, decided_by="llm", confidence="low")
```

- [ ] **Step 4: Update the caller in `run_execute`**

Change:
```python
    route = _route_intent(_build_llm(settings.model_router, 0.0), req, memory)
```
to:
```python
    route, routing_info = _route_intent(_build_llm(settings.model_router, 0.0), req, memory)
    logger.info("route=%s decided_by=%s matched=%s", routing_info.route, routing_info.decided_by, routing_info.matched)
```
(`routing_info` is attached to the response in Task B3 Step 3. Until then it is only logged — safe.)

- [ ] **Step 5: Run tests**

Run: `cd ai-brain-orchestration && pytest tests/test_orchestrator.py -k "keyword or phase" -v`
Expected: PASS. Then full file: `pytest tests/test_orchestrator.py -v` — existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add ai-brain-orchestration/app/orchestrator.py ai-brain-orchestration/tests/test_orchestrator.py
git commit -m "feat(routing): strong-only keyword tier with decision object"
```

---

### Task B3: LLM router returns reason + attach routing to responses

**Files:**
- Modify: `ai-brain-orchestration/app/orchestrator.py`

**Interfaces:**
- Consumes: `_llm_route` from Task B2, `RoutingInfo` from Task B1.
- Produces: `_llm_route` returns `tuple[str, str]` (route, reason); a new `_dispatch_route(route, req, memory) -> ExecuteResponse`; every `ExecuteResponse` from `run_execute` carries `routing`.

- [ ] **Step 1: Extend `ROUTER_PROMPT`**

Append to the `ROUTER_PROMPT` string (before the closing `"""`):
```
Also allowed: CANCEL (user retracts/aborts a request, e.g. "never mind"), REPEAT (user asks to hear the last answer again, e.g. "say that again").
Return JSON: {"route": <ROUTE>, "confidence": "high"|"low", "reason": <short why>}.
```

- [ ] **Step 2: Update `_llm_route` to parse reason + include new routes**

Replace the parse/return lines inside `_llm_route`:
```python
        route = str(data.get("route", "GENERAL")).strip().upper()
        reason = str(data.get("reason", "")).strip()[:200]
        allowed = {
            "SUMMARY_NOW", "SUMMARY_PERIODIC", "SUMMARY_FINAL",
            "START_NOTES", "STOP_NOTES", "SHOW_NOTES", "SCREEN_CAPTURE_ANALYZE",
            "PLAY_ROLE", "BRAINSTORM", "HELP_DECIDE", "DEVIL_ADVOCATE",
            "ACTION_ITEMS", "CANCEL", "REPEAT", "GENERAL",
        }
        return (route if route in allowed else "GENERAL"), reason
    except Exception as exc:
        logger.warning("Router classification failed, defaulting to GENERAL: %s", exc)
        return "GENERAL", "router error"
```
Update its signature to `-> tuple[str, str]`. Update `_route_intent`'s LLM branch to:
```python
    route, reason = _llm_route(llm, req, memory)
    return route, RoutingInfo(route=route, decided_by="llm", confidence="low", reason=reason)
```

- [ ] **Step 3: Attach `routing` via one wrapper**

Extract the current `try/except` dispatch body of `run_execute` (from `try:` through the final `return _run_general(...)` line and its `except Exception` handler) into:
```python
def _dispatch_route(route: str, req: ExecuteRequest, memory: dict[str, object]) -> ExecuteResponse:
    try:
        ...  # the moved dispatch body, verbatim
    except Exception as e:
        logger.exception("LangChain execute failed: %s", e)
        return ExecuteResponse(reply="Sorry, I hit an error processing that. Try again in a moment.", intent="UNKNOWN", actions=[])
```
Then in `run_execute`, replace the old inline `try/except` with:
```python
    resp = _dispatch_route(route, req, memory)
    resp.routing = routing_info
    return resp
```
The early guards (empty text, missing GROQ key, persona_switch) stay BEFORE routing exactly as-is; they return without `routing` (acceptable — `None`).

- [ ] **Step 4: Run full tests**

Run: `cd ai-brain-orchestration && pytest tests/test_orchestrator.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ai-brain-orchestration/app/orchestrator.py
git commit -m "feat(routing): llm reason + attach routing debug to every response"
```

---

### Task B4: CANCEL + REPEAT handlers

**Files:**
- Modify: `ai-brain-orchestration/app/orchestrator.py`
- Test: `ai-brain-orchestration/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `SESSION_STORE.get_context_window(user_id, room_id)` → `{"recent_turns": [{"role","text"}], ...}`; `SESSION_STORE.clear_role`, `SESSION_STORE.append_turn`, `SESSION_STORE.clear`.
- Produces: `_dispatch_route` handles `route == "CANCEL"` and `route == "REPEAT"` before the auto-note/general fallback.

- [ ] **Step 1: Write failing tests** — append to `tests/test_orchestrator.py`

```python
from app.orchestrator import run_execute, SESSION_STORE


def test_cancel_intent_ack_no_agent():
    # keyword tier routes this without any LLM call
    resp = run_execute(_req("never mind, cancel that", user_name="A"))
    assert resp.intent == "CANCEL"
    assert resp.reply  # non-empty ack


def test_repeat_returns_last_assistant_reply():
    uid, rid = "u-rep", "r-rep"
    SESSION_STORE.clear(uid, rid)
    SESSION_STORE.append_turn(uid, rid, "user", "hello")
    SESSION_STORE.append_turn(uid, rid, "assistant", "The budget is 42k.")
    resp = run_execute(ExecuteRequest(user_id=uid, room_id=rid, text="say that again"))
    assert "42k" in resp.reply
    assert resp.intent == "REPEAT"
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ai-brain-orchestration && pytest tests/test_orchestrator.py -k "cancel or repeat" -v`
Expected: FAIL — routes fall through to GENERAL.

- [ ] **Step 3: Add handlers in `_dispatch_route`**

Inside `_dispatch_route`, before the auto-note block (`notes_state_obj = NOTES_STORE.get(...)`), add:

```python
        if route == "CANCEL":
            SESSION_STORE.clear_role(req.user_id, req.room_id)
            reply = "Okay, cancelled. What next?"
            _append_conversation(req, reply)
            return ExecuteResponse(reply=reply, intent="CANCEL", actions=[], ui_event="CANCELLED")

        if route == "REPEAT":
            turns = memory.get("recent_turns") or []
            last = next((t["text"] for t in reversed(turns) if t.get("role") == "assistant"), "")
            reply = last or "I don't have anything to repeat yet."
            return ExecuteResponse(reply=reply, intent="REPEAT", actions=[])
```

(REPEAT deliberately does NOT call `_append_conversation`, so repeating does not pollute history.)

- [ ] **Step 4: Run tests**

Run: `cd ai-brain-orchestration && pytest tests/test_orchestrator.py -k "cancel or repeat" -v`
Expected: PASS. Then `pytest tests/test_orchestrator.py -v` — all pass.

- [ ] **Step 5: Commit**

```bash
git add ai-brain-orchestration/app/orchestrator.py ai-brain-orchestration/tests/test_orchestrator.py
git commit -m "feat(routing): CANCEL and REPEAT intents"
```

---

## Final verification

- [ ] Backend: `cd ai-brain-orchestration && pytest -q` → all green.
- [ ] Frontend: `cd meet-mind/frontend && npm test && npx tsc -b --noEmit` → all green.
- [ ] Manual smoke (both services up via `./start.sh`): wake mid-sentence during recording; barge-in; ask "say that again"; confirm server logs show a `route=… decided_by=…` line and responses carry a `routing` object.
