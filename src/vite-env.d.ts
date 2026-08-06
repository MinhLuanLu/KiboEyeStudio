/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the login/signup backend — see src/lib/http/httpClient.ts and .env. */
  readonly VITE_SERVER_IP: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
