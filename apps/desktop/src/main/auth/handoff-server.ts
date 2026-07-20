import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WEB_APP_URL } from '../config';

const HOST = '127.0.0.1';
const PORT = 37891;
const APP_NAME = 'worktrace-desktop';

let server: Server | undefined;
let startWalkthroughHandler: ((sopId: string, source: 'http') => Promise<void>) | undefined;

function allowedOrigins(): Set<string> {
  const origins = new Set<string>();
  try {
    origins.add(new URL(WEB_APP_URL).origin);
  } catch {
    // ignore invalid config; CORS will deny
  }
  // Local web dev is commonly on 3000 even if env points elsewhere.
  origins.add('http://localhost:3000');
  origins.add('http://127.0.0.1:3000');
  return origins;
}

function requestOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  return typeof origin === 'string' && origin.trim() ? origin.trim() : null;
}

function writeCors(res: ServerResponse, origin: string | null): void {
  if (origin && allowedOrigins().has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  origin: string | null,
): void {
  writeCors(res, origin);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).length > 64_000) {
      throw new Error('Request body too large');
    }
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as unknown;
}

/**
 * Starts the local HTTP server used by the web app to detect desktop and
 * start walkthroughs without relying solely on custom protocol registration.
 */
export function startHandoffServer(options?: {
  onStartWalkthrough?: (sopId: string, source: 'http') => Promise<void>;
}): void {
  if (server) {
    if (options?.onStartWalkthrough) {
      startWalkthroughHandler = options.onStartWalkthrough;
    }
    return;
  }

  startWalkthroughHandler = options?.onStartWalkthrough;

  server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Desktop handoff server listening on http://${HOST}:${PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `[handoff] port ${PORT} is already in use. Web ping/start may hit another process.`,
      );
      return;
    }
    console.error('Failed to start handoff server:', error);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = requestOrigin(req);
  const url = req.url ?? '/';

  if (req.method === 'OPTIONS') {
    writeCors(res, origin);
    res.writeHead(origin && allowedOrigins().has(origin) ? 204 : 403);
    res.end();
    return;
  }

  if (req.method === 'GET' && url === '/ping') {
    // Ping stays readable from any origin (presence check only).
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(
      JSON.stringify({
        ok: true,
        app: APP_NAME,
        version: '0.1.0',
      }),
    );
    return;
  }

  if (req.method === 'POST' && (url === '/walkthrough/start' || url === '/walkthrough/start/')) {
    if (!origin || !allowedOrigins().has(origin)) {
      writeJson(res, 403, { ok: false, error: 'Origin not allowed' }, origin);
      return;
    }

    if (!startWalkthroughHandler) {
      writeJson(res, 503, { ok: false, error: 'Walkthrough service is not ready' }, origin);
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { sopId?: unknown; id?: unknown };
      const sopId = String(body.sopId ?? body.id ?? '').trim();
      if (!sopId) {
        writeJson(res, 400, { ok: false, error: 'Missing sopId' }, origin);
        return;
      }
      await startWalkthroughHandler(sopId, 'http');
      writeJson(res, 200, { ok: true }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(res, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  writeJson(res, 404, { ok: false, error: 'Not found' }, origin);
}

export function stopHandoffServer(): void {
  server?.close();
  server = undefined;
  startWalkthroughHandler = undefined;
}

export const HANDOFF_PORT = PORT;
export const HANDOFF_APP_NAME = APP_NAME;
