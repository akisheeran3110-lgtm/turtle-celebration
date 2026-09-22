import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // スマホ実機からLAN経由でアクセスして確認する時に便利
  },
  build: {
    target: 'es2020',
  },
});
