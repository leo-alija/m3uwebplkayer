import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'M3U Player',
    short_name: 'M3U Player',
    description: 'Import and play M3U/Xtream playlists on your iPhone.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0b0d',
    theme_color: '#000000',
    orientation: 'any',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
