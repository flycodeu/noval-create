import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

function splitRendererVendorChunk(id: string): string | undefined {
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
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'electron')
      }
    },
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/main.ts'),
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts'),
      }
    }
  },
  renderer: {
    root: '.',
    server: {
      port: 5173,
      strictPort: false, // 端口被占用时自动切换到下一个可用端口
    },
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html')
        },
        output: {
          manualChunks: splitRendererVendorChunk
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    }
  }
})
