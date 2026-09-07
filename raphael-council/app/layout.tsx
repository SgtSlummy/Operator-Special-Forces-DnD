import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Raphael’s Council',
  description: 'A persistent-world fantasy campaign guided by Raphael and an equal agent council.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
