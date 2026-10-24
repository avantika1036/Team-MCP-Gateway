import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import Toast from './Toast.jsx';

export default function Upstreams() {
  const { api } = useAuth();
  const [servers, setServers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    url: '',
    authType: 'none',
    headerName: '',
    credential: '',
  });
  const [editingServerId, setEditingServerId] = useState(null);
  const [authDescription, setAuthDescription] = useState('');
  const [toast, setToast] = useState(null);

  const loadData = async () => {
    try {
      const data = await api('/api/admin/servers');
      setServers(data.servers || []);
    } catch (error) {
      console.error('Failed to load servers:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [api]);

  const filteredServers = servers.filter((s) =>
    `${s.name} ${s.id} ${s.url}`.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const statusBadge = (server) => {
    if (!server.enabled) return <span className="badge neutral">● Disabled</span>;
    if (server.status?.reachable) return <span className="badge success">● Reachable</span>;
    return <span className="badge danger">● Unreachable</span>;
  };

  const prettyTime = (value) => (value ? new Date(value).toLocaleString() : '—');

  const resetForm = () => {
    setFormData({
      id: '',
      name: '',
      url: '',
      authType: 'none',
      headerName: '',
      credential: '',
    });
    setEditingServerId(null);
    setAuthDescription('');
  };

  const handleEdit = (server) => {
    setFormData({
      id: server.id,
      name: server.name,
      url: server.url,
      authType: server.authConfigured ? 'keep' : 'none',
      headerName: server.authHeaderName || '',
      credential: '',
    });
    setEditingServerId(server.id);
    if (server.authConfigured) {
      const desc =
        server.authType === 'header'
          ? `Current authentication: custom header ${server.authHeaderName}. Choose a new authentication type to rotate the credential, or choose No authentication to remove it.`
          : 'Current authentication: bearer token. Choose a new authentication type to rotate the credential, or choose No authentication to remove it.';
      setAuthDescription(desc);
    } else {
      setAuthDescription('');
    }
    setShowAddForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const body = {
        name: formData.name.trim(),
        url: formData.url.trim(),
      };

      if (formData.authType === 'bearer' || formData.authType === 'header') {
        const credential = formData.credential.trim();
        if (!credential) {
          setToast({ message: 'Enter the upstream credential value.', bad: true });
          return;
        }
        body.auth =
          formData.authType === 'bearer'
            ? { type: 'bearer', credential }
            : {
                type: 'header',
                headerName: formData.headerName.trim(),
                credential,
              };
      } else if (editingServerId && formData.authType === 'none') {
        body.auth = null;
      }

      if (editingServerId) {
        // Update existing server via PUT
        await api(`/api/admin/servers/${encodeURIComponent(editingServerId)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        setToast({ message: 'Upstream updated.', bad: false });
      } else {
        // Create new server via POST
        body.id = formData.id.trim();
        body.enabled = true;
        await api('/api/admin/servers', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setToast({ message: 'Upstream registered.', bad: false });
      }

      resetForm();
      setShowAddForm(false);
      await loadData();
    } catch (error) {
      console.error('Failed to save server:', error);
      setToast({ message: error.message || 'Failed to save server', bad: true });
    }
  };

  const handleToggle = async (id, enabled) => {
    try {
      await api(`/api/admin/servers/${encodeURIComponent(id)}/enabled`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !enabled }),
      });
      await loadData();
      setToast({ message: `Upstream ${!enabled ? 'enabled' : 'disabled'}.`, bad: false });
    } catch (error) {
      console.error('Failed to toggle server:', error);
      setToast({ message: error.message || 'Failed to toggle server', bad: true });
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete upstream “${name || id}”? Its tools will disappear from gateway discovery.`)) return;
    try {
      await api(`/api/admin/servers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      await loadData();
      setToast({ message: 'Upstream deleted.', bad: false });
    } catch (error) {
      console.error('Failed to delete server:', error);
      setToast({ message: error.message || 'Failed to delete server', bad: true });
    }
  };

  const handleRefresh = async (id) => {
    try {
      await api(`/api/admin/servers/${encodeURIComponent(id)}/refresh`, {
        method: 'POST',
      });
      await loadData();
      setToast({ message: 'Upstream status refreshed.', bad: false });
    } catch (error) {
      console.error('Failed to refresh server:', error);
      setToast({ message: error.message || 'Failed to refresh server', bad: true });
    }
  };

  return (
    <section className="page active">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Connectivity</div>
          <h1>Upstream servers</h1>
          <p>Register MCP servers and control which tools are exposed by the gateway.</p>
        </div>
      </div>
      <section className="card">
        <div className="toolbar">
          <div>
            <h2>Server registry</h2>
            <p>Enabled upstreams have their tools included in discovery.</p>
          </div>
          <div className="toolbar-actions">
            <input
              className="search"
              placeholder="Filter servers…"
              aria-label="Filter servers"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button className="btn primary" onClick={() => setShowAddForm(!showAddForm)}>
              + Add upstream
            </button>
          </div>
        </div>
        {showAddForm && (
          <form className="inline-form" onSubmit={handleSubmit}>
            <h3>{editingServerId ? `Edit upstream: ${formData.name}` : 'Register an upstream MCP server'}</h3>
            <div className="form-grid">
              <div>
                <label htmlFor="serverId">Server ID</label>
                <input
                  id="serverId"
                  required
                  pattern="[a-z][a-z0-9-]{1,31}"
                  placeholder="for example, inventory"
                  value={formData.id}
                  disabled={!!editingServerId}
                  onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="serverName">Display name</label>
                <input
                  id="serverName"
                  required
                  maxLength={100}
                  placeholder="Inventory MCP"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="span-2">
                <label htmlFor="serverUrl">MCP endpoint URL</label>
                <input
                  id="serverUrl"
                  type="url"
                  required
                  placeholder="http://service.namespace.svc.cluster.local:4000/mcp"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="serverAuthType">Authentication</label>
                <select
                  id="serverAuthType"
                  value={formData.authType}
                  onChange={(e) => setFormData({ ...formData, authType: e.target.value })}
                >
                  <option value="none">No authentication</option>
                  <option value="bearer">Bearer token</option>
                  <option value="header">Custom header</option>
                  {editingServerId && <option value="keep">Keep existing authentication</option>}
                </select>
              </div>
              {formData.authType === 'header' && (
                <div>
                  <label htmlFor="serverHeaderName">Credential header name</label>
                  <input
                    id="serverHeaderName"
                    maxLength={100}
                    placeholder="X-API-Key"
                    value={formData.headerName}
                    onChange={(e) => setFormData({ ...formData, headerName: e.target.value })}
                    required={formData.authType === 'header'}
                  />
                </div>
              )}
              {(formData.authType === 'bearer' || formData.authType === 'header') && (
                <div className="span-2">
                  <label htmlFor="serverCredential">
                    {editingServerId && formData.authType === 'keep' ? 'New credential value (leave blank to keep existing)' : 'Credential value'}
                  </label>
                  <input
                    id="serverCredential"
                    type="password"
                    autoComplete="new-password"
                    maxLength={4096}
                    placeholder={editingServerId && formData.authType === 'keep' ? 'Leave blank to keep existing' : 'Paste the upstream token or key'}
                    value={formData.credential}
                    onChange={(e) => setFormData({ ...formData, credential: e.target.value })}
                    required={!editingServerId || formData.authType !== 'keep'}
                  />
                </div>
              )}
            </div>
            {authDescription && (
              <div
                className="section-note"
                style={{ marginTop: '10px' }}
              >
                {authDescription}
              </div>
            )}
            <div className="section-note" style={{ marginTop: '10px' }}>
              Credentials are stored in a Kubernetes Secret and are never returned to the browser
              after saving. The gateway applies them only to requests for this upstream. Use
              in-cluster service DNS names for Kubernetes deployments.
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => { resetForm(); setShowAddForm(false); }}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                {editingServerId ? 'Save changes' : 'Register server'}
              </button>
            </div>
          </form>
        )}
        <div className="table-wrap">
          {isLoading ? (
            <div className="empty">Loading servers…</div>
          ) : !filteredServers.length ? (
            <div className="empty">
              <strong>No matching servers</strong>
              Try another search or register a new upstream.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Status</th>
                  <th>Tools</th>
                  <th>Last checked</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredServers.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="server-name">{s.name}</div>
                      <div className="server-url">{s.url}</div>
                      <div className="key-meta">
                        ID: {s.id}
                        {s.authConfigured && ` · Auth: ${s.authType === 'header' ? s.authHeaderName : 'Bearer token'}`}
                        {s.status?.lastError && ` · ${s.status.lastError}`}
                      </div>
                    </td>
                    <td>{statusBadge(s)}</td>
                    <td>
                      <strong>{s.enabled && s.status?.reachable ? Number(s.status.toolCount || 0) : 0}</strong>
                    </td>
                    <td>{prettyTime(s.status?.lastCheckedAt)}</td>
                    <td>
                      <div className="actions">
                        <button className="btn small" onClick={() => handleToggle(s.id, s.enabled)}>
                          {s.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button className="btn small" onClick={() => handleRefresh(s.id)}>
                          Refresh
                        </button>
                        <button className="btn small" onClick={() => handleEdit(s)}>
                          Edit
                        </button>
                        <button className="btn small danger" onClick={() => handleDelete(s.id, s.name)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {toast && (
        <Toast
          message={toast.message}
          bad={toast.bad}
          onClose={() => setToast(null)}
        />
      )}
    </section>
  );
}
