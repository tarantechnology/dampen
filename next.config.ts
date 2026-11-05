import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
