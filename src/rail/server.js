import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI_DIR = fileURLToPath(new URL('./ui/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function startRailServer({ getState, actions }) {
  const clients = new Set();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');

    try {
      if (request.method === 'GET' && url.pathname === '/state') {
        return json(response, 200, getState());
      }

      if (request.method === 'GET' && url.pathname === '/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        response.write(`data: ${JSON.stringify(getState())}\n\n`);
        clients.add(response);
        request.on('close', () => clients.delete(response));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/open') {
        const body = await readBody(request);
        const result = await actions.open(body.input);
        return json(response, result.ok ? 200 : 400, result);
      }

      if (request.method === 'POST' && url.pathname === '/confirm-save') {
        const body = await readBody(request);
        return json(response, 200, await actions.confirmSave(body));
      }

      if (request.method === 'POST' && url.pathname === '/dismiss-save') {
        return json(response, 200, await actions.dismissSave());
      }

      if (request.method === 'POST' && url.pathname === '/confirm-fill') {
        const body = await readBody(request);
        return json(response, 200, await actions.confirmFill(body));
      }

      if (request.method === 'POST' && url.pathname === '/dismiss-fill') {
        return json(response, 200, await actions.dismissFill());
      }

      if (request.method === 'POST' && url.pathname === '/open-cancel') {
        return json(response, 200, await actions.openCancel());
      }

      if (request.method === 'POST' && url.pathname === '/dismiss-mention') {
        return json(response, 200, await actions.dismissMention());
      }

      const file =
        url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
      const path = resolve(UI_DIR, file);
      if (!path.startsWith(resolve(UI_DIR))) {
        response.writeHead(403);
        return response.end();
      }
      const data = await readFile(path);
      response.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/plain' });
      return response.end(data);
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  });

  return {
    listen(port = 0) {
      return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
          resolve(server.address().port);
        });
      });
    },
    push() {
      const payload = `data: ${JSON.stringify(getState())}\n\n`;
      for (const client of clients) client.write(payload);
    },
    close() {
      for (const client of clients) client.end();
      server.close();
    },
  };
}
