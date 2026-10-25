import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, LogOut, ArrowUpRight, Sparkles, AudioLines, Check, X } from 'lucide-react';
import { useMeetingStore } from '../store/meetingStore';
import { useAuthStore } from '../store/authStore';
import { api, ApiError } from '../services/api';

const FEATURES = [
  { viz: 'transcript', title: 'Real-Time Transcription', desc: 'Every word captured as it is spoken, with studio-grade ElevenLabs speech recognition for your voice commands. Names, numbers and jargon come through clean.', tag: 'ElevenLabs Scribe' },
  { viz: 'roleplay', title: 'AI Role-Playing', desc: 'Say "Jarvis, act as an investor" or "play devil\'s advocate" and get instant perspective shifts. Powered by GPT-4o for deep reasoning and structured replies.', tag: 'GPT-4o' },
  { viz: 'screen', title: 'Screen Analysis', desc: 'Share your screen and say "Jarvis, check the screen." It analyzes designs, code, documents, and gives structured feedback — live, to everyone in the call.', tag: 'Vision AI' },
  { viz: 'actions', title: 'Action Item Extraction', desc: 'spaCy NER + OpenAI automatically detects who owns what task and by when. "John should send the report by Friday" becomes a tracked action item instantly.', tag: 'spaCy + GPT' },
  { viz: 'vote', title: 'In-Meeting Voting', desc: 'Say "Jarvis, start a vote on X" and all participants can vote in real time. Results are recorded in the meeting summary automatically.', tag: 'Real-time' },
  { viz: 'pdf', title: 'Post-Meeting Summary PDF', desc: 'When the meeting ends, get a complete structured document: full transcript, decisions made, action items with owners, and next steps — exported as PDF.', tag: 'ReportLab' },
];

/** Small mock-UI preview shown at the top of each feature card. */
function FeatureViz({ kind }: { kind: string }) {
  switch (kind) {
    case 'transcript':
      return (
        <>
          <div className="viz-wave">
            {Array.from({ length: 28 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 7) * 120}ms` }} />)}
          </div>
          <div className="viz-line"><b>Priya</b>Let's ship the beta on Friday.</div>
          <div className="viz-line"><b>Alex</b>Agreed — I'll update the docs.</div>
        </>
      );
    case 'roleplay':
      return (
        <>
          <div className="viz-bubble">Jarvis, act as an investor.</div>
          <div className="viz-bubble viz-bubble-ai"><Sparkles size={13} />Great traction — but what's your CAC payback?</div>
        </>
      );
    case 'screen':
      return (
        <div className="viz-screen">
          <div className="viz-dots"><i /><i /><i /></div>
          <div className="viz-skel" style={{ width: '70%' }} />
          <div className="viz-skel" style={{ width: '90%' }} />
          <div className="viz-skel" style={{ width: '55%' }} />
          <div className="viz-scan" />
        </div>
      );
    case 'actions':
      return (
        <>
          {[['Send Q3 report', 'John · Fri', true], ['Book client demo', 'Sara · Mon', false], ['Fix login bug', 'Dev · Today', false]].map(([task, owner, done]) => (
            <div key={task as string} className="viz-row">
              <span className={`viz-check${done ? ' on' : ''}`}>{done && <Check size={11} strokeWidth={3} />}</span>
              {task}<em>{owner}</em>
            </div>
          ))}
        </>
      );
    case 'vote':
      return (
        <>
          {[['Launch in May', 72], ['Wait for Q3', 28]].map(([option, pct]) => (
            <div key={option} className="viz-vote">
              <div><span>{option}</span><span>{pct}%</span></div>
              <div className="viz-bar"><i style={{ width: `${pct}%` }} /></div>
            </div>
          ))}
        </>
      );
    default:
      return (
        <div className="viz-doc">
          <div className="viz-skel h" />
          <div className="viz-skel" style={{ width: '90%' }} />
          <div className="viz-skel" style={{ width: '75%' }} />
          <div className="viz-skel h" />
          <div className="viz-skel" style={{ width: '85%' }} />
          <span className="viz-pdf">PDF</span>
        </div>
      );
  }
}

const HEADLINE = 'Meetings that think with you';

const CAPABILITIES = ['Live transcription', 'Smart summaries', 'Action items', 'Screen analysis', 'Role-play', 'Decision help', 'Voice commands', 'PDF reports'];

const PLANS = [
  { name: 'Free', price: '$0', cta: 'Get Started', featured: false, perks: ['3 meetings/month', 'Basic note taking', 'Transcript download', 'Limited commands'] },
  { name: 'Pro', price: '$9.99', cta: 'Start Pro', featured: true, perks: ['Unlimited meetings', 'All voice commands', 'Screen analysis', 'Meeting summaries'] },
  { name: 'Team', price: '$50', cta: 'Start Team', featured: false, perks: ['Everything in Pro', 'Team dashboard', 'Admin controls', 'Usage analytics'] },
];

/** Slow, faint warm "starfield" behind the hero. */
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
    const PARTICLE_COUNT = 70;

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
        this.size = Math.random() * 1.2 + 0.3;
        this.speedX = (Math.random() - 0.5) * 0.15;
        this.speedY = (Math.random() - 0.5) * 0.15;
        this.opacity = Math.random() * 0.45 + 0.1;
        this.color = Math.random() > 0.7 ? '255,176,103' : '255,240,230';
      }
      update() {
        const dx = this.x - mouse.x, dy = this.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          const force = (120 - dist) / 120;
          this.x += (dx / dist) * force * 1.2;
          this.y += (dy / dist) * force * 1.2;
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

    let animationFrameId: number;
    const animate = () => {
      ctx!.clearRect(0, 0, W, H);
      particles.forEach(p => { p.update(); p.draw(); });
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none' }} />;
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

    // 2. Stagger groups — cascade children with increasing delays
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
      staggerObs.disconnect();
      variantObs.disconnect();
    };
  }, []);
}

/** One rAF-throttled pointer listener: card spotlight (--mx/--my) + 3D tilt of the hero portrait. */
function usePointerEffects() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;

    const apply = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const card = (e.target as Element | null)?.closest?.('.cc-card, .cc-plan') as HTMLElement | null;
      if (card) {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      }
      const art = document.querySelector<HTMLElement>('.cc-hero-art img');
      if (art && window.scrollY < window.innerHeight) {
        const dx = e.clientX / window.innerWidth - 0.5;
        const dy = e.clientY / window.innerHeight - 0.5;
        art.style.setProperty('--ry', `${(dx * 16).toFixed(2)}deg`);
        art.style.setProperty('--rx', `${(dy * -12).toFixed(2)}deg`);
        art.style.setProperty('--px', `${(dx * -16).toFixed(1)}px`);
        art.style.setProperty('--py', `${(dy * -12).toFixed(1)}px`);
      }
    };

    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
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
  usePointerEffects();

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

  const openModal = () => setIsModalOpen(true);
  const closeModal = () => { setIsModalOpen(false); setError(null); };

  return (
    <div className="cc-page">
      <div id="scroll-progress" />
      <div className="cc-bg" />
      <ParticleCanvas />

      {/* Nav */}
      <div className="cc-nav-wrap">
        <nav className="cc-nav" aria-label="Main">
          <a href="#top" className="cc-logo">
            <span className="cc-logo-mark"><AudioLines size={17} strokeWidth={2.4} /></span>
            MeetMind
          </a>
          <div className="cc-nav-links">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            {pastMeetings.length > 0 && <a href="#history">History</a>}
          </div>
          <div className="cc-nav-right">
            {user && (
              <>
                <span className="cc-user">
                  <span className="cc-avatar">{(user.name || user.email || '?').charAt(0).toUpperCase()}</span>
                  <span className="cc-user-name">{user.name}</span>
                </span>
                <button onClick={handleLogout} title="Log out" aria-label="Log out" className="cc-btn cc-btn-subtle cc-btn-sm">
                  <LogOut size={15} />
                </button>
              </>
            )}
            <button onClick={openModal} className="cc-btn cc-btn-light cc-nav-cta">
              Start Meeting <ArrowUpRight size={18} className="cc-arrow" />
            </button>
          </div>
        </nav>
      </div>

      {/* Hero */}
      <section id="top" className="cc-hero">
        <div className="cc-hero-art" aria-hidden="true">
          <img src="/hero-portrait.webp" alt="" width={1087} height={1166} fetchPriority="high" />
        </div>
        <span className="cc-badge"><Sparkles size={15} /> AI co-pilot for every call</span>
        <h1 className="cc-h1" aria-label={HEADLINE}>
          {HEADLINE.split(' ').map((word, i) => (
            <span key={i} aria-hidden="true">
              <span className="cc-word" style={{ animationDelay: `${120 + i * 80}ms` }}>{word}</span>{' '}
            </span>
          ))}
        </h1>
        <p className="cc-lead">
          Say <strong style={{ color: 'var(--cc-text)', fontWeight: 500 }}>“Hey Jarvis”</strong> and MeetMind takes notes, analyzes screens,
          plays devil’s advocate — and summarizes everything when you’re done.
        </p>
        <div id="join" className="cc-hero-ctas">
          <button onClick={openModal} className="cc-btn cc-btn-primary">
            Start Meeting Free <ArrowUpRight size={18} className="cc-arrow" />
          </button>
          <button onClick={openModal} className="cc-btn cc-btn-ghost">Join a Room</button>
        </div>

        {/* Live demo window */}
        <div className="cc-window" aria-hidden="true">
          <div className="cc-window-bar">
            <span className="cc-window-dot" /><span className="cc-window-dot" /><span className="cc-window-dot" />
            <span className="cc-window-title"><span className="cc-live" /> Jarvis live session</span>
          </div>
          <div className="cc-window-body">
            <div className="cc-line">
              <span className="cc-speaker" style={{ color: '#ce7f5d' }}>Alex</span>
              <p>Should we launch the product now or wait?</p>
            </div>
            <div className="cc-line" style={{ animationDelay: '.8s' }}>
              <span className="cc-speaker" style={{ color: 'var(--cc-text)' }}>You</span>
              <p>Hey Jarvis, act as an investor. What’s your take?</p>
            </div>
            <div className="cc-line" style={{ animationDelay: '1.6s' }}>
              <span className="cc-speaker cc-accent-text">Jarvis</span>
              <p className="cc-reply">
                <strong style={{ fontWeight: 500 }}>Investor perspective</strong><br />
                Pros — larger TAM, faster growth potential.<br />
                Cons — harder customer acquisition.<br />
                Recommendation — validate demand first with an MVP.
                <span className="cc-cursor" />
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Capability marquee (list rendered twice for a seamless loop) */}
      <div className="cc-marquee" aria-hidden="true">
        <div className="cc-marquee-track">
          {[...CAPABILITIES, ...CAPABILITIES].map((c, i) => (
            <span key={i} className="cc-marquee-item">{c}<Sparkles size={18} /></span>
          ))}
        </div>
      </div>

      {/* Features */}
      <section id="features" className="cc-section">
        <div className="cc-section-head reveal-up">
          <span className="cc-eyebrow">What Jarvis Does</span>
          <h2 className="cc-h2">Not just a transcriber —<br /><span className="cc-accent-text">a thinking partner</span></h2>
          <p className="cc-lead">Replaces Otter.ai + Zoom + Notion — in one tool, with a voice.</p>
        </div>
        <div className="cc-container cc-grid-3 stagger-group">
          {FEATURES.map((f) => (
            <div key={f.title} className="cc-card cc-flow-card stagger-child">
              <div className="cc-viz" aria-hidden="true">
                <span className="cc-viz-tag">{f.tag}</span>
                <FeatureViz kind={f.viz} />
              </div>
              <div className="cc-card-title">{f.title}</div>
              <p className="cc-card-text">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="cc-section">
        <div className="cc-section-head reveal-up">
          <span className="cc-eyebrow">Simple Pricing</span>
          <h2 className="cc-h2">Start free. <span className="cc-accent-text">Scale smart.</span></h2>
        </div>
        <div className="cc-pricing stagger-group">
          {PLANS.map((p) => (
            <div key={p.name} className={`cc-plan stagger-child${p.featured ? ' cc-plan--featured' : ''}`}>
              <div className="cc-plan-name">{p.name}{p.featured && <span className="cc-plan-badge">Popular</span>}</div>
              <div className="cc-plan-price">{p.price} <span>/ month</span></div>
              <ul className="cc-plan-list">
                {p.perks.map((perk) => <li key={perk}><Check size={16} strokeWidth={2.4} /> {perk}</li>)}
              </ul>
              <button className={`cc-btn cc-btn-block ${p.featured ? 'cc-btn-primary' : 'cc-btn-subtle'}`}>{p.cta}</button>
            </div>
          ))}
        </div>
      </section>

      {/* Past meetings */}
      {pastMeetings.length > 0 && (
        <section id="history" className="cc-section">
          <div className="cc-section-head reveal-up">
            <span className="cc-eyebrow">History</span>
            <h2 className="cc-h2">Recent <span className="cc-accent-text">sessions</span></h2>
          </div>
          <div className="cc-container cc-grid-3" style={{ maxWidth: 1100 }}>
            {pastMeetings.slice(0, 6).map(m => (
              <div key={m.id} className="cc-card reveal-up">
                <div className="cc-session-head">
                  <span className={`cc-status${m.status === 'active' ? ' cc-status--live' : ''}`} />
                  <span className="cc-session-title">{m.title}</span>
                </div>
                <div className="cc-session-id">{m.roomName}</div>
                {m.status === 'active' ? (
                  <button onClick={openModal} className="cc-btn cc-btn-primary cc-btn-sm">
                    Join Session <ArrowUpRight size={16} className="cc-arrow" />
                  </button>
                ) : (
                  <button onClick={() => navigate(`/meeting/${m.roomName}/end`)} className="cc-btn cc-btn-ghost cc-btn-sm">
                    View Synthesis
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Closing CTA */}
      <section className="cc-section" style={{ paddingTop: 40 }}>
        <div className="cc-container cc-cta reveal-up">
          <h2 className="cc-h2">Your next meeting should <span className="cc-accent-text">remember itself</span></h2>
          <p className="cc-lead">No setup. No bots. Just say “Hey Jarvis” — and it begins.</p>
          <button onClick={openModal} className="cc-btn cc-btn-primary">
            Start Meeting Free <ArrowUpRight size={18} className="cc-arrow" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="cc-footer">
        <div className="cc-container cc-footer-inner">
          <a href="#top" className="cc-logo" style={{ fontSize: '1.2rem' }}>
            <span className="cc-logo-mark"><AudioLines size={16} strokeWidth={2.4} /></span>
            MeetMind
          </a>
          <div className="cc-footer-copy">© 2026 MeetMind. Voice by ElevenLabs. Built with GPT-4o.</div>
          <div className="cc-footer-links">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
          </div>
        </div>
      </footer>

      {/* Create / join modal */}
      {isModalOpen && (
        <div className="cc-overlay" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="cc-dialog" role="dialog" aria-modal="true" aria-labelledby="meeting-modal-title">
            <button onClick={closeModal} className="cc-close" aria-label="Close"><X size={16} /></button>
            <h3 id="meeting-modal-title" className="cc-dialog-title">Enter the room</h3>
            <p className="cc-dialog-sub">Start a new meeting or join one with its ID.</p>
            {error && <div className="cc-error" role="alert">{error}</div>}
            <div className="cc-fields">
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name *" className="cc-input" />
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Meeting title (optional)" className="cc-input" />
              <button onClick={createMeeting} disabled={!name.trim() || creating} className="cc-btn cc-btn-primary cc-btn-block" style={{ height: 52, marginTop: 6 }}>
                {creating ? <Loader2 size={18} className="animate-spin" /> : <>Create New Meeting <ArrowUpRight size={18} className="cc-arrow" /></>}
              </button>
            </div>
            <div className="cc-divider">or join</div>
            <div className="cc-row">
              <input type="text" value={joinId} onChange={e => setJoinId(e.target.value)} onKeyDown={e => e.key === 'Enter' && joinMeeting()} placeholder="Paste meeting ID" className="cc-input cc-input--mono" />
              <button onClick={joinMeeting} disabled={!name.trim() || !joinId.trim() || joining} className="cc-btn cc-btn-light" style={{ height: 52 }}>
                {joining ? <Loader2 size={16} className="animate-spin" /> : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
