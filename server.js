// -*- coding: utf-8 -*-
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8088;
const BASE_DIR = __dirname;
const DATA_FILE = path.join(BASE_DIR, 'data', 'portfolio.json');
const UPLOADS_DIR = path.join(BASE_DIR, 'uploads');

// Ensure directories exist
if (!fs.existsSync(path.join(BASE_DIR, 'data'))) {
  fs.mkdirSync(path.join(BASE_DIR, 'data'), { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 1. GET /api/portfolio
  if (req.method === 'GET' && url.pathname === '/api/portfolio') {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        return sendJSON(res, 200, JSON.parse(raw));
      } else {
        return sendJSON(res, 200, { items: [], ba_before: null, ba_after: null });
      }
    } catch (err) {
      return sendJSON(res, 500, { error: 'Failed to read portfolio: ' + err.message });
    }
  }

  // Read request body for POST endpoints
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // 25MB max size limit
      if (body.length > 25 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on('end', () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        return sendJSON(res, 400, { error: 'Invalid JSON payload' });
      }

      // Check admin auth
      const authPass = parsed.auth || req.headers.authorization;
      if (authPass !== 'vladimir2026') {
        return sendJSON(res, 401, { error: 'Unauthorized: Invalid password' });
      }

      // 2. POST /api/portfolio - save entire portfolio state
      if (url.pathname === '/api/portfolio') {
        try {
          const payload = {
            ba_before: parsed.ba_before || '',
            ba_after: parsed.ba_after || '',
            items: parsed.items || [],
            updatedAt: new Date().toISOString()
          };
          fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
          return sendJSON(res, 200, { success: true, count: payload.items.length });
        } catch (err) {
          return sendJSON(res, 500, { error: 'Save failed: ' + err.message });
        }
      }

      // 3. POST /api/upload - upload base64 image file
      if (url.pathname === '/api/upload') {
        try {
          const dataUri = parsed.data || '';
          if (!dataUri.startsWith('data:image/')) {
            return sendJSON(res, 400, { error: 'Invalid image data' });
          }

          const matches = dataUri.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
          if (!matches) {
            return sendJSON(res, 400, { error: 'Malformed base64 image data' });
          }

          let ext = matches[1].toLowerCase();
          if (ext === 'jpeg') ext = 'jpg';
          const buffer = Buffer.from(matches[2], 'base64');

          const safeTimestamp = Date.now();
          const randomSuffix = Math.floor(Math.random() * 10000);
          const fileName = `work_${safeTimestamp}_${randomSuffix}.${ext}`;
          const filePath = path.join(UPLOADS_DIR, fileName);

          fs.writeFileSync(filePath, buffer);
          const publicUrl = `/uploads/${fileName}`;

          return sendJSON(res, 200, { success: true, url: publicUrl });
        } catch (err) {
          return sendJSON(res, 500, { error: 'Upload failed: ' + err.message });
        }
      }

      return sendJSON(res, 404, { error: 'Not found' });
    });
    return;
  }

  // Fallback static serve for /uploads/
  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    const safeFile = path.basename(url.pathname);
    const filePath = path.join(UPLOADS_DIR, safeFile);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000' });
      return fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      return res.end('File not found');
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Portfolio API server running on port ${PORT}`);
});
