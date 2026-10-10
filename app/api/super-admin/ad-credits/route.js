import { requireSuperAdmin } from '@/lib/super-admin.js';
import { adminGrantAdCredits } from '@/lib/ad-credits.js';
import { AppError, enterSystemContext, errorJson, id, json, query } from '@/lib/db.js';
import { readJsonBodyLimited } from '@/lib/security.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    await requireSuperAdmin(request);
    enterSystemContext();
    const packages = (
      await query(
        `SELECT id, name, currency, credits_minor, price_minor, display_order, visible, is_active
         FROM ad_credit_packages ORDER BY display_order, name`
      )
    ).rows;
    const wallets = (
      await query(
        `SELECT w.business_id, b.name AS company_name, w.currency, w.balance_minor, w.reserved_minor, w.starter_granted, w.updated_at
         FROM ad_credit_wallets w JOIN businesses b ON b.id=w.business_id
         ORDER BY w.updated_at DESC LIMIT 100`
      )
    ).rows;
    return json({ packages, wallets });
  } catch (error) {
    return errorJson(error);
  }
}

export async function POST(request) {
  try {
    const admin = await requireSuperAdmin(request);
    enterSystemContext();
    const body = await readJsonBodyLimited(request, 16000);
    if (body.action === 'grant') {
      const result = await adminGrantAdCredits({
        businessId: String(body.businessId || ''),
        amountMinor: Number(body.amountMinor),
        note: String(body.note || 'Super Admin grant'),
        adminId: admin.id
      });
      await query('INSERT INTO platform_audit_logs (id,super_admin_id,action,metadata) VALUES ($1,$2,$3,$4)', [
        id('pa'),
        admin.id,
        'ad_credits_admin_grant',
        JSON.stringify({ businessId: body.businessId, amountMinor: body.amountMinor })
      ]);
      return json({ ok: true, ...result });
    }
    if (body.action === 'upsertPackage') {
      const packId = String(body.id || id('adp'));
      await query(
        `INSERT INTO ad_credit_packages (id, name, currency, credits_minor, price_minor, display_order, visible, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, currency=EXCLUDED.currency, credits_minor=EXCLUDED.credits_minor,
           price_minor=EXCLUDED.price_minor, display_order=EXCLUDED.display_order,
           visible=EXCLUDED.visible, is_active=EXCLUDED.is_active`,
        [
          packId,
          String(body.name || '').slice(0, 120),
          String(body.currency || 'INR').toUpperCase(),
          Number(body.creditsMinor),
          Number(body.priceMinor),
          Number(body.displayOrder || 100),
          body.visible !== false,
          body.isActive !== false
        ]
      );
      return json({ ok: true, id: packId });
    }
    throw new AppError('Unsupported ad-credits admin action.', 400, 'INVALID_ACTION');
  } catch (error) {
    return errorJson(error);
  }
}
