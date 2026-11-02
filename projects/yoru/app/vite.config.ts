import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const localFounderMode = process.env.AYAMAI_DEV_AUTH_MODE === "local-founder";
const productionCommand = process.env.NODE_ENV === "production" ||
  process.argv.some((arg) => arg === "build" || arg === "preview");
if (localFounderMode && productionCommand) {
  throw new Error("Local founder authentication cannot be used for production builds or previews.");
}
if (localFounderMode && process.env.HOST !== "127.0.0.1") {
  throw new Error("Local founder authentication requires Vite to bind to 127.0.0.1.");
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

// The door's name is configuration, not a constant.
const publicHost = () => { try { return new URL(process.env.AYAMAI_PUBLIC_ORIGIN ?? 'http://ayamai.local').hostname; } catch { return 'ayamai.local'; } };

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      ...(localFounderMode ? {
        '@clerk/react/internal': path.resolve(import.meta.dirname, 'src/lib/local-dev-clerk.tsx'),
        '@clerk/react': path.resolve(import.meta.dirname, 'src/lib/local-dev-clerk.tsx'),
      } : {}),
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: localFounderMode ? '127.0.0.1' : '0.0.0.0',
    allowedHosts: localFounderMode ? ['localhost', '127.0.0.1', publicHost(), '.localhost'] : true,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: localFounderMode ? '127.0.0.1' : '0.0.0.0',
    allowedHosts: localFounderMode ? ['localhost', '127.0.0.1', publicHost(), '.localhost'] : true,
  },
});
