// Filters sheet stacked on the advanced search (cord-ios AdvancedSearchView.swift `AdvancedFiltersSheet`).
// Every control applies live (the advanced search refetches behind it); "Готово" only closes.
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { present, type SheetCtx } from '../../present/PresentationProvider';
import { SheetScreen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import {
  ButtonRow,
  Icon,
  InsetGroupedList,
  ListSection,
  PickerRow,
  Row,
  Stepper,
  SwipeRow,
  ToggleRow,
  type SFSymbol,
} from '../../ui';
import { useMT } from '../../i18n';
import type { ScopeOut } from '../../../api/search';
import { useSavedSearchesStore } from '../../../store/savedSearchesStore';
import {
  buildTree,
  chatChecked,
  groupState,
  isEmptySearch,
  scopeQuery,
  snapshot,
  uuid,
  type AdvController,
  type AdvFilters,
  type DatePreset,
  type TriState,
} from './advancedModel';
import './search.css';

export interface AdvancedFiltersSheetProps extends SheetCtx {
  controller: AdvController;
}

const TRI_ICON: Record<TriState, SFSymbol> = {
  all: 'checkmark.square.fill',
  some: 'minus.square.fill',
  none: 'square',
};

const isHexColor = (s: string | null | undefined): s is string => !!s && /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s.trim());

type BoolKey = {
  [K in keyof AdvFilters]: AdvFilters[K] extends boolean ? K : never;
}[keyof AdvFilters];

const CONTENT: { key: BoolKey; label: string; icon: SFSymbol }[] = [
  { key: 'hasImage', label: 'search.hasImage', icon: 'photo' },
  { key: 'hasFile', label: 'search.hasFile', icon: 'paperclip' },
  { key: 'hasVoice', label: 'search.hasVoice', icon: 'mic' },
  { key: 'hasLink', label: 'search.hasLink', icon: 'link' },
  { key: 'hasPoll', label: 'search.hasPoll', icon: 'chart.bar' },
];
const FLAGS: { key: BoolKey; label: string; icon: SFSymbol }[] = [
  { key: 'pinnedOnly', label: 'search.pinned', icon: 'pin' },
  { key: 'mentionsMe', label: 'search.mentionsMe', icon: 'at' },
  { key: 'isEdited', label: 'search.edited', icon: 'pencil' },
  { key: 'isForwarded', label: 'search.forwarded', icon: 'arrowshape.turn.up.right' },
];

export function AdvancedFiltersSheet({ dismiss, controller: c }: AdvancedFiltersSheetProps) {
  const t = useMT();
  const s = useStore(c.store);
  const { data: scope } = useQuery<ScopeOut>(scopeQuery);
  const saved = useSavedSearchesStore((st) => st.items);
  const addSaved = useSavedSearchesStore((st) => st.add);
  const removeSaved = useSavedSearchesStore((st) => st.remove);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildTree(scope), [scope]);
  const members = (scope?.members ?? []).slice(0, 30);
  const empty = isEmptySearch(s);

  const toggleExpanded = (id: string) =>
    setExpanded((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const saveSearch = () => {
    present.alert({
      title: t('search.saveSearch'),
      textField: { placeholder: t('search.savedNamePlaceholder') },
      actions: [
        {
          label: t('common.save'),
          onPress: (value) => {
            const name = value.trim();
            if (!name) return;
            addSaved({ id: uuid(), name, filters: snapshot(c.store.getState()) });
          },
        },
        { label: t('common.cancel'), role: 'cancel' },
      ],
    });
  };

  const sections: ReactNode[] = [];

  // ── saved searches ──
  if (saved.length > 0 || !empty) {
    const saveColor = empty ? 'var(--text-muted)' : 'var(--accent)';
    sections.push(
      <ListSection key="saved" header={t('search.savedSearches')}>
        {saved.map((item) => (
          <SwipeRow key={item.id} actions={[{ icon: 'trash', label: t('chat.delete'), onPress: () => removeSaved(item.id) }]}>
            <Row
              className="m-srch-plainbtn"
              highlight={false}
              leading={<Icon name="bookmark" size={22} color="var(--accent)" />}
              leadingGap={8}
              title={item.name}
              titleLines={1}
              onPress={() => {
                c.apply(item.filters);
                void dismiss();
              }}
            />
          </SwipeRow>
        ))}
        <Row
          icon="plus"
          iconColor={saveColor}
          title={t('search.saveSearch')}
          titleColor={saveColor}
          onPress={empty ? undefined : saveSearch}
          ariaLabel={t('search.saveSearch')}
        />
      </ListSection>,
    );
  }

  // ── servers & channels (tri-state tree with a separate expand chevron) ──
  if (tree.length > 0) {
    sections.push(
      <ListSection key="scope" header={t('search.filterScope')}>
        {tree.flatMap((g) => {
          const open = expanded.has(g.group.id);
          const state = groupState(s, g);
          const rows: ReactNode[] = [
            <Row
              key={`g:${g.group.id}`}
              highlight={false}
              className="m-srch-plainbtn"
              a11yRole="checkbox"
              ariaChecked={state === 'all'}
              onPress={() => c.toggleGroup(g)}
              leading={
                <span className="m-srch-tree-lead">
                  <button
                    type="button"
                    className="m-srch-chev"
                    aria-expanded={open}
                    aria-label={g.group.is_personal ? t('main.saved') : g.group.name}
                    onClick={() => toggleExpanded(g.group.id)}
                  >
                    <Icon name={open ? 'chevron.down' : 'chevron.right'} size={13} strokeWidth={2.4} />
                  </button>
                  <span className="m-srch-check">
                    <Icon name={TRI_ICON[state]} size={22} color={state === 'none' ? 'var(--text-muted)' : 'var(--accent)'} />
                  </span>
                </span>
              }
              leadingGap={8}
              title={g.group.is_personal ? t('main.saved') : g.group.name}
              trailing={<span className="m-srch-count">{g.chats.length}</span>}
            />,
          ];
          if (open) {
            for (const ch of g.chats) {
              const checked = chatChecked(s, g, ch);
              rows.push(
                <Row
                  key={`c:${ch.id}`}
                  highlight={false}
                  className="m-srch-plainbtn"
                  a11yRole="checkbox"
                  ariaChecked={checked}
                  onPress={() => c.toggleChat(g, ch)}
                  leading={
                    <span className="m-srch-chat-lead">
                      <span className="m-srch-check">
                        <Icon
                          name={checked ? 'checkmark.square.fill' : 'square'}
                          size={22}
                          color={checked ? 'var(--accent)' : 'var(--text-muted)'}
                        />
                      </span>
                      {isHexColor(ch.color) && <span className="m-srch-chat-dot" style={{ background: ch.color }} />}
                      <Icon name="number" size={14} color="var(--text-muted)" />
                    </span>
                  }
                  leadingGap={8}
                  title={ch.name}
                  titleColor="var(--text-secondary)"
                />,
              );
            }
          }
          return rows;
        })}
      </ListSection>,
    );
  }

  // ── authors (first 30) ──
  if (members.length > 0) {
    sections.push(
      <ListSection key="authors" header={t('search.filterAuthors')}>
        {members.map((m) => {
          const on = s.fromUserIds.includes(m.id);
          return (
            <Row
              key={m.id}
              a11yRole="checkbox"
              ariaChecked={on}
              onPress={() => c.toggleAuthor(m.id)}
              leading={
                <span className="m-srch-check">
                  <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={22} color={on ? 'var(--accent)' : 'var(--text-muted)'} />
                </span>
              }
              leadingGap={8}
              title={m.display_name || m.username}
              titleColor="var(--text-secondary)"
            />
          );
        })}
      </ListSection>,
    );
  }

  // ── date ──
  sections.push(
    <ListSection key="date" header={t('search.filterDate')}>
      <PickerRow<DatePreset>
        title={t('search.filterDate')}
        value={s.datePreset}
        options={[
          { value: 'any', label: t('search.dateAny') },
          { value: 'today', label: t('search.dateToday') },
          { value: 'week', label: t('search.dateWeek') },
          { value: 'month', label: t('search.dateMonth') },
          { value: 'custom', label: t('search.dateCustom') },
        ]}
        onChange={(v) => c.update({ datePreset: v })}
      />
      {s.datePreset === 'custom' && (
        <>
          <Row>
            <label className="m-srch-daterow">
              <span>{t('search.dateAfter')}</span>
              <input
                type="text"
                value={s.customAfter}
                placeholder="YYYY-MM-DD"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                onChange={(e) => c.update({ customAfter: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </label>
          </Row>
          <Row>
            <label className="m-srch-daterow">
              <span>{t('search.dateBefore')}</span>
              <input
                type="text"
                value={s.customBefore}
                placeholder="YYYY-MM-DD"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                onChange={(e) => c.update({ customBefore: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </label>
          </Row>
        </>
      )}
    </ListSection>,
  );

  // ── content / flags ──
  sections.push(
    <ListSection key="content" header={t('search.filterContent')}>
      {CONTENT.map((x) => (
        <ToggleRow key={x.key} icon={x.icon} title={t(x.label)} checked={s[x.key]} onChange={(v) => c.update({ [x.key]: v } as Partial<AdvFilters>)} />
      ))}
    </ListSection>,
    <ListSection key="flags" header={t('search.filterFlags')}>
      {FLAGS.map((x) => (
        <ToggleRow key={x.key} icon={x.icon} title={t(x.label)} checked={s[x.key]} onChange={(v) => c.update({ [x.key]: v } as Partial<AdvFilters>)} />
      ))}
    </ListSection>,
  );

  // ── length ──
  sections.push(
    <ListSection key="length" header={t('search.filterLength')}>
      <ToggleRow title={t('search.lengthEnabled')} checked={s.lengthEnabled} onChange={(v) => c.update({ lengthEnabled: v })} />
      {s.lengthEnabled && (
        <>
          <Row
            title={`min: ${s.minLength}`}
            titleColor="var(--text-secondary)"
            trailing={
              <Stepper
                ariaLabel={`min: ${s.minLength}`}
                value={s.minLength}
                min={0}
                max={10000}
                step={10}
                onChange={(v) => c.update({ minLength: Math.max(0, v) })}
              />
            }
          />
          <Row
            title={`max: ${s.maxLength}`}
            titleColor="var(--text-secondary)"
            trailing={
              <Stepper
                ariaLabel={`max: ${s.maxLength}`}
                value={s.maxLength}
                min={0}
                max={10000}
                step={10}
                onChange={(v) => c.update({ maxLength: Math.max(0, v) })}
              />
            }
          />
        </>
      )}
    </ListSection>,
  );

  // ── reset ──
  sections.push(
    <ListSection key="reset">
      <ButtonRow title={t('search.resetFilters')} role="destructive" align="center" onPress={() => c.reset()} />
    </ListSection>,
  );

  return (
    <SheetScreen
      title={t('search.filtersTitle')}
      trailing={
        <BarTextButton prominent onPress={() => void dismiss()}>
          {t('common.done')}
        </BarTextButton>
      }
    >
      <InsetGroupedList>{sections}</InsetGroupedList>
    </SheetScreen>
  );
}
