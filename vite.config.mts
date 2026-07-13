import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function splitVendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  if (/[\\/]node_modules[\\/](?:react|react-dom|react-router|react-router-dom)[\\/]/.test(id)) {
    return 'vendor-react'
  }
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
    proxy: {
      '/rpc': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/events': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
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
