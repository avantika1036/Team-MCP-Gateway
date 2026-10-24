import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import Overview from './Overview.jsx';
import Upstreams from './Upstreams.jsx';
import Stores from './Stores.jsx';
import Users from './Users.jsx';
import Audit from './Audit.jsx';

export default function Layout() {
  const { user, logout, api } = useAuth();
  const [currentPage, setCurrentPage] = useState('overview');
  const [gatewayStatus, setGatewayStatus] = useState('Checking connection…');
  const [servers, setServers] = useState([]);

  const checkHealth = async () => {
    try {
      const health = await api('/healthz');
      const serverData = await api('/api/admin/servers');
      setServers(serverData.servers || []);
      const reachable = (serverData.servers || []).filter((s) => s.enabled && s.status?.reachable).length;
      setGatewayStatus(`${reachable} of ${serverData.servers?.length || 0} upstreams reachable`);
    } catch {
      setGatewayStatus('Gateway status unavailable');
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [api]);


  const handleNavigate = (page) => {
    if (page === 'chat') {
      window.open('/chat/', '_blank', 'noopener');
      return;
    }
    setCurrentPage(page);
  };

  const handleRefreshAll = async () => {
    // Re-check health; individual page components manage their own data.
    await checkHealth();
  };

  const pages = {
    overview: { label: 'Overview', icon: '◈' },
    upstreams: { label: 'Upstreams', icon: '⇄' },
    stores: { label: 'Stores', icon: '▣' },
    users: { label: 'Users & keys', icon: '♙' },
    audit: { label: 'Audit trail', icon: '▤' },
    chat: { label: 'Chat agent ↗', icon: '✳' },
  };

  const breadcrumb = pages[currentPage]?.label || 'Overview';

  return (
    <div className="layout">
      <aside>
        <div className="side-brand">
          <div className="brand-mark">U</div>
          <div>
            <strong>URUMI</strong>
            <small>MCP CONTROL PLANE</small>
          </div>
        </div>
        <div>
          <div className="nav-group-title">Workspace</div>
          <nav className="nav" aria-label="Main navigation">
            {Object.entries(pages).map(([key, page]) => (
              <button
                key={key}
                className={currentPage === key ? 'active' : ''}
                onClick={() => handleNavigate(key)}
              >
                <span className="nav-icon">{page.icon}</span>
                {page.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="connection-label">GATEWAY STATUS</div>
          <div className="connection-value">
            <span className="dot"></span>
            <span>{gatewayStatus}</span>
          </div>
          <button className="btn ghost full" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main>
        <div className="topbar">
          <div className="crumb">
            Workspace <span className="muted">/</span> <span>{breadcrumb}</span>
          </div>
          <div className="top-actions">
            <button className="btn ghost small" onClick={handleRefreshAll}>↻ Refresh data</button>
            <div className="admin-chip">
              <span className="avatar">{user?.displayName?.[0]?.toUpperCase() || 'A'}</span>
              <span>{user ? `${user.displayName} · ${user.role}` : 'Administrator session'}</span>
            </div>
          </div>
        </div>

        {currentPage === 'overview' && <Overview onNavigate={handleNavigate} />}
        {currentPage === 'upstreams' && <Upstreams />}
        {currentPage === 'stores' && <Stores />}
        {currentPage === 'users' && <Users />}
        {currentPage === 'audit' && <Audit />}

        <div
          style={{
            marginTop: '28px',
            color: '#596a80',
            fontSize: '10px',
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <span>URUMI MCP CONTROL PLANE · Local development console</span>
          <span>Credentials never belong in source control.</span>
        </div>
      </main>
    </div>
  );
}
