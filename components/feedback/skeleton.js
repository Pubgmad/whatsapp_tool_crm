'use client';

import './feedback.css';

export function SkeletonLine({ width = '100%', height = 12, className = '' }) {
  return <span className={`msSkeleton ${className}`.trim()} style={{ width, height }} aria-hidden="true" />;
}

export function SkeletonBlock({ rows = 4, className = '' }) {
  return (
    <div className={`msSkeletonBlock ${className}`.trim()} role="status" aria-busy="true" aria-label="Loading content">
      {Array.from({ length: rows }).map((_, index) => (
        <SkeletonLine key={index} width={index % 3 === 0 ? '72%' : index % 2 === 0 ? '92%' : '100%'} height={index === 0 ? 16 : 12} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div className="msSkeletonTable" role="status" aria-busy="true" aria-label="Loading list">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="msSkeletonRow">
          <SkeletonLine width="28%" height={14} />
          <SkeletonLine width="18%" height={14} />
          <SkeletonLine width="22%" height={14} />
          <SkeletonLine width="14%" height={14} />
        </div>
      ))}
    </div>
  );
}
