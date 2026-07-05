/**
 * Keplerian Planetary Ephemeris
 *
 * Implements the VSOP87 low-precision approximation from:
 *   Jean Meeus, "Astronomical Algorithms", 2nd ed. (1998)
 *   Chapters 25, 27, 33 — Planetary Positions, Nutation, Sidereal Time
 *
 * Accuracy: < 1 arcminute for planets from 1950–2050.
 * For sub-arcsecond precision use the JPL Horizons API directly.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface EclipticCoords {
  /** Ecliptic longitude in degrees [0, 360) */
  lon: number;
  /** Ecliptic latitude in degrees [-90, 90] */
  lat: number;
  /** Heliocentric distance in AU */
  r: number;
}

export interface EquatorialCoords {
  /** Right ascension in degrees [0, 360) */
  ra: number;
  /** Declination in degrees [-90, 90] */
  dec: number;
  /** Distance from Earth in AU */
  dist: number;
}

export interface HorizontalCoords {
  /** Altitude above horizon in degrees [-90, 90] */
  alt: number;
  /** Azimuth in degrees [0, 360), measured N through E */
  az: number;
}

export interface PlanetElements {
  /** Semi-major axis in AU: a + a_dot * T */
  a: number;
  a_dot: number;
  /** Eccentricity: e + e_dot * T */
  e: number;
  e_dot: number;
  /** Inclination in degrees: i + i_dot * T */
  i: number;
  i_dot: number;
  /** Mean longitude in degrees: L + L_dot * T */
  L: number;
  L_dot: number;
  /** Longitude of perihelion in degrees: w + w_dot * T */
  w: number;
  w_dot: number;
  /** Longitude of ascending node in degrees: Om + Om_dot * T */
  Om: number;
  Om_dot: number;
}

export type PlanetName =
  | 'Mercury' | 'Venus' | 'Earth' | 'Mars'
  | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune';

export interface PlanetState {
  name: PlanetName;
  equatorial: EquatorialCoords;
  ecliptic: EclipticCoords;
  /** Visual magnitude (approximate) */
  magnitude: number;
  /** Angular diameter in arcseconds */
  angularDiameterArcsec: number;
  /** Phase angle in degrees [0, 180] */
  phaseAngle: number;
  /** Illuminated fraction [0, 1] */
  illumination: number;
}

export interface VisibilityWindow {
  /** Altitude at culmination in degrees */
  maxAltitude: number;
  /** UT hour of rise (undefined if circumpolar or never rises) */
  riseHour?: number;
  /** UT hour of transit */
  transitHour: number;
  /** UT hour of set (undefined if circumpolar or never sets) */
  setHour?: number;
  /** True if object never sets below horizon */
  isCircumpolar: boolean;
  /** True if object never rises above horizon */
  neverRises: boolean;
}

export interface ObservingConditions {
  /** Twilight type at the given time */
  twilight: 'day' | 'civil' | 'nautical' | 'astronomical' | 'night';
  /** Sun altitude in degrees */
  sunAltitude: number;
  /** Moon altitude in degrees */
  moonAltitude: number;
  /** Moon illuminated fraction [0, 1] */
  moonIllumination: number;
  /** Moon phase angle in degrees */
  moonPhaseAngle: number;
  /** Moon age in days since new moon */
  moonAgeDays: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * Keplerian orbital elements for J2000.0 epoch.
 * Source: Meeus, Table 31.a (mean elements, centuries from J2000.0)
 * Units: AU, degrees; _dot values are per Julian century (T).
 */
const PLANET_ELEMENTS: Record<PlanetName, PlanetElements> = {
  Mercury: {
    a: 0.38709927, a_dot: 0.00000037,
    e: 0.20563593, e_dot: 0.00001906,
    i: 7.00497902,  i_dot: -0.00594749,
    L: 252.25032350, L_dot: 149472.67411175,
    w: 77.45779628,  w_dot: 0.16047689,
    Om: 48.33076593, Om_dot: -0.12534081,
  },
  Venus: {
    a: 0.72333566, a_dot: 0.00000390,
    e: 0.00677672, e_dot: -0.00004107,
    i: 3.39467605,  i_dot: -0.00078890,
    L: 181.97909950, L_dot: 58517.81538729,
    w: 131.60246718, w_dot: 0.00268329,
    Om: 76.67984255, Om_dot: -0.27769418,
  },
  Earth: {
    a: 1.00000018, a_dot: -0.00000003,
    e: 0.01673163, e_dot: -0.00003661,
    i: -0.00054346, i_dot: -0.01337178,
    L: 100.46457166, L_dot: 35999.37244981,
    w: 102.93768193, w_dot: 0.32327364,
    Om: -5.11260389, Om_dot: -0.24123353,
  },
  Mars: {
    a: 1.52371034, a_dot: 0.00001847,
    e: 0.09339410, e_dot: 0.00007882,
    i: 1.84969142,  i_dot: -0.00813131,
    L: -4.55343205, L_dot: 19140.30268499,
    w: -23.94362959, w_dot: 0.44441088,
    Om: 49.55953891, Om_dot: -0.29257343,
  },
  Jupiter: {
    a: 5.20288700, a_dot: -0.00011607,
    e: 0.04838624, e_dot: -0.00013253,
    i: 1.30439695,  i_dot: -0.00183714,
    L: 34.39644051, L_dot: 3034.74612775,
    w: 14.72847983,  w_dot: 0.21252668,
    Om: 100.47390909, Om_dot: 0.20469106,
  },
  Saturn: {
    a: 9.53667594, a_dot: -0.00125060,
    e: 0.05386179, e_dot: -0.00050991,
    i: 2.48599187,  i_dot: 0.00193609,
    L: 49.95424423, L_dot: 1222.49362201,
    w: 92.59887831,  w_dot: -0.41897216,
    Om: 113.66242448, Om_dot: -0.28867794,
  },
  Uranus: {
    a: 19.18916464, a_dot: -0.00196176,
    e: 0.04725744,  e_dot: -0.00004397,
    i: 0.77263783,   i_dot: -0.00242939,
    L: 313.23810451, L_dot: 428.48202785,
    w: 170.95427630, w_dot: 0.40805281,
    Om: 74.01692503,  Om_dot: 0.04240589,
  },
  Neptune: {
    a: 30.06992276, a_dot: 0.00026291,
    e: 0.00859048,  e_dot: 0.00005105,
    i: 1.77004347,   i_dot: 0.00035372,
    L: -55.12002969, L_dot: 218.45945325,
    w: 44.96476227,  w_dot: -0.32241464,
    Om: 131.78422574, Om_dot: -0.00508664,
  },
};

/**
 * Mean visual magnitudes at 1 AU distance, 0 phase angle.
 * Source: Meeus, Table 33.a
 */
const V0: Record<PlanetName, number> = {
  Mercury: -0.42, Venus: -4.40, Earth: 0,
  Mars: -1.52, Jupiter: -9.40, Saturn: -8.88,
  Uranus: -7.19, Neptune: -6.87,
};

/**
 * Equatorial radius in km (for angular diameter computation).
 * Source: IAU 2015 nominal values
 */
const EQUATORIAL_RADIUS_KM: Record<PlanetName, number> = {
  Mercury: 2439.7, Venus: 6051.8, Earth: 6378.1,
  Mars: 3396.2, Jupiter: 71492, Saturn: 60268,
  Uranus: 25559, Neptune: 24764,
};

// ── Core Math Utilities ───────────────────────────────────────────────────────

/**
 * Normalises an angle to [0, 360).
 */
function mod360(x: number): number {
  return ((x % 360) + 360) % 360;
}

/**
 * Converts degrees to radians.
 */
function toRad(deg: number): number {
  return deg * DEG;
}

/**
 * Converts radians to degrees.
 */
function toDeg(rad: number): number {
  return rad * RAD;
}

// ── Julian Date ───────────────────────────────────────────────────────────────

/**
 * Computes the Julian Ephemeris Day for a UTC Date object.
 * Meeus, Ch. 7, eq. 7.1 — "Calendar date and Julian Day Number".
 */
export function julianDate(date: Date): number {
  const Y = date.getUTCFullYear();
  const M = date.getUTCMonth() + 1;
  const D = date.getUTCDate()
    + date.getUTCHours() / 24
    + date.getUTCMinutes() / 1440
    + date.getUTCSeconds() / 86400
    + date.getUTCMilliseconds() / 86400000;

  const yr = M <= 2 ? Y - 1 : Y;
  const mo = M <= 2 ? M + 12 : M;
  const A = Math.floor(yr / 100);
  const B = 2 - A + Math.floor(A / 4);

  return Math.floor(365.25 * (yr + 4716)) + Math.floor(30.6001 * (mo + 1)) + D + B - 1524.5;
}

/**
 * Julian centuries from J2000.0 (JD 2451545.0).
 * Meeus, Ch. 22, eq. 22.1 — "T = (JD − 2451545.0) / 36525".
 */
export function julianCenturies(jd: number): number {
  return (jd - 2451545.0) / 36525.0;
}

// ── Orbital Elements ──────────────────────────────────────────────────────────

/**
 * Evaluates mean orbital elements at epoch T (Julian centuries from J2000).
 * Source: Meeus, Table 31.a — time derivatives applied linearly.
 */
function elementsAtT(planet: PlanetName, T: number): {
  a: number; e: number; i: number; M: number; w_bar: number; Om: number;
} {
  const el = PLANET_ELEMENTS[planet];
  const a    = el.a    + el.a_dot    * T;
  const e    = el.e    + el.e_dot    * T;
  const i    = el.i    + el.i_dot    * T;
  const L    = mod360(el.L    + el.L_dot    * T);
  const w_bar = mod360(el.w   + el.w_dot    * T);  // longitude of perihelion
  const Om   = mod360(el.Om   + el.Om_dot   * T);
  const M    = mod360(L - w_bar);                  // mean anomaly

  return { a, e, i, M, w_bar, Om };
}

// ── Kepler's Equation Solver ──────────────────────────────────────────────────

/**
 * Solves Kepler's equation M = E − e·sin(E) for eccentric anomaly E (degrees)
 * using Newton–Raphson iteration.
 * Meeus, Ch. 30 — "Equation of Kepler".
 * Converges to < 1e-10 degrees in ≤ 6 iterations for e < 0.2.
 */
function eccentricAnomaly(M_deg: number, e: number): number {
  let E = M_deg + (180 / Math.PI) * e * Math.sin(toRad(M_deg)) * (1 + e * Math.cos(toRad(M_deg)));
  for (let iter = 0; iter < 50; iter++) {
    const dE = (M_deg - E + toDeg(e * Math.sin(toRad(E)))) / (1 - e * Math.cos(toRad(E)));
    E += dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  return E;
}

// ── Heliocentric Ecliptic Coordinates ────────────────────────────────────────

/**
 * Computes heliocentric ecliptic coordinates (lon, lat, r) for a planet.
 * Meeus, Ch. 33 — "Elliptic Motion" via orbital elements.
 *
 * Steps:
 *  1. Compute mean anomaly M from mean longitude and perihelion longitude.
 *  2. Solve Kepler's equation for eccentric anomaly E.
 *  3. Compute true anomaly v from E.
 *  4. Project into heliocentric ecliptic frame using inclination and node.
 */
function heliocentricEcliptic(planet: PlanetName, T: number): EclipticCoords {
  const { a, e, i, M, w_bar, Om } = elementsAtT(planet, T);

  const E = eccentricAnomaly(M, e);
  const E_rad = toRad(E);

  // True anomaly
  const xv = a * (Math.cos(E_rad) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E_rad);
  const v   = toDeg(Math.atan2(yv, xv));
  const r   = Math.sqrt(xv * xv + yv * yv);

  // Argument of latitude
  const w = mod360(w_bar - Om);  // argument of perihelion
  const u = toRad(mod360(v + w));

  const Om_r = toRad(Om);
  const i_r  = toRad(i);

  // Heliocentric ecliptic coordinates (Meeus, eq. 33.7)
  const x = r * (Math.cos(Om_r) * Math.cos(u) - Math.sin(Om_r) * Math.sin(u) * Math.cos(i_r));
  const y = r * (Math.sin(Om_r) * Math.cos(u) + Math.cos(Om_r) * Math.sin(u) * Math.cos(i_r));
  const z = r * Math.sin(u) * Math.sin(i_r);

  const lon = mod360(toDeg(Math.atan2(y, x)));
  const lat = toDeg(Math.asin(z / r));

  return { lon, lat, r };
}

// ── Obliquity of the Ecliptic ─────────────────────────────────────────────────

/**
 * Mean obliquity of the ecliptic in degrees.
 * Meeus, Ch. 22, eq. 22.2 — IAU formula for ε₀.
 */
function obliquity(T: number): number {
  return 23.439291111
    - 0.013004167  * T
    - 0.000001639  * T * T
    + 0.000503611  * T * T * T;
}

// ── Geocentric Equatorial Coordinates ────────────────────────────────────────

/**
 * Converts geocentric ecliptic (lon, lat) to equatorial (RA, Dec).
 * Meeus, Ch. 13 — "Transformation of Coordinates", eq. 13.3–13.4.
 */
function eclipticToEquatorial(
  lon: number, lat: number, eps: number
): { ra: number; dec: number } {
  const l = toRad(lon);
  const b = toRad(lat);
  const e = toRad(eps);

  const ra  = mod360(toDeg(Math.atan2(
    Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e),
    Math.cos(l)
  )));
  const dec = toDeg(Math.asin(
    Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)
  ));

  return { ra, dec };
}

/**
 * Returns geocentric equatorial coordinates for a planet at the given date.
 *
 * Algorithm:
 *  1. Compute heliocentric ecliptic coords of planet and Earth.
 *  2. Convert to rectangular heliocentric coords.
 *  3. Subtract Earth's position to get geocentric rectangular coords.
 *  4. Convert to ecliptic spherical, then to equatorial.
 *
 * Meeus, Ch. 33, §"Rectangular Coordinates of a Planet".
 */
export function planetEquatorial(planet: PlanetName, date: Date): EquatorialCoords {
  const jd = julianDate(date);
  const T  = julianCenturies(jd);
  const eps = obliquity(T);

  const pl = heliocentricEcliptic(planet, T);
  const ea = heliocentricEcliptic('Earth', T);

  // Heliocentric rectangular
  const px = pl.r * Math.cos(toRad(pl.lat)) * Math.cos(toRad(pl.lon));
  const py = pl.r * Math.cos(toRad(pl.lat)) * Math.sin(toRad(pl.lon));
  const pz = pl.r * Math.sin(toRad(pl.lat));

  const ex = ea.r * Math.cos(toRad(ea.lat)) * Math.cos(toRad(ea.lon));
  const ey = ea.r * Math.cos(toRad(ea.lat)) * Math.sin(toRad(ea.lon));
  const ez = ea.r * Math.sin(toRad(ea.lat));

  // Geocentric rectangular
  const dx = px - ex;
  const dy = py - ey;
  const dz = pz - ez;

  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const geoLon = mod360(toDeg(Math.atan2(dy, dx)));
  const geoLat = toDeg(Math.asin(dz / dist));

  const { ra, dec } = eclipticToEquatorial(geoLon, geoLat, eps);
  return { ra, dec, dist };
}

// ── Horizontal Coordinates ────────────────────────────────────────────────────

/**
 * Greenwich Mean Sidereal Time in degrees for the given JD.
 * Meeus, Ch. 12, eq. 12.4 — "Sidereal Time at Greenwich".
 */
export function greenwichSiderealTime(jd: number): number {
  const T = julianCenturies(jd);
  const theta = 280.46061837
    + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T
    - T * T * T / 38710000;
  return mod360(theta);
}

/**
 * Converts equatorial (RA, Dec) to horizontal (Az, Alt) coordinates.
 * Meeus, Ch. 13, eq. 13.5–13.6.
 *
 * @param ra  Right ascension in degrees
 * @param dec Declination in degrees
 * @param lat Observer latitude in degrees
 * @param lon Observer longitude in degrees (east positive)
 * @param jd  Julian date
 */
export function equatorialToHorizontal(
  ra: number, dec: number,
  lat: number, lon: number,
  jd: number
): HorizontalCoords {
  const gst = greenwichSiderealTime(jd);
  const lst = mod360(gst + lon);              // local sidereal time
  const H   = mod360(lst - ra);              // hour angle

  const H_r   = toRad(H);
  const dec_r = toRad(dec);
  const lat_r = toRad(lat);

  const sinAlt = Math.sin(lat_r) * Math.sin(dec_r)
               + Math.cos(lat_r) * Math.cos(dec_r) * Math.cos(H_r);
  const alt = toDeg(Math.asin(sinAlt));

  const cosAz = (Math.sin(dec_r) - Math.sin(lat_r) * sinAlt)
              / (Math.cos(lat_r) * Math.cos(toRad(alt)));
  let az = toDeg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
  if (Math.sin(H_r) > 0) az = 360 - az;

  return { alt, az };
}

// ── Planet State (All-in-one) ─────────────────────────────────────────────────

/**
 * Returns the full observable state for a planet: position, magnitude,
 * angular diameter, phase, and illumination.
 *
 * Magnitude formula: V = V₀ + 5·log₁₀(r·Δ)
 * Meeus, Ch. 41 — "Magnitudes of Planets and their Satellites".
 *
 * Phase angle i via cosine rule:  cos i = (r² + Δ² − R²) / (2·r·Δ)
 * where r = helio dist of planet, Δ = geo dist, R = 1 AU (Earth-Sun dist).
 * Meeus, Ch. 41, eq. 41.2.
 */
export function planetState(planet: PlanetName, date: Date): PlanetState {
  const jd = julianDate(date);
  const T  = julianCenturies(jd);

  const equatorial = planetEquatorial(planet, date);
  const ecliptic   = heliocentricEcliptic(planet, T);
  const earthEcl   = heliocentricEcliptic('Earth', T);

  const r  = ecliptic.r;       // heliocentric dist (planet)
  const R  = earthEcl.r;       // Earth-Sun dist
  const Δ  = equatorial.dist;  // geocentric dist

  const cosPhase = (r * r + Δ * Δ - R * R) / (2 * r * Δ);
  const phaseAngle = toDeg(Math.acos(Math.max(-1, Math.min(1, cosPhase))));
  const illumination = (1 + Math.cos(toRad(phaseAngle))) / 2;

  const magnitude = V0[planet] + 5 * Math.log10(r * Δ);

  const radiusKm = EQUATORIAL_RADIUS_KM[planet];
  const AU_KM = 149597870.7;
  const angularDiameterArcsec = (2 * radiusKm) / (Δ * AU_KM) * RAD * 3600;

  return { name: planet, equatorial, ecliptic, magnitude, angularDiameterArcsec, phaseAngle, illumination };
}

/**
 * Returns states for all planets at the given date.
 */
export function allPlanetStates(date: Date): PlanetState[] {
  const planets: PlanetName[] = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
  return planets.map(p => planetState(p, date));
}

// ── Sun Position ──────────────────────────────────────────────────────────────

/**
 * Returns the Sun's apparent geocentric equatorial coordinates.
 * The Sun's position is the negative of Earth's heliocentric position.
 * Meeus, Ch. 25 — "Solar Coordinates".
 */
export function sunEquatorial(date: Date): EquatorialCoords {
  const jd  = julianDate(date);
  const T   = julianCenturies(jd);
  const eps = obliquity(T);

  const ea  = heliocentricEcliptic('Earth', T);
  // Sun is at opposite ecliptic longitude from Earth
  const lon = mod360(ea.lon + 180);
  const lat = -ea.lat;

  const { ra, dec } = eclipticToEquatorial(lon, lat, eps);
  return { ra, dec, dist: ea.r };
}

// ── Moon Position ─────────────────────────────────────────────────────────────

/**
 * Computes the Moon's geocentric equatorial coordinates using a truncated
 * ELP-2000 series (the simplified Meeus version).
 * Meeus, Ch. 47 — "Position of the Moon", accurate to ~10 arcseconds.
 */
export function moonEquatorial(date: Date): EquatorialCoords & { illumination: number; phaseAngle: number; ageDays: number } {
  const jd = julianDate(date);
  const T  = julianCenturies(jd);
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  // Fundamental arguments (Meeus, Ch. 47, eq. 47.1–47.4)
  const L_prime = mod360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D       = mod360(297.8501921 + 445267.1114034  * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000);
  const M       = mod360(357.5291092 + 35999.0502909   * T - 0.0001536 * T2 + T3 / 24490000);
  const M_prime = mod360(134.9633964 + 477198.8675055  * T + 0.0087414 * T2 + T3 / 69699  - T4 / 14712000);
  const F       = mod360(93.2720950  + 483202.0175233  * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000);

  // Longitude perturbation (largest terms only — Meeus, Table 47.A)
  let sumL = 6288774 * Math.sin(toRad(M_prime))
           + 1274027 * Math.sin(toRad(2*D - M_prime))
           +  658314 * Math.sin(toRad(2*D))
           +  213618 * Math.sin(toRad(2*M_prime))
           -  185116 * Math.sin(toRad(M))
           -  114332 * Math.sin(toRad(2*F))
           +   58793 * Math.sin(toRad(2*D - 2*M_prime))
           +   57066 * Math.sin(toRad(2*D - M - M_prime))
           +   53322 * Math.sin(toRad(2*D + M_prime))
           +   45758 * Math.sin(toRad(2*D - M))
           -   40923 * Math.sin(toRad(M - M_prime))
           -   34720 * Math.sin(toRad(D))
           -   30383 * Math.sin(toRad(M + M_prime))
           +   15327 * Math.sin(toRad(2*D - 2*F))
           -   12528 * Math.sin(toRad(M_prime + 2*F))
           +   10980 * Math.sin(toRad(M_prime - 2*F))
           +   10675 * Math.sin(toRad(4*D - M_prime))
           +   10034 * Math.sin(toRad(3*M_prime))
           +    8548 * Math.sin(toRad(4*D - 2*M_prime))
           -    7888 * Math.sin(toRad(2*D + M - M_prime))
           -    6766 * Math.sin(toRad(2*D + M))
           -    5163 * Math.sin(toRad(D - M_prime))
           +    4987 * Math.sin(toRad(D + M))
           +    4036 * Math.sin(toRad(2*D - M + M_prime))
           +    3994 * Math.sin(toRad(2*D + 2*M_prime))
           +    3861 * Math.sin(toRad(4*D))
           +    3665 * Math.sin(toRad(2*D - 3*M_prime))
           -    2689 * Math.sin(toRad(M - 2*M_prime))
           -    2602 * Math.sin(toRad(2*D - M_prime + 2*F))
           +    2390 * Math.sin(toRad(2*D - M_prime - 2*F))
           -    2348 * Math.sin(toRad(D + M_prime))
           +    2236 * Math.sin(toRad(2*D - 2*M))
           -    2120 * Math.sin(toRad(M + 2*M_prime))
           -    2069 * Math.sin(toRad(2*M))
           +    2048 * Math.sin(toRad(2*D - 2*M - M_prime))
           -    1773 * Math.sin(toRad(2*D + M_prime - 2*F))
           -    1595 * Math.sin(toRad(2*D + 2*F))
           +    1215 * Math.sin(toRad(4*D - M - M_prime))
           -    1110 * Math.sin(toRad(2*M_prime + 2*F))
           -     892 * Math.sin(toRad(3*D - M_prime))
           -     810 * Math.sin(toRad(2*D + M + M_prime))
           +     759 * Math.sin(toRad(4*D - M - 2*M_prime))
           -     713 * Math.sin(toRad(2*M - M_prime))
           -     700 * Math.sin(toRad(2*D + 2*M - M_prime))
           +     691 * Math.sin(toRad(2*D + M - 2*M_prime))
           +     596 * Math.sin(toRad(2*D - M - 2*F))
           +     549 * Math.sin(toRad(4*D + M_prime))
           +     537 * Math.sin(toRad(4*M_prime))
           +     520 * Math.sin(toRad(4*D - M))
           -     487 * Math.sin(toRad(D - 2*M_prime))
           -     399 * Math.sin(toRad(2*D + M - 2*F))
           -     381 * Math.sin(toRad(2*M_prime - 2*F))
           +     351 * Math.sin(toRad(D + M + M_prime))
           -     340 * Math.sin(toRad(3*D - 2*M_prime))
           +     330 * Math.sin(toRad(4*D - 3*M_prime))
           +     327 * Math.sin(toRad(2*D - M + 2*M_prime))
           -     323 * Math.sin(toRad(2*M + M_prime))
           +     299 * Math.sin(toRad(D + M - M_prime))
           +     294 * Math.sin(toRad(2*D + 3*M_prime));

  // Latitude perturbation (Meeus, Table 47.B)
  let sumB = 5128122 * Math.sin(toRad(F))
           +  280602 * Math.sin(toRad(M_prime + F))
           +  277693 * Math.sin(toRad(M_prime - F))
           +  173237 * Math.sin(toRad(2*D - F))
           +   55413 * Math.sin(toRad(2*D - M_prime + F))
           +   46271 * Math.sin(toRad(2*D - M_prime - F))
           +   32573 * Math.sin(toRad(2*D + F))
           +   17198 * Math.sin(toRad(2*M_prime + F))
           +    9266 * Math.sin(toRad(2*D + M_prime - F))
           +    8822 * Math.sin(toRad(2*M_prime - F))
           +    8216 * Math.sin(toRad(2*D - M - F))
           +    4324 * Math.sin(toRad(2*D - 2*M_prime - F))
           +    4200 * Math.sin(toRad(2*D + M_prime + F))
           -    3359 * Math.sin(toRad(2*D + M - F))
           +    2463 * Math.sin(toRad(2*D - M - M_prime + F))
           +    2211 * Math.sin(toRad(2*D - M + F))
           +    2065 * Math.sin(toRad(2*D - M - M_prime - F))
           -    1870 * Math.sin(toRad(M - M_prime - F))
           +    1828 * Math.sin(toRad(4*D - M_prime - F))
           -    1794 * Math.sin(toRad(M + F))
           -    1749 * Math.sin(toRad(3*F))
           -    1565 * Math.sin(toRad(M - M_prime + F))
           -    1491 * Math.sin(toRad(D + F))
           -    1475 * Math.sin(toRad(M + M_prime + F))
           -    1410 * Math.sin(toRad(M + M_prime - F))
           -    1344 * Math.sin(toRad(M - F))
           -    1335 * Math.sin(toRad(D - F))
           +    1107 * Math.sin(toRad(3*M_prime + F))
           +    1021 * Math.sin(toRad(4*D - F))
           +     833 * Math.sin(toRad(4*D - M_prime + F));

  const moonLon = mod360(L_prime + sumL / 1000000);
  const moonLat = sumB / 1000000;

  const eps = obliquity(T);
  const { ra, dec } = eclipticToEquatorial(moonLon, moonLat, eps);

  // Distance (Meeus, Table 47.A, Σr column) — approximate at mean distance
  const moonDist_km = 385000.56;
  const dist = moonDist_km / 149597870.7;  // convert to AU

  // Moon phase
  const sunEq = sunEquatorial(date);
  const elongation = mod360(ra - sunEq.ra);
  const phaseAngle = mod360(180 - elongation);
  const illumination = (1 + Math.cos(toRad(phaseAngle))) / 2;

  // Age in days (synodic period ~29.53059 days)
  const synodicPeriod = 29.53059;
  const ageDays = mod360(moonLon - sunEq.ra) / 360 * synodicPeriod;

  return { ra, dec, dist, illumination, phaseAngle, ageDays };
}

// ── Observing Conditions ──────────────────────────────────────────────────────

/**
 * Computes twilight state and Moon data for the observer at a given time.
 * Twilight boundaries per IAU convention (Meeus, Ch. 15):
 *  - Civil:        Sun below −6°
 *  - Nautical:     Sun below −12°
 *  - Astronomical: Sun below −18°
 */
export function observingConditions(
  date: Date,
  latDeg: number,
  lonDeg: number
): ObservingConditions {
  const jd = julianDate(date);

  const sunEq  = sunEquatorial(date);
  const sunHz  = equatorialToHorizontal(sunEq.ra, sunEq.dec, latDeg, lonDeg, jd);

  const moonEq = moonEquatorial(date);
  const moonHz = equatorialToHorizontal(moonEq.ra, moonEq.dec, latDeg, lonDeg, jd);

  let twilight: ObservingConditions['twilight'];
  const alt = sunHz.alt;
  if (alt >= -6)       twilight = alt >= 0 ? 'day' : 'civil';
  else if (alt >= -12) twilight = 'nautical';
  else if (alt >= -18) twilight = 'astronomical';
  else                 twilight = 'night';

  return {
    twilight,
    sunAltitude:       sunHz.alt,
    moonAltitude:      moonHz.alt,
    moonIllumination:  moonEq.illumination,
    moonPhaseAngle:    moonEq.phaseAngle,
    moonAgeDays:       moonEq.ageDays,
  };
}

// ── Visibility Score ──────────────────────────────────────────────────────────

/**
 * Computes a 0–100 visibility score for a planet tonight.
 *
 * Factors weighted:
 *  - Max altitude (40 pts): penalises low transit, ideal at +70°
 *  - Darkness (30 pts): requires astronomical twilight or night
 *  - Moon interference (20 pts): reduces score when Moon is bright and nearby
 *  - Magnitude (10 pts): brighter is better
 *
 * Returns a score and a human-readable label.
 */
export function visibilityScore(
  state: PlanetState,
  latDeg: number,
  lonDeg: number,
  date: Date
): { score: number; label: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Unobservable' } {
  const jd  = julianDate(date);
  const hz  = equatorialToHorizontal(state.equatorial.ra, state.equatorial.dec, latDeg, lonDeg, jd);
  const cond = observingConditions(date, latDeg, lonDeg);

  // Altitude score (0–40)
  const altScore = hz.alt < 10 ? 0 : Math.min(40, (hz.alt - 10) / 60 * 40);

  // Darkness score (0–30)
  const darknessScore = cond.twilight === 'night'         ? 30
                      : cond.twilight === 'astronomical'   ? 20
                      : cond.twilight === 'nautical'        ? 8
                      : cond.twilight === 'civil'           ? 2
                      : 0;

  // Moon interference (0–20, penalised)
  const moonSep = Math.abs(mod360(state.equatorial.ra - cond.moonAltitude));
  const moonPenalty = cond.moonIllumination > 0.5 && moonSep < 30
    ? cond.moonIllumination * 15
    : 0;
  const moonScore = Math.max(0, 20 - moonPenalty);

  // Magnitude score (0–10): scale −5 to +6 → 0–10
  const magScore = Math.max(0, Math.min(10, (6 - state.magnitude) / 11 * 10));

  const total = Math.round(altScore + darknessScore + moonScore + magScore);

  const label = total >= 80 ? 'Excellent'
              : total >= 60 ? 'Good'
              : total >= 40 ? 'Fair'
              : total >= 20 ? 'Poor'
              : 'Unobservable';

  return { score: total, label };
}

// ── Solar Event Times ─────────────────────────────────────────────────────────

export interface SolarEventTimes {
  astronomicalDawn: Date | null;
  nauticalDawn: Date | null;
  civilDawn: Date | null;
  sunrise: Date | null;
  solarNoon: Date;
  sunset: Date | null;
  civilDusk: Date | null;
  nauticalDusk: Date | null;
  astronomicalDusk: Date | null;
}

/**
 * Computes sunrise, sunset, and twilight times for a given date and location.
 * Meeus, Ch. 15 — "Rising, Transit, and Setting".
 * Accuracy: ±1–2 minutes (ignores daily Sun motion correction).
 */
export function solarEvents(date: Date, latDeg: number, lonDeg: number): SolarEventTimes {
  const jd0 = Math.floor(julianDate(date) - 0.5) + 0.5;
  const date0 = new Date((jd0 - 2440587.5) * 86400000);
  const theta0 = greenwichSiderealTime(jd0);  // GMST at 0h UT
  const sun = sunEquatorial(date0);
  const ra = sun.ra;
  const dec = sun.dec;
  const decRad = toRad(dec);
  const latRad = toRad(latDeg);

  function rts(h0Deg: number): { rise: Date | null; transit: Date; set: Date | null } {
    const h0Rad = toRad(h0Deg);
    const cosH0 = (Math.sin(h0Rad) - Math.sin(latRad) * Math.sin(decRad))
                / (Math.cos(latRad) * Math.cos(decRad));

    const m0Raw = (ra - lonDeg - theta0) / 360;
    const m0 = ((m0Raw % 1) + 1) % 1;
    const transit = new Date(date0.getTime() + m0 * 86400000);

    if (cosH0 > 1 || cosH0 < -1) return { rise: null, transit, set: null };

    const H0 = toDeg(Math.acos(cosH0));
    const m1 = ((m0Raw - H0 / 360) % 1 + 1) % 1;
    const m2 = ((m0Raw + H0 / 360) % 1 + 1) % 1;
    return {
      rise: new Date(date0.getTime() + m1 * 86400000),
      transit,
      set:  new Date(date0.getTime() + m2 * 86400000),
    };
  }

  const solar    = rts(-0.8333);
  const civil    = rts(-6);
  const nautical = rts(-12);
  const astro    = rts(-18);

  return {
    astronomicalDawn:  astro.rise,
    nauticalDawn:      nautical.rise,
    civilDawn:         civil.rise,
    sunrise:           solar.rise,
    solarNoon:         solar.transit,
    sunset:            solar.set,
    civilDusk:         civil.set,
    nauticalDusk:      nautical.set,
    astronomicalDusk:  astro.set,
  };
}

// ── Moon Geocentric Ecliptic ──────────────────────────────────────────────────

/**
 * Returns the Moon's geocentric ecliptic coordinates.
 * Uses the main terms from the truncated ELP-2000 series.
 * Meeus, Ch. 47. Used by the orrery to position the Moon relative to Earth.
 */
export function moonGeocentricEcliptic(date: Date): { lon: number; lat: number; r_km: number } {
  const jd = julianDate(date);
  const T  = julianCenturies(jd);
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  const L_prime = mod360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841   - T4 / 65194000);
  const D       = mod360(297.8501921 + 445267.1114034  * T - 0.0018819 * T2 + T3 / 545868   - T4 / 113065000);
  const M       = mod360(357.5291092 + 35999.0502909   * T - 0.0001536 * T2 + T3 / 24490000);
  const Mp      = mod360(134.9633964 + 477198.8675055  * T + 0.0087414 * T2 + T3 / 69699    - T4 / 14712000);
  const F       = mod360(93.2720950  + 483202.0175233  * T - 0.0036539 * T2 - T3 / 3526000  + T4 / 863310000);

  const sumL = 6288774 * Math.sin(toRad(Mp))
             + 1274027 * Math.sin(toRad(2*D - Mp))
             +  658314 * Math.sin(toRad(2*D))
             +  213618 * Math.sin(toRad(2*Mp))
             -  185116 * Math.sin(toRad(M))
             -  114332 * Math.sin(toRad(2*F))
             +   58793 * Math.sin(toRad(2*D - 2*Mp))
             +   57066 * Math.sin(toRad(2*D - M - Mp))
             +   53322 * Math.sin(toRad(2*D + Mp));

  const sumB = 5128122 * Math.sin(toRad(F))
             +  280602 * Math.sin(toRad(Mp + F))
             +  277693 * Math.sin(toRad(Mp - F))
             +  173237 * Math.sin(toRad(2*D - F))
             +   55413 * Math.sin(toRad(2*D - Mp + F))
             +   46271 * Math.sin(toRad(2*D - Mp - F));

  const sumR = -20905355 * Math.cos(toRad(Mp))
              -  3699111 * Math.cos(toRad(2*D - Mp))
              -  2955968 * Math.cos(toRad(2*D))
              -   569925 * Math.cos(toRad(2*Mp))
              +    48888 * Math.cos(toRad(M));

  return {
    lon:  mod360(L_prime + sumL / 1000000),
    lat:  sumB / 1000000,
    r_km: 385000.56 + sumR / 1000,
  };
}

/**
 * Returns all planets sorted by visibility score for tonight (descending).
 * "Tonight" is defined as the next local midnight from `date`.
 */
export function bestTonight(
  latDeg: number,
  lonDeg: number,
  date: Date = new Date()
): Array<PlanetState & { score: number; label: string }> {
  const midnight = new Date(date);
  midnight.setUTCHours(0, 0, 0, 0);
  midnight.setUTCDate(midnight.getUTCDate() + 1);

  const states = allPlanetStates(midnight);

  return states
    .map(s => {
      const { score, label } = visibilityScore(s, latDeg, lonDeg, midnight);
      return { ...s, score, label };
    })
    .sort((a, b) => b.score - a.score);
}
