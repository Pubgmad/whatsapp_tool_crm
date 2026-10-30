import { requireSession } from './auth.js';
import { AppError, enterTenantContext, errorJson, id, json, query, transaction } from './db.js';
import { assertWorkspaceFeature, workspaceFeatureFlags } from './feature-controls.js';
import { decryptSecret, metaReady, sendTextMessage } from './meta.js';
import { readJsonBodyLimited } from './security.js';
import { requireWorkspaceManager } from './workspace-permissions.js';

function normalize(text = '') {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeRegex(pattern) {
  try {
    const source = String(pattern || '').slice(0, 200);
    if (!source || source.length > 120) return null;
    if (/\(\?[^:]/.test(source)) return null;
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

export function matchReplyRule(rule, inboundText) {
  const text = normalize(inboundText);
  if (!text || !rule?.enabled) return false;
  const pattern = String(rule.pattern || '').trim();
  const synonyms = Array.isArray(rule.synonyms) ? rule.synonyms.map(normalize).filter(Boolean) : [];
  const needles = [normalize(pattern), ...synonyms].filter(Boolean);
  if (rule.match_type === 'exact') return needles.some((item) => text === item);
  if (rule.match_type === 'any_keyword' || rule.match_type === 'contains') {
    return needles.some((item) => item && (text === item || text.includes(item)));
  }
  if (rule.match_type === 'regex') {
    const re = safeRegex(pattern);
    return Boolean(re && re.test(String(inboundText || '')));
  }
  return false;
}

export async function listReplyBots(request) {
  try {
    const session = await requireSession(request);
    await assertWorkspaceFeature('reply_bots', session.businessId);
    const bots = (await query(
      `SELECT b.*, (
         SELECT COUNT(*)::int FROM reply_bot_rules r WHERE r.bot_id=b.id AND r.business_id=b.business_id
       ) AS rule_count
       FROM reply_bots b WHERE b.business_id=$1 ORDER BY b.priority ASC, b.updated_at DESC LIMIT 100`,
      [session.businessId]
    )).rows;
    return json({ bots });
  } catch (error) {
    return errorJson(error);
  }
}

export async function manageReplyBot(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    await assertWorkspaceFeature('reply_bots', session.businessId);
    const body = await readJsonBodyLimited(request, 65536);
    const action = String(body.action || '');

    if (action === 'create') {
      const name = String(body.name || '').trim().slice(0, 120);
      if (!name) throw new AppError('Enter a bot name.', 400, 'VALIDATION_ERROR');
      const botId = id('rb');
      await query(
        `INSERT INTO reply_bots (id, business_id, name, fallback_text, handoff_on_fallback, priority)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [botId, session.businessId, name, String(body.fallbackText || '').slice(0, 1000), body.handoffOnFallback !== false, Number(body.priority) || 100]
      );
      return json({ ok: true, botId });
    }

    if (action === 'update') {
      const result = await query(
        `UPDATE reply_bots SET name=COALESCE(NULLIF($3,''), name), fallback_text=$4, handoff_on_fallback=$5,
         priority=$6, updated_at=NOW() WHERE id=$1 AND business_id=$2 RETURNING id`,
        [body.botId, session.businessId, String(body.name || '').trim().slice(0, 120), String(body.fallbackText || '').slice(0, 1000), body.handoffOnFallback !== false, Number(body.priority) || 100]
      );
      if (!result.rowCount) throw new AppError('Bot not found.', 404, 'NOT_FOUND');
      return json({ ok: true });
    }

    if (action === 'setStatus') {
      if (!['draft', 'published', 'paused'].includes(body.status)) throw new AppError('Invalid status.', 400, 'VALIDATION_ERROR');
      const result = await query(
        `UPDATE reply_bots SET status=$3, published_at=CASE WHEN $3='published' THEN NOW() ELSE published_at END, updated_at=NOW()
         WHERE id=$1 AND business_id=$2 RETURNING id`,
        [body.botId, session.businessId, body.status]
      );
      if (!result.rowCount) throw new AppError('Bot not found.', 404, 'NOT_FOUND');
      return json({ ok: true });
    }

    if (action === 'delete') {
      await query('DELETE FROM reply_bots WHERE id=$1 AND business_id=$2', [body.botId, session.businessId]);
      return json({ ok: true });
    }

    if (action === 'upsertRule') {
      const pattern = String(body.pattern || '').trim().slice(0, 400);
      const replyText = String(body.replyText || '').trim().slice(0, 1000);
      if (!pattern || !replyText) throw new AppError('Pattern and reply are required.', 400, 'VALIDATION_ERROR');
      if (!['exact', 'contains', 'any_keyword', 'regex'].includes(body.matchType || 'contains')) {
        throw new AppError('Unsupported match type.', 400, 'VALIDATION_ERROR');
      }
      if ((body.matchType || 'contains') === 'regex' && !safeRegex(pattern)) {
        throw new AppError('Enter a safe regular expression.', 400, 'VALIDATION_ERROR');
      }
      const bot = (await query('SELECT id FROM reply_bots WHERE id=$1 AND business_id=$2', [body.botId, session.businessId])).rows[0];
      if (!bot) throw new AppError('Bot not found.', 404, 'NOT_FOUND');
      const synonyms = Array.isArray(body.synonyms)
        ? body.synonyms.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20)
        : String(body.synonymsText || '').split(/[,|\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
      if (body.ruleId) {
        await query(
          `UPDATE reply_bot_rules SET match_type=$3, pattern=$4, synonyms=$5::jsonb, reply_text=$6, enabled=$7, sort_order=$8, updated_at=NOW()
           WHERE id=$1 AND business_id=$2 AND bot_id=$9`,
          [body.ruleId, session.businessId, body.matchType || 'contains', pattern, JSON.stringify(synonyms), replyText, body.enabled !== false, Number(body.sortOrder) || 0, body.botId]
        );
        return json({ ok: true, ruleId: body.ruleId });
      }
      const ruleId = id('rbr');
      await query(
        `INSERT INTO reply_bot_rules (id, business_id, bot_id, match_type, pattern, synonyms, reply_text, enabled, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
        [ruleId, session.businessId, body.botId, body.matchType || 'contains', pattern, JSON.stringify(synonyms), replyText, body.enabled !== false, Number(body.sortOrder) || 0]
      );
      return json({ ok: true, ruleId });
    }

    if (action === 'deleteRule') {
      await query('DELETE FROM reply_bot_rules WHERE id=$1 AND business_id=$2', [body.ruleId, session.businessId]);
      return json({ ok: true });
    }

    if (action === 'duplicateRule') {
      const rule = (await query(
        'SELECT * FROM reply_bot_rules WHERE id=$1 AND business_id=$2',
        [body.ruleId, session.businessId]
      )).rows[0];
      if (!rule) throw new AppError('Rule not found.', 404, 'NOT_FOUND');
      const ruleId = id('rbr');
      await query(
        `INSERT INTO reply_bot_rules (id, business_id, bot_id, match_type, pattern, synonyms, reply_text, enabled, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
        [
          ruleId,
          session.businessId,
          rule.bot_id,
          rule.match_type,
          `${rule.pattern} (copy)`.slice(0, 400),
          JSON.stringify(rule.synonyms || []),
          rule.reply_text,
          false,
          Number(rule.sort_order || 0) + 1
        ]
      );
      return json({ ok: true, ruleId });
    }

    if (action === 'listRules') {
      const rules = (await query(
        'SELECT * FROM reply_bot_rules WHERE business_id=$1 AND bot_id=$2 ORDER BY sort_order ASC, created_at ASC',
        [session.businessId, body.botId]
      )).rows;
      return json({ rules });
    }

    if (action === 'test') {
      const preview = await previewReplyBot(session.businessId, String(body.text || ''), body.botId || '');
      return json({ preview });
    }

    throw new AppError('Unsupported action.', 400, 'INVALID_ACTION');
  } catch (error) {
    return errorJson(error);
  }
}

export async function previewReplyBot(businessId, text, botId = '') {
  const bots = (await query(
    `SELECT * FROM reply_bots WHERE business_id=$1 AND ($2='' OR id=$2)
     ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, priority ASC LIMIT 20`,
    [businessId, botId || '']
  )).rows;
  for (const bot of bots) {
    const rules = (await query(
      'SELECT * FROM reply_bot_rules WHERE business_id=$1 AND bot_id=$2 AND enabled ORDER BY sort_order ASC, created_at ASC',
      [businessId, bot.id]
    )).rows;
    for (const rule of rules) {
      if (matchReplyRule(rule, text)) {
        return {
          matched: true,
          botId: bot.id,
          botName: bot.name,
          ruleId: rule.id,
          replyText: rule.reply_text,
          fallback: false
        };
      }
    }
    if (bot.fallback_text) {
      return {
        matched: false,
        botId: bot.id,
        botName: bot.name,
        ruleId: null,
        replyText: bot.fallback_text,
        fallback: true
      };
    }
  }
  return { matched: false, replyText: '', fallback: false };
}

/**
 * Attempt quick-reply bots for an inbound message. Returns match info if a reply was sent.
 * Caller must skip automation/AI when handled=true.
 */
export async function tryHandleReplyBots({ businessId, contactId, conversationId, messageId, text, phoneNumberId }) {
  const flags = await workspaceFeatureFlags(businessId);
  if (!flags.reply_bots) return { handled: false };
  const conversation = (await query(
    'SELECT automation_paused FROM conversations WHERE id=$1 AND business_id=$2',
    [conversationId, businessId]
  )).rows[0];
  if (conversation?.automation_paused) return { handled: false };
  const contact = (await query(
    'SELECT unsubscribed FROM contacts WHERE id=$1 AND business_id=$2',
    [contactId, businessId]
  )).rows[0];
  if (!contact || contact.unsubscribed) return { handled: false };

  const bots = (await query(
    `SELECT * FROM reply_bots WHERE business_id=$1 AND status='published'
     AND ($2='' OR phone_number_id='' OR phone_number_id=$2)
     ORDER BY priority ASC, updated_at DESC LIMIT 20`,
    [businessId, phoneNumberId || '']
  )).rows;
  if (!bots.length) return { handled: false };

  let chosen = null;
  for (const bot of bots) {
    const rules = (await query(
      'SELECT * FROM reply_bot_rules WHERE business_id=$1 AND bot_id=$2 AND enabled ORDER BY sort_order ASC',
      [businessId, bot.id]
    )).rows;
    for (const rule of rules) {
      if (matchReplyRule(rule, text)) {
        chosen = { bot, rule, replyText: rule.reply_text, fallback: false };
        break;
      }
    }
    if (chosen) break;
    // Fallback only after evaluating rules — avoids empty draft bots swallowing all inbound traffic.
    if (rules.length && bot.fallback_text) {
      chosen = { bot, rule: null, replyText: bot.fallback_text, fallback: true };
      break;
    }
  }
  if (!chosen?.replyText) return { handled: false };

  const phone = (await query(
    `SELECT p.phone_number_id, a.access_token_encrypted, a.token_expires_at, c.phone
     FROM conversations conv
     JOIN contacts c ON c.id=conv.contact_id AND c.business_id=conv.business_id
     JOIN whatsapp_phone_numbers p ON p.business_id=conv.business_id AND (p.phone_number_id=$2 OR $2='')
     JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
     WHERE conv.id=$1 AND conv.business_id=$3
     ORDER BY p.is_default DESC LIMIT 1`,
    [conversationId, phoneNumberId || '', businessId]
  )).rows[0];
  if (!phone || !metaReady({ accessToken: decryptSecret(phone.access_token_encrypted), phoneNumberId: phone.phone_number_id, tokenExpiresAt: phone.token_expires_at })) {
    return { handled: false, reason: 'meta_not_ready' };
  }

  const meta = await sendTextMessage({
    setup: { accessToken: decryptSecret(phone.access_token_encrypted), phoneNumberId: phone.phone_number_id },
    to: phone.phone,
    body: chosen.replyText
  });
  await query(
    "INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id) VALUES ($1,$2,'outgoing',$3,$4,$5)",
    [id('m'), conversationId, chosen.replyText, meta.status, meta.metaMessageId]
  );
  await query(
    `INSERT INTO reply_bot_executions (id, business_id, bot_id, rule_id, conversation_id, inbound_message_id, matched_text, reply_text, outcome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id('rbe'), businessId, chosen.bot.id, chosen.rule?.id || null, conversationId, messageId || '', String(text || '').slice(0, 500), chosen.replyText, chosen.fallback ? 'fallback' : 'matched']
  );
  if (chosen.fallback && chosen.bot.handoff_on_fallback) {
    await query(
      'UPDATE conversations SET automation_paused=TRUE, updated_at=NOW(), version=version+1 WHERE id=$1 AND business_id=$2',
      [conversationId, businessId]
    );
  }
  return { handled: true, botId: chosen.bot.id, ruleId: chosen.rule?.id || null, fallback: chosen.fallback };
}
