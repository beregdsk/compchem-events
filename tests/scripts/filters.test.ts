// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `src/scripts/filters.ts` is a side-effecting module: importing it queries
 * `document` and wires up listeners immediately. So each test builds its own
 * DOM fixture, resets the module registry, and re-imports fresh — there is
 * no exported API to call into directly.
 */
function setFixture(): void {
  document.body.innerHTML = `
    <form id="filters" hidden>
      <input type="text" name="q" />
      <input type="checkbox" name="topic" value="dft" />
      <input type="checkbox" name="topic" value="catalysis" />
      <select name="region">
        <option value="">Any</option>
        <option value="Europe">Europe</option>
      </select>
      <input type="checkbox" name="deadline" value="open" />
    </form>
    <p id="result-count"></p>
    <ul id="event-list">
      <li
        class="event"
        data-search="dft workshop example institute exampleville"
        data-topics="dft"
        data-region="Europe"
        data-country="NL"
        data-format="in-person"
        data-type="workshop"
        data-start="2027-01-01"
        data-end="2027-01-02"
        data-deadline=""
      ></li>
      <li
        class="event"
        data-search="catalysis school example institute exampleville"
        data-topics="catalysis"
        data-region="Europe"
        data-country="DE"
        data-format="in-person"
        data-type="school"
        data-start="2027-02-01"
        data-end="2027-02-02"
        data-deadline="open"
      ></li>
    </ul>
    <button type="button" id="clear-filters">Clear filters</button>
  `;
}

function fireEvent(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

/**
 * Seeds the starting URL with the REAL history implementation (before any
 * spy is installed), builds the DOM fixture, then spies on `pushState` and
 * `replaceState` so the module's own calls are captured without depending
 * on happy-dom's history behaviour, and finally imports the island fresh.
 */
async function setup(initialUrl = '/'): Promise<{
  pushSpy: ReturnType<typeof vi.spyOn>;
  replaceSpy: ReturnType<typeof vi.spyOn>;
}> {
  vi.resetModules();
  window.history.replaceState(null, '', initialUrl);
  setFixture();
  const pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
  const replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  await import('../../src/scripts/filters');
  return { pushSpy, replaceSpy };
}

describe('filters island', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unhides the form once the island runs', async () => {
    await setup();
    const form = document.querySelector<HTMLFormElement>('#filters');
    expect(form?.hidden).toBe(false);
  });

  it('ticking one topic checkbox results in exactly one pushState call', async () => {
    const { pushSpy, replaceSpy } = await setup();
    const box = document.querySelector<HTMLInputElement>('input[name="topic"][value="dft"]')!;
    box.checked = true;
    // A real browser fires both `input` and `change` for a checkbox click;
    // this is the regression check for the duplicate-history-entry bug.
    fireEvent(box, 'input');
    fireEvent(box, 'change');

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('typing into the text field calls replaceState, not pushState', async () => {
    const { pushSpy, replaceSpy } = await setup();
    const q = document.querySelector<HTMLInputElement>('input[name="q"]')!;
    q.value = 'dft';
    fireEvent(q, 'input');

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('an interaction that produces the same URL as the current one calls neither', async () => {
    const { pushSpy, replaceSpy } = await setup();
    const select = document.querySelector<HTMLSelectElement>('select[name="region"]')!;
    // The select's value never actually changes (still the default ""), so
    // the serialised filter state is identical to the current, query-free
    // location — this must be a no-op.
    fireEvent(select, 'input');

    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('clear filters resets the form and pushes once', async () => {
    // The browser already sat on a filtered URL when the island took over.
    const { pushSpy, replaceSpy } = await setup('/?topics=dft');
    const box = document.querySelector<HTMLInputElement>('input[name="topic"][value="dft"]')!;
    expect(box.checked).toBe(true); // restored from the URL on load

    const clearButton = document.querySelector<HTMLButtonElement>('#clear-filters')!;
    fireEvent(clearButton, 'click');

    expect(box.checked).toBe(false);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(null, '', '/');
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
