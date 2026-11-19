import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    },
    server: {
      proxy: {
        // Proxy /yf/* → https://query2.finance.yahoo.com/*
        // Runs server-side (Node.js), so no CORS restriction.
        '/yf': {
          target: 'https://query2.finance.yahoo.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/yf/, ''),
          secure: true,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        }
      }
    }
  }
})