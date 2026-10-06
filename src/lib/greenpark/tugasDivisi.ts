/**
 * TUGAS PER DIVISI — papan kanban diisi dari sumber asli tiap divisi.
 *
 * Papan tugas pusat di auth (`/api/board`) adalah tempat orang menulis kartu
 * dengan tangan, dan di banyak divisi ia memang kosong. Pekerjaan yang
 * sesungguhnya hidup di backend masing-masing, dengan bentuk dan istilahnya
 * sendiri:
 *
 *   legalpermit  alur lahan      langkah perizinan per lahan ("Cek SHM", "Cek Zonasi")
 *   perencanaan  deliverable     gambar kerja per unit, dengan tenggat dua sisi
 *   teknik       ceklis progres  unit bangunan beserta persen penyelesaiannya
 *   marketing    alur konten     satu konten berjalan dari brief sampai distribusi
 *
 * Modul ini menerjemahkan keempatnya ke satu bentuk `Task` yang sudah dipahami
 * papan kanban, tanpa papan itu perlu tahu asalnya.
 *
 * SATU KETERBATASAN YANG HARUS DIKETAHUI DI MUKA: tidak satu pun dari keempat
 * sumber menyimpan username auth pada butir kerjanya. Legal tidak punya medan
 * penanggung jawab sama sekali; `pic` di perencanaan kosong untuk seluruh 186
 * baris; teknik menandai unit, bukan orang; dan `created_by` di marketing berupa
 * angka id, bukan username. Karena itu kartu dari sini TIDAK BERPEMILIK, dan
 * tidak mendudukkan siapa pun di meja. Memaksakan tebakan nama akan membuat
 * orang yang salah terlihat sedang mengerjakan sesuatu — lebih buruk daripada
 * kartu tanpa nama.
 */
import type { Task, TaskStatus } from '@/types/hermes'

/** Alamat backend tiap divisi di dalam jaringan Docker. Nama layanan, bukan
 *  localhost: wadah-wadah itu tidak semuanya membuka port ke host. */
const BASIS: Record<string, string> = {
  legalpermit: process.env.GP_LEGALPERMIT || 'http://gp-legalpermit:8081',
  perencanaan: process.env.GP_PERENCANAAN || 'http://gp-perencanaan:8082',
  teknik: process.env.GP_TEKNIK || 'http://gp-teknik:8083',
  marketing: process.env.GP_MARKETING || 'http://gp-marketing:8086',
}

/** Divisi yang punya sumber tugasnya sendiri di sini. */
export function punyaSumberSendiri(divisi: string): boolean {
  return divisi in BASIS
}

/**
 * Batas jumlah kartu per divisi.
 *
 * Bukan penghematan, melainkan syarat agar papannya berguna. Teknik punya 329
 * unit; kalau satu TAHAP jadi satu kartu, jumlahnya 19.740 — dan papan dengan
 * dua puluh ribu kartu sama tidak terbacanya dengan papan kosong. Jadi satu unit
 * = satu kartu, dan jumlahnya tetap dibatasi.
 */
const BATAS = 120

/**
 * Batas PER KOLOM, bukan hanya total.
 *
 * Batas total saja ternyata tidak cukup: 298 dari 329 unit Teknik berada di 0%,
 * jadi pemotongan global mengisi papan dengan 120 kartu TODO dan tidak
 * menyisakan tempat untuk satu pun kolom lain -- papan yang terbaca seperti
 * tidak ada yang pernah selesai. Membatasi tiap kolom membuat seluruh kolom
 * terwakili, dan itulah gunanya papan.
 */
const BATAS_KOLOM = 30

function batasiPerKolom(tugas: Task[]): Task[] {
  const dipakai = new Map<string, number>()
  const out: Task[] = []
  for (const t of tugas) {
    const n = dipakai.get(t.status) ?? 0
    if (n >= BATAS_KOLOM) continue
    dipakai.set(t.status, n + 1)
    out.push(t)
  }
  return out
}

async function ambil<T>(url: string, token: string): Promise<T | null> {
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    // Satu backend yang mati tidak boleh mengosongkan seluruh papan: pemanggil
    // menerima null dan memutuskan sendiri.
    return null
  }
}

/* ------------------------------------------------------------ legalpermit -- */

type KartuLangkah = {
  step_id: number
  project_name?: string
  code?: string
  name?: string
  status?: string
  board_status?: string
  due_date?: string
  overdue?: boolean
  members?: string[]
  checklist_total?: number
  checklist_done?: number
}

/** `board_status` sudah berupa istilah papan, jadi diteruskan apa adanya —
 *  dengan satu jaring pengaman untuk nilai yang belum dikenal. */
function statusLangkah(s?: string): TaskStatus {
  switch ((s || '').toLowerCase()) {
    case 'done':
      return 'done'
    case 'progress':
    case 'running':
      return 'running'
    case 'review':
      return 'review'
    case 'blocked':
      return 'blocked'
    // step-board memakai `pending` untuk langkah yang belum dikerjakan.
    case 'pending':
      return 'todo'
    default:
      return 'todo'
  }
}

async function tugasLegal(token: string): Promise<Task[]> {
  // `step-board`, bukan `board-steps`. Keduanya ada dan namanya nyaris sama,
  // tetapi yang ini membawa `overdue`, hitungan ceklis, dan medan `members`.
  // Gerbangnya juga lebih ketat (RequirePermitCollab), jadi akun layanan tanpa
  // peran di legalpermit akan ditolak -- dan di situlah cadangan ke
  // `board-steps` dipakai, bukan papan kosong yang terbaca seperti tidak ada
  // pekerjaan.
  const utama = await ambil<{ cards?: KartuLangkah[] }>(
    `${BASIS.legalpermit}/api/xdiv/step-board`,
    token,
  )
  if (utama?.cards) return utama.cards.slice(0, BATAS).map(kartuDariLangkah)

  const cadangan = await ambil<{ steps?: KartuLangkah[] }>(
    `${BASIS.legalpermit}/api/xdiv/board-steps`,
    token,
  )
  return (cadangan?.steps ?? []).slice(0, BATAS).map(kartuDariLangkah)
}

function kartuDariLangkah(s: KartuLangkah): Task {
  const ceklis =
    s.checklist_total && s.checklist_total > 0
      ? `ceklis ${s.checklist_done ?? 0}/${s.checklist_total}`
      : ''
  return {
    id: `legal-${s.step_id}`,
    title: `${s.code ? s.code + ' · ' : ''}${s.name || 'Langkah'}`,
    status: statusLangkah(s.board_status ?? s.status),
    // `members` ADA di muatannya tetapi kosong di seluruh 136 kartu hari ini.
    // Tetap dibaca: begitu orang mulai mengisinya, kartunya langsung
    // berpemilik tanpa perlu kode baru.
    assignee: (s.members ?? [])[0] ?? null,
    priority: s.overdue || (s.due_date ? Date.parse(s.due_date) < Date.now() : false) ? 1 : 0,
    body:
      [s.project_name && `Lahan: ${s.project_name}`, ceklis]
        .filter(Boolean)
        .join(' · ') || undefined,
    origin: { kind: 'manual' },
  }
}

/* ------------------------------------------------------------ perencanaan -- */

type Deliverable = {
  taskId?: number | string
  projectName?: string
  gp?: string
  category?: string
  group?: string
  deliverable?: string
  /** Username auth orang yang bertanggung jawab. Kosong di 66 dari 113 baris. */
  pic?: string
  output?: string
  status?: string
}

async function tugasPerencanaan(token: string): Promise<Task[]> {
  // `/api/xdiv/deliverables`, bukan `/api/workdrawings`. Keduanya menjawab 200,
  // tetapi yang pertama memang benda yang pemilik sebut "deliverable": judulnya
  // nama keluaran ("Siteplan teknis"), dan `pic`-nya USERNAME AUTH -- bukan
  // medan kosong seperti pada gambar kerja, yang pic-nya kosong di 186 baris.
  const j = await ambil<{ items?: Deliverable[] }>(
    `${BASIS.perencanaan}/api/xdiv/deliverables`,
    token,
  )
  return (j?.items ?? []).slice(0, BATAS).map((d, i) => {
    const st = (d.status || '').toLowerCase()
    const status: TaskStatus =
      st === 'done' ? 'done' : st === 'progress' || st === 'running' ? 'running' : 'todo'
    return {
      id: `plan-${d.taskId ?? i}`,
      title: d.deliverable || `Deliverable ${d.taskId ?? i}`,
      status,
      // Inilah satu-satunya dari empat sumber yang benar-benar menamai orangnya
      // dengan username auth, jadi kartunya bisa mendudukkan orang di meja.
      assignee: d.pic || null,
      priority: 0,
      body:
        [d.projectName && `Proyek: ${d.projectName}`, d.group, d.output]
          .filter(Boolean)
          .join(' · ') || undefined,
      origin: { kind: 'manual' },
    }
  })
}

/* ----------------------------------------------------------------- teknik -- */

type UnitProgres = {
  id: number | string
  noInduk?: string
  project?: string
  blok?: string
  progresTotal?: number
  /** Uraian yang sudah tercentang, DIKUNCI NAMA uraian.
   *
   *  Hanya berisi kunci bernilai true: 3.890 entri di data nyata, NOL di
   *  antaranya false. Jadi membagi dengan Object.keys(stages).length selalu
   *  menghasilkan 100% -- diam-diam, tanpa satu pun galat. Pembaginya wajib
   *  katalog uraian, bukan isi map ini. */
  stages?: Record<string, boolean>
}

/** Satu uraian pekerjaan di katalog Teknik. */
type UraianKerja = {
  name?: string
  weight?: number
  /** 'unit' atau 'infra'. Kosong dibaca sebagai 'unit' (data lama). */
  lingkup?: string
}

async function tugasTeknik(token: string): Promise<Task[]> {
  const [a, katalog] = await Promise.all([
    ambil<UnitProgres[]>(`${BASIS.teknik}/api/progress-units`, token),
    ambil<UraianKerja[]>(`${BASIS.teknik}/api/xdiv/construction-stages`, token),
  ])
  const semua = a ?? []

  // Hanya uraian berlingkup unit. 24 dari 116 uraian berlingkup infra dan
  // punya daftar 100%-nya sendiri; mencampurnya membuat persen tiap rumah
  // mengecil, atau justru melewati 100 kalau bobot infra ikut dijumlahkan.
  const uraianUnit = (katalog ?? []).filter((u) => (u.lingkup || 'unit') !== 'infra')
  const bobot = new Map<string, number>()
  for (const u of uraianUnit) if (u.name) bobot.set(u.name, u.weight ?? 0)
  // Jumlah bobotnya 100,001 -- bukan tepat 100. Jadi harus DIBAGI total, bukan
  // dijumlahkan mentah, supaya angkanya sama dengan halaman Cek List Progres.
  const totalBobot = [...bobot.values()].reduce((x, y) => x + y, 0)

  /** Persen kemajuan satu unit, dihitung -- bukan dibaca dari progresTotal.
   *
   *  progresTotal melaporkan 0 untuk 30 unit yang sudah punya 30-60 centang;
   *  memakainya membuat kolom DIKERJAKAN permanen kosong. Kalau katalognya
   *  tidak terjangkau, barulah progresTotal dipakai sebagai cadangan. */
  const persen = (u: UnitProgres): number => {
    if (totalBobot <= 0) return u.progresTotal ?? 0
    let kena = 0
    for (const [nama, dicentang] of Object.entries(u.stages ?? {})) {
      if (dicentang) kena += bobot.get(nama) ?? 0
    }
    return (kena / totalBobot) * 100
  }
  // Yang sedang berjalan didahulukan, lalu yang belum mulai, lalu yang selesai.
  // Tanpa urutan ini, pemotongan di BATAS akan membuang justru unit yang sedang
  // dikerjakan dan menyisakan ratusan unit yang belum disentuh.
  const nilai = (u: UnitProgres) => {
    const p = persen(u)
    return p > 0 && p < 100 ? 0 : p <= 0 ? 1 : 2
  }
  return [...semua]
    .sort((x, y) => nilai(x) - nilai(y))
    // TIDAK dipotong di sini: pemotongan dilakukan per kolom di pintu keluar,
    // supaya unit yang sudah 100% tetap kebagian tempat meski jumlahnya kalah
    // jauh dari yang masih 0%.
    .map((u) => {
      const p = persen(u)
      // 99,9% dibulatkan ke 100 oleh pembagian bobot yang totalnya 100,001;
      // ambang 99,5 menghindari unit lengkap tersangkut di DIKERJAKAN selamanya.
      const status: TaskStatus = p >= 99.5 ? 'done' : p > 0 ? 'running' : 'todo'
      return {
        id: `teknik-${u.id}`,
        title: [u.project, u.blok, u.noInduk].filter(Boolean).join(' · ') || `Unit ${u.id}`,
        status,
        assignee: null,
        priority: 0,
        body:
          `Progres ${Math.round(p)}%` +
          (u.progresTotal != null && Math.abs((u.progresTotal ?? 0) - p) > 1
            ? ` (progresTotal melaporkan ${Math.round(u.progresTotal ?? 0)}%)`
            : ''),
        origin: { kind: 'manual' },
      }
    })
}

/* -------------------------------------------------------------- marketing -- */

type ButirKonten = {
  id: number
  title?: string
  alur?: string
  project?: string
  stage?: string
  current_step_name?: string
}

/** Tahap alur konten: brief -> produksi -> review -> approval -> distribusi -> done. */
function statusKonten(s?: string): TaskStatus {
  switch ((s || '').toLowerCase()) {
    case 'done':
      return 'done'
    case 'review':
    case 'approval':
      return 'review'
    case 'produksi':
    case 'distribusi':
      return 'running'
    default:
      return 'todo'
  }
}

async function tugasMarketing(token: string): Promise<Task[]> {
  const a = await ambil<ButirKonten[]>(`${BASIS.marketing}/api/work-items`, token)
  return (a ?? []).slice(0, BATAS).map((w) => ({
    id: `konten-${w.id}`,
    title: w.title || `Konten ${w.id}`,
    status: statusKonten(w.stage),
    assignee: null,
    priority: 0,
    body: [w.project && `Proyek: ${w.project}`, w.current_step_name].filter(Boolean).join(' — ') || undefined,
    origin: { kind: 'manual' },
  }))
}

/* ------------------------------------------------------------------ pintu -- */

/**
 * Kartu papan untuk satu divisi, dari sumber aslinya.
 *
 * Mengembalikan `null` — bukan larik kosong — bila divisi itu tidak punya sumber
 * sendiri di sini. Bedanya penting: null berarti "pakai papan pusat", sedangkan
 * larik kosong berarti "sumbernya ada dan memang sedang tidak ada pekerjaan".
 */
export async function tugasUntukDivisi(divisi: string, token: string): Promise<Task[] | null> {
  switch (divisi) {
    case 'legalpermit':
      return batasiPerKolom(await tugasLegal(token))
    case 'perencanaan':
      return batasiPerKolom(await tugasPerencanaan(token))
    case 'teknik':
      return batasiPerKolom(await tugasTeknik(token))
    case 'marketing':
      return batasiPerKolom(await tugasMarketing(token))
    default:
      return null
  }
}
