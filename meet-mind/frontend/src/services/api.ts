const API_BASE =
  import.meta.env.VITE_API_URL || `${window.location.origin}`;

/** localStorage key for the JWT access token. */
export const TOKEN_KEY = "mm_token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode / disabled) — ignore */
  }
}

/** Attach `Authorization: Bearer <token>` when a token is stored. */
function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Handle a 401 from any endpoint: drop the token and bounce to /login.
 * Guarded so it never loops while already on the login page.
 */
function handleUnauthorized(): void {
  setStoredToken(null);
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

function formatApiDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e: unknown) => {
        if (e && typeof e === "object" && "msg" in e) {
          return String((e as { msg: string }).msg);
        }
        try {
          return JSON.stringify(e);
        } catch {
          return String(e);
        }
      })
      .join("; ");
  }
  if (detail && typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch {
      return "Request failed";
    }
  }
  return "Request failed";
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", ...authHeaders(), ...opts.headers },
    });
  } catch (e) {
    const msg =
      e instanceof TypeError
        ? `${e.message} (check API is reachable: ${API_BASE})`
        : "Network error calling API";
    throw new ApiError(0, msg);
  }
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
    const raw = await res.text();
    let detail: unknown;
    try {
      detail = raw ? (JSON.parse(raw) as { detail?: unknown }).detail : undefined;
    } catch {
      detail = raw.slice(0, 300) || res.statusText;
    }
    const message =
      formatApiDetail(detail) === "Request failed" && raw
        ? `${res.status} ${res.statusText}: ${raw.slice(0, 200)}`
        : formatApiDetail(detail);
    throw new ApiError(res.status, message || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface MeetingResponse {
  id: string;
  roomName: string;
  title: string;
  status: string;
  createdAt: string | null;
  participants?: { userId: string; peerId?: string; userName?: string }[];
}

export interface TurnConfig {
  iceServers: RTCIceServer[];
}

/** POST /api/assistant/execute — proxied to ai-brain-orchestration */
export interface AssistantExecuteBody {
  user_id: string;
  room_id: string;
  user_name?: string;
  text: string;
  session_id?: string | null;
  context?: Record<string, unknown> | null;
  source?: "chat" | "voice";
  command?: string | null;
  trigger?: string | null;
  meeting_phase?: string | null;
  screen_ref?: string | null;
  persona?: string;
}

export interface AssistantExecuteResponse {
  reply: string;
  intent?: string | null;
  actions: Record<string, unknown>[];
  ui_event?: string | null;
  notes_state?: "on" | "off" | null;
  summary_type?: "periodic" | "final" | "manual" | null;
  artifacts?: Record<string, unknown> | null;
}

export interface AssistantVoiceExecuteResponse extends AssistantExecuteResponse {
  transcript: string;
}

export interface RoleSetBody {
  user_id: string;
  room_id: string;
  user_name?: string;
  role_name: string;
  role_description: string;
  sensitivity?: 'major_only' | 'smart' | 'frequent';
  context?: Record<string, unknown> | null;
}

export interface RoleSetResponse {
  reply: string;
  role_name: string;
  activated: boolean;
}

export interface RoleExitBody {
  user_id: string;
  room_id: string;
  user_name?: string;
}

export interface RoleExitResponse {
  reply: string;
  deactivated: boolean;
}

export interface RoleWatchBody {
  user_id: string;
  room_id: string;
  user_name?: string;
  transcript_chunk: string;
  context?: Record<string, unknown> | null;
}

export interface RoleWatchResponse {
  respond: boolean;
  reply?: string;
  signal?: string | null;
  role_name?: string;
  follow_up_questions?: string[];
}

export interface RoleStateResponse {
  active: boolean;
  role_name: string;
  role_description: string;
  sensitivity: string;
}

export interface AssistantSttStatusResponse {
  status: string;
  model: string;
  device?: string;
  compute_type?: string;
  initial_prompt_set?: boolean;
  loaded: boolean;
  /** Set after model load; may be cpu if CUDA was requested but unavailable */
  runtime_device?: string | null;
  runtime_compute_type?: string | null;
}

export const api = {
  createMeeting(title: string): Promise<MeetingResponse> {
    return request("/api/meetings", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
  },

  getMeeting(roomName: string): Promise<MeetingResponse> {
    return request(`/api/meetings/${roomName}`);
  },

  joinMeeting(roomName: string, userName: string): Promise<MeetingResponse> {
    return request(`/api/meetings/${roomName}/join`, {
      method: "POST",
      body: JSON.stringify({ userName }),
    });
  },

  getTurnConfig(): Promise<TurnConfig> {
    return request("/api/turn-config");
  },

  /** Diagnostic: AI Brain reachable from meet-mind backend */
  assistantBrainHealth(): Promise<{ status: string; service: string }> {
    return request("/api/assistant/brain-health");
  },

  /** Voice pipeline will send transcribed text here (after Whisper on backend). */
  assistantExecute(body: AssistantExecuteBody): Promise<AssistantExecuteResponse> {
    return request("/api/assistant/execute", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  assistantVoiceExecute(params: {
    audio: Blob;
    filename?: string;
    user_id: string;
    room_id: string;
    user_name?: string;
    session_id?: string | null;
    response_style?: "auto" | "short" | "long";
    persona?: string;
  }): Promise<AssistantVoiceExecuteResponse> {
    const form = new FormData();
    form.append("file", params.audio, params.filename ?? "voice.webm");
    form.append("user_id", params.user_id);
    form.append("room_id", params.room_id);
    form.append("user_name", params.user_name ?? "");
    if (params.session_id) form.append("session_id", params.session_id);
    form.append("response_style", params.response_style ?? "auto");
    if (params.persona) form.append("persona", params.persona);

    const controller = new AbortController();
    const timeoutMs = 600_000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    return fetch(`${API_BASE}/api/assistant/voice/execute`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) handleUnauthorized();
          const raw = await res.text();
          let detail: unknown;
          try {
            detail = raw ? (JSON.parse(raw) as { detail?: unknown }).detail : undefined;
          } catch {
            detail = raw.slice(0, 300) || res.statusText;
          }
          throw new ApiError(res.status, formatApiDetail(detail));
        }
        return res.json() as Promise<AssistantVoiceExecuteResponse>;
      })
      .finally(() => {
        clearTimeout(timeoutId);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError) throw e;
        if (
          (e instanceof DOMException || e instanceof Error) &&
          (e as Error).name === "AbortError"
        ) {
          throw new ApiError(
            0,
            `Voice request timed out after ${timeoutMs / 1000}s — check backend logs, STT warmup, and AI brain.`,
          );
        }
        const msg =
          e instanceof TypeError
            ? `${e.message} (voice endpoint unreachable: ${API_BASE}/api/assistant/voice/execute)`
            : "Network error calling voice endpoint";
        throw new ApiError(0, msg);
      });
  },

  assistantSttStatus(): Promise<AssistantSttStatusResponse> {
    return request("/api/assistant/stt-status");
  },

  assistantSttWarmup(): Promise<{
    status: string;
    model: string;
    device?: string;
    compute_type?: string;
  }> {
    return request("/api/assistant/stt-warmup", { method: "POST" });
  },

  assistantSummaryFinalize(params: {
    user_id: string;
    room_id: string;
    user_name?: string;
    session_id?: string | null;
    db_transcript?: string | null;
  }): Promise<AssistantExecuteResponse> {
    return request("/api/assistant/summary/finalize", {
      method: "POST",
      body: JSON.stringify(params),
    });
  },

  endMeeting(roomName: string): Promise<{ id: string; roomName: string; status: string; durationMinutes?: number }> {
    return request(`/api/meetings/${roomName}/end`, { method: "POST" });
  },

  listMeetings(): Promise<{ id: string; roomName: string; title: string; status: string; createdAt: string | null; endedAt: string | null; durationMinutes: number | null }[]> {
    return request("/api/meetings");
  },

  /** Lightweight: store raw speech chunk for notes, no LLM, instant. */
  notesAppendRaw(body: { user_id: string; room_id: string; text: string }): Promise<{ ok: boolean; chunk_count: number }> {
    return request('/api/assistant/notes/append-raw', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** Role play: activate a custom role for the meeting session. */
  roleSet(body: RoleSetBody): Promise<RoleSetResponse> {
    return request('/api/role/set', { method: 'POST', body: JSON.stringify(body) });
  },

  /** Role play: deactivate the current role. */
  roleExit(body: RoleExitBody): Promise<RoleExitResponse> {
    return request('/api/role/exit', { method: 'POST', body: JSON.stringify(body) });
  },

  /** Role play: poll high-signal transcript chunks for proactive in-character responses. */
  roleWatch(body: RoleWatchBody): Promise<RoleWatchResponse> {
    return request('/api/role/watch', { method: 'POST', body: JSON.stringify(body) });
  },

  /** Role play: fetch the current active role (re-sync after page reload). */
  roleState(userId: string, roomId: string): Promise<RoleStateResponse> {
    const qs = new URLSearchParams({ user_id: userId, room_id: roomId });
    return request(`/api/role/state?${qs.toString()}`, { method: 'GET' });
  },

  /** TTS: synthesize text to speech, returns WAV audio blob. */
  async ttsSynthesize(text: string): Promise<Blob | null> {
    try {
      const res = await fetch(`${API_BASE}/api/assistant/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        if (res.status === 401) handleUnauthorized();
        return null;
      }
      return await res.blob();
    } catch {
      return null;
    }
  },

  getMeetingIntelligence(roomName: string): Promise<{
    meeting_id: string;
    room_name: string;
    topics: string[];
    keywords: string[];
    commands: { id: string; type: string; text: string; response: string; at: string | null }[];
    notes: { id: string; content: string; type: string; section: string; session_id: string | null; session_title: string | null; at: string | null }[];
    action_items: { id: string; title: string; assigned_to: string | null; due_date: string | null; status: string; at: string | null }[];
    decisions: { id: string; title: string; options: unknown; analysis: string; chosen: string | null; at: string | null }[];
    transcripts: { id: string; speaker: string; text: string; at: string | null }[];
  }> {
    return request(`/api/meetings/${roomName}/intelligence`);
  },

  async exportPdf(roomName: string): Promise<Blob> {
    const res = await fetch(`${API_BASE}/api/meetings/${encodeURIComponent(roomName)}/export/pdf`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      if (res.status === 401) handleUnauthorized();
      throw new ApiError(res.status, 'PDF export failed');
    }
    return res.blob();
  },

  sendSummaryEmail(roomName: string, body: { to: string[] }): Promise<{ ok: boolean }> {
    return request(`/api/meetings/${encodeURIComponent(roomName)}/send-summary`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  toggleActionItem: async (roomName: string, itemId: string, status: "completed" | "pending") => {
    const r = await fetch(`${API_BASE}/api/meetings/${roomName}/action_items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) {
      if (r.status === 401) handleUnauthorized();
      throw new Error(`toggleActionItem failed: ${r.status}`);
    }
    return r.json() as Promise<{ id: string; title: string; status: "pending" | "completed"; updated_at: string | null }>;
  },

  assistantScreenAnalyze(params: {
    screenshot: Blob;
    filename?: string;
    user_id: string;
    room_id: string;
    user_name?: string;
    question: string;
    session_id?: string | null;
  }): Promise<AssistantExecuteResponse> {
    const form = new FormData();
    form.append("file", params.screenshot, params.filename ?? "screenshot.png");
    form.append("user_id", params.user_id);
    form.append("room_id", params.room_id);
    form.append("user_name", params.user_name ?? "");
    form.append("question", params.question);
    if (params.session_id) form.append("session_id", params.session_id);
    return fetch(`${API_BASE}/api/assistant/screen/analyze`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    }).then(async (res) => {
      if (!res.ok) {
        if (res.status === 401) handleUnauthorized();
        const raw = await res.text();
        let detail: unknown;
        try {
          detail = raw ? (JSON.parse(raw) as { detail?: unknown }).detail : undefined;
        } catch {
          detail = raw.slice(0, 300) || res.statusText;
        }
        throw new ApiError(res.status, formatApiDetail(detail));
      }
      return res.json() as Promise<AssistantExecuteResponse>;
    });
  },
};

// ── Auth ───────────────────────────────────────────────────────────────────

export interface AuthLoginResponse {
  access_token: string;
  token_type: string;
  display_name: string;
}

export interface AuthRegisterResponse {
  id: string;
  email: string;
  display_name: string;
}

export interface AuthMeResponse {
  sub: string;
  email: string;
  name: string;
  exp: number;
}

/** POST /api/auth/register — create an account (returns profile, no token). */
export function authRegister(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthRegisterResponse> {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
}

/** POST /api/auth/login — exchange credentials for a JWT access token. */
export function authLogin(email: string, password: string): Promise<AuthLoginResponse> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** POST /api/auth/google — exchange a Google ID token for a JWT access token. */
export function authGoogle(credential: string): Promise<AuthLoginResponse> {
  return request("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
}

/** GET /api/auth/me — resolve the current identity from the stored token. */
export function authMe(): Promise<AuthMeResponse> {
  return request("/api/auth/me");
}
