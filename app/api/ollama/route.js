// AI proxy — routes to Groq API (free, fast, works from Vercel)
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

export async function POST(request) {
  try {
    if (!GROQ_KEY) {
      return Response.json({ error: 'GROQ_API_KEY not configured. Set it in Vercel env vars.' }, { status: 500 });
    }

    const body = await request.json();
    const endpoint = body._endpoint || '/api/chat';
    delete body._endpoint;

    // Convert Ollama-style requests to OpenAI/Groq format
    if (endpoint === '/api/generate') {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: body.prompt }],
          max_tokens: 512,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (data.error) return Response.json({ error: data.error.message || JSON.stringify(data.error) }, { status: 502 });
      return Response.json({ response: data.choices?.[0]?.message?.content || 'No response generated.' });
    }

    // Chat endpoint — messages already in OpenAI format
    if (endpoint === '/api/chat') {
      const messages = body.messages || [];
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages,
          max_tokens: 1024,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (data.error) return Response.json({ error: data.error.message || JSON.stringify(data.error) }, { status: 502 });
      return Response.json({ message: { content: data.choices?.[0]?.message?.content || '' } });
    }

    return Response.json({ error: 'Unknown endpoint: ' + endpoint }, { status: 400 });
  } catch (e) {
    return Response.json({ error: 'AI unavailable: ' + e.message }, { status: 502 });
  }
}