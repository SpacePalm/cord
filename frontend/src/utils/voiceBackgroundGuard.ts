// Утилиты для удержания голосового звонка активным на мобильных устройствах.
//
// Проблема: iOS Safari и Android Chrome агрессивно усыпляют фоновые вкладки
// и выключают аудио/WebSocket когда экран гаснет. Комбинация приёмов ниже
// максимизирует шансы что звонок выживет в фоне/при заблокированном экране.
//
// Что делаем:
//   1) Screen Wake Lock — не даём экрану гаснуть (Android Chrome, iOS 16.4+)
//   2) Media Session API — регистрируем звонок как «активное медиа», тогда
//      ОС показывает его на lock-screen и не глушит вкладку так агрессивно.
//   3) Тихий audio-loop — держит AudioContext активным даже если никто не
//      говорит (иначе Safari может приостановить WebRTC audio тракт).
//   4) Переподнимаем Wake Lock при возврате вкладки (API автоматически
//      релизит лок когда visibilityState переходит в hidden).

let _wakeLock: WakeLockSentinel | null = null;
let _silentAudio: HTMLAudioElement | null = null;
let _visListener: (() => void) | null = null;
let _active = false;

/**
 * «Мобильный режим» — тот же бреакпойнт что использует приложение для
 * переключения UI (window.innerWidth < 768 в AppPage / SettingsModal).
 * На десктопах защита не нужна — браузер не усыпляет вкладки.
 */
function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
}

// Минимальный wav-файл тишины в data-URI (короткий, зацикливаем).
// Сгенерирован: 0.1s тишины 8kHz mono.
const SILENT_WAV_DATAURI =
  'data:audio/wav;base64,UklGRnAAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUwAAAB/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/fw==';

async function acquireWakeLock(): Promise<void> {
  if (_wakeLock) return;
  // @ts-ignore — типы Wake Lock отсутствуют в старых TS-либах
  if (typeof navigator === 'undefined' || !navigator.wakeLock) return;
  try {
    // @ts-ignore
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock!.addEventListener('release', () => {
      _wakeLock = null;
    });
  } catch {
    // Пользователь отказал, устройство не поддерживает, вкладка в фоне —
    // молча игнорируем, звонок всё равно попытается работать.
  }
}

function setupMediaSession(title: string, subtitle: string): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: subtitle,
    });
    navigator.mediaSession.playbackState = 'playing';
    // Ловим hardware-кнопки: пауза от bluetooth-наушников и т.п.
    // Просто ноу-оп чтобы ОС показала контролы (без этого lockscreen-виджет
    // может вообще не появиться).
    for (const action of ['play', 'pause'] as const) {
      try { navigator.mediaSession.setActionHandler(action, () => {}); } catch {}
    }
  } catch {
    // SSR или устройство без MediaSession — не фатально.
  }
}

function teardownMediaSession(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    for (const action of ['play', 'pause'] as const) {
      try { navigator.mediaSession.setActionHandler(action, null); } catch {}
    }
  } catch {}
}

function startSilentAudio(): void {
  if (_silentAudio) return;
  try {
    const a = new Audio(SILENT_WAV_DATAURI);
    a.loop = true;
    a.volume = 0.0001;  // фактически тишина, но не 0 — иначе Safari может не считать «играющим»
    // play() возвращает Promise, без await чтобы не блокировать инициализацию.
    a.play().catch(() => { /* требуется user gesture — вызываем ИЗ обработчика Join */ });
    _silentAudio = a;
  } catch {}
}

function stopSilentAudio(): void {
  if (_silentAudio) {
    try { _silentAudio.pause(); _silentAudio.src = ''; } catch {}
    _silentAudio = null;
  }
}

/**
 * Активировать комплексную защиту от усыпления для голосового звонка.
 * Вызывать ИЗ user-gesture контекста (клик «Присоединиться») — иначе Wake Lock
 * и silent-audio откажут из-за autoplay-политик.
 */
export async function activateVoiceGuard(title: string, subtitle: string): Promise<void> {
  if (_active) return;
  // На десктопах защита не нужна — выходим молча.
  if (!isMobile()) return;
  _active = true;

  await acquireWakeLock();
  setupMediaSession(title, subtitle);
  startSilentAudio();

  // Wake Lock автоматически релизится когда вкладка становится hidden.
  // При возврате в visible — переподнимаем.
  _visListener = () => {
    if (document.visibilityState === 'visible' && _active) {
      acquireWakeLock();
    }
  };
  document.addEventListener('visibilitychange', _visListener);
}

/** Снять защиту (при выходе из звонка). Идемпотентно. */
export async function deactivateVoiceGuard(): Promise<void> {
  if (!_active) return;
  _active = false;

  if (_visListener) {
    document.removeEventListener('visibilitychange', _visListener);
    _visListener = null;
  }
  teardownMediaSession();
  stopSilentAudio();
  if (_wakeLock) {
    try { await _wakeLock.release(); } catch {}
    _wakeLock = null;
  }
}
