import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not configured' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    // Convert audio to base64
    const arrayBuffer = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = audioFile.type || 'audio/mpeg';

    // Use the official SDK
    const genAI = new GoogleGenerativeAI(apiKey);

    // Try models in order: gemini-1.5-flash (widely available, supports audio)
    const models = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];

    let lastError: Error | null = null;
    let rawText: string | null = null;

    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });

        const result = await model.generateContent([
          { text: SYSTEM_PROMPT },
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
        ]);

        const response = result.response;
        rawText = response.text();

        if (rawText) {
          console.log(`Success with model: ${modelName}`);
          break;
        }
      } catch (err: any) {
        console.error(`Model ${modelName} failed:`, err.message);
        lastError = err;

        // If the error message contains model-specific hints, try next
        if (err.message?.includes('not found') || err.status === 404) {
          continue;
        }
        // For other errors (auth, quota, etc.), stop retrying
        throw err;
      }
    }

    if (!rawText) {
      return NextResponse.json(
        { error: lastError?.message || 'All models failed' },
        { status: 502 }
      );
    }

    // Parse the JSON from Gemini's response (handle markdown code blocks)
    let jsonStr = rawText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

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
