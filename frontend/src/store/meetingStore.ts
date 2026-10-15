import { create } from 'zustand';
import { signalingSocket } from '../services/socket';
import type { Participant, AssistantMessage, ActiveRole, MeetingNote, MeetingActionItem } from '../types';

interface MeetingState {
  roomId: string | null;
  /** WebSocket / signaling user id for this tab (for screen-share spotlight sync) */
  localClientUserId: string | null;
  userName: string;
  meetingTitle: string;
  isInMeeting: boolean;
  startTime: Date | null;

  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  isRecording: boolean;

  participants: Map<string, Participant>;
  /** Room-wide presenter (from server); only one screen share at a time */
  activeScreenUserId: string | null;
  activeScreenUserName: string | null;
  assistantMessages: AssistantMessage[];
  isAssistantOpen: boolean;
  /** Hands-free: wake phrase + auto-stop capture (Chrome/Edge Web Speech API). */
  voiceAiMode: boolean;
  /** Live text for toolbar: browser STT while listening / dictating; cleared when Voice AI off. */
  voiceToolbarTranscript: string;
  /** What the toolbar should imply about the voice pipeline. */
  voiceToolbarPhase: 'off' | 'listening' | 'dictating' | 'transcribing';
  notesPanelOpen: boolean;
  notesMinimized: boolean;
  notesItems: { text: string; ts: number }[];
  notesCleaned: boolean;
  /** Accumulated spoken transcript for context queries (capped at 8000 chars). */
  spokenTranscript: string;
  isChatOpen: boolean;
  ttsEnabled: boolean;
  persona: 'friendly' | 'professional' | 'witty' | 'calm' | 'hacker' | 'motivator';
  activeRole: ActiveRole | null;

  meetingEndData: {
    title: string;
    duration: string;
    summary: string;
    /** Full speech (STT) as markdown — separate from notes and from the AI summary. */
    spokenTranscript: string;
    notes: MeetingNote[];
    participants: string[];
    startTime: Date | null;
    endTime: Date | null;
    topics: string[];
    keywords: string[];
    actionItems: MeetingActionItem[];
  } | null;

  setRoom: (roomId: string, title?: string) => void;
  setLocalClientUserId: (id: string | null) => void;
  setUserName: (name: string) => void;
  joinMeeting: () => void;
  leaveMeeting: () => void;

  setLocalStream: (stream: MediaStream | null) => void;
  setScreenStream: (stream: MediaStream | null) => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  setScreenSharing: (sharing: boolean) => void;
  setRecording: (recording: boolean) => void;

  addParticipant: (participant: Participant) => void;
  removeParticipant: (id: string) => void;
  updateParticipant: (id: string, update: Partial<Participant>) => void;

  addAssistantMessage: (message: AssistantMessage) => void;
  toggleAssistant: () => void;
  openAssistant: () => void;
  setVoiceAiMode: (enabled: boolean) => void;
  setVoiceToolbarTranscript: (
    text: string,
    phase: 'off' | 'listening' | 'dictating' | 'transcribing',
  ) => void;
  clearVoiceToolbar: () => void;
  openNotesPanel: (opts?: { minimizeInsight?: boolean }) => void;
  closeNotesPanel: () => void;
  setNotesItems: (items: { text: string; ts: number }[]) => void;
  setNotesCleaned: (cleaned: boolean) => void;
  appendNoteItem: (item: { text: string; ts: number }) => void;
  appendSpokenTranscript: (chunk: string) => void;
  toggleChat: () => void;
  setTtsEnabled: (enabled: boolean) => void;

  /** Structured insight panel shown in-meeting (action items / summary / brainstorm / decision). */
  activeInsight: { type: 'action_items' | 'summary' | 'brainstorm' | 'decision'; title: string; content: string } | null;
  insightMinimized: boolean;
  setActiveInsight: (insight: MeetingState['activeInsight']) => void;
  dismissInsight: () => void;
  setInsightMinimized: (v: boolean) => void;
  setNotesMinimized: (v: boolean) => void;
  setPersona: (p: MeetingState['persona']) => void;

  setScreenShareSync: (userId: string | null, userName: string | null) => void;
  setMeetingEndData: (
    data:
      | (Omit<NonNullable<MeetingState['meetingEndData']>, 'topics' | 'keywords' | 'actionItems'> & {
          topics?: string[];
          keywords?: string[];
          actionItems?: MeetingActionItem[];
        })
      | null,
  ) => void;
  setActionItemStatus: (itemId: string, status: "pending" | "completed") => void;

  setActiveRole: (role: ActiveRole) => void;
  clearActiveRole: () => void;
}

export const useMeetingStore = create<MeetingState>((set, get) => ({
  roomId: null,
  localClientUserId: null,
  userName: '',
  meetingTitle: 'Untitled Meeting',
  isInMeeting: false,
  startTime: null,

  localStream: null,
  screenStream: null,
  isMuted: false,
  isVideoOff: false,
  isScreenSharing: false,
  isRecording: false,

  participants: new Map(),
  activeScreenUserId: null,
  activeScreenUserName: null,
  assistantMessages: [
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hi! Use the assistant panel to type or paste questions. Turn on Voice AI (toolbar or panel, Chrome/Edge) for hands-free: say “Hey Jarvis” or “Jarvis”, speak your question, pause to send.",
      timestamp: new Date(),
      type: 'text',
    },
  ],
  isAssistantOpen: true,
  voiceAiMode: true,
  voiceToolbarTranscript: '',
  voiceToolbarPhase: 'off',
  notesPanelOpen: false,
  notesMinimized: false,
  notesItems: [],
  notesCleaned: false,
  spokenTranscript: '',
  isChatOpen: false,
  ttsEnabled: true,
  persona: 'friendly',
  activeRole: null,
  meetingEndData: null,
  activeInsight: null,
  insightMinimized: false,

  setRoom: (roomId, title) =>
    set({ roomId, meetingTitle: title ?? get().meetingTitle }),

  setUserName: (name) => set({ userName: name }),

  joinMeeting: () => set((s) => {
    const greetings: Record<MeetingState['persona'], string> = {
      friendly: "Hey! Jarvis here — your meeting co-pilot 🔥 Ask me anything or say 'Hey Jarvis' to go hands-free!",
      professional: 'Jarvis online. Ready to assist with note-taking, summaries, and action items. At your service.',
      witty: "Oh look, another meeting. I'm Jarvis — I'll try not to make this painful for you.",
      calm: "Jarvis here. Ready when you are.",
      hacker: "[JARVIS_INIT=OK] >> meeting assistant online. awaiting input.",
      motivator: "LETS GO! Jarvis is IN THE BUILDING! 💪 This is going to be an AMAZING meeting!",
    };
    return {
      isInMeeting: true,
      startTime: new Date(),
      assistantMessages: [{
        id: 'welcome',
        role: 'assistant' as const,
        content: greetings[s.persona],
        timestamp: new Date(),
        type: 'text' as const,
      }],
      notesItems: [],
      notesCleaned: false,
      notesPanelOpen: false,
      notesMinimized: false,
      spokenTranscript: '',
      activeInsight: null,
      insightMinimized: false,
    };
  }),

  leaveMeeting: () => {
    const { localStream, screenStream } = get();
    localStream?.getTracks().forEach((t) => t.stop());
    screenStream?.getTracks().forEach((t) => t.stop());
    set({
      isInMeeting: false,
      localStream: null,
      screenStream: null,
      isScreenSharing: false,
      participants: new Map(),
      activeScreenUserId: null,
      activeScreenUserName: null,
      startTime: null,
      roomId: null,
      localClientUserId: null,
      voiceAiMode: true,
      voiceToolbarTranscript: '',
      voiceToolbarPhase: 'off',
      notesPanelOpen: false,
      notesMinimized: false,
      notesItems: [],
      notesCleaned: false,
      spokenTranscript: '',
      activeInsight: null,
      insightMinimized: false,
      activeRole: null,
    });
  },

  setLocalClientUserId: (id) => set({ localClientUserId: id }),

  setLocalStream: (stream) => set({ localStream: stream }),
  setScreenStream: (stream) => set({ screenStream: stream }),

  toggleMute: () => {
    const { localStream, isMuted } = get();
    localStream?.getAudioTracks().forEach((t) => (t.enabled = isMuted));
    const newMuted = !isMuted;
    set({ isMuted: newMuted });
    signalingSocket.send({
      type: 'media_state',
      data: { isMuted: newMuted, isVideoOff: get().isVideoOff },
    });
  },

  toggleVideo: () => {
    const { localStream, isVideoOff } = get();
    localStream?.getVideoTracks().forEach((t) => (t.enabled = isVideoOff));
    const newVideoOff = !isVideoOff;
    set({ isVideoOff: newVideoOff });
    signalingSocket.send({
      type: 'media_state',
      data: { isMuted: get().isMuted, isVideoOff: newVideoOff },
    });
  },

  setScreenSharing: (sharing) => set({ isScreenSharing: sharing }),
  setRecording: (recording) => set({ isRecording: recording }),

  addParticipant: (participant) =>
    set((s) => {
      const updated = new Map(s.participants);
      updated.set(participant.id, participant);
      return { participants: updated };
    }),

  removeParticipant: (id) =>
    set((s) => {
      const updated = new Map(s.participants);
      updated.delete(id);
      return { participants: updated };
    }),

  updateParticipant: (id, update) =>
    set((s) => {
      const updated = new Map(s.participants);
      const existing = updated.get(id);
      if (existing) updated.set(id, { ...existing, ...update });
      return { participants: updated };
    }),

  addAssistantMessage: (message) =>
    set((s) => {
      const msgs = [...s.assistantMessages, message];
      return { assistantMessages: msgs.length > 200 ? msgs.slice(-150) : msgs };
    }),

  toggleAssistant: () => set((s) => ({ isAssistantOpen: !s.isAssistantOpen })),
  openAssistant: () => set({ isAssistantOpen: true }),
  setVoiceAiMode: (enabled) =>
    set({
      voiceAiMode: enabled,
      ...(enabled
        ? { voiceToolbarTranscript: '', voiceToolbarPhase: 'listening' }
        : { voiceToolbarTranscript: '', voiceToolbarPhase: 'off' }),
    }),
  setVoiceToolbarTranscript: (text, phase) =>
    set({ voiceToolbarTranscript: text, voiceToolbarPhase: phase }),
  clearVoiceToolbar: () => set({ voiceToolbarTranscript: '', voiceToolbarPhase: 'off' }),
  openNotesPanel: (opts) => set((s) => ({
    notesPanelOpen: true,
    notesCleaned: false,
    notesMinimized: false,
    // auto-minimize insight if it's open, so they stack without overlapping
    insightMinimized: opts?.minimizeInsight !== false && s.activeInsight !== null ? true : s.insightMinimized,
  })),
  closeNotesPanel: () => set({ notesPanelOpen: false, notesMinimized: false }),
  setNotesItems: (items) => set({ notesItems: items }),
  setNotesCleaned: (cleaned: boolean) => set({ notesCleaned: cleaned }),
  appendNoteItem: (item) => set((s) => {
    const items = [...s.notesItems, item];
    return { notesItems: items.length > 500 ? items.slice(-400) : items };
  }),
  appendSpokenTranscript: (chunk) => set((s) => {
    const combined = s.spokenTranscript ? `${s.spokenTranscript} ${chunk}` : chunk;
    return { spokenTranscript: combined.length > 8000 ? combined.slice(-8000) : combined };
  }),
  toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),
  setTtsEnabled: (enabled) => set({ ttsEnabled: enabled }),

  setMeetingEndData: (data) => set({
    meetingEndData: data
      ? {
          ...data,
          topics: data.topics ?? [],
          keywords: data.keywords ?? [],
          actionItems: data.actionItems ?? [],
        }
      : null,
  }),
  setActionItemStatus: (itemId, status) => set((state) => {
    if (!state.meetingEndData) return {};
    return {
      meetingEndData: {
        ...state.meetingEndData,
        actionItems: state.meetingEndData.actionItems.map((a) =>
          a.id === itemId ? { ...a, status } : a,
        ),
      },
    };
  }),
  setActiveInsight: (insight) => set((s) => ({
    activeInsight: insight,
    insightMinimized: false,
    // auto-minimize notes if open, so they stack without overlapping
    notesMinimized: insight !== null && s.notesPanelOpen ? true : s.notesMinimized,
  })),
  dismissInsight: () => set({ activeInsight: null, insightMinimized: false }),
  setInsightMinimized: (v) => set({ insightMinimized: v }),
  setNotesMinimized: (v) => set({ notesMinimized: v }),
  setPersona: (p) => set({ persona: p }),

  setScreenShareSync: (userId, userName) =>
    set({ activeScreenUserId: userId, activeScreenUserName: userName }),

  setActiveRole: (role) => set({ activeRole: role }),
  clearActiveRole: () => set({ activeRole: null }),
}));
