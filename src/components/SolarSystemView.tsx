'use client';

/**
 * SolarSystemView — Interactive 3D solar system orrery.
 *
 * Features:
 *  - Planet textures loaded from /textures/ (procedural canvas fallback if absent)
 *  - Moon orbiting Earth at real ephemeris position (25× scale for visibility)
 *  - Earth atmosphere glow + cloud layer
 *  - ISS real-time position polled from wheretheiss.at API
 *  - Asteroid belt (procedural ring, 2.2–3.2 AU)
 *  - Timeline: date/time picker, play/pause, 0.1×–100 000× speed
 *  - Click any body to fly camera to it and show info panel
 *  - Scroll to zoom (OrbitControls), drag to orbit
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { planetState, julianDate, moonGeocentricEcliptic } from '@/lib/ephemeris';
import type { PlanetName, PlanetState } from '@/lib/ephemeris';

const PlanetSurfaceView = dynamic(() => import('@/components/PlanetSurfaceView'), { ssr: false });
const EarthGlobe        = dynamic(() => import('@/components/EarthGlobe'),        { ssr: false });

// ── Constants ─────────────────────────────────────────────────────────────────

/** 1 AU in scene units. Inner solar system fills ~18 scene units. */
const AU = 6;
/** Exaggeration factor for Moon's orbital radius (real ≈ 0.0154 scene units → 0.39) */
const MOON_ORBIT_SCALE = 25;
/** km → AU */
const KM_PER_AU = 149_597_870.7;

// ── Procedural planet textures ────────────────────────────────────────────────

type BodyName = PlanetName | 'Moon' | 'Sun';

function makeProcTexture(body: BodyName): THREE.CanvasTexture {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;

  const fill = (color: string) => { ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); };

  const band = (y0f: number, y1f: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, y0f * H, W, (y1f - y0f) * H);
  };

  const noise = (alpha: number, dark: string, bright: string, scale = 20) => {
    for (let x = 0; x < W; x += scale) {
      for (let y = 0; y < H; y += scale) {
        if (Math.random() > 0.5) {
          ctx.fillStyle = Math.random() > 0.5 ? dark : bright;
          ctx.globalAlpha = alpha * Math.random();
          ctx.fillRect(x, y, scale + Math.random() * scale, scale + Math.random() * scale);
        }
      }
    }
    ctx.globalAlpha = 1;
  };

  switch (body) {
    case 'Sun': {
      const g = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W/2);
      g.addColorStop(0, '#fff7c0'); g.addColorStop(0.4, '#ffcc00');
      g.addColorStop(0.7, '#ff8800'); g.addColorStop(1, '#cc4400');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      noise(0.3, '#aa3300', '#ffee44', 10);
      break;
    }
    case 'Mercury': {
      fill('#888880');
      noise(0.5, '#555550', '#aaaaaa', 12);
      noise(0.3, '#444440', '#999990', 6);
      break;
    }
    case 'Venus': {
      fill('#e8d898');
      noise(0.4, '#c8b070', '#f0e8b0', 30);
      noise(0.2, '#b09050', '#e8d898', 15);
      break;
    }
    case 'Earth': {
      fill('#1a6ba0');
      // Rough continents
      ctx.fillStyle = '#2d8a3a';
      // North America
      ctx.beginPath(); ctx.ellipse(W*0.18, H*0.38, W*0.08, H*0.16, -0.3, 0, Math.PI*2); ctx.fill();
      // South America
      ctx.beginPath(); ctx.ellipse(W*0.22, H*0.62, W*0.05, H*0.14, 0.2, 0, Math.PI*2); ctx.fill();
      // Europe/Africa
      ctx.beginPath(); ctx.ellipse(W*0.47, H*0.38, W*0.05, H*0.12, 0, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(W*0.49, H*0.60, W*0.06, H*0.17, 0.1, 0, Math.PI*2); ctx.fill();
      // Asia
      ctx.beginPath(); ctx.ellipse(W*0.65, H*0.35, W*0.15, H*0.13, -0.1, 0, Math.PI*2); ctx.fill();
      // Australia
      ctx.beginPath(); ctx.ellipse(W*0.75, H*0.66, W*0.06, H*0.08, 0.3, 0, Math.PI*2); ctx.fill();
      // Polar ice
      ctx.fillStyle = '#e8f0ff';
      ctx.fillRect(0, 0, W, H*0.07);
      ctx.fillRect(0, H*0.93, W, H*0.07);
      noise(0.15, '#1a5090', '#2d9a4a', 8);
      break;
    }
    case 'Moon': {
      fill('#333333');
      noise(0.5, '#1e1e1e', '#4c4c4c', 18);
      noise(0.4, '#181818', '#3f3f3f', 8);
      // Craters
      for (let i = 0; i < 30; i++) {
        const x = Math.random() * W, y = Math.random() * H;
        const r = 3 + Math.random() * 20;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
        ctx.fillStyle = `rgba(15,15,15,${0.3 + Math.random()*0.3})`; ctx.fill();
        ctx.beginPath(); ctx.arc(x - r*0.1, y - r*0.1, r*0.85, 0, Math.PI*2);
        ctx.fillStyle = `rgba(100,100,100,${0.1})`; ctx.fill();
      }
      break;
    }
    case 'Mars': {
      fill('#c1440e');
      noise(0.4, '#8b2800', '#d4600a', 20);
      noise(0.3, '#aa3800', '#cc5010', 8);
      // Polar caps
      ctx.fillStyle = '#ffe8e0';
      ctx.fillRect(0, 0, W, H*0.06);
      ctx.fillRect(0, H*0.94, W, H*0.06);
      // Valles Marineris
      ctx.strokeStyle = '#7a2000'; ctx.lineWidth = 4; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(W*0.3, H*0.5); ctx.lineTo(W*0.7, H*0.52); ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'Jupiter': {
      fill('#c88b3a');
      for (let i = 0; i < 20; i++) {
        const y = Math.random() * H;
        const h = 4 + Math.random() * 18;
        const colors = ['#9a6020','#d4a060','#a07040','#e0b870','#b88040'];
        band(y/H, (y+h)/H, colors[Math.floor(Math.random()*colors.length)]);
      }
      // Great Red Spot
      ctx.beginPath(); ctx.ellipse(W*0.55, H*0.6, W*0.04, H*0.06, 0.1, 0, Math.PI*2);
      ctx.fillStyle = '#c03010'; ctx.globalAlpha = 0.7; ctx.fill();
      ctx.globalAlpha = 1;
      noise(0.1, '#785020', '#d8a858', 5);
      break;
    }
    case 'Saturn': {
      fill('#e8d5a3');
      for (let i = 0; i < 14; i++) {
        const y = Math.random() * H;
        const h = 5 + Math.random() * 20;
        const colors = ['#c8b880','#f0e0b0','#d8c898','#e0d0a0'];
        band(y/H, (y+h)/H, colors[Math.floor(Math.random()*colors.length)]);
      }
      noise(0.08, '#b8a870', '#f8e8b8', 6);
      break;
    }
    case 'Uranus': {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#7de8e8'); g.addColorStop(0.5, '#a0f0f0'); g.addColorStop(1, '#60d8d8');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      noise(0.1, '#50c8c8', '#90f8f8', 20);
      break;
    }
    case 'Neptune': {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#2040b0'); g.addColorStop(0.5, '#3060d8'); g.addColorStop(1, '#1830a0');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // Great Dark Spot
      ctx.beginPath(); ctx.ellipse(W*0.4, H*0.45, W*0.05, H*0.08, 0.2, 0, Math.PI*2);
      ctx.fillStyle = '#102090'; ctx.globalAlpha = 0.6; ctx.fill();
      ctx.globalAlpha = 1;
      noise(0.12, '#102080', '#4080e8', 15);
      break;
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

// ── Planet catalogue ──────────────────────────────────────────────────────────

interface PlanetVisual {
  name: PlanetName;
  radiusKm: number;
  sma: number;
  ecc: number;
  texFile: string;
  hasSaturnRings?: boolean;
  ringInner?: number;
  ringOuter?: number;
  ringOpacity?: number;
  tiltDeg?: number;
}

const PLANETS: PlanetVisual[] = [
  { name: 'Mercury', radiusKm: 2440,  sma: 0.387, ecc: 0.206, texFile: '2k_mercury.jpg' },
  { name: 'Venus',   radiusKm: 6052,  sma: 0.723, ecc: 0.007, texFile: '2k_venus_atmosphere.jpg' },
  { name: 'Earth',   radiusKm: 6371,  sma: 1.000, ecc: 0.017, texFile: '2k_earth_daymap.jpg', tiltDeg: 23.44 },
  { name: 'Mars',    radiusKm: 3390,  sma: 1.524, ecc: 0.093, texFile: '2k_mars.jpg', tiltDeg: 25.19 },
  { name: 'Jupiter', radiusKm: 71492, sma: 5.203, ecc: 0.049, texFile: '2k_jupiter.jpg', tiltDeg: 3.13 },
  { name: 'Saturn',  radiusKm: 60268, sma: 9.537, ecc: 0.057, texFile: '2k_saturn.jpg',
    hasSaturnRings: true, ringInner: 1.22, ringOuter: 2.27, ringOpacity: 0.7, tiltDeg: 26.73 },
  { name: 'Uranus',  radiusKm: 25559, sma: 19.19, ecc: 0.046, texFile: '2k_uranus.jpg', tiltDeg: 97.77 },
  { name: 'Neptune', radiusKm: 24764, sma: 30.07, ecc: 0.010, texFile: '2k_neptune.jpg', tiltDeg: 28.32 },
];

function displayRadius(km: number): number {
  return Math.log10(km / 2440 + 1) * 0.35 + 0.08;
}

// ── Orbit path ─────────────────────────────────────────────────────────────────

function makeOrbitLine(sma: number, ecc: number, color: number): THREE.Line {
  const b = sma * Math.sqrt(1 - ecc * ecc);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 256; i++) {
    const t = (i / 256) * Math.PI * 2;
    pts.push(new THREE.Vector3(sma * Math.cos(t) * AU, 0, b * Math.sin(t) * AU));
  }
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.2 });
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
}

// ── Asteroid belt ─────────────────────────────────────────────────────────────

function makeAsteroidBelt(): THREE.Points {
  const N = 3000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = (2.2 + Math.random() * 1.0) * AU;
    const theta = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.5) * 0.15 * AU;
    pos[i*3]   = r * Math.cos(theta);
    pos[i*3+1] = y;
    pos[i*3+2] = r * Math.sin(theta);
    const v = 0.4 + Math.random() * 0.3;
    col[i*3] = v * 0.9; col[i*3+1] = v * 0.8; col[i*3+2] = v * 0.7;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.5, vertexColors: true, sizeAttenuation: false,
    transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
}

// ── Backdrop stars ─────────────────────────────────────────────────────────────

function makeBackdrop(): THREE.Points {
  const N = 8000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r = 950;
    pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i*3+2] = r * Math.cos(phi);
    const b = 0.4 + Math.random() * 0.6;
    const bv = Math.random() * 2 - 0.4;
    const t  = Math.max(0, Math.min(1, (bv + 0.4) / 2.4));
    col[i*3]   = b * (t < 0.5 ? 0.63 + t * 0.74 : 1.0);
    col[i*3+1] = b * (t < 0.5 ? 0.75 + t * 0.50 : 0.9 - (t-0.5) * 0.6);
    col[i*3+2] = b * (t < 0.5 ? 1.00 - t * 0.80 : 0.98 - (t-0.5) * 1.56);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    size: 1.2, vertexColors: true, sizeAttenuation: false,
    transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
}

// ── Sun glow ──────────────────────────────────────────────────────────────────

function makeSunGlow(): THREE.Sprite {
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  g.addColorStop(0.0, 'rgba(255,255,200,0.9)');
  g.addColorStop(0.2, 'rgba(255,200, 50,0.5)');
  g.addColorStop(0.5, 'rgba(255,100,  0,0.15)');
  g.addColorStop(1.0, 'rgba(255,  0,  0,0.0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const sunTex = new THREE.CanvasTexture(c); sunTex.flipY = false;
  const mat = new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(6, 6, 1);
  return sp;
}

// ── Label sprite ──────────────────────────────────────────────────────────────

function makeLabelSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 56;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 22px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'center'; ctx.fillText(text, 128, 38);
  const labelTex = new THREE.CanvasTexture(c); labelTex.flipY = false;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, depthWrite: false, transparent: true }));
  sp.scale.set(3, 0.75, 1);
  return sp;
}

// ── ISS glow sprite ───────────────────────────────────────────────────────────

function makeISSSprite(): THREE.Sprite {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  g.addColorStop(0, 'rgba(200,255,255,1)'); g.addColorStop(0.3, 'rgba(100,200,255,0.6)'); g.addColorStop(1, 'rgba(0,100,200,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const issTex = new THREE.CanvasTexture(c); issTex.flipY = false;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: issTex, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.scale.set(0.18, 0.18, 1);
  return sp;
}

// ── Component types ───────────────────────────────────────────────────────────

interface SolarSystemViewProps {
  onPlanetSelect?: (state: PlanetState) => void;
  className?: string;
  lat?: number;
  lon?: number;
  focusPlanet?: PlanetName | null;
}

interface ISSData { latitude: number; longitude: number; altitude: number; velocity: number }

function fmtSpeed(s: number): string {
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}×`;
  if (s < 3600) return `${(s/60).toFixed(0)} min/s`;
  if (s < 86400) return `${(s/3600).toFixed(0)} hr/s`;
  return `${(s/86400).toFixed(0)} day/s`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SolarSystemView({ onPlanetSelect, className = '', lat = 40.71, lon = -74.01, focusPlanet }: SolarSystemViewProps) {
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const rafRef          = useRef<number>(0);
  const meshesRef       = useRef<Map<PlanetName, THREE.Mesh>>(new Map());
  const moonMeshRef     = useRef<THREE.Mesh | null>(null);
  const issMeshRef      = useRef<THREE.Sprite | null>(null);
  const cameraRef       = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef     = useRef<OrbitControls | null>(null);
  const focusTargetRef  = useRef<THREE.Vector3 | null>(null);
  const focusDistRef    = useRef<number>(10);
  const simTimeRef      = useRef<Date>(new Date());
  const speedRef        = useRef<number>(1);
  const playingRef      = useRef<boolean>(true);
  const issDataRef      = useRef<ISSData | null>(null);

  const [speed,          setSpeed]          = useState(1);
  const [isPlaying,      setIsPlaying]      = useState(true);
  const [simDisplay,     setSimDisplay]     = useState(() => new Date().toISOString().slice(0, 16).replace('T', ' '));
  const [planetInfo,     setPlanetInfo]     = useState<PlanetState | null>(null);
  const [issData,        setIssData]        = useState<ISSData | null>(null);
  const [showSolar,      setShowSolar]      = useState(false);
  /** Whether camera is close enough to Earth to show the Google Earth button */
  const [earthProximity, setEarthProximity] = useState(0);
  /** Whether the Google Earth overlay is open (user clicked the button) */
  const [earthGlobeOpen, setEarthGlobeOpen] = useState(false);
  /** Which non-Earth planet is close enough to trigger a surface view button */
  const [nearPlanet,     setNearPlanet]     = useState<string | null>(null);
  /** Whether the Mars surface overlay is open */
  const [surfacePlanet,  setSurfacePlanet]  = useState<string | null>(null);
  const [dragMode,       setDragMode]       = useState<'pan' | 'orbit'>('pan');
  const frameCountRef        = useRef(0);
  const earthProxRef         = useRef(0);
  /** Timestamp (performance.now) until which proximity re-triggering is suppressed after exit */
  const earthExitCooldownRef = useRef(0);

  speedRef.current   = speed;
  playingRef.current = isPlaying;

  // ── External planet focus (from right-panel card clicks) ─────────────────────
  useEffect(() => {
    if (!focusPlanet) return;
    const mesh = meshesRef.current.get(focusPlanet);
    if (!mesh) return;
    focusTargetRef.current = mesh.position.clone();
    focusDistRef.current   = displayRadius(
      PLANETS.find(p => p.name === focusPlanet)?.radiusKm ?? 6371
    ) * 5;
    const state = planetState(focusPlanet, simTimeRef.current);
    setPlanetInfo(state);
    onPlanetSelect?.(state);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPlanet]);

  // ── Drag mode sync ───────────────────────────────────────────────────────────
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.mouseButtons = {
      LEFT:   dragMode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT:  dragMode === 'pan' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
    };
  }, [dragMode]);

  // ── ISS polling ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchISS = async () => {
      try {
        const r = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
        if (!r.ok) return;
        const d: ISSData = await r.json();
        setIssData(d);
        issDataRef.current = d;
      } catch { /* network error — silently ignore */ }
    };
    fetchISS();
    const id = setInterval(fetchISS, 8000);
    return () => clearInterval(id);
  }, []);

  // ── Sim time display sync ─────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (!playingRef.current) return;
      setSimDisplay(simTimeRef.current.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
    }, 500);
    return () => clearInterval(id);
  }, []);

  // ── Click handler ─────────────────────────────────────────────────────────────
  const handleClick = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || !camera) return;
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(mouse, camera);
    const meshes = [...meshesRef.current.values()];
    if (moonMeshRef.current) meshes.push(moonMeshRef.current);
    // recursive=false prevents hitting ring/label children which have no planetName
    const hits = rc.intersectObjects(meshes, false);
    if (!hits.length) return;
    const hit = hits[0].object as THREE.Mesh;
    const name: string | undefined = hit.userData.planetName;
    if (!name) return;
    // Moon is not in the planet elements table — fly camera only
    if (name === 'Moon') {
      focusTargetRef.current = hit.position.clone();
      focusDistRef.current   = 0.3;
      return;
    }
    // Guard: only call planetState for known planet names
    const validNames: PlanetName[] = ['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune'];
    if (!validNames.includes(name as PlanetName)) return;
    const state = planetState(name as PlanetName, simTimeRef.current);
    setPlanetInfo(state);
    onPlanetSelect?.(state);
    focusTargetRef.current = hit.position.clone();
    focusDistRef.current   = displayRadius(
      PLANETS.find(p => p.name === name)?.radiusKm ?? 6371
    ) * 5;
  }, [onPlanetSelect]);

  // ── Three.js setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000005);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.001, 2000);
    camera.position.set(0, 80, 60);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.07;
    controls.minDistance    = 0.05;
    controls.maxDistance    = 800;
    controls.enablePan      = true;
    controls.panSpeed       = 1.2;
    controls.rotateSpeed    = 0.6;
    controls.zoomSpeed      = 1.2;
    // Left: orbit  |  Right: pan  |  Middle: dolly
    controls.mouseButtons = {
      LEFT:   THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT:  THREE.MOUSE.ROTATE,
    };
    controlsRef.current    = controls;

    // Lighting
    scene.add(new THREE.AmbientLight(0x8899bb, 4));
    const sunLight = new THREE.PointLight(0xfff8e7, 0.3, 1800, 1.4);
    sunLight.castShadow = true;
    scene.add(sunLight);

    // Scene objects
    scene.add(makeBackdrop());
    scene.add(makeAsteroidBelt());

    // Sun
    const sunTex = makeProcTexture('Sun');
    const sunMat = new THREE.MeshStandardMaterial({ map: sunTex, emissiveMap: sunTex, emissive: 0xffbb44, emissiveIntensity: 1.5, roughness: 1 });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.2, 32, 16), sunMat));
    scene.add(makeSunGlow());

    // Ecliptic grid
    const grid = new THREE.GridHelper(500, 50, 0x0a1a2a, 0x0a1a2a);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.2;
    scene.add(grid);

    // Texture loader — real textures replace procedural on successful load
    const loader = new THREE.TextureLoader();

    // Planets
    const meshMap = new Map<PlanetName, THREE.Mesh>();

    for (const pv of PLANETS) {
      // Orbit line
      const orbitColors: Record<PlanetName, number> = {
        Mercury: 0x999999, Venus: 0xd4c06a, Earth: 0x4488cc, Mars: 0xcc4422,
        Jupiter: 0xcc9944, Saturn: 0xd4c08a, Uranus: 0x44cccc, Neptune: 0x4444cc,
      };
      scene.add(makeOrbitLine(pv.sma, pv.ecc, orbitColors[pv.name]));

      const r = displayRadius(pv.radiusKm);

      // Procedural texture first
      const procTex = makeProcTexture(pv.name);
      const mat = new THREE.MeshStandardMaterial({
        map: procTex, roughness: 1, metalness: 0,
        // Daymap has white clouds baked in; clamp so they don't blow out under high ambient
        ...(pv.name === 'Earth' && { color: new THREE.Color(0.35, 0.35, 0.35) }),
      });

      // Try loading real texture asynchronously
      loader.load(`/textures/${pv.texFile}`, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.needsUpdate = true;
      });

      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 20), mat);
      mesh.userData.planetName = pv.name;
      mesh.castShadow  = true;
      mesh.receiveShadow = true;
      if (pv.tiltDeg) mesh.rotation.z = (pv.tiltDeg * Math.PI) / 180;
      scene.add(mesh);
      meshMap.set(pv.name, mesh);

      // Separate cloud layer for Earth using 2k_earth_clouds.jpg
      if (pv.name === 'Earth') {
        const cloudMat = new THREE.MeshStandardMaterial({
          roughness: 1, metalness: 0,
          transparent: true, opacity: 0,
          color: new THREE.Color(0.5, 0.5, 0.5),
          depthWrite: false,
        });
        loader.load('/textures/2k_earth_clouds.jpg', (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          cloudMat.map = tex;
          cloudMat.alphaMap = tex;
          cloudMat.opacity = 1;
          cloudMat.needsUpdate = true;
        });
        const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(r * 1.005, 40, 20), cloudMat);
        if (pv.tiltDeg) cloudMesh.rotation.z = (pv.tiltDeg * Math.PI) / 180;
        mesh.add(cloudMesh);
      }

      // Saturn rings with gradient texture
      if (pv.hasSaturnRings) {
        const ri = r * (pv.ringInner ?? 1.3), ro = r * (pv.ringOuter ?? 2.2);
        const ringGeo = new THREE.RingGeometry(ri, ro, 128);
        // UV mapping for ring (Three.js RingGeometry doesn't auto-map for textures)
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xd4c090, side: THREE.DoubleSide,
          transparent: true, opacity: pv.ringOpacity ?? 0.6,
        });
        // Try ring texture
        loader.load('/textures/2k_saturn_ring_alpha.png', (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          ringMat.map = tex; ringMat.alphaMap = tex; ringMat.needsUpdate = true;
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2 - 0.4;
        mesh.add(ring);
      }

      // Label
      const label = makeLabelSprite(pv.name);
      label.position.y = r + 0.45;
      mesh.add(label);
    }
    meshesRef.current = meshMap;

    // Moon
    const moonR = displayRadius(6371) * 0.27;
    const moonTex = makeProcTexture('Moon');
    const moonMat = new THREE.MeshStandardMaterial({ map: moonTex, roughness: 1, metalness: 0 });
    loader.load('/textures/2k_moon.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace; moonMat.map = tex; moonMat.needsUpdate = true;
    });
    const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(moonR, 24, 12), moonMat);
    moonMesh.userData.planetName = 'Moon' as PlanetName;
    scene.add(moonMesh);
    moonMeshRef.current = moonMesh;

    const moonLabel = makeLabelSprite('Moon');
    moonLabel.position.y = moonR + 0.2;
    moonMesh.add(moonLabel);

    // ISS sprite
    const iss = makeISSSprite();
    scene.add(iss);
    issMeshRef.current = iss;

    // ── Animation loop ─────────────────────────────────────────────────────────
    let lastMs = performance.now();

    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const now = performance.now();
      const dtReal = Math.min((now - lastMs) / 1000, 0.1);
      lastMs = now;

      if (playingRef.current) {
        simTimeRef.current = new Date(simTimeRef.current.getTime() + dtReal * speedRef.current * 1000);
      }

      const simTime = simTimeRef.current;
      const earthMesh = meshMap.get('Earth');

      // Update planets
      for (const pv of PLANETS) {
        const mesh = meshMap.get(pv.name);
        if (!mesh) continue;
        const state = planetState(pv.name, simTime);
        const { lon: L, lat: B, r } = state.ecliptic;
        const Lr = (L * Math.PI) / 180, Br = (B * Math.PI) / 180;
        mesh.position.set(
          r * Math.cos(Br) * Math.cos(Lr) * AU,
          r * Math.sin(Br) * AU,
          r * Math.cos(Br) * Math.sin(Lr) * AU,
        );
        mesh.rotation.y += 0.003 * dtReal * speedRef.current;

        // Label scale stays readable
        const d = camera.position.distanceTo(mesh.position);
        const label = mesh.children.find(c => c instanceof THREE.Sprite) as THREE.Sprite | undefined;
        if (label) label.scale.set(d * 0.055, d * 0.014, 1);
      }

      // Moon position relative to Earth
      if (moonMeshRef.current && earthMesh) {
        const mEcl = moonGeocentricEcliptic(simTime);
        const r_scene = (mEcl.r_km / KM_PER_AU) * AU * MOON_ORBIT_SCALE;
        const mLr = (mEcl.lon * Math.PI) / 180;
        const mBr = (mEcl.lat * Math.PI) / 180;
        moonMeshRef.current.position.set(
          earthMesh.position.x + r_scene * Math.cos(mBr) * Math.cos(mLr),
          earthMesh.position.y + r_scene * Math.sin(mBr),
          earthMesh.position.z + r_scene * Math.cos(mBr) * Math.sin(mLr),
        );
        moonMeshRef.current.rotation.y += 0.001 * dtReal * speedRef.current;
        const d = camera.position.distanceTo(moonMeshRef.current.position);
        const ml = moonMeshRef.current.children[0] as THREE.Sprite | undefined;
        if (ml) ml.scale.set(d * 0.05, d * 0.013, 1);
      }

      // ISS position (near Earth surface, uses real lat/lon)
      if (issMeshRef.current && earthMesh && issDataRef.current) {
        const iss = issDataRef.current;
        const issLat = (iss.latitude * Math.PI) / 180;
        const issLon = (iss.longitude * Math.PI) / 180;
        const earthR = displayRadius(6371);
        // Earth's ecliptic frame: x=cos*cos, y=sin(lat), z=cos*sin — but Earth's equatorial plane
        // is tilted 23.44° from ecliptic. Simplified: ignore tilt for ISS display.
        const issDist = earthR * 1.08;  // slightly above surface
        issMeshRef.current.position.set(
          earthMesh.position.x + issDist * Math.cos(issLat) * Math.cos(issLon),
          earthMesh.position.y + issDist * Math.sin(issLat),
          earthMesh.position.z + issDist * Math.cos(issLat) * Math.sin(issLon),
        );
        const camDist = camera.position.distanceTo(issMeshRef.current.position);
        // ISS is only visible when zoomed in on Earth
        issMeshRef.current.visible = camDist < 5;
        issMeshRef.current.scale.setScalar(camDist < 5 ? 0.15 : 0.05);
      }

      // Smooth camera focus
      if (focusTargetRef.current) {
        controls.target.lerp(focusTargetRef.current, 0.05);
        const dir = camera.position.clone().sub(controls.target).normalize();
        const targetDist = focusDistRef.current;
        const curDist = camera.position.distanceTo(controls.target);
        if (curDist > targetDist * 1.02) {
          camera.position.addScaledVector(dir, -(curDist - targetDist) * 0.04);
        }
        if (controls.target.distanceTo(focusTargetRef.current) < 0.005) {
          focusTargetRef.current = null;
        }
      }

      // Proximity check — every 15 frames to balance responsiveness vs churn
      frameCountRef.current++;
      if (frameCountRef.current % 15 === 0) {
        // ── Earth: button-based Google Earth entry ─────────────────────────────
        const earthMeshPos = meshMap.get('Earth')?.position;
        if (earthMeshPos && performance.now() > earthExitCooldownRef.current) {
          const earthDisplayR = displayRadius(6371);
          const distToEarth   = camera.position.distanceTo(earthMeshPos);
          const NEAR_DIST     = earthDisplayR * 8;
          const isNear = distToEarth < NEAR_DIST ? 1 : 0;
          if (isNear !== earthProxRef.current) {
            earthProxRef.current = isNear;
            setEarthProximity(isNear);
          }
        }

        // ── Mars: button-based surface view ───────────────────────────────────
        const marsPos = meshMap.get('Mars')?.position;
        const found = marsPos && camera.position.distanceTo(marsPos) < 1.0 ? 'Mars' : null;
        setNearPlanet(found);
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    ro.observe(canvas.parentElement ?? canvas);
    canvas.addEventListener('click', handleClick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('click', handleClick);
      controls.dispose();
      renderer.dispose();
    };
  }, [handleClick]);

  // ── Time controls ─────────────────────────────────────────────────────────────
  const jumpDays = (d: number) => {
    simTimeRef.current = new Date(simTimeRef.current.getTime() + d * 86400000);
    setSimDisplay(simTimeRef.current.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
  };
  const setNow = () => {
    simTimeRef.current = new Date();
    setSimDisplay(simTimeRef.current.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
  };
  const handleDateInput = (v: string) => {
    const d = new Date(v + ':00Z');
    if (!isNaN(d.getTime())) {
      simTimeRef.current = d;
      setSimDisplay(d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
    }
  };

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? '';

  return (
    <div className={`relative w-full h-full bg-[#000510] ${className}`}>
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        style={{
          opacity: earthGlobeOpen ? 0 : 1,
          transition: 'opacity 0.8s cubic-bezier(0.4,0,0.2,1)',
          pointerEvents: earthGlobeOpen ? 'none' : 'auto',
        }}
      />

      {/* Google Earth overlay — always mounted so it preloads; shown when earthGlobeOpen */}
      <EarthGlobe
        apiKey={apiKey}
        opacity={earthGlobeOpen ? 1 : 0}
        initialLat={issData?.latitude ?? lat}
        initialLon={issData?.longitude ?? lon}
        issLat={issData?.latitude}
        issLon={issData?.longitude}
        onOpacityRequest={() => {
          setEarthGlobeOpen(false);
          earthExitCooldownRef.current = performance.now() + 3000;
          earthProxRef.current = 0;
          setEarthProximity(0);
          const earthMesh = meshesRef.current.get('Earth');
          if (earthMesh) {
            focusTargetRef.current = earthMesh.position.clone();
            focusDistRef.current   = displayRadius(6371) * 14;
          }
        }}
      />

      {/* ── Unified top pill nav bar ── */}
      <div className="absolute select-none" style={{ top: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
        <div className="top-nav-pill">
          {/* Hint text */}
          <span className="nav-seg" style={{ fontSize: 10, letterSpacing: '0.035em', color: 'rgba(255,255,255,0.38)' }}>
            {dragMode === 'pan' ? 'drag · pan' : 'drag · orbit'}
          </span>

          {/* Divider */}
          <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

          {/* Pan / Orbit toggle */}
          <button
            className={`nav-seg nav-btn${dragMode === 'pan' ? ' active' : ''}`}
            onClick={() => setDragMode('pan')}
            title="Left-drag pans the view"
            style={{ gap: 5, display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 11 }}>⤢</span> Pan
          </button>
          <button
            className={`nav-seg nav-btn${dragMode === 'orbit' ? ' active' : ''}`}
            onClick={() => setDragMode('orbit')}
            title="Left-drag orbits the view"
            style={{ gap: 5, display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 11 }}>↻</span> Orbit
          </button>

          {/* Divider */}
          <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

          {/* Scroll hint */}
          <span className="nav-seg" style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
            scroll · zoom
          </span>

          {/* ISS (when live) */}
          {issData && (
            <>
              <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
              <span className="nav-seg" style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.5)',
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.6)', flexShrink: 0,
                  animation: 'issPulse 2s ease infinite',
                }} />
                ISS · {issData.latitude.toFixed(1)}°{issData.latitude >= 0 ? 'N' : 'S'} · {issData.altitude.toFixed(0)} km
              </span>
            </>
          )}
        </div>
      </div>

      {/* Planet info card */}
      {planetInfo && (
        <div className="absolute p-3 rounded-xl"
          style={{ left: 252, top: 16, width: 136,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.09)',
            backdropFilter: 'blur(24px) saturate(120%)',
            WebkitBackdropFilter: 'blur(24px) saturate(120%)' }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.9)', fontFamily: 'var(--font-ui)' }}>
              {planetInfo.name}
            </h3>
            <button onClick={() => setPlanetInfo(null)}
              className="text-[10px] w-4 h-4 rounded-full flex items-center justify-center"
              style={{ color: 'rgba(255,255,255,0.35)' }}>✕</button>
          </div>
          <div className="flex flex-col gap-0.5" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
            {[
              ['Helio r', `${planetInfo.ecliptic.r.toFixed(3)} AU`],
              ['Geo r',   `${planetInfo.equatorial.dist.toFixed(3)} AU`],
              ['Mag',     planetInfo.magnitude.toFixed(1)],
              ['Phase',   `${(planetInfo.illumination * 100).toFixed(0)}%`],
              ['∅',       `${planetInfo.angularDiameterArcsec.toFixed(1)}″`],
              ['Phase ∠', `${planetInfo.phaseAngle.toFixed(1)}°`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <span style={{ color: 'rgba(200,210,230,0.5)' }}>{k}</span>
                <span style={{ color: 'rgba(255,255,255,0.85)' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Google Earth button — shown when camera is near Earth and overlay not open */}
      {earthProximity === 1 && !earthGlobeOpen && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 animate-bounce">
          <button onClick={() => setEarthGlobeOpen(true)}
            className="flex items-center gap-2 px-5 py-2 rounded-full text-xs font-medium transition-all"
            style={{ background: 'rgba(5,15,30,0.85)', border: '1px solid rgba(255,255,255,0.18)',
              backdropFilter: 'blur(12px)', color: 'rgba(255,255,255,0.8)', fontFamily: 'var(--font-ui)' }}>
            🌍 View with Google Earth
          </button>
        </div>
      )}

      {/* Mars surface entry button */}
      {nearPlanet === 'Mars' && !surfacePlanet && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 animate-bounce">
          <button onClick={() => setSurfacePlanet('Mars')}
            className="flex items-center gap-2 px-5 py-2 rounded-full text-xs font-medium transition-all"
            style={{ background: 'rgba(5,15,30,0.85)', border: '1px solid rgba(255,255,255,0.18)',
              backdropFilter: 'blur(12px)', color: 'rgba(255,255,255,0.8)', fontFamily: 'var(--font-ui)' }}>
            🔴 Zoom to Mars Surface
          </button>
        </div>
      )}

      {/* Mars surface overlay */}
      {surfacePlanet && (
        <PlanetSurfaceView
          planet={surfacePlanet}
          apiKey={apiKey}
          lat={lat} lon={lon}
          issLat={issData?.latitude} issLon={issData?.longitude}
          onClose={() => setSurfacePlanet(null)}
        />
      )}

      {/* Timeline controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-full"
          style={{ background: 'rgba(5,15,30,0.8)', border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(12px)', fontFamily: 'var(--font-mono)' }}>

          {(['«','‹‹','‹'] as const).map((ch, i) => (
            <button key={ch} onClick={() => jumpDays([-365,-30,-1][i])} title={['−1 year','−1 month','−1 day'][i]}
              className="text-[11px] px-1 transition-colors" style={{ color: 'rgba(255,255,255,0.35)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.75)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.35)')}>{ch}</button>
          ))}

          <button onClick={() => setIsPlaying(p => !p)}
            className="w-7 h-7 flex items-center justify-center rounded-full text-white text-xs transition-all"
            style={{ background: isPlaying ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.22)' }}>
            {isPlaying ? '⏸' : '▶'}
          </button>

          {(['›','››','»'] as const).map((ch, i) => (
            <button key={ch} onClick={() => jumpDays([1,30,365][i])} title={['+1 day','+1 month','+1 year'][i]}
              className="text-[11px] px-1 transition-colors" style={{ color: 'rgba(255,255,255,0.35)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.75)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.35)')}>{ch}</button>
          ))}

          <div className="w-px h-3 mx-1" style={{ background: 'rgba(255,255,255,0.12)' }} />

          <input type="datetime-local"
            value={simTimeRef.current.toISOString().slice(0, 16)}
            onChange={e => handleDateInput(e.target.value)}
            className="bg-transparent text-[11px] border-none outline-none w-36 cursor-pointer"
            style={{ color: 'rgba(255,255,255,0.7)' }} />

          <div className="w-px h-3 mx-1" style={{ background: 'rgba(255,255,255,0.12)' }} />

          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>SPD</span>
          <input type="range" min={0} max={6} step={0.05}
            value={Math.log10(speed + 1)}
            onChange={e => setSpeed(Math.max(0.1, Math.round(Math.pow(10, Number(e.target.value)) * 10) / 10))}
            className="w-20" />
          <span className="text-[11px] w-16 text-right" style={{ color: 'rgba(255,255,255,0.7)' }}>{fmtSpeed(speed)}</span>

          <div className="w-px h-3 mx-1" style={{ background: 'rgba(255,255,255,0.12)' }} />
          <button onClick={setNow}
            className="text-[11px] px-2.5 py-0.5 rounded-full transition-all"
            style={{ color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.15)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.85)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.35)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.45)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)'; }}>
            NOW
          </button>
        </div>
      </div>

      <style>{`
        @keyframes issPulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}
