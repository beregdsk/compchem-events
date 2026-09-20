import type { ISODate } from './dates';
import type { DisplayRegion } from './regions';

export const EVENT_TYPES = [
  'conference',
  'workshop',
  'school',
  'symposium',
  'webinar',
  'hackathon',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_FORMATS = ['in-person', 'hybrid', 'online'] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

export const DEADLINE_TYPES = [
  'abstract',
  'registration',
  'early_bird',
  'travel_grant',
  'poster',
  'application',
] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];

export const EVENT_STATUSES = ['scheduled', 'postponed', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Derived from the build date, not stored in the YAML. */
export type DerivedStatus = 'upcoming' | 'ongoing' | 'past';

export interface Deadline {
  type: DeadlineType;
  date: ISODate;
  /** `AoE` (default), `UTC`, or an IANA zone name. */
  timezone?: string;
  note?: string;
}

export interface EventLocation {
  city: string;
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string;
  venue?: string;
}

/** An event exactly as it appears in its YAML file. */
export interface RawEvent {
  id: string;
  title: string;
  series?: string;
  type: EventType;
  start_date: ISODate;
  end_date: ISODate;
  format: EventFormat;
  location?: EventLocation;
  url: string;
  source_url?: string;
  organizer?: string;
  topics: string[];
  description: string;
  deadlines?: Deadline[];
  status?: EventStatus;
  status_note?: string;
  added: ISODate;
  last_verified: ISODate;
  fixture?: boolean;
}

/** A `RawEvent` after the loader has derived display fields. */
export interface LoadedEvent extends RawEvent {
  region: DisplayRegion;
  status_derived: DerivedStatus;
}

export interface Topic {
  slug: string;
  label: string;
}
