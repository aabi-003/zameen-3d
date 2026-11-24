// Plant types for the orchard (baag).
//
// TO ADD A NEW PLANT: copy one line in PLANT_TYPES and change it.
//   id       short name with no spaces, used in the saved layout
//   name     label shown on the button
//   shape    'bush' (round shrub) or 'palm' (short trunk with long leaves)
//   height   metres (1 ft = 0.3048 m). Baby plants: 2 to 2.5 ft = 0.61 to 0.76 m
//   leaf     main leaf colour (hex);  leafLight: lighter leaf colour
//   trunk    stem / trunk colour (hex)
//   leafLen  bush only: leaf length, 1 = normal (cheeku 1, anar is smaller)
//   leafWid  bush only: leaf width as a part of its length (0.4 = broad, 0.18 = narrow)
//   stems    bush only: 1 = one stem with a round crown, more = upright shrub
//   width    bush only: crown width as a part of the height
//   fruit    bush only: colour of small fruit/flowers, or null for none
//   fruits   bush only: how many fruit/flowers
//   fronds   palm only: how many long leaves
//
// How it looks real but stays fast: every plant is a few thin stems plus
// many small flat "leaf cards". Each card is a picture of a twig with real
// leaf shapes, drawn in code with see-through gaps between the leaves. All
// plants of one type and one design (VARIANTS per type) are one draw call.

import * as THREE from 'three';

export const PLANT_TYPES = [
  { id: 'cheeku',  name: 'Cheeku',  shape: 'bush', height: 0.68, leaf: 0x3f5f2c, leafLight: 0x6f8c45, trunk: 0x6b4c33, leafLen: 1.0,  leafWid: 0.36, stems: 1, width: 0.95, fruit: 0x8a5d3b, fruits: 3 },
  { id: 'khajoor', name: 'Khajoor', shape: 'palm', height: 0.72, leaf: 0x6f8458, leafLight: 0x9cab7a, trunk: 0x8a6b4a, fronds: 10 },
  { id: 'anar',    name: 'Anar',    shape: 'bush', height: 0.64, leaf: 0x5c7d2e, leafLight: 0x93ad52, trunk: 0x7a5d40, leafLen: 0.75, leafWid: 0.2,  stems: 5, width: 0.72, fruit: 0xc2412c, fruits: 5 },
];

export const VARIANTS = 3;             // different designs per type, so neighbours do not look alike

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
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
function mix(a, b, t) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

// ---------- Texture atlas, one per plant type (256 x 512, drawn in code) ----------
// Top half: leaf picture (see-through around the leaves).
// Then: soil of the basin (thaala), bark, and fruit colour.
const REG = {
  leaf:  { u0: 0.004, u1: 0.996, v0: 0.502, v1: 0.998 },
  basin: { u0: 0.01,  u1: 0.99,  v0: 0.26,  v1: 0.49 },
  bark:  { u0: 0.01,  u1: 0.49,  v0: 0.01,  v1: 0.24 },
  fruit: { u0: 0.51,  u1: 0.99,  v0: 0.01,  v1: 0.24 },
};

// One leaf: pointed oval with a gradient and a lighter middle vein.
function drawLeaf(ctx, x, y, len, wid, angle, dark, light) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.25, -wid, len * 0.75, -wid * 0.8, len, 0);
  ctx.bezierCurveTo(len * 0.75, wid * 0.8, len * 0.25, wid, 0, 0);
  const g = ctx.createLinearGradient(0, -wid, 0, wid);
  g.addColorStop(0, light);
  g.addColorStop(0.55, dark);
  g.addColorStop(1, mix(dark, 0x1c2a12, 0.35));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(225,235,190,0.45)';
  ctx.lineWidth = Math.max(0.8, wid * 0.09);
  ctx.beginPath();
  ctx.moveTo(1, 0);
  ctx.lineTo(len * 0.92, 0);
  ctx.stroke();
  ctx.restore();
}

function drawTwig(ctx, t, rand) {
  // A twig from the bottom middle to the top, leaves on both sides.
  const L = 70 * t.leafLen + 18, W = L * t.leafWid;
  ctx.strokeStyle = hex(t.trunk);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(128, 256);
  ctx.quadraticCurveTo(122 + rand() * 12, 140, 128, 40);
  ctx.stroke();
  const pairs = t.leafLen < 0.9 ? 9 : 4;     // cheeku: few broad leaves bunched at the tip
  for (let i = 0; i < pairs; i++) {
    const s = i / (pairs - 1);
    const y = t.leafLen < 0.9 ? 240 - s * 190 : 150 - s * 100;
    for (const side of [-1, 1]) {
      const shade = rand();
      const dark = mix(t.leaf, t.leafLight, shade * 0.35);
      const light = mix(t.leafLight, 0xe8f0c8, 0.15 + shade * 0.15);
      const ang = side * (0.55 + rand() * 0.45) - Math.PI / 2;     // up and out
      const len = L * (0.8 + rand() * 0.35) * (1 - s * 0.25);
      drawLeaf(ctx, 128 + side * 2, y, len, W * (0.85 + rand() * 0.3), ang + (side < 0 ? 0 : 0), dark, light);
    }
  }
  // Top bunch of leaves.
  for (let i = 0; i < 5; i++) {
    const ang = -Math.PI / 2 + (i - 2) * 0.5 + (rand() - 0.5) * 0.2;
    drawLeaf(ctx, 128, 46, L * (0.85 + rand() * 0.3), W, ang, mix(t.leaf, t.leafLight, 0.3), mix(t.leafLight, 0xe8f0c8, 0.25));
  }
  // A couple of small flowers on the anar-like (narrow-leaf) twig.
  if (t.fruit && t.leafWid < 0.3) {
    for (let i = 0; i < 2; i++) {
      const x = 128 + (rand() - 0.5) * 80, y = 60 + rand() * 120;
      ctx.fillStyle = hex(t.fruit);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawFrond(ctx, t, rand) {
  // Date palm leaf seen from above: middle rib left to right, narrow
  // leaflets pointing forward on both sides.
  ctx.strokeStyle = mix(t.leafLight, 0xd8d0a0, 0.4);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.stroke();
  for (let x = 14; x < 250; x += 6) {
    const s = x / 256;
    const len = 112 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.7);
    for (const side of [-1, 1]) {
      const shade = rand();
      drawLeaf(ctx, x, 128 + side * 2, len * (0.85 + rand() * 0.2), 3.2 + rand(),
        side * (1.05 + rand() * 0.15) - side * 0.1, mix(t.leaf, t.leafLight, shade * 0.5),
        mix(t.leafLight, 0xeef0d0, 0.2));
    }
  }
}

function makeAtlas(t) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const ctx = c.getContext('2d');
  const rand = rng(t.id.length * 977 + 3);
  ctx.clearRect(0, 0, 256, 256);
  if (t.shape === 'palm') drawFrond(ctx, t, rand); else drawTwig(ctx, t, rand);

  // Basin soil: dark wet soil in the middle, lighter dry ring at the edge.
  ctx.save();
  ctx.translate(128, 320);
  ctx.scale(1, 0.5);
  const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, 128);
  bg.addColorStop(0, '#4f3d2b');
  bg.addColorStop(0.62, '#665038');
  bg.addColorStop(0.8, '#a88c66');
  bg.addColorStop(1, '#c4a678');
  ctx.fillStyle = bg;
  ctx.fillRect(-128, -128, 256, 256);
  ctx.restore();
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(40,28,18,0.35)' : 'rgba(210,190,150,0.3)';
    ctx.fillRect(rand() * 256, 256 + rand() * 128, 2, 2);
  }

  // Bark with fine vertical streaks.
  ctx.fillStyle = hex(t.trunk);
  ctx.fillRect(0, 384, 128, 128);
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(30,20,10,0.3)' : 'rgba(220,200,170,0.2)';
    ctx.fillRect(rand() * 128, 384 + rand() * 128, 1.5, 6 + rand() * 14);
  }
  // Fruit colour with a soft highlight.
  const fg = ctx.createLinearGradient(128, 384, 256, 512);
  const fc = t.fruit || t.trunk;
  fg.addColorStop(0, mix(fc, 0xffffff, 0.25));
  fg.addColorStop(1, mix(fc, 0x000000, 0.25));
  ctx.fillStyle = fg;
  ctx.fillRect(128, 384, 128, 128);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- Geometry builder ----------
class Mesher {
  constructor() { this.p = []; this.n = []; this.uv = []; }
  vert(v, n, u, reg) {
    this.p.push(v.x, v.y, v.z);
    this.n.push(n.x, n.y, n.z);
    this.uv.push(reg.u0 + u[0] * (reg.u1 - reg.u0), reg.v0 + u[1] * (reg.v1 - reg.v0));
  }
  // Two-sided quad: front and back faces both use the given normals, so a
  // leaf seen from behind is lit the same way (no black backs).
  quad(a, b, c, d, ua, ub, uc, ud, na, nb = na, nc = na, nd = na, reg = REG.leaf) {
    this.vert(a, na, ua, reg); this.vert(b, nb, ub, reg); this.vert(c, nc, uc, reg);
    this.vert(a, na, ua, reg); this.vert(c, nc, uc, reg); this.vert(d, nd, ud, reg);
    this.vert(a, na, ua, reg); this.vert(c, nc, uc, reg); this.vert(b, nb, ub, reg);
    this.vert(a, na, ua, reg); this.vert(d, nd, ud, reg); this.vert(c, nc, uc, reg);
  }
  // Adds a three.js geometry, its uv squeezed into one atlas region.
  geo(g, reg, uvFn) {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.computeVertexNormals();
    const P = ng.attributes.position, N = ng.attributes.normal, U = ng.attributes.uv;
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      n.fromBufferAttribute(N, i);
      this.vert(v, n, uvFn ? uvFn(v) : [U.getX(i), U.getY(i)], reg);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

// A thin tapering stem from point a to point b.
function stem(m, a, b, r0, r1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  m.geo(g, REG.bark);
}

// Watered soil basin around the stem with a low earth ring (thaala).
function basin(m, R) {
  const prof = [[R, 0.002], [R * 0.86, 0.035], [R * 0.7, 0.008], [0, 0.004]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(prof, 16);
  m.geo(g, REG.basin, (v) => [0.5 + v.x / (2 * R), 0.5 + v.z / (2 * R)]);
}

// One leaf card: base at `base`, growing along `axis`, size s. Normals point
// away from the crown centre, so the crown is lit like a soft round shape.
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _t = new THREE.Vector3();
function leafCard(m, base, axis, s, centre, rand) {
  _y.copy(axis).normalize();
  _t.set(rand() - 0.5, rand() - 0.5, rand() - 0.5);
  _x.crossVectors(_y, _t).normalize();
  if (_x.lengthSq() < 0.1) _x.set(1, 0, 0);
  const hx = _x.clone().multiplyScalar(s / 2);
  const top = _y.clone().multiplyScalar(s);
  const a = base.clone().sub(hx), b = base.clone().add(hx);
  const c = b.clone().add(top), d = a.clone().add(top);
  const nrm = (p) => p.clone().sub(centre).normalize().addScaledVector(UP, 0.6).normalize();
  m.quad(a, b, c, d, [0, 0], [1, 0], [1, 1], [0, 1], nrm(a), nrm(b), nrm(c), nrm(d));
}

function randomDir(rand) {
  const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
  return new THREE.Vector3(r * Math.cos(a), u, r * Math.sin(a));
}

function buildBush(t, rand) {
  const m = new Mesher();
  basin(m, 0.36);
  const H = 1;
  const R = (t.width * H) / 2;
  const crowns = [];                                  // [centre, radius]
  if (t.stems <= 1) {
    const top = new THREE.Vector3((rand() - 0.5) * 0.04, H * 0.35, (rand() - 0.5) * 0.04);
    stem(m, new THREE.Vector3(0, 0, 0), top, 0.028, 0.02);
    const c = new THREE.Vector3(0, H - R * 0.95, 0);
    // A few branches from the stem top into the crown.
    for (let i = 0; i < 4; i++) {
      const tip = c.clone().addScaledVector(randomDir(rand), R * 0.55);
      tip.y = Math.max(tip.y, top.y + 0.08);
      stem(m, top, tip, 0.016, 0.006);
    }
    crowns.push([c, R]);
  } else {
    for (let i = 0; i < t.stems; i++) {
      const a = (i / t.stems) * Math.PI * 2 + rand() * 0.7;
      const spread = i === 0 ? 0 : R * (0.45 + rand() * 0.3);
      const r = R * (i === 0 ? 0.6 : 0.48 + rand() * 0.12);
      const c = new THREE.Vector3(Math.cos(a) * spread, i === 0 ? H - r : H * (0.42 + rand() * 0.22), Math.sin(a) * spread);
      stem(m, new THREE.Vector3((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.04), c, 0.014, 0.006);
      crowns.push([c, r]);
    }
  }
  // Leaf cards spread through each crown, bigger on the outside.
  const cardSize = 0.26 * t.leafLen + 0.06;
  for (const [c, r] of crowns) {
    const n = Math.round(18 + (r / R) * 30);
    for (let i = 0; i < n; i++) {
      const dir = randomDir(rand);
      if (dir.y < -0.55) dir.y *= -0.5;              // fewer leaves underneath
      const base = c.clone().addScaledVector(dir, r * (0.2 + rand() * 0.45));
      const axis = dir.clone().multiplyScalar(0.9).addScaledVector(UP, 0.45)
        .add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.5));
      leafCard(m, base, axis, cardSize * (0.8 + rand() * 0.35) * Math.min(1.15, r / R + 0.45), c, rand);
    }
  }
  if (t.fruit) {
    for (let i = 0; i < t.fruits; i++) {
      const [c, r] = crowns[i % crowns.length];
      const p = c.clone().addScaledVector(randomDir(rand), r * 0.8);
      const g = new THREE.IcosahedronGeometry(0.028, 1);
      g.translate(p.x, Math.max(0.25, p.y - 0.05), p.z);
      m.geo(g, REG.fruit);
    }
  }
  return m.build();
}

// One date palm leaf: a strip that rises then bends down, the leaflet
// picture mapped along it, folded in a slight V.
function frond(m, yaw, len, hw, rise, droop, y0) {
  const N = 8;
  const rot = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  const pt = (s, side) => {
    const w = hw * Math.min(1, s * 4) * side;
    return new THREE.Vector3(s * len, y0 + rise * s - droop * s * s + Math.abs(w) * 0.25, w).applyQuaternion(rot);
  };
  const nrm = UP.clone();
  for (let i = 0; i < N; i++) {
    const s0 = i / N, s1 = (i + 1) / N;
    for (const side of [-1, 1]) {
      const a = pt(s0, 0), b = pt(s1, 0), c = pt(s1, side), d = pt(s0, side);
      const vEdge = side > 0 ? 1 : 0;
      m.quad(a, b, c, d, [s0, 0.5], [s1, 0.5], [s1, vEdge], [s0, vEdge], nrm);
    }
  }
}

function buildPalm(t, rand) {
  const m = new Mesher();
  basin(m, 0.36);
  const trunkH = 0.3 + rand() * 0.06;
  // Short, thick-based trunk covered in the stubs of old leaf stalks.
  const g = new THREE.CylinderGeometry(0.028, 0.05, trunkH, 7, 5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = Math.round((p.getY(i) / trunkH + 0.5) * 5) % 2 ? 1.2 : 1;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  g.translate(0, trunkH / 2, 0);
  m.geo(g, REG.bark);

  for (let i = 0; i < t.fronds; i++) {
    const young = i < 3;                            // new leaves stand up in the middle
    const yaw = (i / t.fronds) * Math.PI * 2 + rand() * 0.5;
    const len = young ? 0.4 + rand() * 0.08 : 0.55 + rand() * 0.15;
    frond(m, yaw, len, young ? 0.1 : 0.14, young ? 0.55 : 0.3 + rand() * 0.1,
      young ? 0.1 : 0.5 + rand() * 0.25, trunkH - 0.03);
  }
  return m.build();
}

// One geometry per plant type and design, scaled to exactly 1 m tall
// (each plant is then scaled to its own height).
export function buildPlantGeometry(t, variant = 0) {
  const rand = rng(t.id.length * 131 + variant * 7919 + 11);
  const geo = t.shape === 'palm' ? buildPalm(t, rand) : buildBush(t, rand);
  geo.computeBoundingBox();
  const s = 1 / geo.boundingBox.max.y;
  geo.scale(s, s, s);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// One material per type (its own leaf picture). The see-through parts of the
// leaf picture are cut out (alphaTest), also in the shadows.
const materials = {};
export function plantMaterial(t) {
  if (!materials[t.id]) {
    materials[t.id] = new THREE.MeshLambertMaterial({ map: makeAtlas(t), alphaTest: 0.45 });
  }
  return materials[t.id];
}
