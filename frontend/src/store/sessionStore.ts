// Session store: drafts, attachments, voice presence, audio device preferences.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface VoicePresence {
  channelId: string;
  channelName: string;
  groupId: string;      // для «развернуть» из плавающего виджета
  groupName: string;
  muted: boolean;
  deafened: boolean;
}

export interface VoiceParticipant {
  identity: string;
  name: string;
  image_path: string;
}

interface SessionState {
  // Last opened server/channel — restored on reload
  lastGroupId: string | null;
  lastChannelId: string | null;
  setLastGroup: (groupId: string | null) => void;
  setLastChannel: (channelId: string | null) => void;

  // Drafts: channelId → text
  drafts: Record<string, string>;
  setDraft: (channelId: string, text: string) => void;
  clearDraft: (channelId: string) => void;

  // Attachments: channelId → File[] (in-memory only)
  attachments: Record<string, File[]>;
  addAttachments: (channelId: string, files: File[]) => void;
  removeAttachment: (channelId: string, index: number) => void;
  clearAttachments: (channelId: string) => void;

  // Audio devices (persisted)
  audioInputId: string | null;
  audioOutputId: string | null;
  audioInputGain: number; // 0–3, 1 = normal
  autoMic: boolean; // auto-enable mic when joining voice
  setAudioInput: (id: string | null) => void;
  setAudioOutput: (id: string | null) => void;
  setAudioInputGain: (gain: number) => void;
  setAutoMic: (v: boolean) => void;

  // Voice channel
  voicePresence: VoicePresence | null;
  joinVoice: (channelId: string, channelName: string, groupName: string, groupId: string) => void;
  leaveVoice: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;

  // Voice channel participants (synced from LiveKit)
  voiceParticipants: VoiceParticipant[];
  setVoiceParticipants: (participants: VoiceParticipant[]) => void;

  // Conference start time (from Redis via /api/voice/token)
  callStartedAt: number | null;
  setCallStartedAt: (ts: number) => void;

  // UI flags — управляются из CommandPalette и т.п.
  uiSettingsOpen: boolean;
  uiSettingsTab: string | null;      // 'profile' | 'appearance' | ... (null — оставить дефолт)
  uiCreateServerOpen: boolean;
  openSettings: (tab?: string) => void;
  closeSettings: () => void;
  openCreateServer: () => void;
  closeCreateServer: () => void;

  // Прыжок к сообщению — выставляет CommandPalette, разбирает AppPage
  pendingJumpTo: { chatId: string; messageId: string; createdAt: string } | null;
  setPendingJumpTo: (p: { chatId: string; messageId: string; createdAt: string } | null) => void;

  // Палитра команд (Ctrl+K или кнопка)
  uiPaletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  // Расширенный поиск (открывается из палитры или хоткеем Cmd+Shift+F)
  uiAdvancedSearchOpen: boolean;
  openAdvancedSearch: () => void;
  closeAdvancedSearch: () => void;

  // DM-режим: включён — вместо обычного ChannelSidebar показывается список DM.
  // Выбор DM сохраняет режим, выбор обычной группы — выключает.
  dmMode: boolean;
  setDmMode: (v: boolean) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      // --- Last server/channel ---
      lastGroupId: null,
      lastChannelId: null,
      setLastGroup: (groupId) => set({ lastGroupId: groupId }),
      setLastChannel: (channelId) => set({ lastChannelId: channelId }),

      // --- Drafts ---
      drafts: {},

      setDraft: (channelId, text) =>
        set((state) => ({
          drafts: { ...state.drafts, [channelId]: text },
        })),

      clearDraft: (channelId) =>
        set((state) => {
          const { [channelId]: _, ...rest } = state.drafts;
          return { drafts: rest };
        }),

      // --- Attachments ---
      attachments: {},

      addAttachments: (channelId, files) =>
        set((state) => ({
          attachments: {
            ...state.attachments,
            [channelId]: [...(state.attachments[channelId] ?? []), ...files],
          },
        })),

      removeAttachment: (channelId, index) =>
        set((state) => ({
          attachments: {
            ...state.attachments,
            [channelId]: (state.attachments[channelId] ?? []).filter((_, i) => i !== index),
          },
        })),

      clearAttachments: (channelId) =>
        set((state) => {
          const { [channelId]: _, ...rest } = state.attachments;
          return { attachments: rest };
        }),

      // --- Audio devices ---
      audioInputId: null,
      audioOutputId: null,
      audioInputGain: 1,
      autoMic: true,
      setAudioInput: (id) => set({ audioInputId: id }),
      setAudioOutput: (id) => set({ audioOutputId: id }),
      setAudioInputGain: (gain) => set({ audioInputGain: gain }),
      setAutoMic: (v) => set({ autoMic: v }),

      // --- Voice channel ---
      voicePresence: null,

      joinVoice: (channelId, channelName, groupName, groupId) =>
        set({
          voicePresence: { channelId, channelName, groupId, groupName, muted: false, deafened: false },
        }),

      leaveVoice: () => set({ voicePresence: null, voiceParticipants: [], callStartedAt: null }),

      toggleMute: () =>
        set((state) =>
          state.voicePresence
            ? { voicePresence: { ...state.voicePresence, muted: !state.voicePresence.muted } }
            : {}
        ),

      toggleDeafen: () =>
        set((state) =>
          state.voicePresence
            ? { voicePresence: { ...state.voicePresence, deafened: !state.voicePresence.deafened } }
            : {}
        ),

      // --- Voice participants ---
      voiceParticipants: [],
      setVoiceParticipants: (participants) => set({ voiceParticipants: participants }),

      callStartedAt: null,
      setCallStartedAt: (ts: number) => set((state: SessionState) => ({
        callStartedAt: state.callStartedAt === null || ts < state.callStartedAt ? ts : state.callStartedAt,
      })),

      // --- UI flags ---
      uiSettingsOpen: false,
      uiSettingsTab: null,
      uiCreateServerOpen: false,
      openSettings: (tab) => set({ uiSettingsOpen: true, uiSettingsTab: tab ?? null }),
      closeSettings: () => set({ uiSettingsOpen: false, uiSettingsTab: null }),
      openCreateServer: () => set({ uiCreateServerOpen: true }),
      closeCreateServer: () => set({ uiCreateServerOpen: false }),

      pendingJumpTo: null,
      setPendingJumpTo: (p) => set({ pendingJumpTo: p }),

      uiPaletteOpen: false,
      openPalette: () => set({ uiPaletteOpen: true }),
      closePalette: () => set({ uiPaletteOpen: false }),
      togglePalette: () => set((s) => ({ uiPaletteOpen: !s.uiPaletteOpen })),
      uiAdvancedSearchOpen: false,
      openAdvancedSearch: () => set({ uiAdvancedSearchOpen: true }),
      closeAdvancedSearch: () => set({ uiAdvancedSearchOpen: false }),

      dmMode: false,
      setDmMode: (v) => set({ dmMode: v }),
    }),
    {
      name: 'cord-session',
      // Only persist serializable state (exclude File[] attachments)
      partialize: (state) => ({
        lastGroupId: state.lastGroupId,
        lastChannelId: state.lastChannelId,
        audioInputId: state.audioInputId,
        audioOutputId: state.audioOutputId,
        audioInputGain: state.audioInputGain,
        autoMic: state.autoMic,
        drafts: state.drafts,
        voicePresence: state.voicePresence,
      }),
    }
  )
);
