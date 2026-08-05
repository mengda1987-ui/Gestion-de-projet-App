import { NextRequest, NextResponse } from 'next/server';

// Gemini 3-level mind map structure prompt
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

    // Get MIME type
    const mimeType = audioFile.type || 'audio/mpeg';

    // Call Gemini API directly via fetch
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: SYSTEM_PROMPT },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Audio,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 4096,
          },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return NextResponse.json(
        { error: `Gemini API error: ${geminiResponse.status}` },
        { status: 502 }
      );
    }

    const geminiData = await geminiResponse.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return NextResponse.json(
        { error: 'No content returned from Gemini' },
        { status: 502 }
      );
    }

    // Parse the JSON from Gemini's response (handle markdown code blocks)
    let jsonStr = rawText.trim();
    // Remove markdown code blocks if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate structure
    if (!parsed.columns || !Array.isArray(parsed.columns)) {
      throw new Error('Invalid response structure: missing columns array');
    }

    // Sanitize and ensure structure
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
