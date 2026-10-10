import { AppError } from './db.js';

const DEFAULT_MODEL = 'text-embedding-3-small';
const openaiReady = () => Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim());

export function embeddingModel() {
  return String(process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function embedTexts(texts, { key = process.env.OPENAI_API_KEY, model = embeddingModel(), fetcher = fetch } = {}) {
  const inputs = (Array.isArray(texts) ? texts : []).map((text) => String(text || '').slice(0, 8000)).filter(Boolean);
  if (!inputs.length) return [];
  if (!openaiReady() || !key?.trim()) throw new AppError('Embeddings require OpenAI configuration.', 503, 'OPENAI_NOT_CONFIGURED');
  const response = await fetcher('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: inputs }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new AppError('The embedding provider is unavailable.', 502, 'OPENAI_EMBEDDINGS_UNAVAILABLE');
  const payload = await response.json();
  const vectors = (payload.data || []).sort((left, right) => left.index - right.index).map((row) => row.embedding);
  if (vectors.length !== inputs.length || vectors.some((vector) => !Array.isArray(vector) || !vector.length)) {
    throw new AppError('The embedding provider returned an invalid response.', 502, 'OPENAI_EMBEDDINGS_INVALID');
  }
  return vectors;
}

export async function embedQuery(text, options = {}) {
  const [vector] = await embedTexts([text], options);
  return vector || null;
}
