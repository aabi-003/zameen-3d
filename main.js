import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------- Settings ----------
const MODEL_URL = './models/zameen.glb';
const PLOT_SIZE = 127;          // metres; 4 acres ~ 127 m x 127 m (placeholder only)
const SKY_COLOR = 0xb9d4e8;
const SOIL_COLOR = 0x9b7a55;
const MAX_PIXEL_RATIO = 2;      // cap for phone GPUs

const canvas = document.getElementById('view');
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_COLOR);

const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);

// Cheap lighting: no shadows, two lights only.
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a6f4d, 1.6));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
sun.position.set(80, 120, 60);
scene.add(sun);

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

// Land bounds; updated when the real model loads.
const bounds = new THREE.Box3(
  new THREE.Vector3(-PLOT_SIZE / 2, 0, -PLOT_SIZE / 2),
  new THREE.Vector3(PLOT_SIZE / 2, 0, PLOT_SIZE / 2),
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

let homePos = new THREE.Vector3();
let homeTarget = new THREE.Vector3();

// Place the camera so the whole plot is visible, from the front looking in.
function frameView() {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 10);
  const portrait = camera.aspect < 1;
  const dist = span * (portrait ? 2.5 : 1.15);

  homeTarget.set(center.x, groundY, center.z);
  homePos.set(center.x - dist * 0.22, groundY + dist * 0.55, center.z + dist * 0.75);

  controls.minDistance = 3;
  controls.maxDistance = span * 4;
  camera.far = span * 12;
  camera.updateProjectionMatrix();

  camera.position.copy(homePos);
  controls.target.copy(homeTarget);
  controls.update();
  requestRender();
}

// ---------- Placeholder ground (used until models/zameen.glb exists) ----------
function makePlaceholder() {
  const group = new THREE.Group();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(PLOT_SIZE, PLOT_SIZE),
    new THREE.MeshLambertMaterial({ color: SOIL_COLOR }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // Faint 10 m grid so movement and scale are visible on the plain surface.
  const divisions = Math.round(PLOT_SIZE / 10);
  const grid = new THREE.GridHelper(PLOT_SIZE, divisions, 0x6f5538, 0x86694a);
  grid.position.y = 0.02;
  group.add(grid);

  return group;
}

let placeholder = makePlaceholder();
scene.add(placeholder);

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) [].concat(o.material).forEach((m) => m.dispose());
  });
}

// ---------- Real model ----------
function showStatus(text, autoHideMs) {
  statusEl.textContent = text;
  statusEl.classList.remove('hidden');
  if (autoHideMs) setTimeout(() => statusEl.classList.add('hidden'), autoHideMs);
}

function loadModel() {
  new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
      const model = gltf.scene;
      scene.add(model);
      scene.remove(placeholder);
      disposeTree(placeholder);
      placeholder = null;

      const box = new THREE.Box3().setFromObject(model);
      groundY = box.min.y;
      bounds.min.set(box.min.x, groundY, box.min.z);
      bounds.max.set(box.max.x, groundY, box.max.z);

      frameView();
      statusEl.classList.add('hidden');
    },
    undefined,
    () => {
      // No model yet (Phase 2 not done) - keep the placeholder ground.
      showStatus('Placeholder zameen (asal model abhi nahi bana)', 4000);
    },
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
  camera.updateProjectionMatrix();
  requestRender();
}
window.addEventListener('resize', resize);

function tick() {
  controls.update();            // advances damping; fires 'change' while moving
  if (needsRender) {
    needsRender = false;
    renderer.render(scene, camera);
  }
}
renderer.setAnimationLoop(tick);

// ---------- UI ----------
controls.addEventListener('start', () => hintEl.classList.add('hidden'), { once: true });
document.getElementById('reset').addEventListener('click', frameView);

canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
canvas.addEventListener('webglcontextrestored', requestRender);

// ---------- Start ----------
resize();
frameView();
loadModel();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
