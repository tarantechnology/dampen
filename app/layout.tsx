import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

/**
 * One typeface for the whole app. Inter carries real tabular figures, which
 * every numeric readout in Dampen depends on — a dial whose number changes
 * width while you drag it feels broken. Character comes from wide-tracked
 * uppercase legends (the `.legend` utility), not from a novelty face.
 */
const ui = Inter({
  variable: '--font-ui',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Dampen — muffle your music',
  description:
    'A Spotify player that muffles your music so it recedes behind your attention. One big dial between you and the noise.',
  applicationName: 'Dampen',
};

export const viewport: Viewport = {
  themeColor: '#0b0b0d',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${ui.variable} h-full antialiased`}>
      <body className="min-h-full bg-ground text-ink">{children}</body>
    </html>
  );
}
