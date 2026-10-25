import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import Dialog from './Dialog.jsx';
import Toast from './Toast.jsx';

export default function Users({ refreshKey }) {
  const { api } = useAuth();
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showKeysPanel, setShowKeysPanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState(null);
  const [secretDialog, setSecretDialog] = useState({ isOpen: false, title: '', key: '' });
  const [selectedUser, setSelectedUser] = useState(null);
  const [userKeys, setUserKeys] = useState([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [showAddKeyForm, setShowAddKeyForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [formData, setFormData] = useState({
    displayName: '',
    email: '',
    role: 'member',
    keyName: 'initial',
  });

  const loadData = async (showNotification = false) => {
    try {
      const data = await api('/api/admin/users');
      setUsers(data.users || []);
      if (showNotification) {
        setToast({ message: 'Users refreshed', bad: false });
      }
    } catch (error) {
      console.error('Failed to load users:', error);
      if (showNotification) {
        setToast({ message: 'Failed to refresh users', bad: true });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const loadKeys = async (userId) => {
    setLoadingKeys(true);
    try {
      const data = await api(`/api/admin/users/${encodeURIComponent(userId)}/keys`);
      setUserKeys(data.keys || []);
    } catch (error) {
      console.error('Failed to load keys:', error);
    } finally {
      setLoadingKeys(false);
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

  const filteredUsers = users.filter((u) =>
    `${u.email} ${u.displayName} ${u.role}`.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const prettyTime = (value) => (value ? new Date(value).toLocaleString() : '—');
  const shortId = (value) => (value ? `${value.slice(0, 8)}…` : '—');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const result = await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(formData),
      });

      setShowAddForm(false);
      setFormData({ displayName: '', email: '', role: 'member', keyName: 'initial' });
      setSecretDialog({
        isOpen: true,
        title: 'API key created',
        key: result.apiKey,
      });
      await loadData();
    } catch (error) {
      console.error('Failed to create user:', error);
      setToast({ message: error.message || 'Failed to create user', bad: true });
    }
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secretDialog.key);
    setToast({ message: 'API key copied to clipboard', bad: false });
  };

  const handleViewKeys = async (user) => {
    setSelectedUser(user);
    setShowKeysPanel(true);
    await loadKeys(user.id);
  };

  const handleRevokeKey = async (keyId) => {
    if (!confirm('Revoke this API key? Further requests using it will be rejected.')) return;
    try {
      await api(`/api/admin/keys/${encodeURIComponent(keyId)}`, {
        method: 'DELETE',
      });
      setToast({ message: 'API key revoked.', bad: false });
      if (selectedUser) await loadKeys(selectedUser.id);
      await loadData();
    } catch (error) {
      console.error('Failed to revoke key:', error);
      setToast({ message: error.message || 'Failed to revoke key', bad: true });
    }
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    try {
      const result = await api(`/api/admin/users/${encodeURIComponent(selectedUser.id)}/keys`, {
        method: 'POST',
        body: JSON.stringify({ keyName: newKeyName }),
      });

      setShowAddKeyForm(false);
      setNewKeyName('');
      setSecretDialog({
        isOpen: true,
        title: 'API key created',
        key: result.apiKey,
      });
      await loadKeys(selectedUser.id);
      await loadData();
    } catch (error) {
      console.error('Failed to create key:', error);
      setToast({ message: error.message || 'Failed to create key', bad: true });
    }
  };

  return (
    <section className="page active">
      {toast && <Toast message={toast.message || toast} bad={toast.bad} onClose={() => setToast(null)} />}
      <div className="page-heading">
        <div>
          <div className="eyebrow">Identity & access</div>
          <h1>Users and API keys</h1>
          <p>Manage roles and revocable access credentials. Key secrets are shown only once.</p>
        </div>
      </div>
      <section className="card">
        <div className="toolbar">
          <div>
            <h2>User directory</h2>
            <p>Administrators can manage API credentials for all users.</p>
          </div>
          <div className="toolbar-actions">
            <input
              className="search"
              placeholder="Filter users…"
              aria-label="Filter users"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button className="btn primary" onClick={() => setShowAddForm(!showAddForm)}>
              + Create user
            </button>
          </div>
        </div>
        {showAddForm && (
          <form className="inline-form" onSubmit={handleSubmit}>
            <h3>Create a user and initial API key</h3>
            <div className="form-grid">
              <div>
                <label htmlFor="userName">Display name</label>
                <input
                  id="userName"
                  maxLength={100}
                  required
                  placeholder="Name"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="userEmail">Email</label>
                <input
                  id="userEmail"
                  type="email"
                  maxLength={254}
                  required
                  placeholder="name@example.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="userRole">Role</label>
                <select
                  id="userRole"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label htmlFor="initialKeyName">Initial key name</label>
                <input
                  id="initialKeyName"
                  maxLength={100}
                  required
                  value={formData.keyName}
                  onChange={(e) => setFormData({ ...formData, keyName: e.target.value })}
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowAddForm(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                Create user
              </button>
            </div>
          </form>
        )}
        <div className="table-wrap">
          {isLoading ? (
            <div className="empty">Loading users…</div>
          ) : !filteredUsers.length ? (
            <div className="empty">
              <strong>No matching users</strong>
              Create a member or admin account to issue API credentials.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Active keys</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="server-name">{u.displayName}</div>
                      <div className="key-meta">{u.email}</div>
                    </td>
                    <td>
                      <span className={`badge ${u.role === 'admin' ? 'success' : 'neutral'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td>
                      {u.isActive ? (
                        <span className="badge success">Active</span>
                      ) : (
                        <span className="badge danger">Inactive</span>
                      )}
                    </td>
                    <td>{Number(u.activeKeyCount || 0)}</td>
                    <td>{prettyTime(u.createdAt)}</td>
                    <td>
                      <button className="btn small" onClick={() => handleViewKeys(u)}>
                        Manage keys
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {showKeysPanel && (
        <section className="card" style={{ marginTop: '16px' }}>
          <div className="toolbar">
            <div>
              <h2>API keys{selectedUser?.email ? ` · ${selectedUser.email}` : ''}</h2>
              <p>Key hashes remain server-side. Secrets are never retrievable after creation.</p>
            </div>
            <div className="toolbar-actions">
              <button className="btn primary" onClick={() => setShowAddKeyForm(!showAddKeyForm)}>
                + Create key
              </button>
              <button className="btn" onClick={() => setShowKeysPanel(false)}>
                Close
              </button>
            </div>
          </div>
          {showAddKeyForm && (
            <form className="inline-form" onSubmit={handleCreateKey}>
              <h3>Create an additional API key</h3>
              <div className="form-grid">
                <div className="span-2">
                  <label htmlFor="newKeyName">Key name</label>
                  <input
                    id="newKeyName"
                    maxLength={100}
                    required
                    placeholder="Key name"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setShowAddKeyForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary">
                  Create key
                </button>
              </div>
            </form>
          )}
          <div className="table-wrap">
            {loadingKeys ? (
              <div className="empty">Loading keys…</div>
            ) : !userKeys.length ? (
              <div className="empty">No keys for this user.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Created</th>
                    <th>Last used</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {userKeys.map((k) => {
                    const active =
                      !k.revokedAt && (!k.expiresAt || new Date(k.expiresAt) > new Date());
                    return (
                      <tr key={k.id}>
                        <td>
                          <div className="server-name">{k.name}</div>
                          <div className="key-meta">
                            {k.keyPrefix}… · {shortId(k.id)}
                          </div>
                        </td>
                        <td>{prettyTime(k.createdAt)}</td>
                        <td>{prettyTime(k.lastUsedAt)}</td>
                        <td>
                          {active ? (
                            <span className="badge success">Active</span>
                          ) : (
                            <span className="badge neutral">Revoked / expired</span>
                          )}
                        </td>
                        <td>
                          {active ? (
                            <button
                              className="btn small danger"
                              onClick={() => handleRevokeKey(k.id)}
                            >
                              Revoke
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      <Dialog
        isOpen={secretDialog.isOpen}
        onClose={() => setSecretDialog({ ...secretDialog, isOpen: false })}
        title={secretDialog.title}
      >
        <p className="muted" style={{ fontSize: '12px', marginTop: '0' }}>
          Copy the key now. The server stores only its hash and cannot show this secret again.
        </p>
        <div className="secret-block">
          <div className="eyebrow">One-time secret</div>
          <code className="secret-value">{secretDialog.key}</code>
          <button className="btn primary" onClick={copySecret}>
            Copy API key
          </button>
        </div>
        <p className="secret-warning">
          Treat this key like a password. Store it securely and revoke it immediately if it is
          exposed.
        </p>
      </Dialog>

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
