'use client';

/**
 * PlanetSurfaceView — Immersive surface/map overlay when zoomed close to a planet.
 *
 * Earth  → Google Maps JavaScript API (satellite + Street View + ISS marker)
 * Moon   → NASA LRO tiles via Leaflet
 * Mars   → NASA Viking MDIM2.1 tiles via Leaflet
 * Others → NASA Solar System imagery
 */

import { useEffect, useRef, useState } from 'react';

// Augment Window for Google Maps callback
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google: any;
    _gmapsReady: boolean;
    _gmapsCallbacks: Array<() => void>;
    initGoogleMaps: () => void;
  }
}

interface Props {
  planet: string;
  apiKey: string;
  /** Center lat/lon for Earth view (defaults to observer or ISS) */
  lat: number;
  lon: number;
  issLat?: number;
  issLon?: number;
  onClose: () => void;
}

// ── Google Maps loader (idempotent) ────────────────────────────────────────────
function loadGoogleMaps(apiKey: string): Promise<void> {
  return new Promise((resolve) => {
    if (window._gmapsReady) { resolve(); return; }
    if (!window._gmapsCallbacks) window._gmapsCallbacks = [];
    window._gmapsCallbacks.push(resolve);
    if (document.querySelector('script[data-gmaps3d]')) return; // already loading
    window.initGoogleMaps = () => {
      window._gmapsReady = true;
      window._gmapsCallbacks?.forEach(cb => cb());
      window._gmapsCallbacks = [];
    };
    const s = document.createElement('script');
    s.setAttribute('data-gmaps3d', '1');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=maps3d,maps,marker&v=alpha&callback=initGoogleMaps`;
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  });
}

// ── Earth view ─────────────────────────────────────────────────────────────────
function EarthView({ apiKey, lat, lon, issLat, issLon }: { apiKey: string; lat: number; lon: number; issLat?: number; issLon?: number }) {
  const mapDivRef  = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef     = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issMarker  = useRef<any>(null);
  const [status, setStatus] = useState('Loading satellite imagery…');

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey).then(() => {
      if (cancelled || !mapDivRef.current) return;
      setStatus('');

      const map = new window.google.maps.Map(mapDivRef.current, {
        center: { lat, lng: lon },
        zoom: 13,
        mapTypeId: 'satellite',
        tilt: 0,
        rotateControl: true,
        streetViewControl: true,
        zoomControl: true,
        mapTypeControl: true,
        mapTypeControlOptions: {
          mapTypeIds: ['satellite', 'hybrid', 'roadmap'],
        },
        styles: [],
      });
      mapRef.current = map;

      // ISS marker
      if (issLat !== undefined && issLon !== undefined) {
        const issPos = { lat: issLat, lng: issLon };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        issMarker.current = new (window.google.maps as any).Marker({
          position: issPos,
          map,
          title: `ISS — ${issLat.toFixed(2)}°, ${issLon.toFixed(2)}°`,
          icon: {
            url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle cx='16' cy='16' r='12' fill='none' stroke='%2300e5ff' stroke-width='2'/%3E%3Ccircle cx='16' cy='16' r='4' fill='%2300e5ff'/%3E%3Cline x1='4' y1='16' x2='28' y2='16' stroke='%2300e5ff' stroke-width='1.5'/%3E%3Cline x1='16' y1='4' x2='16' y2='28' stroke='%2300e5ff' stroke-width='1.5'/%3E%3C/svg%3E",
            scaledSize: new window.google.maps.Size(32, 32),
            anchor: new window.google.maps.Point(16, 16),
          },
        });
        map.panTo(issPos);
      }
    }).catch(() => setStatus('Failed to load Google Maps.'));

    return () => { cancelled = true; };
  // Only run once on mount — lat/lon are initial values
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Update ISS marker live
  useEffect(() => {
    if (!issMarker.current || issLat === undefined || issLon === undefined) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (issMarker.current as any).setPosition({ lat: issLat, lng: issLon });
  }, [issLat, issLon]);

  return (
    <div className="relative w-full h-full">
      {status && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
          <p className="text-sm text-slate-400 font-mono animate-pulse">{status}</p>
        </div>
      )}
      <div ref={mapDivRef} className="w-full h-full" />
    </div>
  );
}

// ── Mars / Moon tile view (Leaflet) ────────────────────────────────────────────
function TileView({ planet }: { planet: string }) {
  const divRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Loading…');

  useEffect(() => {
    let map: ReturnType<typeof import('leaflet')['map']> | null = null;
    let cancelled = false;

    import('leaflet').then(L => {
      if (cancelled || !divRef.current) return;
      setStatus('');

      // Leaflet requires its CSS — inject once
      if (!document.querySelector('link[data-leaflet]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.dataset.leaflet = '1';
        document.head.appendChild(link);
      }

      const tileConfig = planet === 'Moon'
        ? {
            url: 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
            attribution: 'NASA LRO WAC Mosaic',
            maxZoom: 8,
            crs: L.CRS.EPSG4326,
          }
        : {
            url: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
            attribution: 'NASA Viking MDIM2.1',
            maxZoom: 7,
            crs: L.CRS.EPSG4326,
          };

      map = L.map(divRef.current!, {
        center: [0, 0], zoom: 2,
        crs: tileConfig.crs,
        minZoom: 1, maxZoom: tileConfig.maxZoom,
        attributionControl: true,
      });

      L.tileLayer(tileConfig.url, {
        attribution: tileConfig.attribution,
        tms: false,
        noWrap: false,
      }).addTo(map);
    }).catch(() => setStatus(`Failed to load ${planet} tiles`));

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [planet]);

  return (
    <div className="relative w-full h-full">
      {status && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
          <p className="text-sm text-slate-400 font-mono animate-pulse">{status}</p>
        </div>
      )}
      <div ref={divRef} className="w-full h-full" style={{ background: '#000' }} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const PLANET_META: Record<string, { emoji: string; label: string; color: string }> = {
  Earth: { emoji: '🌍', label: 'EARTH SURFACE', color: 'border-blue-700 text-blue-300' },
  Moon:  { emoji: '🌕', label: 'LUNAR SURFACE', color: 'border-slate-500 text-slate-300' },
  Mars:  { emoji: '🔴', label: 'MARS SURFACE',  color: 'border-red-800   text-red-300'  },
};

export default function PlanetSurfaceView({ planet, apiKey, lat, lon, issLat, issLon, onClose }: Props) {
  const meta = PLANET_META[planet] ?? { emoji: '🪐', label: planet.toUpperCase(), color: 'border-violet-700 text-violet-300' };

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2.5 bg-black/95 border-b ${meta.color.split(' ')[0]}`}>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold font-mono ${meta.color.split(' ')[1]}`}>
            {meta.emoji} {meta.label}
          </span>
          {planet === 'Earth' && issLat !== undefined && (
            <span className="text-xs text-cyan-400 font-mono bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800">
              🛰 ISS {issLat.toFixed(1)}°{issLat >= 0 ? 'N' : 'S'}  {Math.abs(issLon ?? 0).toFixed(1)}°{(issLon ?? 0) >= 0 ? 'E' : 'W'}
            </span>
          )}
          {planet === 'Moon' && (
            <span className="text-xs text-slate-400 font-mono">NASA LRO WAC Mosaic</span>
          )}
          {planet === 'Mars' && (
            <span className="text-xs text-slate-400 font-mono">NASA Viking MDIM2.1</span>
          )}
        </div>
        <button onClick={onClose}
          className="text-xs text-slate-400 hover:text-white font-mono border border-slate-700 hover:border-slate-500 rounded px-3 py-1 transition-colors">
          ← Orrery
        </button>
      </div>

      {/* Map content */}
      <div className="flex-1 relative min-h-0">
        {planet === 'Earth' ? (
          <EarthView apiKey={apiKey} lat={lat} lon={lon} issLat={issLat} issLon={issLon} />
        ) : (planet === 'Moon' || planet === 'Mars') ? (
          <TileView planet={planet} />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 font-mono text-sm">
            No surface imagery available for {planet}
          </div>
        )}
      </div>
    </div>
  );
}
