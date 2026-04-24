import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 最小配置测试
export default defineConfig({
  root: '.',
  server: {
    port: 3000,
    open: true,
    host: 'localhost'
  },
  plugins: [
    react()
  ]
})