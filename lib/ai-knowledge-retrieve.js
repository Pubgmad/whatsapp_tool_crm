import { id, query } from './db.js';

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

export function knowledgeSearchTerms(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].slice(0, 12);
}

export function chunkKnowledgeContent(content) {
  const text = String(content || '').trim();
  if (!text) return [];
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + CHUNK_SIZE);
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks.filter(Boolean);
}

export async function reindexKnowledgeChunks(client, { businessId, knowledgeId, content }) {
  await client.query('DELETE FROM ai_knowledge_chunks WHERE business_id=$1 AND knowledge_id=$2', [businessId, knowledgeId]);
  const chunks = chunkKnowledgeContent(content);
  for (let index = 0; index < chunks.length; index += 1) {
    await client.query(
      'INSERT INTO ai_knowledge_chunks(id,business_id,knowledge_id,chunk_index,content) VALUES($1,$2,$3,$4,$5)',
      [id('aikc'), businessId, knowledgeId, index, chunks[index]]
    );
  }
  return chunks.length;
}

export async function retrieveKnowledgeSources(businessId, question, { agentId = null, limit = 5, execute = query } = {}) {
  const terms = knowledgeSearchTerms(question);
  if (!terms.length) return [];
  const tsQuery = terms.join(' | ');
  const agentClause = agentId ? 'AND (k.agent_id IS NULL OR k.agent_id=$3)' : '';
  const params = agentId ? [businessId, tsQuery, agentId, limit] : [businessId, tsQuery, limit];
  const limitParam = agentId ? '$4' : '$3';

  const chunkHits = await execute(
    `SELECT k.id,k.title,c.content,
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

  if (chunkHits.rows.length) {
    const seen = new Set();
    return chunkHits.rows.filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    }).slice(0, limit).map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      kind: 'knowledge'
    }));
  }

  const docs = await execute(
    `SELECT k.id,k.title,k.content,
       ts_rank(to_tsvector('simple', coalesce(k.title,'')||' '||coalesce(k.content,'')), to_tsquery('simple',$2)) AS rank
     FROM ai_agent_knowledge k
     WHERE k.business_id=$1 AND k.is_active
       AND to_tsvector('simple', coalesce(k.title,'')||' '||coalesce(k.content,'')) @@ to_tsquery('simple',$2)
       ${agentClause}
     ORDER BY rank DESC, k.updated_at DESC
     LIMIT ${limitParam}`,
    params
  );
  return docs.rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    kind: 'knowledge'
  }));
}
