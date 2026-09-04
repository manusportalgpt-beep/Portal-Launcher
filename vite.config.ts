import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 1420
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'motion': ['framer-motion'],
          'three': ['three', '@react-three/fiber', '@react-three/drei'],
          'tauri': ['@tauri-apps/api', '@tauri-apps/plugin-shell'],
          'state': ['zustand'],
        }
      }
    },
    chunkSizeWarningLimit: 1200,
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: { drop_console: false, drop_debugger: true, passes: 2 },
      mangle: { safari10: true },
    }
  }
});
