import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const getEnv = (env: Record<string, string>, key: string, fallback: string): string => {
  const value = env[key];
  return value || fallback;
};

const parsePort = (value: string, key: string): number => {
  const port = Number(value);
  // Use a compatibility-safe integer check (avoids Number.isInteger requirement)
  if (!isFinite(port) || Math.floor(port) !== port || port <= 0 || port > 65535) {
    throw new Error(`Environment variable ${key} must be a valid TCP port`);
  }
  return port;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const devHost = getEnv(env, 'DEV_SERVER_HOST', 'localhost');
  const devPort = parsePort(getEnv(env, 'DEV_SERVER_PORT', '5173'), 'DEV_SERVER_PORT');
  const apiProxyTarget = getEnv(env, 'API_PROXY_TARGET', '');
  const previewHost = getEnv(env, 'PREVIEW_HOST', 'localhost');
  const previewPort = parsePort(getEnv(env, 'PREVIEW_PORT', '4173'), 'PREVIEW_PORT');

  return {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      css: true,
      setupFiles: './src/test/setup.ts',
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react') || id.includes('scheduler')) {
                return 'react-vendor';
              }
              if (id.includes('echarts')) {
                return 'charts-vendor';
              }
              if (id.includes('d3') || id.includes('topojson')) {
                return 'map-vendor';
              }
            }
            return undefined;
          },
        },
      },
    },
    server: {
      host: devHost,
      port: devPort,
      ...(apiProxyTarget
        ? {
          proxy: {
            '/api': {
              target: apiProxyTarget,
              changeOrigin: true,
              secure: false,
            },
          },
        }
        : {}),
    },
    preview: {
      host: previewHost,
      port: previewPort,
    },
  };
});
