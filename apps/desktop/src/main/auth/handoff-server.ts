import { createServer, type Server } from 'node:http';

const HOST = '127.0.0.1';
const PORT = 37891;

let server: Server | undefined;

/**
 * Starts the local HTTP server used by the web app
 * to detect whether the desktop application is running.
 */
export function startHandoffServer(): void {
  if (server) {
    return;
  }

  server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });

      res.end(
        JSON.stringify({
          ok: true,
        }),
      );

      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(PORT, HOST, () => {
    console.log(`Desktop handoff server listening on http://${HOST}:${PORT}`);
  });

  server.on('error', (error) => {
    console.error('Failed to start handoff server:', error);
  });
}

/**
 * Stops the local handoff server.
 */
export function stopHandoffServer(): void {
  server?.close();
  server = undefined;
}