import axios from 'axios';
import { getConfig } from '../config.js';
import type { PageAnalysis, RuntimeCredentials, ScoredCandidate } from '../types.js';

function extractDateSnippet(html?: string): string | null {
  if (!html) return null;
  const patterns = [
    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?,?\s*\d{4}/i,
    /\d{1,2}(?:\s*[-–]\s*\d{1,2})?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s*\d{4}/i,
    /20\d{2}-\d{2}-\d{2}/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[0];
  }
  return null;
}

export async function aiResolveAmbiguity(
  company: string,
  candidates: ScoredCandidate[],
  pageAnalyses: PageAnalysis[],
  credentials?: RuntimeCredentials
): Promise<{ selectedUrl: string; reasoning: string }> {
  const config = getConfig();
  const nvidiaApiKey = credentials?.nvidiaApiKey ?? config.nvidiaApiKey;
  const nvidiaModel = credentials?.nvidiaModel ?? config.nvidiaModel;
  const anthropicApiKey = credentials?.anthropicApiKey ?? config.anthropicApiKey;

  if (!nvidiaApiKey && !anthropicApiKey) {
    throw new Error('NVIDIA_API_KEY or ANTHROPIC_API_KEY not configured');
  }

  const candidateSummaries = candidates.map((c, i) => ({
    rank: i + 1,
    url: c.url,
    title: c.title,
    score: c.score,
    hasRegistration: (pageAnalyses[i]?.formActions?.length ?? 0) > 0,
    futureDate: extractDateSnippet(pageAnalyses[i]?.htmlContent) ?? undefined,
  }));

  const prompt = `You are helping identify the flagship annual event for "${company}".

Here are the candidate event pages found via search:

${JSON.stringify(candidateSummaries, null, 2)}

Which URL is most likely the company's official flagship event page?
Respond with JSON only: { "selectedUrl": "...", "reasoning": "..." }`;

  const text = nvidiaApiKey
    ? await resolveWithNvidia(prompt, nvidiaApiKey, nvidiaModel)
    : await resolveWithAnthropic(prompt, anthropicApiKey!);

  const parsed = parseJsonObject(text);
  if (!parsed?.selectedUrl) throw new Error('AI response missing selectedUrl');
  return { selectedUrl: String(parsed.selectedUrl), reasoning: String(parsed.reasoning ?? '') };
}

function parseJsonObject(text: string): { selectedUrl?: string; reasoning?: string } {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI response did not contain JSON');
    return JSON.parse(match[0]);
  }
}

async function resolveWithNvidia(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await axios.post(
    'https://integrate.api.nvidia.com/v1/chat/completions',
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      top_p: 0.7,
      max_tokens: 500,
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      timeout: 45_000,
    }
  );

  return response.data?.choices?.[0]?.message?.content ?? '';
}

async function resolveWithAnthropic(prompt: string, apiKey: string): Promise<string> {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 45_000,
    }
  );

  return response.data?.content?.[0]?.text ?? '';
}
