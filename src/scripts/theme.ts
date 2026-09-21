// Theme toggle. The system preference decides by default; this lets a reader
// override it and remembers the choice.
//
// The override is a `data-theme` attribute on <html>, which global.css reads.
// A tiny inline script in the document head applies the stored value before
// first paint, so there is no flash of the other theme; this module only owns
// the button. The button ships hidden and is unhidden here, so the control
// exists exactly when it can work.

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

const root = document.documentElement;
const button = document.querySelector<HTMLButtonElement>('#theme-toggle');
const prefersLight = window.matchMedia('(prefers-color-scheme: light)');

function stored(): Theme | null {
  const value = root.dataset.theme;
  return value === 'light' || value === 'dark' ? value : null;
}

/** What the page is actually showing: the override if there is one, else the system. */
function current(): Theme {
  return stored() ?? (prefersLight.matches ? 'light' : 'dark');
}

if (button) {
  const label = () => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    button.textContent = next === 'light' ? 'Light' : 'Dark';
    button.setAttribute('aria-label', `Switch to the ${next} theme`);
  };

  button.hidden = false;
  label();

  button.addEventListener('click', () => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing or blocked storage: the choice still applies to this
      // page view, it just will not be remembered.
    }
    label();
  });

  // Follow the system if the reader has not overridden it.
  prefersLight.addEventListener('change', label);
}
