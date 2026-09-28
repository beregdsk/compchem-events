import { describe, expect, it } from 'vitest';
import {
  CECAM_EVENTS_API,
  cecamEventText,
  cecamEventUrl,
  fetchCecamEvents,
  type CecamEvent,
} from '../../src/lib/discovery/cecam-client';

const event = (
  slug: string,
  title = 'Machine Learning Assisted Molecular Dynamics',
): CecamEvent => ({
  title,
  slug,
  start: '2027-03-01',
  end: '2027-03-03',
  event: 'Flagship Workshop',
  location: 'CECAM-HQ-EPFL, Lausanne, Switzerland',
  organisers: [{ name: 'Ada', surname: 'Lovelace', affiliation: 'EPFL' }],
});

describe('fetchCecamEvents', () => {
  it("POSTs as CECAM's own page does, follows every page, and skips malformed entries", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const pages = [
      { success: '1', workshops: { last_page: 2, data: [event('md-1480'), { title: 'no slug' }] } },
      {
        success: '1',
        workshops: { last_page: 2, data: [event('../../evil'), event('ml-school-1481')] },
      },
    ];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify(pages[requests.length - 1]));
    }) as typeof fetch;

    const events = await fetchCecamEvents('Test Agent', impl);

    expect(events.map((e) => e.slug)).toEqual(['md-1480', 'ml-school-1481']);
    expect(requests.map((r) => r.url)).toEqual([CECAM_EVENTS_API, CECAM_EVENTS_API]);
    const headers = requests[0]!.init.headers as Record<string, string>;
    expect(requests[0]!.init.method).toBe('POST');
    expect(headers.Origin).toBe('https://www.cecam.org');
    expect(headers['User-Agent']).toBe('Test Agent');
    expect(JSON.parse(requests[1]!.init.body as string)).toMatchObject({ page: 2, ispast: 'no' });
  });

  it('throws on a refused request, so the run records a source failure', async () => {
    const impl = (async () => new Response('Forbidden', { status: 403 })) as typeof fetch;
    await expect(fetchCecamEvents('Test Agent', impl)).rejects.toThrow(/403/);
  });
});

describe('cecamEventText', () => {
  it('states the dates, location, page and organisers the event page lacks', () => {
    const text = cecamEventText(event('md-1480'));
    expect(text.split('\n')[0]).toBe('Machine Learning Assisted Molecular Dynamics');
    expect(text).toContain('Dates: 2027-03-01 to 2027-03-03');
    expect(text).toContain('Location: CECAM-HQ-EPFL, Lausanne, Switzerland');
    expect(text).toContain(`URL: ${cecamEventUrl(event('md-1480'))}`);
    expect(text).toContain('Organisers: Ada Lovelace (EPFL)');
  });
});
