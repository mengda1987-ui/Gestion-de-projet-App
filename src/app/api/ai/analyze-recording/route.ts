import { NextRequest, NextResponse } from 'next/server';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

const SYSTEM_PROMPT = `You are a meeting analyzer. You will receive a meeting transcript.
Your task:
1. Identify the main meeting topic as the "title"
2. Break the meeting into logical topic sections (each becomes a board COLUMN)
3. For each topic section, extract actionable tasks as CARDS
4. For each task, break it down into concrete step-by-step CHECKLIST items
5. If dates or deadlines are mentioned, assign due dates in ISO format (YYYY-MM-DD)

CRITICAL: You MUST respond with ONLY a valid JSON object in this EXACT structure. No markdown, no backticks, no extra text:

{
  "title": "Meeting Title",
  "columns": [
    {
      "title": "Topic Section",
      "cards": [
        {
          "title": "Actionable Task",
          "description": "Context and details from the meeting",
          "dueDate": "2026-08-15",
          "checklists": [
            {
              "name": "Steps",
              "items": [
                { "text": "Concrete first step", "dueDate": "2026-08-10" },
                { "text": "Concrete second step" }
              ]
            }
          ]
        }
      ]
    }
  ]
}

Rules:
- "title" and "columns" are required at the root level
- "title" for each column, card, checklist, and item is required
- dueDate is optional (only if mentioned), use ISO YYYY-MM-DD format
- description is optional
- "items" array can be empty if no substeps are needed
- Keep card titles concise action-oriented
- Keep item texts as concrete achievable steps
- Do NOT include any explanation, just the JSON`;

export async function POST(req: NextRequest) {
  if (!DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: 'DeepSeek API key not configured' }, { status: 500 });
  }

  let body: { transcript: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const transcript = body.transcript?.trim();
  if (!transcript) {
    return NextResponse.json({ error: 'No transcript text provided' }, { status: 400 });
  }

  // Limit transcript to ~50000 chars (DeepSeek context window)
  const truncated = transcript.slice(0, 50000);

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyze this meeting transcript and output structured JSON:\n\n${truncated}` },
        ],
        temperature: 0.1,
        max_tokens: 8192,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('DeepSeek API error:', response.status, errText);
      return NextResponse.json(
        { error: `DeepSeek API error ${response.status}: ${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ error: 'No response from DeepSeek' }, { status: 502 });
    }

    // Parse the JSON from DeepSeek's response
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1]);
        } catch {
          return NextResponse.json({ error: 'Failed to parse AI response as JSON' }, { status: 502 });
        }
      } else {
        return NextResponse.json({ error: 'Failed to parse AI response as JSON' }, { status: 502 });
      }
    }

    if (!parsed.columns || !Array.isArray(parsed.columns) || parsed.columns.length === 0) {
      return NextResponse.json({ error: 'AI response missing required "columns" array' }, { status: 502 });
    }

    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error('Analyze recording error:', err);
    return NextResponse.json({ error: 'Server error processing request' }, { status: 500 });
  }
}
