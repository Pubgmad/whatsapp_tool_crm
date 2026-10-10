'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from '../app/marketing.module.css';

export default function MarketingChrome({ brandName, logo, navigation = [], signInLabel = 'Sign in', signupLabel = 'Create workspace', children }) {
  const [open, setOpen] = useState(false);
  const items = (navigation || []).filter((item) => item.visible !== false);

  return (
    <div className={styles.site}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} onClick={() => setOpen(false)}>
          {logo?.url ? <img src={logo.url} alt={brandName} width={logo.width} height={logo.height} /> : <span>{brandName}</span>}
        </Link>
        <button type="button" className={styles.menuToggle} aria-expanded={open} aria-controls="marketing-nav" onClick={() => setOpen((value) => !value)}>
          {open ? 'Close' : 'Menu'}
        </button>
        <nav id="marketing-nav" className={`${styles.nav} ${open ? styles.navOpen : ''}`} aria-label="Primary">
          {items.map((item) => (
            <span key={item.id}>
              <a
                href={item.href}
                target={item.openInNewTab ? '_blank' : undefined}
                rel={item.openInNewTab ? 'noopener noreferrer' : undefined}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
              {Array.isArray(item.children) && item.children.filter((child) => child.visible !== false).map((child) => (
                <a key={child.id} href={child.href} style={{ marginLeft: 12, opacity: 0.85 }} onClick={() => setOpen(false)}>{child.label}</a>
              ))}
            </span>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <Link className={styles.btnSecondary} href="/login" onClick={() => setOpen(false)}>{signInLabel}</Link>
          <Link className={styles.btnPrimary} href="/signup" onClick={() => setOpen(false)}>{signupLabel}</Link>
        </div>
      </header>
      {children}
    </div>
  );
}
