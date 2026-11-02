interface ImportMetaEnv {
  readonly VITE_AYAMAI_DEV_AUTH_MODE?: "clerk" | "local-founder";
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
