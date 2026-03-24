import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      allowedHosts: env.FORM_BASE_URL
        ? [new URL(env.FORM_BASE_URL).host]
        : [],
      proxy: {
        '/api': {
          target: 'http://localhost:3210',
          changeOrigin: true,
        },
      },
    },
  }
})