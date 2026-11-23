// The site's build: page source in web/, static files (data/, maps/, vendor/) in public/, copied
// as they are; the result in dist/, which GitHub Pages and Vercel publish. Relative asset paths
// (base './') so the same build works at skellyevents.com/ and at github.io/skelly/.
// `npm run dev` also answers /api/* with the same handlers Vercel runs (as server.js does).
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

const web = (f) => fileURLToPath(new URL(`./web/${f}`, import.meta.url));

/** /api/<name> → api/<name>.js's default handler, in the dev server only. */
const api = () => ({
  name: 'skelly-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const name = /^\/api\/([a-z-]+)(?:\?|$)/.exec(req.url ?? '')?.[1];
      if (!name) return next();
      try {
        const mod = await import(fileURLToPath(new URL(`./api/${name}.js`, import.meta.url)));
        await mod.default(req, res);
      } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND') return next(); res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    });
  },
});

export default defineConfig({
  root: 'web',
  publicDir: '../public',
  base: './',
  plugins: [preact(), api()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022', // app.js waits for the data at the top level
    rollupOptions: { input: { index: web('index.html'), sources: web('sources.html'), usage: web('usage.html') } },
  },
});
