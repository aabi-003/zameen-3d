import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLANT_TYPES, VARIANTS, MIN_HEIGHT, MAX_HEIGHT, buildPlantGeometry, plantMaterial } from './plants.js';

// ---------- Settings ----------
const PLOT_SIZE = 127;          // metres; 4 acres ~ 127 m x 127 m
const HALF = PLOT_SIZE / 2;

const WALL_HEIGHT = 2.0;        // right-side wall
const WALL_THICKNESS = 0.4;

const PILLAR_HEIGHT = 1.8;      // fence on the other three sides
const PILLAR_SIZE = 0.15;
const PILLAR_SPACING = 3;       // target gap; adjusted slightly to fit the side exactly
const WIRE_HEIGHTS = [0.5, 1.0, 1.5];
const GATE_PILLARS = 3;         // pillars left out in the front = entrance gate
const GATE_SHIFT = -1;          // move the gate by whole pillars: -1 = one pillar toward the baag (left) side
const WIRE_THICKNESS = 0.015;   // thicker than real wire so it stays visible on a phone

// The land is built in code below. Set this to true (and add the file) to
// show a Blender-made model instead; the loader code is kept for that.
const USE_GLB_MODEL = false;
const MODEL_URL = './models/zameen.glb';

const MAX_PIXEL_RATIO = 2;      // cap for phone GPUs
const MIN_PIXEL_RATIO = 1;

// Colours picked from the reference photos.
const SKY_TOP = 0x8fb2d8;
const SKY_HORIZON = 0xdde5ea;
const SOIL_TONES = [0xd8bc86, 0xc4a678, 0xa48e72, 0xcbbfa6]; // sand, tan, grey-brown clay, pale crust
const OUTSIDE_SOIL = 0xb7a88c;

const canvas = document.getElementById('view');
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
let pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Soft shadows. Nothing in the scene moves, so the shadow map is drawn once
// and reused; after that shadows cost almost nothing per frame.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_HORIZON);
scene.fog = new THREE.Fog(SKY_HORIZON, 600, 2600);   // far ground fades into the sky

const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 4000);

// ---------- Sky and sunlight ----------
function makeSky() {
  const geo = new THREE.SphereGeometry(3000, 24, 12);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(SKY_TOP);
  const horizon = new THREE.Color(SKY_HORIZON);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i) / 3000);          // 0 at horizon, 1 overhead
    c.copy(horizon).lerp(top, Math.pow(h, 0.55));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  sky.renderOrder = -1;
  return sky;
}
scene.add(makeSky());

scene.add(new THREE.HemisphereLight(0xdfeaf5, 0xb39c78, 1.5));

// Sun comes from the front-left, so the inside face of the wall is lit and
// the pillars throw shadows across the land.
const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
sun.position.set(-110, 95, 80);
sun.castShadow = true;
{
  const mem = navigator.deviceMemory || 4;
  const big = renderer.capabilities.maxTextureSize >= 4096 && mem >= 4;
  sun.shadow.mapSize.setScalar(big ? 4096 : 2048);
  const cam = sun.shadow.camera;
  cam.left = -98; cam.right = 98; cam.top = 98; cam.bottom = -98;
  cam.near = 10; cam.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2.5;
}
scene.add(sun, sun.target);

// ---------- Small random helpers (fixed seed, so the land looks the same every time) ----------
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 2D value noise, 0..1.
function makeNoise(seed) {
  const rand = mulberry32(seed);
  const N = 64;
  const grid = new Float32Array(N * N);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const at = (x, y) => grid[((y % N + N) % N) * N + ((x % N + N) % N)];
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    let fx = x - x0, fy = y - y0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

// Fine grain: adds per-pixel light/dark speckle to whatever is already drawn.
function addGrain(ctx, w, h, rand, amount) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

// Draws a soft blob that wraps around the edges, so the texture tiles without seams.
function wrappedBlob(ctx, w, h, x, y, r, color) {
  for (const ox of [-w, 0, w]) {
    for (const oy of [-h, 0, h]) {
      if (x + ox + r < 0 || x + ox - r > w || y + oy + r < 0 || y + oy - r > h) continue;
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
}

// ---------- Textures ----------
// Dry soil detail (close-up grain, clods and small stones). It is nearly
// white on purpose: the real colour comes from the ground's vertex colours.
function makeSoilTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const rand = mulberry32(11);
    ctx.fillStyle = '#f3f0e9';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {          // small clods and stones
      const dark = rand() < 0.65;
      wrappedBlob(ctx, w, h, rand() * w, rand() * h, 1 + rand() * 2.6,
        dark ? `rgba(95,80,62,${0.2 + rand() * 0.3})` : `rgba(255,250,235,${0.3 + rand() * 0.3})`);
    }
    addGrain(ctx, w, h, rand, 30);
  });
}

// Block wall like the photo: grey-brown blocks in rows, darker joints.
// One tile is 8 blocks wide and 8 rows high (3.2 m x 1.6 m).
const WALL_TILE_W = 3.2;
const WALL_TILE_H = 1.6;
function makeWallTexture() {
  return canvasTexture(512, 256, (ctx, w, h) => {
    const rand = mulberry32(23);
    const bw = w / 8, bh = h / 8;
    ctx.fillStyle = '#5f564c';                // mortar joints
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) {
      const shift = row % 2 ? bw / 2 : 0;     // every second row is offset by half a block
      for (let col = -1; col < 8; col++) {
        const v = rand();
        const r = 126 + v * 24, g = 116 + v * 22, b = 104 + v * 20;
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.fillRect(col * bw + shift + 1.5, row * bh + 1.5, bw - 3, bh - 3);
      }
    }
    for (let i = 0; i < 25; i++) {            // faint weather stains
      wrappedBlob(ctx, w, h, rand() * w, rand() * h, 30 + rand() * 60,
        `rgba(70,62,54,${0.03 + rand() * 0.05})`);
    }
    addGrain(ctx, w, h, rand, 26);
  });
}

function makeConcreteTexture() {
  return canvasTexture(64, 256, (ctx, w, h) => {
    const rand = mulberry32(37);
    ctx.fillStyle = '#bdbab2';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) {
      wrappedBlob(ctx, w, h, rand() * w, rand() * h, 6 + rand() * 20,
        rand() < 0.5 ? 'rgba(90,90,88,0.12)' : 'rgba(255,255,250,0.14)');
    }
    addGrain(ctx, w, h, rand, 22);
  });
}

// ---------- Land ----------
// A box whose texture is measured in metres, so blocks keep their real size
// on every face (the default box stretches one image over each face).
function metricBox(w, h, d, tileW, tileH) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (Math.abs(nor.getX(i)) > 0.5) { u = z; v = y; }
    else if (Math.abs(nor.getY(i)) > 0.5) { u = z; v = x; }
    else { u = x; v = y; }
    uv.setXY(i, u / tileW, v / tileH);
  }
  return geo;
}

const SOIL_TILE = 7;                                   // one soil tile covers 7 m
const soilTexture = makeSoilTexture();

function makeGround() {
  const SEG = 96;
  const geo = new THREE.PlaneGeometry(PLOT_SIZE, PLOT_SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  // Uneven colour: blend the photo's soil tones with smooth noise.
  const big = makeNoise(101), mid = makeNoise(202), small = makeNoise(303);
  const tones = SOIL_TONES.map((hex) => new THREE.Color(hex));
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const a = big(x / 34, z / 34) * 0.6 + mid(x / 11, z / 11) * 0.4;     // sand <-> tan
    const clay = THREE.MathUtils.smoothstep(mid(x / 19 + 40, z / 19 + 40), 0.5, 0.8);
    const crust = THREE.MathUtils.smoothstep(big(x / 27 + 90, z / 27 + 90), 0.58, 0.85);
    c.copy(tones[0]).lerp(tones[1], a);
    c.lerp(tones[2], clay * 0.75);
    c.lerp(tones[3], crust * 0.6);
    c.multiplyScalar(0.92 + small(x / 3.1, z / 3.1) * 0.16);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const tex = soilTexture.clone();
  tex.repeat.set(PLOT_SIZE / SOIL_TILE, PLOT_SIZE / SOIL_TILE);
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }));
  ground.receiveShadow = true;
  ground.name = 'ground';
  return ground;
}

// Plain land around the plot, so the plot does not float in the sky.
function makeOutside() {
  const geo = new THREE.CircleGeometry(3000, 48);
  geo.rotateX(-Math.PI / 2);
  const tex = soilTexture.clone();
  tex.repeat.set(6000 / SOIL_TILE, 6000 / SOIL_TILE);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: OUTSIDE_SOIL, map: tex }));
  mesh.position.y = -0.03;
  mesh.receiveShadow = true;
  mesh.name = 'outside';
  return mesh;
}

// Right side (seen from the entrance at the front, +Z): wall along the full side.
function makeWall() {
  const geo = metricBox(WALL_THICKNESS, WALL_HEIGHT, PLOT_SIZE, WALL_TILE_W, WALL_TILE_H);
  const wall = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: makeWallTexture() }));
  wall.position.set(HALF - WALL_THICKNESS / 2, WALL_HEIGHT / 2, 0);
  wall.castShadow = true;
  wall.receiveShadow = true;
  wall.name = 'wall';
  return wall;
}

// Other three sides: concrete pillars joined by three lines of wire.
function makeFence() {
  const group = new THREE.Group();
  group.name = 'fence';

  const gaps = Math.round(PLOT_SIZE / PILLAR_SPACING);
  const step = PLOT_SIZE / gaps;                        // ~3.02 m
  const spots = [];
  // Entrance gate: GATE_PILLARS pillars are left out in the middle of the front.
  const gateFirst = Math.round(gaps / 2) - Math.floor(GATE_PILLARS / 2) + GATE_SHIFT;
  const gateLast = gateFirst + GATE_PILLARS - 1;
  const gateLeftX = -HALF + (gateFirst - 1) * step;     // last pillar before the gate
  const gateRightX = -HALF + (gateLast + 1) * step;     // first pillar after the gate
  for (let i = 0; i < gaps; i++) {                      // front and back; the wall closes the right end
    if (i < gateFirst || i > gateLast) spots.push([-HALF + i * step, HALF]);
    spots.push([-HALF + i * step, -HALF]);
  }
  for (let i = 1; i < gaps; i++) spots.push([-HALF, -HALF + i * step]);   // left side

  const pillarGeo = new THREE.BoxGeometry(PILLAR_SIZE, PILLAR_HEIGHT, PILLAR_SIZE);
  const pillarMat = new THREE.MeshLambertMaterial({ map: makeConcreteTexture() });
  const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z], i) => {
    m.makeTranslation(x, PILLAR_HEIGHT / 2, z);
    pillars.setMatrixAt(i, m);
  });
  pillars.castShadow = true;
  pillars.receiveShadow = true;
  pillars.name = 'pillars';
  group.add(pillars);

  // Each wire is one long thin bar per stretch (all drawn in one call).
  const wireEndX = HALF - WALL_THICKNESS;               // wires stop at the wall
  const alongX = (x0, x1, z) => ({ x: (x0 + x1) / 2, z, sx: x1 - x0, sz: WIRE_THICKNESS });
  const runs = [
    alongX(-HALF, gateLeftX, HALF),                     // front, left of the gate
    alongX(gateRightX, wireEndX, HALF),                 // front, right of the gate
    alongX(-HALF, wireEndX, -HALF),                     // back
    { x: -HALF, z: 0, sx: WIRE_THICKNESS, sz: PLOT_SIZE },
  ];
  const wires = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0x70716f }),
    runs.length * WIRE_HEIGHTS.length,
  );
  const s = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Quaternion();
  let n = 0;
  for (const run of runs) {
    for (const y of WIRE_HEIGHTS) {
      m.compose(p.set(run.x, y, run.z), q, s.set(run.sx, WIRE_THICKNESS, run.sz));
      wires.setMatrixAt(n++, m);
    }
  }
  wires.name = 'wires';
  group.add(wires);

  return group;
}

function makeLand() {
  const land = new THREE.Group();
  land.name = 'land';
  land.add(makeOutside(), makeGround(), makeWall(), makeFence());
  return land;
}

let land = makeLand();
scene.add(land);
renderer.shadowMap.needsUpdate = true;

// ---------- Controls ----------
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;      // smooth, eased movement
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.7;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.9;
controls.screenSpacePanning = false;            // pan slides along the ground
controls.maxPolarAngle = Math.PI / 2 - 0.04;    // stop just above the horizon
controls.zoomToCursor = true;
controls.minDistance = 2;
controls.maxDistance = PLOT_SIZE * 3;

// Area the look-at point may move in; updated if a GLB model is loaded.
const bounds = new THREE.Box3(
  new THREE.Vector3(-HALF, 0, -HALF),
  new THREE.Vector3(HALF, 0, HALF),
);
let groundY = 0;

// Keep the look-at point on the land (camera shifts with it, so the view
// stops at the edge instead of twisting). The camera itself stays above
// ground because the target sits on the ground and maxPolarAngle < 90 deg.
function clampView() {
  const t = controls.target;
  const x = THREE.MathUtils.clamp(t.x, bounds.min.x, bounds.max.x);
  const z = THREE.MathUtils.clamp(t.z, bounds.min.z, bounds.max.z);
  camera.position.x += x - t.x;
  camera.position.y += groundY - t.y;
  camera.position.z += z - t.z;
  t.set(x, groundY, z);
}

// Default view: "top-front". The camera is in front of the gate and raised,
// looking down at the land at a medium angle (not straight down, not flat).
// It backs away just far enough for the whole plot, gate included, to fit
// the screen, so it works on both tall and wide screens.
const HOME_TILT_DEG = 35;       // 0 = flat from the front, 90 = straight down
function homeView() {
  const tilt = THREE.MathUtils.degToRad(HOME_TILT_DEG);
  const corners = [[-HALF, HALF], [HALF, HALF], [-HALF, -HALF], [HALF, -HALF]];
  const v = new THREE.Vector3();
  controls.target.set(0, 0, 0);
  for (let dist = 60; dist <= controls.maxDistance; dist += 4) {
    camera.position.set(0, Math.sin(tilt) * dist, Math.cos(tilt) * dist);
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
    const fits = corners.every(([x, z]) => {
      v.set(x, 0, z).project(camera);
      return Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.85;
    });
    if (fits) break;
  }
  controls.update();
  requestRender();
}

// Whole-model view, used when a GLB model replaces the built-in land.
function frameBounds() {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 10);
  const dist = span * (camera.aspect < 1 ? 2.5 : 1.15);
  controls.maxDistance = span * 3;
  controls.target.set(center.x, groundY, center.z);
  camera.position.set(center.x - dist * 0.22, groundY + dist * 0.55, center.z + dist * 0.75);
  controls.update();
  requestRender();
}

let resetView = homeView;

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      [].concat(o.material).forEach((mat) => {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      });
    }
  });
}

// ---------- GLB model (kept for later use; off while USE_GLB_MODEL is false) ----------
function showStatus(text, autoHideMs) {
  statusEl.textContent = text;
  statusEl.classList.remove('hidden');
  if (autoHideMs) setTimeout(() => statusEl.classList.add('hidden'), autoHideMs);
}

function loadModel() {
  showStatus('Model load ho raha hai…');
  new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
      const model = gltf.scene;
      model.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      scene.add(model);
      scene.remove(land);
      disposeTree(land);
      land = null;

      const box = new THREE.Box3().setFromObject(model);
      groundY = box.min.y;
      bounds.min.set(box.min.x, groundY, box.min.z);
      bounds.max.set(box.max.x, groundY, box.max.z);

      renderer.shadowMap.needsUpdate = true;
      resetView = frameBounds;
      resetView();
      statusEl.classList.add('hidden');
    },
    undefined,
    () => showStatus('Model load nahi hua, code wali zameen dikha rahe hain', 4000),
  );
}

// ---------- Render loop (draws only when something changed, saves battery) ----------
let needsRender = true;
function requestRender() { needsRender = true; }

controls.addEventListener('change', () => {
  clampView();
  requestRender();
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 62 : 50;       // wider view on a tall phone screen
  camera.updateProjectionMatrix();
  requestRender();
}
window.addEventListener('resize', resize);

// If the phone cannot keep up while the camera moves, lower the resolution a
// step at a time (never below MIN_PIXEL_RATIO). It is not raised again.
let lastTime = 0, slowFrames = 0, movingFrames = 0;
function watchSpeed(now) {
  const dt = now - lastTime;
  lastTime = now;
  if (dt > 200) { movingFrames = 0; slowFrames = 0; return; }   // first frame after a pause
  movingFrames++;
  if (dt > 26) slowFrames++;                                    // slower than ~38 fps
  if (movingFrames >= 40) {
    if (slowFrames > 20 && pixelRatio > MIN_PIXEL_RATIO) {
      pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
    }
    movingFrames = 0; slowFrames = 0;
  }
}

function tick(now) {
  if (!drag) controls.update(); // advances damping; fires 'change' while moving (locked while dragging)
  if (needsRender) {
    needsRender = false;
    watchSpeed(now);
    updateMarkers();
    renderer.render(scene, camera);
  }
}
renderer.setAnimationLoop(tick);

// =====================================================================
// ---------- Phase 3: placeable objects (plants, pools, khet) ----------
// =====================================================================
// Seen from the entrance (front = +Z): left half (-X) is the orchard,
// right half (+X) has the khet and two pools.
const FT = 0.3048;                    // 1 ft in metres
const GAP = 10 * FT;                  // between objects, and from the boundary
const PLANT_GAP = 5 * FT;             // between two plants
const ORCHARD_SPACING = 20 * FT;      // plant distance in the default orchard
const EPS = 0.005;                    // 5 mm allowance for rounding
const AREA = {                        // where objects may stand (10 ft inside the boundary)
  minX: -HALF + GAP,
  maxX: HALF - WALL_THICKNESS - GAP,  // right side: measured from the inside of the wall
  minZ: -HALF + GAP,
  maxZ: HALF - GAP,
};
const RATIO = { khet: 2, bigPool: 1.5, smallPool: 0.5 };   // by area, right half
const LAYOUT_KEY = 'zameen3d-layout-v1';
const LAYOUT_VERSION = 3;            // 3: kamra and 2 solar stands at the gate, 3 baag rows free

const POOL_EDGE = 0.6;                // concrete edge width (m)
const POOL_EDGE_H = 0.28;             // edge top above the ground
const WATER_Y = 0.12;                 // water surface height
const CROP_ROW_SPACING = 0.9;         // metres between crop rows

// Kamra (small room) and two solar stands: three separate objects, placed
// in the baag right next to the gate, on its left (seen from inside).
const ROOM_W = 12 * FT;               // room 12 ft x 10 ft, 10 ft high
const ROOM_D = 10 * FT;
const ROOM_H = 10 * FT;
const PANEL_W = 1.3;                  // one large solar panel (m), long side up the slope
const PANEL_L = 2.38;
const PANEL_TILT_DEG = 30;            // panels face the front (+Z)
const PANEL_GAP = 0.02;
const SOLAR_BACK_H = ROOM_H;          // back legs are as tall as the room
const SOLAR_W = 2 * PANEL_W + PANEL_GAP + 0.1;                        // footprint of one stand
const SOLAR_D = PANEL_L * Math.cos(THREE.MathUtils.degToRad(PANEL_TILT_DEG)) + 0.25;
const CAR_W = 1.8;                    // white car (m), nose toward the front fence
const CAR_L = 4.5;
const TRACK_W = 3.0;                  // kacha (dirt) track width
const ORCHARD_ROWS_FREE = 3;          // front rows of the baag left empty for the room and solar

// Gate opening (x of the last pillar left of it and the first one right of
// it); the fence code uses the same numbers.
function gateEdges() {
  const gaps = Math.round(PLOT_SIZE / PILLAR_SPACING);
  const step = PLOT_SIZE / gaps;
  const first = Math.round(gaps / 2) - Math.floor(GATE_PILLARS / 2) + GATE_SHIFT;
  return { left: -HALF + (first - 1) * step, right: -HALF + (first + GATE_PILLARS) * step };
}

// ---------- Default layout ----------
// Right half, from the entrance going back: big pool, small pool, khet (all
// full width, long side left-right). Pool and khet areas are exactly
// 2 : 1.5 : 0.5 with 10 ft gaps.
// Left half (baag), at the front next to the gate: kamra, then two solar
// stands, 10 ft apart, where the first rows of plants were.
function rectSizes() {
  const x0 = GAP / 2, x1 = AREA.maxX, W = x1 - x0;
  const z0 = AREA.minZ, z1 = AREA.maxZ;
  const total = RATIO.khet + RATIO.bigPool + RATIO.smallPool;
  const L = z1 - z0 - 2 * GAP;                                // depth left after two gaps
  const Db = (L * RATIO.bigPool) / total;
  const Ds = (L * RATIO.smallPool) / total;
  const Dk = (L * RATIO.khet) / total;
  const out = {
    bigPool:   { w: W, d: Db, x: x0 + W / 2, z: z1 - Db / 2 },
    smallPool: { w: W, d: Ds, x: x0 + W / 2, z: z1 - Db - GAP - Ds / 2 },
    khet:      { w: W, d: Dk, x: x0 + W / 2, z: z0 + Dk / 2 },
  };
  const gl = gateEdges().left;
  const zf = AREA.maxZ;                                       // 10 ft inside the front fence
  const kx = gl - ROOM_W / 2;                                 // room edge in line with the gate pillar
  const s1 = kx - ROOM_W / 2 - GAP - SOLAR_W / 2;
  const s2 = s1 - SOLAR_W - GAP;
  out.kamra =  { w: ROOM_W,  d: ROOM_D,  x: kx, z: zf - ROOM_D / 2 };
  out.solar1 = { w: SOLAR_W, d: SOLAR_D, x: s1, z: zf - SOLAR_D / 2 };
  out.solar2 = { w: SOLAR_W, d: SOLAR_D, x: s2, z: zf - SOLAR_D / 2 };
  // Car parked in the corner next to Solar 2 (10 ft away), at the end of the track.
  out.gaadi = { w: CAR_W, d: CAR_L, x: s2 - SOLAR_W / 2 - GAP - CAR_W / 2 - 0.1, z: zf - CAR_L / 2 };
  return out;
}
const RECT_DEFAULTS = rectSizes();

function defaultPlants() {
  // Left half, a grid about 20 ft apart, cheeku / anar / khajoor row by row.
  const x0 = AREA.minX, x1 = -GAP / 2, z0 = AREA.minZ, z1 = AREA.maxZ;
  const cols = Math.floor((x1 - x0) / ORCHARD_SPACING) + 1;
  const rows = Math.floor((z1 - z0) / ORCHARD_SPACING) + 1;
  const order = ['cheeku', 'anar', 'khajoor'].filter((id) => PLANT_BY_ID[id]);
  const list = [];
  for (let r = ORCHARD_ROWS_FREE; r < rows; r++) {          // front rows: room and solar
    for (let c = 0; c < cols; c++) {
      list.push({
        kind: 'plant',
        type: order.length ? order[(r - ORCHARD_ROWS_FREE) % order.length] : PLANT_TYPES[0].id,
        x: x0 + (c * (x1 - x0)) / (cols - 1),
        z: z1 - (r * (z1 - z0)) / (rows - 1),
        s: r * cols + c + 1,
      });
    }
  }
  return list;
}
// Old saved layouts: plants in front of this line (in the baag) are dropped,
// because the room and solar stands now stand there.
function orchardFrontLimit() {
  const z0 = AREA.minZ, z1 = AREA.maxZ;
  const rows = Math.floor((z1 - z0) / ORCHARD_SPACING) + 1;
  const step = (z1 - z0) / (rows - 1);
  return z1 - (ORCHARD_ROWS_FREE - 0.5) * step;
}

// ---------- Textures for pools and khet (made in code) ----------
function makeWaterTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const rand = mulberry32(51);
    ctx.fillStyle = '#e4f1f8';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {             // soft ripples
      ctx.save();
      const x = rand() * w, y = rand() * h;
      ctx.translate(x, y);
      ctx.scale(1, 0.35);
      for (const ox of [-w, 0, w]) {
        wrappedBlob(ctx, w, h * 3, ox, 0, 10 + rand() * 22,
          rand() < 0.5 ? 'rgba(255,255,255,0.55)' : 'rgba(150,180,200,0.35)');
      }
      ctx.restore();
    }
    addGrain(ctx, w, h, rand, 10);
  });
}

function makeTilledSoilTexture() {
  // One tile = one crop row spacing across: dark furrow, lighter ridge.
  return canvasTexture(64, 256, (ctx, w, h) => {
    const rand = mulberry32(61);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#5e4631'); g.addColorStop(0.5, '#8a6c4c'); g.addColorStop(1, '#5e4631');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      wrappedBlob(ctx, w, h, rand() * w, rand() * h, 1 + rand() * 2,
        rand() < 0.6 ? 'rgba(50,36,24,0.4)' : 'rgba(190,160,120,0.35)');
    }
    addGrain(ctx, w, h, rand, 24);
  });
}

function makeLeafTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const rand = mulberry32(71);
    ctx.fillStyle = '#4f8a32';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const v = rand();
      wrappedBlob(ctx, w, h, rand() * w, rand() * h, 2 + rand() * 4,
        v < 0.45 ? 'rgba(30,70,22,0.55)' : v < 0.85 ? 'rgba(120,175,70,0.5)' : 'rgba(170,200,90,0.5)');
    }
    addGrain(ctx, w, h, rand, 20);
  });
}

const concreteTex = makeConcreteTexture();
const waterTex = makeWaterTexture();
const tilledTex = makeTilledSoilTexture();
const leafTex = makeLeafTexture();

// ---------- Pool: concrete edge around a blue water surface ----------
function makePool(w, d) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ map: concreteTex });
  const e = POOL_EDGE, h = POOL_EDGE_H;
  for (const z of [d / 2 - e / 2, -(d / 2 - e / 2)]) {     // back and front edges
    const m = new THREE.Mesh(metricBox(w, h, e, 1.2, 1.2), mat);
    m.position.set(0, h / 2, z);
    g.add(m);
  }
  for (const x of [w / 2 - e / 2, -(w / 2 - e / 2)]) {
    const m = new THREE.Mesh(metricBox(e, h, d - 2 * e, 1.2, 1.2), mat);
    m.position.set(x, h / 2, 0);
    g.add(m);
  }
  g.children.forEach((m) => { m.castShadow = true; m.receiveShadow = true; });

  // Water: lighter (shallow) near the edges, deeper blue in the middle.
  const iw = w - 2 * e, id = d - 2 * e;
  const geo = new THREE.PlaneGeometry(iw, id, 16, 16);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const deep = new THREE.Color(0x1d6aa8), shallow = new THREE.Color(0x52b4dc), c = new THREE.Color();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const edge = Math.min(iw / 2 - Math.abs(x), id / 2 - Math.abs(z));
    c.copy(shallow).lerp(deep, THREE.MathUtils.smoothstep(edge, 0, 6));
    colors.set([c.r, c.g, c.b], i * 3);
    uv.setXY(i, x / 6, z / 6);                         // ripple tile = 6 m
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const water = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
    map: waterTex, vertexColors: true, specular: 0x9fc4dd, shininess: 70,
  }));
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  g.add(water);
  return g;
}

// ---------- Khet: tilled soil, a low earth border and green crop rows ----------
function makeKhet(w, d) {
  const g = new THREE.Group();
  const soilGeo = new THREE.PlaneGeometry(w, d);
  soilGeo.rotateX(-Math.PI / 2);
  const tex = tilledTex.clone();
  tex.repeat.set(w / CROP_ROW_SPACING, d / 8);
  const soil = new THREE.Mesh(soilGeo, new THREE.MeshLambertMaterial({ map: tex }));
  soil.position.y = 0.015;
  soil.receiveShadow = true;
  g.add(soil);

  // Earth border (mend / bund) around the field.
  const bundMat = new THREE.MeshLambertMaterial({ color: 0x9b7f5e, map: soilTexture });
  const B = 0.4, BH = 0.22;
  for (const z of [d / 2 - B / 2, -(d / 2 - B / 2)]) {
    const m = new THREE.Mesh(metricBox(w, BH, B, SOIL_TILE / 4, SOIL_TILE / 4), bundMat);
    m.position.set(0, BH / 2, z);
    g.add(m);
  }
  for (const x of [w / 2 - B / 2, -(w / 2 - B / 2)]) {
    const m = new THREE.Mesh(metricBox(B, BH, d - 2 * B, SOIL_TILE / 4, SOIL_TILE / 4), bundMat);
    m.position.set(x, BH / 2, 0);
    g.add(m);
  }

  // Crop rows: rounded green mounds running front to back, all in one draw call.
  const len = d - 2 * B - 0.8;
  const rowGeo = new THREE.CylinderGeometry(0.26, 0.26, len, 10, 1, true, Math.PI / 2, Math.PI);
  rowGeo.rotateX(Math.PI / 2);
  rowGeo.scale(1, 1.3, 1);
  const ruv = rowGeo.attributes.uv;
  for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) * 1.2, ruv.getY(i) * (len / 1.2));
  const rows = Math.floor((w - 2 * B - 0.6) / CROP_ROW_SPACING);
  const crops = new THREE.InstancedMesh(rowGeo, new THREE.MeshLambertMaterial({ map: leafTex }), rows);
  const m4 = new THREE.Matrix4();
  const startX = -((rows - 1) * CROP_ROW_SPACING) / 2;
  for (let i = 0; i < rows; i++) {
    crops.setMatrixAt(i, m4.makeTranslation(startX + i * CROP_ROW_SPACING, 0.015, 0));
  }
  crops.castShadow = true;
  crops.receiveShadow = true;
  g.add(crops);
  g.children.forEach((m) => { if (m !== soil) m.castShadow = true; m.receiveShadow = true; });
  return g;
}

// ---------- Kamra (small room) and solar stands ----------
function makeSolarTexture() {
  // 6 x 12 cells, dark blue with thin silver lines (one panel).
  return canvasTexture(128, 256, (ctx, w, h) => {
    const rand = mulberry32(81);
    ctx.fillStyle = '#c9ccd0';
    ctx.fillRect(0, 0, w, h);
    const cw = w / 6, ch = h / 12;
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 12; j++) {
        const v = rand() * 10;
        ctx.fillStyle = `rgb(${22 + v | 0},${40 + v | 0},${78 + v * 2 | 0})`;
        ctx.fillRect(i * cw + 1, j * ch + 1, cw - 2, ch - 2);
        ctx.fillStyle = 'rgba(190,200,215,0.35)';             // busbars
        ctx.fillRect(i * cw + cw * 0.33, j * ch + 1, 1, ch - 2);
        ctx.fillRect(i * cw + cw * 0.66, j * ch + 1, 1, ch - 2);
      }
    }
  });
}

function addPart(g, geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}
const steelMat = new THREE.MeshLambertMaterial({ color: 0x9ea3a8 });
const concreteMat = new THREE.MeshLambertMaterial({ map: concreteTex });

// Small block room: door on the gate side (+X), window toward the land (-Z).
function makeRoom(w, d) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z) => addPart(g, geo, mat, x, y, z);
  const T = 0.23, PL = 0.15;                         // wall thickness, plinth height
  add(new THREE.BoxGeometry(w + 0.3, PL, d + 0.3), concreteMat, 0, PL / 2, 0);   // plinth
  const wallMat = new THREE.MeshLambertMaterial({ map: makeWallTexture() });
  const wh = ROOM_H - 0.2, wy = PL + wh / 2;
  add(metricBox(w, wh, T, WALL_TILE_W, WALL_TILE_H), wallMat, 0, wy, d / 2 - T / 2);
  add(metricBox(w, wh, T, WALL_TILE_W, WALL_TILE_H), wallMat, 0, wy, -d / 2 + T / 2);
  add(metricBox(T, wh, d - 2 * T, WALL_TILE_W, WALL_TILE_H), wallMat, -w / 2 + T / 2, wy, 0);
  add(metricBox(T, wh, d - 2 * T, WALL_TILE_W, WALL_TILE_H), wallMat, w / 2 - T / 2, wy, 0);
  add(metricBox(w + 0.4, 0.18, d + 0.4, 1.2, 1.2), concreteMat, 0, PL + wh + 0.09, 0);   // roof
  // Steel door on the gate side.
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x3f5a4a });
  const fx = w / 2 + 0.02;
  add(new THREE.BoxGeometry(0.05, 2.1, 0.95), doorMat, fx, PL + 1.05, 0);
  add(new THREE.BoxGeometry(0.07, 0.06, 0.06), steelMat, fx + 0.03, PL + 1.05, 0.35);
  // Window with grill toward the land, and one toward the front.
  const glass = new THREE.MeshLambertMaterial({ color: 0x23303a });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xd9d4c7 });
  for (const zs of [-1, 1]) {
    const z = zs * (d / 2 + 0.02);
    add(new THREE.BoxGeometry(1.1, 1.0, 0.04), glass, 0, PL + 1.55, z);
    for (let i = -2; i <= 2; i++) add(new THREE.BoxGeometry(0.03, 1.0, 0.03), steelMat, i * 0.22, PL + 1.55, z + zs * 0.03);
    add(new THREE.BoxGeometry(1.2, 0.08, 0.06), frameMat, 0, PL + 2.09, z);
    add(new THREE.BoxGeometry(1.2, 0.08, 0.06), frameMat, 0, PL + 1.01, z);
  }
  return g;
}

// One solar stand: two large panels side by side on a full steel frame.
// Back legs are as tall as the room; the slope is PANEL_TILT_DEG.
let solarTex = null;
function makeSolarStand(withChhappar = false) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z) => addPart(g, geo, mat, x, y, z);
  const tilt = THREE.MathUtils.degToRad(PANEL_TILT_DEG);
  const depth = PANEL_L * Math.cos(tilt), rise = PANEL_L * Math.sin(tilt);
  const P = 0.06;                                    // steel profile size
  const backH = SOLAR_BACK_H - P;                    // top of the back legs (panels sit on rails above)
  const frontH = backH - rise;
  const zFront = depth / 2 - 0.05, zBack = -depth / 2 + 0.05;
  const legX = PANEL_W - 0.12;
  for (const lx of [-legX, 0, legX]) {
    add(new THREE.BoxGeometry(0.3, 0.15, 0.3), concreteMat, lx, 0.075, zFront);   // footings
    add(new THREE.BoxGeometry(0.3, 0.15, 0.3), concreteMat, lx, 0.075, zBack);
    add(new THREE.BoxGeometry(P, frontH, P), steelMat, lx, frontH / 2, zFront);
    add(new THREE.BoxGeometry(P, backH, P), steelMat, lx, backH / 2, zBack);
    // Slanted rail on top of the legs.
    const rail = add(new THREE.BoxGeometry(P, P, PANEL_L + 0.1), steelMat, lx, (frontH + backH) / 2, (zFront + zBack) / 2);
    rail.rotation.x = Math.atan2(backH - frontH, zFront - zBack);
    // Diagonal brace: front foot to back leg, at 3/4 height.
    const by = backH * 0.75, bl = Math.hypot(zFront - zBack, by);
    const brace = add(new THREE.BoxGeometry(P * 0.7, P * 0.7, bl), steelMat, lx, by / 2, (zFront + zBack) / 2);
    brace.rotation.x = Math.atan2(by, zFront - zBack);
  }
  // Beams joining the legs left to right, and an X brace between the back legs.
  const span = legX * 2 + P;
  add(new THREE.BoxGeometry(span, P, P), steelMat, 0, frontH - 0.05, zFront);
  add(new THREE.BoxGeometry(span, P, P), steelMat, 0, frontH * 0.4, zFront);
  add(new THREE.BoxGeometry(span, P, P), steelMat, 0, backH - 0.05, zBack);
  add(new THREE.BoxGeometry(span, P, P), steelMat, 0, backH * 0.4, zBack);
  const xl = Math.hypot(legX * 2, backH * 0.55);
  for (const sgn of [-1, 1]) {
    const xb = add(new THREE.BoxGeometry(xl, P * 0.6, P * 0.6), steelMat, 0, backH * 0.4 + backH * 0.275, zBack - 0.04);
    xb.rotation.z = sgn * Math.atan2(backH * 0.55, legX * 2);
  }

  // Panels: silver aluminium frame with the blue cell sheet on top.
  const panels = new THREE.Group();
  panels.position.set(0, (frontH + backH) / 2 + P, (zFront + zBack) / 2);
  panels.rotation.x = tilt;                          // high edge at the back, facing the front
  if (!solarTex) solarTex = makeSolarTexture();
  const cellMat = new THREE.MeshPhongMaterial({ map: solarTex, specular: 0x8899aa, shininess: 90 });
  const alu = new THREE.MeshLambertMaterial({ color: 0xc8ccd0 });
  for (const px of [-(PANEL_W + PANEL_GAP) / 2, (PANEL_W + PANEL_GAP) / 2]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(PANEL_W, 0.04, PANEL_L), alu);
    frame.position.x = px;
    frame.castShadow = true;
    const cells = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W - 0.05, PANEL_L - 0.05).rotateX(-Math.PI / 2), cellMat);
    cells.position.set(px, 0.021, 0);
    panels.add(frame, cells);
  }
  g.add(panels);

  // Chhappar: thatch (straw) walls on the back and both sides, front open,
  // tied to bamboo rails.
  if (withChhappar) {
    const thatch = new THREE.MeshLambertMaterial({ map: thatchTexture(), side: THREE.DoubleSide });
    const bamboo = new THREE.MeshLambertMaterial({ color: 0x9c8148 });
    const bx = legX + 0.08, bz = zBack - 0.08;
    const back = new THREE.PlaneGeometry(bx * 2, backH);
    scaleUV(back, bx * 2, backH / 2);
    addPart(g, back, thatch, 0, backH / 2, bz);
    const shape = new THREE.Shape([
      new THREE.Vector2(zFront, 0), new THREE.Vector2(bz, 0),
      new THREE.Vector2(bz, backH), new THREE.Vector2(zFront, frontH),
    ]);
    for (const sx of [-bx, bx]) {
      const side = new THREE.ShapeGeometry(shape);
      const uv = side.attributes.uv, pos = side.attributes.position;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i) / 2);
      side.rotateY(-Math.PI / 2);                    // shape x -> world z
      addPart(g, side, thatch, sx, 0, 0);
    }
    // Bamboo rails along the tops and the middle.
    const rail = (x0, y0, z0, x1, y1, z1) => {
      const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
      const len = a.distanceTo(b);
      const m = addPart(g, new THREE.CylinderGeometry(0.03, 0.03, len, 6), bamboo, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    };
    for (const y of [backH - 0.05, backH * 0.5]) rail(-bx, y, bz - 0.04, bx, y, bz - 0.04);
    for (const sx of [-bx - 0.04, bx + 0.04]) {
      rail(sx, backH - 0.05, bz, sx, frontH - 0.05, zFront);
      rail(sx, frontH * 0.5, bz, sx, frontH * 0.5, zFront);
    }
  }
  return g;
}

function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

// Dry straw thatch: thin golden-brown stalks, with two dark binding bands.
// One tile is 1 m wide and 2 m tall.
let thatchTex = null;
function thatchTexture() {
  if (thatchTex) return thatchTex;
  thatchTex = canvasTexture(128, 256, (ctx, w, h) => {
    const rand = mulberry32(97);
    ctx.fillStyle = '#9b7c47';
    ctx.fillRect(0, 0, w, h);
    const cols = ['#d8bb7d', '#c4a466', '#a98a52', '#e3cb92', '#8c6f3e'];
    for (let i = 0; i < 900; i++) {
      const x = rand() * w, y = rand() * h, len = 30 + rand() * 70;
      ctx.strokeStyle = cols[(rand() * cols.length) | 0];
      ctx.lineWidth = 1 + rand() * 1.2;
      ctx.beginPath();
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          ctx.moveTo(x + ox, y + oy);
          ctx.lineTo(x + ox + (rand() - 0.5) * 6, y + oy + len);
        }
      }
      ctx.stroke();
    }
    for (const y of [h * 0.25, h * 0.75]) {           // binding ropes
      ctx.fillStyle = 'rgba(70,50,25,0.75)';
      ctx.fillRect(0, y - 3, w, 6);
    }
    addGrain(ctx, w, h, rand, 18);
  });
  return thatchTex;
}

// ---------- White car (built from simple shapes) ----------
function makeCar(w, d) {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhongMaterial({ color: 0xf2f3f0, specular: 0x777777, shininess: 70 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x1b252e, specular: 0x9aaabb, shininess: 100 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c1c1c });
  const silver = new THREE.MeshLambertMaterial({ color: 0xb9bdc0 });
  const L = d - 0.1, W = w - 0.08;
  // Side outline of a sedan: x = along the car (front +), y = height.
  const extrude = (pts, depth, mat) => {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 4 });
    geo.translate(0, 0, -depth / 2);
    geo.rotateY(-Math.PI / 2);                       // length along +Z
    return addPart(g, geo, mat, 0, 0, 0);
  };
  const f = L / 2, b = -L / 2;
  extrude([[b, 0.32], [f, 0.32], [f, 0.62], [f - 0.25, 0.78], [f - 1.1, 0.86], [b + 0.8, 0.88], [b + 0.1, 0.84], [b, 0.62]], W - 0.08, paint);
  extrude([[f - 1.1, 0.86], [f - 1.75, 1.36], [b + 1.25, 1.38], [b + 0.8, 0.88]], W - 0.3, glass);
  addPart(g, new THREE.BoxGeometry(W - 0.28, 0.06, (f - 1.75) - (b + 1.25) + 0.08), paint, 0, 1.4, ((f - 1.75) + (b + 1.25)) / 2);   // roof
  addPart(g, new THREE.BoxGeometry(W - 0.26, 0.5, 0.12), paint, 0, 1.12, ((f - 1.75) + (b + 1.25)) / 2 - 0.1);                  // middle pillars
  // Wheels with silver hubs.
  const tyre = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 18).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.18, 0.18, 0.24, 12).rotateZ(Math.PI / 2);
  for (const x of [-(W / 2 - 0.1), W / 2 - 0.1]) {
    for (const z of [f - 0.85, b + 0.8]) {
      addPart(g, tyre, dark, x, 0.32, z);
      addPart(g, hub, silver, x, 0.32, z);
    }
  }
  // Lights, grille and number plates.
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  const tail = new THREE.MeshBasicMaterial({ color: 0xb3221c });
  for (const x of [-0.58, 0.58]) {
    addPart(g, new THREE.BoxGeometry(0.34, 0.1, 0.05), lamp, x, 0.64, f + 0.02);
    addPart(g, new THREE.BoxGeometry(0.3, 0.1, 0.05), tail, x, 0.7, b - 0.02);
  }
  addPart(g, new THREE.BoxGeometry(0.7, 0.14, 0.05), dark, 0, 0.5, f + 0.02);
  const plate = new THREE.MeshLambertMaterial({ color: 0xf4f1e4 });
  addPart(g, new THREE.BoxGeometry(0.5, 0.12, 0.03), plate, 0, 0.4, f + 0.05);
  addPart(g, new THREE.BoxGeometry(0.5, 0.12, 0.03), plate, 0, 0.52, b - 0.05);
  return g;
}

// ---------- Objects in the scene ----------
const objectsRoot = new THREE.Group();
objectsRoot.name = 'objects';
scene.add(objectsRoot);

const RECT_NAMES = { khet: 'Khet', bigPool: 'Bara pool', smallPool: 'Chhota pool', kamra: 'Kamra', solar1: 'Solar 1', solar2: 'Solar 2', gaadi: 'Gaadi' };
const rects = {};
for (const key of Object.keys(RECT_DEFAULTS)) {
  const { w, d, x, z } = RECT_DEFAULTS[key];
  const group = key === 'khet' ? makeKhet(w, d)
    : key === 'kamra' ? makeRoom(w, d)
    : key.startsWith('solar') ? makeSolarStand(key === 'solar2')
    : key === 'gaadi' ? makeCar(w, d)
    : makePool(w, d);
  group.name = key;
  objectsRoot.add(group);
  rects[key] = { kind: 'rect', key, w, d, x, z, group };
}
const rectList = Object.values(rects);

// =====================================================================
// ---------- Ground details: kacha track, water channels, grass ----------
// =====================================================================
// Centre line of the track: in through the gate, a rounded turn to the
// left, along behind the room and solar stands, then a short turn into the
// car's parking spot. Points every 0.5 m.
function trackPath() {
  const pts = [];
  const ge = gateEdges();
  const gx = (ge.left + ge.right) / 2;
  const kamra = RECT_DEFAULTS.kamra, car = RECT_DEFAULTS.gaadi;
  const zRun = kamra.z - kamra.d / 2 - 2.2 - TRACK_W / 2;    // 2.2 m behind the room
  const R1 = 6, R2 = 3, step = 0.5;
  const zArc = zRun + R1;
  for (let z = HALF + 5; z > zArc; z -= step) pts.push([gx, z]);
  for (let a = 0; a < Math.PI / 2; a += step / R1) pts.push([gx - R1 + R1 * Math.cos(a), zArc - R1 * Math.sin(a)]);
  const x2 = car.x + R2;
  for (let x = gx - R1; x > x2; x -= step) pts.push([x, zRun]);
  for (let a = 0; a < Math.PI / 2; a += step / R2) pts.push([x2 - R2 * Math.sin(a), zRun + R2 - R2 * Math.cos(a)]);
  for (let z = zRun + R2; z <= car.z + 0.5; z += step) pts.push([car.x, z]);
  return pts;
}
const TRACK = trackPath();

// A flat strip that follows a line of points (used for the track and channels).
function stripGeometry(pts, width, tileLen, y) {
  const pos = [], uv = [], idx = [];
  let along = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const [ax, az] = pts[Math.max(0, i - 1)], [bx, bz] = pts[Math.min(pts.length - 1, i + 1)];
    let tx = bx - ax, tz = bz - az;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    if (i > 0) along += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    const nx = -tz * width / 2, nz = tx * width / 2;
    pos.push(x + nx, y, z + nz, x - nx, y, z - nz);
    uv.push(0, along / tileLen, 1, along / tileLen);
    if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // Make every triangle face up.
  const ix = g.index.array, p = g.attributes.position;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t], b = ix[t + 1], c = ix[t + 2];
    const cross = (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a)) - (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a));
    if (cross > 0) { ix[t + 1] = c; ix[t + 2] = b; }
  }
  g.computeVertexNormals();
  return g;
}

// Texture across a strip: drawn pixel by pixel from a function of u (0..1
// across) and the row, with soft see-through edges.
function stripTexture(w, h, seed, colourAt) {
  return canvasTexture(w, h, (ctx) => {
    const rand = mulberry32(seed);
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = colourAt(x / (w - 1), y / h, rand);
        const k = (y * w + x) * 4;
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}
const edgeAlpha = (u, soft) => 255 * THREE.MathUtils.smoothstep(u, 0, soft) * THREE.MathUtils.smoothstep(1 - u, 0, soft);

// Kacha track: pressed, paler soil, two darker wheel ruts with tyre marks,
// a slightly higher middle with a little grass.
function makeTrack() {
  const tex = stripTexture(128, 256, 131, (u, v, rand) => {
    let c = [196, 176, 138];
    const rut = Math.min(Math.abs(u - 0.27), Math.abs(u - 0.73));
    if (rut < 0.075) {
      const tread = (Math.floor(v * 64) % 2) ? 0.92 : 1;
      c = [150 * tread, 127 * tread, 96 * tread];
    } else if (rut < 0.11) c = [170, 150, 115];
    if (Math.abs(u - 0.5) < 0.1 && rand() < 0.08) c = [120, 130, 70];
    const n = (rand() - 0.5) * 26;
    return [c[0] + n, c[1] + n, c[2] + n, edgeAlpha(u, 0.14)];
  });
  const mesh = new THREE.Mesh(stripGeometry(TRACK, TRACK_W, 3, 0.012), new THREE.MeshLambertMaterial({
    map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.name = 'track';
  return mesh;
}

// Water channels (naali): a main channel from the big pool along the
// middle of the land, and a branch along every row of the baag, running
// through the plants' basins.
function orchardRowsZ() {
  const z0 = AREA.minZ, z1 = AREA.maxZ;
  const rows = Math.floor((z1 - z0) / ORCHARD_SPACING) + 1;
  const out = [];
  for (let r = ORCHARD_ROWS_FREE; r < rows; r++) out.push(z1 - (r * (z1 - z0)) / (rows - 1));
  return out;
}
function line(x0, z0, x1, z1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5));
  return Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n]);
}
function makeChannels() {
  const rowsZ = orchardRowsZ();
  const zTop = rowsZ[0] + 4;
  const pool = RECT_DEFAULTS.bigPool;
  const mainPts = [...line(pool.x - pool.w / 2 + 0.3, zTop, 0.4, zTop), ...line(0, zTop - 0.4, 0, AREA.minZ)];
  const ridge = [178, 152, 112], wet = [92, 72, 52];
  const mainTex = stripTexture(64, 64, 141, (u, v, rand) => {
    const d = Math.abs(u - 0.5);
    let c = d > 0.3 ? ridge : d > 0.2 ? [120, 96, 70] : [76, 104, 118];     // ridges, wet sides, water
    if (d <= 0.2 && Math.abs(u - 0.42) < 0.03) c = [140, 168, 180];        // light on the water
    const n = (rand() - 0.5) * 16;
    return [c[0] + n, c[1] + n, c[2] + n, edgeAlpha(u, 0.2)];
  });
  const branchTex = stripTexture(64, 64, 151, (u, v, rand) => {
    const d = Math.abs(u - 0.5);
    const c = d > 0.28 ? ridge : wet;
    const n = (rand() - 0.5) * 18;
    return [c[0] + n, c[1] + n, c[2] + n, edgeAlpha(u, 0.22)];
  });
  const mat = (map) => new THREE.MeshLambertMaterial({
    map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const group = new THREE.Group();
  group.name = 'channels';
  const main = new THREE.Mesh(stripGeometry(mainPts, 0.7, 1, 0.01), mat(mainTex));
  const branches = new THREE.Mesh(
    mergeGeometries(rowsZ.map((z) => stripGeometry(line(-0.3, z, AREA.minX - 0.4, z), 0.45, 1, 0.009))),
    mat(branchTex),
  );
  for (const m of [main, branches]) { m.receiveShadow = true; m.renderOrder = 1; group.add(m); }
  return { group, mainPts, rowsZ };
}

const trackMesh = makeTrack();
const channels = makeChannels();
scene.add(trackMesh, channels.group);

// Distance from a point to the track centre line.
function trackDist(x, z) {
  let best = Infinity;
  for (const [tx, tz] of TRACK) best = Math.min(best, (tx - x) ** 2 + (tz - z) ** 2);
  return Math.sqrt(best);
}
// Objects may not stand on the track (the car may: it is parked at its end).
function onTrack(item, x, z) {
  if (item.key === 'gaadi') return false;
  if (item.kind === 'plant') return trackDist(x, z) < TRACK_W / 2 + 0.3;
  const hw = item.w / 2 + TRACK_W / 2, hd = item.d / 2 + TRACK_W / 2;
  return TRACK.some(([tx, tz]) => Math.abs(tx - x) < hw && Math.abs(tz - z) < hd);
}

// ---------- Grass tufts ----------
// Fixed spots (same every time): patches across the dry land, more along
// the fence, the middle and edges of the track, and the channel ridges.
// A tuft is hidden while a pool, khet, room, solar stand, car or plant
// basin covers its spot.
function makeGrassTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const rand = mulberry32(171);
  const cols = ['#6d8a3a', '#7f9a45', '#5f7a33', '#9aa453', '#b9ad6c', '#a89a5a'];
  for (let i = 0; i < 46; i++) {
    const x = 18 + rand() * 92, tipX = x + (rand() - 0.5) * 60, tipY = 8 + rand() * 60, wb = 2 + rand() * 2.5;
    ctx.fillStyle = cols[(rand() * cols.length) | 0];
    ctx.beginPath();
    ctx.moveTo(x - wb, 128);
    ctx.quadraticCurveTo((x + tipX) / 2, (128 + tipY) / 2 + 10, tipX, tipY);
    ctx.quadraticCurveTo((x + tipX) / 2 + wb, (128 + tipY) / 2 + 12, x + wb, 128);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeTuftGeometry() {
  // Three crossed cards, two-sided, normals up so the tuft is lit softly.
  const pos = [], nor = [], uv = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
    const P = [[-cx, 0, -cz], [cx, 0, cz], [cx, 1, cz], [-cx, 1, -cz]];
    const U = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const tri of [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]]) {
      for (const i of tri) { pos.push(...P[i]); nor.push(0, 1, 0); uv.push(...U[i]); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
const grassSpots = (() => {
  const rand = mulberry32(909);
  const noise = makeNoise(505);
  const out = [];
  const add = (x, z, big = 1) => {
    if (Math.abs(x) > HALF - 0.4 || Math.abs(z) > HALF - 0.4 || x > HALF - WALL_THICKNESS - 0.3) return;
    const h = (0.14 + rand() * 0.16) * big;
    const green = rand();
    out.push({ x, z, h, w: h * (1.1 + rand() * 0.6), rot: rand() * Math.PI,
      tint: green < 0.6 ? [0.95 + rand() * 0.15, 1, 0.9] : [1.12, 1.04, 0.82] });
  };
  for (let i = 0; i < 14000 && out.length < 2200; i++) {
    const x = (rand() * 2 - 1) * HALF, z = (rand() * 2 - 1) * HALF;
    const edge = Math.min(HALF - Math.abs(x), HALF - Math.abs(z));
    const patch = noise(x / 8 + 20, z / 8 + 20);
    const p = edge < 2 ? 0.7 : patch > 0.66 ? 0.6 : patch > 0.55 ? 0.12 : 0.012;
    if (rand() > p) continue;
    if (trackDist(x, z) < TRACK_W / 2 + 0.2) continue;        // track gets its own tufts below
    add(x, z);
  }
  TRACK.forEach(([x, z], i) => {
    if (z > HALF - 0.5) return;
    if (i % 2 === 0 && rand() < 0.75) add(x + (rand() - 0.5) * 0.3, z + (rand() - 0.5) * 0.3, 0.8);   // middle hump
    for (const side of [-1, 1]) if (rand() < 0.45) {
      const [ax, az] = TRACK[Math.max(0, i - 1)], [bx, bz] = TRACK[Math.min(TRACK.length - 1, i + 1)];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      add(x - ((bz - az) / l) * side * (TRACK_W / 2 + 0.1), z + ((bx - ax) / l) * side * (TRACK_W / 2 + 0.1));
    }
  });
  // Along the channel ridges: beside the main channel (left/right) and beside
  // each branch (front/back).
  const side = () => (rand() < 0.5 ? -1 : 1);
  for (const [x, z] of channels.mainPts) if (rand() < 0.22) add(x + side() * 0.42, z, 0.8);
  for (const z of channels.rowsZ) {
    for (const [x] of line(-0.3, z, AREA.minX - 0.4, z)) if (rand() < 0.22) add(x, z + side() * 0.3, 0.8);
  }
  return out;
})();
const grassMesh = new THREE.InstancedMesh(makeTuftGeometry(), new THREE.MeshLambertMaterial({ map: makeGrassTexture(), alphaTest: 0.5 }), grassSpots.length);
grassMesh.setColorAt(0, new THREE.Color(1, 1, 1));
grassMesh.frustumCulled = false;
grassMesh.receiveShadow = true;
grassMesh.name = 'grass';
scene.add(grassMesh);

function updateGrass() {
  // Plants on a 1 m grid, so each tuft only checks its neighbours.
  const cells = new Map();
  for (const p of plants) {
    const k = `${Math.floor(p.x)},${Math.floor(p.z)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(p);
  }
  const nearPlant = (x, z) => {
    const cx = Math.floor(x), cz = Math.floor(z);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const p of cells.get(`${cx + i},${cz + j}`) || []) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 0.45 * 0.45) return true;
    }
    return false;
  };
  let n = 0;
  const c = new THREE.Color();
  for (const s of grassSpots) {
    if (rectList.some((r) => Math.abs(s.x - r.x) < r.w / 2 + 0.25 && Math.abs(s.z - r.z) < r.d / 2 + 0.25)) continue;
    if (nearPlant(s.x, s.z)) continue;
    _gq.setFromAxisAngle(_gUp, s.rot);
    _gm.compose(_gp.set(s.x, 0, s.z), _gq, _gs.set(s.w, s.h, s.w));
    grassMesh.setMatrixAt(n, _gm);
    grassMesh.setColorAt(n, c.setRGB(...s.tint));
    n++;
  }
  grassMesh.count = n;
  grassMesh.instanceMatrix.needsUpdate = true;
  grassMesh.instanceColor.needsUpdate = true;
}
const _gm = new THREE.Matrix4(), _gq = new THREE.Quaternion(), _gp = new THREE.Vector3(), _gs = new THREE.Vector3();
const _gUp = new THREE.Vector3(0, 1, 0);

const PLANT_BY_ID = Object.fromEntries(PLANT_TYPES.map((t) => [t.id, t]));
let plants = [];

// One InstancedMesh per plant type and design; it grows if more plants are added.
const plantMeshes = {};
const meshKey = (p) => p.type + '|' + (p.s % VARIANTS);
function plantMesh(key, need) {
  let mesh = plantMeshes[key];
  if (mesh && mesh.instanceMatrix.count >= need) return mesh;
  const cap = Math.max(64, 2 ** Math.ceil(Math.log2(need + 1)));
  const [typeId, v] = key.split('|');
  const t = PLANT_BY_ID[typeId];
  const geo = mesh ? mesh.geometry : buildPlantGeometry(t, Number(v));
  if (mesh) { objectsRoot.remove(mesh); mesh.dispose(); }
  mesh = new THREE.InstancedMesh(geo, plantMaterial(t), cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));       // makes the per-plant colour buffer
  mesh.frustumCulled = false;         // instances move, so skip the whole-mesh bounds check
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'plants-' + key;
  objectsRoot.add(mesh);
  plantMeshes[key] = mesh;
  return mesh;
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _tint = new THREE.Color();
function plantLook(p) {
  // Height (2 to 2.5 ft), turn, slight lean and leaf shade come from the
  // plant's seed, so each plant keeps its own look after a reload.
  const r = mulberry32(p.s * 7919 + 17);
  const h = MIN_HEIGHT + r() * (MAX_HEIGHT - MIN_HEIGHT);
  const look = { h, rot: r() * Math.PI * 2, wide: 0.88 + r() * 0.24, leanX: (r() - 0.5) * 0.12, leanZ: (r() - 0.5) * 0.12 };
  // Mostly healthy green; some a little lighter, some slightly yellow / dusty.
  const k = r();
  const light = 0.88 + r() * 0.22;
  look.tint = k < 0.7 ? [light, light, light * 0.97]
    : k < 0.88 ? [light * 1.05, light * 1.02, light * 0.8]
    : [light * 0.95, light * 0.93, light * 0.86];
  return look;
}
const _e = new THREE.Euler();
function writePlantMatrix(p) {
  const look = p.look || (p.look = plantLook(p));
  _q.setFromEuler(_e.set(look.leanX, look.rot, look.leanZ, 'YXZ'));
  _m4.compose(_p.set(p.x, 0, p.z), _q, _s.set(look.h * look.wide, look.h, look.h * look.wide));
  const mesh = plantMeshes[p.key];
  mesh.setMatrixAt(p.slot, _m4);
  mesh.setColorAt(p.slot, _tint.setRGB(...look.tint));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
}
function refreshPlants() {
  const counts = {};
  for (const t of PLANT_TYPES) for (let v = 0; v < VARIANTS; v++) counts[t.id + '|' + v] = 0;
  for (const p of plants) { p.key = meshKey(p); counts[p.key]++; }
  for (const key of Object.keys(counts)) plantMesh(key, counts[key]).count = counts[key];
  for (const key of Object.keys(counts)) counts[key] = 0;
  for (const p of plants) { p.slot = counts[p.key]++; writePlantMatrix(p); }
  sceneChanged();
}
function placeRect(r) {
  r.group.position.set(r.x, 0, r.z);
}
function sceneChanged() {
  updateGrass();
  renderer.shadowMap.needsUpdate = true;
  requestRender();
}

// ---------- Placement rules ----------
function rectGap(ax, az, aw, ad, b) {
  const dx = Math.max(0, Math.abs(ax - b.x) - (aw + b.w) / 2);
  const dz = Math.max(0, Math.abs(az - b.z) - (ad + b.d) / 2);
  return Math.hypot(dx, dz);
}
// Returns null if the spot is allowed, otherwise a short reason.
function checkSpot(item, x, z) {
  if (onTrack(item, x, z)) return 'Kache raaste (track) par nahi rakh sakte';
  const isPlant = item.kind === 'plant';
  const hw = isPlant ? 0 : item.w / 2, hd = isPlant ? 0 : item.d / 2;
  if (x - hw < AREA.minX - EPS || x + hw > AREA.maxX + EPS ||
      z - hd < AREA.minZ - EPS || z + hd > AREA.maxZ + EPS) {
    return 'Boundary se 10 ft door rakho';
  }
  for (const r of rectList) {
    if (r === item) continue;
    if (rectGap(x, z, hw * 2, hd * 2, r) < GAP - EPS) {
      return `${RECT_NAMES[r.key]} se 10 ft door rakho`;
    }
  }
  for (const p of plants) {
    if (p === item) continue;
    if (isPlant) {
      if (Math.hypot(p.x - x, p.z - z) < PLANT_GAP - EPS) return 'Paudhe kam az kam 5 ft door hon';
    } else if (rectGap(x, z, hw * 2, hd * 2, { x: p.x, z: p.z, w: 0, d: 0 }) < GAP - EPS) {
      return 'Paudhon se 10 ft door rakho';
    }
  }
  return null;
}
function clampToArea(item, x, z) {
  const hw = item.kind === 'plant' ? 0 : item.w / 2, hd = item.kind === 'plant' ? 0 : item.d / 2;
  return [
    THREE.MathUtils.clamp(x, AREA.minX + hw, Math.max(AREA.minX + hw, AREA.maxX - hw)),
    THREE.MathUtils.clamp(z, AREA.minZ + hd, Math.max(AREA.minZ + hd, AREA.maxZ - hd)),
  ];
}

// ---------- Save / load (browser localStorage) ----------
const round2 = (v) => Math.round(v * 1000) / 1000;   // millimetres
function saveLayout() {
  const data = {
    v: LAYOUT_VERSION,
    rects: Object.fromEntries(rectList.map((r) => [r.key, [round2(r.x), round2(r.z)]])),
    plants: plants.map((p) => [p.type, round2(p.x), round2(p.z), p.s]),
  };
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ }
}
function applyDefaultLayout() {
  for (const r of rectList) { r.x = RECT_DEFAULTS[r.key].x; r.z = RECT_DEFAULTS[r.key].z; placeRect(r); }
  plants = defaultPlants();
  refreshPlants();
}
function loadLayout() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'); } catch { data = null; }
  if (!data || !(data.v >= 1 && data.v <= LAYOUT_VERSION)) { applyDefaultLayout(); return; }

  plants = [];
  for (const r of rectList) {
    // Version 1 had the pools side by side; their old places do not fit the
    // new sizes, so only the plants are kept from it.
    const s = data.v === LAYOUT_VERSION && data.rects && data.rects[r.key];
    const ok = Array.isArray(s) && Number.isFinite(s[0]) && Number.isFinite(s[1]);
    r.x = ok ? s[0] : RECT_DEFAULTS[r.key].x;
    r.z = ok ? s[1] : RECT_DEFAULTS[r.key].z;
  }
  if (rectList.some((r) => checkSpot(r, r.x, r.z))) {
    for (const r of rectList) { r.x = RECT_DEFAULTS[r.key].x; r.z = RECT_DEFAULTS[r.key].z; }
  }
  rectList.forEach(placeRect);
  let maxSeed = 0;
  const frontLimit = orchardFrontLimit();
  for (const row of Array.isArray(data.plants) ? data.plants : []) {
    if (!Array.isArray(row)) continue;
    const [type, x, z, s] = row;
    if (!PLANT_BY_ID[type] || !Number.isFinite(x) || !Number.isFinite(z)) continue;
    // Before version 3 the front rows of the baag had plants; the room and
    // solar stands stand there now.
    if (data.v !== LAYOUT_VERSION && x < 0 && z > frontLimit) continue;
    const p = { kind: 'plant', type, x, z, s: Number.isFinite(s) ? s : ++maxSeed + 100000 };
    if (checkSpot(p, x, z)) continue;           // skip a plant that breaks a rule
    plants.push(p);
    maxSeed = Math.max(maxSeed, p.s);
  }
  refreshPlants();
}
const nextSeed = () => plants.reduce((m, p) => Math.max(m, p.s), 0) + 1;

// ---------- Markers: selection ring/frame and the red cross ----------
const markerMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, depthTest: false, transparent: true, opacity: 0.95, fog: false });
const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 1, 40).rotateX(-Math.PI / 2), markerMat);
ring.renderOrder = 10;
ring.visible = false;
scene.add(ring);

const frame = new THREE.Group();            // 4 thin strips around a pool/khet
const stripGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
for (let i = 0; i < 4; i++) {
  const s = new THREE.Mesh(stripGeo, markerMat);
  s.renderOrder = 10;
  frame.add(s);
}
frame.visible = false;
scene.add(frame);

const cross = new THREE.Group();
{
  const red = new THREE.MeshBasicMaterial({ color: 0xe0201b, depthTest: false, fog: false });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, fog: false });
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.34).rotateX(-Math.PI / 2), white);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.24).rotateX(-Math.PI / 2), red);
    back.rotation.y = bar.rotation.y = a;
    back.renderOrder = 11; bar.renderOrder = 12;
    bar.position.y = 0.01;
    cross.add(back, bar);
  }
}
cross.visible = false;
scene.add(cross);
let crossTimer = 0;

let selected = null;
// Markers keep the same size on screen at any zoom.
function screenScale(x, z) {
  return camera.position.distanceTo(_p.set(x, 0, z)) * (camera.fov / 50);
}
function updateMarkers() {
  ring.visible = false;
  frame.visible = false;
  if (selected && selected.kind === 'plant') {
    const r = Math.max(0.55, screenScale(selected.x, selected.z) * 0.022);
    ring.position.set(selected.x, 0.04, selected.z);
    ring.scale.setScalar(r);
    ring.visible = true;
  } else if (selected) {
    const { x, z, w, d } = selected;
    const t = Math.max(0.3, screenScale(x, z) * 0.006);
    const [a, b, c, e] = frame.children;
    a.position.set(x, 0.4, z - d / 2 - t / 2); a.scale.set(w + 2 * t, 1, t);
    b.position.set(x, 0.4, z + d / 2 + t / 2); b.scale.set(w + 2 * t, 1, t);
    c.position.set(x - w / 2 - t / 2, 0.4, z); c.scale.set(t, 1, d);
    e.position.set(x + w / 2 + t / 2, 0.4, z); e.scale.set(t, 1, d);
    frame.visible = true;
  }
  if (cross.visible) cross.scale.setScalar(Math.max(1.2, screenScale(cross.position.x, cross.position.z) * 0.06));
}
function showCross(x, z) {
  clearTimeout(crossTimer);
  cross.position.set(x, 0.5, z);
  cross.visible = true;
  requestRender();
}
function hideCross(afterMs = 0) {
  clearTimeout(crossTimer);
  crossTimer = setTimeout(() => { cross.visible = false; requestRender(); }, afterMs);
}

// ---------- Warning beep (Web Audio, no sound file) ----------
let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch { audioCtx = null; }
}
function beep(freq = 880, ms = 160) {
  if (navigator.vibrate) navigator.vibrate(60);
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.02);
}

// ---------- Picking with a finger ----------
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();
function groundAt(cx, cy) {
  const r = canvas.getBoundingClientRect();
  _ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  return raycaster.ray.intersectPlane(groundPlane, _hit);
}
const _v = new THREE.Vector3();
function screenDist2(x, y, z, cx, cy) {
  const r = canvas.getBoundingClientRect();
  _v.set(x, y, z).project(camera);
  if (_v.z > 1) return Infinity;
  const sx = r.left + ((_v.x + 1) / 2) * r.width, sy = r.top + ((1 - _v.y) / 2) * r.height;
  return (sx - cx) ** 2 + (sy - cy) ** 2;
}
const PICK_PX = 30;                 // a finger touch this close to a plant picks it
function plantAt(cx, cy, px = PICK_PX) {
  let best = null, bestD = px * px;
  for (const p of plants) {
    const d = Math.min(screenDist2(p.x, 0, p.z, cx, cy), screenDist2(p.x, 0.4, p.z, cx, cy));
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}
function rectAt(cx, cy, pad = 0) {
  const g = groundAt(cx, cy);
  if (!g) return null;
  return rectList.find((r) => Math.abs(g.x - r.x) <= r.w / 2 + pad && Math.abs(g.z - r.z) <= r.d / 2 + pad) || null;
}
function pickAt(cx, cy) { return plantAt(cx, cy) || rectAt(cx, cy); }
function touches(item, cx, cy) {
  if (item.kind === 'plant') return plantAt(cx, cy, 46) === item;
  return rectAt(cx, cy, 1) === item;
}

// ---------- Selection, drag and drop ----------
// Tap an object: it gets a yellow ring/frame (selected). Then put a finger on
// it and drag. Or press and hold any object for half a second to drag it at
// once. While an object is being dragged, the camera is locked.
const TAP_PX = 12;
const HOLD_MS = 450;
let press = null;            // finger that is down but not dragging (yet)
let drag = null;             // object being dragged
const fingers = new Set();

function select(item) {
  selected = item;
  delBtn.disabled = !(item && item.kind === 'plant');
  requestRender();
}
function stopCameraDrift() {
  controls._sphericalDelta.set(0, 0, 0);
  controls._panOffset.set(0, 0, 0);
  controls._scale = 1;
}
function startDrag(item, pointerId, cx, cy) {
  const g = groundAt(cx, cy);
  if (!g) return;
  controls.enabled = false;
  stopCameraDrift();
  drag = { item, pointerId, offX: item.x - g.x, offZ: item.z - g.z, fromX: item.x, fromZ: item.z, bad: null };
  select(item);
  hintEl.classList.add('hidden');
  try { canvas.setPointerCapture(pointerId); } catch { /* ok */ }
}
function moveItem(item, x, z) {
  item.x = x; item.z = z;
  if (item.kind === 'plant') writePlantMatrix(item); else placeRect(item);
  sceneChanged();
}
function dragMove(cx, cy) {
  const g = groundAt(cx, cy);
  if (!g) return;
  const [x, z] = clampToArea(drag.item, g.x + drag.offX, g.z + drag.offZ);
  moveItem(drag.item, x, z);
  const bad = checkSpot(drag.item, x, z);
  if (bad && !drag.bad) { beep(); showStatus(bad); }
  if (!bad && drag.bad) statusEl.classList.add('hidden');
  drag.bad = bad;
  if (bad) showCross(x, z); else hideCross();
}
function endDrag() {
  const { item, bad, fromX, fromZ } = drag;
  drag = null;
  controls.enabled = true;
  stopCameraDrift();
  if (bad) {
    showCross(item.x, item.z);             // the cross stays where it was refused
    hideCross(900);
    beep(440, 220);
    showStatus(bad + ' — wapas rakh diya', 2200);
    moveItem(item, fromX, fromZ);
  } else {
    hideCross();
    statusEl.classList.add('hidden');
    saveLayout();
  }
}

window.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas) return;
  unlockAudio();
  fingers.add(e.pointerId);
  if (drag) { e.stopPropagation(); return; }            // ignore extra fingers while dragging
  if (fingers.size > 1) { if (press) clearTimeout(press.timer); press = null; return; }
  if (e.button !== 0) return;
  if (selected && touches(selected, e.clientX, e.clientY)) {
    e.stopPropagation();                                 // the camera never sees this finger
    startDrag(selected, e.pointerId, e.clientX, e.clientY);
    return;
  }
  const item = pickAt(e.clientX, e.clientY);
  press = {
    id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false,
    camPos: camera.position.clone(), camTarget: controls.target.clone(), timer: 0,
  };
  if (item) {
    const p = press;
    p.timer = setTimeout(() => {
      if (press !== p || p.moved || drag) return;
      camera.position.copy(p.camPos);                    // undo any tiny camera turn
      controls.target.copy(p.camTarget);
      press = null;
      startDrag(item, p.id, p.x, p.y);
      requestRender();
    }, HOLD_MS);
  }
}, true);

window.addEventListener('pointermove', (e) => {
  if (drag && e.pointerId === drag.pointerId) {
    e.stopPropagation();
    dragMove(e.clientX, e.clientY);
    return;
  }
  if (drag) { e.stopPropagation(); return; }
  if (press && e.pointerId === press.id && !press.moved &&
      Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_PX) {
    press.moved = true;
    clearTimeout(press.timer);
  }
}, true);

function pointerEnd(e) {
  fingers.delete(e.pointerId);
  if (drag && e.pointerId === drag.pointerId) { endDrag(); return; }
  if (press && e.pointerId === press.id) {
    clearTimeout(press.timer);
    const p = press;
    press = null;
    if (!p.moved && performance.now() - p.t < 600 && e.type === 'pointerup') {
      camera.position.copy(p.camPos);                    // a tap does not move the camera
      controls.target.copy(p.camTarget);
      stopCameraDrift();
      const item = pickAt(e.clientX, e.clientY);
      select(item);
      if (item) {
        hintEl.classList.add('hidden');
        showStatus(item.kind === 'plant'
          ? `${PLANT_BY_ID[item.type].name} chuna — ungli rakh kar khiskao`
          : `${RECT_NAMES[item.key]} chuna — ungli rakh kar khiskao`, 2200);
      }
    }
  }
}
window.addEventListener('pointerup', pointerEnd, true);
window.addEventListener('pointercancel', pointerEnd, true);

// ---------- Bottom menu ----------
const addBox = document.getElementById('adds');
const delBtn = document.getElementById('del');
for (const t of PLANT_TYPES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tool';
  b.innerHTML = `<span class="dot" style="background:#${t.leaf.toString(16).padStart(6, '0')}"></span><span>+ ${t.name}</span>`;
  b.addEventListener('click', () => addPlant(t.id));
  addBox.appendChild(b);
}

function addPlant(typeId) {
  unlockAudio();
  // Look for the nearest free spot around the middle of the screen.
  const cx = controls.target.x, cz = controls.target.z;
  const p = { kind: 'plant', type: typeId, x: 0, z: 0, s: nextSeed() };
  for (let r = 0; r <= 90; r += 0.6) {
    const steps = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 0.6);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!checkSpot(p, x, z)) {
        p.x = x; p.z = z;
        plants.push(p);
        refreshPlants();
        select(p);
        saveLayout();
        showStatus(`${PLANT_BY_ID[typeId].name} lag gaya (peeli ring) — ungli se khiskao`, 2600);
        return;
      }
    }
  }
  beep();
  showStatus('Koi khaali jagah nahi mili', 2200);
}

delBtn.addEventListener('click', () => {
  if (!selected || selected.kind !== 'plant') return;
  plants = plants.filter((p) => p !== selected);
  refreshPlants();
  select(null);
  saveLayout();
  showStatus('Paudha hata diya', 1600);
});

document.getElementById('reset-layout').addEventListener('click', () => {
  if (!window.confirm('Poora layout pehle jaisa kar dein? (Aap ki tabdeeliyan mit jayengi)')) return;
  applyDefaultLayout();
  select(null);
  saveLayout();
  showStatus('Layout pehle jaisa ho gaya', 1800);
});

loadLayout();
select(null);
// Test hook (harmless): lets automated checks read the layout.
window.__zameen = { camera, controls, plants: () => plants, rects, requestRender };

// ---------- UI ----------
controls.addEventListener('start', () => hintEl.classList.add('hidden'), { once: true });
document.getElementById('reset').addEventListener('click', () => resetView());

canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => {
  renderer.shadowMap.needsUpdate = true;
  requestRender();
});

// ---------- Start ----------
resize();
homeView();
statusEl.classList.add('hidden');
if (USE_GLB_MODEL) loadModel();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
