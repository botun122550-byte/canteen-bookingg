import { Prompt } from 'next/font/google'
import './globals.css'

const prompt = Prompt({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

export const metadata = {
  title: 'จองโต๊ะโรงอาหาร',
  description: 'จองโต๊ะโรงอาหารมหาวิทยาลัยล่วงหน้า',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body className={prompt.className}>{children}</body>
    </html>
  )
}
