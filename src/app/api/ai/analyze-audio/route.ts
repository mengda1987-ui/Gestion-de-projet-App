import { route, ApiFailure, adminClient } from '@/lib/api/security';
import { NextRequest, NextResponse } from 'next/server';
import { deepMaskSensitiveData } from '@/lib/dataMasking';

const SYSTEM_PROMPT = `You are an expert meeting/audio summarizer. Analyze the provided audio recording and produce a structured mind map summary with exactly 3 levels. Follow these rules strictly:

Level 1 (columns): Main topics/themes discussed. Max 5 topics.
Level 2 (cards): Key points or sub-topics under each topic. 2-4 per topic.
Level 3 (items): Specific details, action items, or quotes under each key point.

Return ONLY valid JSON in this exact format, no other text:
{
  "columns": [
    {
      "title": "Topic 1",
      "cards": [
        {
          "title": "Key Point 1.1",
          "items": ["Detail A", "Detail B"]
        }
      ]
    }
  ]
}

Rules:
- Each title should be concise (max 30 characters preferred)
- Each card's items array should have 1-4 items
- Preserve the original language used in the audio
- Focus on actionable, structured information
- Skip filler content and pleasantries`;

const BASE_URL = 'https://generativelanguage.googleapis.com/v1/models';
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-3.5-flash'];

// Diagnose which models the API key can access
async function getAvailableModels(apiKey: string): Promise<string[]> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    // Show all models to help diagnose what's available
    return (data.models || []).map((m: any) =>
      `${m.name?.replace('models/', '')} [methods: ${(m.supportedGenerationMethods || []).join(',')}]`
    );
  } catch {
    return [];
  }
}

export const GET = route(async (_request, user) => {
  if (user.role !== 'admin') throw new ApiFailure(403, 'FORBIDDEN');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
  const models = await getAvailableModels(apiKey);
  return NextResponse.json({ availableModels: models });
});

export const POST = route(async (request: NextRequest, user) => {
  const { data: allowed, error } = await adminClient().rpc('consume_api_quota_v3', { p_actor: user.uid, p_bucket: 'audio', p_limit: 10, p_seconds: 3600 });
  if (error) throw new ApiFailure(503, 'QUOTA_UNAVAILABLE');
  if (!allowed) throw new ApiFailure(429, 'RATE_LIMITED');
  if (Number(request.headers.get('content-length') || 0) > 4 * 1024 * 1024) throw new ApiFailure(413, 'AUDIO_TOO_LARGE');
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    const reader = request.body?.getReader();
    if (!reader) throw new ApiFailure(400, 'EMPTY_BODY');
    const parts: Uint8Array[] = []; let bytes = 0;
    const timeout = AbortSignal.timeout(15000);
    timeout.addEventListener('abort', () => { void reader.cancel().catch(() => {}); }, { once: true });
    while (true) {
      if (timeout.aborted) { await reader.cancel(); throw new ApiFailure(408, 'REQUEST_TIMEOUT'); }
      const { done, value } = await reader.read();
      if (done) { if (timeout.aborted) throw new ApiFailure(408, 'REQUEST_TIMEOUT'); break; }
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new ApiFailure(413, 'AUDIO_TOO_LARGE'); }
      parts.push(value);
    }
    const raw = new Uint8Array(bytes); let offset = 0; for (const part of parts) { raw.set(part, offset); offset += part.length; }
    const formData = await new Response(raw, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
    const audioFile = formData.get('audio') as File | null;
    const lang = (formData.get('lang') as string) || 'zh';
    if (!(audioFile instanceof File)) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    if (audioFile.size > 3 * 1024 * 1024 || !/^(audio\/|video\/webm)/.test(audioFile.type)) throw new ApiFailure(413, 'INVALID_AUDIO');
    const langInstruction = lang === 'fr'
      ? '\n\nIMPORTANT: The output MUST be in French. All titles and items should be in French.'
      : '\n\nIMPORTANT: The output MUST be in Chinese. All titles and items should be in Chinese.';

    const fullPrompt = SYSTEM_PROMPT + langInstruction;

    const arrayBuffer = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = audioFile.type || 'audio/mpeg';

    // Discover available models and find ones supporting generateContent
    const allModels = await getAvailableModels(apiKey);
    const availableModels = allModels
      .filter((m: string) => m.includes('gemini') && m.includes('generateContent'))
      .map((m: string) => m.split(' [methods:')[0]);

    const modelsToTry = availableModels.length > 0 ? availableModels : MODELS;

    let lastErrorText = '';
    let rawText: string | null = null;

    for (const modelName of modelsToTry.slice(0, 2)) {
      try {
        const url = `${BASE_URL}/${modelName}:generateContent?key=${apiKey}`;
        const geminiResponse = await fetch(url, {
          method: 'POST',
          signal: AbortSignal.timeout(20000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: fullPrompt },
                { inline_data: { mime_type: mimeType, data: base64Audio } },
              ],
            }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
          }),
        });

        if (!geminiResponse.ok) {
          const errBody = await geminiResponse.text();
          lastErrorText = `${modelName}: ${geminiResponse.status} — ${errBody.slice(0, 200)}`;
          console.error(lastErrorText);
          continue;
        }

        const data = await geminiResponse.json();
        rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) break;
      } catch (err: any) {
        lastErrorText = `${modelName}: ${err.message}`;
        console.error(lastErrorText);
      }
    }

    if (!rawText) {
      return NextResponse.json(
        { error: lastErrorText || 'All models failed' },
        { status: 502 }
      );
    }

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = rawText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    const parsed = JSON.parse(jsonStr);
    if (!parsed.columns || !Array.isArray(parsed.columns)) {
      throw new Error('Invalid response structure: missing columns array');
    }

    if (parsed.columns.length > 10 || !parsed.columns.every((c: any) => c && typeof c.title === 'string' && Array.isArray(c.cards) && c.cards.length <= 20 && c.cards.every((v: any) => v && typeof v.title === 'string' && Array.isArray(v.items) && v.items.length <= 50 && v.items.every((t: any) => typeof t === 'string')))) throw new ApiFailure(502, 'INVALID_AI_RESPONSE');
    const sanitized = {
      columns: parsed.columns.map((col: any) => ({
        title: String(col.title || 'Untitled').slice(0, 60),
        cards: (col.cards || []).map((card: any) => ({
          title: String(card.title || 'Untitled').slice(0, 60),
          items: (card.items || []).map((item: any) => String(item || '').slice(0, 100)),
        })),
      })),
    };

    return NextResponse.json(deepMaskSensitiveData(sanitized));
  } catch (error: any) {
    if (error instanceof ApiFailure) throw error;
    console.error('Audio analysis error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
});
