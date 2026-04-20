/**
 * Thin Gemini (Vertex AI) wrapper.
 *
 * The agent never uses raw model calls — everything goes through a YAML
 * prompt file. This module loads the file, fills its template vars,
 * and invokes Gemini with the configured defaults.
 *
 * Authentication uses Application Default Credentials; set
 * GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path, or rely
 * on the GCE/Workload Identity metadata server in production.
 */

import { VertexAI, type GenerativeModel } from '@google-cloud/vertexai';
import type { AgentConfig } from '../config.js';
import { loadPrompt, fill } from './prompts.js';

export interface LLMClient {
  /** Run a prompt file, substituting `{{var}}` placeholders, return the raw text. */
  runText: (promptFile: string, vars: PromptVars) => Promise<string>;
  /** Run a prompt file whose response_mime_type is application/json, return parsed JSON. */
  runJson: <T = unknown>(promptFile: string, vars: PromptVars) => Promise<T>;
}

export type PromptVars = Record<string, string | number | null | undefined>;

export function createLLMClient(config: AgentConfig): LLMClient {
  const vertex = new VertexAI({
    project: config.gemini.project,
    location: config.gemini.location,
  });

  const modelCache = new Map<string, GenerativeModel>();
  const getModel = (modelName: string, mime?: string, temperature?: number, maxTokens?: number) => {
    const key = `${modelName}|${mime ?? ''}|${temperature ?? ''}|${maxTokens ?? ''}`;
    const existing = modelCache.get(key);
    if (existing) return existing;
    const model = vertex.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: temperature ?? 0.4,
        maxOutputTokens: maxTokens ?? 4096,
        ...(mime ? { responseMimeType: mime } : {}),
      },
    });
    modelCache.set(key, model);
    return model;
  };

  const invoke = async (promptFile: string, vars: PromptVars): Promise<string> => {
    const prompt = await loadPrompt(config.storage.promptsDir, promptFile);
    const systemText = fill(prompt.system, vars);
    const userText = fill(prompt.user, vars);

    const model = getModel(
      prompt.model ?? config.gemini.model,
      prompt.response_mime_type,
      prompt.temperature,
      prompt.max_output_tokens
    );

    const res = await model.generateContent({
      systemInstruction: { role: 'system', parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
    });

    const candidate = res.response?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || text.length === 0) {
      const finishReason = candidate?.finishReason ?? 'UNKNOWN';
      const blockReason = res.response?.promptFeedback?.blockReason;
      throw new Error(
        `LLM returned empty response for prompt ${promptFile} (finishReason=${finishReason}${
          blockReason ? `, promptBlocked=${blockReason}` : ''
        })`
      );
    }
    return text;
  };

  return {
    runText: invoke,
    async runJson<T = unknown>(promptFile: string, vars: PromptVars): Promise<T> {
      const text = await invoke(promptFile, vars);
      try {
        return JSON.parse(text) as T;
      } catch (err) {
        throw new Error(
          `LLM ${promptFile} returned invalid JSON (first 200 chars: ${text.slice(0, 200)}): ${(err as Error).message}`
        );
      }
    },
  };
}
