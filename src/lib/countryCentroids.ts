// ISO 3166-1 alpha-2 → display name + capital-city coordinates. Capitals,
// not geometric centroids: a centroid for Indonesia or Japan lands in the
// sea, and the landing globe pins players "somewhere in their country" by
// jittering around this point (see selectGlobePins in landingLive.ts).
// Codes come from user_devices.country_code, which the sync route fills
// from Vercel's x-vercel-ip-country header (migration 032).

export interface CountryPoint {
  name: string
  /** Latitude in degrees, north positive. */
  lat: number
  /** Longitude in degrees, east positive. */
  lng: number
}

export const COUNTRY_POINTS: Record<string, CountryPoint> = {
  // Americas
  US: { name: 'United States', lat: 38.9072, lng: -77.0369 },
  CA: { name: 'Canada', lat: 45.4215, lng: -75.6972 },
  MX: { name: 'Mexico', lat: 19.4326, lng: -99.1332 },
  GT: { name: 'Guatemala', lat: 14.6349, lng: -90.5069 },
  HN: { name: 'Honduras', lat: 14.0723, lng: -87.1921 },
  SV: { name: 'El Salvador', lat: 13.6929, lng: -89.2182 },
  NI: { name: 'Nicaragua', lat: 12.115, lng: -86.2362 },
  CR: { name: 'Costa Rica', lat: 9.9281, lng: -84.0907 },
  PA: { name: 'Panama', lat: 8.9824, lng: -79.5199 },
  CU: { name: 'Cuba', lat: 23.1136, lng: -82.3666 },
  DO: { name: 'Dominican Republic', lat: 18.4861, lng: -69.9312 },
  JM: { name: 'Jamaica', lat: 17.9714, lng: -76.7931 },
  PR: { name: 'Puerto Rico', lat: 18.4655, lng: -66.1057 },
  TT: { name: 'Trinidad and Tobago', lat: 10.6549, lng: -61.5019 },
  CO: { name: 'Colombia', lat: 4.711, lng: -74.0721 },
  VE: { name: 'Venezuela', lat: 10.4806, lng: -66.9036 },
  EC: { name: 'Ecuador', lat: -0.1807, lng: -78.4678 },
  PE: { name: 'Peru', lat: -12.0464, lng: -77.0428 },
  BO: { name: 'Bolivia', lat: -16.4897, lng: -68.1193 },
  BR: { name: 'Brazil', lat: -15.7939, lng: -47.8828 },
  PY: { name: 'Paraguay', lat: -25.2637, lng: -57.5759 },
  UY: { name: 'Uruguay', lat: -34.9011, lng: -56.1645 },
  AR: { name: 'Argentina', lat: -34.6037, lng: -58.3816 },
  CL: { name: 'Chile', lat: -33.4489, lng: -70.6693 },

  // Europe
  GB: { name: 'United Kingdom', lat: 51.5074, lng: -0.1278 },
  IE: { name: 'Ireland', lat: 53.3498, lng: -6.2603 },
  IS: { name: 'Iceland', lat: 64.1466, lng: -21.9426 },
  PT: { name: 'Portugal', lat: 38.7223, lng: -9.1393 },
  ES: { name: 'Spain', lat: 40.4168, lng: -3.7038 },
  FR: { name: 'France', lat: 48.8566, lng: 2.3522 },
  BE: { name: 'Belgium', lat: 50.8503, lng: 4.3517 },
  NL: { name: 'Netherlands', lat: 52.3676, lng: 4.9041 },
  LU: { name: 'Luxembourg', lat: 49.6116, lng: 6.1319 },
  DE: { name: 'Germany', lat: 52.52, lng: 13.405 },
  CH: { name: 'Switzerland', lat: 46.948, lng: 7.4474 },
  AT: { name: 'Austria', lat: 48.2082, lng: 16.3738 },
  IT: { name: 'Italy', lat: 41.9028, lng: 12.4964 },
  MT: { name: 'Malta', lat: 35.8989, lng: 14.5146 },
  DK: { name: 'Denmark', lat: 55.6761, lng: 12.5683 },
  NO: { name: 'Norway', lat: 59.9139, lng: 10.7522 },
  SE: { name: 'Sweden', lat: 59.3293, lng: 18.0686 },
  FI: { name: 'Finland', lat: 60.1699, lng: 24.9384 },
  EE: { name: 'Estonia', lat: 59.437, lng: 24.7536 },
  LV: { name: 'Latvia', lat: 56.9496, lng: 24.1052 },
  LT: { name: 'Lithuania', lat: 54.6872, lng: 25.2797 },
  PL: { name: 'Poland', lat: 52.2297, lng: 21.0122 },
  CZ: { name: 'Czechia', lat: 50.0755, lng: 14.4378 },
  SK: { name: 'Slovakia', lat: 48.1486, lng: 17.1077 },
  HU: { name: 'Hungary', lat: 47.4979, lng: 19.0402 },
  SI: { name: 'Slovenia', lat: 46.0569, lng: 14.5058 },
  HR: { name: 'Croatia', lat: 45.815, lng: 15.9819 },
  BA: { name: 'Bosnia and Herzegovina', lat: 43.8563, lng: 18.4131 },
  RS: { name: 'Serbia', lat: 44.7866, lng: 20.4489 },
  ME: { name: 'Montenegro', lat: 42.4304, lng: 19.2594 },
  MK: { name: 'North Macedonia', lat: 41.9973, lng: 21.428 },
  AL: { name: 'Albania', lat: 41.3275, lng: 19.8187 },
  GR: { name: 'Greece', lat: 37.9838, lng: 23.7275 },
  CY: { name: 'Cyprus', lat: 35.1856, lng: 33.3823 },
  BG: { name: 'Bulgaria', lat: 42.6977, lng: 23.3219 },
  RO: { name: 'Romania', lat: 44.4268, lng: 26.1025 },
  MD: { name: 'Moldova', lat: 47.0105, lng: 28.8638 },
  UA: { name: 'Ukraine', lat: 50.4501, lng: 30.5234 },
  BY: { name: 'Belarus', lat: 53.9006, lng: 27.559 },
  RU: { name: 'Russia', lat: 55.7558, lng: 37.6173 },
  TR: { name: 'Türkiye', lat: 39.9334, lng: 32.8597 },

  // Middle East & Caucasus
  IL: { name: 'Israel', lat: 31.7683, lng: 35.2137 },
  LB: { name: 'Lebanon', lat: 33.8938, lng: 35.5018 },
  SY: { name: 'Syria', lat: 33.5138, lng: 36.2765 },
  JO: { name: 'Jordan', lat: 31.9454, lng: 35.9284 },
  IQ: { name: 'Iraq', lat: 33.3152, lng: 44.3661 },
  IR: { name: 'Iran', lat: 35.6892, lng: 51.389 },
  SA: { name: 'Saudi Arabia', lat: 24.7136, lng: 46.6753 },
  KW: { name: 'Kuwait', lat: 29.3759, lng: 47.9774 },
  BH: { name: 'Bahrain', lat: 26.2285, lng: 50.586 },
  QA: { name: 'Qatar', lat: 25.2854, lng: 51.531 },
  AE: { name: 'United Arab Emirates', lat: 24.4539, lng: 54.3773 },
  OM: { name: 'Oman', lat: 23.588, lng: 58.3829 },
  YE: { name: 'Yemen', lat: 15.3694, lng: 44.191 },
  GE: { name: 'Georgia', lat: 41.7151, lng: 44.8271 },
  AM: { name: 'Armenia', lat: 40.1792, lng: 44.4991 },
  AZ: { name: 'Azerbaijan', lat: 40.4093, lng: 49.8671 },

  // Central & South Asia
  KZ: { name: 'Kazakhstan', lat: 51.1694, lng: 71.4491 },
  UZ: { name: 'Uzbekistan', lat: 41.2995, lng: 69.2401 },
  KG: { name: 'Kyrgyzstan', lat: 42.8746, lng: 74.5698 },
  TJ: { name: 'Tajikistan', lat: 38.5598, lng: 68.787 },
  TM: { name: 'Turkmenistan', lat: 37.9601, lng: 58.3261 },
  AF: { name: 'Afghanistan', lat: 34.5553, lng: 69.2075 },
  PK: { name: 'Pakistan', lat: 33.6844, lng: 73.0479 },
  IN: { name: 'India', lat: 28.6139, lng: 77.209 },
  NP: { name: 'Nepal', lat: 27.7172, lng: 85.324 },
  BT: { name: 'Bhutan', lat: 27.4728, lng: 89.639 },
  BD: { name: 'Bangladesh', lat: 23.8103, lng: 90.4125 },
  LK: { name: 'Sri Lanka', lat: 6.9271, lng: 79.8612 },
  MV: { name: 'Maldives', lat: 4.1755, lng: 73.5093 },

  // East & Southeast Asia
  CN: { name: 'China', lat: 39.9042, lng: 116.4074 },
  MN: { name: 'Mongolia', lat: 47.8864, lng: 106.9057 },
  KR: { name: 'South Korea', lat: 37.5665, lng: 126.978 },
  JP: { name: 'Japan', lat: 35.6762, lng: 139.6503 },
  TW: { name: 'Taiwan', lat: 25.033, lng: 121.5654 },
  HK: { name: 'Hong Kong', lat: 22.3193, lng: 114.1694 },
  MO: { name: 'Macao', lat: 22.1987, lng: 113.5439 },
  MM: { name: 'Myanmar', lat: 19.7633, lng: 96.0785 },
  TH: { name: 'Thailand', lat: 13.7563, lng: 100.5018 },
  LA: { name: 'Laos', lat: 17.9757, lng: 102.6331 },
  KH: { name: 'Cambodia', lat: 11.5564, lng: 104.9282 },
  VN: { name: 'Vietnam', lat: 21.0278, lng: 105.8342 },
  MY: { name: 'Malaysia', lat: 3.139, lng: 101.6869 },
  SG: { name: 'Singapore', lat: 1.3521, lng: 103.8198 },
  BN: { name: 'Brunei', lat: 4.9031, lng: 114.9398 },
  ID: { name: 'Indonesia', lat: -6.2088, lng: 106.8456 },
  PH: { name: 'Philippines', lat: 14.5995, lng: 120.9842 },

  // Oceania
  AU: { name: 'Australia', lat: -35.2809, lng: 149.13 },
  NZ: { name: 'New Zealand', lat: -41.2865, lng: 174.7762 },
  PG: { name: 'Papua New Guinea', lat: -9.4438, lng: 147.1803 },
  FJ: { name: 'Fiji', lat: -18.1248, lng: 178.4501 },

  // Africa
  MA: { name: 'Morocco', lat: 34.0209, lng: -6.8416 },
  DZ: { name: 'Algeria', lat: 36.7538, lng: 3.0588 },
  TN: { name: 'Tunisia', lat: 36.8065, lng: 10.1815 },
  LY: { name: 'Libya', lat: 32.8872, lng: 13.1913 },
  EG: { name: 'Egypt', lat: 30.0444, lng: 31.2357 },
  SD: { name: 'Sudan', lat: 15.5007, lng: 32.5599 },
  SS: { name: 'South Sudan', lat: 4.8594, lng: 31.5713 },
  ER: { name: 'Eritrea', lat: 15.3229, lng: 38.9251 },
  DJ: { name: 'Djibouti', lat: 11.5721, lng: 43.1456 },
  ET: { name: 'Ethiopia', lat: 9.025, lng: 38.7469 },
  SO: { name: 'Somalia', lat: 2.0469, lng: 45.3182 },
  KE: { name: 'Kenya', lat: -1.2921, lng: 36.8219 },
  UG: { name: 'Uganda', lat: 0.3476, lng: 32.5825 },
  RW: { name: 'Rwanda', lat: -1.9441, lng: 30.0619 },
  BI: { name: 'Burundi', lat: -3.4264, lng: 29.9308 },
  TZ: { name: 'Tanzania', lat: -6.163, lng: 35.7516 },
  MZ: { name: 'Mozambique', lat: -25.9692, lng: 32.5732 },
  MW: { name: 'Malawi', lat: -13.9626, lng: 33.7741 },
  ZM: { name: 'Zambia', lat: -15.3875, lng: 28.3228 },
  ZW: { name: 'Zimbabwe', lat: -17.8252, lng: 31.0335 },
  BW: { name: 'Botswana', lat: -24.6282, lng: 25.9231 },
  NA: { name: 'Namibia', lat: -22.5609, lng: 17.0658 },
  ZA: { name: 'South Africa', lat: -25.7479, lng: 28.2293 },
  MG: { name: 'Madagascar', lat: -18.8792, lng: 47.5079 },
  MU: { name: 'Mauritius', lat: -20.1609, lng: 57.5012 },
  AO: { name: 'Angola', lat: -8.839, lng: 13.2894 },
  CD: { name: 'DR Congo', lat: -4.4419, lng: 15.2663 },
  CG: { name: 'Congo', lat: -4.2634, lng: 15.2429 },
  GA: { name: 'Gabon', lat: 0.4162, lng: 9.4673 },
  CM: { name: 'Cameroon', lat: 3.848, lng: 11.5021 },
  TD: { name: 'Chad', lat: 12.1348, lng: 15.0557 },
  NE: { name: 'Niger', lat: 13.5116, lng: 2.1254 },
  NG: { name: 'Nigeria', lat: 9.0765, lng: 7.3986 },
  BJ: { name: 'Benin', lat: 6.4969, lng: 2.6289 },
  TG: { name: 'Togo', lat: 6.1256, lng: 1.2254 },
  GH: { name: 'Ghana', lat: 5.6037, lng: -0.187 },
  CI: { name: "Côte d'Ivoire", lat: 6.8276, lng: -5.2893 },
  BF: { name: 'Burkina Faso', lat: 12.3714, lng: -1.5197 },
  ML: { name: 'Mali', lat: 12.6392, lng: -8.0029 },
  LR: { name: 'Liberia', lat: 6.3156, lng: -10.8074 },
  SL: { name: 'Sierra Leone', lat: 8.4657, lng: -13.2317 },
  GN: { name: 'Guinea', lat: 9.6412, lng: -13.5784 },
  SN: { name: 'Senegal', lat: 14.7167, lng: -17.4677 },
  GM: { name: 'Gambia', lat: 13.4549, lng: -16.579 },
  MR: { name: 'Mauritania', lat: 18.0735, lng: -15.9582 }
}

/** Lookup tolerant of the raw header casing; null for anything the table
 *  does not know (the caller skips the row rather than guessing). */
export function countryPoint(code: string): CountryPoint | null {
  const key = code.trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(COUNTRY_POINTS, key)
    ? COUNTRY_POINTS[key]
    : null
}
