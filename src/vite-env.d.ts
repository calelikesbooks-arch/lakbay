/// <reference types="vite/client" />

// Tells TypeScript which VITE_ variables exist (see .env.example).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_MAP_STYLE_URL?: string;
  readonly VITE_MAP_STYLE_URL_DARK?: string;
  readonly VITE_GEOCODER_ENABLED?: string;
  readonly VITE_GEOCODER_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
