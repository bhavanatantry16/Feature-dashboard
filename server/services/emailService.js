// EmailService — provider-swappable mail layer.
//
// The rest of the app calls sendInvitation({...}) / sendPasswordReset({...})
// and never learns which provider is behind them. Today's provider is the
// Google Apps Script web app. Swapping to SMTP / SendGrid later = drop in
// a new provider file with a `send(payload)` method; no callers change.

import { config } from '../config.js';

const RETRY_DELAYS_MS = [400, 1200, 3600];   // 3 attempts total

/**
 * Provider adapter for the Google Apps Script web app.
 * Signature: async send(payload) → { ok, messageId? , error? }
 */
const googleAppsScriptProvider = {
  async send(payload) {
    const url = config.emailProvider?.appsScriptUrl;
    const secret = config.emailProvider?.sharedSecret;
    if (!url || !secret) return { ok: false, error: 'Email provider not configured' };
    let lastErr = 'unknown';
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
      try {
        const r = await fetch(url, {
          method: 'POST',
          redirect: 'follow',                  // Apps Script bounces via 302
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, secret }),
        });
        const text = await r.text();
        let body = {};
        try { body = JSON.parse(text); }
        catch { return { ok: false, error: `Non-JSON response: ${text.slice(0, 120)}` }; }
        if (body.ok) return { ok: true, messageId: body.messageId };
        // 4xx/5xx-shaped body errors are not retried — payload is bad or
        // the auth secret is wrong; more attempts won't fix them.
        if (r.status >= 400 && r.status < 500) return body;
        lastErr = body.error || `HTTP ${r.status}`;
      } catch (e) {
        lastErr = e.message;
      }
    }
    return { ok: false, error: `after ${RETRY_DELAYS_MS.length + 1} attempts: ${lastErr}` };
  },
};

// Registry — one entry per available provider. Chosen by name at runtime
// via config.emailProvider.name so the future SMTP/SendGrid swap is a
// one-word config change, not a code change.
const PROVIDERS = {
  google_apps_script: googleAppsScriptProvider,
};

function currentProvider() {
  const name = config.emailProvider?.provider || 'google_apps_script';
  return PROVIDERS[name] || googleAppsScriptProvider;
}

/** True when mail delivery is turned on AND provider config is present. */
export function isEmailEnabled() {
  const ep = config.emailProvider || {};
  return Boolean(ep.enabled && ep.appsScriptUrl && ep.sharedSecret);
}

export async function sendInvitation({
  to, userName, role, department, setupUrl, expiresAt, triggeredBy,
}) {
  return currentProvider().send({
    type: 'invitation',
    to, userName, role, department, setupUrl, expiresAt, triggeredBy,
  });
}

export async function sendPasswordReset({
  to, userName, setupUrl, expiresAt, triggeredBy,
}) {
  return currentProvider().send({
    type: 'password_reset',
    to, userName, setupUrl, expiresAt, triggeredBy,
  });
}
