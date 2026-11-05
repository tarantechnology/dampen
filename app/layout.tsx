import type { Metadata, Viewport } from 'next';
import './globals.css';

/**
 * No webfont. The type stack in `globals.css` is the system stack, so on
 * macOS this renders as SF Pro and on Windows as Segoe UI — the interface
 * reads as part of the operating system rather than as a web page.
 */

export const metadata: Metadata = {
  title: 'Dampen',
  description:
    'A Spotify player with one control: how far away the music should sound.',
  applicationName: 'Dampen',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * Applies the saved theme override before first paint, so a user who picked
 * Light on a dark system never sees a black flash. Absent the key, the page
 * follows `prefers-color-scheme`.
 */
const THEME_BOOT = `try{var t=localStorage.getItem("dampen.theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  /*
   * The accent and the `--dampen` macro are written as inline custom
   * properties on <html> after hydration, and the boot script above may set
   * data-theme. Both make the client's <html> attributes legitimately differ
   * from the server's. `suppressHydrationWarning` covers this element only.
   */
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-full bg-bg text-t1">{children}</body>
    </html>
  );
}
