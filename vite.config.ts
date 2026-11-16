import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fixedSearchParams, NOMINATIM_ORIGIN, NOMINATIM_SEARCH_PATH, toQueryString } from './shared/geocoder';

/**
 * Local development only: /api/geocode is forwarded to Nominatim with the
 * same fixed parameters the production proxy (functions/api/geocode.ts) uses.
 * In production, Cloudflare Pages runs the real proxy (with caching and the
 * kill switch).
 */
const fixed = toQueryString(fixedSearchParams());
const geocodeProxy: Record<string, ProxyOptions> = {
  '/api/geocode': {
    target: NOMINATIM_ORIGIN,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/geocode\?/, `${NOMINATIM_SEARCH_PATH}?${fixed}&`),
    headers: { 'User-Agent': 'LAKBAY-commuting-app/0.4 (local development)' },
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: geocodeProxy },
  preview: { proxy: geocodeProxy },
  build: {
    // MapLibre is large (~800 kB) but it is split into its own chunk and only
    // downloaded when someone opens the Map page, so we raise the warning limit.
    chunkSizeWarningLimit: 1200,
  },
});