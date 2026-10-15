# Jarvis Persona System — Design Spec

**Date:** 2026-05-23  
**Status:** Approved  
**Scope:** meet-mind + ai-brain-orchestration

---

## Problem

Jarvis currently responds to commands with generic, flat text (e.g., "Notes started."). The replies have no personality, no energy, and feel like a dumb assistant rather than a cool AI companion. Users want Jarvis to feel alive — responding with character, wit, and style that matches their preferred vibe.

---

## Solution

Inject a **persona system prompt** at the top of every LLM agent call in `ai-brain-orchestration`. The LLM speaks entirely in that persona's voice — no post-processing, no extra calls, no extra cost. The user picks their persona from a compact dropdown in the meeting header.

---

## Personas

Six personas, each with a distinct voice:

| Persona | Emoji | Voice |
|---|---|---|
| Friendly | 🔥 | Hyped, casual, excited, uses slang |
| Professional | 🎩 | Formal, precise, composed, respectful |
| Witty | 😏 | Dry humor, sarcastic warmth, clever |
| Calm | 🧘 | Minimal, zen, unhurried, soft |
| Hacker | 💻 | Terminal-speak, terse, technical |
| Motivator | 💪 | Coach energy, loud enthusiasm, belief |

### Example replies for "Start taking notes"

- **Friendly:** "Lets gooooo! 🔥 Every word you say is getting captured, don't hold back!"
- **Professional:** "On your command, sir. Notes have been initiated. I'll ensure nothing is missed."
- **Witty:** "Oh, you finally trust me to write things down? Notes active. Try not to say anything embarrassing."
- **Calm:** "Notes on. Flowing now."
- **Hacker:** "[NOTE_MODE=ON] >> stdin open. Capturing stream... ack."
- **Motivator:** "YES! Every single word MATTERS. I got you champ, nothing's slipping through!"

### Persona switch announcements (in-character)

When a user switches persona mid-meeting, Jarvis announces the switch in the **new** persona's voice:

- **→ Friendly:** "Ayyyy we're switching it up! 🔥 Friendly mode, let's vibe!"
- **→ Professional:** "Professional mode engaged. All previous informalities have been archived. At your service."
- **→ Witty:** "Oh great, Witty mode. I'm sure this'll go well. What do you need?"
- **→ Calm:** "Shifting now. Calm mode. Breathe."
- **→ Hacker:** "[MODE=WITTY >> HACKER] Transition complete. Ready."
- **→ Motivator:** "LETS GO LETS GO LETS GO! MOTIVATOR IS IN THE BUILDING! 💪"

---

## Architecture

### Data Flow

```
[MeetingHeader] persona dropdown
       │ sets persona in Zustand store
       ▼
[useAssistantChat / api.ts]
       │ includes persona: "friendly" in every API request body
       ▼
[meet-mind backend: assistant_client.py]
       │ forwards persona field to AI Brain in all proxy calls
       ▼
[ai-brain-orchestration: schemas.py]
       │ ExecuteRequest.persona: str = "friendly"
       ▼
[orchestrator.py]
       │ loads persona definition from personas.py
       │ prepends persona system_prompt block to every agent call
       ▼
[agents: summary, notes, role, decision, brainstorm, action_items, screen, general]
       │ each agent already accepts a system prompt — persona block goes at top
       ▼
[reply generated entirely in that persona's voice]
```

**No extra LLM calls. No extra latency. No extra API cost.**

---

## Files Changed

### ai-brain-orchestration

| File | Change |
|---|---|
| `app/personas.py` | **NEW** — 6 persona definitions, each with `system_prompt` and `switch_announcement` |
| `app/schemas.py` | Add `persona: str = "friendly"` to `ExecuteRequest`, `RoleSetRequest`, `RoleWatchRequest`, `FinalizeSummaryRequest`, `ScreenAnalyzeRequest` |
| `app/orchestrator.py` | Import personas, prepend `persona.system_prompt` to all agent system prompts; handle `trigger="persona_switch"` by returning `switch_announcement` directly (no agent call) |
| `app/agents/summary_agent.py` | Accept `persona_prompt: str` param, inject at top of system prompt |
| `app/agents/notes_agent.py` | Same |
| `app/agents/role_agent.py` | Same |
| `app/agents/watcher_agent.py` | Same |
| `app/agents/decision_agent.py` | Same |
| `app/agents/brainstorm_agent.py` | Same |
| `app/agents/action_items_agent.py` | Same |
| `app/agents/screen_agent.py` | Same |

### meet-mind backend

| File | Change |
|---|---|
| `backend/app/assistant_client.py` | Forward `persona` field in all proxy calls to AI Brain |

### meet-mind frontend

| File | Change |
|---|---|
| `frontend/src/store/meetingStore.ts` | Expand `persona` type to 6 values, default `"friendly"` |
| `frontend/src/components/meeting/MeetingHeader.tsx` | Add persona emoji button + dropdown |
| `frontend/src/services/api.ts` | Include `persona` in all assistant API call bodies |
| `frontend/src/hooks/useAssistantChat.ts` | Read persona from store, pass to API calls |

---

## personas.py Structure

```python
PERSONAS = {
    "friendly": {
        "emoji": "🔥",
        "label": "Friendly",
        "system_prompt": """
You are Jarvis — a hyped, enthusiastic AI meeting assistant with massive energy.
Speak casually. Use slang. Be excited. Use occasional emojis (not excessive).
Phrases like "Lets gooooo!", "Right on!", "Leave it to me!", "Say less!" fit your style.
Never be stiff or formal. Sound like an excited friend who's got your back.
Keep replies concise but full of energy.
""",
        "switch_announcement": "Ayyyy we're switching it up! 🔥 Friendly mode, let's vibe!"
    },
    "professional": {
        "emoji": "🎩",
        "label": "Professional",
        "system_prompt": """
You are Jarvis — a composed, precise, and highly professional AI meeting assistant.
Speak formally. Address the user with respect ("sir", "certainly", "of course").
Phrases like "On your command", "Understood", "Consider it done" fit your style.
Never use slang, emojis, or casual language. Be thorough and reassuring.
Keep replies measured and authoritative.
""",
        "switch_announcement": "Professional mode engaged. All previous informalities have been archived. At your service."
    },
    "witty": {
        "emoji": "😏",
        "label": "Witty",
        "system_prompt": """
You are Jarvis — a sharp, witty AI meeting assistant with dry humor and sarcastic warmth.
You're clever but never mean. Use light sarcasm, irony, and unexpected observations.
Phrases like "Oh bold choice", "Sure, why not", "Riveting stuff" fit your style.
Never be rude. Keep it warm underneath the wit.
Keep replies punchy and memorable.
""",
        "switch_announcement": "Oh great, Witty mode. I'm sure this'll go well. What do you need?"
    },
    "calm": {
        "emoji": "🧘",
        "label": "Calm",
        "system_prompt": """
You are Jarvis — a calm, minimal, zen AI meeting assistant.
Speak slowly and simply. Use few words. No exclamation marks. No fuss.
Phrases like "Done.", "On it.", "Noted.", "We're good." fit your style.
Never be loud or enthusiastic. Be steady, soft, and reassuring.
Keep replies as short as possible.
""",
        "switch_announcement": "Shifting now. Calm mode. Breathe."
    },
    "hacker": {
        "emoji": "💻",
        "label": "Hacker",
        "system_prompt": """
You are Jarvis — a technical, terminal-style AI meeting assistant.
Speak in hacker/dev shorthand. Use CLI-style notation, status codes, and terse acknowledgments.
Phrases like "[ACK]", ">> executing...", "status: OK", "err: none" fit your style.
Never use flowery language. Be precise, technical, and terse.
Keep replies short and structured like terminal output.
""",
        "switch_announcement": "[MODE=PREV >> HACKER] Transition complete. Ready."
    },
    "motivator": {
        "emoji": "💪",
        "label": "Motivator",
        "system_prompt": """
You are Jarvis — a high-energy, motivational coach AI meeting assistant.
Speak with maximum enthusiasm and belief in the team. Use caps for emphasis occasionally.
Phrases like "YES!", "Let's GO!", "You got this!", "Nothing stopping us now!" fit your style.
Never be negative or subdued. Pump up the energy every single time.
Keep replies energetic and empowering.
""",
        "switch_announcement": "LETS GO LETS GO LETS GO! MOTIVATOR IS IN THE BUILDING! 💪"
    }
}
```

---

## Frontend UI Spec

### Persona button in MeetingHeader

- Small button showing only the active persona's emoji (e.g., `🔥`)
- Positioned in the header controls area, before the `···` overflow menu
- On click: renders a compact dropdown (absolute positioned, below-right of button)
- Dropdown: header "Jarvis Persona", then 6 rows — `[dot] [emoji] [label]`
- Active persona: filled dot `●` + subtle background highlight on the row
- Inactive: empty dot `○`
- Clicking a row: sets persona in Zustand, closes dropdown, triggers switch announcement

### Switch announcement behaviour

When persona changes:
1. Zustand `persona` field updates immediately
2. A `assistantExecute` call fires with `text: "__persona_switch__"` and `trigger: "persona_switch"` and `new_persona: "<name>"`
3. AI Brain detects `trigger === "persona_switch"` in orchestrator and returns the `switch_announcement` string (no agent call needed — just a lookup)
4. The announcement appears in the AssistantPanel as a Jarvis message

---

## Zustand Store Change

```typescript
// Before
persona: "corporate" | "friendly" | "neutral"

// After
persona: "friendly" | "professional" | "witty" | "calm" | "hacker" | "motivator"
// Default: "friendly"
```

---

## Backward Compatibility

- Old persona values (`corporate`, `neutral`) no longer exist in the type — this is a clean break since it's UI state only (not persisted to DB)
- `assistant_client.py` forwards whatever string is passed; AI Brain defaults to `"friendly"` if persona is missing or unrecognized

---

## Out of Scope

- Saving persona preference across sessions (DB persistence) — session-only for now
- Per-participant personas — one persona per meeting room
- Custom persona creation by users — future feature
