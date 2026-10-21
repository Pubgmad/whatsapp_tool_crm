'use client';

import { useMemo, useState } from 'react';
import styles from '../app/marketing.module.css';
import { planMarketingFeatures } from '../lib/plan-features.js';

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'INR' }).format((Number(cents) || 0) / 100);
  } catch {
    return `${currency || 'INR'} ${((Number(cents) || 0) / 100).toFixed(2)}`;
  }
}

function isFreePlan(plan) {
  const code = String(plan.code || plan.name || '').toLowerCase();
  const monthly = Number(plan.monthly_price_cents) || 0;
  const yearly = Number(plan.yearly_price_cents) || 0;
  return monthly <= 0 && yearly <= 0 && (code.includes('free') || code === 'trial');
}

/**
 * Public pricing cards with monthly/annual toggle.
 * Amounts come from Super Admin subscription_plans (visible + active only).
 * Free Forever shows ₹0. Other zero-priced visible plans show as draft/contact.
 */
export default function PricingPlans({ plans = [], ctaHref = '/signup', ctaLabel = 'Get started' }) {
  const [interval, setInterval] = useState('monthly');
  const hasAnnual = useMemo(
    () => plans.some((plan) => Number(plan.yearly_price_cents) > 0),
    [plans]
  );

  if (!plans.length) {
    return (
      <p className={styles.sectionLead}>
        No public plans are published yet. Run database initialization to seed Free Forever, or publish plans in Super Admin.
      </p>
    );
  }

  return (
    <div>
      {hasAnnual ? (
        <div className={styles.pricingToggle} role="group" aria-label="Billing interval">
          <button
            type="button"
            className={interval === 'monthly' ? styles.pricingToggleActive : undefined}
            aria-pressed={interval === 'monthly'}
            onClick={() => setInterval('monthly')}
          >
            Monthly
          </button>
          <button
            type="button"
            className={interval === 'yearly' ? styles.pricingToggleActive : undefined}
            aria-pressed={interval === 'yearly'}
            onClick={() => setInterval('yearly')}
          >
            Annual
          </button>
        </div>
      ) : null}
      <div className={styles.planGrid}>
        {plans.map((plan) => {
          const monthly = Number(plan.monthly_price_cents) || 0;
          const yearly = Number(plan.yearly_price_cents) || 0;
          const useYearly = interval === 'yearly' && yearly > 0;
          const amount = useYearly ? yearly : monthly;
          const period = useYearly ? ' / year' : ' / month';
          const free = isFreePlan(plan);
          const isDraftPaid = !free && amount <= 0;
          return (
            <article className={`${styles.plan}${free ? ` ${styles.planFeatured}` : ''}`} key={plan.id}>
              <h3>{plan.name}</h3>
              {plan.description ? <p>{plan.description}</p> : null}
              <strong>
                {free ? formatMoney(0, plan.currency) : isDraftPaid ? 'Contact for pricing' : formatMoney(amount, plan.currency)}
                {free || !isDraftPaid ? <small>{free ? ' / forever' : period}</small> : null}
              </strong>
              {isDraftPaid ? (
                <p className={styles.sectionLead}>
                  Commercial rates are set by Super Admin. This card is visible for structure only until prices are published.
                </p>
              ) : null}
              {planMarketingFeatures(plan.features).length > 0 ? (
                <ul>{planMarketingFeatures(plan.features).map((feature, index) => <li key={index}>{feature}</li>)}</ul>
              ) : null}
              <a className={styles.btnPrimary} href={ctaHref}>{free ? 'Get started free' : ctaLabel}</a>
            </article>
          );
        })}
      </div>
    </div>
  );
}
