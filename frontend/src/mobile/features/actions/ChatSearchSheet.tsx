// In-chat search (ChatSearchView.swift + ChatSearchStore).
// Custom Cord search field fixed at the top (focused on appear), 400ms debounce, q ≥ 2 characters,
// newest-first pages of 20 with a `before` cursor (infinite scroll, dedupe, stale-response token),
// highlights in accent @35%. Tap a result → onJump(msg) + dismiss.
// Results are kept in local state fed by the requests themselves (not by a cached react-query queryFn), so a
// re-typed query can never show a false "Ничего не найдено" (web SearchPanel bug).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Message } from '../../../types';
import { messagesApi } from '../../../api/messages';
import { present, primeKeyboard, type SheetCtx } from '../../present/PresentationProvider';
import { SheetScreen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import { CordSearchField, PlainList, Row, SpinnerRow } from '../../ui';
import { useMT, useMobileLocale } from '../../i18n';
import { HitRowBody } from './HitRow';
import { charCount } from './shared';
import './actions.css';

export interface ChatSearchSheetProps extends SheetCtx {
  chatId: string;
  onJump: (msg: Message) => void;
}

const PAGE = 20;
const DEBOUNCE_MS = 400;

interface SearchState {
  query: string;
  results: Message[];
  isSearching: boolean;
  loadingMore: boolean;
  hasMore: boolean;
}

/** ChatSearchStore port. */
function useChatSearch(chatId: string) {
  const [input, setInputRaw] = useState('');
  const [st, setSt] = useState<SearchState>({ query: '', results: [], isSearching: false, loadingMore: false, hasMore: true });
  const stRef = useRef(st);
  stRef.current = st;
  const token = useRef(0);
  const timer = useRef<number | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const run = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (charCount(q) < 2) {
        token.current++; // drop any in-flight response
        setSt({ query: q, results: [], isSearching: false, loadingMore: false, hasMore: true });
        return;
      }
      const mine = ++token.current;
      setSt({ query: q, results: [], isSearching: true, loadingMore: false, hasMore: true });
      let res: Message[] = [];
      let ok = true;
      try {
        res = await messagesApi.search(chatId, q, PAGE);
      } catch {
        ok = false;
      }
      if (!alive.current || mine !== token.current) return; // stale response — the query changed
      setSt((s) => ({ ...s, results: ok ? res : [], hasMore: ok ? res.length >= PAGE : s.hasMore, isSearching: false }));
    },
    [chatId],
  );

  const setInput = useCallback(
    (v: string) => {
      setInputRaw(v);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void run(v);
      }, DEBOUNCE_MS);
    },
    [run],
  );

  const loadMore = useCallback(async () => {
    const s = stRef.current;
    const oldest = s.results[s.results.length - 1];
    if (!s.hasMore || s.loadingMore || s.isSearching || charCount(s.query) < 2 || !oldest) return;
    const mine = token.current;
    stRef.current = { ...s, loadingMore: true };
    setSt((x) => ({ ...x, loadingMore: true }));
    try {
      const more = await messagesApi.search(chatId, s.query, PAGE, oldest.created_at);
      if (!alive.current || mine !== token.current) return;
      setSt((x) => {
        const seen = new Set(x.results.map((m) => m.id));
        return { ...x, results: [...x.results, ...more.filter((m) => !seen.has(m.id))], hasMore: more.length >= PAGE, loadingMore: false };
      });
    } catch {
      // silent; hasMore unchanged → re-triggers when the last row re-appears
      if (alive.current && mine === token.current) setSt((x) => ({ ...x, loadingMore: false }));
    }
  }, [chatId]);

  return { input, setInput, ...st, loadMore };
}

export function ChatSearchSheet({ chatId, onJump, dismiss }: ChatSearchSheetProps) {
  const t = useMT();
  const locale = useMobileLocale();
  const s = useChatSearch(chatId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastRef = useRef<HTMLDivElement | null>(null);
  const lastId = s.results[s.results.length - 1]?.id;

  // iOS applies only `.autocorrectionDisabled()` here: autocapitalisation stays at the TextField default
  // (sentences). CordSearchField hard-codes autocapitalize="none" (QuickSwitcher/AdvancedSearch) — React sets
  // that static attribute once at mount, so overriding it after mount sticks.
  useLayoutEffect(() => {
    inputRef.current?.setAttribute('autocapitalize', 'sentences');
  }, []);

  // `.onAppear` of the last row → loadMore
  const loadMore = s.loadMore;
  useEffect(() => {
    const el = lastRef.current;
    const root = scrollRef.current;
    if (!el || !root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lastId, loadMore, s.loadingMore]);

  const showMin = charCount(s.query) < 2;
  const showNone = !showMin && !s.isSearching && s.results.length === 0;

  return (
    <SheetScreen
      title={t('search.title')}
      trailing={
        <BarTextButton prominent onPress={() => void dismiss()}>
          {t('common.close')}
        </BarTextButton>
      }
      scroll={false}
    >
      <div className="m-act-fill">
        <div className="m-act-head">
          <CordSearchField
            value={s.input}
            onChange={s.setInput}
            placeholder={t('search.placeholder')}
            loading={s.isSearching}
            autoFocus
            inputRef={inputRef}
            onSubmit={() => inputRef.current?.blur()}
            style={{ padding: 12 }}
          />
        </div>
        <div className="m-act-body">
          {showMin || showNone ? (
            <div className="m-act-center no-top">
              <div className="m-act-muted is-sub">{t(showMin ? 'search.minChars' : 'search.noResults')}</div>
            </div>
          ) : (
            <div className="m-act-scroll no-top" ref={scrollRef}>
              <PlainList>
                {s.results.map((msg) => (
                  <Row
                    key={msg.id}
                    onPress={() => {
                      onJump(msg);
                      void dismiss();
                    }}
                  >
                    <div ref={msg.id === lastId ? lastRef : undefined}>
                      <HitRowBody
                        msg={msg}
                        locale={locale}
                        query={s.query}
                        attachmentsText={`📎 ${msg.attachments.length} ${t('search.attachments')}`}
                      />
                    </div>
                  </Row>
                ))}
                {s.loadingMore && <SpinnerRow />}
              </PlainList>
            </div>
          )}
        </div>
      </div>
    </SheetScreen>
  );
}

/**
 * Presents the in-chat search sheet with the keyboard up: call it synchronously from the tap handler
 * (primes the iOS keyboard inside the user gesture).
 */
export function openChatSearch(chatId: string, onJump: (msg: Message) => void): SheetCtx {
  primeKeyboard();
  return present.presentSheet((ctx) => <ChatSearchSheet {...ctx} chatId={chatId} onJump={onJump} />);
}
