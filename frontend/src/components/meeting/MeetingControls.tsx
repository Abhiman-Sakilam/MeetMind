import { useState } from 'react';
import { Mic, MicOff, Video, VideoOff, MonitorUp, MonitorOff, PhoneOff, Circle, AudioLines, BrainCircuit } from 'lucide-react';
import { isWakeWordSupported } from '../../lib/wakeWord';
import { useMeetingStore } from '../../store/meetingStore';
import clsx from 'clsx';

interface MeetingControlsProps {
  localUserId: string;
  beginLocalScreenShare: () => Promise<void>;
  stopLocalScreenShare: () => void;
  onTakeoverRequest: (uid: string) => void;
  onLeave: () => void;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
}

export function MeetingControls({ localUserId, beginLocalScreenShare, stopLocalScreenShare, onTakeoverRequest, onLeave, onStartRecording, onStopRecording }: MeetingControlsProps) {
  const isMuted            = useMeetingStore(s => s.isMuted);
  const isVideoOff         = useMeetingStore(s => s.isVideoOff);
  const isScreenSharing    = useMeetingStore(s => s.isScreenSharing);
  const isRecording        = useMeetingStore(s => s.isRecording);
  const voiceAiMode        = useMeetingStore(s => s.voiceAiMode);
  const isAssistantOpen    = useMeetingStore(s => s.isAssistantOpen);
  const activeScreenUserName = useMeetingStore(s => s.activeScreenUserName);
  const toggleMute         = useMeetingStore(s => s.toggleMute);
  const toggleVideo        = useMeetingStore(s => s.toggleVideo);
  const setRecording       = useMeetingStore(s => s.setRecording);
  const setVoiceAiMode     = useMeetingStore(s => s.setVoiceAiMode);
  const openAssistant      = useMeetingStore(s => s.openAssistant);

  const [takeoverOpen, setTakeoverOpen] = useState(false);

  const handleScreenShare = async () => {
    if (isScreenSharing) { stopLocalScreenShare(); return; }
    const { activeScreenUserId: active } = useMeetingStore.getState();
    if (active && active !== localUserId) { setTakeoverOpen(true); return; }
    await beginLocalScreenShare();
  };

  const confirmTakeover = () => {
    const active = useMeetingStore.getState().activeScreenUserId;
    if (active && active !== localUserId) onTakeoverRequest(active);
    setTakeoverOpen(false);
  };

  const handleRecording = () => {
    if (isRecording) { onStopRecording?.(); setRecording(false); }
    else { onStartRecording?.(); setRecording(true); }
  };

  const toggleVoiceAi = () => {
    const next = !voiceAiMode;
    setVoiceAiMode(next);
    if (next && !isAssistantOpen) openAssistant();
  };

  // "Jarvis" button: opens the assistant panel + activates voice AI so you can speak to Jarvis immediately
  const triggerJarvis = () => {
    if (!isAssistantOpen) openAssistant();
    if (!voiceAiMode) setVoiceAiMode(true);
  };

  return (
    <>
      {takeoverOpen && (
        <div style={{ position:'fixed', inset:'0 0 auto', bottom:'5.5rem', zIndex:200, display:'flex', justifyContent:'center', padding:'0 1rem', pointerEvents:'none' }}>
          <div role="dialog" aria-modal="true" aria-label="Screen share takeover confirmation" style={{ pointerEvents:'auto', background:'rgba(15,15,15,.9)', backdropFilter:'blur(20px)', border:'1px solid rgba(255,255,255,.12)', borderRadius:16, padding:'1rem 1.5rem', display:'flex', alignItems:'center', gap:'1rem' }}>
            <p style={{ fontSize:'.85rem', flex:1 }}><strong>{activeScreenUserName || 'Someone'}</strong> is presenting. Take over?</p>
            <button onClick={() => setTakeoverOpen(false)} style={{ padding:'.4rem .9rem', borderRadius:8, background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.15)', color:'#fff', cursor:'pointer', fontSize:'.8rem' }}>No</button>
            <button onClick={confirmTakeover} style={{ padding:'.4rem .9rem', borderRadius:8, background:'#00ffcc', color:'#000', border:'none', cursor:'pointer', fontSize:'.8rem', fontWeight:700 }}>Yes</button>
          </div>
        </div>
      )}

      {voiceAiMode && !isWakeWordSupported() && (
        <div style={{ position:'absolute', bottom:'6.5rem', left:'50%', transform:'translateX(-50%)', zIndex:110, padding:'.6rem 1.2rem', borderRadius:12, background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.3)', color:'rgba(255,220,100,.9)', fontSize:'.72rem', textAlign:'center', whiteSpace:'nowrap' }}>
          Wake-word needs <strong>Chrome</strong> or <strong>Edge</strong> on <strong>https</strong>.
        </div>
      )}

      <div className="dock-container interactable">
        <div className="dock">
          {/* Media controls */}
          <DockBtn icon={isMuted ? <MicOff size={19}/> : <Mic size={19}/>} tip={isMuted ? 'Unmute' : 'Mute'} onClick={toggleMute} active={!isMuted} danger={isMuted} />
          <DockBtn icon={isVideoOff ? <VideoOff size={19}/> : <Video size={19}/>} tip={isVideoOff ? 'Start Video' : 'Stop Video'} onClick={toggleVideo} active={!isVideoOff} danger={isVideoOff} />

          <div className="dock-separator" />

          {/* Utility controls */}
          <DockBtn icon={isScreenSharing ? <MonitorOff size={19}/> : <MonitorUp size={19}/>} tip={isScreenSharing ? 'Stop Share' : 'Share Screen'} onClick={handleScreenShare} active={isScreenSharing} />
          <DockBtn icon={<Circle size={19} className={clsx(isRecording && 'fill-rose-500 text-rose-500 recording-dot')} />} tip={isRecording ? 'Stop Rec' : 'Record'} onClick={handleRecording} danger={isRecording} />
          <DockBtn icon={<AudioLines size={19} strokeWidth={voiceAiMode ? 2.25 : 2}/>} tip={voiceAiMode ? 'Voice AI On' : 'Voice AI Off'} onClick={toggleVoiceAi} active={voiceAiMode} />

          <div className="dock-separator" />

          {/* Jarvis summon — opens panel + activates voice; pulses when voice AI is active */}
          <button
            className={clsx('jarvis-wake', voiceAiMode && 'voice-active')}
            onClick={triggerJarvis}
            title="Summon Jarvis — opens the AI panel and activates voice listening"
          >
            <BrainCircuit size={15} />
            <span>Jarvis</span>
          </button>

          <div className="dock-separator" />

          <button className="dock-btn danger" data-tooltip="End Session" aria-label="End Session" onClick={onLeave}>
            <PhoneOff size={19} />
          </button>
        </div>
      </div>
    </>
  );
}

function DockBtn({ icon, tip, onClick, active = false, danger = false }: { icon: React.ReactNode; tip: string; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button className={clsx('dock-btn', active && !danger && 'active', danger && 'danger')} data-tooltip={tip} aria-label={tip} onClick={onClick}>
      {icon}
    </button>
  );
}
