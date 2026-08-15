import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 포트를 고정한다 — .claude/launch.json 과 어긋나면 프리뷰가 다른 서버를 본다
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'node',
    globals: true,
  },
})
