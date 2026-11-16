import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------- Settings ----------
const PLOT_SIZE = 127;          // metres; 4 acres ~ 127 m x 127 m
const HALF = PLOT_SIZE / 2;

const WALL_HEIGHT = 2.0;        // right-side wall
const WALL_THICKNESS = 0.4;

const PILLAR_HEIGHT = 1.8;      // fence on the other three sides
const PILLAR_SIZE = 0.15;
const PILLAR_SPACING = 3;       // target gap; adjusted slightly to fit the side exactly
const WIRE_HEIGHTS = [0.5, 1.0, 1.5];
const GATE_PILLARS = 3;         // pillars left out in the middle of the front = entrance gate
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
scene.fog = new THREE.Fog(SKY_HORIZON, 300, 1500);   // far ground fades into the sky

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
  const gateFirst = Math.round(gaps / 2) - Math.floor(GATE_PILLARS / 2);
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

// Default view: standing in the entrance gate (middle of the front), low,
// looking straight in. The wall is on the right, the fence on the other sides.
function homeView() {
  const portrait = camera.aspect < 1;
  if (portrait) {
    camera.position.set(0, 5, HALF + 4);
    controls.target.set(0, 0, HALF - 26);
  } else {
    camera.position.set(0, 4.5, HALF + 9);
    controls.target.set(0, 0, HALF - 30);
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
  controls.update();            // advances damping; fires 'change' while moving
  if (needsRender) {
    needsRender = false;
    watchSpeed(now);
    renderer.render(scene, camera);
  }
}
renderer.setAnimationLoop(tick);

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
