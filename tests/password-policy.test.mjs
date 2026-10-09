import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPasswordPolicy, passwordPolicyError, passwordMeetsPolicy, PASSWORD_MIN_LENGTH } from '../lib/password-policy.js';
import { authFormPasswordError } from '../lib/auth-navigation.js';

test('password policy requires length, lower, upper, and number', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 12);
  assert.match(passwordPolicyError('short'), /12 characters/);
  assert.match(passwordPolicyError('alllowercase1'), /uppercase/);
  assert.match(passwordPolicyError('ALLUPPERCASE1'), /lowercase/);
  assert.match(passwordPolicyError('NoNumbersHere'), /number/);
  assert.equal(passwordPolicyError('ValidPass123!'), '');
  assert.equal(passwordMeetsPolicy('ValidPass123!'), true);
  assert.equal(passwordMeetsPolicy('password'), false);
  assert.throws(() => assertPasswordPolicy('weak'), (error) => error.code === 'PASSWORD_POLICY');
});

test('signup form uses shared password policy; sign-in does not', () => {
  assert.equal(authFormPasswordError('older-pass', 'signin'), '');
  assert.match(authFormPasswordError('older-pass', 'signup'), /12 characters|lowercase|uppercase|number/i);
  assert.equal(authFormPasswordError('ValidPass123x', 'signup'), '');
});
