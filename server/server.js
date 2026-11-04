const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const child_process = require('child_process');
const WebSocket = require('ws');
const pty = require('node-pty');

// Token Yönetimi
const tokenFile = path.join(__dirname, '.token');
let token = '';
if (fs.existsSync(tokenFile)) {
  token = fs.readFileSync(tokenFile, 'utf8').trim();
} else {
  token = require('crypto').randomBytes(12).toString('hex');
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
}

const sessions = new Map(); // sid -> { pty, replay, clients }

function authCheck(req, query) {
  const authHeader = req.headers['authorization'];
  const bearer = authHeader && authHeader.replace(/^Bearer\s+/i, '').trim();
  const qToken = query && query.token;
  return (bearer === token || qToken === token);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const q = parsed.query;

  // CORS başlıkları
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // Ping kontrolü
  if (pathname === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, cwd: process.cwd() }));
  }

  if (!authCheck(req, q)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Yetkisiz erişim' }));
  }

  // 1. Dizin Listeleme (/api/list)
  if (pathname === '/api/list') {
    const targetDir = q.path ? path.resolve(q.path) : process.cwd();
    if (!fs.existsSync(targetDir)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Dizin bulunamadı' }));
    }

    try {
      const stat = fs.statSync(targetDir);
      if (!stat.isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Yol bir dizin değil' }));
      }

      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      const items = entries.map(ent => {
        let size = 0;
        let mtime = 0;
        try {
          const s = fs.statSync(path.join(targetDir, ent.name));
          size = s.size;
          mtime = s.mtimeMs;
        } catch (_) {}
        return {
          name: ent.name,
          isDir: ent.isDirectory(),
          size: size,
          mtime: mtime
        };
      });

      // Klasörler önce, alfabetik sıralı
      items.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(items));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // 2. Metin Okuma (/api/read)
  if (pathname === '/api/read') {
    const filePath = path.resolve(q.path || '');
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Dosya bulunamadı');
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(content);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Okuma hatası: ' + e.message);
    }
  }

  // 3. Dosya / Klasör İndirme (/api/download)
  if (pathname === '/api/download') {
    const itemPath = path.resolve(q.path || '');
    if (!fs.existsSync(itemPath)) {
      res.writeHead(404);
      return res.end('Bulunamadı');
    }
    const stat = fs.statSync(itemPath);
    if (stat.isDirectory()) {
      // Klasörü doğrudan .tar.gz arşivi olarak akışla gönder
      const archName = path.basename(itemPath) + '.tar.gz';
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(archName)}"`
      });
      const tar = child_process.spawn('tar', ['-czf', '-', '-C', path.dirname(itemPath), path.basename(itemPath)]);
      tar.stdout.pipe(res);
    } else {
      const fileName = path.basename(itemPath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`
      });
      fs.createReadStream(itemPath).pipe(res);
    }
    return;
  }

  // 4. Komut Çalıştırma (/api/exec)
  if (pathname === '/api/exec' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsedBody = JSON.parse(body || '{}');
        const cmd = parsedBody.cmd;
        if (!cmd) throw new Error('Komut girilmedi');
        child_process.exec(cmd, { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 4 }, (err, stdout, stderr) => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            stdout: stdout || '',
            stderr: stderr || '',
            exitCode: err ? (err.code || 1) : 0
          }));
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Bulunamadı');
});

// WebSocket Terminal Sunucusu
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const parsed = url.parse(req.url, true);
  if (!authCheck(req, parsed.query)) {
    ws.close(4001, 'Yetkisiz erişim');
    return;
  }

  let sid = parsed.query.sid;
  let session = sid && sessions.get(sid);

  if (!session) {
    sid = require('crypto').randomBytes(6).toString('hex');
    const shell = process.env.SHELL || 'bash';
    const p = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env
    });

    session = { pty: p, replay: '', clients: new Set() };
    sessions.set(sid, session);

    p.onData(data => {
      session.replay = (session.replay + data).slice(-20000);
      const outMsg = JSON.stringify({ t: 'o', d: data });
      session.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) c.send(outMsg);
      });
    });

    p.onExit(() => {
      sessions.delete(sid);
    });
  }

  session.clients.add(ws);
  ws.send(JSON.stringify({ t: 'hello', sid: sid, replay: session.replay }));

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.t === 'i' && msg.d) {
        session.pty.write(msg.d);
      } else if (msg.t === 'resize' && msg.cols && msg.rows) {
        session.pty.resize(msg.cols, msg.rows);
      } else if (msg.t === 'ping') {
        ws.send(JSON.stringify({ t: 'pong' }));
      }
    } catch (_) {
      session.pty.write(raw.toString());
    }
  });

  ws.on('close', () => {
    session.clients.delete(ws);
  });
});

const PORT = 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sunucu 0.0.0.0:${PORT} üzerinde hazır.`);
});
