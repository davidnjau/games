/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` produces ONE self-contained dist/index.html
// (code, styles and icons inlined) — easy to share or host anywhere.
export default defineConfig({
  plugins: [viteSingleFile()],
  test: {
    environment: 'node',
  },
});
