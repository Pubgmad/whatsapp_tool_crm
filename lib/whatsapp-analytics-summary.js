/** Summarize stored Meta WABA analytics snapshot payloads for UI display. */
export function summarizeAnalyticsPayload(payload = {}) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const points = Array.isArray(source.analytics?.data_points)
    ? source.analytics.data_points
    : Array.isArray(source.analytics?.data)
      ? source.analytics.data
      : [];
  const conversations = Array.isArray(source.conversation_analytics?.data)
    ? source.conversation_analytics.data
    : Array.isArray(source.conversation_analytics?.data_points)
      ? source.conversation_analytics.data_points
      : [];

  const sumField = (rows, keys) => rows.reduce((total, row) => {
    for (const key of keys) {
      const value = Number(row?.[key]);
      if (Number.isFinite(value)) return total + value;
    }
    return total;
  }, 0);

  const sent = sumField(points, ['sent', 'sent_count', 'messages_sent']);
  const delivered = sumField(points, ['delivered', 'delivered_count', 'messages_delivered']);
  const read = sumField(points, ['read', 'read_count', 'messages_read']);
  const conversationCount = sumField(conversations, ['conversation', 'conversation_count', 'count']);
  const cost = sumField(conversations, ['cost', 'cost_count']);

  return {
    sent,
    delivered,
    read,
    conversations: conversationCount,
    cost,
    hasMetrics: sent > 0 || delivered > 0 || read > 0 || conversationCount > 0 || points.length > 0 || conversations.length > 0,
    pointCount: points.length,
    conversationRows: conversations.length
  };
}
