import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import Toast from './Toast.jsx';

export default function Stores({ refreshKey }) {
  const { api } = useAuth();
  const [stores, setStores] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [toast, setToast] = useState(null);
  const [formData, setFormData] = useState({
    slug: '',
    displayName: '',
  });

  const loadData = async (showNotification = false) => {
    try {
      const data = await api('/api/admin/stores');
      setStores(data.stores || []);
      if (showNotification) {
        setToast({ message: 'Stores refreshed', bad: false });
      }
    } catch (error) {
      console.error('Failed to load stores:', error);
      if (showNotification) {
        setToast({ message: 'Failed to refresh stores', bad: true });
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

  const prettyTime = (value) => (value ? new Date(value).toLocaleString() : '—');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/stores', {
        method: 'POST',
        body: JSON.stringify(formData),
      });

      setShowAddForm(false);
      setFormData({ slug: '', displayName: '' });
      setToast({ message: 'Store provisioning started', bad: false });
      await loadData();
    } catch (error) {
      console.error('Failed to create store:', error);
      setToast({ message: error.message || 'Failed to create store', bad: true });
    }
  };

  const handleDelete = async (slug, displayName) => {
    if (!confirm(`Are you sure you want to delete "${displayName}"? This will remove all resources and data.`)) return;
    try {
      await api(`/api/admin/stores/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
      });
      setToast({ message: 'Store deletion started', bad: false });
      await loadData();
    } catch (error) {
      console.error('Failed to delete store:', error);
      setToast({ message: error.message || 'Failed to delete store', bad: true });
    }
  };

  return (
    <section className="page active">
      {toast && <Toast message={toast.message || toast} bad={toast.bad} onClose={() => setToast(null)} />}
      <div className="page-heading">
        <div>
          <div className="eyebrow">Tenant operations</div>
          <h1>WooCommerce stores</h1>
          <p>Provision isolated stores, register their MCP tools, and tear them down safely.</p>
        </div>
      </div>
      <section className="card">
        <div className="toolbar">
          <div>
            <h2>Store fleet</h2>
            <p>
              Each store receives a dedicated namespace, database, Secrets, persistent volumes,
              ingress, and MCP server.
            </p>
          </div>
          <div className="toolbar-actions">
            <button className="btn primary" onClick={() => setShowAddForm(!showAddForm)}>
              + Create store
            </button>
          </div>
        </div>
        {showAddForm && (
          <form className="inline-form" onSubmit={handleSubmit}>
            <h3>Provision an isolated store</h3>
            <div className="form-grid">
              <div>
                <label htmlFor="storeSlug">Store ID</label>
                <input
                  id="storeSlug"
                  required
                  pattern="[a-z][a-z0-9-]{1,19}"
                  maxLength={20}
                  placeholder="for example, north-shop"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                />
                <div className="field-note">
                  Lowercase letters, numbers and hyphens; must start with a letter.
                </div>
              </div>
              <div>
                <label htmlFor="storeDisplayName">Display name</label>
                <input
                  id="storeDisplayName"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="North Shop"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                />
              </div>
            </div>
            <div className="section-note" style={{ marginTop: '10px' }}>
              Provisioning may take several minutes. Store credentials are generated server-side.
              Deleted stores lose their resources and data; export anything you need first.
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowAddForm(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                Create isolated store
              </button>
            </div>
          </form>
        )}
        <div className="table-wrap">
          {isLoading ? (
            <div className="empty">Loading provisioned stores…</div>
          ) : !stores.length ? (
            <div className="empty">
              <strong>No additional stores</strong>
              Create a store to provision an isolated WooCommerce environment and register its MCP
              tools.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Provisioning</th>
                  <th>Storefront</th>
                  <th>MCP upstream</th>
                  <th>Owner</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => {
                  const status = String(store.status || 'unknown');
                  const cls = status === 'ready' ? 'success' : status === 'failed' ? 'danger' : 'warning';
                  const canDelete = status === 'ready' || status === 'failed';
                  const upstream = store.upstream;
                  const upstreamText = upstream
                    ? upstream.enabled && upstream.status?.reachable
                      ? `${Number(upstream.status.toolCount || 0)} tools · reachable`
                      : upstream.enabled
                        ? 'Unreachable'
                        : 'Disabled'
                    : 'Not registered';
                  return (
                    <tr key={store.slug}>
                      <td>
                        <div className="server-name">{store.displayName}</div>
                        <div className="key-meta">
                          {store.slug} · {store.namespace}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${cls}`}>{status}</span>
                        {store.errorMessage && (
                          <div className="key-meta" title={store.errorMessage}>
                            {String(store.errorMessage).slice(0, 110)}
                          </div>
                        )}
                      </td>
                      <td>
                        <a href={store.siteUrl} target="_blank" rel="noopener noreferrer">
                          {store.host}
                        </a>
                      </td>
                      <td>
                        <div>{store.upstreamId}</div>
                        <div className="key-meta">{upstreamText}</div>
                      </td>
                      <td>{store.ownerEmail || 'Bootstrap administrator'}</td>
                      <td>
                        {canDelete ? (
                          <button
                            className="btn small danger"
                            onClick={() => handleDelete(store.slug, store.displayName)}
                          >
                            Delete store
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
