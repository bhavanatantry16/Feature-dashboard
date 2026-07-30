import crypto from 'node:crypto';
import { config } from '../config.js';
import { invalidate } from './cache.js';

const listeners = new Set(); // SSE clients

export function verifySignature(rawBody, signature) {
  if (!config.webhookSecret) return true; // if unset, accept (dev only)
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex');
  const expected = `sha256=${hmac}`;
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
  catch { return false; }
}

export function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) {
    try { res.write(line); } catch {}
  }
}

export function subscribe(res) {
  listeners.add(res);
  res.on('close', () => listeners.delete(res));
}

export function handleWebhook(event, payload) {
  invalidate(''); // any push/PR/deploy invalidates the snapshot
  broadcast({
    kind: 'gh-webhook', event, at: new Date().toISOString(),
    summary: summarize(event, payload),
  });
}

function summarize(event, p) {
  switch (event) {
    case 'push': return `${p.pusher?.name} pushed ${p.commits?.length || 0} commit(s) to ${(p.ref || '').replace('refs/heads/', '')} in ${p.repository?.full_name}`;
    case 'pull_request': return `${p.sender?.login} ${p.action} PR #${p.pull_request?.number}: ${p.pull_request?.title}`;
    case 'pull_request_review': return `${p.sender?.login} ${p.review?.state?.toLowerCase()} PR #${p.pull_request?.number}`;
    case 'deployment_status': return `Deployment ${p.deployment_status?.state} in ${p.deployment?.environment}`;
    case 'workflow_run': return `Workflow ${p.workflow_run?.name} ${p.workflow_run?.conclusion || p.workflow_run?.status}`;
    case 'release': return `${p.action} release ${p.release?.tag_name}`;
    default: return event;
  }
}
