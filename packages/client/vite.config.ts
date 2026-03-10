import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: {
      // Прямой путь к папке src shared пакета
      '@stabilometer/shared': path.resolve(__dirname, '../shared/src')
    }
  }
});