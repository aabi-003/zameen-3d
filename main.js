import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLANT_TYPES, MIN_HEIGHT, MAX_HEIGHT, buildPlantGeometry, plantMaterial } from './plants.js';

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
const LAYOUT_VERSION = 2;            // 2: pools one after another + kamra

const POOL_EDGE = 0.6;                // concrete edge width (m)
const POOL_EDGE_H = 0.28;             // edge top above the ground
const WATER_Y = 0.12;                 // water surface height
const CROP_ROW_SPACING = 0.9;         // metres between crop rows

// Kamra (small room) + 2 solar panels on a stand, as one object:
// room on one half, solar stand on the other half.
const ROOM_W = 12 * FT;               // room 12 ft x 10 ft, 10 ft high
const ROOM_D = 10 * FT;
const ROOM_H = 10 * FT;
const UNIT_W = ROOM_W * 2;            // half room, half solar
const UNIT_D = ROOM_D;
const PANEL_W = 1.13;                 // one solar panel (m), standing the long way up the slope
const PANEL_L = 2.28;
const PANEL_TILT_DEG = 25;            // panels face the front (+Z), where the sun is
const PANEL_LOW = 0.6;                // height of the low edge of the panels

// ---------- Default layout ----------
// Right half, from the entrance going back: big pool, small pool, khet (all
// full width, long side left-right), then kamra + solar at the back near
// the wall. Pool and khet areas are exactly 2 : 1.5 : 0.5 with 10 ft gaps.
function rectSizes() {
  const x0 = GAP / 2, x1 = AREA.maxX, W = x1 - x0;
  const z0 = AREA.minZ + UNIT_D + GAP, z1 = AREA.maxZ;       // room strip kept free at the back
  const total = RATIO.khet + RATIO.bigPool + RATIO.smallPool;
  const L = z1 - z0 - 2 * GAP;                                // depth left after two gaps
  const Db = (L * RATIO.bigPool) / total;
  const Ds = (L * RATIO.smallPool) / total;
  const Dk = (L * RATIO.khet) / total;
  return {
    bigPool:   { w: W, d: Db, x: x0 + W / 2, z: z1 - Db / 2 },
    smallPool: { w: W, d: Ds, x: x0 + W / 2, z: z1 - Db - GAP - Ds / 2 },
    khet:      { w: W, d: Dk, x: x0 + W / 2, z: z0 + Dk / 2 },
    kamra:     { w: UNIT_W, d: UNIT_D, x: x1 - UNIT_W / 2, z: AREA.minZ + UNIT_D / 2 },
  };
}
const RECT_DEFAULTS = rectSizes();

function defaultPlants() {
  // Left half, a grid about 20 ft apart, cheeku / anar / khajoor row by row.
  const x0 = AREA.minX, x1 = -GAP / 2, z0 = AREA.minZ, z1 = AREA.maxZ;
  const cols = Math.floor((x1 - x0) / ORCHARD_SPACING) + 1;
  const rows = Math.floor((z1 - z0) / ORCHARD_SPACING) + 1;
  const order = ['cheeku', 'anar', 'khajoor'].filter((id) => PLANT_BY_ID[id]);
  const list = [];
  let seed = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      list.push({
        kind: 'plant',
        type: order.length ? order[r % order.length] : PLANT_TYPES[0].id,
        x: x0 + (c * (x1 - x0)) / (cols - 1),
        z: z1 - (r * (z1 - z0)) / (rows - 1),
        s: seed++,
      });
    }
  }
  return list;
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

// ---------- Kamra (small room) + 2 solar panels on a stand ----------
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

function makeRoomSolar(w, d) {
  const g = new THREE.Group();
  const concrete = new THREE.MeshLambertMaterial({ map: concreteTex });
  const metal = new THREE.MeshLambertMaterial({ color: 0x9ea3a8 });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // --- Room: on the right half (toward the wall), so it never shades the panels.
  const rx = w / 4;                                  // centre of the right half
  const T = 0.23, PL = 0.15;                         // wall thickness, plinth height
  add(new THREE.BoxGeometry(ROOM_W + 0.3, PL, ROOM_D + 0.3), concrete, rx, PL / 2, 0);   // plinth
  const wallMat = new THREE.MeshLambertMaterial({ map: makeWallTexture() });
  const wh = ROOM_H - 0.2;
  const wy = PL + wh / 2;
  add(metricBox(ROOM_W, wh, T, WALL_TILE_W, WALL_TILE_H), wallMat, rx, wy, ROOM_D / 2 - T / 2);    // front
  add(metricBox(ROOM_W, wh, T, WALL_TILE_W, WALL_TILE_H), wallMat, rx, wy, -ROOM_D / 2 + T / 2);   // back
  add(metricBox(T, wh, ROOM_D - 2 * T, WALL_TILE_W, WALL_TILE_H), wallMat, rx - ROOM_W / 2 + T / 2, wy, 0);
  add(metricBox(T, wh, ROOM_D - 2 * T, WALL_TILE_W, WALL_TILE_H), wallMat, rx + ROOM_W / 2 - T / 2, wy, 0);
  // Flat concrete roof with a small overhang.
  add(metricBox(ROOM_W + 0.4, 0.18, ROOM_D + 0.4, 1.2, 1.2), concrete, rx, PL + wh + 0.09, 0);
  // Steel door and a window with grill, on the front face.
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x3f5a4a });
  const fz = ROOM_D / 2 + 0.02;
  add(new THREE.BoxGeometry(0.95, 2.1, 0.05), doorMat, rx - ROOM_W / 4, PL + 1.05, fz);
  add(new THREE.BoxGeometry(0.06, 0.06, 0.07), metal, rx - ROOM_W / 4 + 0.35, PL + 1.05, fz + 0.03);  // handle
  add(new THREE.BoxGeometry(1.1, 1.0, 0.04), new THREE.MeshLambertMaterial({ color: 0x23303a }), rx + ROOM_W / 5, PL + 1.55, fz);
  for (let i = -2; i <= 2; i++) {
    add(new THREE.BoxGeometry(0.03, 1.0, 0.03), metal, rx + ROOM_W / 5 + i * 0.22, PL + 1.55, fz + 0.03);
  }
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xd9d4c7 });
  add(new THREE.BoxGeometry(1.2, 0.08, 0.06), frameMat, rx + ROOM_W / 5, PL + 2.09, fz);
  add(new THREE.BoxGeometry(1.2, 0.08, 0.06), frameMat, rx + ROOM_W / 5, PL + 1.01, fz);

  // --- Solar stand: on the left half. Two panels side by side, full metal
  // frame: 4 legs, 2 slanted rails, cross braces and concrete footings.
  const sx = -w / 4;
  const tilt = THREE.MathUtils.degToRad(PANEL_TILT_DEG);
  const depth = PANEL_L * Math.cos(tilt), rise = PANEL_L * Math.sin(tilt);
  const zFront = depth / 2, zBack = -depth / 2;
  const legX = PANEL_W - 0.15;                       // legs under both panels
  const P = 0.05;                                    // steel profile size
  const backH = PANEL_LOW + rise;
  for (const lx of [-legX, legX]) {
    add(new THREE.BoxGeometry(0.25, 0.15, 0.25), concrete, sx + lx, 0.075, zFront);   // footings
    add(new THREE.BoxGeometry(0.25, 0.15, 0.25), concrete, sx + lx, 0.075, zBack);
    add(new THREE.BoxGeometry(P, PANEL_LOW, P), metal, sx + lx, PANEL_LOW / 2, zFront);
    add(new THREE.BoxGeometry(P, backH, P), metal, sx + lx, backH / 2, zBack);
    // Slanted rail from the front leg top to the back leg top.
    const rail = add(new THREE.BoxGeometry(P, P, PANEL_L), metal, sx + lx, PANEL_LOW + rise / 2, 0);
    rail.rotation.x = tilt;
    // Diagonal brace from the front foot to the back leg top.
    const bl = Math.hypot(depth, backH);
    const brace = add(new THREE.BoxGeometry(P * 0.7, P * 0.7, bl), metal, sx + lx, backH / 2, 0);
    brace.rotation.x = Math.atan2(backH, depth);
  }
  // Cross beams joining left and right legs (front low, back high, back middle).
  add(new THREE.BoxGeometry(legX * 2 + P, P, P), metal, sx, PANEL_LOW - 0.05, zFront);
  add(new THREE.BoxGeometry(legX * 2 + P, P, P), metal, sx, backH - 0.05, zBack);
  add(new THREE.BoxGeometry(legX * 2 + P, P, P), metal, sx, backH * 0.45, zBack);

  // Panels: silver aluminium frame with the blue cell sheet on top.
  const panels = new THREE.Group();
  panels.position.set(sx, PANEL_LOW + rise / 2 + P, 0);
  panels.rotation.x = tilt;                          // high edge at the back, facing the front
  const cellMat = new THREE.MeshPhongMaterial({ map: makeSolarTexture(), specular: 0x8899aa, shininess: 90 });
  const alu = new THREE.MeshLambertMaterial({ color: 0xc8ccd0 });
  for (const px of [-(PANEL_W / 2 + 0.01), PANEL_W / 2 + 0.01]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(PANEL_W, 0.04, PANEL_L), alu);
    frame.position.x = px;
    const cells = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W - 0.05, PANEL_L - 0.05).rotateX(-Math.PI / 2), cellMat);
    cells.position.set(px, 0.021, 0);
    frame.castShadow = true;
    panels.add(frame, cells);
  }
  g.add(panels);
  return g;
}

// ---------- Objects in the scene ----------
const objectsRoot = new THREE.Group();
objectsRoot.name = 'objects';
scene.add(objectsRoot);

const RECT_NAMES = { khet: 'Khet', bigPool: 'Bara pool', smallPool: 'Chhota pool', kamra: 'Kamra + solar' };
const rects = {};
for (const key of Object.keys(RECT_DEFAULTS)) {
  const { w, d, x, z } = RECT_DEFAULTS[key];
  const group = key === 'khet' ? makeKhet(w, d) : key === 'kamra' ? makeRoomSolar(w, d) : makePool(w, d);
  group.name = key;
  objectsRoot.add(group);
  rects[key] = { kind: 'rect', key, w, d, x, z, group };
}
const rectList = Object.values(rects);

const PLANT_BY_ID = Object.fromEntries(PLANT_TYPES.map((t) => [t.id, t]));
let plants = [];

// One InstancedMesh per plant type; it grows if more plants are added.
const plantMeshes = {};
const plantMat = plantMaterial();
function plantMesh(typeId, need) {
  let mesh = plantMeshes[typeId];
  if (mesh && mesh.instanceMatrix.count >= need) return mesh;
  const cap = Math.max(256, 2 ** Math.ceil(Math.log2(need + 1)));
  const geo = mesh ? mesh.geometry : buildPlantGeometry(PLANT_BY_ID[typeId], typeId.length * 13 + 5);
  if (mesh) { objectsRoot.remove(mesh); mesh.dispose(); }
  mesh = new THREE.InstancedMesh(geo, plantMat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;         // instances move, so skip the whole-mesh bounds check
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'plants-' + typeId;
  objectsRoot.add(mesh);
  plantMeshes[typeId] = mesh;
  return mesh;
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
function plantLook(p) {
  // Height (2 to 2.5 ft) and turn come from the plant's seed, so each plant
  // keeps its own look after a reload.
  const r = mulberry32(p.s * 7919 + 17);
  const h = MIN_HEIGHT + r() * (MAX_HEIGHT - MIN_HEIGHT);
  return { h, rot: r() * Math.PI * 2, wide: 0.9 + r() * 0.2 };
}
function writePlantMatrix(p) {
  const look = p.look || (p.look = plantLook(p));
  _q.setFromAxisAngle(_up, look.rot);
  _m4.compose(_p.set(p.x, 0, p.z), _q, _s.set(look.h * look.wide, look.h, look.h * look.wide));
  const mesh = plantMeshes[p.type];
  mesh.setMatrixAt(p.slot, _m4);
  mesh.instanceMatrix.needsUpdate = true;
}
function refreshPlants() {
  const counts = {};
  for (const t of PLANT_TYPES) counts[t.id] = 0;
  for (const p of plants) counts[p.type]++;
  for (const t of PLANT_TYPES) plantMesh(t.id, counts[t.id]).count = counts[t.id];
  for (const t of PLANT_TYPES) counts[t.id] = 0;
  for (const p of plants) { p.slot = counts[p.type]++; writePlantMatrix(p); }
  sceneChanged();
}
function placeRect(r) {
  r.group.position.set(r.x, 0, r.z);
}
function sceneChanged() {
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
  if (!data || (data.v !== 1 && data.v !== LAYOUT_VERSION)) { applyDefaultLayout(); return; }

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
  for (const row of Array.isArray(data.plants) ? data.plants : []) {
    if (!Array.isArray(row)) continue;
    const [type, x, z, s] = row;
    if (!PLANT_BY_ID[type] || !Number.isFinite(x) || !Number.isFinite(z)) continue;
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
