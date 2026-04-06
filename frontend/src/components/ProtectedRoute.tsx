// Компонент-обёртка для защищённых страниц.
// Если пользователь не авторизован — редиректит на /login.
//
// Zustand v5 гидрирует persist-стор асинхронно. Чтобы не редиректить
// авторизованного пользователя до завершения гидрации, даём сторам
// один микротик на инициализацию через useEffect с пустым массивом.

import { useState, useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export function ProtectedRoute() {
  const [ready, setReady] = useState(false);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!token) return <Navigate to="/login" replace />;

  return <Outlet />;
}
