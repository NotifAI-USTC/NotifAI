import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { isValidApiBaseUrl } from './src/utils/apiBaseUrl'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const mockRequested = process.env.VITE_USE_MOCK ?? env.VITE_USE_MOCK
  const apiBaseUrl = (process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL)?.trim()
  if (command === 'build') {
    if (mockRequested === 'true') {
      throw new Error('VITE_USE_MOCK=true 仅允许用于开发服务器，生产构建已终止')
    }
    if (!apiBaseUrl) {
      throw new Error('生产构建必须配置 VITE_API_BASE_URL')
    }
    if (!isValidApiBaseUrl(apiBaseUrl, 'https://build.notifai.invalid')) {
      throw new Error('VITE_API_BASE_URL 必须是不含凭据、查询参数或片段的 HTTP(S) 地址或根相对路径')
    }
  }

  return {
    plugins: [vue(), vuetify({ autoImport: true })],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    build: {
      chunkSizeWarningLimit: 600,
    },
    server: {
      port: 5173,
      open: false,
      warmup: {
        clientFiles: ['./src/main.ts', './src/views/*.vue', './src/components/*.vue'],
      },
    },
  }
})
