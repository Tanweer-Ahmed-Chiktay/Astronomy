#!/bin/bash
# Download 2K planet textures from Solar System Scope (CC BY 4.0)
# Run once: bash scripts/download-textures.sh
set -e
mkdir -p public/textures
cd public/textures

BASE="https://www.solarsystemscope.com/textures/download"
FILES=(
  "2k_sun.jpg"
  "2k_mercury.jpg"
  "2k_venus_atmosphere.jpg"
  "2k_earth_daymap.jpg"
  "2k_earth_nightmap.jpg"
  "2k_earth_clouds.jpg"
  "2k_moon.jpg"
  "2k_mars.jpg"
  "2k_jupiter.jpg"
  "2k_saturn.jpg"
  "2k_saturn_ring_alpha.png"
  "2k_uranus.jpg"
  "2k_neptune.jpg"
)

for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    echo "✓ $f already exists, skipping"
  else
    echo "↓ Downloading $f …"
    curl -L --silent --show-error -o "$f" "$BASE/$f" && echo "  ✓ $f" || echo "  ✗ Failed $f"
  fi
done
echo "Done. Textures in public/textures/"
