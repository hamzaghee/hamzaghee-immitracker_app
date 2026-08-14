import { useState } from 'react';
import { login } from '../api.js';

/**
 * Password screen for the production deployment.
 *
 * Presentation only — the real guard is server-side middleware. If this
 * component were the only protection, every API route would still be reachable
 * by anyone who knew the URL.
 */
export default function PasswordGate({ onAuthenticated }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
      setPassword('');
      onAuthenticated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <h1>Express Entry Processing Insights</h1>
        <p className="hint">This instance is private. Enter the access password to continue.</p>

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
          disabled={busy}
        />

        {error ? <p className="dataset-msg error">{error}</p> : null}

        <button className="primary" type="submit" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
