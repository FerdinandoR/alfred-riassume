import fetch from 'node-fetch';
import {
  RecurringIssue,
  Review,
  ReviewSentiment,
  ReviewWithSentiment,
} from '../types';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-70b-versatile';

function getApiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      'GROQ_API_KEY is not set. Please copy your key from groq.txt into an environment variable.',
    );
  }
  return key;
}

type ChatMessage = {
  role: 'system' | 'user';
  content: string;
};

async function createChatCompletion(
  messages: ChatMessage[],
): Promise<string> {
  const apiKey = getApiKey();

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq API error: ${res.status} ${text}`);
  }

  const data = (await res.json()) as any;
  const content: string | undefined =
    data.choices?.[0]?.message?.content ?? '';
  if (!content) {
    throw new Error('Groq API returned empty content.');
  }
  return content;
}

export async function classifySentiments(
  reviews: Review[],
): Promise<ReviewWithSentiment[]> {
  if (reviews.length === 0) return [];

  const chunks: Review[][] = [];
  const chunkSize = 20;
  for (let i = 0; i < reviews.length; i += chunkSize) {
    chunks.push(reviews.slice(i, i + chunkSize));
  }

  const results: ReviewWithSentiment[] = [];

  // Process chunks sequentially to keep things simple and within limits.
  for (const chunk of chunks) {
    const contentLines = chunk.map(
      (r, idx) =>
        `${idx + 1}. [${r.rating} stars] ${r.text.replace(/\s+/g, ' ').slice(0, 800)}`,
    );

    const responseText = await createChatCompletion([
      {
        role: 'system',
        content:
          'You classify customer reviews as positive, negative, or neutral based on sentiment towards the business.',
      },
      {
        role: 'user',
        content: `
For each of the following reviews, output a JSON array of objects:
[{ "index": number, "sentiment": "positive" | "negative" | "neutral" }]

Reviews:
${contentLines.join('\n')}
        `.trim(),
      },
    ]);

    let parsed: Array<{ index: number; sentiment: ReviewSentiment }> = [];
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      // Fallback: mark everything as neutral if parsing fails.
      parsed = chunk.map((_, idx) => ({
        index: idx + 1,
        sentiment: 'neutral',
      }));
    }

    for (const item of parsed) {
      const idx = item.index - 1;
      const sentiment: ReviewSentiment =
        item.sentiment === 'positive' ||
        item.sentiment === 'negative' ||
        item.sentiment === 'neutral'
          ? item.sentiment
          : 'neutral';
      const review = chunk[idx];
      if (review) {
        results.push({ review, sentiment });
      }
    }
  }

  return results;
}

export async function detectRecurringIssues(
  reviews: ReviewWithSentiment[],
): Promise<RecurringIssue[]> {
  if (reviews.length === 0) return [];

  // Sample up to 80 reviews for theme detection to keep prompts manageable.
  const sampleSize = Math.min(80, reviews.length);
  const sampled = reviews.slice(0, sampleSize);

  const lines = sampled.map(
    (r, idx) =>
      `${idx + 1}. (${r.sentiment}) ${r.review.text.replace(/\s+/g, ' ').slice(0, 600)}`,
  );

  const responseText = await createChatCompletion([
    {
      role: 'system',
      content:
        'You analyze reviews to find recurring requests, complaints, and recommendations.',
    },
    {
      role: 'user',
      content: `
From the following reviews, identify recurring requests/complaints/recommendations.
Return JSON in this form:
[
  {
    "label": "short title",
    "description": "1-2 sentence explanation",
    "frequency": number,
    "exampleIndexes": [numbers]
  }
]

Reviews:
${lines.join('\n')}
      `.trim(),
    },
  ]);

  let parsed:
    | Array<{
        label: string;
        description: string;
        frequency: number;
        exampleIndexes?: number[];
      }>
    | null = null;

  try {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
  } catch {
    parsed = null;
  }

  if (!parsed) return [];

  const issues: RecurringIssue[] = parsed.map((item) => {
    const exampleIds: string[] = [];
    if (Array.isArray(item.exampleIndexes)) {
      for (const idx of item.exampleIndexes) {
        const reviewIdx = idx - 1;
        const r = sampled[reviewIdx];
        if (r) exampleIds.push(r.review.id);
      }
    }

    return {
      label: item.label,
      description: item.description,
      frequency: item.frequency,
      exampleReviewIds: exampleIds,
    };
  });

  return issues;
}


