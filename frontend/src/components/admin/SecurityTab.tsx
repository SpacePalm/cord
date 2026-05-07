// Админ-вкладка «Безопасность»: настройки fail2ban, заблокированные IP,
// заблокированные аккаунты, лог попыток входа.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, ShieldAlert, ListChecks, Save, Trash2, Plus, ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react';
import {
  adminAuthApi,
  type Fail2banSettings,
  type IpBlockEntry,
  type LockedUser,
  type AuthLogEntry,
  type GroupedIp,
} from '../../api/adminAuth';
import { useT, useLocale } from '../../i18n';

type LogView = 'list' | 'grouped';

export function SecurityTab() {
  const t = useT();
  const [logView, setLogView] = useState<LogView>('grouped');

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection />
      <BlocksSection />
      <LockedUsersSection />
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle icon={<ListChecks size={16} />} text={t('security.logTitle')} />
          <div className="flex items-center gap-1 bg-[var(--bg-input)] rounded p-0.5">
            <button
              onClick={() => setLogView('list')}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                logView === 'list' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t('security.viewList')}
            </button>
            <button
              onClick={() => setLogView('grouped')}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                logView === 'grouped' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t('security.viewGrouped')}
            </button>
          </div>
        </div>
        {logView === 'list' ? <LogList /> : <LogGrouped />}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function SectionTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
      {icon}
      {text}
    </h2>
  );
}

function useFmt() {
  const locale = useLocale();
  return (iso: string | null) => iso ? new Date(iso).toLocaleString(locale, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }) : '—';
}

function timeUntil(iso: string | null, t: (k: string, p?: Record<string, string | number>) => string): string {
  if (!iso) return t('security.permanent');
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t('security.expired');
  const min = Math.floor(ms / 60000);
  if (min < 60) return t('security.inMin', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('security.inHour', { n: hr });
  return t('security.inDay', { n: Math.floor(hr / 24) });
}

// ─── Settings ───────────────────────────────────────────────────────────

function SettingsSection() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['admin-auth-settings'],
    queryFn: adminAuthApi.getSettings,
  });
  const [draft, setDraft] = useState<Fail2banSettings | null>(null);
  const value = draft ?? settings ?? null;
  const dirty = !!draft && !!settings && JSON.stringify(draft) !== JSON.stringify(settings);

  const mutate = useMutation({
    mutationFn: adminAuthApi.updateSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-auth-settings'], data);
      setDraft(null);
    },
  });

  if (!value) return <p className="text-sm text-[var(--text-muted)]">{t('loading')}</p>;

  const set = <K extends keyof Fail2banSettings>(k: K, v: Fail2banSettings[K]) =>
    setDraft({ ...value, [k]: v });

  return (
    <div>
      <SectionTitle icon={<Lock size={16} />} text={t('security.settingsTitle')} />
      <p className="text-xs text-[var(--text-muted)] mt-1 mb-3">{t('security.settingsHint')}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)]">
        <Toggle label={t('security.enabledLabel')} value={value.enabled} onChange={(v) => set('enabled', v)} />
        <NumField label={t('security.attemptsPerIp')} value={value.attempts_per_ip} onChange={(v) => set('attempts_per_ip', v)} suffix="" />
        <NumField label={t('security.attemptsPerAccount')} value={value.attempts_per_account} onChange={(v) => set('attempts_per_account', v)} suffix="" />
        <NumField label={t('security.windowSeconds')} value={value.window_seconds} onChange={(v) => set('window_seconds', v)} suffix={t('security.suffixSec')} />
        <NumField label={t('security.ipBlockSeconds')} value={value.ip_block_seconds} onChange={(v) => set('ip_block_seconds', v)} suffix={t('security.suffixSec')} />
        <NumField label={t('security.accountLockSeconds')} value={value.account_lock_seconds} onChange={(v) => set('account_lock_seconds', v)} suffix={t('security.suffixSec')} />
        <NumField label={t('security.logRetentionDays')} value={value.log_retention_days} onChange={(v) => set('log_retention_days', v)} suffix={t('security.suffixDay')} />
        <NumField label={t('security.ipBlockRetentionDays')} value={value.ip_block_retention_days} onChange={(v) => set('ip_block_retention_days', v)} suffix={t('security.suffixDay')} />
      </div>

      {dirty && (
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => mutate.mutate(draft!)}
            disabled={mutate.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
          >
            <Save size={14} /> {t('save')}
          </button>
          <button
            onClick={() => setDraft(null)}
            className="px-3 py-1.5 rounded text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            {t('cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

// Контейнер для контрола в строке настройки. Фиксированная ширина, чтобы
// инпуты, тогглы и суффиксы во всех строках сетки совпадали по краям.
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <div className="flex items-center justify-end gap-1.5 shrink-0 w-32">
        {children}
      </div>
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <FieldRow label={label}>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${value ? 'bg-[var(--accent)]' : 'bg-white/10'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${value ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </FieldRow>
  );
}

function NumField({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <FieldRow label={label}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value || '0', 10)))}
        className="w-24 px-2 py-1 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)]"
      />
      {/* Суффикс всегда занимает место — иначе инпуты соседних строк скачут. */}
      <span className="text-xs text-[var(--text-muted)] w-6 shrink-0">{suffix}</span>
    </FieldRow>
  );
}

// ─── IP Blocks ──────────────────────────────────────────────────────────

function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

// IntersectionObserver-хук: вызывает onIntersect когда sentinel виден в viewport
// своего scroll-контейнера. enabled флаг гасит триггеры пока идёт fetchNextPage.
function useInfiniteScroll(
  sentinelRef: React.RefObject<HTMLDivElement>,
  rootRef: React.RefObject<HTMLDivElement>,
  enabled: boolean,
  onIntersect: () => void,
) {
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !enabled) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) onIntersect(); },
      { root: rootRef.current ?? null, rootMargin: '120px 0px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [sentinelRef, rootRef, enabled, onIntersect]);
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative flex-1 max-w-sm">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-3 py-1.5 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
      />
    </div>
  );
}

function BlocksSection() {
  const t = useT();
  const fmt = useFmt();
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');
  const { data: blocks = [] } = useQuery({
    queryKey: ['admin-auth-blocks', showInactive],
    queryFn: () => adminAuthApi.blocks(!showInactive),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return blocks;
    return blocks.filter((b) =>
      b.ip.toLowerCase().includes(q) ||
      (b.reason || '').toLowerCase().includes(q) ||
      (b.blocked_by || '').toLowerCase().includes(q)
    );
  }, [blocks, search]);

  const remove = useMutation({
    mutationFn: adminAuthApi.deleteBlock,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-auth-blocks'] }),
  });

  const [newIp, setNewIp] = useState('');
  const [newReason, setNewReason] = useState('');
  const [newDuration, setNewDuration] = useState<string>('3600');
  const create = useMutation({
    mutationFn: adminAuthApi.createBlock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-auth-blocks'] });
      setNewIp(''); setNewReason('');
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <SectionTitle icon={<ShieldAlert size={16} />} text={t('security.blocksTitle')} />
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-[var(--accent)]" />
          {t('security.showExpired')}
        </label>
      </div>

      <div className="mb-2 flex items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder={t('security.searchIp')} />
        <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{filtered.length} IP</span>
      </div>

      <div className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">
        {filtered.length === 0 ? (
          <p className="text-center text-sm text-[var(--text-muted)] py-6">
            {blocks.length === 0 ? t('security.noBlocks') : t('security.nothingFound')}
          </p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-[var(--text-muted)] uppercase tracking-wider sticky top-0 bg-[var(--bg-secondary)] z-10">
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left px-3 py-2">IP</th>
                  <th className="text-left px-3 py-2">{t('security.reason')}</th>
                  <th className="text-left px-3 py-2">{t('security.attempts')}</th>
                  <th className="text-left px-3 py-2">{t('security.expires')}</th>
                  <th className="text-left px-3 py-2">{t('security.source')}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b: IpBlockEntry) => (
                  <tr key={b.ip} className="border-b border-[var(--border-color)] last:border-0 hover:bg-white/[.02]">
                    <td className="px-3 py-2 font-mono text-[var(--text-primary)]">{b.ip}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] truncate max-w-[260px]">{b.reason || '—'}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{b.attempts_count}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)] whitespace-nowrap">
                      {b.expires_at ? `${fmt(b.expires_at)} (${timeUntil(b.expires_at, t)})` : t('security.permanent')}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{b.blocked_by}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => remove.mutate(b.ip)}
                        title={t('security.unblock')}
                        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual add */}
      <div className="mt-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex flex-wrap gap-2 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase text-[var(--text-muted)]">IP</label>
          <input
            value={newIp}
            onChange={(e) => setNewIp(e.target.value)}
            placeholder="1.2.3.4"
            className="px-2 py-1 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)] font-mono w-40"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
          <label className="text-[10px] uppercase text-[var(--text-muted)]">{t('security.reason')}</label>
          <input
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            placeholder={t('security.reasonPlaceholder')}
            className="px-2 py-1 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase text-[var(--text-muted)]">{t('security.duration')}</label>
          <select
            value={newDuration}
            onChange={(e) => setNewDuration(e.target.value)}
            className="px-2 py-1 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="3600">1 ч</option>
            <option value="86400">1 д</option>
            <option value="604800">7 д</option>
            <option value="2592000">30 д</option>
            <option value="">{t('security.permanent')}</option>
          </select>
        </div>
        <button
          onClick={() => create.mutate({
            ip: newIp.trim(),
            reason: newReason.trim() || 'Manual',
            duration_seconds: newDuration ? parseInt(newDuration, 10) : null,
          })}
          disabled={!newIp.trim() || create.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
        >
          <Plus size={14} /> {t('security.addBlock')}
        </button>
      </div>
    </div>
  );
}

// ─── Locked Users ──────────────────────────────────────────────────────

function LockedUsersSection() {
  const t = useT();
  const fmt = useFmt();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const { data: users = [] } = useQuery({
    queryKey: ['admin-auth-locked'],
    queryFn: adminAuthApi.lockedUsers,
  });
  const unlock = useMutation({
    mutationFn: adminAuthApi.unlockUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-auth-locked'] }),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  }, [users, search]);

  return (
    <div>
      <SectionTitle icon={<Lock size={16} />} text={t('security.lockedTitle')} />
      <div className="mt-3 mb-2 flex items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder={t('security.searchUsername')} />
        <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
          {filtered.length} {t('security.lockedCountSuffix')}
        </span>
      </div>
      <div className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">
        {filtered.length === 0 ? (
          <p className="text-center text-sm text-[var(--text-muted)] py-6">
            {users.length === 0 ? t('security.noLocked') : t('security.nothingFound')}
          </p>
        ) : (
          <div className="max-h-[300px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-[var(--text-muted)] uppercase tracking-wider sticky top-0 bg-[var(--bg-secondary)] z-10">
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left px-3 py-2">{t('security.username')}</th>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">{t('security.failedAttempts')}</th>
                  <th className="text-left px-3 py-2">{t('security.lockedUntil')}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u: LockedUser) => (
                  <tr key={u.user_id} className="border-b border-[var(--border-color)] last:border-0 hover:bg-white/[.02]">
                    <td className="px-3 py-2 text-[var(--text-primary)]">{u.username}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{u.email}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{u.failed_attempts}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)] whitespace-nowrap">
                      {fmt(u.locked_until)} ({timeUntil(u.locked_until, t)})
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => unlock.mutate(u.user_id)}
                        title={t('security.unlock')}
                        className="px-2 py-0.5 rounded text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
                      >
                        {t('security.unlock')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Log: list view ────────────────────────────────────────────────────

const LOG_PAGE_SIZE = 50;

function LogList() {
  const t = useT();
  const fmt = useFmt();
  const [ip, setIp] = useState('');
  const [username, setUsername] = useState('');
  const [success, setSuccess] = useState<'all' | 'fail' | 'success'>('fail');
  const dIp = useDebounced(ip);
  const dUsername = useDebounced(username);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const {
    data, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ['admin-auth-log', dIp, dUsername, success],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => adminAuthApi.log({
      ip: dIp || undefined,
      username: dUsername || undefined,
      success: success === 'all' ? undefined : success === 'success',
      limit: LOG_PAGE_SIZE,
      offset: pageParam as number,
    }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < LOG_PAGE_SIZE ? undefined : allPages.reduce((n, p) => n + p.length, 0),
  });

  const log = useMemo(() => data?.pages.flat() ?? [], [data]);

  useInfiniteScroll(
    sentinelRef,
    scrollRef,
    !!hasNextPage && !isFetchingNextPage,
    fetchNextPage,
  );

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2 items-end">
        <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="IP"
          className="px-2 py-1 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)] font-mono w-40" />
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('security.usernameOrEmail')}
          className="px-2 py-1 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)] flex-1 min-w-[160px]" />
        <select value={success} onChange={(e) => setSuccess(e.target.value as typeof success)}
          className="px-2 py-1 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)]">
          <option value="fail">{t('security.failed')}</option>
          <option value="success">{t('security.success')}</option>
          <option value="all">{t('security.all')}</option>
        </select>
        <button onClick={() => refetch()} className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">
        {log.length === 0 && !isFetching ? (
          <p className="text-center text-sm text-[var(--text-muted)] py-6">{t('security.noLog')}</p>
        ) : (
          <div ref={scrollRef} className="max-h-[440px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-[var(--text-muted)] uppercase tracking-wider sticky top-0 bg-[var(--bg-secondary)] z-10">
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left px-3 py-2">{t('security.time')}</th>
                  <th className="text-left px-3 py-2">IP</th>
                  <th className="text-left px-3 py-2">{t('security.usernameOrEmail')}</th>
                  <th className="text-left px-3 py-2">{t('security.result')}</th>
                </tr>
              </thead>
              <tbody>
                {log.map((e: AuthLogEntry) => (
                  <tr key={e.id} className="border-b border-[var(--border-color)] last:border-0 hover:bg-white/[.02]">
                    <td className="px-3 py-2 text-[var(--text-muted)] whitespace-nowrap">{fmt(e.created_at)}</td>
                    <td className="px-3 py-2 font-mono text-[var(--text-primary)]">{e.ip}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] truncate max-w-[260px]">{e.username_attempted}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        e.success ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                      }`}>
                        {e.success ? t('security.success') : t('security.failed')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div ref={sentinelRef} />
            {isFetchingNextPage && (
              <div className="flex justify-center py-3">
                <div className="w-4 h-4 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Log: grouped view ─────────────────────────────────────────────────

const GROUPED_PAGE_SIZE = 30;

function LogGrouped() {
  const t = useT();
  const fmt = useFmt();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const dSearch = useDebounced(search);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const {
    data, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ['admin-auth-log-grouped', dSearch],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => adminAuthApi.logGrouped({
      q: dSearch || undefined,
      limit: GROUPED_PAGE_SIZE,
      offset: pageParam as number,
    }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < GROUPED_PAGE_SIZE ? undefined : allPages.reduce((n, p) => n + p.length, 0),
  });

  const groups = useMemo(() => data?.pages.flat() ?? [], [data]);

  useInfiniteScroll(
    sentinelRef,
    scrollRef,
    !!hasNextPage && !isFetchingNextPage,
    fetchNextPage,
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-auth-log-grouped'] });
    queryClient.invalidateQueries({ queryKey: ['admin-auth-blocks'] });
  };
  const block = useMutation({ mutationFn: adminAuthApi.createBlock, onSuccess: invalidate });
  const unblock = useMutation({ mutationFn: adminAuthApi.deleteBlock, onSuccess: invalidate });

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <SearchInput value={search} onChange={setSearch} placeholder={t('security.searchIp')} />
        <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
          {groups.length}{hasNextPage ? '+' : ''} IP
        </span>
        <button onClick={() => refetch()} className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">
        {groups.length === 0 && !isFetching ? (
          <p className="text-center text-sm text-[var(--text-muted)] py-6">
            {dSearch ? t('security.nothingFound') : t('security.noLog')}
          </p>
        ) : (
          <div ref={scrollRef} data-grouped-scroller className="max-h-[440px] overflow-y-auto">
            <div className="divide-y divide-[var(--border-color)]">
              {groups.map((g) => (
                <GroupRow
                  key={g.ip}
                  g={g}
                  fmt={fmt}
                  t={t}
                  onBlock={(durationSeconds) => block.mutate({
                    ip: g.ip,
                    reason: `Manual: ${g.failed} failed attempts`,
                    duration_seconds: durationSeconds,
                  })}
                  onUnblock={() => unblock.mutate(g.ip)}
                />
              ))}
            </div>
            <div ref={sentinelRef} />
            {isFetchingNextPage && (
              <div className="flex justify-center py-3">
                <div className="w-4 h-4 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupRow({ g, fmt, t, onBlock, onUnblock }: {
  g: GroupedIp;
  fmt: (s: string | null) => string;
  t: (k: string, p?: Record<string, string | number>) => string;
  onBlock: (durationSeconds: number | null) => void;
  onUnblock: () => void;
}) {
  const [open, setOpen] = useState(false);
  // duration в виде строки чтобы '' = вечный бан (null на бэке).
  const [duration, setDuration] = useState<string>('3600');
  const headerRef = useRef<HTMLDivElement>(null);
  const lastAtRel = useMemo(() => {
    const ms = Date.now() - new Date(g.last_at).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return t('security.justNow');
    if (min < 60) return t('security.minAgo', { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('security.hourAgo', { n: hr });
    return t('security.dayAgo', { n: Math.floor(hr / 24) });
  }, [g.last_at, t]);

  // При раскрытии группы — поднимаем её заголовок к верху scroll-контейнера,
  // чтобы появившаяся под ним таблица попыток сразу была видна. Скроллим
  // только локальный контейнер (data-grouped-scroller), не страницу.
  useEffect(() => {
    if (!open) return;
    const header = headerRef.current;
    const scroller = header?.closest('[data-grouped-scroller]') as HTMLElement | null;
    if (!header || !scroller) return;
    requestAnimationFrame(() => {
      const offset = header.getBoundingClientRect().top
        - scroller.getBoundingClientRect().top
        + scroller.scrollTop;
      scroller.scrollTo({ top: Math.max(0, offset - 4), behavior: 'smooth' });
    });
  }, [open]);

  // Используем div+onClick (а не <button>) — внутри строки лежат вложенные
  // кнопки «Заблокировать»/«Разблокировать», что некорректно для button-in-button.
  return (
    <div>
      <div
        ref={headerRef}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[.02] transition-colors cursor-pointer select-none"
      >
        {open ? <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" /> : <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />}
        <span className="font-mono text-sm text-[var(--text-primary)]">{g.ip}</span>
        {g.is_blocked && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-400">
            {t('security.blocked')}
          </span>
        )}
        <span className="text-xs text-[var(--text-muted)]">
          {t('security.attemptsCount', { total: g.total, failed: g.failed, users: g.distinct_users })}
        </span>
        <span className="ml-auto text-xs text-[var(--text-muted)]">{lastAtRel}</span>
        {g.is_blocked ? (
          <button
            onClick={(e) => { e.stopPropagation(); onUnblock(); }}
            title={t('security.unblock')}
            className="ml-2 px-2 py-0.5 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors"
          >
            {t('security.unblock')}
          </button>
        ) : (
          <div className="ml-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-input)] text-[var(--text-secondary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)]"
            >
              <option value="3600">1 ч</option>
              <option value="86400">1 д</option>
              <option value="604800">7 д</option>
              <option value="2592000">30 д</option>
              <option value="">{t('security.permanent')}</option>
            </select>
            <button
              onClick={() => onBlock(duration ? parseInt(duration, 10) : null)}
              title={t('security.block')}
              className="px-2 py-0.5 rounded text-[10px] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
            >
              {t('security.block')}
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="bg-[var(--bg-primary)] border-t border-[var(--border-color)] max-h-[260px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider sticky top-0 bg-[var(--bg-primary)] z-10">
              <tr>
                <th className="text-left px-3 py-1.5">{t('security.usernameOrEmail')}</th>
                <th className="text-left px-3 py-1.5">{t('security.attempts')}</th>
                <th className="text-left px-3 py-1.5">{t('security.lastAttempt')}</th>
              </tr>
            </thead>
            <tbody>
              {g.by_user.map((u) => (
                <tr key={u.username} className="border-t border-[var(--border-color)]">
                  <td className="px-3 py-1.5 text-[var(--text-secondary)] truncate max-w-[260px]">{u.username || '—'}</td>
                  <td className="px-3 py-1.5 text-[var(--text-muted)]">{u.count}</td>
                  <td className="px-3 py-1.5 text-[var(--text-muted)]">{fmt(u.last_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
