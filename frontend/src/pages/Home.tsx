import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Mic, Brain, Monitor, CheckSquare, Vote, FileText, Zap, Play, LogOut } from 'lucide-react';
import { useMeetingStore } from '../store/meetingStore';
import { useAuthStore } from '../store/authStore';
import { api, ApiError } from '../services/api';

const FEATURES = [
  { icon: Mic, title: 'Real-Time Transcription', desc: 'Distil-Whisper runs locally on your machine — zero API cost per minute. 98% accuracy, near-real-time latency with continuous voice activity detection.', tag: 'Free · Local' },
  { icon: Brain, title: 'AI Role-Playing', desc: 'Say "Jarvis, act as an investor" or "play devil\'s advocate" and get instant perspective shifts. Powered by GPT-4o for deep reasoning and structured replies.', tag: 'GPT-4o' },
  { icon: Monitor, title: 'Screen Analysis', desc: 'Share your screen and say "Jarvis, check the screen." It analyzes designs, code, documents, and gives structured feedback — live, to everyone in the call.', tag: 'Vision AI' },
  { icon: CheckSquare, title: 'Action Item Extraction', desc: 'spaCy NER + OpenAI automatically detects who owns what task and by when. "John should send the report by Friday" becomes a tracked action item instantly.', tag: 'spaCy + GPT' },
  { icon: Vote, title: 'In-Meeting Voting', desc: 'Say "Jarvis, start a vote on X" and all participants can vote in real time. Results are recorded in the meeting summary automatically.', tag: 'Real-time' },
  { icon: FileText, title: 'Post-Meeting Summary PDF', desc: 'When the meeting ends, get a complete structured document: full transcript, decisions made, action items with owners, and next steps — exported as PDF.', tag: 'ReportLab' },
];

const COMMANDS = [
  { text: 'Hey Jarvis, start taking notes', intent: 'TAKE_NOTES' },
  { text: 'Hey Jarvis, start recording', intent: 'RECORD' },
  { text: 'Jarvis, act as an investor', intent: 'PLAY_ROLE' },
  { text: 'Jarvis, check the screen', intent: 'ANALYZE_SCREEN' },
  { text: 'Hey Jarvis, help us decide', intent: 'HELP_DECIDE' },
  { text: 'Jarvis, brainstorm ideas for X', intent: 'BRAINSTORM' },
  { text: 'Jarvis, play devil\'s advocate', intent: 'DEVIL_ADVOCATE' },
  { text: 'Hey Jarvis, give us a summary', intent: 'GET_SUMMARY' },
  { text: 'Jarvis, create action items', intent: 'ACTION_ITEMS' },
  { text: 'Hey Jarvis, start a vote on X', intent: 'START_VOTE' },
];

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Respect reduced-motion preference — skip the particle animation entirely.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = window.innerWidth;
    let H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;

    const mouse = { x: -999, y: -999 };
    const PARTICLE_COUNT = 80;

    const handleResize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;
    };
    window.addEventListener('resize', handleResize);

    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener('mousemove', handleMouseMove);

    class Particle {
      x!: number; y!: number; size!: number; speedX!: number; speedY!: number; opacity!: number; color!: string;
      constructor() { this.reset(); }
      reset() {
        this.x = Math.random() * W;
        this.y = Math.random() * H;
        this.size = Math.random() * 1.5 + 0.3;
        this.speedX = (Math.random() - 0.5) * 0.35;
        this.speedY = (Math.random() - 0.5) * 0.35;
        this.opacity = Math.random() * 0.5 + 0.1;
        this.color = Math.random() > 0.6 ? '0,255,204' : Math.random() > 0.5 ? '0,217,245' : '100,150,255';
      }
      update() {
        const dx = this.x - mouse.x, dy = this.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          const force = (120 - dist) / 120;
          this.x += (dx / dist) * force * 1.5;
          this.y += (dy / dist) * force * 1.5;
        }
        this.x += this.speedX; this.y += this.speedY;
        if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) this.reset();
      }
      draw() {
        ctx!.beginPath();
        ctx!.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${this.color},${this.opacity})`;
        ctx!.fill();
      }
    }

    const particles = Array.from({ length: PARTICLE_COUNT }, () => new Particle());

    function drawConnections() {
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 90) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(0,255,204,${0.06 * (1 - dist / 90)})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }
    }

    let animationFrameId: number;
    const animate = () => {
      ctx!.clearRect(0, 0, W, H);
      particles.forEach(p => { p.update(); p.draw(); });
      drawConnections();
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: -3, pointerEvents: 'none' }} />;
}

function useScrollAnimations() {
  useEffect(() => {
    // 1. Scroll progress bar
    const bar = document.getElementById('scroll-progress');
    const onScroll = () => {
      if (!bar) return;
      const total = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${total > 0 ? window.scrollY / total : 0})`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // 2. Counter animations for [data-target] elements
    const animateCounter = (el: HTMLElement) => {
      const raw = el.dataset.target ?? '0';
      const prefix = raw.startsWith('$') ? '$' : '';
      const suffix = raw.endsWith('%') ? '%' : raw.endsWith('+') ? '+' : '';
      const num = parseInt(raw.replace(/\D/g, ''), 10) || 0;
      const t0 = performance.now();
      const duration = 1600;
      const tick = (now: number) => {
        const t = Math.min((now - t0) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 4); // ease-out quart
        el.textContent = `${prefix}${Math.round(ease * num)}${suffix}`;
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const counterObs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting && !e.target.hasAttribute('data-counted')) {
          e.target.setAttribute('data-counted', '1');
          setTimeout(() => animateCounter(e.target as HTMLElement), 250);
        }
      });
    }, { threshold: 0.5 });
    document.querySelectorAll<HTMLElement>('[data-target]').forEach(el => counterObs.observe(el));

    // 3. Stagger groups — cascade children with increasing delays
    const staggerObs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          (e.target as HTMLElement).querySelectorAll<HTMLElement>('.stagger-child').forEach((child, i) => {
            child.style.transitionDelay = `${i * 75}ms`;
            child.classList.add('in-view');
          });
          staggerObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });
    document.querySelectorAll('.stagger-group').forEach(el => staggerObs.observe(el));

    // 4. Reveal variants (left / right / scale)
    const variantObs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in-view');
          variantObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.reveal-left, .reveal-right, .reveal-scale').forEach(el => variantObs.observe(el));

    return () => {
      window.removeEventListener('scroll', onScroll);
      counterObs.disconnect();
      staggerObs.disconnect();
      variantObs.disconnect();
    };
  }, []);
}

export function Home() {
  const navigate = useNavigate();
  const { setRoom, setUserName } = useMeetingStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [name, setName] = useState(user?.name ?? '');
  const [joinId, setJoinId] = useState('');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastMeetings, setPastMeetings] = useState<{ id: string; roomName: string; title: string; status: string; createdAt: string | null; endedAt: string | null; durationMinutes: number | null }[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useScrollAnimations();

  // Prefill the name from the logged-in profile once it resolves (don't clobber typed input).
  useEffect(() => {
    if (user?.name) setName((prev) => prev || user.name);
  }, [user?.name]);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  useEffect(() => { api.listMeetings().then(setPastMeetings).catch(() => { }); }, []);

  // Intersection Observer for scroll animations (re-run when DOM adds .reveal-up nodes, e.g. past meetings)
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view', 'visible');
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    const elements = document.querySelectorAll('.reveal-up, .reveal');
    elements.forEach(el => observer.observe(el));

    return () => observer.disconnect();
  }, [pastMeetings.length]);

  const createMeeting = async () => {
    if (!name.trim() || creating) return;
    setError(null); setCreating(true);
    try {
      const meeting = await api.createMeeting(title.trim() || 'New Meeting');
      setUserName(name.trim()); setRoom(meeting.roomName, meeting.title);
      navigate(`/meeting/${meeting.roomName}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to create meeting'); }
    finally { setCreating(false); }
  };

  const joinMeeting = async () => {
    if (!name.trim() || !joinId.trim() || joining) return;
    setError(null); setJoining(true);
    try {
      const meeting = await api.joinMeeting(joinId.trim(), name.trim());
      setUserName(name.trim()); setRoom(meeting.roomName, meeting.title);
      navigate(`/meeting/${meeting.roomName}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setError('Meeting not found. Check the ID and try again.');
      else setError(err instanceof Error ? err.message : 'Failed to join meeting');
    } finally { setJoining(false); }
  };

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: 'transparent', color: '#f0f0f0', fontFamily: "'Space Grotesk', sans-serif" }}>
      <div id="scroll-progress" />
      <ParticleCanvas />
      <div className="landing-bg" />
      <div className="landing-grid" />

      {/* Nav */}
      <nav className="reveal-up in-view" style={{ position: 'fixed', width: '100%', padding: '1.4rem 3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 800, background: 'rgba(3,7,18,0.88)', backdropFilter: 'blur(24px)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ fontFamily: "'Outfit',sans-serif", fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-1px', textTransform: 'uppercase', color: '#fff' }}>
          Meet-Mind-Synthesis<span style={{ display: 'inline-block', width: 6, height: 6, background: '#00ffcc', borderRadius: '50%', marginLeft: 4, animation: 'pulse 2s infinite' }}></span>
        </div>
        <div style={{ display: 'flex', gap: '2.5rem', alignItems: 'center' }}>
          <a href="#features" className="nav-link interactable">Features</a>
          <a href="#commands" className="nav-link interactable">Commands</a>
          <a href="#pricing" className="nav-link interactable">Pricing</a>
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: 'rgba(255,255,255,.75)', fontFamily: "'Outfit',sans-serif" }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,255,204,0.12)', border: '1px solid rgba(0,255,204,0.3)', display: 'grid', placeItems: 'center', color: '#00ffcc', fontWeight: 700, fontSize: '0.75rem' }}>
                  {(user.name || user.email || '?').charAt(0).toUpperCase()}
                </span>
                {user.name}
              </span>
              <button onClick={handleLogout} title="Log out" className="interactable"
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'rgba(255,255,255,.7)', border: '1px solid rgba(255,255,255,0.15)', padding: '0.4rem 0.9rem', borderRadius: '100px', fontSize: '0.75rem', cursor: 'pointer', fontFamily: "'Outfit',sans-serif", letterSpacing: 1, textTransform: 'uppercase' }}>
                <LogOut size={13} /> Logout
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="reveal-up in-view" style={{ minHeight: '92vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', position: 'relative', overflow: 'hidden', paddingTop: '80px' }}>
        <div style={{ fontSize: '0.75rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#00ffcc', border: '1px solid rgba(0,255,204,0.2)', padding: '0.4rem 1rem', borderRadius: '100px', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: 6, height: 6, background: '#00ffcc', borderRadius: '50%', boxShadow: '0 0 8px rgba(0,255,204,0.8)' }}></div>
          AI-Powered · Real-time · Voice-First
        </div>
        <h1 style={{
          fontFamily: "'Syne',sans-serif", fontSize: 'clamp(3.5rem,8vw,7rem)', fontWeight: 900, lineHeight: 1.05, letterSpacing: '-0.03em', zIndex: 10, marginBottom: '1rem'
        }}>
          Meetings that<br />
          <em style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontWeight: 400, background: 'linear-gradient(135deg, #00ffcc 0%, #00d9f5 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>think</em> with you
        </h1>
        <p style={{ fontSize: '1.1rem', marginTop: '1rem', maxWidth: 580, fontWeight: 300, opacity: .8, zIndex: 10, padding: '0 1rem', lineHeight: 1.8 }}>
          Meet-Mind is your AI co-pilot in every call. <strong>Hey Jarvis</strong> — and it takes notes, analyzes screens, plays devil's advocate, and summarizes everything when you're done.
        </p>

        {/* Live Terminal Demo */}
        <div className="hero-terminal" style={{ margin: '4rem auto 0', maxWidth: 700, width: '90%', zIndex: 10 }}>
          <div className="terminal-bar">
            <div className="t-dot" style={{ background: '#ff5f57' }}></div>
            <div className="t-dot" style={{ background: '#ffbd2e' }}></div>
            <div className="t-dot" style={{ background: '#28ca41' }}></div>
            <span className="terminal-label" style={{ marginLeft: 'auto', fontSize: '0.62rem', color: '#5a6880', letterSpacing: '0.14em' }}><span style={{ color: '#00ffcc' }}>●</span> JARVIS LIVE SESSION</span>
          </div>
          <div className="terminal-body" style={{ padding: '1.5rem', fontSize: '0.85rem', lineHeight: 2.1, minHeight: 180, textAlign: 'left', fontFamily: 'monospace' }}>
            <div className="t-line" style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
              <span className="t-speaker t-friend" style={{ color: '#a78bfa', fontWeight: 600, minWidth: 70 }}>Alex:</span>
              <span className="t-text" style={{ color: '#7a8fa8' }}>Should we launch the product now or wait?</span>
            </div>
            <div className="t-line" style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', animationDelay: '1s' }}>
              <span className="t-speaker t-you" style={{ color: '#00d9f5', fontWeight: 600, minWidth: 70 }}>You:</span>
              <span className="t-text" style={{ color: '#7a8fa8' }}>Hey Jarvis, act as an investor. What's your take?</span>
            </div>
            <div className="t-line" style={{ display: 'flex', gap: '1rem', marginTop: '1rem', animationDelay: '2s' }}>
              <span className="t-speaker t-jarvis" style={{ color: '#00ffcc', fontWeight: 600, minWidth: 70 }}>Jarvis:</span>
              <span className="t-response" style={{ color: '#c8f0e0' }}>
                INVESTOR PERSPECTIVE:<br />
                - Pros: Larger TAM, faster growth potential<br />
                - Cons: Harder customer acquisition<br />
                - Recommendation: Validate demand first with MVP
                <span className="t-cursor" style={{ display: 'inline-block', width: 8, height: 12, background: '#00ffcc', marginLeft: 4, animation: 'cursor-blink 1s infinite' }}></span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Hero CTA Buttons */}
      <section id="join" className="reveal-up" style={{ display: 'flex', justifyContent: 'center', gap: '1rem', padding: '3rem 2rem', flexWrap: 'wrap' }}>
        <button onClick={() => setIsModalOpen(true)} className="btn-land btn-land-primary interactable"
          style={{ padding: '1.1rem 3rem', fontSize: '1rem', letterSpacing: 2 }}>
          <Play size={16} fill="currentColor" />Start Meeting Free
        </button>
        <button onClick={() => setIsModalOpen(true)} className="btn-land btn-land-ghost interactable"
          style={{ padding: '1.1rem 3rem', fontSize: '1rem', letterSpacing: 2 }}>
          Join a Room
        </button>
      </section>

      {/* Modal */}
      {isModalOpen && (
        <div onClick={e => { if (e.target === e.currentTarget) { setIsModalOpen(false); setError(null); } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ width: '100%', maxWidth: 460, padding: '2.5rem', background: 'rgba(10,15,26,0.98)', border: '1px solid rgba(0,255,204,0.2)', borderRadius: 24, boxShadow: '0 0 80px rgba(0,255,204,0.15)', position: 'relative' }}>
            <button onClick={() => { setIsModalOpen(false); setError(null); }}
              style={{ position: 'absolute', top: '1.2rem', right: '1.4rem', background: 'none', border: 'none', color: '#5a6880', fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 }}>✕</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '2rem' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00ffcc', boxShadow: '0 0 12px #00ffcc' }} />
              <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Enter the Meeting Room</h3>
            </div>
            {error && <div style={{ marginBottom: '1rem', padding: '.75rem 1rem', borderRadius: 10, background: 'rgba(255,60,60,.1)', border: '1px solid rgba(255,60,60,.25)', color: '#ff8080', fontSize: '.85rem' }}>{error}</div>}
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your Name *" className="land-input"
              style={{ width: '100%', padding: '.9rem 1.4rem', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 100, color: '#fff', marginBottom: '.75rem', fontSize: '.95rem', boxSizing: 'border-box' }} />
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Meeting Title (optional)" className="land-input"
              style={{ width: '100%', padding: '.9rem 1.4rem', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 100, color: '#fff', marginBottom: '1rem', fontSize: '.95rem', boxSizing: 'border-box' }} />
            <button onClick={createMeeting} disabled={!name.trim() || creating}
              style={{ width: '100%', padding: '1rem', background: '#00ffcc', color: '#000', border: 'none', borderRadius: 100, fontWeight: 700, fontSize: '.95rem', textTransform: 'uppercase', letterSpacing: 2, cursor: !name.trim() || creating ? 'not-allowed' : 'pointer', opacity: !name.trim() || creating ? .5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 0 30px rgba(0,255,204,0.25)', marginBottom: '1.5rem' }}>
              {creating ? <Loader2 size={18} className="animate-spin" /> : <><Play size={15} fill="currentColor" /> Create New Meeting</>}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', opacity: .4 }}>
              <div style={{ flex: 1, height: 1, background: '#fff' }} />
              <span style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: 3, fontFamily: 'monospace' }}>OR JOIN</span>
              <div style={{ flex: 1, height: 1, background: '#fff' }} />
            </div>
            <div style={{ display: 'flex', gap: '.6rem' }}>
              <input type="text" value={joinId} onChange={e => setJoinId(e.target.value)} onKeyDown={e => e.key === 'Enter' && joinMeeting()} placeholder="Paste Meeting ID" className="land-input"
                style={{ flex: 1, padding: '.9rem 1.4rem', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 100, color: '#fff', minWidth: 0, fontFamily: 'monospace', fontSize: '.9rem' }} />
              <button onClick={joinMeeting} disabled={!name.trim() || !joinId.trim() || joining}
                style={{ padding: '.9rem 1.6rem', background: 'rgba(255,255,255,.08)', color: '#fff', border: '1px solid rgba(255,255,255,.15)', borderRadius: 100, fontWeight: 700, fontSize: '.85rem', textTransform: 'uppercase', letterSpacing: 1, cursor: !name.trim() || !joinId.trim() || joining ? 'not-allowed' : 'pointer', opacity: !name.trim() || !joinId.trim() || joining ? .5 : 1, whiteSpace: 'nowrap' }}>
                {joining ? <Loader2 size={16} className="animate-spin" /> : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <section className="reveal-left" style={{ padding: '0', margin: '4rem 0' }}>
        <div className="stats-page" style={{ width: '100%', display: 'flex', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.1)', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}>
          <div className="stat-item reveal" style={{ flex: 1, minWidth: 250, padding: '4rem 2rem', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
            <div data-target="98%" className="stat-num" style={{ fontFamily: "'Syne', sans-serif", fontSize: '4rem', fontWeight: 800, background: 'linear-gradient(135deg, #00ffcc 0%, #00d9f5 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>98%</div>
            <div className="stat-label" style={{ fontSize: '0.7rem', color: '#5a6880', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.8rem' }}>STT Accuracy</div>
            <div className="stat-desc" style={{ fontSize: '0.65rem', color: 'rgba(150,160,180,0.6)', marginTop: '0.4rem' }}>Distil-Whisper local model</div>
          </div>
          <div className="stat-item reveal" style={{ flex: 1, minWidth: 250, padding: '4rem 2rem', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="stat-num" style={{ fontFamily: "'Syne', sans-serif", fontSize: '4rem', fontWeight: 800, background: 'linear-gradient(135deg, #00ffcc 0%, #00d9f5 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>$0</div>
            <div className="stat-label" style={{ fontSize: '0.7rem', color: '#5a6880', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.8rem' }}>Audio Processing Cost</div>
            <div className="stat-desc" style={{ fontSize: '0.65rem', color: 'rgba(150,160,180,0.6)', marginTop: '0.4rem' }}>Runs entirely on-device</div>
          </div>
          <div className="stat-item reveal" style={{ flex: 1, minWidth: 250, padding: '4rem 2rem', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
            <div data-target="10+" className="stat-num" style={{ fontFamily: "'Syne', sans-serif", fontSize: '4rem', fontWeight: 800, background: 'linear-gradient(135deg, #00ffcc 0%, #00d9f5 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>10+</div>
            <div className="stat-label" style={{ fontSize: '0.7rem', color: '#5a6880', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.8rem' }}>Voice Commands</div>
            <div className="stat-desc" style={{ fontSize: '0.65rem', color: 'rgba(150,160,180,0.6)', marginTop: '0.4rem' }}>Natural language intent</div>
          </div>
          <div className="stat-item reveal" style={{ flex: 1, minWidth: 250, padding: '4rem 2rem', textAlign: 'center' }}>
            <div className="stat-num" style={{ fontFamily: "'Syne', sans-serif", fontSize: '3rem', fontWeight: 800, background: 'linear-gradient(135deg, #00ffcc 0%, #00d9f5 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '1.33em' }}>P2P</div>
            <div className="stat-label" style={{ fontSize: '0.7rem', color: '#5a6880', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.8rem' }}>WebRTC Architecture</div>
            <div className="stat-desc" style={{ fontSize: '0.65rem', color: 'rgba(150,160,180,0.6)', marginTop: '0.4rem' }}>No media server required</div>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section id="features" style={{ minHeight: '80vh', position: 'relative', padding: '10vh 5vw', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div className="section-header reveal-up" style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <div style={{ fontSize: '0.65rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#00ffcc', marginBottom: '1rem', opacity: 0.8 }}>What Jarvis can do</div>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 'clamp(2rem, 4.5vw, 3.2rem)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.08 }}>
            Not just a transcriber.<br />
            <em className="glow-line" style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontWeight: 400, color: '#00ffcc' }}>A thinking partner.</em>
          </h2>
          <p style={{ color: '#5a6880', marginTop: '1rem', fontSize: '0.9rem', maxWidth: 460, marginInline: 'auto', lineHeight: 1.7 }}>Replaces Otter.ai + Zoom + Notion — in one tool, with a voice.</p>
        </div>

        <div className="features-grid stagger-group" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.05)', width: '100%', maxWidth: 1200 }}>
          {FEATURES.map((f, i) => (
            <div key={i} className="feature-card interactable stagger-child" style={{ background: 'rgba(10,10,10,0.8)', padding: '2.5rem' }}>
              <div className="feature-icon" style={{ width: 48, height: 48, background: 'rgba(0,255,204,0.07)', border: '1px solid rgba(0,255,204,0.18)', borderRadius: 8, display: 'grid', placeItems: 'center', marginBottom: '1.4rem' }}><f.icon size={22} strokeWidth={1.8} color="#00ffcc" /></div>
              <div className="feature-title" style={{ fontFamily: "'Syne', sans-serif", fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.6rem' }}>{f.title}</div>
              <p className="feature-desc" style={{ fontSize: '0.85rem', color: '#90a0b0', lineHeight: 1.75 }}>{f.desc}</p>
              <div className="feature-tag" style={{ display: 'inline-block', marginTop: '1.2rem', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#00ffcc', border: '1px solid rgba(0,255,204,0.2)', padding: '0.3rem 0.8rem', borderRadius: 4 }}>{f.tag}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Commands Page */}
      <section id="commands" style={{ padding: '8vh 5vw', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div className="section-header reveal-up" style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <div style={{ fontSize: '0.65rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#00ffcc', marginBottom: '1rem', opacity: 0.8 }}>Voice Commands</div>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 'clamp(2rem, 4.5vw, 3.2rem)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.08 }}>
            Just say <em className="glow-line" style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontWeight: 400, color: '#00ffcc' }}>Hey Jarvis</em>
          </h2>
          <p style={{ color: '#5a6880', marginTop: '1rem', fontSize: '0.9rem', maxWidth: 460, marginInline: 'auto', lineHeight: 1.7 }}>Flexible natural language — Jarvis understands intent, not just exact phrases.</p>
        </div>

        <div className="commands-grid stagger-group" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '8px', width: '100%', maxWidth: 1000 }}>
          {COMMANDS.map((cmd, i) => (
            <div key={i} className="cmd interactable stagger-child" style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', padding: '1.2rem 1.5rem', borderRadius: 8 }}>
              <Zap size={14} color="#00d9f5" strokeWidth={2} />
              <span style={{ fontSize: '0.9rem', color: '#fff', flex: 1 }}>{cmd.text}</span>
              <span style={{ fontSize: '0.65rem', color: '#00ffcc', background: 'rgba(0,255,204,0.07)', padding: '0.2rem 0.6rem', borderRadius: 4, letterSpacing: '0.05em' }}>{cmd.intent}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing Page */}
      <section id="pricing" style={{ padding: '10vh 5vw', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: '15vh' }}>
        <div className="section-header reveal-right" style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <div style={{ fontSize: '0.65rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#00ffcc', marginBottom: '1rem', opacity: 0.8 }}>Simple Pricing</div>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 'clamp(2rem, 4.5vw, 3.2rem)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.08 }}>
            Start free. <em className="glow-line" style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontWeight: 400, color: '#00ffcc' }}>Scale smart.</em>
          </h2>
        </div>

        <div className="pricing-grid stagger-group" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.05)', width: '100%', maxWidth: 1100 }}>

          <div className="plan stagger-child" style={{ background: 'rgba(10,10,10,0.8)', padding: '2.5rem', position: 'relative' }}>
            <div style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#5a6880' }}>Free</div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: '2.5rem', fontWeight: 800, margin: '1rem 0', lineHeight: 1 }}>$0 <span style={{ fontSize: '0.9rem', fontWeight: 400, color: '#5a6880' }}>/ month</span></div>
            <ul style={{ listStyle: 'none', margin: '1.5rem 0 2rem', fontSize: '0.85rem', color: '#90a0b0', display: 'flex', flexDirection: 'column', gap: '0.8rem', padding: 0 }}>
              <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: '#00ffcc' }}>→</span> 3 meetings/month</li>
              <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: '#00ffcc' }}>→</span> Basic note taking</li>
              <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: '#00ffcc' }}>→</span> Transcript download</li>
              <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: '#00ffcc' }}>→</span> Limited commands</li>
            </ul>
            <button style={{ width: '100%', padding: '0.8rem', textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#fff', fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 4, cursor: 'pointer' }}>Get Started</button>
          </div>

          <div className="plan featured stagger-child" style={{ background: 'rgba(15,20,30,0.9)', padding: '2.5rem', position: 'relative', borderTop: '2px solid #00ffcc' }}>
            <div style={{ position: 'absolute', top: -1, right: '1.5rem', background: '#00ffcc', color: '#000', fontSize: '0.6rem', letterSpacing: '0.15em', padding: '0.3rem 0.8rem', fontWeight: 700, borderRadius: '0 0 4px 4px' }}>POPULAR</div>
            <div style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#5a6880' }}>Pro</div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: '2.5rem', fontWeight: 800, margin: '1rem 0', lineHeight: 1 }}>$9.99 <span style={{ fontSize: '0.9rem', fontWeight: 400, color: '#5a6880' }}>/ month</span></div>
            <ul style={{ listStyle: 'none', margin: '1.5rem 0 2rem', fontSize: '0.85rem', color: '#90a0b0', display: 'flex', flexDirection: 'column', gap: '0.8rem', padding: 0 }}>
              <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: '#00ffcc' }}>→</span> Unlimited meetings</li>
              <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: '#00ffcc' }}>→</span> All voice commands</li>
              <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: '#00ffcc' }}>→</span> Screen analysis</li>
              <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: '#00ffcc' }}>→</span> Meeting summaries</li>
            </ul>
            <button style={{ width: '100%', padding: '0.8rem', textAlign: 'center', border: 'none', background: '#00ffcc', color: '#000', fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}>Start Pro</button>
          </div>

          <div className="plan stagger-child" style={{ background: 'rgba(10,10,10,0.8)', padding: '2.5rem', position: 'relative' }}>
            <div style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#5a6880' }}>Team</div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: '2.5rem', fontWeight: 800, margin: '1rem 0', lineHeight: 1 }}>$50 <span style={{ fontSize: '0.9rem', fontWeight: 400, color: '#5a6880' }}>/ month</span></div>
            <ul style={{ listStyle: 'none', margin: '1.5rem 0 2rem', fontSize: '0.85rem', color: '#90a0b0', display: 'flex', flexDirection: 'column', gap: '0.8rem', padding: 0 }}>
              <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: '#00ffcc' }}>→</span> Everything in Pro</li>
              <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: '#00ffcc' }}>→</span> Team dashboard</li>
              <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: '#00ffcc' }}>→</span> Admin controls</li>
              <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: '#00ffcc' }}>→</span> Usage analytics</li>
            </ul>
            <button style={{ width: '100%', padding: '0.8rem', textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#fff', fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 4, cursor: 'pointer' }}>Start Team</button>
          </div>

        </div>
      </section>

      {/* Past meetings */}
      {pastMeetings.length > 0 && (
        <section style={{ maxWidth: 1100, margin: '0 auto 6rem', padding: '0 5vw', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="section-header reveal-up" style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <div style={{ fontSize: '0.65rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#00ffcc', marginBottom: '1rem', opacity: 0.8 }}>History</div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 'clamp(2rem, 3.5vw, 2.5rem)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.08 }}>
              Recent <em style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontWeight: 400, color: '#00ffcc' }}>Sessions</em>
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: '1px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.05)', width: '100%' }}>
            {pastMeetings.slice(0, 6).map(m => (
              <div key={m.id} className="feature-card interactable reveal-up" style={{ position: 'relative', transform: 'none', width: 'auto', padding: '2rem', background: 'rgba(10,10,10,0.8)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.status === 'active' ? '#00ffcc' : 'rgba(255,255,255,.2)' }} />
                  <span style={{ fontWeight: 700, fontSize: '1.05rem', fontFamily: "'Syne', sans-serif", flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '.8rem', color: '#5a6880', marginBottom: '1.5rem' }}>{m.roomName}</div>
                {m.status === 'active' && (
                  <button onClick={() => setIsModalOpen(true)}
                    style={{ fontSize: '.75rem', textTransform: 'uppercase', fontWeight: 700, color: '#000', background: '#00ffcc', padding: '0.4rem 0.8rem', borderRadius: 4, letterSpacing: 1, border: 'none', cursor: 'pointer' }}>
                    Join Session
                  </button>
                )}
                {m.status !== 'active' && (
                  <button onClick={() => navigate(`/meeting/${m.roomName}/end`)}
                    style={{ fontSize: '.75rem', textTransform: 'uppercase', fontWeight: 700, color: '#00ffcc', border: '1px solid rgba(0,255,204,0.3)', padding: '0.4rem 0.8rem', borderRadius: 4, letterSpacing: 1, background: 'none', cursor: 'pointer' }}>
                    View Synthesis
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CTA Section */}
      <section className="reveal-up" style={{ position: 'relative', textAlign: 'center', padding: '5rem 2rem 6rem', overflow: 'hidden' }}>
        {/* Glowing orb behind — softer so it does not read as a solid slab */}
        <div style={{ position: 'absolute', width: 'min(90vw, 560px)', height: 'min(90vw, 560px)', maxWidth: 560, maxHeight: 560, background: 'radial-gradient(circle, rgba(0,255,204,0.055) 0%, rgba(0,217,245,0.03) 35%, transparent 68%)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', borderRadius: '50%', animation: 'orb-breathe 6s ease-in-out infinite', pointerEvents: 'none' }} />
        {/* Glowing butterflies */}
        <div style={{ position: 'absolute', top: '20%', left: '15%', pointerEvents: 'none', animation: 'butterfly-float1 8s ease-in-out infinite' }}>
          <svg width="48" height="48" viewBox="0 0 100 100" style={{ filter: 'drop-shadow(0 0 12px #00ffcc) drop-shadow(0 0 24px #00ffcc)' }}>
            <path d="M50 50 Q20 10 5 30 Q20 50 50 50" fill="rgba(0,255,204,0.7)" />
            <path d="M50 50 Q80 10 95 30 Q80 50 50 50" fill="rgba(0,217,245,0.7)" />
            <path d="M50 50 Q25 70 10 60 Q25 50 50 50" fill="rgba(0,255,204,0.5)" />
            <path d="M50 50 Q75 70 90 60 Q75 50 50 50" fill="rgba(0,217,245,0.5)" />
            <circle cx="50" cy="50" r="3" fill="#fff" />
          </svg>
        </div>
        <div style={{ position: 'absolute', top: '60%', right: '12%', pointerEvents: 'none', animation: 'butterfly-float2 10s ease-in-out infinite' }}>
          <svg width="36" height="36" viewBox="0 0 100 100" style={{ filter: 'drop-shadow(0 0 10px #a78bfa) drop-shadow(0 0 20px #a78bfa)' }}>
            <path d="M50 50 Q20 10 5 30 Q20 50 50 50" fill="rgba(167,139,250,0.7)" />
            <path d="M50 50 Q80 10 95 30 Q80 50 50 50" fill="rgba(200,100,255,0.7)" />
            <path d="M50 50 Q25 70 10 60 Q25 50 50 50" fill="rgba(167,139,250,0.5)" />
            <path d="M50 50 Q75 70 90 60 Q75 50 50 50" fill="rgba(200,100,255,0.5)" />
            <circle cx="50" cy="50" r="3" fill="#fff" />
          </svg>
        </div>
        <div style={{ position: 'absolute', top: '35%', right: '25%', pointerEvents: 'none', animation: 'butterfly-float3 12s ease-in-out infinite' }}>
          <svg width="28" height="28" viewBox="0 0 100 100" style={{ filter: 'drop-shadow(0 0 8px #00d9f5)' }}>
            <path d="M50 50 Q20 10 5 30 Q20 50 50 50" fill="rgba(0,217,245,0.6)" />
            <path d="M50 50 Q80 10 95 30 Q80 50 50 50" fill="rgba(0,255,204,0.6)" />
            <path d="M50 50 Q25 70 10 60 Q25 50 50 50" fill="rgba(0,217,245,0.4)" />
            <path d="M50 50 Q75 70 90 60 Q75 50 50 50" fill="rgba(0,255,204,0.4)" />
          </svg>
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 className="reveal-up" style={{ fontFamily: "'Syne', sans-serif", fontSize: 'clamp(2.5rem, 5vw, 4rem)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05, marginBottom: '1.5rem' }}>
            Your next meeting<br />should{' '}
            <em className="glow-line" style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontWeight: 400, background: 'linear-gradient(135deg, #00ffcc, #00d9f5)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>remember itself.</em>
          </h2>
          <p className="reveal-up" style={{ color: '#5a6880', margin: '0 auto 2rem', fontSize: '1rem', maxWidth: 460, lineHeight: 1.7 }}>No setup. No bots. Just say Hey Jarvis — and it begins.</p>
          <button onClick={() => setIsModalOpen(true)} className="reveal-up btn-land btn-land-primary interactable"
            style={{ padding: '1.1rem 3.2rem', fontSize: '1rem', letterSpacing: 2 }}>
            <Play size={16} fill="currentColor" /> Start Meeting Free
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '2.5rem 4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)' }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: '1.2rem' }}>Meet<span style={{ color: '#00ffcc' }}>Mind</span></div>
        <div style={{ fontSize: '0.75rem', color: '#5a6880' }}>© 2026 MeetMind. Built with Distil-Whisper, XTTS v2 & GPT-4o.</div>
        <div style={{ display: 'flex', gap: '2rem' }}>
          <a href="#features" style={{ fontSize: '0.75rem', color: '#5a6880', textDecoration: 'none' }}>Features</a>
          <a href="#commands" style={{ fontSize: '0.75rem', color: '#5a6880', textDecoration: 'none' }}>Commands</a>
          <a href="#pricing" style={{ fontSize: '0.75rem', color: '#5a6880', textDecoration: 'none' }}>Pricing</a>
        </div>
      </footer>

    </div>
  );
}
