'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { bestTonight, observingConditions, planetState, solarEvents } from '@/lib/ephemeris';
import type { PlanetName, PlanetState, ObservingConditions, SolarEventTimes } from '@/lib/ephemeris';

// ── Planet facts ──────────────────────────────────────────────────────────────
const PLANET_FACTS: Record<string, { emoji: string; tagline: string; facts: string[] }> = {
  Mercury: {
    emoji: '⚫',
    tagline: 'The Swift Messenger',
    facts: [
      'A year lasts just 88 Earth days',
      'Surface swings from −180 °C to 430 °C — no atmosphere to hold heat',
      'Despite being closest to the Sun, it\'s not the hottest planet',
      'Shrinking slowly as its iron core cools and contracts',
    ],
  },
  Venus: {
    emoji: '🟡',
    tagline: 'Earth\'s Evil Twin',
    facts: [
      'Hottest planet at 462 °C — hotter than Mercury',
      'Rotates backwards relative to most planets',
      'A day on Venus is longer than its year',
      'Atmospheric pressure 90× Earth\'s — crushes like 900 m underwater',
    ],
  },
  Earth: {
    emoji: '🌍',
    tagline: 'The Blue Marble',
    facts: [
      'Only known planet with confirmed life',
      '71% of the surface is covered by liquid water',
      'The Moon stabilises Earth\'s axial tilt, moderating seasons',
      'Magnetic field shields life from solar wind particles',
    ],
  },
  Mars: {
    emoji: '🔴',
    tagline: 'The Red Planet',
    facts: [
      'Home to Olympus Mons — the tallest volcano in the Solar System (22 km)',
      'Red colour comes from iron oxide (rust) on the surface',
      'Two tiny moons: Phobos and Deimos, likely captured asteroids',
      'Valles Marineris canyon system stretches as wide as the USA',
    ],
  },
  Jupiter: {
    emoji: '🟠',
    tagline: 'King of the Planets',
    facts: [
      '1,300 Earths could fit inside Jupiter',
      'The Great Red Spot is a storm that has raged for 350+ years',
      '95 confirmed moons — more than any other planet',
      'Acts as a gravitational shield, deflecting comets from the inner Solar System',
    ],
  },
  Saturn: {
    emoji: '🪐',
    tagline: 'Lord of the Rings',
    facts: [
      'Least dense planet — it would float in water',
      'Rings are made of ice and rock, as thin as a few hundred metres',
      '146 moons confirmed; Titan has a thick nitrogen atmosphere',
      'A day is only 10.7 hours despite being massive',
    ],
  },
  Uranus: {
    emoji: '🔵',
    tagline: 'The Tilted Giant',
    facts: [
      'Rotates on its side — axial tilt of 97.8°',
      'Coldest planetary atmosphere in the Solar System (−224 °C)',
      'Its rings are oriented nearly vertically from our perspective',
      'First planet discovered with a telescope, in 1781',
    ],
  },
  Neptune: {
    emoji: '💙',
    tagline: 'The Windy World',
    facts: [
      'Winds reach 2,100 km/h — strongest in the Solar System',
      'Triton, its largest moon, orbits backwards and is slowly spiralling inward',
      'Takes 165 Earth years to complete one orbit of the Sun',
      'Was predicted mathematically before it was observed in 1846',
    ],
  },
};

const StarField       = dynamic(() => import('@/components/StarField'),       { ssr: false });
const SolarSystemView = dynamic(() => import('@/components/SolarSystemView'), { ssr: false });

type ViewMode = 'sky' | 'solar-system';

interface SkyState {
  planets: Array<PlanetState & { score: number; label: string }>;
  conditions: ObservingConditions;
  events: SolarEventTimes;
  lat: number; lon: number; date: Date;
}

interface WeatherData {
  temp: number;
  feelsLike: number;
  condition: string;
  uvIndex: number;
  cloudCover: number;
  humidity: number;
  windSpeed: number;
  windDir: string;
}

function formatRA(raDeg: number): string {
  const t = Math.round((raDeg / 360) * 86400);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${h.toString().padStart(2,'0')}h ${m.toString().padStart(2,'0')}m ${s.toString().padStart(2,'0')}s`;
}
function formatDec(d: number): string {
  const sign = d >= 0 ? '+' : '−', a = Math.abs(d);
  const deg = Math.floor(a), m = Math.floor((a-deg)*60), s = Math.round(((a-deg)*60-m)*60);
  return `${sign}${deg}° ${m.toString().padStart(2,'0')}′ ${s.toString().padStart(2,'0')}″`;
}

function twilightBadgeStyle(t: ObservingConditions['twilight']): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    day:           { background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' },
    civil:         { background: 'rgba(249,115,22,0.15)', color: '#fb923c', border: '1px solid rgba(249,115,22,0.3)' },
    nautical:      { background: 'rgba(59,130,246,0.15)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.3)' },
    astronomical:  { background: 'rgba(139,92,246,0.15)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.3)' },
    night:         { background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)' },
  };
  return map[t] ?? { background: 'rgba(255,255,255,0.06)', color: '#e2e8f0' };
}

function scoreColor(s: number): string {
  return s >= 80 ? '#34d399' : s >= 60 ? '#86efac' : s >= 40 ? '#facc15' : s >= 20 ? '#fb923c' : '#f87171';
}

function scoreLabel(s: number): string {
  return s >= 80 ? 'Excellent' : s >= 60 ? 'Good' : s >= 40 ? 'Fair' : s >= 20 ? 'Poor' : 'Bad';
}

function fmtTime(d: Date | null, tz: string): string {
  if (!d) return '—';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false });
}

function userTZ(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; }
}

function tzShortLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZoneName: 'short', timeZone: tz }).formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? tz;
  } catch { return tz; }
}

// Mini sparkline-style score bar
function ScoreBar({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        flex: 1, height: 3, borderRadius: 9999,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${score}%`,
          borderRadius: 9999,
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
        }} />
      </div>
      <span style={{
        fontSize: 9, fontFamily: 'var(--font-mono)',
        color, minWidth: 18, textAlign: 'right', fontWeight: 600,
      }}>{score}</span>
    </div>
  );
}

// Shared style constants
const S = {
  sectionLabel: {
    fontSize: 9.5,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.14em',
    color: 'rgba(255,255,255,0.35)',
    fontFamily: 'var(--font-mono)',
    marginBottom: 10,
    display: 'block',
  },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '3px 0',
  } as React.CSSProperties,
  rowLabel: {
    fontSize: 11, color: 'rgba(200,210,230,0.6)', fontFamily: 'var(--font-ui)',
  } as React.CSSProperties,
  rowValue: {
    fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontFamily: 'var(--font-mono)',
  } as React.CSSProperties,
  divider: {
    height: 1, background: 'rgba(255,255,255,0.05)', margin: '2px 0',
  } as React.CSSProperties,
};

export default function HomePage() {
  const [sky,          setSky]         = useState<SkyState | null>(null);
  const [selected,     setSelected]    = useState<PlanetState | null>(null);
  const [viewMode,     setViewMode]    = useState<ViewMode>('solar-system');
  const [bortleClass,  setBortleClass] = useState(4);
  const [fov,          setFov]         = useState(60);
  const [showEvents,   setShowEvents]  = useState(false);
  const [weather,      setWeather]     = useState<WeatherData | null>(null);
  const [mounted,      setMounted]     = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [focusPlanet,  setFocusPlanet] = useState<PlanetName | null>(null);
  const tz = userTZ();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const load = (lat: number, lon: number) => {
      const date = new Date();
      setSky({
        planets:    bestTonight(lat, lon, date),
        conditions: observingConditions(date, lat, lon),
        events:     solarEvents(date, lat, lon),
        lat, lon, date,
      });
    };
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        p => load(p.coords.latitude, p.coords.longitude),
        () => load(40.71, -74.01),
      );
    } else { load(40.71, -74.01); }
  }, []);

  useEffect(() => {
    if (!sky) return;
    const id = setInterval(() => {
      const date = new Date();
      setSky(prev => prev ? {
        ...prev, date,
        planets:    bestTonight(prev.lat, prev.lon, date),
        conditions: observingConditions(date, prev.lat, prev.lon),
        events:     solarEvents(date, prev.lat, prev.lon),
      } : null);
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [sky?.lat, sky?.lon]);

  // ── Weather API ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sky) return;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
    if (!apiKey) return;
    const fetchWeather = async () => {
      try {
        const url = `https://weather.googleapis.com/v1/currentConditions:lookup`
          + `?key=${apiKey}&location.latitude=${sky.lat}&location.longitude=${sky.lon}&unitsSystem=METRIC`;
        const res = await fetch(url);
        if (!res.ok) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d: any = await res.json();
        setWeather({
          temp:       Math.round(d.temperature?.degrees ?? 0),
          feelsLike:  Math.round(d.feelsLikeTemperature?.degrees ?? 0),
          condition:  d.weatherCondition?.description?.text ?? d.weatherCondition?.type ?? '—',
          uvIndex:    d.uvIndex ?? 0,
          cloudCover: d.cloudCover ?? 0,
          humidity:   d.relativeHumidity ?? 0,
          windSpeed:  Math.round(d.wind?.speed?.value ?? 0),
          windDir:    d.wind?.direction?.cardinal ?? '—',
        });
      } catch { /* silently ignore — weather is non-critical */ }
    };
    fetchWeather();
    const id = setInterval(fetchWeather, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [sky?.lat, sky?.lon, sky != null]);

  const handlePlanetSelect = useCallback((p: PlanetState) => setSelected(p), []);

  const evtRows: Array<{ label: string; key: keyof SolarEventTimes; color: string }> = [
    { label: 'Astro dawn',  key: 'astronomicalDawn',  color: '#c4b5fd' },
    { label: 'Naut dawn',   key: 'nauticalDawn',       color: '#93c5fd' },
    { label: 'Civil dawn',  key: 'civilDawn',          color: '#bfdbfe' },
    { label: 'Sunrise',     key: 'sunrise',            color: '#fbbf24' },
    { label: 'Solar noon',  key: 'solarNoon',          color: '#fde68a' },
    { label: 'Sunset',      key: 'sunset',             color: '#fb923c' },
    { label: 'Civil dusk',  key: 'civilDusk',          color: '#bfdbfe' },
    { label: 'Naut dusk',   key: 'nauticalDusk',       color: '#93c5fd' },
    { label: 'Astro dusk',  key: 'astronomicalDusk',   color: '#c4b5fd' },
  ];

  return (
    <div style={{
      position: 'relative', height: '100vh', width: '100vw',
      overflow: 'hidden', background: '#000510',
      color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
    }}>
      {/* ── Left floating panel ── */}
      <aside
        className="float-panel float-panel-left"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateX(0)' : 'translateX(-16px)',
          transition: 'opacity 0.45s ease, transform 0.45s cubic-bezier(0.34,1.2,0.64,1)',
        }}
      >

        {/* Logo */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '16px 14px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.05) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0 0 20px rgba(255,255,255,0.08)',
            flexShrink: 0,
          }}>✦</div>
          <div>
            <div style={{
              fontSize: 12, fontWeight: 700, letterSpacing: '0.1em',
              color: 'rgba(255,255,255,0.92)', lineHeight: 1.2,
            }}>WORLD</div>
            <div style={{
              fontSize: 9.5, fontWeight: 500, letterSpacing: '0.18em',
              color: 'rgba(255,255,255,0.35)', fontFamily: 'var(--font-mono)',
            }}>ASTRONOMY</div>
          </div>
        </div>

        {/* View toggle */}
        <div style={{ padding: '12px 10px 8px' }}>
          <div style={{
            display: 'flex', gap: 4, padding: 4,
            borderRadius: 12,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            {(['solar-system', 'sky'] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                style={{
                  flex: 1, fontSize: 10.5, padding: '7px 6px',
                  borderRadius: 8, border: 'none',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'var(--font-ui)',
                  transition: 'all 0.2s ease',
                  ...(viewMode === v ? {
                    background: 'rgba(255,255,255,0.12)',
                    color: 'rgba(255,255,255,0.92)',
                    boxShadow: '0 1px 0 rgba(255,255,255,0.08) inset, 0 2px 8px rgba(0,0,0,0.3)',
                    outline: '1px solid rgba(255,255,255,0.18)',
                  } : {
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.35)',
                  }),
                }}
              >
                {v === 'solar-system' ? '⬡ Orrery' : '✦ Sky'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: '4px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sky ? (
            <>
              {/* Sky conditions */}
              <div className="glass-card-sm" style={{ padding: '12px 13px' }}>
                <span style={S.sectionLabel}>Sky Conditions</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={S.row}>
                    <span style={S.rowLabel}>Twilight</span>
                    <span className="badge" style={{ ...twilightBadgeStyle(sky.conditions.twilight), fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 9999 }}>
                      {sky.conditions.twilight}
                    </span>
                  </div>
                  <div style={S.divider} />
                  <div style={S.row}>
                    <span style={S.rowLabel}>Sun altitude</span>
                    <span style={S.rowValue}>{sky.conditions.sunAltitude.toFixed(1)}°</span>
                  </div>
                  <div style={S.row}>
                    <span style={S.rowLabel}>Moon</span>
                    <span style={S.rowValue}>
                      {(sky.conditions.moonIllumination * 100).toFixed(0)}% · {sky.conditions.moonAgeDays.toFixed(1)}d
                    </span>
                  </div>
                </div>
              </div>

              {/* Solar events */}
              <div className="glass-card-sm" style={{ overflow: 'hidden' }}>
                <button
                  onClick={() => setShowEvents(p => !p)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', padding: '11px 13px',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={S.sectionLabel as React.CSSProperties}>Solar Events</span>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', transition: 'transform 0.2s ease', display: 'block', transform: showEvents ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                </button>
                {showEvents && (
                  <div style={{
                    padding: '0 13px 12px', display: 'flex', flexDirection: 'column', gap: 1,
                    animation: 'fadeSlideDown 0.2s ease',
                  }}>
                    <div style={{ fontSize: 9, marginBottom: 6, color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-mono)' }}>
                      {tzShortLabel(tz)}
                    </div>
                    {evtRows.map(r => (
                      <div key={r.key} style={S.row}>
                        <span style={S.rowLabel}>{r.label}</span>
                        <span style={{ ...S.rowValue, color: r.color }}>{fmtTime(sky.events[r.key] as Date | null, tz)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Observer */}
              <div className="glass-card-sm" style={{ padding: '12px 13px' }}>
                <span style={S.sectionLabel}>Observer</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 16 }}>📍</span>
                  <span style={{ fontSize: 11, color: 'rgba(200,210,230,0.65)', fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>
                    {sky.lat.toFixed(3)}°<br />
                    {sky.lon.toFixed(3)}°
                  </span>
                </div>
              </div>

              {/* Weather */}
              {weather && (
                <div className="glass-card-sm" style={{ padding: '12px 13px' }}>
                  <span style={S.sectionLabel}>Live Weather</span>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 28, fontWeight: 700, color: 'rgba(255,255,255,0.9)', lineHeight: 1 }}>
                      {weather.temp}°
                    </span>
                    <span style={{ fontSize: 11, color: 'rgba(200,210,230,0.5)', marginBottom: 2 }}>feels {weather.feelsLike}°C</span>
                  </div>
                  <div style={{
                    fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 10,
                    fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{weather.condition}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {([
                      ['UV Index', String(weather.uvIndex), weather.uvIndex <= 2 ? '#34d399' : weather.uvIndex <= 5 ? '#facc15' : '#f87171'],
                      ['Cloud', `${weather.cloudCover}%`, undefined],
                      ['Humidity', `${weather.humidity}%`, undefined],
                      ['Wind', `${weather.windSpeed} km/h ${weather.windDir}`, undefined],
                    ] as [string, string, string | undefined][]).map(([k, v, c]) => (
                      <div key={k} style={S.row}>
                        <span style={{ ...S.rowLabel, fontSize: 10.5 }}>{k}</span>
                        <span style={{ ...S.rowValue, fontSize: 10.5, color: c ?? 'rgba(200,210,230,0.6)' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sky view controls */}
              {viewMode === 'sky' && (
                <div className="glass-card-sm" style={{ padding: '12px 13px' }}>
                  <span style={S.sectionLabel}>Sky View</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={S.row}>
                        <span style={S.rowLabel}>Bortle class</span>
                        <span style={S.rowValue}>{bortleClass}</span>
                      </div>
                      <input type="range" min={1} max={9} value={bortleClass}
                        onChange={e => setBortleClass(Number(e.target.value))}
                        style={{ width: '100%' }} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={S.row}>
                        <span style={S.rowLabel}>Field of View</span>
                        <span style={S.rowValue}>{fov}°</span>
                      </div>
                      <input type="range" min={20} max={120} step={5} value={fov}
                        onChange={e => setFov(Number(e.target.value))}
                        style={{ width: '100%' }} />
                    </label>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="glass-card-sm" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'rgba(255,255,255,0.5)',
                animation: 'pulse 1.5s ease infinite',
              }} />
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'var(--font-mono)' }}>
                Locating observer…
              </p>
            </div>
          )}
        </div>

        <div style={{ height: 16 }} />
      </aside>

      {/* ── Main view (full-screen behind panels) ── */}
      <main style={{ position: 'absolute', inset: 0 }}>
        {viewMode === 'solar-system' && (
          <SolarSystemView
            onPlanetSelect={handlePlanetSelect}
            lat={sky?.lat ?? 40.71}
            lon={sky?.lon ?? -74.01}
            className="absolute inset-0"
            focusPlanet={focusPlanet}
          />
        )}

        {viewMode === 'sky' && sky && (
          <StarField
            latitude={sky.lat} longitude={sky.lon}
            bortleClass={bortleClass} fovDeg={fov}
            className="absolute inset-0"
          />
        )}

        {/* Planet detail overlay */}
        {selected && viewMode === 'sky' && (
          <div style={{
            position: 'absolute', bottom: 24,
            left: 'calc(14px + 234px + 20px)',
            zIndex: 10, minWidth: 300,
            animation: 'fadeSlideUp 0.25s ease',
          }}>
            <div className="glass-card" style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.04em' }}>
                  {selected.name}
                </h3>
                <button
                  onClick={() => setSelected(null)}
                  style={{
                    width: 22, height: 22, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.4)',
                    cursor: 'pointer', transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.12)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
                >✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  ['RA',    formatRA(selected.equatorial.ra)],
                  ['Dec',   formatDec(selected.equatorial.dec)],
                  ['Dist',  `${selected.equatorial.dist.toFixed(3)} AU`],
                  ['Mag',   selected.magnitude.toFixed(1)],
                  ['Phase', `${(selected.illumination * 100).toFixed(0)}%`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                    <span style={{ fontSize: 11, color: 'rgba(200,210,230,0.5)' }}>{k}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)', fontFamily: 'var(--font-mono)' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── Right floating panel ── */}
      <aside
        className="float-panel float-panel-right"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateX(0)' : 'translateX(16px)',
          transition: 'opacity 0.45s ease 0.1s, transform 0.45s cubic-bezier(0.34,1.2,0.64,1) 0.1s',
        }}
      >

        {/* Header */}
        <div style={{
          padding: '16px 14px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{
            fontSize: 10, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.14em',
            color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-mono)',
          }}>Solar System</span>
          {sky && (
            <div style={{ marginTop: 3, fontSize: 10.5, color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-ui)' }}>
              {sky.planets.length} visible tonight
            </div>
          )}
        </div>

        <div style={{ padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {(() => {
            const SOLAR_ORDER: PlanetName[] = ['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune'];
            const scoreMap = new Map(sky?.planets.map(p => [p.name, p]) ?? []);

            return SOLAR_ORDER.map((name, i) => {
              const isExpanded = expandedCard === name;
              const facts = PLANET_FACTS[name];
              const isEarth = name === 'Earth';
              const obs = scoreMap.get(name); // null for Earth or below-horizon planets

              const handleCardClick = () => {
                if (!sky) return;
                if (isExpanded) {
                  setExpandedCard(null);
                  setFocusPlanet(null);
                } else {
                  setExpandedCard(name);
                  if (!isEarth) setSelected(planetState(name, sky.date));
                  setViewMode('solar-system');
                  setFocusPlanet(name);
                  setTimeout(() => setFocusPlanet(name), 0);
                }
              };

              return (
                <button
                  key={name}
                  onClick={handleCardClick}
                  className={`planet-card${isExpanded ? ' selected' : ''}`}
                  style={{
                    opacity: mounted ? 1 : 0,
                    transform: mounted ? 'translateY(0)' : 'translateY(8px)',
                    transition: `opacity 0.35s ease ${0.1 + i * 0.035}s, transform 0.35s ease ${0.1 + i * 0.035}s`,
                  }}
                >
                  {/* Name row */}
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', marginBottom: isEarth ? 0 : 5,
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.01em' }}>
                      {name}
                    </span>
                    {obs ? (
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        color: scoreColor(obs.score),
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {scoreLabel(obs.score)}
                      </span>
                    ) : isEarth ? (
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.22)', fontFamily: 'var(--font-ui)' }}>
                        Our home
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-ui)' }}>
                        —
                      </span>
                    )}
                  </div>

                  {/* Score bar — skip for Earth */}
                  {obs && <ScoreBar score={obs.score} />}

                  {/* Sub-row */}
                  {!isEarth && (
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', marginTop: 5,
                    }}>
                      <span style={{ fontSize: 10, color: 'rgba(200,210,230,0.4)', fontFamily: 'var(--font-ui)' }}>
                        {obs?.label ?? 'Not visible'}
                      </span>
                      <span style={{ fontSize: 10, color: 'rgba(200,210,230,0.3)', fontFamily: 'var(--font-mono)' }}>
                        {obs ? `${obs.magnitude.toFixed(1)}m` : ''}
                      </span>
                    </div>
                  )}

                  {/* Expanded panel */}
                  {isExpanded && (
                    <div
                      style={{
                        marginTop: 12, paddingTop: 12,
                        borderTop: '1px solid rgba(255,255,255,0.07)',
                        animation: 'fadeSlideDown 0.2s ease',
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                      {facts && (
                        <>
                          <div style={{
                            fontSize: 10, fontWeight: 500, letterSpacing: '0.02em',
                            color: 'rgba(255,255,255,0.4)',
                            marginBottom: 10, fontStyle: 'italic',
                          }}>{facts.tagline}</div>

                          {/* Live ephemeris — skip Earth */}
                          {!isEarth && selected?.name === name && (
                            <div style={{
                              marginBottom: 12,
                              padding: '8px 10px',
                              borderRadius: 8,
                              background: 'rgba(255,255,255,0.04)',
                              border: '1px solid rgba(255,255,255,0.06)',
                            }}>
                              {[
                                ['Distance', `${selected.equatorial.dist.toFixed(3)} AU`],
                                ['Magnitude', selected.magnitude.toFixed(1)],
                                ['Phase', `${(selected.illumination * 100).toFixed(0)}%`],
                                ['Diameter', `${selected.angularDiameterArcsec.toFixed(1)}″`],
                              ].map(([k, v]) => (
                                <div key={k} style={{
                                  display: 'flex', justifyContent: 'space-between',
                                  padding: '2.5px 0',
                                }}>
                                  <span style={{ fontSize: 10, color: 'rgba(200,210,230,0.45)', fontFamily: 'var(--font-ui)' }}>{k}</span>
                                  <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.85)', fontFamily: 'var(--font-mono)' }}>{v}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Facts */}
                          <div style={{
                            fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em',
                            color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase',
                            marginBottom: 7,
                          }}>Facts</div>
                          {facts.facts.map((fact, fi) => (
                            <div key={fi} style={{
                              display: 'flex', gap: 7, marginBottom: 6, alignItems: 'flex-start',
                            }}>
                              <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', flexShrink: 0, marginTop: 3 }}>●</span>
                              <span style={{
                                fontSize: 11, color: 'rgba(210,220,240,0.72)',
                                fontFamily: 'var(--font-ui)', lineHeight: 1.5,
                              }}>{fact}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </button>
              );
            });
          })()}

          {!sky && (
            <div style={{ padding: '12px 2px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'rgba(255,255,255,0.4)', flexShrink: 0,
                animation: 'pulse 1.5s ease infinite',
              }} />
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono)' }}>
                Computing…
              </p>
            </div>
          )}
        </div>

        <div style={{ height: 16 }} />

        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 1; }
          }
          @keyframes fadeSlideDown {
            from { opacity: 0; transform: translateY(-6px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes fadeSlideUp {
            from { opacity: 0; transform: translateY(10px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </aside>
    </div>
  );
}
