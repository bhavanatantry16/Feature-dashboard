import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { apiRouter } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins }));
app.use(compression());

app.use('/api', apiRouter);

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`GitHub Engineering Intelligence listening on http://localhost:${config.port}`);
  if (!config.token) console.log('  → No GitHub token configured yet. Open /config.html or run in demo mode: /?demo=1');
});
