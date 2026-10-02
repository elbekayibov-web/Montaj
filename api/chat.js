// Server-side proxy for the AI assistant (Vercel Edge Function).
// The OpenAI key lives only in the Vercel environment variable
// OPENAI_API_KEY and is never sent to the browser.
// Optional: OPENAI_MODEL (default gpt-4.1).

export const config = { runtime: 'edge' };

const MAX_MESSAGES = 30;
const MAX_CHARS = 60000;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export default async function handler(req) {
  const model = process.env.OPENAI_MODEL || 'gpt-4.1';
  if (req.method === 'GET') return json(200, { model, ready: Boolean(process.env.OPENAI_API_KEY) });
  if (req.method !== 'POST') return json(405, { error: { message: 'Method not allowed' } });

  // Only accept calls from pages served by this same site.
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return json(403, { error: { message: 'Forbidden origin' } });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return json(500, { error: { message: 'OPENAI_API_KEY is not set in the Vercel project settings.' } });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: { message: 'Invalid JSON' } }); }
  const messages = Array.isArray(body?.messages) ? body.messages.slice(-MAX_MESSAGES) : null;
  if (!messages?.length) return json(400, { error: { message: 'messages are required' } });
  const clean = messages
    .filter((m) => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }));
  if (clean.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS) return json(413, { error: { message: 'The conversation is too long — start a new chat.' } });

  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: clean, stream: true, max_tokens: 1500 }),
  });
  if (!upstream.ok) {
    let detail = '';
    try { detail = (await upstream.json()).error?.message || ''; } catch { /* not json */ }
    return json(upstream.status, { error: { message: detail || `OpenAI error ${upstream.status}` } });
  }
  return new Response(upstream.body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-model': model },
  });
}
