import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /*
   * Pin the workspace root.
   *
   * There is a stray pnpm-lock.yaml in a parent directory outside this repo.
   * Turbopack treats that as the workspace root, which puts app/globals.css
   * outside the root — so the `*.css` rule never matches it, the
   * @tailwindcss/turbopack loader never runs, and globals.css is emitted as
   * ~5.7 kB of passthrough instead of ~59 kB of compiled Tailwind. The pages
   * then render completely unstyled, with no error anywhere.
   *
   * Declaring the loader rule explicitly alongside the pinned root is what
   * actually makes it stick.
   */
  turbopack: {
    root: path.dirname(new URL(import.meta.url).pathname),
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
  images: {
    // Spotify serves artwork from several CDN hosts. Album/playlist art is on
    // i.scdn.co, auto-generated playlist mosaics on mosaic.scdn.co, and user
    // avatars / editorial art on the spotifycdn.com hosts.
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co' },
      { protocol: 'https', hostname: 'mosaic.scdn.co' },
      { protocol: 'https', hostname: 'image-cdn-ak.spotifycdn.com' },
      { protocol: 'https', hostname: 'image-cdn-fa.spotifycdn.com' },
      { protocol: 'https', hostname: 'thisis-images.scdn.co' },
      { protocol: 'https', hostname: 'seed-mix-image.spotifycdn.com' },
      { protocol: 'https', hostname: 'seeded-session-images.scdn.co' },
      { protocol: 'https', hostname: 'daily-mix.scdn.co' },
      { protocol: 'https', hostname: 'lineup-images.scdn.co' },
      { protocol: 'https', hostname: 'charts-images.scdn.co' },
      { protocol: 'https', hostname: 'platform-lookaside.fbsbx.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/worklets/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }],
      },
    ];
  },
};

export default nextConfig;
