import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, ArrowUpRight, AudioLines } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { ApiError, authForgotPassword } from '../services/api';

type Mode = 'login' | 'register' | 'forgot';

/** GIS Web client ID — when empty/undefined the Google button is not rendered. */
const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();

export function Login() {
  const navigate = useNavigate();
  // Set by the reset-password page after a successful reset.
  const initialNotice = (useLocation().state as { notice?: string } | null)?.notice ?? null;
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const googleLogin = useAuthStore((s) => s.googleLogin);

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice);

  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  const isRegister = mode === 'register';
  const isForgot = mode === 'forgot';

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
    setNotice(null);
  };

  const canSubmit =
    !!email.trim() && (isForgot || !!password.trim()) && (!isRegister || !!displayName.trim()) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      if (isForgot) {
        await authForgotPassword(email.trim());
        setNotice(`If an account exists for ${email.trim()}, a reset link is on its way. It expires in 30 minutes.`);
        return;
      }
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

  return (
    <div className="cc-page cc-auth">
      <div className="cc-bg" />

      {/* Brand */}
      <div className="cc-logo">
        <span className="cc-logo-mark"><AudioLines size={17} strokeWidth={2.4} /></span>
        MeetMind
      </div>

      {/* Card */}
      <div className="cc-dialog">
        <h3 className="cc-dialog-title">
          {isForgot ? 'Reset your password' : isRegister ? 'Create your account' : 'Welcome back'}
        </h3>
        <p className="cc-dialog-sub">
          {isForgot
            ? "Enter your account email and we'll send you a link to choose a new password."
            : isRegister
              ? 'Sign up to start meetings that think with you.'
              : 'Log in to rejoin your AI-powered meetings.'}
        </p>

        {/* Tabs */}
        {!isForgot && <div className="cc-tabs" role="tablist">
          {(['login', 'register'] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className="cc-tab"
            >
              {m === 'login' ? 'Log In' : 'Sign Up'}
            </button>
          ))}
        </div>}

        {error && <div role="alert" className="cc-error">{error}</div>}
        {notice && <div role="status" className="cc-notice">{notice}</div>}

        {!(isForgot && notice) && <div className="cc-fields">
          {isRegister && (
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Display name *"
              className="cc-input"
              autoComplete="name"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Email *"
            className="cc-input"
            autoComplete="email"
          />
          {!isForgot && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Password *"
              className="cc-input"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          )}
          {mode === 'login' && (
            <button type="button" onClick={() => switchMode('forgot')} className="cc-link cc-forgot">
              Forgot password?
            </button>
          )}
          <button onClick={submit} disabled={!canSubmit} className="cc-btn cc-btn-primary cc-btn-block" style={{ height: 52, marginTop: 8 }}>
            {busy ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <>
                {isForgot ? 'Send reset link' : isRegister ? 'Create Account' : 'Log In'}
                <ArrowUpRight size={18} className="cc-arrow" />
              </>
            )}
          </button>
        </div>}

        {/* Hidden (not unmounted) in forgot mode: GIS renders its button into this container only once */}
        {GOOGLE_CLIENT_ID && (
          <div hidden={isForgot}>
            <div className="cc-divider">or</div>
            <div ref={googleBtnRef} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: '.92rem', color: 'var(--cc-text-60)' }}>
          {isForgot ? 'Remembered it?' : isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button onClick={() => switchMode(mode === 'login' ? 'register' : 'login')} className="cc-link">
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </div>
      </div>
    </div>
  );
}
