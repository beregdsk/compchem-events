// The groups loader: reads data/groups/, validates it (invalid data fails
// the build, as for events and positions). Spec:
// docs/superpowers/specs/2026-09-29-groups-registry-design.md.
import { jaccard, linkSimilar, type Graph } from './graph';
import { GROUP_SHAPES } from './graph-shapes';
import { todayUTC, type ISODate } from './dates';
import {
  GROUPS_DIR,
  readGroupFiles,
  validateGroup,
  validateGroupCollection,
} from './group-validation';
import { GROUP_KIND_LABELS, GROUP_KINDS, type GroupKind, type RawGroup } from './types';
import { formatProblems, loadValidationContext, type ValidationResult } from './validation';

export interface GroupLoadOptions {
  /** Directory holding `<id>.yaml`. Defaults to `data/groups`. */
  groupsDir?: string;
  today?: ISODate;
  /** Defaults to false in production builds, true otherwise. */
  includeFixtures?: boolean;
}

export function loadGroups(options: GroupLoadOptions = {}): RawGroup[] {
  const today = options.today ?? todayUTC();
  const includeFixtures = options.includeFixtures ?? process.env.NODE_ENV !== 'production';
  const entries = readGroupFiles(options.groupsDir ?? GROUPS_DIR);
  const ctx = loadValidationContext('.', today);
  const all: ValidationResult = { errors: [], warnings: [] };
  for (const entry of entries) {
    const r = validateGroup(entry, ctx);
    all.errors.push(...r.errors);
    all.warnings.push(...r.warnings);
  }
  all.errors.push(...validateGroupCollection(entries).errors);
  if (all.errors.length > 0)
    throw new Error(`group data validation failed:\n${formatProblems(all)}`);
  for (const w of all.warnings) console.warn(`WARN ${w.file}: ${w.field}: ${w.message}`);
  return entries
    .map((e) => e.data as RawGroup)
    .filter((g) => includeFixtures || g.fixture !== true);
}

/** One section per kind in `GROUP_KINDS` order, names sorted, empty kinds left out. */
export function groupSections(
  groups: RawGroup[],
): Array<{ kind: GroupKind; label: string; groups: RawGroup[] }> {
  return GROUP_KINDS.map((kind) => ({
    kind,
    label: GROUP_KIND_LABELS[kind],
    groups: groups.filter((g) => g.kind === kind).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((s) => s.groups.length > 0);
}

const same = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Linked by shared topics (0.6), a shared parent institution (0.25) and country (0.15). */
export function groupSimilarity(a: RawGroup, b: RawGroup): number {
  const topics = jaccard(new Set(a.topics), new Set(b.topics));
  const parent = same(a.parent, b.parent) ? 0.25 : 0;
  const country = same(a.location?.country, b.location?.country) ? 0.15 : 0;
  return Math.min(1, 0.6 * topics + parent + country);
}

/** Every group, linking to its row on /groups/. */
export function buildGroupGraph(groups: RawGroup[]): Graph {
  return {
    nodes: groups.map((g) => ({
      id: g.id,
      title: g.name,
      href: `/groups/#${g.id}`,
      shape: GROUP_SHAPES[g.kind],
      dimmed: false,
    })),
    edges: linkSimilar(groups, groupSimilarity),
  };
}
