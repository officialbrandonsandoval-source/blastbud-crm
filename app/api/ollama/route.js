// Proxy route for Ollama API — avoids mixed-content (HTTPS→HTTP) browser blocks
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

export async function POST(request) {
  try {
    const body = await request.json();
    const endpoint = body._endpoint || '/api/chat';
    delete body._endpoint;

    const res = await fetch(`${OLLAMA_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000), // 2 min timeout for LLM calls
    });

    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return Response.json({ error: 'Ollama unavailable: ' + e.message }, { status: 502 });
  }
}