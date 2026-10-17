'use client';

import { useMemo, useState } from 'react';
import styles from '../app/marketing.module.css';

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'INR' }).format((Number(cents) || 0) / 100);
  } catch {
    return `${currency || 'INR'} ${((Number(cents) || 0) / 100).toFixed(2)}`;
  }
}

/**
 * Public pricing cards with monthly/annual toggle.
 * Amounts come from Super Admin subscription_plans (visible + active only).
 * Zero-priced plans are shown as draft/contact rather than invented commercial rates.
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
        No public plans are published yet. Super Admin can create and publish plans from the platform console.
        Draft commercial prices must be approved before they appear here.
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
          const isDraftPrice = amount <= 0;
          return (
            <article className={styles.plan} key={plan.id}>
              <h3>{plan.name}</h3>
              {plan.description ? <p>{plan.description}</p> : null}
              <strong>
                {isDraftPrice ? 'Contact for pricing' : formatMoney(amount, plan.currency)}
                {!isDraftPrice ? <small>{period}</small> : null}
              </strong>
              {isDraftPrice ? (
                <p className={styles.sectionLead}>
                  Platform fee is configured by Super Admin. This card is visible for structure only until commercial rates are published.
                </p>
              ) : null}
              {Array.isArray(plan.features) && plan.features.length > 0 ? (
                <ul>{plan.features.map((feature, index) => <li key={index}>{feature}</li>)}</ul>
              ) : null}
              <a className={styles.btnPrimary} href={ctaHref}>{ctaLabel}</a>
            </article>
          );
        })}
      </div>
    </div>
  );
}
