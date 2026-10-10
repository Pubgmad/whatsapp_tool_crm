'use client';

import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import styles from '../app/w/[viewId]/page.module.css';

export default function HostedWebviewForm({ viewId, title, description, businessName, buttonLabel, fields = [], successMessage }) {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const form = new FormData(event.currentTarget);
      const payload = { phone: String(form.get('phone') || ''), fields: {} };
      for (const field of fields) payload.fields[field.key] = String(form.get(field.key) || '');
      const response = await fetch(`/api/public/webviews/${viewId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Submission failed');
      setStatus(result.message || successMessage || 'Thanks — we received your details.');
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause.message || 'Submission failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.content}>
        <div className={styles.brand}><MessageCircle size={24} aria-hidden="true" /><span>{businessName}</span></div>
        <h1>{title}</h1>
        <p>{description}</p>
        <form className={styles.form} onSubmit={submit}>
          <label>WhatsApp phone (with country code)<input name="phone" inputMode="tel" autoComplete="tel" required minLength={8} maxLength={20} /></label>
          {fields.map((field) => (
            <label key={field.key}>
              {field.label}{field.required ? ' *' : ''}
              {field.type === 'textarea'
                ? <textarea name={field.key} required={field.required} rows={4} maxLength={4000} />
                : <input name={field.key} type={field.type === 'tel' ? 'tel' : field.type === 'email' ? 'email' : field.type === 'number' ? 'number' : 'text'} required={field.required} maxLength={500} />}
            </label>
          ))}
          <button className={styles.action} type="submit" disabled={busy}>{busy ? 'Sending…' : buttonLabel}</button>
        </form>
        {status ? <p className={styles.success} role="status">{status}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
