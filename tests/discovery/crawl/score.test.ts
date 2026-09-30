import { describe, expect, it } from 'vitest';
import { inScope, linkScore, priorityOf, seedHostOf } from '../../../src/lib/discovery/crawl/score';

describe('seedHostOf / inScope', () => {
  it('drops www. and admits the host and its subdomains only', () => {
    expect(seedHostOf('https://www.UMich.edu/')).toBe('umich.edu');
    expect(inScope('https://umich.edu/x', 'umich.edu')).toBe(true);
    expect(inScope('https://www.umich.edu/x', 'umich.edu')).toBe(true);
    expect(inScope('https://chem.umich.edu/groups/', 'umich.edu')).toBe(true);
    expect(inScope('https://notumich.edu/', 'umich.edu')).toBe(false);
    expect(inScope('https://msu.edu/', 'umich.edu')).toBe(false);
    expect(inScope('not a url', 'umich.edu')).toBe(false);
  });

  it('keeps a subdomain seed to that subdomain', () => {
    expect(inScope('https://chem.umich.edu/a', 'chem.umich.edu')).toBe(true);
    expect(inScope('https://physics.umich.edu/a', 'chem.umich.edu')).toBe(false);
  });
});

describe('linkScore', () => {
  it('rewards directory words in the path and text', () => {
    expect(linkScore('https://u.edu/research/groups/', 'Research groups')).toBeGreaterThan(3);
    expect(linkScore('https://u.edu/theory', 'Theoretical Chemistry')).toBeGreaterThan(3);
  });

  it('penalises news, logins, paging and files', () => {
    expect(linkScore('https://u.edu/news/2026/groups', 'News')).toBeLessThan(
      linkScore('https://u.edu/groups', 'Groups'),
    );
    expect(linkScore('https://u.edu/login', 'Log in')).toBeLessThan(0);
    expect(linkScore('https://u.edu/people?page=4', 'People')).toBeLessThan(
      linkScore('https://u.edu/people', 'People'),
    );
    expect(linkScore('https://u.edu/groups.pdf', 'Groups (PDF)')).toBeLessThan(0);
  });
});

describe('priorityOf', () => {
  it('costs two points per level of depth', () => {
    expect(priorityOf(10, 0)).toBe(10);
    expect(priorityOf(10, 3)).toBe(4);
  });
});
