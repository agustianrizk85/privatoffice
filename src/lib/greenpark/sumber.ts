/**
 * SUMBER GREENPARK — mengisi kantor 3D dengan orang dan tugas yang sungguhan.
 *
 * Hermes mengambil seluruh isinya dengan memanggil CLI `hermes` lalu mengurai
 * stdout (lihat `lib/hermes/kanban.ts`). Modul ini menggantikan sumber itu —
 * bukan tampilannya. Adegan 3D, panel, dan rute API tidak tahu-menahu: mereka
 * tetap membaca `Task[]` dan `Agent[]` yang bentuknya sama persis.
 *
 * Satu panggilan cukup. `GET /api/board` di auth Greenpark mengembalikan
 * `lists` (empat kolom status beserta kartunya), `users` (seluruh roster dengan
 * divisi dan jabatan), dan `departments` sekaligus — jadi satu permintaan
 * memberi tugas DAN orangnya, bukan dua.
 *
 * Dinyalakan dengan memasang `GREENPARK_API`. Tanpa env itu modul ini diam
 * sepenuhnya dan Hermes tetap berjalan dengan CLI-nya seperti semula — itu
 * disengaja, supaya pemasangan ini bisa dibatalkan tanpa menyentuh kode.
 *
 * Env yang dibaca:
 *   GREENPARK_API      basis auth, mis. http://gp-auth:8090 (WAJIB; saklarnya)
 *   GREENPARK_TOKEN    token SSO siap pakai (lebih disukai)
 *   GREENPARK_USER     — atau akun layanan…
 *   GREENPARK_PASS     …dan sandinya, kalau token tetap tidak dipasang
 *   GREENPARK_DIVISI   tampilkan satu divisi saja, mis. "teknik" (opsional)
 */
import type { Agent, AgentRole, Task, TaskStatus } from '@/types/hermes'

const BASIS = (process.env.GREENPARK_API || '').replace(/\/+$/, '')
const DIVISI = (process.env.GREENPARK_DIVISI || '').trim().toLowerCase()
const TOKEN_TETAP = (process.env.GREENPARK_TOKEN || '').trim()
const AKUN = process.env.GREENPARK_USER || ''
const SANDI = process.env.GREENPARK_PASS || ''

/** Saklar tunggal. Dipakai `kanban.ts` untuk memilih sumber. */
export function greenparkAktif(): boolean {
  return BASIS !== ''
}

// --- bentuk yang dikirim auth ----------------------------------------------

type GPKartu = {
  id: string
  listId: string
  title: string
  desc?: string
  members?: string[]
  division?: string
  due?: string
  dueDone?: boolean
}

type GPKolom = { id: string; title: string; cards?: GPKartu[] }

type GPOrang = { username: string; name?: string; role?: string; division?: string }

type GPPapan = { lists?: GPKolom[]; users?: GPOrang[] }

/**
 * Empat kolom status tetap di papan Greenpark, dipetakan ke status Hermes.
 *
 * Id tersimpan berbentuk majemuk — `sys-todo@bd-utama` — karena dua papan boleh
 * punya kolom "To Do" tanpa id yang bertabrakan. Jadi yang dicocokkan hanya
 * bagian sebelum `@`; mencocokkan id penuh akan gagal diam-diam begitu ada
 * papan kedua, dan seluruh kartu jatuh ke `todo`.
 */
const KOLOM: Record<string, TaskStatus> = {
  'sys-todo': 'todo',
  'sys-progress': 'running',
  'sys-review': 'review',
  'sys-done': 'done',
}

function statusKolom(listId: string): TaskStatus {
  return KOLOM[listId.split('@')[0]] ?? 'todo'
}

// --- token ------------------------------------------------------------------

let tokenSinggahan: string | null = TOKEN_TETAP || null

/**
 * Token SSO. Token tetap dipakai apa adanya; kalau tidak ada, akun layanan
 * dipakai untuk masuk dan hasilnya disimpan.
 *
 * `paksa` membuang yang tersimpan lebih dulu. Dipanggil saat auth menjawab 401:
 * token Greenpark berumur terbatas, dan tanpa jalan ini kantor akan membeku di
 * data terakhir sampai wadahnya dinyalakan ulang — kegagalan yang terlihat
 * seperti data yang tidak pernah berubah, bukan seperti sesi yang habis.
 */
async function token(paksa = false): Promise<string> {
  if (paksa && !TOKEN_TETAP) tokenSinggahan = null
  if (tokenSinggahan) return tokenSinggahan
  if (!AKUN || !SANDI) {
    throw new Error(
      'Greenpark: tidak ada kredensial — pasang GREENPARK_TOKEN, atau GREENPARK_USER + GREENPARK_PASS.',
    )
  }
  const res = await fetch(`${BASIS}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: AKUN, password: SANDI }),
    cache: 'no-store',
  })
  if (!res.ok) {
    // Sandinya TIDAK ikut dicatat, dan jawaban auth juga tidak: keduanya bisa
    // memuat kredensial, dan log wadah adalah tempat yang dibaca banyak orang.
    throw new Error(`Greenpark: login akun layanan ditolak (HTTP ${res.status})`)
  }
  const j = (await res.json()) as { accessToken?: string }
  if (!j.accessToken) throw new Error('Greenpark: login berhasil tapi tanpa accessToken')
  tokenSinggahan = j.accessToken
  return tokenSinggahan
}

// --- papan ------------------------------------------------------------------

let singgahan: { pada: number; data: GPPapan } | null = null
/**
 * Umur singgahan. Layar Hermes menarik beberapa endpoint tiap 4 detik, dan tiap
 * tarikan memanggil `listTasks` + `listAssignees` + `listProfiles`. Tanpa
 * singgahan, satu putaran layar jadi tiga permintaan HTTP ke auth — yang sama
 * isinya.
 */
const UMUR_MS = 3_000

async function papan(): Promise<GPPapan> {
  const kini = Date.now()
  if (singgahan && kini - singgahan.pada < UMUR_MS) return singgahan.data

  const ambil = async (t: string) =>
    fetch(`${BASIS}/api/board`, {
      headers: { Authorization: `Bearer ${t}` },
      cache: 'no-store',
    })

  let res = await ambil(await token())
  if (res.status === 401) res = await ambil(await token(true))
  if (!res.ok) throw new Error(`Greenpark: GET /api/board gagal (HTTP ${res.status})`)

  const data = (await res.json()) as GPPapan
  singgahan = { pada: kini, data }
  isiPetaOrang(data)
  return data
}

// --- peta orang -------------------------------------------------------------

/**
 * Nama tampil dan divisi per username, diisi tiap kali papan ditarik.
 *
 * Ada dua alasan ini disimpan di modul, bukan dioper sebagai argumen.
 * `roleFor()` milik Hermes bersifat SINKRON dan dipanggil dari dalam
 * `listAgents()`, jadi tidak ada tempat untuk menunggu permintaan HTTP. Dan
 * `listAgents()` selalu berjalan SESUDAH `listTasks()`/`listAssignees()` pada
 * rute yang sama, sehingga peta ini pasti sudah terisi saat dibaca. Kalau
 * ternyata kosong, pembacanya jatuh ke perilaku Hermes yang lama — bukan ke
 * nilai yang salah.
 */
const petaNama = new Map<string, string>()
const petaDivisi = new Map<string, string>()

function isiPetaOrang(p: GPPapan) {
  for (const u of p.users ?? []) {
    if (!u.username) continue
    if (u.name) petaNama.set(u.username, u.name)
    if (u.division) petaDivisi.set(u.username, u.division.toLowerCase())
  }
}

/** Divisi seseorang sebagai peran kantor, atau null bila tidak dikenal. */
export function gpRole(username: string): AgentRole | null {
  if (!greenparkAktif()) return null
  const d = petaDivisi.get(username)
  return (d as AgentRole) || null
}

/** Nama asli orang itu; `null` berarti pakai username apa adanya. */
export function gpDisplay(username: string): string | null {
  if (!greenparkAktif()) return null
  return petaNama.get(username) ?? null
}

/** Benar bila orang ini termasuk divisi yang sedang ditampilkan. */
function dalamDivisi(username: string): boolean {
  if (!DIVISI) return true
  return petaDivisi.get(username) === DIVISI
}

// --- yang dipakai kanban.ts -------------------------------------------------

/**
 * Kartu papan Greenpark sebagai tugas Hermes.
 *
 * `members` boleh berisi lebih dari satu orang, sedangkan `Task.assignee` milik
 * Hermes hanya satu. Yang pertama dipakai — dan itu memang pilihan, bukan
 * kelalaian: meja di lantai kantor hanya bisa ditempati satu orang, jadi kartu
 * berdua tetap harus menunjuk satu kursi.
 */
export async function gpTasks(opts: { includeArchived?: boolean } = {}): Promise<Task[]> {
  const p = await papan()
  const out: Task[] = []
  for (const kolom of p.lists ?? []) {
    const status = statusKolom(kolom.id)
    // Kolom "Selesai" adalah riwayat papan dan bisa panjang sekali. Hermes
    // memakai `includeArchived` untuk membedakan papan yang dilihat dari
    // riwayat penuh, jadi batasnya diikuti di sini juga.
    if (status === 'done' && !opts.includeArchived) continue
    for (const k of kolom.cards ?? []) {
      const pemilik = (k.members ?? []).find((m) => dalamDivisi(m)) ?? null
      if (DIVISI && !pemilik) continue
      out.push({
        id: k.id,
        title: k.title,
        status,
        assignee: pemilik,
        // Papan Greenpark tidak punya prioritas; tenggat yang sudah lewat
        // adalah satu-satunya penanda mendesak yang benar-benar ada.
        priority: k.due && !k.dueDone && Date.parse(k.due) < Date.now() ? 1 : 0,
        body: k.desc || undefined,
        origin: { kind: 'manual' },
      })
    }
  }
  return out
}

/** Roster sebagai daftar penerima tugas, lengkap dengan jumlah tugasnya. */
export async function gpAssignees(): Promise<{ name: string; onDisk: boolean; total: number }[]> {
  const [p, tugas] = await Promise.all([papan(), gpTasks({ includeArchived: true })])
  const jumlah = new Map<string, number>()
  for (const t of tugas) if (t.assignee) jumlah.set(t.assignee, (jumlah.get(t.assignee) ?? 0) + 1)

  return (p.users ?? [])
    .filter((u) => u.username && dalamDivisi(u.username))
    .map((u) => ({
      name: u.username,
      // `onDisk` di Hermes berarti "profil ini sungguh ada", bukan sekadar nama
      // yang tertinggal di sebuah tugas. Setiap orang di roster Greenpark
      // memang ada, jadi selalu benar.
      onDisk: true,
      total: jumlah.get(u.username) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Nama-nama yang boleh menempati kantor. */
export async function gpProfiles(): Promise<string[]> {
  return (await gpAssignees()).map((a) => a.name)
}
