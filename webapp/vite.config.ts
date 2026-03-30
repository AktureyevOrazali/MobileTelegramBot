import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const requireEnv = (env: Record<string, string>, key: string): string => {
  const value = env[key];
  if (!value) {
    throw new Error(`Environment variable ${key} is required for Vite config`);
  }
  return value;
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

  const devHost = requireEnv(env, 'DEV_SERVER_HOST');
  const devPort = parsePort(requireEnv(env, 'DEV_SERVER_PORT'), 'DEV_SERVER_PORT');
  const previewHost = requireEnv(env, 'PREVIEW_HOST');
  const previewPort = parsePort(requireEnv(env, 'PREVIEW_PORT'), 'PREVIEW_PORT');

  return {
    plugins: [react()],
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
    },
    preview: {
      host: previewHost,
      port: previewPort,
    },
  };
});