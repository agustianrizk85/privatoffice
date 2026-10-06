'use client'

import { create } from 'zustand'
import type { Agent, ArchivedMeeting, Meeting, Task } from '@/types/hermes'
import { fetchJson } from './api'

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_MS || 4000)

type State = {
  tasks: Task[]
  agents: Agent[]
  meeting: Meeting | null
  meetingConfigured: boolean
  /** Archived meetings on disk, newest first. */
  meetingHistory: ArchivedMeeting[]
  /** Id of the archived transcript currently open, if any. */
  meetingArchive: { id: string; body: string } | null
  loading: boolean
  error: string | null
  view: '3d' | '2d' | 'sprite'
  peekDesk: number | null
  selectedAgent: string | null
  /** Task opened from the 3D board or the 2D board. */
  openTaskId: string | null
  newTaskOpen: boolean

  load: () => Promise<void>
  setView: (v: '3d' | '2d' | 'sprite') => void
  setPeek: (desk: number | null) => void
  openTask: (taskId: string | null) => void
  select: (name: string | null) => void
  setNewTaskOpen: (v: boolean) => void
  refreshMeeting: () => Promise<void>
}

/**
 * Divisi yang diminta lewat ?divisi=teknik di URL.
 *
 * Dipakai supaya dashboard bisa menautkan langsung ke ruangan satu divisi.
 * Dibaca tiap penyegaran, bukan sekali saat modul dimuat: pengguna bisa
 * mengganti divisi dengan menyunting URL tanpa memuat ulang halaman.
 */
function divisiDariURL(): string {
  if (typeof window === 'undefined') return ''
  return (new URLSearchParams(window.location.search).get('divisi') || '').trim().toLowerCase()
}

export const useOffice = create<State>((set) => ({
  tasks: [],
  agents: [],
  meeting: null,
  meetingConfigured: false,
  meetingHistory: [],
  meetingArchive: null,
  loading: true,
  error: null,
  view: '3d',
  peekDesk: null,
  selectedAgent: null,
  openTaskId: null,
  newTaskOpen: false,

  async load() {
    const res = await fetchJson<{ tasks?: Task[]; agents?: Agent[] }>(      `/api/hermes/tasks${divisiDariURL() ? `?divisi=${encodeURIComponent(divisiDariURL())}` : ''}`, {
      cache: 'no-store',
    })
    if (!res.ok || !res.data) {
      set({ error: res.error || 'gagal memuat papan', loading: false })
      return
    }
    // Penyaring divisi dibaca dari URL dan diterapkan DI SINI, satu titik, supaya
    // adegan 3D, panel, dan hitungan di kepala layar tidak pernah berbeda isi.
    //
    // Disaring di klien, bukan di server: GREENPARK_DIVISI adalah konstanta
    // tingkat modul, dan menjadikannya per-permintaan berarti dua tab dengan
    // divisi berbeda saling menimpa penyaring satu sama lain.
    const divisi = divisiDariURL()
    const semua = res.data.agents || []
    // Disaring menurut KEANGGOTAAN, bukan divisi rumah: seorang direktur adalah
    // anggota Teknik meskipun ruangannya di divisi lain, dan "buka ruangan
    // Teknik" semestinya memperlihatkannya.
    const agents = divisi
      ? semua.filter((a) => (a.divisiSemua || []).includes(divisi) || (a.role || '').toLowerCase() === divisi)
      : semua
    set({ tasks: res.data.tasks || [], agents, error: null, loading: false })
  },

  async refreshMeeting() {
    // A blip here must not clear the panel: keep the last known meeting and say
    // nothing, because this polls every few seconds and an error banner that
    // flickers on every dropped packet is worse than silence.
    const res = await fetchJson<{
      configured?: boolean
      live?: Meeting[]
      archived?: ArchivedMeeting[]
    }>('/api/hermes/meeting', { cache: 'no-store' })
    if (!res.ok || !res.data) return
    const d = res.data
    // `live` are meetings in this process; `archived` are the transcripts on disk
    // from this and earlier runs. The picker needs both.
    const list: Meeting[] = d.live || []
    // Only a live meeting may pin agents to the conference table. A finished or
    // failed one still belongs in the panel for its transcript, but the office
    // floor must let those avatars go.
    const active = list.find((m) => m.state === 'queued' || m.state === 'running') ?? null
    set({
      meeting: active ?? list[0] ?? null,
      meetingConfigured: !!d.configured,
      meetingHistory: d.archived || [],
    })
  },

  setView: (view) => set({ view }),
  setPeek: (peekDesk) => set({ peekDesk }),
  openTask: (openTaskId) => set({ openTaskId }),
  select: (selectedAgent) => set({ selectedAgent }),
  setNewTaskOpen: (newTaskOpen) => set({ newTaskOpen }),
}))

/** Poll the board; returns a stop function. */
export function startPolling() {
  let stopped = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    if (stopped || running) return
    if (document.hidden) return schedule()
    running = true
    try {
      await Promise.all([useOffice.getState().load(), useOffice.getState().refreshMeeting()])
    } finally {
      running = false
      schedule()
    }
  }
  const schedule = () => {
    if (!stopped) timer = setTimeout(tick, POLL_MS)
  }
  const onVisibility = () => {
    if (!document.hidden) {
      clearTimeout(timer)
      void tick()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  void tick()
  return () => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
