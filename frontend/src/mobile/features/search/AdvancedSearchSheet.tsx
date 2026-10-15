// Advanced search — "Расширенный поиск" (cord-ios AdvancedSearchView.swift).
// Large sheet: xmark | title | filters button (accent dot when filters are active → stacked AdvancedFiltersSheet),
// search field with spinner, sort / grouping menu pickers, plain list of result cards with infinite scroll.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { present, primeKeyboard, type SheetCtx } from '../../present/PresentationProvider';
import { SheetScreen } from '../../nav/Screen';
import { BarButton } from '../../nav/BarButton';
import { mobileNav } from '../../nav/NavStack';
import { CordSearchField, Icon, ListSection, PlainList, Row, Spinner } from '../../ui';
import { useMT, useMobileLocale } from '../../i18n';
import type { GlobalMessageHit, ScopeOut } from '../../../api/search';
import {
  PAGE_SIZE,
  activeFilterCount,
  createAdvController,
  isEmptySearch,
  scopeQuery,
  type AdvController,
  type GroupBy,
  type SearchSort,
} from './advancedModel';
import { ResultCard } from './ResultCard';
import { AdvancedFiltersSheet } from './AdvancedFiltersSheet';
import './search.css';

export interface AdvancedSearchSheetProps extends SheetCtx {
  initialQuery?: string;
}

let presented = false;

/** Present the advanced-search sheet, optionally pre-filled (quick switcher hand-off). */
export function openAdvancedSearch(initialQuery?: string): void {
  if (presented) return;
  presented = true;
  primeKeyboard();
  present.presentSheet((ctx) => <AdvancedSearchSheet {...ctx} initialQuery={initialQuery} />, {
    onDismiss: () => {
      presented = false;
    },
  });
}

/**
 * SF `line.3.horizontal.decrease.circle` (≈22pt ring + three centred lines of decreasing width). The shared
 * Icon map only has lucide `ListFilter` (no ring), so the advanced-search bar button draws its own glyph.
 */
function FilterCircleGlyph() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="10.2" />
      <path d="M6.6 8.6h10.8M8.6 12h6.8M10.5 15.4h3" />
    </svg>
  );
}

// ───────────────────────────── compact menu picker ─────────────────────────────

function MenuPicker<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  const label = options.find((o) => o.value === value)?.label ?? '';
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    present.showMenu(
      e.currentTarget,
      options.map((o) => ({
        label: o.label,
        checked: o.value === value,
        onSelect: () => {
          if (o.value !== value) onChange(o.value);
        },
      })),
    );
  };
  return (
    <button type="button" className="m-srch-picker" aria-haspopup="menu" aria-label={`${ariaLabel}: ${label}`} onClick={open}>
      <span>{label}</span>
      <Icon name="chevron.up.chevron.down" size={14} strokeWidth={2.2} />
    </button>
  );
}

// ───────────────────────────── sheet ─────────────────────────────

export function AdvancedSearchSheet(props: AdvancedSearchSheetProps) {
  const { dismiss, initialQuery } = props;
  const t = useMT();
  // single instance: also released when the shell unmounts with the sheet still open (logout)
  useEffect(() => {
    presented = true;
    return () => {
      presented = false;
    };
  }, []);
  const locale = useMobileLocale();
  const [c] = useState<AdvController>(() => createAdvController(initialQuery ?? ''));
  useEffect(() => {
    c.start();
    return () => c.dispose();
  }, [c]);
  const s = useStore(c.store);
  // prefetch the filters' scope (servers / channels / authors) while the user types
  useQuery<ScopeOut>(scopeQuery);

  const inputRef = useRef<HTMLInputElement>(null);
  const empty = isEmptySearch(s);
  const filtersActive = activeFilterCount(s) > 0;

  const openFilters = () => {
    inputRef.current?.blur();
    present.presentSheet((ctx) => <AdvancedFiltersSheet {...ctx} controller={c} />);
  };

  const jump = (hit: GlobalMessageHit) => {
    void present.dismissAll();
    mobileNav.navigate({
      name: 'chat',
      chatId: hit.chat_id,
      title: hit.chat_name,
      groupId: hit.group_id,
      jumpTo: { messageId: hit.id, createdAt: hit.created_at },
    });
  };

  // ── results ──
  let results;
  if (empty) {
    results = <div className="m-srch-center">{t('search.advancedHint')}</div>;
  } else if (!s.hits.length && (s.isFetching || s.pending)) {
    results = (
      <div className="m-srch-center">
        <Spinner />
      </div>
    );
  } else if (!s.hits.length) {
    results = <div className="m-srch-center">{t('search.noResults')}</div>;
  } else {
    results = <ResultsList c={c} groupBy={s.groupBy} hits={s.hits} query={s.q} locale={locale} onJump={jump} />;
  }

  return (
    <SheetScreen
      title={t('search.advancedTitle')}
      scroll={false}
      leading={<BarButton icon="xmark" ariaLabel={t('common.close')} onPress={() => void dismiss()} />}
      trailing={
        <BarButton
          icon={<FilterCircleGlyph />}
          ariaLabel={t('search.filtersTitle')}
          dot={filtersActive}
          onPress={openFilters}
        />
      }
    >
      <div className="m-srch-fill">
        <CordSearchField
          style={{ margin: '12px 12px 0', flex: 'none' }}
          value={s.q}
          onChange={(v) => c.update({ q: v })}
          placeholder={t('search.advancedPlaceholder')}
          loading={s.isFetching}
          autoFocus
          inputRef={inputRef}
          onSubmit={() => inputRef.current?.blur()}
        />
        <div className="m-srch-sortrow">
          <MenuPicker<SearchSort>
            ariaLabel={t('search.filterSort')}
            value={s.sort}
            options={[
              { value: 'relevance', label: t('search.sortRelevance') },
              { value: 'newest', label: t('search.sortNewest') },
              { value: 'oldest', label: t('search.sortOldest') },
            ]}
            onChange={(v) => c.update({ sort: v })}
          />
          <MenuPicker<GroupBy>
            ariaLabel={t('search.filterGroupBy')}
            value={s.groupBy}
            options={[
              { value: 'none', label: t('search.groupNone') },
              { value: 'chat', label: t('search.groupByChat') },
            ]}
            onChange={(v) => c.setGroupBy(v)}
          />
        </div>
        <div className="m-srch-results">{results}</div>
      </div>
    </SheetScreen>
  );
}

// ───────────────────────────── results list ─────────────────────────────

function ResultsList({
  c,
  groupBy,
  hits,
  query,
  locale,
  onJump,
}: {
  c: AdvController;
  groupBy: GroupBy;
  hits: GlobalMessageHit[];
  query: string;
  locale: string;
  onJump: (hit: GlobalMessageHit) => void;
}) {
  const t = useMT();
  const isFetchingNext = useStore(c.store, (s) => s.isFetchingNext);
  const hasNext = useStore(c.store, (s) => s.hasNext);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // client-side grouping (first-appearance order)
  const groups: { key: string; label: string; hits: GlobalMessageHit[] }[] = [];
  if (groupBy !== 'chat') groups.push({ key: 'all', label: '', hits });
  else {
    const map = new Map<string, GlobalMessageHit[]>();
    for (const h of hits) {
      const arr = map.get(h.chat_id);
      if (arr) arr.push(h);
      else map.set(h.chat_id, [h]);
    }
    for (const [cid, list] of map) groups.push({ key: cid, label: `#${list[0].chat_name} · ${list[0].group_name}`, hits: list });
  }

  // infinite scroll: load the next page when the end of the list comes near
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const el = sentinelRef.current;
    if (!root || !el || !hasNext || isFetchingNext) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) c.loadNext();
      },
      { root, rootMargin: '0px 0px 200px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [c, hasNext, isFetchingNext, hits.length]);

  return (
    <div
      className="m-srch-scroll"
      ref={scrollRef}
      onScroll={(e) => {
        // fallback for the observer: near the end of the list → next page (loadNext is guarded)
        const el = e.currentTarget;
        if (hasNext && !isFetchingNext && el.scrollHeight - el.scrollTop - el.clientHeight < 200) c.loadNext();
      }}
    >
      <PlainList>
        {groups.map((g) => (
          <ListSection key={g.key} header={g.label || undefined}>
            {g.hits.map((h) => (
              <Row key={h.id} onPress={() => onJump(h)}>
                <ResultCard hit={h} query={query} locale={locale} />
              </Row>
            ))}
          </ListSection>
        ))}
        {isFetchingNext ? (
          <Row bg="clear" separator={false} className="is-center">
            <Spinner />
          </Row>
        ) : !hasNext && hits.length >= PAGE_SIZE ? (
          <Row bg="clear" separator={false}>
            <div className="m-srch-footer">{t('search.endOfResults')}</div>
          </Row>
        ) : null}
      </PlainList>
      <div ref={sentinelRef} className="m-srch-sentinel" aria-hidden />
    </div>
  );
}
