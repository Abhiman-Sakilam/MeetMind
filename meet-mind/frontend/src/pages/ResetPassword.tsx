import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, ArrowUpRight, AudioLines } from 'lucide-react';
import { ApiError, authResetPassword } from '../services/api';

const MIN_LENGTH = 8;

/** Landing page for the emailed reset link: /reset-password?token=... */
export function ResetPassword() {
  const navigate = useNavigate();
  const token = useSearchParams()[0].get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : 'This reset link is incomplete. Request a new one from the login page.',
  );

  const canSubmit = !!token && password.length >= MIN_LENGTH && password === confirm && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      await authResetPassword(token, password);
      navigate('/login', {
        replace: true,
        state: { notice: 'Password updated. Log in with your new password.' },
      });
    } catch (err) {
      setError(err instanceof ApiError && err.message ? `${err.message}.` : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };

  const hint =
    password && password.length < MIN_LENGTH
      ? `Use at least ${MIN_LENGTH} characters.`
      : confirm && password !== confirm
        ? "Passwords don't match."
        : null;

  return (
    <div className="cc-page cc-auth">
      <div className="cc-bg" />

      <div className="cc-logo">
        <span className="cc-logo-mark"><AudioLines size={17} strokeWidth={2.4} /></span>
        MeetMind
      </div>

      <div className="cc-dialog">
        <h3 className="cc-dialog-title">Choose a new password</h3>
        <p className="cc-dialog-sub">Pick something you haven't used here before.</p>

        {error && <div role="alert" className="cc-error">{error}</div>}

        <div className="cc-fields">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`New password (min ${MIN_LENGTH} characters) *`}
            className="cc-input"
            autoComplete="new-password"
            autoFocus
            disabled={!token}
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Confirm new password *"
            className="cc-input"
            autoComplete="new-password"
            disabled={!token}
          />
          {hint && <div style={{ fontSize: '.85rem', color: 'var(--cc-text-60)' }}>{hint}</div>}
          <button onClick={submit} disabled={!canSubmit} className="cc-btn cc-btn-primary cc-btn-block" style={{ height: 52, marginTop: 8 }}>
            {busy ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <>
                Update password
                <ArrowUpRight size={18} className="cc-arrow" />
              </>
            )}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: '.92rem', color: 'var(--cc-text-60)' }}>
          <Link to="/login" className="cc-link">Back to log in</Link>
        </div>
      </div>
    </div>
  );
}
