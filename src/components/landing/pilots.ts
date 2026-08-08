/**
 * Sample worldwide-pilot roster for the landing globe.
 *
 * These are curated placeholder users pinned to real cities so the globe
 * reads as "Cribble users worldwide" before launch. The shape mirrors what
 * the leaderboard API will eventually return (callsign + home city +
 * coordinates), so swapping in live data is a drop-in replacement: fetch,
 * map into `Pilot[]`, hand to the globe.
 */
export interface Pilot {
  callsign: string
  city: string
  /** Latitude in degrees, north positive. */
  lat: number
  /** Longitude in degrees, east positive. */
  lng: number
}

export const PILOTS: Pilot[] = [
  // Asia
  { callsign: 'null_ptr', city: 'Manila', lat: 14.5995, lng: 120.9842 },
  { callsign: 'kernel_panic', city: 'Tokyo', lat: 35.6762, lng: 139.6503 },
  { callsign: 'off_by_one', city: 'Bangalore', lat: 12.9716, lng: 77.5946 },
  { callsign: 'dot_env', city: 'Seoul', lat: 37.5665, lng: 126.978 },
  { callsign: 'syn_ack', city: 'Singapore', lat: 1.3521, lng: 103.8198 },
  { callsign: 'zero_day', city: 'Tel Aviv', lat: 32.0853, lng: 34.7818 },
  { callsign: 'page_fault', city: 'Dubai', lat: 25.2048, lng: 55.2708 },
  // Europe
  { callsign: 'segfault', city: 'Berlin', lat: 52.52, lng: 13.405 },
  { callsign: 'grep_gremlin', city: 'London', lat: 51.5074, lng: -0.1278 },
  { callsign: 'lambda_calc', city: 'Paris', lat: 48.8566, lng: 2.3522 },
  { callsign: 'big_endian', city: 'Amsterdam', lat: 52.3676, lng: 4.9041 },
  { callsign: 'stack_probe', city: 'Warsaw', lat: 52.2297, lng: 21.0122 },
  { callsign: 'nan_boxed', city: 'Stockholm', lat: 59.3293, lng: 18.0686 },
  // North America
  { callsign: 'vector_07', city: 'San Francisco', lat: 37.7749, lng: -122.4194 },
  { callsign: 'mmap_ghost', city: 'New York', lat: 40.7128, lng: -74.006 },
  { callsign: 'borrow_chkr', city: 'Toronto', lat: 43.6532, lng: -79.3832 },
  { callsign: 'hex_dump', city: 'Mexico City', lat: 19.4326, lng: -99.1332 },
  // South America
  { callsign: 'tail_dash_f', city: 'São Paulo', lat: -23.5505, lng: -46.6333 },
  { callsign: 'cron_daemon', city: 'Bogotá', lat: 4.711, lng: -74.0721 },
  { callsign: 'bit_flip', city: 'Buenos Aires', lat: -34.6037, lng: -58.3816 },
  // Africa
  { callsign: 'chmod_777', city: 'Lagos', lat: 6.5244, lng: 3.3792 },
  { callsign: 'ansi_esc', city: 'Cairo', lat: 30.0444, lng: 31.2357 },
  { callsign: 'race_cond', city: 'Nairobi', lat: -1.2921, lng: 36.8219 },
  { callsign: 'mutex_9', city: 'Cape Town', lat: -33.9249, lng: 18.4241 },
  { callsign: 'opcode_11', city: 'Casablanca', lat: 33.5731, lng: -7.5898 },
  // Oceania
  { callsign: 'thread_local', city: 'Sydney', lat: -33.8688, lng: 151.2093 },
  { callsign: 'ring_buffer', city: 'Auckland', lat: -36.8509, lng: 174.7645 },
  // Antarctica (yes, really — the board is worldwide)
  { callsign: 'cold_boot', city: 'McMurdo Station', lat: -77.8419, lng: 166.6863 },
]
