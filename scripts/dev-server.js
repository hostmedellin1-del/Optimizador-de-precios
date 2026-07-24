#!/usr/bin/env node
/* Servidor estatico local, CERO dependencias externas (solo modulos nucleo
   de Node) — proposito unico: servir este mismo repo (index.html + src/**)
   con los Content-Type correctos para que los `<script type="module">`
   carguen. Chrome/Firefox bloquean `import` bajo `file://` (CORS) y son
   estrictos con el MIME type de un modulo ES bajo http — por eso abrir
   `index.html` con doble-clic NO funciona y este servidor SI.

   Reemplaza `python3 -m http.server` como comando principal de desarrollo
   local (`npm run dev`) para no depender de tener Python instalado — sigue
   siendo exactamente el mismo sitio estatico de siempre, esto NO es un
   build step, no transforma ni empaqueta nada, solo sirve los archivos tal
   cual estan en disco. Playwright (`playwright.config.js`) sigue usando
   `python3 -m http.server` para los tests e2e — no se tocó, ambos comandos
   son intercambiables porque ninguno hace mas que servir archivos estaticos.

   Uso: `npm run dev` (puerto 3000 por defecto) o `PORT=4000 npm run dev`. */
import http from 'node:http';
import {createReadStream, promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/* Nunca confiar en la URL del request — mismo principio que
   src/domain/persistence.js aplica a datos de negocio importados: un
   `../../../etc/passwd` no puede salir de ROOT. */
function resolveSafePath(urlPath){
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  return path.join(ROOT, normalized);
}

const server = http.createServer(async (req, res) => {
  try{
    let filePath = resolveSafePath(req.url === '/' ? '/index.html' : req.url);
    if(!filePath.startsWith(ROOT)){
      res.writeHead(403, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end('403 - fuera del proyecto');
      return;
    }
    let stat;
    try{ stat = await fs.stat(filePath); }
    catch{
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end('404 - no encontrado: ' + req.url);
      return;
    }
    if(stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
    createReadStream(filePath)
      .on('error', () => { res.writeHead(500); res.end('500 - error leyendo el archivo'); })
      .pipe(res);
  }catch(err){
    console.error(err);
    if(!res.headersSent) res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('500 - error del servidor');
  }
});

server.on('error', err => {
  if(err.code === 'EADDRINUSE'){
    console.error(`\nEl puerto ${PORT} ya está en uso. Cierra lo que lo esté usando o corre con otro puerto:\n  PORT=3001 npm run dev\n`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`\nRevenue Ops — Precios y Descuentos: servidor local corriendo.\n\n  → http://${HOST}:${PORT}/index.html\n\nCtrl+C para detenerlo.\n`);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
