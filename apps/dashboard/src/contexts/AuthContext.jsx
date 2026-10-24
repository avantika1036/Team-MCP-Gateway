import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const DASHBOARD_TOKEN_SLOT = 'urumi.dashboard.adminKey';
const CHAT_TOKEN_SLOT = 'urumi.chat.apiKey';

export function AuthProvider({ children }) {
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSession = async (authToken) => {
    const response = await fetch('/api/session', {
      headers: {
        Authorization: `Bearer ${authToken.trim()}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Authentication failed (${response.status})`);
    }

    const data = await response.json();
    return data.user;
  };

  useEffect(() => {
    const savedToken =
      sessionStorage.getItem(DASHBOARD_TOKEN_SLOT) || sessionStorage.getItem(CHAT_TOKEN_SLOT);

    if (savedToken) {
      fetchSession(savedToken)
        .then((userData) => {
          setToken(savedToken.trim());
          setUser(userData);
          setIsAuthenticated(true);
        })
        .catch(() => {
          sessionStorage.removeItem(DASHBOARD_TOKEN_SLOT);
          sessionStorage.removeItem(CHAT_TOKEN_SLOT);
          setToken('');
          setUser(null);
          setIsAuthenticated(false);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (newToken, requireAdmin = false) => {
    const cleanToken = newToken.trim();
    try {
      const userData = await fetchSession(cleanToken);

      if (requireAdmin && userData.role !== 'admin') {
        throw new Error(
          `The account ${userData.email} has role '${userData.role}'. An admin key is required.`,
        );
      }

      setToken(cleanToken);
      setUser(userData);
      setIsAuthenticated(true);
      sessionStorage.setItem(DASHBOARD_TOKEN_SLOT, cleanToken);
      sessionStorage.setItem(CHAT_TOKEN_SLOT, cleanToken);
      return userData;
    } catch (error) {
      setIsAuthenticated(false);
      setUser(null);
      setToken('');
      sessionStorage.removeItem(DASHBOARD_TOKEN_SLOT);
      sessionStorage.removeItem(CHAT_TOKEN_SLOT);
      throw error;
    }
  };

  const loginAsAdmin = async (newToken) => {
    return login(newToken, true);
  };

  const logout = () => {
    setToken('');
    setUser(null);
    setIsAuthenticated(false);
    sessionStorage.removeItem(DASHBOARD_TOKEN_SLOT);
    sessionStorage.removeItem(CHAT_TOKEN_SLOT);
  };

  const api = useCallback(
    async (path, options = {}) => {
      const activeToken =
        token ||
        sessionStorage.getItem(DASHBOARD_TOKEN_SLOT) ||
        sessionStorage.getItem(CHAT_TOKEN_SLOT);

      const headers = {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(activeToken ? { Authorization: `Bearer ${activeToken.trim()}` } : {}),
        ...(options.headers || {}),
      };

      const response = await fetch(path, { ...options, headers });
      if (response.status === 204) return null;

      const contentType = response.headers.get('content-type') || '';
      const result = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : await response.text();

      if (!response.ok) {
        throw new Error(result?.error || `Request failed (${response.status})`);
      }

      return result;
    },
    [token],
  );

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated,
        isLoading,
        login,
        loginAsAdmin,
        logout,
        api,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
