import { useNavigate, useParams } from 'react-router-dom';
import { useMeetingStore } from '../store/meetingStore';
import { Download, Share2, Copy, Check, FileDown, Mail, Loader2, X, ArrowUpRight, AudioLines } from 'lucide-react';
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
    <div className="cc-page cc-auth">
      <div className="cc-bg" />
      <div className="cc-dialog" style={{ maxWidth:400, textAlign:'center' }}>
        <h2 className="cc-dialog-title">No meeting data</h2>
        <p className="cc-dialog-sub">Session may have expired.</p>
        <button onClick={() => navigate('/')} className="cc-btn cc-btn-primary">Go Home</button>
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
    <div style={{ minHeight:'100vh', background:'var(--cc-bg)', fontFamily:'var(--font-body)', color:'var(--cc-text)', overflowY:'auto', overflowX:'hidden',
      backgroundImage:'radial-gradient(60vmax 40vmax at 0% -10%, rgba(250,97,20,.32), transparent 60%), radial-gradient(50vmax 40vmax at 100% 110%, rgba(250,97,20,.12), transparent 60%)' }}>
      <div className="noise" />

      {/* Nav */}
      <nav style={{ position:'sticky', top:0, width:'100%', padding:'1.5rem 3rem', display:'flex', justifyContent:'space-between', alignItems:'center', zIndex:100, background:'linear-gradient(to bottom,rgba(9,4,1,.85),transparent)', backdropFilter:'blur(4px)' }}>
        <div className="cc-logo" style={{ fontSize:'1.25rem' }}><span className="cc-logo-mark"><AudioLines size={16} strokeWidth={2.4}/></span>MeetMind</div>
        <div style={{ display:'flex', gap:'.8rem', alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={download} title="Download Markdown" aria-label="Download Markdown" className="icon-btn"><Download size={16}/></button>
          <button onClick={downloadPdf} title="Export PDF" aria-label="Export PDF" disabled={pdfLoading} className="icon-btn" style={ pdfLoading ? { background:'rgba(255,176,103,.15)', borderColor:'rgba(255,176,103,.4)', color:'#ffb067' } : undefined }>
            {pdfLoading ? <Loader2 size={16} style={{ animation:'spin .8s linear infinite' }}/> : <FileDown size={16}/>}
          </button>
          <button onClick={() => { setEmailOpen(true); setEmailStatus(null); }} title="Email Summary" aria-label="Email Summary" className="icon-btn"><Mail size={16}/></button>
          <button onClick={copyAll} title="Copy" aria-label="Copy summary" className="icon-btn">{copied?<Check size={16} style={{color:'#fa6114'}}/>:<Copy size={16}/>}</button>
          <button onClick={shareLink} title="Share" aria-label="Share link" className="icon-btn"><Share2 size={16}/></button>
          <button onClick={() => navigate('/')} className="cc-btn cc-btn-light cc-btn-sm">Return Home <ArrowUpRight size={16} className="cc-arrow"/></button>
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
            className="cc-dialog" style={{ maxWidth:480, width:'min(480px, 94vw)' }}
          >
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem' }}>
              <div>
                <div id="email-modal-title" style={{ fontFamily:'var(--font-display)', fontSize:'1.5rem', fontWeight:500, letterSpacing:'-.03em' }}>Email Summary</div>
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
              className="cc-input"
              style={{ marginBottom:'1rem' }}
            />
            {emailStatus && (
              <div style={{ padding:'.6rem 1rem', borderRadius:10, background: emailStatus.ok ? 'rgba(250,97,20,.12)' : 'rgba(255,68,68,.12)', border:`1px solid ${emailStatus.ok ? 'rgba(250,97,20,.3)' : 'rgba(255,68,68,.3)'}`, color: emailStatus.ok ? '#fa6114' : '#ff6b6b', fontSize:'.82rem', marginBottom:'1rem' }}>
                {emailStatus.msg}
              </div>
            )}
            <div style={{ display:'flex', gap:'.75rem', justifyContent:'flex-end' }}>
              <button onClick={() => { setEmailOpen(false); setEmailStatus(null); }} className="cc-btn cc-btn-subtle cc-btn-sm">Cancel</button>
              <button onClick={sendEmail} disabled={emailSending || !emailTo.trim()} className="cc-btn cc-btn-primary cc-btn-sm">
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
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(2.2rem,5vw,4.2rem)', fontWeight:500, lineHeight:1.05, letterSpacing:'-.035em', marginBottom:'1rem' }}>
            {data.title.split(' ').map((w,i,arr) => i===arr.length-1 ? <em key={i} className="cc-accent-text" style={{ fontStyle:'normal' }}>{w}</em> : w+' ')}
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
