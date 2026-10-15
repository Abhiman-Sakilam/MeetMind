export interface Participant {
  id: string;
  name: string;
  peerId: string;
  stream?: MediaStream;
  screenStream?: MediaStream;
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeaking: boolean;
  isScreenSharing: boolean;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  timestamp: Date;
  type?: 'text' | 'action_items' | 'summary' | 'decision' | 'role';
  role_name?: string;
  signal_type?: string;
  follow_up_questions?: string[];
}

export interface ActiveRole {
  name: string;
  description: string;
  sensitivity: 'major_only' | 'smart' | 'frequent';
}

export interface SignalingMessage {
  type:
    | 'join'
    | 'leave'
    | 'peer_joined'
    | 'peer_left'
    | 'offer'
    | 'answer'
    | 'candidate'
    | 'chat'
    | 'media_state'
    | 'assistant'
    | 'screen_share_sync'
    | 'screen_share_denied'
    | 'screen_share_revoke'
    | 'screen_share_start'
    | 'screen_share_stop'
    | 'screen_share_takeover';
  from?: string;
  to?: string;
  data?: unknown;
  roomId?: string;
  peerId?: string;
  userName?: string;
}

export interface MeetingNote {
  id?: string;
  text: string;
  ts: number;
  section?: string;
  session_id?: string | null;
  session_title?: string | null;
}

export interface MeetingActionItem {
  id: string;
  title: string;
  assigned_to?: string | null;
  due_date?: string | null;
  status: "pending" | "completed";
}
