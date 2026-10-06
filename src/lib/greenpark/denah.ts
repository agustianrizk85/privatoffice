/**
 * RENCANA DENAH — berapa ruangan, dan berapa meja di tiap ruangan.
 *
 * Dihitung dari roster, bukan ditulis tangan: jumlah meja mengikuti jumlah
 * anggota divisi, sehingga ruangan yang isinya empat belas orang memang terlihat
 * empat belas kali lebih sibuk daripada yang isinya tiga.
 *
 * Modul ini SENGAJA bebas three.js. Ia dipakai dua tempat yang berbeda sifatnya:
 * rute API di server (yang tidak boleh menyentuh WebGL) dan pembangun adegan di
 * peramban. Menaruh aritmetikanya di satu tempat membuat keduanya tidak pernah
 * bisa menyimpang — dan "meja ke-7 ruang Teknik" berarti hal yang sama di
 * kedua sisi.
 */

/**
 * Enam divisi operasional, dalam urutan alur kerja yang sebenarnya:
 * lahan diizinkan dulu (Legal), dirancang (Perencanaan), dibangun (Teknik),
 * dipasarkan (Marketing), dijual (Sales), dibukukan (Keuangan).
 *
 * Daftarnya DITULIS di sini, bukan diambil dari /api/departments. Katalog
 * departemen di auth tersimpan di basis data dan ikut memuat sisa data lama --
 * `kpr` yang departemennya sudah dicabut, `departemen`, `digitalmarketing` --
 * sehingga mengambilnya mentah-mentah menghasilkan sebelas ruangan untuk enam
 * divisi yang benar-benar ada.
 */
export const DIVISI_INTI = [
  { kunci: 'legalpermit', nama: 'LEGAL & PERIZINAN' },
  { kunci: 'perencanaan', nama: 'PERENCANAAN' },
  { kunci: 'teknik', nama: 'TEKNIK' },
  { kunci: 'marketing', nama: 'MARKETING' },
  { kunci: 'sales', nama: 'SALES' },
  { kunci: 'finance', nama: 'KEUANGAN' },
  // SDM dan CSO menyusul: keduanya divisi sungguhan, hanya saja pendukung dan
  // bukan bagian dari alur enam langkah di atas. Tanpa ruangan, kepala kedua
  // departemen itu berdiri di kantornya sendiri tanpa meja.
  { kunci: 'sdm', nama: 'SDM' },
  { kunci: 'cso', nama: 'CSO' },
] as const

export type KunciDivisi = (typeof DIVISI_INTI)[number]['kunci']

export type RuangDivisi = {
  kunci: string
  nama: string
  /** Jumlah meja = jumlah anggota divisi ini. */
  meja: number
  /** Indeks meja global pertama milik ruangan ini. */
  mejaAwal: number
}

export type RencanaDenah = {
  ruang: RuangDivisi[]
  totalMeja: number
}

/** Paling sedikit meja dalam satu ruangan, supaya ruangan kosong tidak
 *  menyusut jadi lemari. */
const MEJA_MINIMUM = 3

/**
 * Susun rencana dari daftar keanggotaan (satu baris per pasangan orang-divisi,
 * persis seperti yang dikirim `GET /api/board`).
 *
 * Satu orang dihitung sekali per divisi: nama yang sama muncul dua kali dalam
 * satu divisi -- mungkin karena dua peran -- tidak boleh menambah meja.
 */
export function susunDenah(
  keanggotaan: { username: string; division?: string }[],
): RencanaDenah {
  const anggota = new Map<string, Set<string>>()
  for (const d of DIVISI_INTI) anggota.set(d.kunci, new Set())
  for (const k of keanggotaan) {
    if (!k.username || !k.division) continue
    anggota.get(k.division.toLowerCase())?.add(k.username)
  }

  let jalan = 0
  const ruang = DIVISI_INTI.map((d) => {
    const meja = Math.max(MEJA_MINIMUM, anggota.get(d.kunci)?.size ?? 0)
    const r: RuangDivisi = { kunci: d.kunci, nama: d.nama, meja, mejaAwal: jalan }
    jalan += meja
    return r
  })

  return { ruang, totalMeja: jalan }
}

/**
 * Meja global untuk satu orang di ruangan divisinya.
 *
 * Dikembalikan `null` bila divisinya bukan salah satu dari enam, atau bila
 * ruangannya sudah penuh. Penuh memang mungkin terjadi: jumlah meja mengikuti
 * KEANGGOTAAN, sedangkan yang didudukkan hanya orang yang RUMAHNYA di situ --
 * jadi ruangan tidak akan pernah kekurangan, tapi memulangkan null tetap lebih
 * baik daripada menaruh orang di meja milik ruangan sebelah.
 */
export function mejaUntuk(
  rencana: RencanaDenah,
  divisi: string | null,
  urutanDiRuangan: number,
): number | null {
  if (!divisi) return null
  const r = rencana.ruang.find((x) => x.kunci === divisi)
  if (!r || urutanDiRuangan >= r.meja) return null
  return r.mejaAwal + urutanDiRuangan
}
