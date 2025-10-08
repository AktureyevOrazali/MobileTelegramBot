/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_API_TOKEN: string
  
  // добавь сюда все переменные окружения, которые используешь
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
