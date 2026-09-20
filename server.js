// -*- coding: utf-8 -*-
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8088;
const BASE_DIR = __dirname;
const DATA_FILE = path.join(BASE_DIR, 'data', 'portfolio.json');
const LEADS_FILE = path.join(BASE_DIR, 'data', 'leads.json');
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

// Autonomous Email Dispatcher via local Postfix + OpenDKIM
function sendLeadEmail(lead) {
  const recipient = 'Pisbmaestb@mail.ru';
  const from = 'noreply@stroikakras.ru';
  const subjectText = `Новая заявка: ${lead.name || 'Клиент'} (${lead.contact || 'контакт'})`;
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(subjectText, 'utf-8').toString('base64')}?=`;
  const senderEncoded = `=?UTF-8?B?${Buffer.from('Ремонт Крас').toString('base64')}?=`;

  const lines = [
    `Новая заявка на расчет / ремонт с сайта stroikakras.ru:`,
    `======================================================`,
    `Клиент:               ${lead.name || 'Не указано'}`,
    `Телефон / Email:      ${lead.contact || 'Не указано'}`,
    `Вид работ:            ${lead.type || 'Не указано'}`,
    `Площадь помещения:    ${lead.area ? lead.area + ' м²' : 'Не указано'}`,
    `Ориентировочная цена: ${lead.estimatedPrice || 'Не указано'}`,
    `Комментарий / детали: ${lead.comment || 'Не указано'}`,
    `Источник формы:       ${lead.source || 'Главный калькулятор'}`,
    `Дата и время заявки:  ${lead.date || new Date().toLocaleString('ru-RU')}`,
    `ID заявки:            #${lead.id}`,
    `======================================================`,
    ``,
    `Письмо автоматически отправлено почтовым сервером mail.stroikakras.ru`
  ];

  const headers = [
    `From: ${senderEncoded} <${from}>`,
    `To: <${recipient}>`,
    `Subject: ${subjectEncoded}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <lead-${lead.id}.${Date.now()}@stroikakras.ru>`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    lines.join('\r\n')
  ].join('\r\n');

  try {
    const proc = spawn('/usr/sbin/sendmail', ['-t', '-i', '-f', from]);
    proc.stdin.write(headers);
    proc.stdin.end();

    proc.on('error', (err) => {
      console.error('[SENDMAIL ERROR]', err.message);
    });

    proc.on('close', (code) => {
      console.log(`[SENDMAIL DISPATCHED] lead #${lead.id}, exit code: ${code}`);
    });
  } catch (e) {
    console.error('[SENDMAIL SPAWN ERROR]', e.message);
  }
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

  // 2. GET /api/leads (for admin)
  if (req.method === 'GET' && url.pathname === '/api/leads') {
    const authPass = url.searchParams.get('auth') || req.headers.authorization;
    if (authPass !== 'vladimir2026') {
      return sendJSON(res, 401, { error: 'Unauthorized' });
    }
    try {
      if (fs.existsSync(LEADS_FILE)) {
        const raw = fs.readFileSync(LEADS_FILE, 'utf-8');
        return sendJSON(res, 200, JSON.parse(raw));
      } else {
        return sendJSON(res, 200, []);
      }
    } catch (err) {
      return sendJSON(res, 500, { error: 'Failed to read leads: ' + err.message });
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

      // Public endpoint: POST /api/lead (incoming client lead from site form)
      if (url.pathname === '/api/lead') {
        try {
          const leadItem = {
            id: parsed.id || Date.now(),
            date: parsed.date || new Date().toLocaleString('ru-RU'),
            name: parsed.name || 'Без имени',
            contact: parsed.contact || '',
            comment: parsed.comment || '',
            source: parsed.source || 'Сайт',
            type: parsed.type || '',
            area: parsed.area || '',
            estimatedPrice: parsed.estimatedPrice || '',
            files: parsed.files || [],
            status: 'Новая'
          };
          let leads = [];
          if (fs.existsSync(LEADS_FILE)) {
            try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8')); } catch(e) { leads = []; }
          }
          leads.unshift(leadItem);
          fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf-8');
          console.log(`[LEAD RECEIVED] ${leadItem.name} (${leadItem.contact}) - ${leadItem.estimatedPrice}`);
          
          // Dispatch autonomous email notification via local Postfix
          sendLeadEmail(leadItem);

          return sendJSON(res, 200, { success: true, id: leadItem.id });
        } catch (err) {
          return sendJSON(res, 500, { error: 'Failed to record lead: ' + err.message });
        }
      }

      // Admin endpoints require auth
      const authPass = parsed.auth || req.headers.authorization;
      if (authPass !== 'vladimir2026') {
        return sendJSON(res, 401, { error: 'Unauthorized: Invalid password' });
      }

      // 3. POST /api/portfolio - save entire portfolio state
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

      // 4. POST /api/upload - upload base64 image file
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
  console.log(`Portfolio & Lead API server running on port ${PORT}`);
});
