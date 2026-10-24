import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import Login from './components/Login.jsx';
import Layout from './components/Layout.jsx';
import Chat from './components/Chat.jsx';

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();
  const [isChatRoute, setIsChatRoute] = useState(false);

  useEffect(() => {
    setIsChatRoute(window.location.pathname.startsWith('/chat'));
  }, []);

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  if (isChatRoute) {
    return <Chat />;
  }

  return <Layout />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
