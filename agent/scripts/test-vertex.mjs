/**
 * Standalone Vertex AI / Gemini smoke test.
 *
 * Reads the same env vars the agent uses, fires one trivial generateContent
 * call, and prints either the model reply or the *raw* HTTP error body —
 * which is what gets hidden behind "Unexpected token '<'" when the SDK
 * tries to JSON.parse an HTML error page.
 *
 * Run inside the agent container:
 *   docker compose exec agent node scripts/test-vertex.mjs
 */

import { GoogleGenAI } from '@google/genai';

const project = process.env.GCP_PROJECT_ID;
const location = process.env.GCP_LLM_LOCATION || 'us-central1';
const modelName = process.env.GCP_LLM_MODEL || 'gemini-2.5-flash';
const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!project) {
  console.error('missing GCP_PROJECT_ID');
  process.exit(2);
}

console.log('[probe] project:', project);
console.log('[probe] location:', location);
console.log('[probe] model:', modelName);
console.log('[probe] GOOGLE_APPLICATION_CREDENTIALS:', creds || '(unset)');

// Patch global fetch to print the raw error body when Google returns non-2xx.
const origFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const res = await origFetch(...args);
  if (!res.ok) {
    const cloned = res.clone();
    const text = await cloned.text().catch(() => '(could not read body)');
    console.error(`[probe] HTTP ${res.status} ${res.statusText} from ${args[0]}`);
    console.error('[probe] body (first 800 chars):\n' + text.slice(0, 800));
  }
  return res;
};

const ai = new GoogleGenAI({ vertexai: true, project, location });

try {
  const t0 = Date.now();
  const res = await ai.models.generateContent({
    model: modelName,
    contents: 'Say hello in 5 words.',
    config: { temperature: 0.2, maxOutputTokens: 64 },
  });
  const reply = res.text ?? '(no text)';
  console.log(`[probe] OK — ${Date.now() - t0}ms`);
  console.log('[probe] reply:', reply.trim());
  process.exit(0);
} catch (err) {
  console.error(`[probe] FAILED`);
  console.error(err);
  process.exit(1);
}
