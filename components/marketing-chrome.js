'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Grid3x3, MessageCircle, Phone, Megaphone, Bot, Sparkles, Workflow, FileText, Shield, Puzzle, Box } from 'lucide-react';
import styles from '../app/marketing.module.css';

const ICONS = {
  message: MessageCircle,
  phone: Phone,
  megaphone: Megaphone,
  bot: Bot,
  spark: Sparkles,
  workflow: Workflow,
  form: FileText,
  grid: Grid3x3,
  shield: Shield,
  integrations: Puzzle,
  products: Box,
  automation: Workflow
};

function NavIcon({ name, size = 18 }) {
  const Icon = ICONS[name] || Grid3x3;
  return <Icon size={size} aria-hidden />;
}

function NavAnchor({ item, className, onNavigate, children }) {
  const label = children || item.label;
  if (!item.href || item.type === 'menu') {
    return <span className={className}>{label}</span>;
  }
  if (item.type === 'external' || item.href.startsWith('http')) {
    return (
      <a className={className} href={item.href} target={item.openInNewTab ? '_blank' : undefined} rel="noopener noreferrer" onClick={onNavigate}>
        {label}
      </a>
    );
  }
  return <Link className={className} href={item.href} onClick={onNavigate}>{label}</Link>;
}

function MegaPanel({ item, onNavigate }) {
  const groups = (item.children || []).filter((child) => child.visible !== false);
  return (
    <div className={styles.megaPanel} role="menu">
      <div className={styles.megaGrid}>
        {groups.map((group) => {
          const features = (group.children || []).filter((child) => child.visible !== false);
          return (
            <div className={styles.megaGroup} key={group.id} role="none">
              <NavAnchor item={group} className={styles.megaProduct} onNavigate={onNavigate}>
                <span className={styles.megaIcon}><NavIcon name={group.icon} size={22} /></span>
                <span className={styles.megaCopy}>
                  <strong>{group.label}</strong>
                  {group.description ? <small>{group.description}</small> : null}
                </span>
                <ChevronRight size={16} className={styles.megaChevron} aria-hidden />
              </NavAnchor>
              {features.length > 0 && (
                <div className={styles.megaFeatures}>
                  {features.map((feature) => (
                    <NavAnchor key={feature.id} item={feature} className={styles.megaFeature} onNavigate={onNavigate}>
                      {feature.label}
                    </NavAnchor>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DropdownPanel({ item, onNavigate }) {
  const children = (item.children || []).filter((child) => child.visible !== false);
  return (
    <div className={styles.dropPanel} role="menu">
      {children.map((child) => (
        <NavAnchor key={child.id} item={child} className={styles.dropItem} onNavigate={onNavigate}>
          {child.label}
        </NavAnchor>
      ))}
    </div>
  );
}

function DesktopItem({ item, onNavigate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuId = useId();
  const hasMenu = item.menuStyle === 'mega' || item.menuStyle === 'dropdown';

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (!hasMenu) {
    return (
      <div className={styles.navItem}>
        <NavAnchor item={item} className={styles.navLink} onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div
      className={`${styles.navItem} ${styles.hasMenu} ${open ? styles.menuOpen : ''}`}
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={styles.navTrigger}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {item.label}
        <ChevronDown size={15} aria-hidden />
      </button>
      <div id={menuId} hidden={!open}>
        {item.menuStyle === 'mega' ? <MegaPanel item={item} onNavigate={() => { setOpen(false); onNavigate?.(); }} /> : <DropdownPanel item={item} onNavigate={() => { setOpen(false); onNavigate?.(); }} />}
      </div>
    </div>
  );
}

function MobileItem({ item, onNavigate }) {
  const [open, setOpen] = useState(false);
  const hasMenu = (item.menuStyle === 'mega' || item.menuStyle === 'dropdown') && item.children?.length;
  if (!hasMenu) {
    return <NavAnchor item={item} className={styles.mobileLink} onNavigate={onNavigate} />;
  }
  return (
    <div className={styles.mobileGroup}>
      <button type="button" className={styles.mobileTrigger} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{item.label}</span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div className={styles.mobilePanel}>
          {(item.children || []).filter((child) => child.visible !== false).map((group) => (
            <div key={group.id} className={styles.mobileProduct}>
              <NavAnchor item={group} className={styles.mobileProductLink} onNavigate={onNavigate}>
                <strong>{group.label}</strong>
                {group.description ? <small>{group.description}</small> : null}
              </NavAnchor>
              {(group.children || []).filter((child) => child.visible !== false).map((feature) => (
                <NavAnchor key={feature.id} item={feature} className={styles.mobileFeature} onNavigate={onNavigate}>
                  {feature.label}
                </NavAnchor>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MarketingChrome({ brandName, logo, navigation = [], signInLabel = 'Sign in', signupLabel = 'Create workspace', children }) {
  const [open, setOpen] = useState(false);
  const items = (navigation || []).filter((item) => item.visible !== false);
  const close = () => setOpen(false);

  return (
    <div className={styles.site}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} onClick={close}>
          {logo?.url ? <img src={logo.url} alt={brandName} width={logo.width} height={logo.height} /> : <span>{brandName}</span>}
        </Link>
        <button type="button" className={styles.menuToggle} aria-expanded={open} aria-controls="marketing-nav" onClick={() => setOpen((value) => !value)}>
          {open ? 'Close' : 'Menu'}
        </button>
        <nav id="marketing-nav" className={`${styles.nav} ${styles.desktopNav}`} aria-label="Primary">
          {items.map((item) => <DesktopItem key={item.id} item={item} onNavigate={close} />)}
        </nav>
        <div className={`${styles.mobileNav} ${open ? styles.navOpen : ''}`}>
          {items.map((item) => <MobileItem key={item.id} item={item} onNavigate={close} />)}
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.btnSecondary} href="/login" onClick={close}>{signInLabel}</Link>
          <Link className={styles.btnPrimary} href="/signup" onClick={close}>{signupLabel}</Link>
        </div>
      </header>
      {children}
    </div>
  );
}
