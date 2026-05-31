import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function splitVendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  if (/[\\/]node_modules[\\/](?:reactflow|@reactflow)[\\/]/.test(id)) {
    return 'vendor-reactflow'
  }
  if (/[\\/]node_modules[\\/]@hello-pangea[\\/]dnd[\\/]/.test(id)) {
    return 'vendor-dnd'
  }
  return undefined
}

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: false,
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: splitVendorChunk,
      },
    },
  },
})
