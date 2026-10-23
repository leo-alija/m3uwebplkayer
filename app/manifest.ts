import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'M3U Web Player',
    short_name: 'M3U Player',
    description: 'Import and play M3U/Xtream playlists. Installable web app.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0d12',
    theme_color: '#ff7a2a',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
