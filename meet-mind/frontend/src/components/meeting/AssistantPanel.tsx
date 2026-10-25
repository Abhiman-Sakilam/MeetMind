import { useState, useRef, useEffect, useCallback } from 'react';
import {
  BrainCircuit,
  X,
  Send,
  Sparkles,
  Loader2,
  MessageSquare,
  Volume2,
  VolumeX,
  Mic,
} from 'lucide-react';
import { useMeetingStore } from '../../store/meetingStore';
import type { AssistantMessage } from '../../types';
import clsx from 'clsx';
import { isWakeWordSupported } from '../../lib/wakeWord';
import { MarkdownMessage } from './MarkdownMessage';
import { signalingSocket } from '../../services/socket';
import { useAutoNotes } from '../../hooks/useAutoNotes';
import { useAssistantChat } from '../../hooks/useAssistantChat';
import { useWakeWord } from '../../hooks/useWakeWord';
import { useVoiceCapture } from '../../hooks/useVoiceCapture';
import { useRoleMode } from '../../hooks/useRoleMode';
import { RoleSetupModal } from './RoleSetupModal';
import { RoleStatusBadge } from './RoleStatusBadge';
import { RoleBubble } from './RoleBubble';

const THINKING_KEYWORDS = ['summarize', 'summary', 'explain', 'analyze', 'analyse', 'compare', 'brainstorm', 'decide', 'help me', 'what should', 'how to', 'why', 'elaborate', 'deep dive', 'decision'];

function isThinkingQuery(text: string): boolean {
  const lower = text.toLowerCase();
  return text.length > 60 || THINKING_KEYWORDS.some((k) => lower.includes(k));
}

interface AssistantPanelProps {
  assistantUserId: string;
  meetingRoomId: string;
}

export function AssistantPanel({ assistantUserId, meetingRoomId }: AssistantPanelProps) {
  const {
    assistantMessages,
    addAssistantMessage,
    isAssistantOpen,
    toggleAssistant,
    userName,
    roomId: storeRoomId,
    voiceAiMode,
    setVoiceAiMode,
    setVoiceToolbarTranscript,
    ttsEnabled,
    setTtsEnabled,
  } = useMeetingStore();

  const activeRole = useMeetingStore((s) => s.activeRole);

  const [panelMode, setPanelMode] = useState<'jarvis' | 'chat'>('jarvis');
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ id: string; from: string; text: string; timestamp: Date; isLocal: boolean }[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSentTextRef = useRef('');

  const effectiveRoomId = storeRoomId ?? meetingRoomId;

  // --- Hooks ---
  const { submitAutoNoteChunk, setNotesModeActive } = useAutoNotes({
    assistantUserId,
    effectiveRoomId,
    addAssistantMessage,
  });

  const { submitRoleChunk } = useRoleMode({
    assistantUserId,
    effectiveRoomId,
    addAssistantMessage,
  });

  const handleTranscriptChunk = useCallback(
    (chunk: string) => {
      submitAutoNoteChunk(chunk);
      submitRoleChunk(chunk);
    },
    [submitAutoNoteChunk, submitRoleChunk],
  );

  const {
    isChatSending,
    brainStatus,
    setBrainStatus,
    sessionIdRef,
    checkBrain,
    applyAssistantUiResponse,
    maybeRunScreenCommand,
    handleSend: chatHandleSend,
    playTts,
  } = useAssistantChat({
    assistantUserId,
    effectiveRoomId,
    addAssistantMessage,
    isAssistantOpen,
    setNotesModeActive,
  });

  const startVoiceRecordingRef = useRef<() => Promise<void>>(async () => {});
  const isRecordingVoiceRef = useRef(false);

  const {
    wakePausedForVoiceRef,
    wakeWordListeningRef,
    stopWakeRecognition,
    scheduleWakeRestart,
  } = useWakeWord({
    addAssistantMessage,
    setVoiceAiMode,
    submitAutoNoteChunk: handleTranscriptChunk,
    startVoiceRecordingRef,
    isRecordingVoiceRef,
    voiceAiMode,
  });

  const {
    isVoiceSending,
    isRecordingVoice,
    liveCaption,
    startVoiceRecording,
  } = useVoiceCapture({
    assistantUserId,
    effectiveRoomId,
    addAssistantMessage,
    checkBrain,
    setBrainStatus,
    applyAssistantUiResponse,
    maybeRunScreenCommand,
    playTts,
    stopWakeRecognition,
    scheduleWakeRestart,
    wakePausedForVoiceRef,
    wakeWordListeningRef,
    sessionIdRef,
  });

  useEffect(() => {
    startVoiceRecordingRef.current = startVoiceRecording;
  }, [startVoiceRecording]);

  useEffect(() => {
    isRecordingVoiceRef.current = isRecordingVoice;
  }, [isRecordingVoice]);

  useEffect(() => {
    if (!voiceAiMode) {
      stopWakeRecognition();
      wakePausedForVoiceRef.current = false;
      return;
    }
    if (!isWakeWordSupported()) return;
    if (isRecordingVoice) return;
    scheduleWakeRestart();
    return () => {
      stopWakeRecognition();
    };
  }, [voiceAiMode, isRecordingVoice, scheduleWakeRestart, stopWakeRecognition, wakePausedForVoiceRef]);

  const assistantThinking = isChatSending || isVoiceSending;

  // --- Chat messages via signaling ---
  useEffect(() => {
    const unsub = signalingSocket.onMessage((msg) => {
      if (msg.type === 'chat' && msg.data) {
        const data = msg.data as { text: string };
        setChatMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            from: ((msg as unknown as Record<string, unknown>).userName as string) ?? 'Participant',
            text: data.text,
            timestamp: new Date(),
            isLocal: false,
          },
        ]);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleChatSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    signalingSocket.send({ type: 'chat', data: { text } });
    setChatMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), from: userName || 'You', text, timestamp: new Date(), isLocal: true },
    ]);
    setInput('');
  }, [input, userName]);

  /** Auto-enable voice AI (wake phrase detection) when panel opens. */
  const prevAssistantOpenRef = useRef(isAssistantOpen);
  useEffect(() => {
    const prev = prevAssistantOpenRef.current;
    prevAssistantOpenRef.current = isAssistantOpen;
    if (!prev && isAssistantOpen) {
      if (!voiceAiMode && isWakeWordSupported()) {
        setVoiceAiMode(true);
      }
      if (isWakeWordSupported()) {
        setVoiceToolbarTranscript('', 'listening');
      }
    }
  }, [isAssistantOpen, setVoiceToolbarTranscript, voiceAiMode, setVoiceAiMode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [assistantMessages, assistantThinking]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    lastSentTextRef.current = text;
    await chatHandleSend(text);
  };

  if (!isAssistantOpen) return null;

  return (
    <aside
      style={{
        flex: '1 1 0',
        minHeight: 0,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background:
          'linear-gradient(165deg,rgba(250,97,20,.035) 0%,rgba(16,11,8,.96) 45%,rgba(9,4,1,.98) 100%)',
        backdropFilter: 'blur(28px)',
        border: '1px solid rgba(250,97,20,.12)',
        borderRadius: 20,
        boxShadow: '0 8px 32px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.04)',
        overflow: 'hidden',
        animation: 'slide-left 0.5s cubic-bezier(0.175,0.885,0.32,1.275) both',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
      {/* Header */}
      <div style={{ padding:'.8rem .9rem .6rem', borderBottom:'1px solid rgba(255,255,255,.06)', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', background:'rgba(0,0,0,.4)', borderRadius:100, padding:3, border:'1px solid rgba(255,255,255,.08)', gap:2 }}>
          <button type="button" role="tab" aria-selected={panelMode==='jarvis'} onClick={() => setPanelMode('jarvis')} style={{
            display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:100, border:'none', cursor:'pointer',
            fontSize:'.7rem', fontWeight:700, letterSpacing:.5, transition:'all .2s',
            background: panelMode==='jarvis' ? 'linear-gradient(135deg,#fa6114,#e2571f)' : 'transparent',
            color: panelMode==='jarvis' ? '#000' : 'rgba(255,255,255,.4)',
            boxShadow: panelMode==='jarvis' ? '0 0 16px rgba(250,97,20,.4)' : 'none',
          }}><BrainCircuit size={11} /> JARVIS</button>
          <button type="button" role="tab" aria-selected={panelMode==='chat'} onClick={() => setPanelMode('chat')} style={{
            display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:100, border:'none', cursor:'pointer',
            fontSize:'.7rem', fontWeight:700, letterSpacing:.5, transition:'all .2s',
            background: panelMode==='chat' ? 'rgba(255,255,255,.12)' : 'transparent',
            color: panelMode==='chat' ? '#fff' : 'rgba(255,255,255,.4)',
          }}><MessageSquare size={11} /> CHAT {chatMessages.length>0&&panelMode!=='chat'&&<span style={{width:5,height:5,borderRadius:'50%',background:'#fa6114',display:'inline-block'}}/>}</button>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {panelMode==='jarvis' && (
            <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:'.62rem', letterSpacing:1, textTransform:'uppercase' }}>
              {brainStatus==='ok'       && <><span style={{width:6,height:6,borderRadius:'50%',background:'#fa6114',boxShadow:'0 0 6px #fa6114'}}/>      <span style={{color:'#fa6114'}}>Online</span></>}
              {brainStatus==='offline'  && <><span style={{width:6,height:6,borderRadius:'50%',background:'#ff8844'}}/><span style={{color:'#ff8844'}}>Offline</span></>}
              {brainStatus==='checking' && <Loader2 size={10} className="animate-spin" style={{color:'rgba(255,255,255,.3)'}}/>}
            </span>
          )}
          <button onClick={toggleAssistant} aria-label="Close assistant panel" style={{ width:28,height:28,borderRadius:8,background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',color:'rgba(255,255,255,.5)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer' }}>
            <X size={14} />
          </button>
        </div>
      </div>

      {panelMode === 'jarvis' ? (
      <>
      {/* Persona selector */}
      {/* Role row: badge when active, set-role button when not */}
      <div style={{ padding: '.3rem .7rem .4rem', borderBottom: '1px solid rgba(255,255,255,.04)', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', minHeight: 32 }}>
        {activeRole ? (
          <RoleStatusBadge
            assistantUserId={assistantUserId}
            effectiveRoomId={effectiveRoomId}
            userName={userName}
            onExited={(reply) => {
              addAssistantMessage({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: reply,
                timestamp: new Date(),
                type: 'text',
              });
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setRoleModalOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 100, border: 'none', cursor: 'pointer',
              background: 'rgba(245,158,11,0.08)',
              color: 'rgba(245,158,11,0.85)',
              fontSize: '.65rem', fontWeight: 700, letterSpacing: '.05em',
            }}
          >
            🎭 Set Role
          </button>
        )}
      </div>
      {/* Messages */}
      <div style={{ flex:1, overflowY:'auto', padding:'.8rem', display:'flex', flexDirection:'column', gap:10, minHeight:0 }}>
        {brainStatus === 'offline' && assistantMessages.length === 0 && (
          <p style={{ textAlign:'center', fontSize:'.78rem', opacity:.45, paddingTop:'2rem', color:'#ff8844' }}>Jarvis is offline. Check your connection.</p>
        )}
        {assistantMessages.map(msg =>
          msg.type === 'role' ? (
            <RoleBubble
              key={msg.id}
              message={msg}
              onFollowUpClick={(q) => { void chatHandleSend(q); }}
            />
          ) : (
            <MessageBubble key={msg.id} message={msg} />
          )
        )}
        {assistantThinking && (
          <ThinkingIndicator isThinking={isThinkingQuery(lastSentTextRef.current)} />
        )}
        <div ref={messagesEndRef} />
      </div>
      </>
      ) : (
      /* Chat Messages */
      <div style={{ flex:1, overflowY:'auto', padding:'.8rem', display:'flex', flexDirection:'column', gap:8, minHeight:0 }}>
        {chatMessages.length===0 && <p style={{ textAlign:'center', fontSize:'.78rem', opacity:.35, paddingTop:'2rem' }}>No messages yet.</p>}
        {chatMessages.map(msg => (
          <div key={msg.id} style={{ display:'flex', justifyContent:msg.isLocal?'flex-end':'flex-start' }}>
            <div style={{
              maxWidth:'85%', borderRadius:14, padding:'.55rem .9rem', fontSize:'.82rem', lineHeight:1.5,
              background: msg.isLocal?'linear-gradient(135deg,rgba(250,97,20,.15),rgba(226,87,31,.15))':'rgba(255,255,255,.06)',
              border: msg.isLocal?'1px solid rgba(250,97,20,.25)':'1px solid rgba(255,255,255,.08)',
              color: msg.isLocal?'#fa6114':'rgba(255,255,255,.85)',
              borderBottomRightRadius: msg.isLocal?4:14,
              borderBottomLeftRadius: msg.isLocal?14:4,
            }}>
              {!msg.isLocal && <p style={{ fontSize:'.6rem', fontWeight:700, marginBottom:3, opacity:.55, textTransform:'uppercase', letterSpacing:1 }}>{msg.from}</p>}
              <p style={{ whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{msg.text}</p>
              <p style={{ fontSize:'.6rem', opacity:.4, textAlign:'right', marginTop:3 }}>{msg.timestamp.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</p>
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      )}

      {/* Input */}
      <div style={{ padding:'.6rem .8rem', borderTop:'1px solid rgba(255,255,255,.06)', flexShrink:0 }}>
        {panelMode==='jarvis' && (
          <div style={{ marginBottom:'.5rem' }}>
            <button type="button" onClick={() => setTtsEnabled(!ttsEnabled)} aria-pressed={ttsEnabled} style={{
              display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:100,
              fontSize:'.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:1, cursor:'pointer', transition:'all .2s',
              background: ttsEnabled?'rgba(250,97,20,.12)':'rgba(255,255,255,.05)',
              border: ttsEnabled?'1px solid rgba(250,97,20,.3)':'1px solid rgba(255,255,255,.1)',
              color: ttsEnabled?'#fa6114':'rgba(255,255,255,.4)',
            }}>
              {ttsEnabled?<Volume2 size={11}/>:<VolumeX size={11}/>} TTS {ttsEnabled?'On':'Off'}
            </button>
          </div>
        )}
        <div style={{
          display:'flex', alignItems:'center', gap:5,
          background:'rgba(0,0,0,.4)', borderRadius:12,
          border: isRecordingVoice&&panelMode==='jarvis'?'1px solid rgba(250,97,20,.4)':'1px solid rgba(255,255,255,.1)',
          boxShadow: isRecordingVoice&&panelMode==='jarvis'?'0 0 12px rgba(250,97,20,.1)':'none',
          transition:'all .2s',
        }}>
          <input type="text"
            value={isRecordingVoice&&panelMode==='jarvis'?liveCaption:input}
            onChange={e => { if(!isRecordingVoice||panelMode==='chat') setInput(e.target.value); }}
            onKeyDown={e => {
              if(e.key==='Enter'&&!e.shiftKey) {
                if(panelMode==='chat') handleChatSend();
                else if(!isRecordingVoice) void handleSend();
              }
            }}
            placeholder={panelMode==='chat'?'Message participants…':isRecordingVoice?(liveCaption?'':'Listening…'):'Ask Jarvis…'}
            disabled={panelMode==='jarvis'&&(isChatSending||isRecordingVoice)}
            readOnly={panelMode==='jarvis'&&isRecordingVoice}
            style={{ flex:1, minWidth:0, background:'transparent', padding:'.6rem .7rem', fontSize:'.82rem', color:'#fff', outline:'none', fontFamily:"var(--font-body)" }}
          />
          {panelMode==='jarvis' && (
            <button type="button" aria-label={isRecordingVoice ? 'Recording — stop' : 'Start voice recording'} onClick={() => { void startVoiceRecording(); }}
              disabled={isChatSending||isVoiceSending||isRecordingVoice}
              style={{
                width:30, height:30, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center',
                cursor:'pointer', border:'none', transition:'all .2s', flexShrink:0,
                background: isRecordingVoice?'#fa6114':'rgba(255,255,255,.08)',
                color: isRecordingVoice?'#000':'rgba(255,255,255,.5)',
                animation: isRecordingVoice?'orb-breathe 1.5s ease-in-out infinite':'none',
              }}><Mic size={14}/></button>
          )}
          <button type="button"
            aria-label="Send message"
            onClick={() => { if(panelMode==='chat') handleChatSend(); else void handleSend(); }}
            disabled={!input.trim()||(panelMode==='jarvis'&&(isChatSending||isRecordingVoice))}
            style={{
              width:30, height:30, marginRight:4, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center',
              cursor:'pointer', border:'none', transition:'all .2s', flexShrink:0,
              background: input.trim()?'linear-gradient(135deg,#fa6114,#e2571f)':'rgba(255,255,255,.06)',
              color: input.trim()?'#000':'rgba(255,255,255,.25)',
              boxShadow: input.trim()?'0 0 12px rgba(250,97,20,.3)':'none',
            }}>
            {isChatSending&&panelMode==='jarvis'?<Loader2 size={14} className="animate-spin"/>:<Send size={14}/>}
          </button>
        </div>
      </div>
      </div>
      {roleModalOpen && (
        <RoleSetupModal
          assistantUserId={assistantUserId}
          effectiveRoomId={effectiveRoomId}
          userName={userName}
          onClose={() => setRoleModalOpen(false)}
          onActivated={(reply) => {
            addAssistantMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: reply,
              timestamp: new Date(),
              type: 'role',
              role_name: useMeetingStore.getState().activeRole?.name ?? 'Role',
              signal_type: 'entry',
              follow_up_questions: [],
            });
          }}
        />
      )}
    </aside>
  );
}


// ── Typing dots indicator ─────────────────────────────────────────────────
function ThinkingIndicator({ isThinking }: { isThinking: boolean }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'.55rem .9rem', background:'rgba(250,97,20,.06)', border:'1px solid rgba(250,97,20,.13)', borderRadius:12, width:'fit-content' }}>
      <div style={{ display:'flex', gap:3, alignItems:'center' }}>
        {[0,1,2].map((i) => (
          <span key={i} style={{
            width: 5, height: 5, borderRadius:'50%', background:'#fa6114',
            display:'inline-block',
            animation: `typing-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
      <span style={{ fontSize:'.75rem', color:'rgba(250,97,20,.8)', letterSpacing:'.02em' }}>
        {isThinking ? 'Thinking…' : 'Quick response…'}
      </span>
    </div>
  );
}


function MessageBubble({ message }: { message: AssistantMessage }) {
  const isAssistant = message.role === 'assistant';
  const isSystem = message.role === 'system';
  const time = message.timestamp.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const hasMarkdown = isAssistant && /[*_#\-•]/.test(message.content);

  return (
    <div
      className={clsx(
        'flex',
        isAssistant || isSystem ? 'justify-start' : 'justify-end',
      )}
    >
      <div
        className={clsx(
          'max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
          isAssistant &&
            'bg-surface-700/70 text-surface-100 rounded-tl-sm',
          isSystem &&
            'bg-amber-500/10 text-amber-200/90 border border-amber-500/20 rounded-tl-sm',
          !isAssistant &&
            !isSystem &&
            'bg-accent/20 text-accent-light rounded-tr-sm',
        )}
      >
        {isAssistant && (
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles size={12} className="text-accent-light" />
            <span className="text-[11px] font-medium text-accent-light">Jarvis</span>
          </div>
        )}
        {isSystem && (
          <div className="text-[11px] font-medium text-amber-400/90 mb-1">System</div>
        )}
        {hasMarkdown ? (
          <MarkdownMessage content={message.content} />
        ) : (
          <p className="whitespace-pre-wrap">{message.content}</p>
        )}
        <p className="text-[10px] text-surface-500 mt-1 text-right">{time}</p>
      </div>
    </div>
  );
}

