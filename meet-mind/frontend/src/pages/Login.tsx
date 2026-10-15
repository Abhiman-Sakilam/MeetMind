import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { ApiError } from '../services/api';

type Mode = 'login' | 'register';

/** GIS Web client ID — when empty/undefined the Google button is not rendered. */
const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();

export function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const googleLogin = useAuthStore((s) => s.googleLogin);

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  const isRegister = mode === 'register';

  // Initialize Google Identity Services once the async GIS script has loaded.
  // Skipped entirely when no client ID is configured.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | undefined;
    const deadline = Date.now() + 10_000; // give the async script up to 10s

    const handleCredential = async (response: GoogleCredentialResponse) => {
      if (!response?.credential) return;
      setError(null);
      setBusy(true);
      try {
        await googleLogin(response.credential);
        navigate('/', { replace: true });
      } catch (err) {
        if (err instanceof ApiError && err.status === 503) {
          setError('Google sign-in is not configured on the server.');
        } else {
          setError('Google sign-in failed.');
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    };

    const tryInit = () => {
      const id = window.google?.accounts?.id;
      if (!id || !googleBtnRef.current) return false;
      id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential });
      googleBtnRef.current.replaceChildren(); // avoid duplicate buttons on re-render
      id.renderButton(googleBtnRef.current, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        width: 360,
      });
      return true;
    };

    if (!tryInit()) {
      pollId = setInterval(() => {
        if (cancelled) return;
        if (tryInit() || Date.now() > deadline) {
          if (pollId) clearInterval(pollId);
        }
      }, 100);
    }

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      window.google?.accounts?.id.cancel();
    };
  }, [googleLogin, navigate]);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    if (!email.trim() || !password.trim() || (isRegister && !displayName.trim())) return;
    setError(null);
    setBusy(true);
    try {
      if (isRegister) {
        await register(email.trim(), password, displayName.trim());
      } else {
        await login(email.trim(), password);
      }
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) setError('Invalid email or password.');
        else if (err.status === 409) setError('Email already registered. Try logging in.');
        else setError(err.message || 'Something went wrong. Please try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '.9rem 1.4rem',
    background: 'rgba(255,255,255,.05)',
    border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 100,
    color: '#fff',
    marginBottom: '.75rem',
    fontSize: '.95rem',
    boxSizing: 'border-box',
  };

  const canSubmit =
    !!email.trim() && !!password.trim() && (!isRegister || !!displayName.trim()) && !busy;

  return (
    <div
      className="min-h-screen overflow-x-hidden"
      style={{
        background: 'transparent',
        color: '#f0f0f0',
        fontFamily: "'Space Grotesk', sans-serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        minHeight: '100vh',
      }}
    >
      <div className="landing-bg" />
      <div className="landing-grid" />

      {/* Brand */}
      <div
        style={{
          fontFamily: "'Outfit',sans-serif",
          fontSize: '1.6rem',
          fontWeight: 900,
          letterSpacing: '-1px',
          textTransform: 'uppercase',
          color: '#fff',
          marginBottom: '2rem',
          zIndex: 10,
        }}
      >
        Meet<span style={{ color: '#00ffcc' }}>Mind</span>
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            background: '#00ffcc',
            borderRadius: '50%',
            marginLeft: 4,
            animation: 'pulse 2s infinite',
          }}
        />
      </div>

      {/* Card */}
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          padding: '2.5rem',
          background: 'rgba(10,15,26,0.98)',
          border: '1px solid rgba(0,255,204,0.2)',
          borderRadius: 24,
          boxShadow: '0 0 80px rgba(0,255,204,0.15)',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '.5rem' }}>
          <div
            style={{ width: 8, height: 8, borderRadius: '50%', background: '#00ffcc', boxShadow: '0 0 12px #00ffcc' }}
          />
          <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>
            {isRegister ? 'Create your account' : 'Welcome back'}
          </h3>
        </div>
        <p style={{ color: '#5a6880', fontSize: '.85rem', margin: '0 0 1.75rem', lineHeight: 1.6 }}>
          {isRegister
            ? 'Sign up to start meetings that think with you.'
            : 'Log in to rejoin your AI-powered meetings.'}
        </p>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: 4,
            background: 'rgba(255,255,255,.04)',
            border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 100,
            marginBottom: '1.5rem',
          }}
        >
          {(['login', 'register'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              style={{
                flex: 1,
                padding: '.6rem',
                borderRadius: 100,
                border: 'none',
                cursor: 'pointer',
                fontSize: '.8rem',
                fontWeight: 700,
                letterSpacing: 1,
                textTransform: 'uppercase',
                fontFamily: "'Outfit',sans-serif",
                transition: 'all .15s',
                background: mode === m ? '#00ffcc' : 'transparent',
                color: mode === m ? '#000' : 'rgba(255,255,255,.6)',
              }}
            >
              {m === 'login' ? 'Log In' : 'Sign Up'}
            </button>
          ))}
        </div>

        {error && (
          <div
            role="alert"
            style={{
              marginBottom: '1rem',
              padding: '.75rem 1rem',
              borderRadius: 10,
              background: 'rgba(255,60,60,.1)',
              border: '1px solid rgba(255,60,60,.25)',
              color: '#ff8080',
              fontSize: '.85rem',
            }}
          >
            {error}
          </div>
        )}

        {isRegister && (
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Display Name *"
            className="land-input"
            autoComplete="name"
            style={inputStyle}
          />
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Email *"
          className="land-input"
          autoComplete="email"
          style={inputStyle}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Password *"
          className="land-input"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          style={{ ...inputStyle, marginBottom: '1.25rem' }}
        />

        <button
          onClick={submit}
          disabled={!canSubmit}
          style={{
            width: '100%',
            padding: '1rem',
            background: '#00ffcc',
            color: '#000',
            border: 'none',
            borderRadius: 100,
            fontWeight: 700,
            fontSize: '.95rem',
            textTransform: 'uppercase',
            letterSpacing: 2,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: canSubmit ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: '0 0 30px rgba(0,255,204,0.25)',
          }}
        >
          {busy ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <>
              {isRegister ? 'Create Account' : 'Log In'}
              <ArrowRight size={16} />
            </>
          )}
        </button>

        {GOOGLE_CLIENT_ID && (
          <>
            {/* "or" divider */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                margin: '1.5rem 0',
              }}
            >
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.1)' }} />
              <span
                style={{
                  fontSize: '.72rem',
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  color: '#5a6880',
                  fontFamily: "'Outfit',sans-serif",
                }}
              >
                or
              </span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.1)' }} />
            </div>

            {/* Google Identity Services renders its button into this container */}
            <div
              ref={googleBtnRef}
              style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }}
            />
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '.82rem', color: '#5a6880' }}>
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => switchMode(isRegister ? 'login' : 'register')}
            style={{
              background: 'none',
              border: 'none',
              color: '#00ffcc',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '.82rem',
              padding: 0,
            }}
          >
            {isRegister ? 'Log in' : 'Sign up'}
          </button>
        </div>
      </div>
    </div>
  );
}
