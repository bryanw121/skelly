// The shapes of the data files the site reads (public/data, published from the data branch).
// Written from the feeds as they are; a field marked optional is missing from some rows.
// New TypeScript code (Preact components) imports these; app.js isn't checked against them yet.

/** data/index.json: the cities (regions) Skelly covers. */
export type RegionIndex = { generatedAt: string; regions: Region[] };
export type Region = {
  id: string;
  name: string;
  timezone: string;
  center: [number, number];
  sports: string[];
  sessions?: number;
  venues?: number;
};

/** data/events.json: pop-ups, seasonal events and weekly markets, every region. */
export type EventsFeed = {
  feedVersion: number;
  generatedAt: string;
  listingsAt?: string;
  events: SkellyEvent[];
  sources?: unknown[];
  markets?: Market[];
};

export type SkellyEvent = {
  id: string;
  category: string;
  kind?: string;
  tags?: string[];
  title: string;
  description?: string;
  venue: string;
  city: string;
  area?: string;
  region?: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string;
  startTime?: string; // HH:MM
  endTime?: string;
  price?: string;
  sourceUrl: string;
  source: string;
  sourceId?: string;
  account?: string;
  lat?: number;
  lng?: number;
  located?: string;
  firstSeen?: string;
  weekly?: boolean;
};

/** A market OpenStreetMap lists without hours (the "Hours not listed" section). */
export type Market = { id: string; name: string; city: string | null; region: string; lat: number; lng: number; url?: string };

/** data/regions/<id>/schedule.json: one city's open play, court bookings and free courts. */
export type Schedule = {
  schemaVersion: number;
  generatedAt: string;
  region: string;
  sources: unknown[];
  sessions: Session[];
  publicCourts?: { courts: unknown[] };
  venues?: unknown[];
};

export type Session = {
  id: string;
  sport: string;
  title: string;
  start: string;
  end: string;
  date?: string;
  venue: string;
  venueId: string;
  city: string;
  surface: string;
  type: string;
  level?: string;
  price?: string;
  note?: string;
  source: string;
  sourceId: string;
  signup: { url: string; label?: string };
  region: string;
  timezone: string;
  verifiedAt: string;
  status: string;
  scheduleBasis?: string;
  capacity?: number;
  spotsLeft?: number;
};
