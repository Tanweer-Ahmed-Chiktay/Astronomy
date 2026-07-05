'use client';

/**
 * StarField — WebGL star renderer using Three.js.
 *
 * Architecture:
 *  - Star positions (RA/Dec → Alt/Az → Cartesian) computed in JavaScript each frame.
 *  - Single THREE.Points draw call with BufferGeometry updated via typed arrays.
 *  - Custom fragment shader: B-V color index → blackbody RGB, soft circular disc,
 *    atmospheric scintillation at low altitude.
 *  - Vertex shader: pass-through (positions pre-computed in JS), Pogson magnitude
 *    → point size, atmospheric extinction dimming.
 *
 * Coordinate transform pipeline (JavaScript, runs once per frame):
 *   RA/Dec (J2000) → Hour Angle (via LST) → Altitude/Azimuth → Three.js Y-up Cartesian
 *
 * References:
 *   Meeus, "Astronomical Algorithms" Ch. 13 (coordinate transforms), Ch. 12 (sidereal time)
 */

import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { julianDate, julianCenturies } from '@/lib/ephemeris';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StarRecord {
  ra: number;   // degrees [0, 360)
  dec: number;  // degrees [-90, 90]
  mag: number;  // visual magnitude
  bv?: number;  // B-V color index (default 0.6 = solar)
}

interface StarFieldProps {
  latitude: number;
  longitude: number;
  bortleClass?: number;
  fovDeg?: number;
  onStarClick?: (star: StarRecord) => void;
  className?: string;
}

// ── Shaders ───────────────────────────────────────────────────────────────────

/**
 * Vertex shader — positions are pre-computed in JavaScript.
 * Scales point size by visual magnitude using Pogson's flux scale:
 *   flux ∝ 10^(−0.4 × mag)
 *   pointSize = scale × sqrt(flux)
 * Atmospheric extinction applied as a mag penalty stored in the `size` attribute.
 */
const VERT = /* glsl */`
  attribute float aMag;
  attribute float aBV;
  attribute float aExtinct;  // pre-computed extinction magnitude

  uniform float uLimMag;
  uniform float uFovScale;

  varying float vBV;
  varying float vAlt;

  void main() {
    vBV  = aBV;
    vAlt = aExtinct;  // re-used as altitude proxy for scintillation

    float effectiveMag = aMag + aExtinct;
    float flux = pow(10.0, -0.4 * clamp(effectiveMag, -4.0, uLimMag));
    float sz   = uFovScale * sqrt(flux) * 14.0;
    sz = clamp(sz, 0.0, 8.0);

    if (effectiveMag > uLimMag) sz = 0.0;

    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = sz;
  }
`;

/**
 * Fragment shader — soft circular disc with B-V → blackbody color.
 *
 * B-V color mapping from Ballesteros (2012), EPL 97, 34008:
 *   O/B stars (BV ≈ −0.4): blue-white
 *   A stars   (BV ≈  0.0): white
 *   G stars   (BV ≈  0.6): yellow-white (solar)
 *   K stars   (BV ≈  1.2): orange
 *   M stars   (BV ≈  2.0): deep red
 *
 * Scintillation: stars near the horizon twinkle via sin-based alpha modulation.
 */
const FRAG = /* glsl */`
  varying float vBV;
  varying float vAlt;
  uniform float uTime;

  vec3 bvToRgb(float bv) {
    float t = clamp((bv + 0.4) / 2.4, 0.0, 1.0);
    vec3 blue   = vec3(0.63, 0.75, 1.00);
    vec3 white  = vec3(1.00, 1.00, 0.98);
    vec3 yellow = vec3(1.00, 0.90, 0.60);
    vec3 orange = vec3(1.00, 0.60, 0.20);
    vec3 red    = vec3(1.00, 0.25, 0.10);
    if (t < 0.167) return mix(blue,   white,  t / 0.167);
    if (t < 0.458) return mix(white,  yellow, (t - 0.167) / 0.291);
    if (t < 0.667) return mix(yellow, orange, (t - 0.458) / 0.209);
    return mix(orange, red, (t - 0.667) / 0.333);
  }

  void main() {
    vec2  coord = gl_PointCoord - vec2(0.5);
    float r     = length(coord) * 2.0;
    if (r > 1.0) discard;

    float brightness = pow(1.0 - smoothstep(0.0, 1.0, r), 0.7);

    // Scintillation: vAlt carries extinction magnitude (high = near horizon).
    // ext ~0.2 at zenith, ~2.0+ at 5° — invert so horizon twinkles most.
    float altFrac  = clamp(1.0 - (vAlt - 0.2) / 1.5, 0.0, 1.0);
    float twinkAmt = (1.0 - altFrac) * 0.4;
    float twinkle  = 1.0 - twinkAmt * (0.5 + 0.5 * sin(uTime * 6.0 + gl_FragCoord.x * 0.5));

    vec3  color = bvToRgb(vBV);
    float alpha = brightness * twinkle;
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

// ── Astronomy helpers ─────────────────────────────────────────────────────────

const DEG = Math.PI / 180;

/** Greenwich Mean Sidereal Time in degrees — Meeus Ch. 12 eq. 12.4 */
function gmst(jd: number): number {
  const T = julianCenturies(jd);
  return (((280.46061837
    + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T
    - T * T * T / 38710000) % 360) + 360) % 360;
}

/**
 * Converts RA/Dec to a Three.js world-space unit vector on a Y-up sky dome.
 * Mapping: altitude → Y (up), azimuth from north through east → XZ plane.
 * Meeus Ch. 13, eq. 13.5–13.6.
 */
function raDecToWorld(
  raDeg: number, decDeg: number,
  latDeg: number, lstDeg: number
): THREE.Vector3 | null {
  const H     = ((lstDeg - raDeg) * DEG + Math.PI * 4) % (Math.PI * 2);
  const dec   = decDeg * DEG;
  const lat   = latDeg * DEG;

  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const alt    = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  if (alt < -0.01) return null;  // below horizon

  const cosAlt = Math.cos(alt);
  // Azimuth: N=0, E=90 convention
  const sinAz = Math.cos(dec) * Math.sin(H) / cosAlt;
  const cosAz = (Math.sin(dec) - Math.sin(lat) * sinAlt) / (Math.cos(lat) * cosAlt);
  const az    = Math.atan2(sinAz, cosAz);

  // Y-up Cartesian: Y = altitude, XZ = azimuth (north = -Z, east = +X)
  const x =  cosAlt * Math.sin(az);
  const y =  sinAlt;
  const z = -cosAlt * Math.cos(az);
  return new THREE.Vector3(x, y, z);
}

/** Atmospheric extinction in magnitudes — Schaefer (1993) */
function extinction(altDeg: number): number {
  if (altDeg < 0) return 99;
  const denom = altDeg + 10.3 / (altDeg + 5.11);
  return 0.2 / Math.max(0.001, Math.sin(denom * DEG));
}

/** Procedural star catalogue (deterministic PRNG, stable across renders) */
function makeProceduralStars(count = 3000): StarRecord[] {
  const stars: StarRecord[] = [];
  for (let i = 0; i < count; i++) {
    const s1 = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    const s2 = Math.sin(i * 269.5 + 183.3) * 43758.5453;
    const s3 = Math.sin(i * 419.2 +  72.1) * 43758.5453;
    const s4 = Math.sin(i *  53.7 + 128.4) * 43758.5453;
    stars.push({
      ra:  (s1 - Math.floor(s1)) * 360,
      dec: (s2 - Math.floor(s2)) * 180 - 90,
      mag: (s3 - Math.floor(s3)) * 7 - 1,
      bv:  (s4 - Math.floor(s4)) * 2.4 - 0.4,
    });
  }
  return stars;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StarField({
  latitude,
  longitude,
  bortleClass = 4,
  fovDeg = 60,
  onStarClick,
  className = '',
}: StarFieldProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const starsRef    = useRef<StarRecord[]>([]);
  const rafRef      = useRef<number>(0);

  const handleClick = useCallback((e: MouseEvent) => {
    if (!onStarClick || starsRef.current.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    const my = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

    // Find brightest star within click threshold
    const jd   = julianDate(new Date());
    const lst  = (gmst(jd) + longitude + 360) % 360;
    let bestDist = 0.04;
    let bestStar: StarRecord | null = null;

    // We need the camera to project — grab it from the scene's userData
    const scene = (canvasRef.current as unknown as { __scene?: THREE.Scene })?.__scene;
    const camera = scene?.userData?.camera as THREE.PerspectiveCamera | undefined;
    if (!camera) return;

    for (const star of starsRef.current) {
      if (star.mag > 4) continue;
      const v = raDecToWorld(star.ra, star.dec, latitude, lst);
      if (!v) continue;
      const ndc = v.clone().multiplyScalar(99).project(camera);
      const d = Math.hypot(ndc.x - mx, ndc.y - my);
      if (d < bestDist) { bestDist = d; bestStar = star; }
    }
    if (bestStar) onStarClick(bestStar);
  }, [latitude, longitude, onStarClick]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Three.js setup ────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fovDeg, 1, 0.1, 200);
    camera.position.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0.5, -1);  // looking south at ~26° altitude

    // Store camera reference for click handler
    (canvas as unknown as { __scene: THREE.Scene }).__scene = scene;
    scene.userData.camera = camera;

    // Sky background
    const skyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(100, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0x000008, side: THREE.BackSide })
    );
    scene.add(skyMesh);

    // ── Star geometry ─────────────────────────────────────────────────────────
    const MAX = 4000;
    const positions = new Float32Array(MAX * 3);
    const mags      = new Float32Array(MAX);
    const bvs       = new Float32Array(MAX);
    const extincts  = new Float32Array(MAX);

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('aMag',     new THREE.BufferAttribute(mags,    1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aBV',      new THREE.BufferAttribute(bvs,     1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aExtinct', new THREE.BufferAttribute(extincts,1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);  // nothing until first update

    const limMag = 7.6 - (bortleClass - 1) * 0.45;
    const mat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      uniforms: {
        uLimMag:   { value: limMag },
        uFovScale: { value: 60 / fovDeg },
        uTime:     { value: 0 },
      },
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    scene.add(points);

    // ── Load stars ────────────────────────────────────────────────────────────
    fetch('/data/bsc5.json')
      .then(r => { if (!r.ok) throw new Error('404'); return r.json(); })
      .then((data: StarRecord[]) => { starsRef.current = data; })
      .catch(() => { starsRef.current = makeProceduralStars(3000); });

    // Start immediately with procedural while fetch is in-flight
    starsRef.current = makeProceduralStars(3000);

    // ── Animation loop ────────────────────────────────────────────────────────
    let lastUpdateSec = -1;
    const startMs = Date.now();

    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);

      const elapsed = (Date.now() - startMs) / 1000;
      mat.uniforms.uTime.value = elapsed;

      // Recompute star positions once per second (stars move ~15″/s)
      const nowSec = Math.floor(elapsed);
      if (nowSec !== lastUpdateSec) {
        lastUpdateSec = nowSec;

        const jd  = julianDate(new Date());
        const lst = (gmst(jd) + longitude + 360) % 360;
        const stars = starsRef.current;
        mat.uniforms.uLimMag.value   = 7.6 - (bortleClass - 1) * 0.45;
        mat.uniforms.uFovScale.value = 60 / fovDeg;

        let count = 0;
        for (let i = 0; i < stars.length && count < MAX; i++) {
          const s = stars[i];
          const v = raDecToWorld(s.ra, s.dec, latitude, lst);
          if (!v) continue;

          // Actual altitude in degrees from the unit vector's y-component
          const altDeg = Math.asin(Math.max(-1, Math.min(1, v.y))) * (180 / Math.PI);
          // Atmospheric extinction in magnitudes (Schaefer 1993)
          const ext = extinction(altDeg);
          if (s.mag + ext > mat.uniforms.uLimMag.value) continue;

          positions[count * 3]     = v.x * 99;
          positions[count * 3 + 1] = v.y * 99;
          positions[count * 3 + 2] = v.z * 99;
          mags[count]     = s.mag;
          bvs[count]      = s.bv ?? 0.6;
          extincts[count] = ext;   // magnitudes of extinction (passed to vertex shader)
          count++;
        }

        geo.setDrawRange(0, count);
        posAttr.needsUpdate = true;
        (geo.getAttribute('aMag')     as THREE.BufferAttribute).needsUpdate = true;
        (geo.getAttribute('aBV')      as THREE.BufferAttribute).needsUpdate = true;
        (geo.getAttribute('aExtinct') as THREE.BufferAttribute).needsUpdate = true;
      }

      renderer.render(scene, camera);
    };
    animate();

    // ── Resize observer ───────────────────────────────────────────────────────
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;
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
      renderer.dispose();
      mat.dispose();
      geo.dispose();
    };
  }, [latitude, longitude, bortleClass, fovDeg, handleClick]);

  return (
    <canvas
      ref={canvasRef}
      className={`block ${className}`}
      style={{ touchAction: 'none' }}
    />
  );
}
