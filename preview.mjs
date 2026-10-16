import http from 'node:http';
import { pathToFileURL } from 'node:url';

/** Explicitly local-only D1 adapter. Production requires a real env.DB binding. */
export class MemoryD1 {
  constructor() { this.rows = new Map(); }
  prepare(sql) {
    const db = this;
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() {
        if (sql.startsWith('SELECT COUNT')) return { total: db.rows.size };
        if (sql.startsWith('SELECT data')) return structuredClone(db.rows.get(this.args[0]) || null);
        throw new Error('Unsupported local SELECT');
      },
      async run() {
        const a = this.args;
        let changes = 0;
        if (sql.startsWith('DELETE')) {
          for (const [code, row] of db.rows) if (row.created_at < a[0]) { db.rows.delete(code); changes++; }
        } else if (sql.startsWith('INSERT')) {
          if (db.rows.has(a[0])) throw new Error('UNIQUE constraint failed: games.code');
          if (db.rows.size < a[3]) { db.rows.set(a[0], { data: a[1], version: 0, created_at: a[2] }); changes = 1; }
        } else if (sql.startsWith('UPDATE')) {
          const row = db.rows.get(a[2]);
          if (row && row.version === a[3]) { db.rows.set(a[2], { ...row, data: a[0], version: a[1] }); changes = 1; }
        } else throw new Error('Unsupported local mutation');
        return { success: true, meta: { changes } };
      },
    };
  }
}

export async function startPreview({ port = 4173, host = '127.0.0.1' } = {}) {
  const { default: worker } = await import('./worker/index.js');
  const DB = new MemoryD1();
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of incoming) {
        length += chunk.length;
        if (length > 16 * 1024) {
          outgoing.writeHead(413, { 'content-type': 'application/json' });
          outgoing.end(JSON.stringify({ error: { code: 'body_too_large', message: 'JSON body exceeds 16 KiB.' } }));
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const request = new Request(`http://${host}:${port}${incoming.url}`, {
        method: incoming.method, headers: incoming.headers, ...(body.length ? { body } : {}),
      });
      const response = await worker.fetch(request, { DB }, {});
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ error: { code: 'preview_error', message: 'Local preview failed.' } }));
    }
  });
  await new Promise(resolve => server.listen(port, host, resolve));
  console.log(`ISLET local preview http://${host}:${server.address().port} (in-memory storage; resets on restart)`);
  return { server, DB };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await startPreview();
