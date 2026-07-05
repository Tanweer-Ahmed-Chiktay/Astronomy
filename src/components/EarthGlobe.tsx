'use client';

/**
 * EarthGlobe — Google Earth-style 3D sphere using Google Maps Map3DElement.
 *
 * Renders a real 3D globe (identical to Google Earth) using the Maps JavaScript
 * API `maps3d` library. Starting altitude is ~20,000 km so the full sphere is
 * visible in space. The user can zoom in all the way to street level, just like
 * Google Earth.
 *
 * Fades in when the orrery camera zooms close to Earth, fades out when the user
 * clicks "← Solar System".
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// ── Window augments ──────────────────────────────────────────────────────────
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google: any;
    _gmapsReady: boolean;
    _gmapsCallbacks: Array<() => void>;
    initGoogleMaps: () => void;
  }
}

// ── Props ────────────────────────────────────────────────────────────────────
interface Props {
  apiKey: string;
  /** 0..1 — driven by orrery camera proximity to Earth mesh */
  opacity: number;
  /** Observer / ISS lat to start looking at */
  initialLat: number;
  initialLon: number;
  issLat?: number;
  issLon?: number;
  /** Called with 0 when user clicks "back" — parent fades out & resets orrery */
  onOpacityRequest: (v: number) => void;
}

// ── Idempotent Google Maps loader (loads maps3d beta) ────────────────────────
function loadGoogleMaps(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('SSR')); return; }
    if (window._gmapsReady) { resolve(); return; }

    if (!window._gmapsCallbacks) window._gmapsCallbacks = [];
    window._gmapsCallbacks.push(resolve);

    // Already loading — just wait for callback
    if (document.querySelector('script[data-gmaps3d]')) return;

    window.initGoogleMaps = () => {
      window._gmapsReady = true;
      (window._gmapsCallbacks ?? []).forEach(cb => cb());
      window._gmapsCallbacks = [];
    };

    const s = document.createElement('script');
    s.setAttribute('data-gmaps3d', '1');
    // v=alpha is required for maps3d library
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=maps3d,maps,marker&v=alpha&loading=async&callback=initGoogleMaps`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error('Google Maps script failed to load'));
    document.head.appendChild(s);
  });
}

// ── Component ────────────────────────────────────────────────────────────────
export default function EarthGlobe({
  apiKey, opacity, initialLat, initialLon, issLat, issLon, onOpacityRequest,
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map3dRef      = useRef<any>(null);
  const initCalledRef = useRef(false);
  const [status,     setStatus]    = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg,   setErrorMsg]  = useState('');
  const [zoomedOut,  setZoomedOut] = useState(false);

  // Update ISS marker position whenever ISS coordinates change
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issMarkerRef  = useRef<any>(null);

  const initGlobe = useCallback(async () => {
    if (initCalledRef.current) return;
    if (!containerRef.current) return;
    initCalledRef.current = true;

    try {
      setStatus('loading');
      await loadGoogleMaps(apiKey);

      if (!containerRef.current) return;

      // Import the 3D maps library
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { Map3DElement, Marker3DElement } = await (window.google.maps as any).importLibrary('maps3d');

      // Create the 3D map element — starts at ~20,000 km showing full globe
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map3d: any = new Map3DElement({
        center: {
          lat: initialLat,
          lng: initialLon,
          altitude: 0,
        },
        range: 20_000_000,   // 20,000 km — full Earth visible like Google Earth
        tilt: 0,             // top-down to show sphere
        heading: 0,
        mode: 'HYBRID',      // satellite imagery + labels
      });

      map3d.style.width  = '100%';
      map3d.style.height = '100%';
      map3d.style.display = 'block';

      // Clear any previous content and append the 3D element
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(map3d);
      map3dRef.current = map3d;

      // Add ISS marker if position available
      if (issLat !== undefined && issLon !== undefined && Marker3DElement) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const marker: any = new Marker3DElement({
            position: { lat: issLat, lng: issLon, altitude: 420_000 }, // ISS altitude ~420 km
            altitudeMode: 'ABSOLUTE',
            label: '🛰️ ISS',
          });
          map3d.append(marker);
          issMarkerRef.current = marker;
        } catch {
          // Marker3DElement may not be available in all versions — non-critical
        }
      }

      // Wait for the globe to be ready
      map3d.addEventListener('gmp-steadystate', () => {
        setStatus('ready');
      }, { once: true });

      // Fallback: mark ready after 3s if event never fires
      setTimeout(() => setStatus('ready'), 3000);

    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load Google Earth');
      setStatus('error');
    }
  }, [apiKey, initialLat, initialLon, issLat, issLon]);

  // Preload immediately on mount so the globe is ready before the user zooms in
  useEffect(() => {
    initGlobe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track zoom level — wiggle the back button when zoomed far out
  useEffect(() => {
    const map3d = map3dRef.current;
    if (!map3d) return;

    const handleCenterChange = () => {
      const isOut = map3dRef.current && map3dRef.current.range > 22_000_000;
      setZoomedOut(!!isOut);
    };

    map3d.addEventListener('gmp-centerchange', handleCenterChange);
    return () => map3d.removeEventListener('gmp-centerchange', handleCenterChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Live-update ISS marker
  useEffect(() => {
    if (!issMarkerRef.current || issLat === undefined || issLon === undefined) return;
    try {
      issMarkerRef.current.position = { lat: issLat, lng: issLon, altitude: 420_000 };
    } catch { /* ignore */ }
  }, [issLat, issLon]);

  // Remove the "alpha channel" development banner Google Maps injects into the DOM
  useEffect(() => {
    const removeBanner = () => {
      document.querySelectorAll('body > div').forEach(el => {
        if (el.textContent?.includes('alpha channel') || el.textContent?.includes('development purposes')) {
          (el as HTMLElement).style.display = 'none';
        }
      });
    };
    // Try immediately and then after a short delay (banner appears async)
    removeBanner();
    const t = setTimeout(removeBanner, 2000);
    return () => clearTimeout(t);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      map3dRef.current = null;
      initCalledRef.current = false;
    };
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity,
        pointerEvents: opacity > 0.05 ? 'all' : 'none',
        zIndex: 10,
        transition: 'opacity 0.8s cubic-bezier(0.4,0,0.2,1)',
        background: '#000510',
        overflow: 'hidden',
      }}
    >
      {/* ── Loading screen ─────────────────────────────────────────────────── */}
      {status === 'loading' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'radial-gradient(ellipse 70% 60% at 50% 60%, rgba(6,30,70,0.95) 0%, #000510 100%)',
          pointerEvents: 'none',
        }}>
          {/* Animated 3D-looking Earth sphere */}
          <div style={{
            width: 120, height: 120,
            borderRadius: '50%',
            position: 'relative',
            marginBottom: 32,
          }}>
            {/* Base globe */}
            <div style={{
              position: 'absolute', inset: 0,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 35% 32%, #4fc3f7 0%, #1565c0 42%, #0d2a5e 70%, #050e28 100%)',
              boxShadow: '0 0 60px rgba(6,182,212,0.35), 0 0 120px rgba(6,182,212,0.12)',
              animation: 'globeSpin 6s linear infinite',
              overflow: 'hidden',
            }}>
              {/* Continent blobs */}
              <div style={{
                position: 'absolute',
                width: '30%', height: '25%',
                top: '30%', left: '15%',
                borderRadius: '50%',
                background: 'rgba(34,197,94,0.6)',
                filter: 'blur(4px)',
              }} />
              <div style={{
                position: 'absolute',
                width: '22%', height: '35%',
                top: '38%', left: '42%',
                borderRadius: '40%',
                background: 'rgba(34,197,94,0.55)',
                filter: 'blur(3px)',
              }} />
              <div style={{
                position: 'absolute',
                width: '32%', height: '20%',
                top: '32%', left: '58%',
                borderRadius: '50%',
                background: 'rgba(34,197,94,0.5)',
                filter: 'blur(4px)',
              }} />
              {/* Cloud wisps */}
              <div style={{
                position: 'absolute',
                width: '60%', height: '8%',
                top: '20%', left: '-10%',
                borderRadius: 9999,
                background: 'rgba(255,255,255,0.25)',
                filter: 'blur(5px)',
                transform: 'rotate(-8deg)',
              }} />
              <div style={{
                position: 'absolute',
                width: '45%', height: '6%',
                top: '65%', left: '30%',
                borderRadius: 9999,
                background: 'rgba(255,255,255,0.2)',
                filter: 'blur(4px)',
                transform: 'rotate(-4deg)',
              }} />
            </div>
            {/* Atmosphere ring */}
            <div style={{
              position: 'absolute',
              inset: -6,
              borderRadius: '50%',
              background: 'radial-gradient(circle, transparent 55%, rgba(56,189,248,0.12) 70%, rgba(56,189,248,0.06) 80%, transparent 100%)',
              pointerEvents: 'none',
            }} />
            {/* Shine */}
            <div style={{
              position: 'absolute',
              width: '40%', height: '38%',
              top: '8%', left: '12%',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.22) 0%, transparent 100%)',
              pointerEvents: 'none',
            }} />
          </div>

          <p style={{
            color: '#22d3ee',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            letterSpacing: '0.12em',
            marginBottom: 6,
          }}>
            LOADING GOOGLE EARTH
          </p>
          <p style={{
            color: 'rgba(148,163,184,0.5)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            animation: 'loadPulse 1.6s ease-in-out infinite',
          }}>
            Streaming satellite imagery…
          </p>

          <style>{`
            @keyframes globeSpin {
              from { transform: rotate(0deg); }
              to   { transform: rotate(360deg); }
            }
            @keyframes loadPulse {
              0%, 100% { opacity: 0.3; }
              50%       { opacity: 0.9; }
            }
          `}</style>
        </div>
      )}

      {/* ── Error screen ───────────────────────────────────────────────────── */}
      {status === 'error' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#000510',
          gap: 12,
        }}>
          <span style={{ fontSize: 32 }}>⚠️</span>
          <p style={{ color: '#f87171', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {errorMsg || 'Failed to load Google Earth'}
          </p>
          <p style={{ color: 'rgba(148,163,184,0.5)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
            Check that the Maps JavaScript API + Maps 3D API are enabled
          </p>
        </div>
      )}

      {/* ── The 3D Globe container (Map3DElement mounts here) ──────────────── */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />

      {/* ── HUD overlay (visible once ready) ──────────────────────────────── */}
      {/* Back button — wiggles when zoomed out past full-Earth view */}
      <button
        onClick={() => onOpacityRequest(0)}
        style={{
          position: 'absolute', top: 16, left: 16, zIndex: 100,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 20px',
          borderRadius: 9999,
          background: zoomedOut ? 'rgba(255,255,255,0.12)' : 'rgba(4,12,28,0.88)',
          border: zoomedOut ? '1px solid rgba(255,255,255,0.55)' : '1px solid rgba(255,255,255,0.22)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          color: 'rgba(255,255,255,0.9)',
          fontSize: 12, fontWeight: 600,
          fontFamily: 'var(--font-ui)',
          cursor: 'pointer',
          letterSpacing: '0.04em',
          boxShadow: zoomedOut
            ? '0 0 32px rgba(255,255,255,0.18), inset 0 1px 0 rgba(255,255,255,0.12)'
            : '0 0 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
          transition: 'background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease',
          animation: zoomedOut ? 'btnWiggle 0.6s ease infinite' : 'none',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = 'rgba(255,255,255,0.18)';
          el.style.borderColor = 'rgba(255,255,255,0.7)';
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = zoomedOut ? 'rgba(255,255,255,0.12)' : 'rgba(4,12,28,0.88)';
          el.style.borderColor = zoomedOut ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
        }}
      >
        <span style={{ fontSize: 14 }}>←</span>
        Solar System
      </button>

      {/* ISS status badge */}
      {issLat !== undefined && issLon !== undefined && (
        <div style={{
          position: 'absolute', bottom: 24, left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 100,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 20px',
          borderRadius: 9999,
          background: 'rgba(4,12,28,0.88)',
          border: '1px solid rgba(34,211,238,0.3)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11, color: '#22d3ee',
          boxShadow: '0 0 20px rgba(34,211,238,0.1)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#22d3ee',
            boxShadow: '0 0 8px #22d3ee',
            flexShrink: 0,
            animation: 'issGlow 1.4s ease-in-out infinite',
          }} />
          <span style={{ color: 'rgba(148,163,184,0.7)', fontSize: 10 }}>🛰️ ISS</span>
          <span>{Math.abs(issLat).toFixed(2)}°{issLat >= 0 ? 'N' : 'S'}</span>
          <span style={{ color: 'rgba(148,163,184,0.4)' }}>·</span>
          <span>{Math.abs(issLon).toFixed(2)}°{issLon >= 0 ? 'E' : 'W'}</span>
          <span style={{ color: 'rgba(148,163,184,0.4)', fontSize: 9 }}>~ 420 km alt</span>
        </div>
      )}

      {/* Corner label */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16, zIndex: 100,
        padding: '4px 12px',
        borderRadius: 9999,
        background: 'rgba(4,12,28,0.75)',
        border: '1px solid rgba(34,211,238,0.12)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        fontFamily: 'var(--font-mono)',
        fontSize: 9, color: 'rgba(34,211,238,0.4)',
        letterSpacing: '0.08em',
        pointerEvents: 'none',
      }}>
        Google Earth 3D · Satellite
      </div>

      <style>{`
        @keyframes issGlow {
          0%, 100% { opacity: 0.6; box-shadow: 0 0 4px #22d3ee; }
          50%       { opacity: 1;   box-shadow: 0 0 12px #22d3ee; }
        }
        @keyframes btnWiggle {
          0%   { transform: rotate(0deg) scale(1); }
          15%  { transform: rotate(-4deg) scale(1.04); }
          30%  { transform: rotate(4deg) scale(1.04); }
          45%  { transform: rotate(-3deg) scale(1.03); }
          60%  { transform: rotate(3deg) scale(1.03); }
          75%  { transform: rotate(-1.5deg) scale(1.01); }
          90%  { transform: rotate(1.5deg) scale(1.01); }
          100% { transform: rotate(0deg) scale(1); }
        }
      `}</style>
    </div>
  );
}
