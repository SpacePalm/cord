// Shared data helpers for the groups area.
import { useQuery } from '@tanstack/react-query';
import { groupsApi } from '../../../api/groups';
import { ApiError } from '../../../api/client';
import { useAuthStore } from '../../../store/authStore';
import { groupPermissions, type GroupPermissions } from '../../lib/groupPermissions';
import type { Group, Member } from '../../../types';

/** ['groups'] — same key/config as the desktop AppPage (WS + mutations keep it fresh). */
export function useGroupsQuery() {
  return useQuery<Group[]>({ queryKey: ['groups'], queryFn: groupsApi.list, staleTime: 30_000, retry: 1 });
}

/** Live group object from ['groups'] (rename in settings updates every screen). */
export function useGroup(groupId: string): Group | undefined {
  const { data } = useGroupsQuery();
  return data?.find((g) => g.id === groupId);
}

/** ['group-members', groupId] (API order = joined_at ascending). */
export function useGroupMembers(
  groupId: string,
  opts: { enabled?: boolean; refetchOnMount?: boolean | 'always'; refetchInterval?: number | false } = {},
) {
  return useQuery<Member[]>({
    queryKey: ['group-members', groupId],
    queryFn: () => groupsApi.getMembers(groupId),
    staleTime: 30_000,
    enabled: opts.enabled ?? !!groupId,
    refetchOnMount: opts.refetchOnMount,
    refetchInterval: opts.refetchInterval,
  });
}

/** iOS GroupPermissions with `myRole` from the members list (null until it loads, like iOS). */
export function useGroupPermissions(group: Group | undefined, members: Member[] | undefined): GroupPermissions | null {
  const me = useAuthStore((s) => s.user);
  if (!group) return null;
  const myRole = me ? members?.find((m) => m.user_id === me.id)?.role : undefined;
  return groupPermissions(group, me, myRole ?? null);
}

/** Server `detail` text when the API returned one (iOS `APIError.displayDetail`). */
export function apiDetail(err: unknown): string | null {
  if (err instanceof ApiError && typeof err.detail === 'string' && err.detail.trim()) return err.detail;
  return null;
}

/** iOS `error.userMessage(default:)`: server detail, else the localized default. */
export function userMessage(err: unknown, fallback: string): string {
  return apiDetail(err) ?? fallback;
}

/** Swift `trimmingCharacters(in: .whitespaces)` — spaces/tabs only, newlines kept. */
export function trimSpaces(s: string): string {
  return s.replace(/^[^\S\r\n]+|[^\S\r\n]+$/g, '');
}

/** Copy text; falls back to execCommand where the async clipboard API is unavailable (plain http). */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    document.execCommand('copy');
    ta.remove();
  } catch {
    /* ignore */
  }
}

/** iOS `Color(hexString:)`: a parsable "#rgb" / "#rrggbb" / "#rrggbbaa" colour, else null (→ default tint). */
export function channelTint(color: string | null | undefined): string | null {
  if (!color) return null;
  const s = color.trim();
  return /^#?(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ? (s.startsWith('#') ? s : `#${s}`) : null;
}
