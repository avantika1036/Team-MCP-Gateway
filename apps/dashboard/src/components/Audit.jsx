import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import Toast from './Toast.jsx';

export default function Audit({ refreshKey }) {
  const { api } = useAuth();
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState(null);

  const loadData = async (showNotification = false) => {
    try {
      const data = await api('/api/admin/audit-events?limit=50');
      setEvents(data.events || []);
      if (showNotification) {
        setToast('Audit events refreshed');
      }
    } catch (error) {
      console.error('Failed to load audit events:', error);
      if (showNotification) {
        setToast('Failed to refresh audit events');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [api]);

  useEffect(() => {
    if (refreshKey > 0) {
      loadData(true);
    }
  }, [refreshKey]);

  const filteredEvents = events.filter((e) =>
    `${e.userEmail} ${e.upstreamId} ${e.toolName} ${e.exposedToolName} ${e.outcome}`
      .toLowerCase()
      .includes(searchQuery.toLowerCase()),
  );

  const outcomeBadge = (outcome) => {
    const cls = outcome === 'success' ? 'success' : outcome === 'error' ? 'danger' : 'warning';
    return <span className={`badge ${cls} audit-outcome`}>{outcome || 'unknown'}</span>;
  };

  const prettyTime = (value) => (value ? new Date(value).toLocaleString() : '—');
  const shortId = (value) => (value ? `${value.slice(0, 8)}…` : '—');

  return (
    <section className="page active">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      <div className="page-heading">
        <div>
          <div className="eyebrow">Traceability</div>
          <h1>Audit trail</h1>
          <p>Review tool calls with user identity, upstream, outcome, and latency.</p>
        </div>
        <div className="heading-actions">
        </div>
      </div>
      <section className="card">
        <div className="toolbar">
          <div>
            <h2>Recent tool activity</h2>
            <p>Latest {events.length} records · newest first</p>
          </div>
          <div className="toolbar-actions">
            <input
              className="search"
              placeholder="Filter events…"
              aria-label="Filter audit events"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="table-wrap">
          {isLoading ? (
            <div className="empty">Loading audit events…</div>
          ) : !filteredEvents.length ? (
            <div className="empty">
              <strong>No matching events</strong>
              Audit records appear when authenticated users call tools.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>User / key</th>
                  <th>Tool</th>
                  <th>Outcome</th>
                  <th>Duration</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((e) => (
                  <tr key={e.id}>
                    <td>{prettyTime(e.startedAt)}</td>
                    <td>
                      <div>{e.userEmail}</div>
                      <div className="key-meta">Key {shortId(e.apiKeyId)}</div>
                    </td>
                    <td>
                      <div className="server-name">{e.exposedToolName}</div>
                      <div className="key-meta">Upstream: {e.upstreamId}</div>
                    </td>
                    <td>{outcomeBadge(e.outcome)}</td>
                    <td>{e.durationMs == null ? '—' : `${Number(e.durationMs)} ms`}</td>
                    <td>
                      {e.errorMessage ? (
                        <span
                          className="badge danger"
                          title={e.errorMessage}
                          style={{ cursor: 'help' }}
                        >
                          Error detail
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </section>
  );
}
