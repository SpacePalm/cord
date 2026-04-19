import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { AppPage } from './pages/AppPage';
import { AdminPage } from './pages/AdminPage';
import { InvitePage } from './pages/InvitePage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useThemeStore } from './store/themeStore';
import { useAuthStore } from './store/authStore';
import { authApi } from './api/auth';
import { applyServerPreferences, startPreferencesAutoSync } from './utils/preferencesSync';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CordWebSocketProvider } from './hooks/useWebSocket';
import { CommandPalette } from './components/CommandPalette';
import { IncomingCallOverlay } from './components/IncomingCallOverlay';
import { OutgoingCallWatcher } from './components/OutgoingCallWatcher';
import { MessageNotifier } from './components/MessageNotifier';

// React Query client — caches API requests
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function ThemeInit() {
  const initTheme = useThemeStore((s) => s.initTheme);
  const loadFromServer = useThemeStore((s: { loadFromServer: (json: string | null) => void }) => s.loadFromServer);
  const token = useAuthStore((s) => s.token);
  useEffect(() => {
    initTheme();
    if (token) {
      authApi.me().then((user) => {
        if (user.theme_json) loadFromServer(user.theme_json);
        // Подтягиваем prefs с сервера (язык + уведомления + mute чатов).
        // Порядок важен: сначала применяем серверные значения, потом включаем
        // автосинк — иначе первое же применение могло бы перезаписать сервер.
        applyServerPreferences(user.preferences_json);
        startPreferencesAutoSync();
      }).catch(() => {});
    }
  }, [initTheme, loadFromServer, token]);
  return null;
}

function Heartbeat() {
  const token = useAuthStore((s) => s.token);
  useEffect(() => {
    if (!token) return;
    authApi.heartbeat().catch(() => {});
    const iv = setInterval(() => authApi.heartbeat().catch(() => {}), 60_000);
    return () => clearInterval(iv);
  }, [token]);
  return null;
}

// Палитра команд и оверлей входящих звонков — только у авторизованных.
function AuthenticatedOverlays() {
  const token = useAuthStore((s) => s.token);
  if (!token) return null;
  return (
    <>
      <CommandPalette />
      <IncomingCallOverlay />
      <OutgoingCallWatcher />
      <MessageNotifier />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeInit />
        <Heartbeat />
        <CordWebSocketProvider>
        <AuthenticatedOverlays />
        <Routes>
          {/* Public pages */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/invite/:code" element={<InvitePage />} />

          {/* Protected pages — auth required */}
          <Route element={<ProtectedRoute />}>
            <Route path="/app" element={<AppPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>

          {/* Redirect from root */}
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
        </CordWebSocketProvider>
      </BrowserRouter>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}
