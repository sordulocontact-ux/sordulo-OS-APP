/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Client ID de l'app Spotify (connecteur Spotify de l'app de bureau), pas un secret (PKCE). */
  readonly VITE_SPOTIFY_CLIENT_ID?: string
  /** Base de l'API (sans slash final) : renseignée pour l'app de bureau, vide sur le web et en dev. */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
