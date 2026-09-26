import { requireSession } from "./auth.js";
import { AppError, errorJson, json, query, toIso } from "./db.js";

export function referralReportDays(value) {
  const days = Number(value || 30);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new AppError("Choose a period from 1 to 90 days.", 400, "INVALID_REPORT_PERIOD");
  }
  return days;
}

export async function referralSummaryForBusiness(businessId, days) {
  const result = await query(
    `SELECT first_referral->>'sourceType' AS source_type,
              first_referral->>'sourceId' AS source_id,
              COUNT(*)::int AS conversations,
              MAX(first_referral_at) AS last_referral_at
       FROM conversations
       WHERE business_id=$1 AND first_referral_at >= NOW() - ($2::int * INTERVAL '1 day')
         AND first_referral->>'sourceType' IN ('AD','POST')
       GROUP BY first_referral->>'sourceType', first_referral->>'sourceId'
       ORDER BY conversations DESC, last_referral_at DESC
       LIMIT 100`,
    [businessId, days]
  );
  return result.rows.map((row) => ({
    sourceType: row.source_type,
    sourceId: row.source_id,
    conversations: row.conversations,
    lastReferralAt: toIso(row.last_referral_at)
  }));
}

export async function getWhatsAppReferralReport(request) {
  try {
    const session = await requireSession(request);
    const days = referralReportDays(new URL(request.url).searchParams.get("days"));
    return json({
      periodDays: days,
      sources: await referralSummaryForBusiness(session.businessId, days)
    });
  } catch (error) {
    return errorJson(error);
  }
}
