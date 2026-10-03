import { describe, expect, it } from 'vitest';
import {
  applyFixes,
  buildAuditPrBody,
  dueEntries,
  mechanicalFindings,
  pageOf,
  runAudit,
  type AuditEntry,
  type AuditState,
} from '../../src/lib/discovery/audit';
import { loadValidationContext } from '../../src/lib/validation';

const ctx = loadValidationContext('.', '2026-10-04');
const today = '2026-10-04';

const group: AuditEntry = {
  kind: 'group',
  file: 'data/groups/quantum-optospintronics.yaml',
  data: {
    id: 'quantum-optospintronics',
    name: 'Quantum Optospintronics',
    kind: 'group',
    website: 'https://lab.example.org/qos/',
    topics: ['spectroscopy'],
    description: 'Studies molecular spin. Builds quantum sensors and devices for…',
    added: '2026-10-01',
    pi: 'Sam Bailey',
    location: { city: 'Glasgow', country: 'GB' },
  },
};

const list = 'https://psi-k.net/important-new-psi-k-mailing-list/';
const position: AuditEntry = {
  kind: 'position',
  file: 'data/positions/2026/x-phd-2026.yaml',
  data: {
    id: 'x-phd-2026',
    title: 'PhD in coupled cluster',
    level: 'phd',
    institution: 'Example University',
    location: { city: 'Vienna', country: 'AT' },
    url: list,
    source_url: list,
    topics: ['electronic-structure'],
    description: 'A funded PhD.',
    added: '2026-10-01',
  },
};

function stubFetch(findings: unknown[], pages: Record<string, string> = {}) {
  const seen: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 200 });
    if (pages[url] !== undefined) return new Response(pages[url], { status: 200 });
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    seen.push(body.messages[1]!.content);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ findings }) } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
  return { impl, seen };
}

describe('dueEntries', () => {
  it('skips fixtures and past events, and entries audited since their last change', () => {
    const pastEvent: AuditEntry = {
      kind: 'event',
      file: 'data/events/2025/old-2025.yaml',
      data: { end_date: '2025-01-01' },
    };
    const fixture: AuditEntry = {
      ...group,
      file: 'f.yaml',
      data: { ...group.data, fixture: true },
    };
    const state: AuditState = { audited: {} };
    expect(dueEntries([group, pastEvent, fixture], state, today, 10)).toEqual([group]);
  });

  it('puts never-audited entries first and caps the slice', () => {
    const other = { ...group, file: 'data/groups/other.yaml' };
    const state: AuditState = { audited: { [group.file]: { hash: 'stale', at: '2026-09-01' } } };
    expect(dueEntries([group, other], state, today, 1)).toEqual([other]);
  });
});

describe('mechanicalFindings', () => {
  it('cuts a clipped description back to its last full sentence', () => {
    const [f] = mechanicalFindings(group, ctx);
    expect(f).toMatchObject({ field: 'description', fix: 'Studies molecular spin.' });
  });
});

describe('pageOf', () => {
  it('has no page for a mailing-list post that linked none', () => {
    expect(pageOf(position, ctx)).toBeUndefined();
    expect(pageOf(group, ctx)).toBe('https://lab.example.org/qos/');
  });
});

describe('applyFixes', () => {
  it('keeps a fix that validates and drops one that does not', () => {
    const { data, findings } = applyFixes(
      { ...group, data: { ...group.data, pi: 'Sam' } },
      [
        { file: group.file, field: 'pi', problem: 'first name only', fix: 'Prof' },
        { file: group.file, field: 'pi', problem: 'first name only', fix: 'Sam Bailey' },
      ],
      ctx,
    );
    expect(data.pi).toBe('Sam Bailey');
    expect(findings[0]!.fix).toBeUndefined();
    expect(findings[1]).toMatchObject({ was: 'Sam', fix: 'Sam Bailey' });
  });
});

describe('runAudit', () => {
  it('sends the entry with its page, applies fixes and records the entry', async () => {
    const { impl, seen } = stubFetch(
      [
        { field: 'pi', problem: 'Only a first name.', fix: 'Sam Bailey' },
        { field: 'website', problem: 'Looks odd.', fix: 'https://evil.example/' },
      ],
      { 'https://lab.example.org/qos/': '<html><body><p>Led by Dr Sam Bailey.</p></body></html>' },
    );
    const state: AuditState = { audited: {} };
    const result = await runAudit({
      entries: [{ ...group, data: { ...group.data, pi: 'Sam' } }],
      state,
      ctx,
      extract: { apiKey: 'k', model: 'm', topics: [], fetchImpl: impl, sleepImpl: async () => {} },
      userAgent: 'test',
      today,
      maxEntries: 5,
      fetchImpl: impl,
    });
    expect(seen[0]).toContain('Led by Dr Sam Bailey.');
    expect(result.audited).toBe(1);
    expect(state.audited[group.file]?.at).toBe(today);
    // website is not a field the model may change: reported, never applied.
    expect(result.findings.find((f) => f.field === 'website')?.fix).toBeUndefined();
    const written = result.changed.get(group.file)!;
    expect(written).toContain('pi: Sam Bailey');
    expect(written).not.toContain('evil.example');

    const body = buildAuditPrBody(result, today);
    expect(body).toContain('### Fixed in this PR (2)');
    expect(body).toContain('### Needs a human (1)');
  });
});
