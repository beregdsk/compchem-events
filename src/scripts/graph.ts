// Brings the event map to life: the static SVG from graph.astro becomes a
// live force simulation you can drag, with hover/focus highlighting of an
// event's neighbours and pan/zoom on the viewBox. Everything here is an
// enhancement — without it the page is a working map of links.
import type { GraphPayload, SimNode } from '../lib/graph-layout';
import { createSimulation } from '../lib/graph-layout';

const figure = document.querySelector<HTMLElement>('figure.graph');
const svg = document.querySelector<SVGSVGElement>('#event-graph');
const payload = readPayload();

if (figure && svg && payload) enhance(figure, svg, payload);

function readPayload(): GraphPayload | null {
  try {
    const data = JSON.parse(document.querySelector('#event-graph-data')?.textContent ?? '');
    return Array.isArray(data?.nodes) && Array.isArray(data?.edges) ? data : null;
  } catch {
    return null;
  }
}

/** Pointer travel, in CSS pixels, below which a press is a click, not a drag. */
const DRAG_SLOP = 4;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

function enhance(figure: HTMLElement, svg: SVGSVGElement, payload: GraphPayload) {
  // Pointer state, declared first: the highlight handlers below read `dragging`.
  let dragging: SimNode | null = null;
  let moved = false;
  let suppressClick = false;

  const nodeEls = new Map<string, SVGAElement>();
  for (const a of svg.querySelectorAll<SVGAElement>('a.graph-node')) nodeEls.set(a.dataset.id!, a);
  const edgeEls = [...svg.querySelectorAll<SVGLineElement>('.graph__edge')];

  const neighbours = new Map<string, Set<string>>();
  for (const { source, target } of payload.edges) {
    if (!neighbours.has(source)) neighbours.set(source, new Set());
    if (!neighbours.has(target)) neighbours.set(target, new Set());
    neighbours.get(source)!.add(target);
    neighbours.get(target)!.add(source);
  }

  // --- Highlight -----------------------------------------------------------
  let lit: string | null = null;
  function highlight(id: string | null) {
    if (id === lit) return;
    if (lit) setLabel(lit, 'short');
    lit = id;
    figure.classList.toggle('is-highlighting', id !== null);
    const near = id ? (neighbours.get(id) ?? new Set<string>()) : new Set<string>();
    for (const [nid, el] of nodeEls) el.classList.toggle('is-lit', nid === id || near.has(nid));
    for (const el of edgeEls) {
      el.classList.toggle(
        'is-lit',
        id !== null && (el.dataset.source === id || el.dataset.target === id),
      );
    }
    if (id) setLabel(id, 'full');
  }
  function setLabel(id: string, which: 'short' | 'full') {
    const text = nodeEls.get(id)?.querySelector<SVGTextElement>('.graph-node__label');
    if (text) text.textContent = text.dataset[which] ?? text.textContent;
  }
  const nodeOf = (t: EventTarget | null) =>
    t instanceof Element ? t.closest<SVGAElement>('a.graph-node') : null;

  svg.addEventListener('pointerover', (e) => {
    if (!dragging) highlight(nodeOf(e.target)?.dataset.id ?? null);
  });
  svg.addEventListener('pointerleave', () => {
    if (!dragging) highlight(null);
  });
  svg.addEventListener('focusin', (e) => highlight(nodeOf(e.target)?.dataset.id ?? null));
  svg.addEventListener('focusout', () => highlight(null));

  // --- viewBox pan / zoom ----------------------------------------------------
  const base = svg.getAttribute('viewBox')!.split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const vb = [...base] as [number, number, number, number];
  const applyViewBox = () => svg.setAttribute('viewBox', vb.join(' '));
  function toSvg(clientX: number, clientY: number) {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  function zoomAt(clientX: number, clientY: number, factor: number) {
    const scale = Math.min(Math.max((vb[2] * factor) / base[2], ZOOM_MIN), ZOOM_MAX);
    const next = scale * base[2];
    const k = next / vb[2];
    const p = toSvg(clientX, clientY);
    vb[0] = p.x - (p.x - vb[0]) * k;
    vb[1] = p.y - (p.y - vb[1]) * k;
    vb[2] = next;
    vb[3] = vb[3] * k;
    applyViewBox();
  }
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.001));
    },
    { passive: false },
  );

  // --- Simulation ------------------------------------------------------------
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const simNodes: SimNode[] = payload.nodes.map((p) => ({ id: p.id, x: p.x, y: p.y }));
  const simById = new Map(simNodes.map((n) => [n.id, n]));
  const sim = createSimulation(simNodes, payload.edges);
  sim.on('tick', render);

  function render() {
    for (const n of simNodes) {
      nodeEls
        .get(n.id)
        ?.querySelector('.graph-node__body')
        ?.setAttribute('transform', `translate(${n.x!.toFixed(1)} ${n.y!.toFixed(1)})`);
    }
    for (const el of edgeEls) {
      const a = simById.get(el.dataset.source!);
      const b = simById.get(el.dataset.target!);
      if (!a || !b) continue;
      el.setAttribute('x1', a.x!.toFixed(1));
      el.setAttribute('y1', a.y!.toFixed(1));
      el.setAttribute('x2', b.x!.toFixed(1));
      el.setAttribute('y2', b.y!.toFixed(1));
    }
  }

  // --- Pointer: drag a node, pan the background, pinch to zoom ---------------
  const pointers = new Map<number, { x: number; y: number }>();
  let start = { x: 0, y: 0 };
  let pinchDistance = 0;

  svg.addEventListener('pointerdown', (e) => {
    const nodeEl = nodeOf(e.target);
    start = { x: e.clientX, y: e.clientY };
    moved = false;
    if (nodeEl && !still) {
      e.preventDefault(); // no native link drag or text selection
      dragging = simById.get(nodeEl.dataset.id!) ?? null;
      if (dragging) {
        dragging.fx = dragging.x;
        dragging.fy = dragging.y;
        sim.alphaTarget(0.3).restart();
      }
      // Capture on the link, not the svg: pointerup then lands on the <a>, so
      // a press without a drag still produces a click that follows the link.
      nodeEl.setPointerCapture(e.pointerId);
      return;
    }
    if (nodeEl) return; // reduced motion: nodes stay put, clicks navigate
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      pinchDistance = Math.hypot(p!.x - q!.x, p!.y - q!.y);
    }
  });

  svg.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_SLOP) moved = true;
    if (dragging) {
      const p = toSvg(e.clientX, e.clientY);
      dragging.fx = p.x;
      dragging.fy = p.y;
      return;
    }
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      const distance = Math.hypot(p!.x - q!.x, p!.y - q!.y);
      if (pinchDistance > 0) zoomAt((p!.x + q!.x) / 2, (p!.y + q!.y) / 2, pinchDistance / distance);
      pinchDistance = distance;
    } else if (pointers.size === 1) {
      const unit = vb[2] / svg.clientWidth;
      vb[0] -= (e.clientX - prev.x) * unit;
      vb[1] -= (e.clientY - prev.y) * unit;
      applyViewBox();
    }
  });

  function release(e: PointerEvent) {
    if (dragging) {
      dragging.fx = null;
      dragging.fy = null;
      sim.alphaTarget(0);
      suppressClick = moved;
      dragging = null;
      highlight(nodeOf(document.elementFromPoint(e.clientX, e.clientY))?.dataset.id ?? null);
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
  }
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);

  // A drag that ends over its own node must not follow the link.
  svg.addEventListener(
    'click',
    (e) => {
      if (suppressClick && nodeOf(e.target)) e.preventDefault();
      suppressClick = false;
    },
    true,
  );

  figure.classList.add('is-live');
  if (!still) sim.alpha(0.08).restart();
}
