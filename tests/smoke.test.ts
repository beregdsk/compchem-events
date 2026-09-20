import { describe, expect, it } from 'vitest';
import { site, siteDomain } from '../site.config';

describe('site config', () => {
  it('exposes a parseable production URL', () => {
    expect(siteDomain).toBe('placeholder.example');
  });

  it('carries both report-form parameter names', () => {
    expect(site.reportForm.eventIdParam).toBeTruthy();
    expect(site.reportForm.eventUrlParam).toBeTruthy();
  });
});
