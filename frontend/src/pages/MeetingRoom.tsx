import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMeetingStore } from '../store/meetingStore';
import { useAuthStore } from '../store/authStore';
import { useMediaStream } from '../hooks/useMediaStream';
import { usePeerConnection } from '../hooks/usePeerConnection';
import { useRecorder } from '../hooks/useRecorder';
import { MeetingHeader } from '../components/meeting/MeetingHeader';
import { VideoGrid } from '../components/meeting/VideoGrid';
import { MeetingControls } from '../components/meeting/MeetingControls';
import { AssistantPanel } from '../components/meeting/AssistantPanel';
import { JarvisCore } from '../components/meeting/JarvisCore';
import { api, ApiError } from '../services/api';
import { formatTranscriptMarkdown } from '../lib/formatMeetingTranscript';
import { signalingSocket } from '../services/socket';
import clsx from 'clsx';

const PANEL_MIN_W = 280;
const PANEL_MAX_W = 620;

export function MeetingRoom() {
  const { roomId: paramRoomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [panelWidth, setPanelWidth] = useState(380);
  const resizingRef = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    resizingRef.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = panelWidth;
    e.preventDefault();
  }, [panelWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = resizeStartX.current - e.clientX;
      const next = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, resizeStartW.current + delta));
      setPanelWidth(next);
    };
    const onUp = () => { resizingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // Lock body scroll for the room view
  useEffect(() => {
    document.body.classList.add('room-page');
    return () => { document.body.classList.remove('room-page'); };
  }, []);

  const {
    roomId,
    userName,
    isInMeeting,
    isScreenSharing,
    setRoom,
    setUserName,
    joinMeeting,
    leaveMeeting,
    setLocalStream,
  } = useMeetingStore();

  const authUserName = useAuthStore((s) => s.user?.name);

  // If we landed here directly (e.g. shared link / reload) without a name in the
  // meeting store, default it from the authenticated profile so the call still has a name.
  useEffect(() => {
    if (!userName && authUserName) setUserName(authUserName);
  }, [userName, authUserName, setUserName]);

  const soloStage = useMeetingStore((s) => s.participants.size === 0);

  const { stream, error: mediaError, start: startMedia } = useMediaStream();
  const { initPeer, cleanup: cleanupPeer, shareScreen, stopScreenShare } = usePeerConnection();
  const { startRecording, stopRecording, cleanup: cleanupRecorder } = useRecorder();

  const [validating, setValidating] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [localUserId] = useState(() => crypto.randomUUID().slice(0, 8));
  const initStartedRef = useRef(false);
  const shareAfterIdleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // No name yet: wait for the authenticated profile to resolve (it will set
    // userName via the effect above). Only bounce home if there is genuinely no identity.
    if (!userName) {
      if (!authUserName) navigate('/', { replace: true });
      return;
    }

    if (!paramRoomId) return;

    let cancelled = false;
    const validate = async () => {
      try {
        const meeting = await api.getMeeting(paramRoomId);
        if (cancelled) return;
        // Ensure server-side membership (idempotent). The WS now enforces membership,
        // so a client arriving via a shared link must be registered as a participant first.
        try {
          await api.joinMeeting(paramRoomId, userName);
        } catch {
          /* already a member, or membership will be re-checked by the WS */
        }
        if (cancelled) return;
        if (!roomId) {
          setRoom(meeting.roomName, meeting.title);
        }
        setValidating(false);
      } catch {
        if (cancelled) return;
        setValidationError('Meeting not found or no longer active.');
        setValidating(false);
      }
    };

    validate();
    return () => { cancelled = true; };
  }, [paramRoomId, roomId, userName, authUserName, navigate, setRoom]);

  useEffect(() => {
    if (!userName || !paramRoomId || isInMeeting || validating || validationError) return;
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    const init = async () => {
      const mediaStream = await startMedia();
      if (mediaStream) {
        setLocalStream(mediaStream);
        joinMeeting();
      }
    };

    init();
  }, [userName, paramRoomId, isInMeeting, validating, validationError, startMedia, setLocalStream, joinMeeting]);

  useEffect(() => {
    if (!isInMeeting || !paramRoomId || !userName || !stream) return;

    useMeetingStore.getState().setLocalClientUserId(localUserId);
    initPeer(paramRoomId, localUserId, userName, stream);
  }, [isInMeeting, paramRoomId, userName, stream, initPeer, localUserId]);

  const stopLocalScreenShare = useCallback(() => {
    const state = useMeetingStore.getState();
    if (!state.isScreenSharing) return;
    state.screenStream?.getTracks().forEach((t) => t.stop());
    state.setScreenStream(null);
    state.setScreenSharing(false);
    stopScreenShare();
    signalingSocket.send({ type: 'screen_share_stop' });
  }, [stopScreenShare]);

  const beginLocalScreenShare = useCallback(async () => {
    const uid = localUserId;
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as MediaTrackConstraints,
        audio: false,
      });
      const s = useMeetingStore.getState();
      const name = s.userName;
      s.setScreenStream(screenStream);
      s.setScreenSharing(true);
      signalingSocket.send({ type: 'screen_share_start', userName: name });
      shareScreen(screenStream, uid, name);
      const v = screenStream.getVideoTracks()[0];
      if (v) {
        v.onended = () => {
          screenStream.getTracks().forEach((t) => t.stop());
          useMeetingStore.getState().setScreenStream(null);
          useMeetingStore.getState().setScreenSharing(false);
          stopScreenShare();
          signalingSocket.send({ type: 'screen_share_stop' });
        };
      }
    } catch {
      /* user dismissed picker */
    }
  }, [shareScreen, stopScreenShare, localUserId]);

  const handleTakeoverRequest = useCallback((targetUserId: string) => {
    signalingSocket.send({
      type: 'screen_share_takeover',
      data: { targetUserId },
    });
    shareAfterIdleRef.current = () => {
      void beginLocalScreenShare();
    };
  }, [beginLocalScreenShare]);

  useEffect(() => {
    if (!paramRoomId || !isInMeeting) return;

    return signalingSocket.onMessage((msg) => {
      if (msg.type === 'screen_share_sync') {
        const d = msg.data as {
          activeUserId: string | null;
          activeUserName: string | null;
        };
        const prev = useMeetingStore.getState().activeScreenUserId;
        useMeetingStore
          .getState()
          .setScreenShareSync(d.activeUserId, d.activeUserName);
        if (
          d.activeUserId === null &&
          shareAfterIdleRef.current &&
          prev !== null
        ) {
          const fn = shareAfterIdleRef.current;
          shareAfterIdleRef.current = null;
          fn();
        }
      }

      if (msg.type === 'screen_share_revoke') {
        const state = useMeetingStore.getState();
        if (!state.isScreenSharing) return;
        state.screenStream?.getTracks().forEach((t) => t.stop());
        state.setScreenStream(null);
        state.setScreenSharing(false);
        stopScreenShare();
        signalingSocket.send({ type: 'screen_share_stop' });
      }

      if (msg.type === 'screen_share_denied') {
        const d = msg.data as {
          activeUserName?: string;
          reason?: string;
        };
        const state = useMeetingStore.getState();
        if (state.isScreenSharing && state.screenStream) {
          state.screenStream.getTracks().forEach((t) => t.stop());
          state.setScreenStream(null);
          state.setScreenSharing(false);
          stopScreenShare();
        }
        window.alert(
          d.reason ||
            `${d.activeUserName ?? 'Someone'} is already presenting.`,
        );
      }
    });
  }, [paramRoomId, isInMeeting, stopScreenShare]);

  const handleStartRecording = useCallback(() => {
    const { localStream, participants } = useMeetingStore.getState();
    if (localStream) {
      startRecording(localStream, participants);
    }
  }, [startRecording]);

  const handleLeave = useCallback(async () => {
    const state = useMeetingStore.getState();
    const rid = state.roomId;
    const title = state.meetingTitle;
    const start = state.startTime;
    const notes = [...state.notesItems];
    const participantNames = Array.from(state.participants.values()).map((p) => p.name);
    participantNames.unshift(state.userName || 'You');

    let summaryText = '';
    let spokenTranscript = '';
    if (rid) {
      let dbTranscript = '';
      try {
        const intel = await api.getMeetingIntelligence(rid);
        const rows = intel.transcripts || [];
        spokenTranscript = formatTranscriptMarkdown(rows);
        dbTranscript = rows
          .map((t) => t.text?.trim() || '')
          .filter(Boolean)
          .join(' ');
      } catch {
        dbTranscript = '';
        spokenTranscript = '';
      }
      try {
        const res = await api.assistantSummaryFinalize({
          user_id: localUserId,
          room_id: rid,
          user_name: state.userName || 'Guest',
          db_transcript: dbTranscript || undefined,
        });
        summaryText = res.reply || '';
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Summary failed';
        summaryText = `Could not generate summary: ${msg}`;
      }
      void api.endMeeting(rid).catch(() => {});
    }

    const endTime = new Date();
    const durationMs = start ? endTime.getTime() - start.getTime() : 0;
    const mins = Math.floor(durationMs / 60000);
    const secs = Math.floor((durationMs % 60000) / 1000);
    const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    useMeetingStore.getState().setMeetingEndData({
      title,
      duration: durationStr,
      summary: summaryText,
      spokenTranscript,
      notes,
      participants: participantNames,
      startTime: start,
      endTime,
    });

    shareAfterIdleRef.current = null;
    stopLocalScreenShare();
    cleanupRecorder();
    cleanupPeer();
    leaveMeeting();
    initStartedRef.current = false;
    navigate(`/meeting/${paramRoomId}/end`, { replace: true });
  }, [stopLocalScreenShare, cleanupRecorder, cleanupPeer, leaveMeeting, navigate, paramRoomId, localUserId]);

  if (validationError) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="glass-strong rounded-2xl p-8 max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-rose-500/15 flex items-center justify-center">
            <span className="text-3xl">!</span>
          </div>
          <h2 className="text-xl font-semibold mb-2">Cannot Join Meeting</h2>
          <p className="text-surface-400 mb-6">{validationError}</p>
          <button onClick={() => navigate('/')} className="btn-primary">
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (mediaError) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="glass-strong rounded-2xl p-8 max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-rose-500/15 flex items-center justify-center">
            <span className="text-3xl text-rose-400">!</span>
          </div>
          <h2 className="text-xl font-semibold mb-2">Permission Required</h2>
          <p className="text-surface-400 mb-6">{mediaError}</p>
          <button onClick={() => navigate('/')} className="btn-primary">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (validating || !isInMeeting) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-surface-400 text-sm">
            {validating ? 'Verifying meeting...' : 'Connecting to meeting...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height:'100vh', background:'#030303', position:'relative', overflow:'hidden', fontFamily:"'Space Grotesk',sans-serif", color:'#fff',
      backgroundImage:'radial-gradient(circle at 10% 40%, rgba(0,255,204,.03), transparent 30%), radial-gradient(circle at 90% 60%, rgba(255,0,255,.03), transparent 30%)' }}>

      {/* Screen share banner */}
      {isScreenSharing && (
        <div style={{ position:'absolute', top:0, left:0, right:0, zIndex:200, display:'flex', justifyContent:'space-between', alignItems:'center', padding:'.6rem 1.5rem', background:'rgba(15,15,15,.9)', borderBottom:'1px solid rgba(255,255,255,.1)' }}>
          <p style={{ fontSize:'.85rem' }}>You&apos;re presenting to everyone</p>
          <button onClick={stopLocalScreenShare} style={{ fontSize:'.82rem', color:'#00ffcc', background:'none', border:'none', cursor:'pointer', fontWeight:600 }}>Stop presenting</button>
        </div>
      )}

      {/* Header */}
      <MeetingHeader />

      <div className="meeting-layout-shell" style={{ gridTemplateColumns: `minmax(0, 1fr) ${panelWidth}px` }}>
        {/* Center stage */}
        <main className={clsx('meeting-stage', soloStage && 'meeting-stage--solo')}>
          <div className={clsx('spatial-canvas', soloStage && 'spatial-canvas--solo')} style={{ pointerEvents:'none' }}>
            <JarvisCore />
            <VideoGrid />
          </div>
        </main>

        {/* Right assistant */}
        <div className="meeting-right-rail">
          {/* Drag handle */}
          <div
            className="assistant-resize-handle"
            onMouseDown={onResizeStart}
          />
          <div
            style={{
              width: '100%',
              minHeight: 0,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: 'auto',
              overflow: 'hidden',
            }}
          >
            <AssistantPanel assistantUserId={localUserId} meetingRoomId={paramRoomId ?? ''} />
          </div>
        </div>
      </div>

      {/* Live transcript floating pill */}
      <LiveTranscriptHUD />

      {/* Structured insights overlay (action items / summary / notes / brainstorm) */}
      <MeetingInsightsHUD />

      {/* Dock */}
      <MeetingControls
        localUserId={localUserId}
        onLeave={handleLeave}
        beginLocalScreenShare={beginLocalScreenShare}
        stopLocalScreenShare={stopLocalScreenShare}
        onTakeoverRequest={handleTakeoverRequest}
        onStartRecording={handleStartRecording}
        onStopRecording={stopRecording}
      />
    </div>
  );
}

// ── Floating live transcript pill ──────────────────────────────────────────
function LiveTranscriptHUD() {
  const voiceToolbarTranscript = useMeetingStore((s) => s.voiceToolbarTranscript);
  const voiceToolbarPhase = useMeetingStore((s) => s.voiceToolbarPhase);

  if (voiceToolbarPhase === 'off') return null;

  const isListening = voiceToolbarPhase === 'listening';
  const isTranscribing = voiceToolbarPhase === 'transcribing';
  const dotColor = isListening ? 'rgba(255,255,255,.5)' : isTranscribing ? '#ffd700' : '#00ffcc';
  const textColor = isListening ? 'rgba(255,255,255,.65)' : isTranscribing ? '#ffd700' : '#00ffcc';
  const text = isListening
    ? 'Listening for "Hey Jarvis"…'
    : voiceToolbarTranscript || 'Processing voice…';

  return (
    <div style={{ position: 'absolute', bottom: '7.5rem', left: 'calc(50% - 160px)', transform: 'translateX(-50%)', zIndex: 95, pointerEvents: 'none' }}>
      <div className="transcript-hud">
        <span
          className="transcript-hud-dot"
          style={{
            background: dotColor,
            color: dotColor,
            animation: isListening ? 'none' : 'recording-pulse 1s ease-in-out infinite',
          }}
        />
        <span className="transcript-hud-text" style={{ color: textColor }}>{text}</span>
      </div>
    </div>
  );
}

// ── Structured in-meeting insights panel ──────────────────────────────────
function MeetingInsightsHUD() {
  const activeInsight = useMeetingStore((s) => s.activeInsight);
  const insightMinimized = useMeetingStore((s) => s.insightMinimized);
  const setInsightMinimized = useMeetingStore((s) => s.setInsightMinimized);
  const dismissInsight = useMeetingStore((s) => s.dismissInsight);

  const notesItems = useMeetingStore((s) => s.notesItems);
  const notesPanelOpen = useMeetingStore((s) => s.notesPanelOpen);
  const notesMinimized = useMeetingStore((s) => s.notesMinimized);
  const setNotesMinimized = useMeetingStore((s) => s.setNotesMinimized);
  const closeNotesPanel = useMeetingStore((s) => s.closeNotesPanel);

  const showNotes = notesPanelOpen && notesItems.length > 0;

  if (!activeInsight && !showNotes) return null;

  const iconMap = { action_items: '⚡', summary: '📊', brainstorm: '💡', decision: '⚖️' };
  const colorMap = { action_items: '#00ffcc', summary: '#ffd700', brainstorm: '#a78bfa', decision: '#fb923c' };

  const panelBase: React.CSSProperties = {
    background: 'rgba(10,10,14,.92)',
    border: '1px solid rgba(255,255,255,.1)',
    borderRadius: '10px',
    backdropFilter: 'blur(12px)',
    width: 280,
    overflow: 'hidden',
    transition: 'all .2s ease',
  };

  const headerBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid rgba(255,255,255,.07)',
    cursor: 'default',
    userSelect: 'none',
  };

  const titleBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '.8rem',
    fontWeight: 600,
    letterSpacing: '.03em',
  };

  const iconBtn: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'rgba(255,255,255,.45)',
    fontSize: '.85rem',
    padding: '0 3px',
    lineHeight: 1,
    transition: 'color .15s',
  };

  return (
    <div style={{ position: 'absolute', bottom: '7.5rem', left: '1rem', zIndex: 95, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>

      {/* Insight panel — shown first (on top visually since flex-column stacks down) */}
      {activeInsight && (
        <div className="insights-hud" style={{ ...panelBase, width: 280 }}>
          <div className="insights-hud-header" style={{ ...headerBase, background: `${colorMap[activeInsight.type]}11` }}>
            <div className="insights-hud-title" style={{ ...titleBase, color: colorMap[activeInsight.type] ?? '#00ffcc' }}>
              <span>{iconMap[activeInsight.type] ?? '✦'}</span>
              {activeInsight.title}
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              <button style={iconBtn} onClick={() => setInsightMinimized(!insightMinimized)} title={insightMinimized ? 'Expand' : 'Minimize'}>
                {insightMinimized ? '▲' : '▼'}
              </button>
              <button style={iconBtn} onClick={dismissInsight} title="Close">✕</button>
            </div>
          </div>
          {!insightMinimized && (
            <div className="insights-hud-body" style={{ padding: '10px 12px', maxHeight: 220, overflowY: 'auto' }}>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: "'Space Grotesk',sans-serif", margin: 0, fontSize: '.8rem', lineHeight: 1.5, color: 'rgba(255,255,255,.85)' }}>
                {activeInsight.content}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Notes panel — shown below insight */}
      {showNotes && (
        <div className="insights-hud" style={{ ...panelBase, width: 280 }}>
          <div className="insights-hud-header" style={{ ...headerBase, background: 'rgba(0,255,204,.05)' }}>
            <div className="insights-hud-title" style={{ ...titleBase, color: '#00ffcc' }}>
              <span>📝</span> Notes
              <span style={{ fontSize: '.7rem', color: 'rgba(0,255,204,.6)', fontWeight: 400 }}>({notesItems.length})</span>
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              <button style={iconBtn} onClick={() => setNotesMinimized(!notesMinimized)} title={notesMinimized ? 'Expand' : 'Minimize'}>
                {notesMinimized ? '▲' : '▼'}
              </button>
              <button style={iconBtn} onClick={closeNotesPanel} title="Close">✕</button>
            </div>
          </div>
          {!notesMinimized && (
            <div className="insights-hud-body" style={{ padding: '10px 12px', maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {notesItems.slice(-6).map((n, i) => (
                <div key={`${n.ts}-${i}`} className="note-hud-card" style={{ borderBottom: '1px solid rgba(255,255,255,.06)', paddingBottom: 6 }}>
                  <div style={{ fontSize: '.75rem', color: 'rgba(255,255,255,.5)', marginBottom: 2 }}>
                    {new Date(n.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{ fontSize: '.8rem', color: 'rgba(255,255,255,.85)', lineHeight: 1.4 }}>{n.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
