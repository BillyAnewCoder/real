import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    // Place the built files in dist/public within your repo
    outDir: 'dist/public',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      // Point the “@” alias to the project root (where index.html is)
      '@': path.resolve(__dirname, '.'),
      // Alias for any static assets you might have
      '@assets': path.resolve(__dirname, './attached_assets'),
    },
  },
  css: {
    postcss: './postcss.config.js',
  },
});
