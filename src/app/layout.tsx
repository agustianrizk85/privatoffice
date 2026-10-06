import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Greenpark Office',
  // Keterangan ikut diganti: kantor ini tidak lagi memvisualkan agen AI
  // melainkan karyawan dan papan tugas Greenpark yang sesungguhnya.
  description:
    'Denah kantor 3D Greenpark Group: karyawan per divisi dan papan tugas, langsung dari data.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
