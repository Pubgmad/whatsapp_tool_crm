'use client';

import { useState } from 'react';
import Link from 'next/link';
import { KeyRound, Loader2, MailCheck, ShieldCheck } from 'lucide-react';

async function csrf() {
  const response = await fetch('/api/security/csrf', { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Security initialization failed');
  return payload.csrfToken;
}

async function submit(path, body) {
  const token = await csrf();
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

export default function AccountAccess({ mode, token = '' }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const verify = mode === 'verify';
  const reset = mode === 'reset';
  const resend = mode === 'resend';
  const title = verify ? 'Verify your email' : reset ? 'Choose a new password' : resend ? 'Resend verification email' : 'Reset your password';
  const Icon = verify || resend ? MailCheck : KeyRound;

  const run = async (event) => {
    event.preventDefault();
    setPending(true); setError(''); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      if (verify) await submit('/api/auth/verify-email', { token });
      else if (reset) {
        if (form.get('password') !== form.get('confirmPassword')) throw new Error('Passwords do not match.');
        await submit('/api/auth/password/reset', { token, password: form.get('password') });
      } else if (resend) await submit('/api/auth/verify-email/request', { email: form.get('email') });
      else await submit('/api/auth/password/request', { email: form.get('email') });
      setMessage(verify ? 'Email verified. You can now sign in.' : reset ? 'Password updated. You can now sign in.' : resend ? 'If that account needs verification, a new link has been sent.' : 'If that account exists, a reset link has been sent.');
    } catch (reason) { setError(reason.message); }
    finally { setPending(false); }
  };

  return <main className='authShell'><section className='authPanel authPanelPro'><div className='brandBlock dark authBrand'><div className='brandIcon'><ShieldCheck size={22} /></div><div><strong>Account security</strong><span>WhatsApp Business CRM</span></div></div><div className='authHeader'><p className='kicker'>Secure access</p><h1>{title}</h1></div><form className='formGrid authForm' onSubmit={run}>{!verify && !reset && <label>Email<input name='email' type='email' autoComplete='email' required /></label>}{reset && <><label>New password<input name='password' type='password' minLength='12' autoComplete='new-password' required /></label><label>Confirm password<input name='confirmPassword' type='password' minLength='12' autoComplete='new-password' required /></label></>}{(verify || reset) && !token && <div className='formError'>This security link is incomplete.</div>}{error && <div className='formError'>{error}</div>}{message && <div className='formSuccess'>{message}</div>}<button className='primaryAction authSubmit' disabled={pending || ((verify || reset) && !token)}>{pending ? <Loader2 className='spin' size={18} /> : <Icon size={18} />}{pending ? 'Please wait' : verify ? 'Verify email' : reset ? 'Update password' : resend ? 'Send verification link' : 'Send reset link'}</button></form><div className='authSwitch'><Link href='/login'>Return to sign in</Link></div></section></main>;
}
