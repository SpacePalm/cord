// Wrapper для AdvancedSearchPanel. Рендерится в корне приложения и
// открывается/закрывается через sessionStore (uiAdvancedSearchOpen).
//
// Сделано отдельным компонентом, потому что AdvancedSearchPanel может быть
// открыт хоткеем Cmd+Shift+F и без палитры — поэтому его рендер не должен
// зависеть от состояния палитры.

import { useNavigate, useLocation } from 'react-router-dom';
import { AdvancedSearchPanel } from './AdvancedSearchPanel';
import { useSessionStore } from '../store/sessionStore';

export function AdvancedSearchRoot() {
  const navigate = useNavigate();
  const location = useLocation();
  const open = useSessionStore((s) => s.uiAdvancedSearchOpen);
  const closeAdvanced = useSessionStore((s) => s.closeAdvancedSearch);
  const openPalette = useSessionStore((s) => s.openPalette);
  const closePalette = useSessionStore((s) => s.closePalette);
  const setLastGroup = useSessionStore((s) => s.setLastGroup);
  const setLastChannel = useSessionStore((s) => s.setLastChannel);
  const setPendingJumpTo = useSessionStore((s) => s.setPendingJumpTo);

  if (!open) return null;

  return (
    <AdvancedSearchPanel
      onClose={closeAdvanced}
      onBackToSimple={() => {
        // Возврат к простой палитре: закрываем расширенный, открываем палитру.
        closeAdvanced();
        openPalette();
      }}
      onJumpToMessage={(hit) => {
        setLastGroup(hit.group_id);
        setLastChannel(hit.chat_id);
        setPendingJumpTo({ chatId: hit.chat_id, messageId: hit.id, createdAt: hit.created_at });
        if (location.pathname !== '/app') navigate('/app');
        closeAdvanced();
        closePalette();
      }}
    />
  );
}
