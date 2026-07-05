# World Astronomy

A real-time, interactive solar system observatory — built with Next.js 16, Three.js, and Google's Photorealistic 3D Tiles. Observe the solar system at any point in time, track the ISS live, check tonight's sky conditions from your location, and seamlessly zoom from interplanetary scale down to Earth's surface — no page transitions, no buttons, just scroll.

---

![World Astronomy — Orrery with Mercury selected](Screenshot%202026-07-05%20at%2017.05.31.png)

## What Makes This Different

Most astronomy apps are either beautiful but static, or accurate but ugly. This one is both — every planet is where it actually is right now, computed from real orbital mechanics, rendered in a live 3D scene you can fly around freely.

The standout feature is the **seamless Earth zoom**: keep scrolling into Earth in the orrery and, without any button press or page change, the view crossfades into Google's Photorealistic 3D Tiles — the same dataset that powers Google Earth. Scroll back out and you're back in the solar system. The transition is driven purely by camera proximity, not user intent.

---

## Features

### Orrery — 3D Solar System
- **Real ephemeris positions** — planet coordinates computed from NASA's J2000 orbital elements (semi-major axis, eccentricity, inclination, argument of perihelion, longitude of ascending node, mean longitude), updated every frame
- **Time travel** — scrub through any date in history or the future; speeds from 0.1× to 100,000×; jump by day, month, or year
- **High-fidelity visuals** — procedural canvas textures as instant fallbacks, real NASA texture maps loaded asynchronously; Saturn rings with alpha-mapped gradient; Earth atmosphere glow with additive blending; Moon at correct geocentric ephemeris position
- **ISS live tracking** — real-time ISS position polled every 8 seconds, rendered at correct orbital altitude, visible when zoomed in
- **Camera controls** — left-drag to orbit, right-drag to pan, scroll to zoom; smooth fly-to animation on planet click

### Seamless Earth Zoom
- Powered by [NASA-AMMOS 3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) with Google Photorealistic 3D Tiles
- `GlobeControls` handles the space-to-street zoom natively — the same control used in NASA's own tools
- Logarithmic depth buffer prevents z-fighting across 13 orders of magnitude of scale (10,000 km orbit → 1 m street level)
- Opacity crossfade driven by orrery camera proximity; exits automatically when scrolling back to orbital altitude
- ECEF coordinate system (Earth-Centered Earth-Fixed, meters) in a completely separate Three.js scene — no coordinate system compromise

### Sky View
- **Live observing conditions** — twilight phase, Sun altitude, Moon illumination and age
- **Planet rankings** — all 8 planets scored and ranked for tonight's visibility at your GPS location
- **Solar events** — astronomical, nautical, and civil dawn/dusk; sunrise, solar noon, sunset
- **Live weather** — Google Maps Weather API: temperature, feels-like, UV index, cloud cover, humidity, wind direction

### Design
- **Glassmorphism UI** — `backdrop-filter: blur(16px)` panels with layered depth over the live 3D scene
- **Space Grotesk + JetBrains Mono** — modern variable-weight font pairing; monospaced readouts for coordinates and magnitudes
- **Teal/cyan accent system** — full CSS variable palette with semantic tokens; consistent dark space aesthetic throughout
- **Three-column layout** — left data panel, full-bleed 3D viewport, right planet list; all panels scroll independently

---

## Technical Architecture

```
src/
├── app/
│   ├── page.tsx              — HomePage: geolocation, weather API, sky computation, layout
│   ├── layout.tsx            — Root layout: fonts, globals
│   └── globals.css           — Design tokens, glassmorphism utilities
├── components/
│   ├── SolarSystemView.tsx   — Three.js orrery: planets, Moon, ISS, timeline, EarthGlobe overlay
│   ├── EarthGlobe.tsx        — 3D Tiles renderer: Google Photorealistic Earth, GlobeControls
│   ├── PlanetSurfaceView.tsx — Moon/Mars surface view
│   └── StarField.tsx         — Procedural star field canvas for sky view
└── lib/
    └── ephemeris.ts          — Orbital mechanics: J2000 elements, Julian date, Kepler solver, VSOP87-lite
```

### Ephemeris Engine

The entire ephemeris engine — orbital elements, Kepler equation solver, coordinate transforms, Moon position, solar event times — is written from scratch in ~600 lines of TypeScript. No third-party astronomy library.

**Orbital elements at epoch T** (Julian centuries from J2000.0):
```
a(T) = a₀ + ȧ·T     semi-major axis (AU)
e(T) = e₀ + ė·T     eccentricity
i(T) = i₀ + İ·T     inclination
L(T) = L₀ + L̇·T     mean longitude
ω̄(T) = ω̄₀ + ω̄̇·T    longitude of perihelion
Ω(T) = Ω₀ + Ω̇·T     longitude of ascending node
```

**Kepler's equation** solved iteratively with Newton–Raphson convergence (< 5 iterations for all solar system eccentricities): `M = E − e·sin(E)`

**Heliocentric → geocentric** coordinate transform, then equatorial RA/Dec for sky-view observability scoring.

### Coordinate Systems

| System | Used for | Units |
|--------|----------|-------|
| Heliocentric ecliptic | Planet positions in orrery | AU (scene: 1 AU = 6 units) |
| Geocentric equatorial | RA/Dec display, sky view | degrees / AU |
| ECEF | EarthGlobe 3D Tiles | meters |

### EarthGlobe Proximity System

The seamless zoom is a 3-state machine managed by `earthProximity` (0 → 1):

```
orrery camera distance to Earth:
  > FADE_START (8× Earth display radius)   →  earthProximity = 0   (EarthGlobe unmounted)
  between FADE_END and FADE_START          →  earthProximity = lerp (crossfade active)
  < FADE_END  (2.5× Earth display radius)  →  earthProximity = 1   (EarthGlobe fully visible)
```

An exit cooldown (`earthExitCooldownRef`) suppresses the proximity trigger for 3 seconds after the user scrolls out, giving the orrery camera time to retreat past the fade threshold before re-evaluation.

---

## Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5, strict mode |
| 3D — Orrery | Three.js 0.185 + OrbitControls |
| 3D — Earth | 3d-tiles-renderer 0.4 + GlobeControls + Google Photorealistic 3D Tiles |
| Styling | Tailwind CSS 4 + CSS custom properties |
| Fonts | Space Grotesk + JetBrains Mono (next/font/google) |
| Compiler | React 19 + React Compiler (babel-plugin-react-compiler) |
| APIs | Google Maps Weather API · wheretheiss.at (ISS) · Browser Geolocation |
| Science | NASA J2000 orbital elements · Chapront lunar tables |

---

## Implementation Highlights Worth Noting

**No astronomy library.** Every formula is implemented from primary sources — Meeus, *Astronomical Algorithms* (2nd ed.); Chapront, *Lunar Tables and Programs*. The ephemeris, Kepler solver, solar event algorithm, and observability scoring are all original implementations.

**No physics engine.** Three.js is used purely as a renderer. All spatial math is computed analytically from Keplerian elements each frame — no simulation state, no numerical integration, no floating-point drift across time jumps.

**SSR-safe dynamic imports.** Three.js, 3d-tiles-renderer, and all canvas/WebGL code is imported with `next/dynamic({ ssr: false })`. The server renders the shell; 3D hydrates client-side. Zero hydration mismatch.

**Procedural textures as instant fallbacks.** Every planet has a hand-crafted procedural canvas texture (Earth's continents drawn with `ellipse()` calls and noise passes; Jupiter's bands randomized at load; Saturn's ring alpha-mapped gradient) that renders immediately while real NASA `.jpg` textures load in the background. The swap is imperceptible.

---

## Getting Started

```bash
git clone https://github.com/Tanweer-Ahmed-Chiktay/Astronomy.git
cd Astronomy
npm install
```

Create `.env.local`:

```env
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_google_maps_api_key
```

Enable in Google Cloud Console:
- **Map Tiles API** — for Photorealistic 3D Tiles (Earth zoom)
- **Weather API** — for live weather data

```bash
npm run dev
# → http://localhost:3000
```

---

## About

Built by **Tanweer Ahmed** — a developer who cares about both the science and the craft.

[GitHub](https://github.com/Tanweer-Ahmed-Chiktay) · tanweerc76@gmail.com
