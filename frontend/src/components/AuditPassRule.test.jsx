import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AuditPassRule from './AuditPassRule';

test('non-conformance rule takes precedence over a stale percentage', () => {
  const text = renderToStaticMarkup(<AuditPassRule audit={{ scoring_mode: 'non_conformances', max_non_conformances: 5, pass_rate: 85 }} />);
  expect(text).toContain('Pass: 5 or fewer non-conformances');
  expect(text).not.toContain('85%');
});

test('percentage audits retain their configured target', () => {
  expect(renderToStaticMarkup(<AuditPassRule audit={{ scoring_mode: 'percentage', pass_rate: 85 }} />)).toContain('Pass rate: 85%');
  expect(renderToStaticMarkup(<AuditPassRule audit={{ scoring_mode: 'percentage', pass_rate: null }} />)).toBe('');
});
