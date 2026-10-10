import { id, query } from './db.js';
import { cosineSimilarity, embedQuery, embedTexts, embeddingModel } from './ai-embeddings.js';
import { aiRuntimeTunables } from './ai-policy.js';

export function knowledgeSearchTerms(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].slice(0, 12);
}

export function chunkKnowledgeContent(content, { chunkSize, chunkOverlap } = {}) {
  return chunkKnowledgeContentWithTunables(content, { chunkSize, chunkOverlap });
}

function chunkKnowledgeContentWithTunables(content, { chunkSize = 1200, chunkOverlap = 150 } = {}) {
  const text = String(content || '').trim();
  if (!text) return [];
  if (text.length <= chunkSize) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + chunkSize);
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(0, end - chunkOverlap);
  }
  return chunks.filter(Boolean);
}

export async function reindexKnowledgeChunks(client, { businessId, knowledgeId, content, embeddingEnabled = true }) {
  const tunables = await aiRuntimeTunables(client.query.bind(client));
  await client.query('DELETE FROM ai_knowledge_chunks WHERE business_id=$1 AND knowledge_id=$2', [businessId, knowledgeId]);
  const chunks = chunkKnowledgeContentWithTunables(content, {
    chunkSize: tunables.chunkSize,
    chunkOverlap: tunables.chunkOverlap
  });
  let embeddings = [];
  if (embeddingEnabled && process.env.OPENAI_API_KEY?.trim()) {
    try {
      embeddings = await embedTexts(chunks);
    } catch {
      embeddings = [];
    }
  }
  const model = embeddings.length ? embeddingModel() : '';
  for (let index = 0; index < chunks.length; index += 1) {
    await client.query(
      `INSERT INTO ai_knowledge_chunks(id,business_id,knowledge_id,chunk_index,content,embedding,embedding_model)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        id('aikc'),
        businessId,
        knowledgeId,
        index,
        chunks[index],
        embeddings[index] ? JSON.stringify(embeddings[index]) : null,
        model
      ]
    );
  }
  return chunks.length;
}

export async function retrieveKnowledgeSources(businessId, question, {
  agentId = null,
  limit = 5,
  embeddingEnabled = true,
  execute = query
} = {}) {
  const tunables = await aiRuntimeTunables(execute);
  const effectiveLimit = Math.min(20, Math.max(1, Number(limit) || tunables.retrievalLimit));
  const terms = knowledgeSearchTerms(question);
  if (!terms.length) return [];
  const tsQuery = terms.join(' | ');
  const agentClause = agentId ? 'AND (k.agent_id IS NULL OR k.agent_id=$3)' : '';
  const fetchLimit = Math.min(40, effectiveLimit * 4);
  const params = agentId ? [businessId, tsQuery, agentId, fetchLimit] : [businessId, tsQuery, fetchLimit];
  const limitParam = agentId ? '$4' : '$3';

  const chunkHits = await execute(
    `SELECT k.id,k.title,c.content,c.embedding,
       ts_rank(to_tsvector('simple', c.content), to_tsquery('simple',$2)) AS rank
     FROM ai_knowledge_chunks c
     JOIN ai_agent_knowledge k ON k.id=c.knowledge_id AND k.business_id=c.business_id
     WHERE c.business_id=$1 AND k.is_active
       AND to_tsvector('simple', c.content) @@ to_tsquery('simple',$2)
       ${agentClause}
     ORDER BY rank DESC, k.updated_at DESC
     LIMIT ${limitParam}`,
    params
  );

  let candidates = chunkHits.rows;
  if (!candidates.length) {
    const docs = await execute(
      `SELECT k.id,k.title,k.content,NULL::jsonb AS embedding,
         ts_rank(to_tsvector('simple', coalesce(k.title,'')||' '||coalesce(k.content,'')), to_tsquery('simple',$2)) AS rank
       FROM ai_agent_knowledge k
       WHERE k.business_id=$1 AND k.is_active
         AND to_tsvector('simple', coalesce(k.title,'')||' '||coalesce(k.content,'')) @@ to_tsquery('simple',$2)
         ${agentClause}
       ORDER BY rank DESC, k.updated_at DESC
       LIMIT ${limitParam}`,
      params
    );
    candidates = docs.rows;
  }

  if (embeddingEnabled && process.env.OPENAI_API_KEY?.trim() && candidates.some((row) => Array.isArray(row.embedding) || typeof row.embedding === 'string')) {
    try {
      const queryVector = await embedQuery(question);
      if (queryVector) {
        candidates = candidates.map((row) => {
          const vector = Array.isArray(row.embedding) ? row.embedding
            : typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
          const semantic = cosineSimilarity(queryVector, vector);
          return { ...row, score: Number(row.rank || 0) + semantic * 2 };
        }).sort((left, right) => right.score - left.score);
      }
    } catch {
      // FTS ranking remains valid when embeddings are unavailable
    }
  }

  const seen = new Set();
  return candidates.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  }).slice(0, effectiveLimit).map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    kind: 'knowledge'
  }));
}
