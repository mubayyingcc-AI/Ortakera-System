import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'public');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const server = http.createServer(async (req,res) => {
  if (req.url === '/health') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({ok:true, service:'ortakera-web', mode:'preview'})); }
  let pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const safe = normalize(pathname).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]+/, '');
  try {
    const body = await readFile(join(root, safe));
    res.writeHead(200, {'content-type': types[extname(safe)] || 'application/octet-stream', 'cache-control':'no-store'});
    res.end(body);
  } catch {
    const body = await readFile(join(root,'index.html'));
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(body);
  }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Ortakera preview listening on ${port}`));
