import { NextRequest, NextResponse } from 'next/server';

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
    const res = await fetch(url);
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

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
  const models = await getAvailableModels(apiKey);
  return NextResponse.json({ availableModels: models });
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const lang = (formData.get('lang') as string) || 'zh';
    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    const langInstruction = lang === 'fr'
      ? '\n\nIMPORTANT: The output MUST be in French. All titles and items should be in French.'
      : '\n\nIMPORTANT: The output MUST be in Chinese. All titles and items should be in Chinese.';

    const fullPrompt = SYSTEM_PROMPT + langInstruction;

    // Discover available models and find ones supporting generateContent
    const allModels = await getAvailableModels(apiKey);
    const availableModels = allModels
      .filter((m: string) => m.includes('gemini') && m.includes('generateContent'))
      .map((m: string) => m.split(' [methods:')[0]);
    console.log('Available models:', availableModels);

    const modelsToTry = availableModels.length > 0 ? availableModels : MODELS;

    let lastErrorText = '';
    let rawText: string | null = null;

    for (const modelName of modelsToTry) {
      try {
        const url = `${BASE_URL}/${modelName}:generateContent?key=${apiKey}`;
        const geminiResponse = await fetch(url, {
          method: 'POST',
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

    const sanitized = {
      columns: parsed.columns.map((col: any) => ({
        title: String(col.title || 'Untitled').slice(0, 60),
        cards: (col.cards || []).map((card: any) => ({
          title: String(card.title || 'Untitled').slice(0, 60),
          items: (card.items || []).map((item: any) => String(item || '').slice(0, 100)),
        })),
      })),
    };

    return NextResponse.json(sanitized);
  } catch (error: any) {
    console.error('Audio analysis error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
