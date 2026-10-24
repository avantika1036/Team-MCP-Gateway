import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import Toast from './Toast.jsx';

export default function Overview({ onNavigate }) {
  const { api } = useAuth();
  const [servers, setServers] = useState([]);
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const loadData = async (showNotification = false) => {
    try {
      const [serverData, eventData] = await Promise.all([
        api('/api/admin/servers'),
        api('/api/admin/audit-events?limit=50'),
      ]);
      setServers(serverData.servers || []);
      setEvents(eventData.events || []);
      if (showNotification) {
        setToast('Data refreshed successfully');
      }
    } catch (error) {
      console.error('Failed to load overview data:', error);
      if (showNotification) {
        setToast('Failed to refresh data');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [api]);

  const navigate = (page) => {
    onNavigate(page);
  };

  const reachable = servers.filter((s) => s.enabled && s.status?.reachable).length;
  const toolCount = servers.reduce(
    (sum, s) => sum + (s.enabled && s.status?.reachable ? Number(s.status.toolCount || 0) : 0),
    0,
  );

  const statusBadge = (server) => {
    if (!server.enabled) return <span className="badge neutral">● Disabled</span>;
    if (server.status?.reachable) return <span className="badge success">● Reachable</span>;
    return <span className="badge danger">● Unreachable</span>;
  };

  const outcomeBadge = (outcome) => {
    const cls = outcome === 'success' ? 'success' : outcome === 'error' ? 'danger' : 'warning';
    return <span className={`badge ${cls} audit-outcome`}>{outcome || 'unknown'}</span>;
  };

  const prettyTime = (value) => (value ? new Date(value).toLocaleString() : '—');

  return (
    <section className="page active">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      <div className="page-heading">
        <div>
          <div className="eyebrow">System overview</div>
          <h1>Good to see you.</h1>
          <p>Your MCP services, access controls, and activity in one place.</p>
        </div>
        <div className="heading-actions">
          <button className="btn" onClick={() => loadData(true)}>
            Refresh data
          </button>
          <button className="btn primary" onClick={() => navigate('upstreams')}>
            Manage upstreams ↗
          </button>
        </div>
      </div>
      <div className="stats">
        <article className="stat-card">
          <div className="stat-top">
            <span>Registered upstreams</span>
            <span className="stat-icon">⇄</span>
          </div>
          <div className="stat-value">{isLoading ? '—' : servers.length}</div>
          <div className="stat-foot">Configured MCP servers</div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span>Reachable services</span>
            <span className="stat-icon stat-icon-lg">⌁</span>
          </div>
          <div className="stat-value">{isLoading ? '—' : `${reachable}/${servers.length}`}</div>
          <div className="stat-foot">Last gateway discovery check</div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span>Available tools</span>
            <span className="stat-icon">⌘</span>
          </div>
          <div className="stat-value">{isLoading ? '—' : toolCount}</div>
          <div className="stat-foot">Visible through the gateway</div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span>Audit events</span>
            <span className="stat-icon">▤</span>
          </div>
          <div className="stat-value">{isLoading ? '—' : events.length}</div>
          <div className="stat-foot">Latest events loaded</div>
        </article>
      </div>
      <div className="content-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Upstream health</h2>
              <p>Availability and tool discovery</p>
            </div>
            <button className="btn small" onClick={() => navigate('upstreams')}>
              View all
            </button>
          </div>
          <div className="card-body">
            {isLoading ? (
              <div className="empty">Loading upstreams…</div>
            ) : !servers.length ? (
              <div className="empty">
                <strong>No upstreams registered</strong>
                Add a server to publish tools through the gateway.
              </div>
            ) : (
              <div className="upstream-list">
                {servers.slice(0, 6).map((s) => (
                  <div key={s.id} className="upstream-mini">
                    <div className="upstream-symbol">{s.name?.slice(0, 1).toUpperCase() || 'M'}</div>
                    <div className="upstream-mini-info">
                      <strong>{s.name}</strong>
                      <div>
                        {s.id} · {s.enabled ? (s.status?.reachable ? 'Ready' : 'Checking / unreachable') : 'Disabled'}
                      </div>
                    </div>
                    <span className="mini-count">
                      {s.enabled && s.status?.reachable ? Number(s.status.toolCount || 0) : 0} tools
                    </span>
                    {statusBadge(s)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Recent activity</h2>
              <p>Latest authenticated tool calls</p>
            </div>
            <button className="btn small" onClick={() => navigate('audit')}>
              View audit
            </button>
          </div>
          <div className="card-body">
            {isLoading ? (
              <div className="empty">Loading audit events…</div>
            ) : !events.length ? (
              <div className="empty">
                <strong>No tool calls yet</strong>
                Authenticated calls will appear here after they run.
              </div>
            ) : (
              <div className="upstream-list">
                {events.slice(0, 5).map((e, idx) => (
                  <div key={idx} className="upstream-mini">
                    <div className="upstream-symbol">⌘</div>
                    <div className="upstream-mini-info">
                      <strong>{e.exposedToolName}</strong>
                      <div>{e.userEmail} · {prettyTime(e.startedAt)}</div>
                    </div>
                    {outcomeBadge(e.outcome)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
