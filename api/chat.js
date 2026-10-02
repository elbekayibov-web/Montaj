// Server-side proxy for the AI assistant (Vercel Edge Function).
// API keys live only in Vercel environment variables and are never sent to the browser.
//   GEMINI_API_KEY  — Google Gemini (preferred; free tier at aistudio.google.com)
//                     optional GEMINI_MODEL (default gemini-flash-latest)
//   OPENAI_API_KEY  — OpenAI fallback, optional OPENAI_MODEL (default gpt-4.1)
// Both are called through the OpenAI-compatible Chat Completions format, so the
// browser receives the same streaming response either way.

export const config = { runtime: 'edge' };

const MAX_MESSAGES = 30;
const MAX_CHARS = 60000;

function provider() {
  if (process.env.GEMINI_API_KEY) {
    return {
      name: 'Gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      key: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      name: 'ChatGPT',
      url: 'https://api.openai.com/v1/chat/completions',
      key: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4.1',
    };
  }
  return null;
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export default async function handler(req) {
  const p = provider();
  if (req.method === 'GET') return json(200, { provider: p?.name || null, model: p?.model || null, ready: Boolean(p) });
  if (req.method !== 'POST') return json(405, { error: { message: 'Method not allowed' } });

  // Only accept calls from pages served by this same site.
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return json(403, { error: { message: 'Forbidden origin' } });

  if (!p) return json(500, { error: { message: 'GEMINI_API_KEY is not set in the Vercel project settings.' } });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: { message: 'Invalid JSON' } }); }
  const messages = Array.isArray(body?.messages) ? body.messages.slice(-MAX_MESSAGES) : null;
  if (!messages?.length) return json(400, { error: { message: 'messages are required' } });
  const clean = messages
    .filter((m) => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }));
  if (clean.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS) return json(413, { error: { message: 'The conversation is too long — start a new chat.' } });

  const upstream = await fetch(p.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
    // Gemini's thinking tokens count toward the limit, so leave room for the answer.
    body: JSON.stringify({ model: p.model, messages: clean, stream: true, max_tokens: 4096 }),
  });
  if (!upstream.ok) {
    let detail = '';
    try {
      const err = await upstream.json();
      detail = (Array.isArray(err) ? err[0] : err)?.error?.message || '';
    } catch { /* not json */ }
    return json(upstream.status, { error: { message: detail || `${p.name} error ${upstream.status}` } });
  }
  return new Response(upstream.body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-model': p.model },
  });
}
