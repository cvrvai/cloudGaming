import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Keep the API and input WebSocket on the page's origin. Besides avoiding CORS,
// this lets a Cloudflare Tunnel provide HTTPS/WSS without exposing port 8000.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const backendUrl = env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';
  const publicHost = env.VITE_PUBLIC_HOST;

  return {
    plugins: [react()],
    server: {
      // `true` preserves LAN development. Use 127.0.0.1 for a tunnel-only host.
      host: env.VITE_LISTEN_HOST || true,
      port: 5173,
      strictPort: true,
      allowedHosts: publicHost ? [publicHost] : undefined,
      proxy: {
        '/api': { target: backendUrl, changeOrigin: true },
        '/ws': { target: backendUrl, changeOrigin: true, ws: true },
      },
    },
  };
})
