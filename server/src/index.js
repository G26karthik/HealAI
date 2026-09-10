import express from 'express';
import cors from 'cors';
import http from 'node:http';
import axios from 'axios';
import { Server as SocketServer } from 'socket.io';

import { env, reportEnv } from './config/env.js';
import { connectDb, dbReady } from './db.js';
import { chaos } from './lib/chaos.js';
import { setIo } from './lib/realtime.js';
import { requestsRouter } from './routes/requests.js';
import { assignmentsRouter } from './routes/assignments.js';
import { fleetRouter } from './routes/fleet.js';
import { pharmacyRouter } from './routes/pharmacy.js';
import { resumeRuns, startSim } from './services/sim.js';
import { CHAOS_FLAGS, ZONES } from '../../shared/enums.js';

const app = express();
app.use(cors({ origin: env.clientOrigin, credentials: true }));
// 12mb because prescription photos arrive as base64 data URIs from the browser.
app.use(express.json({ limit: '12mb' }));

const server = http.createServer(app);
export const io = new SocketServer(server, {
  cors: { origin: env.clientOrigin, methods: ['GET', 'POST'] },
});

setIo(io);

io.on('connection', (socket) => {
  socket.on('subscribe:request', (id) => socket.join(`request:${id}`));
  socket.on('subscribe:dispatch', () => socket.join('dispatch'));
});

app.use('/api/requests', requestsRouter);
app.use('/api/assignments', assignmentsRouter);
app.use('/api/fleet', fleetRouter);
app.use('/api/pharmacy', pharmacyRouter);

/* --------------------------------------------------------------------------
 * Health — the setup exit test. Every dependency reports separately so a
 * degraded system is distinguishable from a broken one at a glance.
 * ----------------------------------------------------------------------- */
app.get('/api/health', async (_req, res) => {
  let mlSvc = false;
  try {
    const r = await axios.get(`${env.mlSvc.url}/health`, { timeout: 1500 });
    mlSvc = r.data?.ok === true;
  } catch {
    mlSvc = false;
  }

  res.json({
    ok: true,
    service: 'mediroute-api',
    mongo: dbReady(),
    mlSvc,
    gemini: env.gemini.mock ? 'mock' : 'live',
    cloudinary: env.cloudinary.configured,
    chaos: chaos.all(),
    zones: ZONES.length,
    uptimeSec: Math.round(process.uptime()),
  });
});

/* Chaos toggles — driven from the dispatcher console during the demo. */
app.get('/api/chaos', (_req, res) => res.json(chaos.all()));
app.post('/api/chaos', (req, res) => {
  const { flag, value } = req.body || {};
  if (!CHAOS_FLAGS.includes(flag)) {
    return res.status(400).json({ error: `flag must be one of ${CHAOS_FLAGS.join(', ')}` });
  }
  const next = chaos.set(flag, value);
  io.to('dispatch').emit('chaos:changed', next);
  res.json(next);
});
app.post('/api/chaos/reset', (_req, res) => {
  const next = chaos.reset();
  io.to('dispatch').emit('chaos:changed', next);
  res.json(next);
});

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(500).json({ error: err.message || 'internal error' });
});

async function start() {
  reportEnv();
  await connectDb();

  // Without this, a stale process holding the port produces an unhandled
  // 'error' event and a stack trace — and the OLD code keeps serving, so your
  // fixes appear to do nothing. Fail loudly and say exactly what to do.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[api] port ${env.port} is already in use — an older server is still running.\n` +
          '      Close the other terminal, or run:  npx kill-port 5000'
      );
      process.exit(1);
    }
    throw err;
  });

  server.listen(env.port, async () => {
    console.log(`[api] http://localhost:${env.port}  (client origin ${env.clientOrigin})`);
    // nodemon restarts mid-journey, so pick up any vehicle still en route
    // before starting the clock — otherwise it is stranded forever.
    const resumed = await resumeRuns().catch(() => 0);
    if (resumed) console.log(`[sim] resumed ${resumed} in-flight run(s)`);
    startSim();
  });
}

start();
