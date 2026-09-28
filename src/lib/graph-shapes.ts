// Event type on the graph view is carried by shape, not colour: the palette's
// two accents already mean "interactive" and "time", and a rainbow of types
// would dilute both. Paths are centred on the origin; the page translates them.
import type { EventType } from './types';

export type Shape = 'circle' | 'square' | 'diamond' | 'triangle' | 'ring';

export const NODE_RADIUS = 9;

const SHAPES: Record<EventType, Shape> = {
  conference: 'circle',
  workshop: 'square',
  school: 'diamond',
  symposium: 'triangle',
  webinar: 'ring',
  hackathon: 'ring',
};

export function shapeFor(type: EventType): Shape {
  return SHAPES[type];
}

const f = (n: number) => +n.toFixed(2);

/** Sized so each shape reads as roughly the same visual weight. */
export function shapePath(shape: Shape, r = NODE_RADIUS): string {
  switch (shape) {
    case 'circle':
    case 'ring':
      return `M${-r} 0a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    case 'square': {
      const s = f(r * 0.85);
      return `M${-s} ${-s}H${s}V${s}H${-s}Z`;
    }
    case 'diamond': {
      const d = f(r * 1.2);
      return `M0 ${-d}L${d} 0L0 ${d}L${-d} 0Z`;
    }
    case 'triangle':
      return `M0 ${f(-r * 1.15)}L${r} ${f(r * 0.75)}L${-r} ${f(r * 0.75)}Z`;
  }
}
