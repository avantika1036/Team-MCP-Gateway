import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function Login() {
  const { login, loginAsAdmin, logout } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isChatRoute = window.location.pathname.startsWith('/chat');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      if (isChatRoute) {
        await login(apiKey);
      } else {
        await loginAsAdmin(apiKey);
      }
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isChatRoute) {
    return (
      <>
        <header className="topbar chat-topbar">
          <div className="brand">
            <div className="mark">U</div>
            <div>
              <strong>URUMI · CHAT AGENT</strong>
              <small>Authenticated MCP operations assistant</small>
            </div>
          </div>
          <div className="top-actions">
            <a href="/dashboard/" className="btn ghost">
              Admin console ↗
            </a>
          </div>
        </header>

        <section id="loginView" className="login-wrap card">
          <div className="eyebrow">Secure chat access</div>
          <h1 style={{ marginTop: '14px' }}>Talk to your MCP tools.</h1>
          <p>
            Sign in with your own Urumi API key. Tool calls use the gateway, and the user's identity
            is written to the audit trail.
          </p>
          <form onSubmit={handleSubmit} id="loginForm">
            <label htmlFor="apiKeyInput">User API key</label>
            <input
              id="apiKeyInput"
              type="password"
              autoComplete="off"
              required
              placeholder="urm_live_…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button
              className="btn primary"
              style={{ width: '100%', marginTop: '12px' }}
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Connecting…' : 'Connect to chat →'}
            </button>
          </form>
          <div className="footnote">
            Use a database-backed member or admin API key. The gateway and LLM credentials never go
            to the browser. This key is held only in this tab's session storage.
          </div>
        </section>
      </>
    );
  }

  return (
    <section className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">U</div>
          <div>
            <strong>URUMI CONTROL PLANE</strong>
            <span>Model Context Protocol gateway</span>
          </div>
        </div>
        <div className="eyebrow">Secure administrator access</div>
        <h1>Everything connected.<br />One control plane.</h1>
        <p className="muted" style={{ fontSize: '13px' }}>
          Sign in with an administrator API key to manage upstream servers, users, and audit
          history.
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="loginKey">Administrator API key</label>
          <input
            id="loginKey"
            type="password"
            autoComplete="current-password"
            placeholder="urm_live_…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
            <button className="btn primary full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Connecting…' : 'Connect to gateway →'}
            </button>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </form>
        <div className="login-note">
          Use a database-backed API key belonging to a user with the <strong>admin</strong> role.
          The bootstrap token should stay in your terminal and should not be pasted here. This key
          is kept in this browser tab's session storage.
        </div>
      </div>
    </section>
  );
}
