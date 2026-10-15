import { useNavigate, useParams } from 'react-router-dom';
import { useMeetingStore } from '../store/meetingStore';
import { Download, Share2, Copy, Check, FileDown, Mail, Loader2, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { formatTranscriptMarkdown } from '../lib/formatMeetingTranscript';
import { TopicsCard } from '../components/end/TopicsCard';
import { SummaryCard } from '../components/end/SummaryCard';
import { NotesCard } from '../components/end/NotesCard';
import { ActionItemsCard } from '../components/end/ActionItemsCard';
import { TranscriptCard } from '../components/end/TranscriptCard';

export function MeetingEnd() {
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();
  const storeData = useMeetingStore(s => s.meetingEndData);
  const [data, setData] = useState(storeData);
  const [copied, setCopied] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!roomId || !storeData) return;
    let cancelled = false;
    api.getMeetingIntelligence(roomId).then(intel => {
      if (cancelled) return;
      const dbNotes = (intel.notes || []).map((n: any) => ({
        id: n.id,
        text: n.content,
        ts: n.at ? new Date(n.at).getTime() : Date.now(),
        section: n.section || '',
        session_id: n.session_id ?? null,
        session_title: n.session_title ?? null,
      }));
      const dbActions = (intel.action_items || []).map((a: any) => ({
        id: a.id,
        title: a.title,
        assigned_to: a.assigned_to ?? null,
        due_date: a.due_date ?? null,
        status: (a.status === 'completed' ? 'completed' : 'pending') as 'completed' | 'pending',
      }));
      const trMd = formatTranscriptMarkdown(intel.transcripts || []);
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          topics: intel.topics ?? [],
          keywords: intel.keywords ?? [],
          notes: dbNotes.length > 0 ? dbNotes : prev.notes,
          actionItems: dbActions,
          spokenTranscript: trMd.trim() ? trMd : (prev.spokenTranscript ?? ''),
        };
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [roomId, storeData]);

  if (!data) return (
    <div style={{ minHeight:'100vh', background:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Space Grotesk',sans-serif", color:'#fff' }}>
      <div style={{ background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.1)', borderRadius:24, padding:'3rem', maxWidth:400, textAlign:'center' }}>
        <h2 style={{ marginBottom:'1rem' }}>No meeting data</h2>
        <p style={{ opacity:.5, marginBottom:'2rem' }}>Session may have expired.</p>
        <button onClick={() => navigate('/')} style={{ padding:'.8rem 2rem', background:'#ffd700', color:'#000', border:'none', borderRadius:100, fontWeight:700, cursor:'pointer' }}>Go Home</button>
      </div>
    </div>
  );

  const download = () => {
    let c = `# ${data.title}\n\nDuration: ${data.duration}\nParticipants: ${data.participants.join(', ')}\n\n## Summary\n\n${data.summary||'No summary.'}\n`;
    if (data.spokenTranscript?.trim()) c += `\n## Transcript\n\n${data.spokenTranscript}\n`;
    if (data.notes.length) c += `\n## Notes\n\n${data.notes.map(n => `- ${n.text}`).join('\n')}\n`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([c],{type:'text/markdown'}));
    a.download = `${data.title.replace(/\s+/g,'_')}_synthesis.md`; a.click();
  };

  const copyAll = async () => {
    await navigator.clipboard.writeText(`${data.title}\nDuration: ${data.duration}\n\nSummary:\n${data.summary}`);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = () => {
    const url = `${window.location.origin}/meeting/${roomId}/end`;
    if (navigator.share) void navigator.share({ title: data.title, url });
    else { void navigator.clipboard.writeText(url); setCopied(true); setTimeout(()=>setCopied(false),2000); }
  };

  const downloadPdf = async () => {
    if (!roomId) return;
    setPdfLoading(true);
    try {
      const blob = await api.exportPdf(roomId);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${data?.title?.replace(/\s+/g, '_') ?? 'meeting'}_report.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { /* silently fail — backend may not be running */ }
    finally { setPdfLoading(false); }
  };

  const sendEmail = async () => {
    if (!roomId) return;
    const recipients = emailTo.split(',').map((s) => s.trim()).filter(Boolean);
    if (recipients.length === 0) return;
    setEmailSending(true);
    setEmailStatus(null);
    try {
      await api.sendSummaryEmail(roomId, { to: recipients });
      setEmailStatus({ ok: true, msg: `Summary sent to ${recipients.join(', ')}` });
      setTimeout(() => { setEmailOpen(false); setEmailStatus(null); setEmailTo(''); }, 2500);
    } catch (e) {
      setEmailStatus({ ok: false, msg: e instanceof Error ? e.message : 'Failed to send email' });
    } finally {
      setEmailSending(false);
    }
  };

  return (
    <div style={{ minHeight:'100vh', background:'#000', fontFamily:"'Space Grotesk',sans-serif", color:'#fff', overflowY:'auto', overflowX:'hidden',
      backgroundImage:'radial-gradient(circle at 50% 0%, rgba(255,215,0,.05), transparent 50%), radial-gradient(circle at 100% 100%, rgba(0,255,204,.05), transparent 50%)' }}>
      <div className="noise" />

      {/* Nav */}
      <nav style={{ position:'sticky', top:0, width:'100%', padding:'1.5rem 3rem', display:'flex', justifyContent:'space-between', alignItems:'center', zIndex:100, background:'linear-gradient(to bottom,rgba(0,0,0,.8),transparent)', backdropFilter:'blur(4px)' }}>
        <div style={{ fontFamily:"'Outfit',sans-serif", fontSize:'1.2rem', fontWeight:900, letterSpacing:'-1px', textTransform:'uppercase' }}>Meet-Mind-Synthesis</div>
        <div style={{ display:'flex', gap:'.8rem', alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={download} title="Download Markdown" aria-label="Download Markdown" className="icon-btn"><Download size={16}/></button>
          <button onClick={downloadPdf} title="Export PDF" aria-label="Export PDF" disabled={pdfLoading} className="icon-btn" style={ pdfLoading ? { background:'rgba(255,215,0,.15)', borderColor:'rgba(255,215,0,.4)', color:'#ffd700' } : undefined }>
            {pdfLoading ? <Loader2 size={16} style={{ animation:'spin .8s linear infinite' }}/> : <FileDown size={16}/>}
          </button>
          <button onClick={() => { setEmailOpen(true); setEmailStatus(null); }} title="Email Summary" aria-label="Email Summary" className="icon-btn"><Mail size={16}/></button>
          <button onClick={copyAll} title="Copy" aria-label="Copy summary" className="icon-btn">{copied?<Check size={16} style={{color:'#00ffcc'}}/>:<Copy size={16}/>}</button>
          <button onClick={shareLink} title="Share" aria-label="Share link" className="icon-btn"><Share2 size={16}/></button>
          <button onClick={() => navigate('/')} className="pill-btn" style={{ textTransform:'uppercase', letterSpacing:1 }}>Return Home</button>
        </div>
      </nav>

      {/* Email modal */}
      {emailOpen && (
        <div
          onClick={() => { setEmailOpen(false); setEmailStatus(null); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setEmailOpen(false); setEmailStatus(null); } }}
          style={{ position:'fixed', inset:0, zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.6)', backdropFilter:'blur(6px)' }}
        >
          <div
            role="dialog" aria-modal="true" aria-labelledby="email-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{ background:'rgba(12,12,18,.95)', border:'1px solid rgba(255,255,255,.12)', borderRadius:20, padding:'2rem', width:'min(480px, 94vw)', boxShadow:'0 24px 60px rgba(0,0,0,.6)' }}
          >
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem' }}>
              <div>
                <div id="email-modal-title" style={{ fontFamily:"'Outfit',sans-serif", fontSize:'1.1rem', fontWeight:700, letterSpacing:'-0.5px' }}>Email Summary</div>
                <div style={{ fontSize:'.8rem', opacity:.45, marginTop:2 }}>Recipients will receive the meeting summary, action items, and decisions.</div>
              </div>
              <button onClick={() => { setEmailOpen(false); setEmailStatus(null); }} aria-label="Close email dialog" style={{ width:32, height:32, borderRadius:'50%', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><X size={14}/></button>
            </div>
            <label style={{ display:'block', fontSize:'.75rem', textTransform:'uppercase', letterSpacing:1, opacity:.5, marginBottom:'.4rem' }}>To (comma-separated)</label>
            <input
              type="text"
              value={emailTo}
              autoFocus
              onChange={(e) => setEmailTo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void sendEmail(); }}
              placeholder="alice@example.com, bob@example.com"
              className="end-input"
              style={{ width:'100%', padding:'.75rem 1rem', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.12)', borderRadius:12, color:'#fff', fontSize:'.9rem', boxSizing:'border-box', marginBottom:'1rem' }}
            />
            {emailStatus && (
              <div style={{ padding:'.6rem 1rem', borderRadius:10, background: emailStatus.ok ? 'rgba(0,255,204,.12)' : 'rgba(255,68,68,.12)', border:`1px solid ${emailStatus.ok ? 'rgba(0,255,204,.3)' : 'rgba(255,68,68,.3)'}`, color: emailStatus.ok ? '#00ffcc' : '#ff6b6b', fontSize:'.82rem', marginBottom:'1rem' }}>
                {emailStatus.msg}
              </div>
            )}
            <div style={{ display:'flex', gap:'.75rem', justifyContent:'flex-end' }}>
              <button onClick={() => { setEmailOpen(false); setEmailStatus(null); }} className="pill-btn">Cancel</button>
              <button onClick={sendEmail} disabled={emailSending || !emailTo.trim()} style={{ padding:'.6rem 1.6rem', background: emailSending ? 'rgba(255,215,0,.2)' : '#ffd700', border:'none', borderRadius:100, color: emailSending ? '#ffd700' : '#000', fontWeight:700, fontSize:'.85rem', cursor: emailSending || !emailTo.trim() ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', gap:'.4rem', opacity: !emailTo.trim() ? .45 : 1 }}>
                {emailSending ? <><Loader2 size={14} style={{ animation:'spin .8s linear infinite' }}/> Sending…</> : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="bento-dashboard">
        {/* Meta card (unchanged) */}
        <div className="bento-card bento-meta interactable" style={{ animationDelay: '.1s' }}>
          <div className="card-label">Session Complete</div>
          <h1 style={{ fontFamily:"'Outfit',sans-serif", fontSize:'clamp(2rem,5vw,3.8rem)', fontWeight:900, lineHeight:1, letterSpacing:'-2px', marginBottom:'1rem' }}>
            {data.title.split(' ').map((w,i,arr) => i===arr.length-1 ? <em key={i} style={{ color:'#ffd700', fontStyle:'normal' }}>{w}</em> : w+' ')}
          </h1>
          <p style={{ opacity:.55, maxWidth:560, lineHeight:1.65, fontSize:'.95rem' }}>
            Jarvis monitored the session and synthesized key decisions and action items in real-time.
          </p>
          <div style={{ display:'flex', gap:'1rem', marginTop:'auto', paddingTop:'2rem', flexWrap:'wrap' }}>
            <span className="participant-tag highlight">{data.startTime ? data.startTime.toLocaleDateString() : 'Today'}</span>
            <span className="participant-tag">{data.duration}</span>
            <span className="participant-tag">{data.participants.length} Participants</span>
            {data.participants.map((p,i) => <span key={i} className="participant-tag">{p}</span>)}
          </div>
        </div>

        <TopicsCard topics={data.topics} keywords={data.keywords} />
        <SummaryCard summary={data.summary} />
        <NotesCard notes={data.notes} />
        <ActionItemsCard roomName={roomId!} items={data.actionItems} />
        <TranscriptCard transcript={data.spokenTranscript ?? ''} />
      </main>
    </div>
  );
}
