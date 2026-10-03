import { defineConfig } from 'vite'
export default defineConfig({
  base: '/photo-lab/',
  // The cut-out runtime is only imported by a worker; pre-bundle it at start
  // so the dev server does not re-optimize while a worker is using it.
  optimizeDeps: {
    include: [
      'onnxruntime-web/wasm',
      'libheif-js/libheif-wasm/libheif-bundle.mjs',
    ],
  },
  // Module workers can split: the HEIC decoder stays a chunk of its own,
  // fetched only when the browser cannot read the photo natively.
  worker: { format: 'es' },
})
