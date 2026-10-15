# Jarvis Wake Robustness + Brain Intent Routing — Design

Date: 2026-07-09
Status: Approved (design), pending implementation plan

## Problem

1. **Wake fails mid-sentence during recording.** Saying "Jarvis" in the middle of an
   utterance while a meeting/notes session is active does not activate the assistant.
2. **Brain intent routing misroutes** on weak keyword matches, is not traceable, and
   lacks a few common intents.

Constraint (from project guidelines): must not break existing features. Enhancement only.
Latency is explicitly **not** a goal for Part B.

## Scope

Two independent workstreams, shippable separately:

- **Part A** — `meet-mind/frontend` wake-word + voice-capture robustness (the real bug).
- **Part B** — `ai-brain-orchestration` intent routing accuracy, observability, coverage.

Out of scope: routing latency optimization; new STT/TTS engines; WebSocket audio; UI redesign.

---

## Part A — Wake Robustness (meet-mind frontend)

### Root causes

| # | Cause | File |
| - | ----- | ---- |
| A1 | `containsWakePhrase()` requires "Jarvis" at sentence start / after "hey" / adjacent to comma-period. Mid-sentence "…so Jarvis can you…" does not match on finalized text → dumped to auto-note. | `frontend/src/lib/wakeWord.ts:17` |
| A2 | Wake recognizer competes with meeting recording / command capture for the mic. On `audio-capture` or `network` error the handler calls `setVoiceAiMode(false)`, turning wake **off** entirely. | `frontend/src/hooks/useWakeWord.ts:144-181` |
| A3 | No barge-in: while a command is being captured (`isRecordingVoiceRef` / `wakePausedForVoiceRef`) the wake path is fully skipped. | `frontend/src/hooks/useWakeWord.ts:118-119` |
| A4 | 4.5 s cooldown (`:132`) blocks quick re-wake; sliding-window re-scan can double-fire on the same spoken "Jarvis". | `frontend/src/hooks/useWakeWord.ts:120-132` |

### Chosen approach: Loosen + unify + reuse

Single tiered matcher, wake decoupled from other modes, barge-in via the caption stream
that already runs during capture. No second `SpeechRecognition` instance.

### Changes

**A-1 Loose matcher (`lib/wakeWord.ts`)**
- Add `matchWake(text, { strict }): { matched: boolean; index: number; confidence: 'high' | 'low' }`.
- Low-confidence tier: `NAME_TOKEN` anywhere in text, guarded by word boundaries
  (`\b...\b`) so it does not fire inside longer words.
- High-confidence tier: existing boundary/`hey`-prefixed patterns.
- Keep `containsWakePhrase` / `containsInterimWakeHint` as thin wrappers over `matchWake`
  for backward compatibility (no other callers break).
- Both interim and final now use the loose tier; a mid-sentence "Jarvis" matches.

**A-2 Debounce, not just cooldown (`hooks/useWakeWord.ts`)**
- Track the character offset / token of the last fired wake within the current recognition
  session; do not re-fire for the same occurrence when the sliding window re-scans.
- Reduce cooldown 4500 ms → ~1200 ms so intentional quick re-wakes work.

**A-3 Survive mode changes (`hooks/useWakeWord.ts`)**
- On `audio-capture` / `network` errors: retry with exponential backoff (cap ~5 attempts)
  instead of `setVoiceAiMode(false)`. Only disable on `not-allowed` /
  `service-not-allowed` (genuine permission denial).
- Wake listening remains gated **only** by `voiceAiMode` — not by `isRecording` (meeting
  recording) or notes state. Entering meeting recording must not stop wake.

**A-4 Barge-in during command capture (`hooks/useVoiceCapture.ts`)**
- The caption recognizer (`captionRecognitionRef`) already produces live text while a
  command is being recorded. Scan its output with `matchWake`; if a fresh "Jarvis" is
  detected mid-capture, reset the current capture and start a new one (treat as a new
  command). This gives barge-in without a second recognizer.

### False-positive mitigation
- Word-boundary guard + per-occurrence debounce.
- Loose tier only escalates to command capture; it never sends text to the brain directly.
- If the meeting legitimately says "Jarvis", worst case is one spurious "Listening…"
  prompt, cancelled by VAD silence timeout with no brain call.

### Non-goals / preserved behavior
- Auto-note path unchanged: non-wake finalized chunks still go to `submitAutoNoteChunk`.
- Chrome/Edge + https requirement unchanged.
- Manual "Voice AI" toggle and "Jarvis" summon button unchanged.

### Testing (Part A)
- Unit: `matchWake` truth table — mid-sentence, boundary, "hey jarvis", homophones,
  bare token, embedded-in-word negative (`"jarvisian"` must not match).
- Manual: wake mid-sentence during meeting recording; wake during notes; barge-in while a
  prior command is being captured; mic-contention error → wake recovers instead of turning
  off.

---

## Part B — Brain Intent Routing (ai-brain-orchestration)

Files: `app/orchestrator.py` (`_route_intent`, `ROUTER_PROMPT`, `run_execute`),
`app/schemas.py` (`ExecuteResponse`).

### B-1 Accuracy / fewer misroutes
- Replace naive substring `any(k in lower ...)` with **word-boundary regex** matching.
- Remove / harden dangerous short keywords: `"be a"` (PLAY_ROLE), passing `"next steps"`
  (ACTION_ITEMS), `"trade off"` (HELP_DECIDE) must require a stronger phrase.
- Introduce keyword **confidence**: only short-circuit the LLM router on a *strong*
  explicit multi-word phrase. Weak/ambiguous hits fall through to the LLM router instead
  of committing to a possibly-wrong route.
- LLM router: return `{ route, confidence, reason }`; add few-shot examples for the
  confusable pairs (HELP_DECIDE vs GENERAL, PLAY_ROLE vs GENERAL).

### B-2 Observability
- Add internal `routing` field to `ExecuteResponse`:
  `{ route, decided_by: "keyword" | "llm" | "phase", matched, confidence, reason }`.
- Log it server-side at INFO. Not surfaced in end-user UI (frontend ignores the field).
- Existing behavior preserved: `reply`, `intent`, `actions`, `artifacts`, `ui_event`
  unchanged.

### B-3 New intents
- `CANCEL` — "never mind", "scrap that", "stop", "cancel that" → acknowledge + clear any
  pending action; no agent invocation.
- `REPEAT` — "say that again", "repeat that", "what did you say" → re-send last assistant
  reply from session memory.
- Follow-up / clarify stays in `GENERAL` (already handled by session memory). YAGNI on
  CONFIRM/DENY until a pending-action flow needs it.
- Add both to the `allowed` route set and the `ROUTER_PROMPT` enum.

### Non-goals / preserved behavior
- No latency work; LLM router still runs on ambiguous input.
- All existing routes and agents unchanged in behavior.
- `meeting_end` → `SUMMARY_FINAL` short-circuit preserved.

### Testing (Part B)
- Unit: `_route_intent` cases — "be a bit quiet" ≠ PLAY_ROLE; "what are our next steps
  here" vs passing "next steps"; CANCEL / REPEAT phrases; confusable GENERAL cases.
- Assert `routing.decided_by` / `matched` populated correctly.
- Regression: existing router examples still route as before.

---

## Rollout
- Part A and Part B are independent; either can merge first.
- No schema migration, no config change required (new `routing` field is additive and
  optional). Optional: env flag to raise routing log verbosity.
