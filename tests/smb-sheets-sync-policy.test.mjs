import test from 'node:test';
import assert from 'node:assert/strict';

/** Mirror clamp logic used by getSheetsSyncPolicy without DB. */
function resolvePolicy(raw) {
  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const min = clamp(raw.minIntervalMinutes, 1, 1440, 2);
  const max = clamp(raw.maxIntervalMinutes, min, 1440, 60);
  return {
    pollIntervalMinutes: clamp(raw.pollIntervalMinutes, min, max, 5),
    minIntervalMinutes: min,
    maxIntervalMinutes: max
  };
}

test('unsafe low poll intervals are raised to minimum', () => {
  const policy = resolvePolicy({ pollIntervalMinutes: 0, minIntervalMinutes: 2, maxIntervalMinutes: 60 });
  assert.equal(policy.pollIntervalMinutes, 2);
});

test('oversized poll intervals are capped', () => {
  const policy = resolvePolicy({ pollIntervalMinutes: 9999, minIntervalMinutes: 2, maxIntervalMinutes: 60 });
  assert.equal(policy.pollIntervalMinutes, 60);
});

test('valid poll interval is preserved', () => {
  const policy = resolvePolicy({ pollIntervalMinutes: 10, minIntervalMinutes: 2, maxIntervalMinutes: 60 });
  assert.equal(policy.pollIntervalMinutes, 10);
});
