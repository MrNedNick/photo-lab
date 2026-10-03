import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { SITE, TASKS } from './src/tasks'

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * GitHub Pages serves files, not routes. Each task gets its own copy of the
 * page with its own title, description and preview card — link previews in
 * messengers never run JavaScript — plus a 404 fallback, sitemap and robots.
 */
function taskPages(): Plugin {
  let outDir = 'dist'
  return {
    name: 'task-pages',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const base = readFileSync(resolve(outDir, 'index.html'), 'utf8')
      const page = (
        url: string,
        title: string,
        description: string,
        image: string,
      ) =>
        base
          .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
          .replace(
            /(<meta\s+name="description"\s+content=")[^"]*"/,
            `$1${escape(description)}"`,
          )
          .replace(
            /(<meta\s+property="og:title"\s+content=")[^"]*"/,
            `$1${escape(title)}"`,
          )
          .replace(
            /(<meta\s+property="og:description"\s+content=")[^"]*"/,
            `$1${escape(description)}"`,
          )
          .replace(/(<meta\s+property="og:url"\s+content=")[^"]*"/, `$1${url}"`)
          .replace(
            /(<meta\s+property="og:image"\s+content=")[^"]*"/,
            `$1${image}"`,
          )
          .replace(/(<link rel="canonical" href=")[^"]*"/, `$1${url}"`)
      for (const task of TASKS) {
        const url = `${SITE}${task.slug}/`
        mkdirSync(resolve(outDir, task.slug), { recursive: true })
        writeFileSync(
          resolve(outDir, task.slug, 'index.html'),
          page(url, task.title, task.description, `${SITE}og/${task.slug}.png`),
        )
      }
      writeFileSync(resolve(outDir, '404.html'), base)
      const urls = [SITE, ...TASKS.map((t) => `${SITE}${t.slug}/`)]
      writeFileSync(
        resolve(outDir, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
          .map((u) => `  <url><loc>${u}</loc></url>`)
          .join('\n')}\n</urlset>\n`,
      )
      writeFileSync(
        resolve(outDir, 'robots.txt'),
        `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`,
      )
    },
  }
}

export default defineConfig({
  base: '/photo-lab/',
  plugins: [taskPages()],
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
