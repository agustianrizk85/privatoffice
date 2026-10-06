'use client'

import { useEffect, useRef } from 'react'
import { createScene, type OfficeScene } from '@/lib/office/scene'
import { terapkanDenah } from '@/lib/office/layout'
import { rebuildNav } from '@/lib/office/nav'
import { useOffice } from '@/lib/store'

type Props = { onScene: (s: OfficeScene | null) => void }

export default function Scene3D({ onScene }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<OfficeScene | null>(null)

  const agents = useOffice((s) => s.agents)
  const denah = useOffice((s) => s.denah)
  // Sidik denah: gedung dibangun ULANG hanya kalau susunan ruangan benar-benar
  // berubah. Memakai objek denah sebagai dependensi akan membangun ulang tiap
  // polling empat detik, karena tiap jawaban JSON adalah objek baru.
  const sidikDenah = denah ? JSON.stringify(denah.map((r) => [r.kunci, r.meja])) : ''
  const tasks = useOffice((s) => s.tasks)
  const meeting = useOffice((s) => s.meeting)
  const view = useOffice((s) => s.view)
  const setPeek = useOffice((s) => s.setPeek)
  const select = useOffice((s) => s.select)
  const openTask = useOffice((s) => s.openTask)

  useEffect(() => {
    if (!canvasRef.current || !labelRef.current) return
    // Gedung baru dibangun SETELAH rencana ruangan tiba. Membangunnya lebih dulu
    // dari denah bawaan berarti satu ruangan berisi delapan meja muncul sekejap
    // lalu dibongkar -- dan selama itu nomor meja dari server menunjuk kursi yang
    // belum ada.
    if (!denah || denah.length === 0) return
    // Urutannya mengikat: denah dulu, lalu grid jalan, baru gedung. nav.ts
    // membaca FOOTPRINTS yang baru ditugaskan terapkanDenah(), dan buildOffice
    // membaca keduanya.
    terapkanDenah(denah)
    rebuildNav()
    const scene = createScene(canvasRef.current, labelRef.current, {
      onMonitorClick: (desk) => setPeek(desk),
      onAvatarClick: (name) => select(name),
      onTaskClick: (taskId) => openTask(taskId),
    })
    sceneRef.current = scene
    onScene(scene)
    // E2E/debug handle: lets tests drive picking and read avatar state without
    // guessing canvas pixels. Opt-in so production pages stay clean.
    if (process.env.NEXT_PUBLIC_E2E_HOOK === '1') {
      ;(window as unknown as { __office?: OfficeScene }).__office = scene
    }
    scene.start()

    const parent = canvasRef.current.parentElement!
    const ro = new ResizeObserver(() => scene.resize(parent.clientWidth, parent.clientHeight))
    ro.observe(parent)
    scene.resize(parent.clientWidth, parent.clientHeight)

    return () => {
      ro.disconnect()
      scene.dispose()
      sceneRef.current = null
      onScene(null)
    }
    // Dibangun ulang HANYA saat susunan ruangan berubah -- bukan tiap pembaruan
    // roster, yang masuk lewat syncAgents di bawah tanpa menyentuh gedung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidikDenah])

  // push new rosters in without rebuilding the world
  useEffect(() => {
    sceneRef.current?.syncAgents(agents)
  }, [agents])

  useEffect(() => {
    sceneRef.current?.setTasks(tasks)
  }, [tasks])

  useEffect(() => {
    sceneRef.current?.setMeeting(meeting)
  }, [meeting])

  useEffect(() => {
    if (view === '3d') sceneRef.current?.start()
    else sceneRef.current?.stop()
  }, [view])

  // relay new meeting turns into speech bubbles
  const said = useRef(0)
  useEffect(() => {
    const s = sceneRef.current
    if (!s || !meeting) return
    const turns = meeting.turns || []
    for (let i = said.current; i < turns.length; i++) {
      const t = turns[i]
      if (t.kind === 'minutes') {
        s.say(meeting.moderator, 'notulen siap — lihat panel')
      } else {
        const label = t.kind === 'opening' ? 'membuka rapat' : t.text.slice(0, 140)
        s.say(t.speaker, label, 9000)
      }
    }
    said.current = turns.length
    if (!turns.length) said.current = 0
  }, [meeting])

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div ref={labelRef} className="pointer-events-none absolute inset-0" />
    </div>
  )
}
