'use client';

import { CircleAlert } from 'lucide-react';
import './feedback.css';

/** Field-level error — place directly under the related control. */
export default function InlineError({ id, message, children }) {
  const text = children || message;
  if (!text) return null;
  return (
    <p id={id} className="msInlineError" role="alert">
      <CircleAlert size={14} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
