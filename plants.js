// Plant types for the orchard (baag).
//
// TO ADD A NEW PLANT: copy one line in PLANT_TYPES and change it.
//   id      short name with no spaces, used in the saved layout
//   name    label shown on the button
//   shape   'bush' (round shrub) or 'palm' (thin trunk with long leaves)
//   height  metres (1 ft = 0.3048 m). Baby plants: 2 to 2.5 ft = 0.61 to 0.76 m
//   leaf    leaf colour (hex)
//   trunk   stem / trunk colour (hex)
//   width   bush only: how wide the bush is, as a part of its height
//   blobs   bush only: how many leaf clumps (1 = one round ball)
//   fruit   bush only: colour of small fruit/flowers, or null for none
//   fruits  bush only: how many fruit/flowers
//   fronds  palm only: how many long leaves
//
// Each type is drawn with instancing (one draw call per type), so hundreds
// of plants stay smooth on a phone.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PLANT_TYPES = [
  { id: 'cheeku',  name: 'Cheeku',  shape: 'bush', height: 0.68, leaf: 0x2f5e2b, trunk: 0x6b4a2f, width: 0.95, blobs: 1, fruit: 0x8a5a33, fruits: 3 },
  { id: 'khajoor', name: 'Khajoor', shape: 'palm', height: 0.72, leaf: 0x7f9c5a, trunk: 0x8a6b46, fronds: 9 },
  { id: 'anar',    name: 'Anar',    shape: 'bush', height: 0.64, leaf: 0x8aac3c, trunk: 0x7a5b3a, width: 0.7,  blobs: 5, fruit: 0xc8322b, fruits: 6 },
];

// Random plant heights stay inside 2 to 2.5 ft.
export const MIN_HEIGHT = 0.61;
export const MAX_HEIGHT = 0.76;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gives every vertex a colour (with small random light/dark changes) and
// makes the geometry flat-shaded, so all parts can be merged into one.
function paint(geo, hex, rand, jitter = 0.12) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const base = new THREE.Color(hex);
  const c = new THREE.Color();
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {             // one shade per triangle
    c.copy(base).multiplyScalar(1 - jitter + rand() * jitter * 2);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// Small round patch of darker, watered soil around the stem (thaala).
function basin(rand) {
  const g = new THREE.CircleGeometry(0.32, 14);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.006, 0);
  return paint(g, 0x6e5a42, rand, 0.06);
}

// A lumpy leaf ball.
function leafBall(r, color, rand) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const bumps = new Map();                      // same corner -> same bump, so no holes
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
    if (!bumps.has(key)) bumps.set(key, 0.82 + rand() * 0.32);
    v.multiplyScalar(bumps.get(key));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return paint(g, color, rand, 0.16);
}

function buildBush(t, rand) {
  const parts = [basin(rand)];
  const H = 1;                                  // built 1 m tall, scaled later
  const r = (t.width * H) / 2;
  const stemH = H * 0.3;
  if (t.blobs <= 1) {
    const stem = new THREE.CylinderGeometry(0.018, 0.026, stemH + r * 0.5, 5);
    stem.translate(0, (stemH + r * 0.5) / 2, 0);
    parts.push(paint(stem, t.trunk, rand, 0.08));
    const ball = leafBall(r, t.leaf, rand);
    ball.scale(1, (H - stemH) / (2 * r), 1);
    ball.translate(0, stemH + (H - stemH) / 2, 0);
    parts.push(ball);
  } else {
    // Several thin stems, each with its own leaf clump: an upright shrub.
    for (let i = 0; i < t.blobs; i++) {
      const a = (i / t.blobs) * Math.PI * 2 + rand() * 0.6;
      const spread = r * (i === 0 ? 0 : 0.55 + rand() * 0.25);
      const x = Math.cos(a) * spread, z = Math.sin(a) * spread;
      const br = r * (i === 0 ? 0.62 : 0.42 + rand() * 0.12);
      const top = i === 0 ? H - br : H * (0.62 + rand() * 0.18);
      const stem = new THREE.CylinderGeometry(0.008, 0.014, top, 4);
      stem.translate(0, top / 2, 0);
      stem.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, x / top, z / top, 0, 0));
      parts.push(paint(stem, t.trunk, rand, 0.08));
      const ball = leafBall(br, t.leaf, rand);
      ball.scale(1, 1.15, 1);
      ball.translate(x, top, z);
      parts.push(ball);
    }
  }
  if (t.fruit) {
    for (let i = 0; i < t.fruits; i++) {
      const a = rand() * Math.PI * 2;
      const y = stemH + (H - stemH) * (0.3 + rand() * 0.5);
      const fr = new THREE.IcosahedronGeometry(0.035, 0);
      fr.translate(Math.cos(a) * r * 0.92, y, Math.sin(a) * r * 0.92);
      parts.push(paint(fr, t.fruit, rand, 0.1));
    }
  }
  return parts;
}

// One long palm leaf: a narrow strip that rises, then bends down, folded in a
// slight V along the middle rib.
function frond(len, width, rise, droop, color, rand) {
  const N = 8;
  const pos = [];
  const pt = (i, side) => {
    const s = i / N;
    const w = width * Math.sin(Math.PI * Math.min(1, s * 1.1)) * (side === 0 ? 0 : 1);
    const y = rise * s - droop * s * s;
    return [s * len, y - Math.abs(w) * 0.35, side * w];
  };
  for (let i = 0; i < N; i++) {
    for (const side of [-1, 1]) {
      const a = pt(i, 0), b = pt(i + 1, 0), c = pt(i, side), d = pt(i + 1, side);
      pos.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return paint(g, color, rand, 0.14);
}

function buildPalm(t, rand) {
  const parts = [basin(rand)];
  const trunkH = 0.36;
  // Thin trunk with rings, like the rough base of old leaf stalks.
  const trunk = new THREE.CylinderGeometry(0.03, 0.045, trunkH, 6, 4);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const ring = Math.round((p.getY(i) / trunkH + 0.5) * 4) % 2 ? 1.18 : 1;
    p.setX(i, p.getX(i) * ring);
    p.setZ(i, p.getZ(i) * ring);
  }
  trunk.translate(0, trunkH / 2, 0);
  parts.push(paint(trunk, t.trunk, rand, 0.12));

  for (let i = 0; i < t.fronds; i++) {
    const young = i < 2;                         // a couple of new leaves stand up
    const len = young ? 0.42 : 0.55 + rand() * 0.12;
    const f = frond(len, 0.045, young ? 0.5 : 0.32, young ? 0.12 : 0.55 + rand() * 0.2, t.leaf, rand);
    f.rotateY((i / t.fronds) * Math.PI * 2 + rand() * 0.4);
    f.translate(0, trunkH - 0.02, 0);
    parts.push(f);
  }
  return parts;
}

// One merged geometry per plant type, exactly 1 m tall (scaled per plant).
export function buildPlantGeometry(t, seed = 7) {
  const rand = rng(seed);
  const parts = t.shape === 'palm' ? buildPalm(t, rand) : buildBush(t, rand);
  const geo = mergeGeometries(parts);
  geo.computeBoundingBox();
  geo.scale(1, 1 / geo.boundingBox.max.y, 1);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function plantMaterial() {
  return new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
}
