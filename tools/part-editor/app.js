// PartAdder part editor: part.json builder with a three.js preview.
// Everything runs in the browser; no build step, no server-side code.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { t, setLang, getLang, applyI18n } from './i18n.js';
import {
  PRESETS, SHAPE_ONLY, SHAPES, CATEGORIES, UNITS, FLAGS, DIRECTIONS,
} from './presets.js';
import { EXAMPLES } from './examples.js';
import { COMPONENTS, COMPONENT_BY_KEY, COMPONENT_GROUPS, ENGINE_SOUNDS, ENGINE_FLAMES } from './components.js';
import {
  FLAME_PARAMS, defaultFlame, flameToJson, flameFromJson, applyFlamePreset,
  createFlameGeometry, createFlameMaterial, applyFlameParams,
} from './flame.js';
import { createTimeline } from './anim-timeline.js';
import { createCurveEditor as createMotionCurve, motionDuration, motionPoints, sampleMotion } from './anim-curve.js';
import { createCurveEditor, defaultFlameProfile } from './flame-curve.js';
import { STATE_DEFAULTS } from './state-defaults.js';
import { createHistory } from './history.js';
import { loadSchema, validateAgainstSchema } from './schema.js';
import { templateFor } from './templates.js';
import { DYNAMIC_PRESETS, DYNAMIC_DIRECTIONS, DYNAMIC_SHAPES, DYNAMIC_SHAPE_BITS } from './dynamic-presets.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Part model
// ---------------------------------------------------------------------------

function defaultPart() {
  return {
    formatVersion: 1,
    id: 'new_part',
    name: 'New part',
    description: '',
    category: 'structure',
    mass: 100,
    tags: [],
    impactTolerance: 10,
    assemblyPosition: 0,
    defindex: 0,
    model: 'model.obj',
    units: 'm',
    scale: 1,
    physicsModel: '',
    icon: '',
    material: { color: '#c8ccd4', metallic: 0.2, smoothness: 0.4, emissive: '#000000', emissiveIntensity: 0, opacity: 1, tiling: [1, 1], offset: [0, 0] },
    attachments: [{
      id: 0,
      name: 'top',
      position: [0, 0.5, 0],
      direction: [0, 1, 0],
      rotation: null,
      shape: 'single',
      flags: [],
      spacing: 1,
      sockets: [[0, 0, 0]],
    }],
    cableAttachments: [],
    centerOfMassAdjustment: [0, 0, 0],
    radialSnapping: -1,
    // Surface sockets (the game's dynamic attachments): the defindex of a stock
    // config plus the shapes the socket takes, see dynamic-presets.js.
    dynamicAttachmentConfigs: [],
    dynamicCurrPivot: [0, 0, 0],
    modules: {},
    state: {},
    variants: [],
    thermo: {},
    overrides: {},
    animations: [],
  };
}

const state = {
  part: defaultPart(),
  selection: null,        // { kind: 'attachment'|'socket'|'cable', att: index, socket: index }
  component: null,        // module key of the open component editor
  animation: null,        // index of the open animation
  nodeMaterial: null,     // index of the open node material
  variant: null,          // index of the open variant
  animPreview: { playing: false, time: 0, only: null, key: null },
  flame: defaultFlame(ENGINE_FLAMES[0]),   // the flame of the engine (flame.json)
  flames: [],              // the custom flames of the part: { name, base, params, profile }
  soundFile: null,         // the sound of the engine (sound.wav)
  soundData: '',           // the same file as base64, for the export and the library
  explodeRest: null,        // rest positions of the mesh objects for the exploded view
  explodeOffsets: null,     // the offsets of the exploded view, added on top of the animation pose
  hiddenObjects: 0,         // line and point objects the game cannot render
  strippedLines: 0,         // line elements removed from an OBJ before parsing
  previewTextures: { albedo: null, normal: null, mask: null },
  textureSources: { albedo: '', normal: '', mask: '' },   // data urls for the library
  nodeTextures: {},          // node path -> { albedo, normal, mask } preview textures
  nodeTextureSources: {},    // node path -> { albedo, normal, mask } data urls
  library: [],               // the saved parts of the library
  exportSelection: { current: true, library: new Set() },
  modelObject: null,
  modelNodeMap: null,     // path -> Object3D of the loaded mesh
  modelFileName: '',
  modelLoaded: false,
  volumeInfo: null,       // the last measurement of the meshes (volume, area, per-mesh list)
  volumePending: false,   // the measurement is scheduled and has not run yet
  jsonInvalid: {},        // 'modules'|'state'|'thermo'|'overrides' -> true while the raw JSON is broken
  schema: null,           // the schema of part.json (the loader checks the same rules)
  dynamicProbe: null,     // { index, point: [x,y,z], normal: [x,y,z] } of the socket preview
  dynamicHidden: new WeakSet(), // socket entries the preview does not draw
  dynamicView: true,      // the sockets are drawn on the model at all
};

// ---------------------------------------------------------------------------
// Undo, redo and the draft of the session
// ---------------------------------------------------------------------------

// The undo history: every change stores the part, so Ctrl+Z walks back through
// them. The draft is the same snapshot, written into the browser, so a closed
// tab does not cost the work of the day.
const DRAFT_KEY = 'partadder.editor.draft';
const DRAFT_MAX_AGE = 24 * 60 * 60 * 1000;

function captureState() {
  return JSON.stringify({ part: state.part, flame: state.flame, flames: state.flames });
}

function restoreState(text) {
  let snapshot = null;
  try {
    snapshot = JSON.parse(text);
  } catch (e) {
    return;
  }
  if (!snapshot || !snapshot.part) return;
  state.part = normalizePart(snapshot.part);
  if (snapshot.flame) state.flame = snapshot.flame;
  if (Array.isArray(snapshot.flames)) state.flames = snapshot.flames;
  fillForm();
  refreshStructure();
}

const history = createHistory({
  limit: 80,
  capture: captureState,
  restore: restoreState,
  onChange: updateHistoryButtons,
});

function updateHistoryButtons() {
  const undo = $('btn-undo');
  const redo = $('btn-redo');
  if (undo) undo.disabled = !history.canUndo();
  if (redo) redo.disabled = !history.canRedo();
  // The draft follows every step of the history, so the work is never lost.
  scheduleDraftSave();
}

// Every keystroke in the editor is a change of the part: the history waits a
// moment, so a word is one step and not a dozen.
document.addEventListener('input', () => {
  history.schedule();
  scheduleDraftSave();
}, true);

// A button can change the part as well (a connection is removed, a module is
// added). The push only records something when the part really changed, so a
// click that did nothing costs nothing.
document.addEventListener('click', () => {
  history.schedule(0);
}, true);

// The buttons of the toolbar and the usual keys.
document.addEventListener('keydown', (event) => {
  const target = event.target;
  const tag = (target?.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;

  // The space plays the animation, like in Blender.
  if (event.code === 'Space' && !typing && tag !== 'button') {
    event.preventDefault();
    togglePreview();
    return;
  }

  // The Delete removes the selected keyframe.
  if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && state.animPreview.key) {
    event.preventDefault();
    removeAnimationKey();
    return;
  }

  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    history.undo();
  } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
    event.preventDefault();
    history.redo();
  }
});

// The draft of the session.
let draftTimer = null;

function scheduleDraftSave() {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    saveDraft();
  }, 1000);
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      part: state.part,
      flame: state.flame,
      flames: state.flames,
      savedAt: Date.now(),
    }));
  } catch (e) {
    // A full browser storage must not break the editor.
  }
}

// Brings the draft of the last session back, when there is one.
function restoreDraft() {
  let draft = null;
  try {
    const text = localStorage.getItem(DRAFT_KEY);
    if (!text) return false;
    draft = JSON.parse(text);
  } catch (e) {
    return false;
  }
  if (!draft || !draft.part) return false;
  if (!draft.savedAt || Date.now() - draft.savedAt > DRAFT_MAX_AGE) return false;

  state.part = normalizePart(draft.part);
  if (draft.flame) state.flame = draft.flame;
  if (Array.isArray(draft.flames)) state.flames = draft.flames;
  return true;
}

// ---------------------------------------------------------------------------
// The mass and the connections from the mesh
// ---------------------------------------------------------------------------

// The densities the mass can be computed with. The first one is the rule of the
// loader: a part without a mass in part.json gets the volume of its mesh times
// 1000 kg/m3.
const DENSITIES = [
  { value: 1000, key: 'density.structure' },
  { value: 2700, key: 'density.aluminium' },
  { value: 7800, key: 'density.steel' },
  { value: 1600, key: 'density.carbon' },
  { value: 1200, key: 'density.plastic' },
  { value: 2600, key: 'density.rock' },
];

function fillDensitySelect() {
  const select = $('f-density');
  if (!select) return;
  select.innerHTML = '';
  for (const density of DENSITIES) {
    const option = document.createElement('option');
    option.value = String(density.value);
    option.textContent = `${t(density.key)} (${density.value} kg/m³)`;
    select.append(option);
  }
}

// The mass of the part from the volume of its mesh.
function massFromMesh() {
  const info = ensureVolumeInfo();
  if (!info || !(info.volume > 0)) {
    statusLine(t('status.massNoMesh'), 'warn');
    return;
  }

  const density = Number($('f-density')?.value) || 1000;
  const mass = Math.max(0.1, Math.round(info.volume * density * 10) / 10);
  state.part.mass = mass;
  $('f-mass').value = String(mass);
  updateModelInfo();
  refreshScene();
  history.push();
  statusLine(t('status.massFromMesh', { mass, volume: info.volume.toFixed(3), density }), 'ok');
}

// The bounds of the mesh in the space of the part (metres).
function modelBounds() {
  if (!state.modelObject) return null;
  const box = new THREE.Box3().setFromObject(state.modelObject);
  if (box.isEmpty()) return null;
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

// Puts the attachment onto the surface of the mesh: the plane of the connection
// goes to the far end of the mesh along its direction, and its size is the
// silhouette of the mesh there.
function fitAttachmentToMesh(att) {
  const box = modelBounds();
  if (!box) {
    statusLine(t('status.fitNoMesh'), 'warn');
    return;
  }

  const direction = attachmentDirection(att);
  const components = [Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)];
  const axis = components[1] >= components[0] && components[1] >= components[2] ? 1 : (components[0] >= components[2] ? 0 : 2);
  // The two axes the plane of the connection lies in.
  const others = [0, 1, 2].filter((a) => a !== axis);
  const u = others[0];
  const v = others[1];
  const sign = (axis === 0 ? direction.x : axis === 1 ? direction.y : direction.z) >= 0 ? 1 : -1;

  const position = [0, 0, 0];
  position[axis] = sign > 0 ? box.max[axis] : box.min[axis];
  position[u] = (box.min[u] + box.max[u]) / 2;
  position[v] = (box.min[v] + box.max[v]) / 2;
  att.position = position.map((value) => Math.round(value * 1000) / 1000);

  const size = [0, 0, 0];
  size[u] = Math.max(0.05, box.max[u] - box.min[u]);
  size[v] = Math.max(0.05, box.max[v] - box.min[v]);
  size[axis] = Math.max(0.02, Math.min(size[u], size[v]) * 0.1);
  att.size = size.map((value) => Math.round(value * 1000) / 1000);

  // The sockets of the connection sit in the middle of the plane.
  const count = (att.sockets || []).length;
  if (count) {
    const radius = Math.min(size[u], size[v]) * 0.25;
    att.sockets = att.sockets.map((socket, index) => {
      const angle = count > 1 ? (index / count) * Math.PI * 2 : 0;
      const next = [...(socket || [0, 0, 0])];
      next[u] = Math.round(Math.cos(angle) * radius * 1000) / 1000;
      next[v] = Math.round(Math.sin(angle) * radius * 1000) / 1000;
      return next;
    });
  }

  renderAttachmentEditor();
  refreshScene();
  history.push();
  statusLine(t('status.fitDone'), 'ok');
}

// ---------------------------------------------------------------------------
// three.js scene
// ---------------------------------------------------------------------------

const canvas = $('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1017);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
camera.position.set(3, 2.2, 4);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.4, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2030, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 8, 6);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x8fb6ff, 0.8);
fill.position.set(-6, -2, -4);
scene.add(fill);

const grid = new THREE.GridHelper(24, 24, 0x2a3140, 0x1b202b);
grid.position.y = -0.001;
scene.add(grid);

// Model is scaled by units * extra scale; attachments and sockets stay in
// part.json metres, so they live in their own unscaled group.
const modelRoot = new THREE.Group();
scene.add(modelRoot);
const overlayRoot = new THREE.Group();
scene.add(overlayRoot);
// The ghost of a dynamic socket is placed on the hull by the pointer; it is
// not part of the overlay, which every refresh of the scene clears.
const dynamicProbeRoot = new THREE.Group();
scene.add(dynamicProbeRoot);
// The zones and the glyphs of the surface sockets on the part. Its own root, so
// a refresh of the scene does not wipe it and a socket change does not have to
// rebuild the scene.
const dynamicViewRoot = new THREE.Group();
scene.add(dynamicViewRoot);

// A hook for the tests: they look at the scene and at the state of the editor.
window.partEditor = { scene, state, overlayRoot, dynamicProbeRoot, dynamicViewRoot, toJson, validate, exportObj };

const transform = new TransformControls(camera, renderer.domElement);
transform.setSize(0.8);
transform.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
});
transform.addEventListener('objectChange', () => {
  syncFromScene();
});
transform.addEventListener('mouseUp', () => {
  refreshStructure();
});
scene.add(transform.getHelper());

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown = null;

function onResize() {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

new ResizeObserver(onResize).observe(canvas);

// ---------------------------------------------------------------------------
// Overlay geometry helpers
// ---------------------------------------------------------------------------

const ATT_COLOR = 0x4da3ff;
const ATT_SELECTED = 0xffb020;
const SOCKET_COLOR = 0x58d68d;
const CABLE_COLOR = 0xff6bd6;

function baseMaterial(color, extra) {
  return new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.28,
    roughness: 0.5,
    metalness: 0.1,
    depthWrite: false,
    ...extra,
  });
}

function makeLabel(text, color = '#d8dee9') {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 256;
  canvasEl.height = 64;
  const g = canvasEl.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.font = '600 30px "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(13, 16, 23, 0.72)';
  const w = Math.min(252, g.measureText(text).width + 24);
  g.fillRect(128 - w / 2, 10, w, 44);
  g.fillStyle = color;
  g.fillText(text, 128, 33);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false,
  }));
  sprite.scale.set(0.9, 0.225, 1);
  return sprite;
}

function disposeGroup(group) {
  for (const child of group.children.slice()) {
    group.remove(child);
    child.traverse?.((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        if (node.material.map) node.material.map.dispose();
        node.material.dispose();
      }
    });
  }
}

function toVec3(value, fallback) {
  if (Array.isArray(value) && value.length === 3) {
    const vec = value.map((v) => Number(v));
    return vec.every((v) => Number.isFinite(v)) ? vec : fallback.slice();
  }
  if (typeof value === 'string') {
    const key = value.trim().toLowerCase();
    if (DIRECTIONS[key]) return DIRECTIONS[key].slice();
  }
  return fallback.slice();
}

// part.json stores flags as one string ("dynamic, primary"). Older editor
// builds exported an array, so import accepts both; "none" means no flags.
function toFlags(value) {
  const list = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[,|+\s]+/) : []);
  return list
    .map((flag) => String(flag).trim().toLowerCase())
    .filter((flag) => flag && flag !== 'none');
}

function attachmentQuaternion(att) {
  if (att.rotation) {
    const e = new THREE.Euler(
      THREE.MathUtils.degToRad(att.rotation[0] || 0),
      THREE.MathUtils.degToRad(att.rotation[1] || 0),
      THREE.MathUtils.degToRad(att.rotation[2] || 0),
      'ZXY',
    );
    return new THREE.Quaternion().setFromEuler(e);
  }
  const dir = new THREE.Vector3(...toVec3(att.direction, [0, 1, 0]));
  if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
  dir.normalize();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}

function presetOf(att) {
  return PRESETS[att.shape] || null;
}

function socketOffsets(att) {
  if (att.shape && SHAPE_ONLY.includes(att.shape)) return att.sockets || [];
  const preset = presetOf(att);
  if (!preset) return att.sockets || [];
  return att.sockets || preset.sockets;
}

function refreshScene() {
  disposeGroup(overlayRoot);
  transform.detach();

  const part = state.part;
  part.attachments.forEach((att, index) => {
    const q = attachmentQuaternion(att);
    const group = new THREE.Group();
    group.position.set(...toVec3(att.position, [0, 0, 0]));
    group.quaternion.copy(q);
    group.userData = { kind: 'attachment', att: index };

    const preset = presetOf(att);
    const spacing = Number(att.spacing) > 0 ? Number(att.spacing) : 1;
    const size = toVec3(att.size, preset ? preset.size : [0.7, 0.3, 0.7]).map((v) => v * spacing);
    const center = toVec3(att.center, [0, 0, 0]);

    const selected = state.selection?.kind === 'attachment' && state.selection.att === index;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      baseMaterial(selected ? ATT_SELECTED : ATT_COLOR, { opacity: selected ? 0.38 : 0.22 }),
    );
    box.position.set(...center);
    box.userData = { kind: 'attachment', att: index };
    group.add(box);

    const offsets = socketOffsets(att);
    offsets.forEach((offset, socketIndex) => {
      const socketSelected = state.selection?.kind === 'socket'
        && state.selection.att === index && state.selection.socket === socketIndex;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 16, 12),
        new THREE.MeshStandardMaterial({
          color: socketSelected ? ATT_SELECTED : SOCKET_COLOR,
          emissive: socketSelected ? 0x7a4b00 : 0x0b3a20,
          roughness: 0.35,
        }),
      );
      const local = toVec3(offset, [0, 0, 0]);
      sphere.position.set(
        local[0] * spacing,
        local[1] * spacing,
        local[2] * spacing,
      );
      sphere.userData = { kind: 'socket', att: index, socket: socketIndex };
      group.add(sphere);
    });

    const label = makeLabel(`${att.id}: ${att.name || '#' + att.id}`);
    label.position.set(0, size[1] / 2 + (center[1] || 0) + 0.18, 0);
    label.userData = { label: true };
    group.add(label);

    overlayRoot.add(group);
  });

  (part.cableAttachments || []).forEach((cable, index) => {
    const selected = state.selection?.kind === 'cable' && state.selection.att === index;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 16, 12),
      new THREE.MeshStandardMaterial({
        color: selected ? ATT_SELECTED : CABLE_COLOR,
        emissive: 0x3a0b2c,
        roughness: 0.4,
      }),
    );
    sphere.position.set(...toVec3(cable.position, [0, 0, 0]));
    sphere.userData = { kind: 'cable', att: index };
    overlayRoot.add(sphere);

    const label = makeLabel(`cable ${cable.id}`, '#ffb0ea');
    label.position.copy(sphere.position).add(new THREE.Vector3(0, 0.16, 0));
    label.userData = { label: true };
    overlayRoot.add(label);
  });

  applyLabels();
  attachGizmo();
}

function attachGizmo() {
  const sel = state.selection;
  transform.detach();
  if (!sel) return;

  if (sel.kind === 'attachment') {
    const group = overlayRoot.children.find((c) => c.userData.kind === 'attachment' && c.userData.att === sel.att);
    if (group) transform.attach(group);
  } else if (sel.kind === 'socket') {
    const group = overlayRoot.children.find((c) => c.userData.kind === 'attachment' && c.userData.att === sel.att);
    const sphere = group?.children.find((c) => c.userData.kind === 'socket' && c.userData.socket === sel.socket);
    if (sphere) transform.attach(sphere);
  } else if (sel.kind === 'cable') {
    const sphere = overlayRoot.children.find((c) => c.userData.kind === 'cable' && c.userData.att === sel.att);
    if (sphere) transform.attach(sphere);
  }
}

function syncFromScene() {
  const sel = state.selection;
  if (!sel) return;
  const part = state.part;

  if (sel.kind === 'attachment') {
    const group = overlayRoot.children.find((c) => c.userData.kind === 'attachment' && c.userData.att === sel.att);
    const att = part.attachments[sel.att];
    if (group && att) att.position = roundVec(group.position.toArray());
  } else if (sel.kind === 'socket') {
    const att = part.attachments[sel.att];
    const group = overlayRoot.children.find((c) => c.userData.kind === 'attachment' && c.userData.att === sel.att);
    const sphere = group?.children.find((c) => c.userData.kind === 'socket' && c.userData.socket === sel.socket);
    if (att && group && sphere) {
      const local = group.worldToLocal(sphere.getWorldPosition(new THREE.Vector3()));
      const spacing = Number(att.spacing) > 0 ? Number(att.spacing) : 1;
      const next = att.sockets.slice();
      next[sel.socket] = roundVec([local.x / spacing, local.y / spacing, local.z / spacing]);
      att.sockets = next;
      renderSocketEditorValues();
    }
  } else if (sel.kind === 'cable') {
    const cable = (part.cableAttachments || [])[sel.att];
    const sphere = overlayRoot.children.find((c) => c.userData.kind === 'cable' && c.userData.att === sel.att);
    if (cable && sphere) {
      cable.position = roundVec(sphere.position.toArray());
      renderCables();
    }
  }
  renderStatus();
}

function roundVec(values) {
  return values.map((v) => Math.round(v * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

const loaders = {
  obj: { kind: 'text', parse: (data) => new OBJLoader().parse(data) },
  stl: { kind: 'buffer', parse: (data) => new THREE.Mesh(new STLLoader().parse(data), new THREE.MeshStandardMaterial({ color: 0xbcc4d0, roughness: 0.6 })) },
  ply: { kind: 'buffer', parse: (data) => new THREE.Mesh(new PLYLoader().parse(data), new THREE.MeshStandardMaterial({ color: 0xbcc4d0, roughness: 0.6 })) },
  glb: {
    kind: 'buffer',
    parse: (data, name, done, fail) => {
      new GLTFLoader().parse(data, '', (gltf) => done(gltf.scene), fail);
    },
  },
  gltf: {
    kind: 'text',
    parse: (data, name, done, fail) => {
      new GLTFLoader().parse(data, '', (gltf) => done(gltf.scene), fail);
    },
  },
  fbx: { kind: 'buffer', parse: (data) => new FBXLoader().parse(data, '') },
  dae: {
    kind: 'text',
    parse: (data, name, done, fail) => {
      try {
        const collada = new ColladaLoader().parse(data, '');
        done(collada.scene);
      } catch (error) {
        fail(error);
      }
    },
  },
};

function extensionOf(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

// True for the textures the editor keeps in its own state.
function isSharedTexture(texture) {
  if (!texture) return false;
  if (Object.values(state.previewTextures).includes(texture)) return true;
  for (const holder of Object.values(state.nodeTextures)) {
    if (Object.values(holder).includes(texture)) return true;
  }
  return false;
}

// Keeps the materials the loader created (with the textures of an .mtl file),
// so they can be shown again when the preview of the part material is switched off.
function keepOriginalMaterials() {
  if (!state.modelObject) return;
  state.modelObject.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    node.userData.originalMaterial = node.material;
  });
}

function setModel(object, fileName) {
  disposeModel();
  state.modelObject = object;
  state.modelLoaded = true;
  state.modelFileName = fileName;
  modelRoot.add(object);
  keepOriginalMaterials();
  applyModelTransform();
  applyModelMaterial();
  applyWireframe();
  updateReentryShell();
  $('drop-hint').style.display = 'none';
  state.modelNodeMap = buildModelNodeMap();
  previewBases.clear();
  state.explodeRest = object.children.map((child) => child.position.clone());
  state.explodeOffsets = null;
  // A new mesh is shown in its rest pose: a preview time left over from the
  // previous part would otherwise shift the animated nodes of the fresh model.
  state.animPreview.playing = false;
  state.animPreview.time = 0;
  state.animPreview.only = null;
  populateAnimationNodes();
  populateNodeMaterialSelect();
  // The node pickers of the modules (the gimbal chambers) list the nodes of the
  // mesh, so they are rebuilt when a mesh arrives.
  renderComponents();
  applyAnimationPreview();
  updatePreviewUi();
  updateModelInfo();
  scheduleVolumeMeasure();
  scheduleDynamicView();
  renderStatus();
}

function disposeModel() {
  state.dynamicProbe = null;
  disposeGroup(dynamicProbeRoot);
  clearDynamicView();
  if (!state.modelObject) return;
  if (reentryShell) {
    modelRoot.remove(reentryShell);
    reentryShell = null;
  }
  if (reentryGeometry) {
    reentryGeometry.dispose();
    reentryGeometry = null;
  }
  reentryTriangles = null;
  reentrySource = null;
  modelRoot.remove(state.modelObject);
  state.modelObject.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) {
        if (material.map) material.map.dispose();
        material.dispose();
      }
    }
  });
  state.modelObject = null;
  state.modelLoaded = false;
  state.modelNodeMap = null;
  invalidateVolume();
  renderVolumeInfo();
  previewBases.clear();
  state.explodeRest = null;
  state.explodeOffsets = null;
  populateAnimationNodes();
  populateNodeMaterialSelect();
}

// Removes the "l" (line) and "p" (point) elements of an OBJ.
function stripObjLines(text) {
  const lines = text.split('\n');
  const kept = [];
  let removed = 0;

  for (const line of lines) {
    if (/^\s*[lp]\s+\d/.test(line)) {
      removed++;
      continue;
    }
    kept.push(line);
  }

  return { text: kept.join('\n'), removed };
}

// The game's importer converts the source coordinate system (Blender: Y up,
// -Z forward) to Unity (Y up, +Z forward) by mirroring the model in X and
// flipping the winding. The preview does the same, so the part looks in the
// editor exactly like it does in the game and the attachments line up with the
// mesh. The export undoes the mirror again.
function mirrorModelX(root) {
  root.updateWorldMatrix(true, true);

  root.traverse((node) => {
    node.position.x = -node.position.x;

    if (!node.isMesh || !node.geometry) return;
    const geometry = node.geometry;

    const position = geometry.getAttribute('position');
    if (position) {
      for (let i = 0; i < position.count; i++) position.setX(i, -position.getX(i));
      position.needsUpdate = true;
    }

    const normal = geometry.getAttribute('normal');
    if (normal) {
      for (let i = 0; i < normal.count; i++) normal.setX(i, -normal.getX(i));
      normal.needsUpdate = true;
    }

    flipWinding(geometry);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  });
}

function flipWinding(geometry) {
  const index = geometry.getIndex();
  if (index) {
    const array = index.array;
    for (let i = 0; i + 2 < array.length; i += 3) {
      const temp = array[i];
      array[i] = array[i + 2];
      array[i + 2] = temp;
    }
    index.needsUpdate = true;
    return;
  }

  // Without an index buffer the vertices of every triangle have to be swapped
  // in all attributes.
  const count = geometry.getAttribute('position')?.count ?? 0;
  for (const attribute of Object.values(geometry.attributes)) {
    const itemSize = attribute.itemSize;
    for (let i = 0; i + 2 < count; i += 3) {
      for (let axis = 0; axis < itemSize; axis++) {
        const first = attribute.array[i * itemSize + axis];
        attribute.array[i * itemSize + axis] = attribute.array[(i + 2) * itemSize + axis];
        attribute.array[(i + 2) * itemSize + axis] = first;
      }
    }
    attribute.needsUpdate = true;
  }
}

const TEXTURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'tga', 'bmp', 'webp'];

// Blender writes an .mtl next to the .obj. When the user picks the mesh and its
// material file together, the textures of the model are applied to the preview
// and the colour of the material becomes the colour of the part.
async function loadMeshWithMaterials(files) {
  const list = [...files];
  const model = list.find((file) => extensionOf(file.name) !== 'mtl' && !TEXTURE_EXTENSIONS.includes(extensionOf(file.name)));
  const materialFile = list.find((file) => extensionOf(file.name) === 'mtl');
  const textureFiles = list.filter((file) => TEXTURE_EXTENSIONS.includes(extensionOf(file.name)));

  if (!model) return false;

  const loaded = await loadModelFile(model);
  if (!loaded || !materialFile) return loaded;

  try {
    const text = await materialFile.text();
    const materials = parseMtl(text);
    if (!materials.size) return loaded;

    // The texture of the material has to be picked together with it, the
    // browser cannot look next to the file on disk.
    const textures = new Map();
    const sources = new Map();
    for (const file of textureFiles) {
      const url = URL.createObjectURL(file);
      const texture = await new THREE.TextureLoader().loadAsync(url);
      URL.revokeObjectURL(url);
      textures.set(file.name.toLowerCase(), texture);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => readTextureSource(file, (source) => {
        sources.set(file.name.toLowerCase(), source);
        resolve();
      }));
    }

    // The loader keeps the name of the "usemtl" entry in the material slots, so
    // the colours and the textures of the .mtl can be put back on the model.
    const applied = applyMtlMaterials(materials, textures);

    // The first material becomes the material of the part, so the exported
    // part.json points at the texture file.
    const first = materials.values().next().value;
    const mapName = first.mapKd ? basename(first.mapKd).toLowerCase() : '';
    const map = mapName ? textures.get(mapName) : null;
    if (map) {
      state.part.material.albedo = basename(first.mapKd);
      state.previewTextures.albedo = map;
      state.textureSources.albedo = sources.get(mapName) || '';
      $('f-albedo').value = state.part.material.albedo;
    }
    if (first.color) {
      state.part.material.color = first.color;
      $('f-color').value = first.color;
    }

    applyModelMaterial();
    updateTextureButtons();
    renderStatus();
    statusLine(t('status.materialsLoaded', { name: materialFile.name, count: applied }), 'ok');
  } catch (error) {
    statusLine(t('status.modelFailed', { error: error.message || error }), 'bad');
  }

  return loaded;
}

// Puts the colours and the textures of an .mtl back onto the material slots of
// the loaded model. Returns how many slots got a texture.
function applyMtlMaterials(materials, textures) {
  if (!state.modelObject) return 0;
  let withTexture = 0;

  state.modelObject.traverse((node) => {
    if (!node.isMesh) return;
    // The part material may have replaced the materials of the model already,
    // the originals are kept aside.
    const target = node.userData.originalMaterial || node.material;
    if (!target) return;
    const slots = Array.isArray(target) ? target : [target];

    for (const slot of slots) {
      if (!slot) continue;
      const entry = materials.get(slot.name);
      if (!entry) continue;

      if (entry.color) slot.color.set(entry.color);
      if (entry.mapKd) {
        const texture = textures.get(basename(entry.mapKd).toLowerCase());
        if (texture) {
          slot.map = texture;
          withTexture++;
        }
      }
      if (entry.mapBump) {
        const texture = textures.get(basename(entry.mapBump).toLowerCase());
        if (texture) slot.normalMap = texture;
      }
      slot.needsUpdate = true;
    }
  });

  return withTexture;
}

function basename(path) {
  return String(path || '').split(/[\\/]/).pop();
}

// A small .mtl reader: newmtl, Kd, map_Kd, map_Bump, map_Kn, d.
function parseMtl(text) {
  const materials = new Map();
  let current = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0];

    if (key === 'newmtl') {
      current = { name: parts.slice(1).join(' '), color: null, mapKd: null, mapBump: null, mapKn: null };
      materials.set(current.name, current);
      continue;
    }

    if (!current) continue;

    if (key === 'Kd') {
      const values = parts.slice(1, 4).map(Number);
      if (values.length === 3 && values.every((value) => Number.isFinite(value))) {
        const toHex = (value) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0');
        current.color = `#${toHex(values[0])}${toHex(values[1])}${toHex(values[2])}`;
      }
    } else if (key === 'map_Kd') {
      current.mapKd = mtlFileName(parts.slice(1));
    } else if (key === 'map_Bump' || key === 'bump' || key === 'map_Kn' || key === 'norm') {
      // The map entries can carry options ("-s 1 1 1", "-o 0 0 0"), the file
      // name is the last token that looks like a file.
      const file = mtlFileName(parts.slice(1));
      if (key === 'map_Kn' || key === 'norm') current.mapKn = file;
      else current.mapBump = file;
    }
  }

  return materials;
}

// Picks the file name out of the arguments of a map entry.
function mtlFileName(parts) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const token = parts[i];
    if (!token || token.startsWith('-')) continue;
    if (/\.[A-Za-z0-9]+$/.test(token)) return token;
  }
  return parts.length ? parts[parts.length - 1] : '';
}

async function loadModelFile(file) {
  const ext = extensionOf(file.name);
  const loader = loaders[ext];
  if (!loader) {
    setStatusMessage('status.modelFailed', { error: ext || file.name });
    return false;
  }
  try {
    state.strippedLines = 0;
    const finish = (object) => {
      if (!object) return;
      mirrorModelX(object);
      setModel(object, file.name);
    };

    if (loader.kind === 'buffer') {
      const buffer = await file.arrayBuffer();
      if (loader.parse.length >= 4) {
        await new Promise((resolve, reject) => {
          loader.parse(buffer, file.name, resolve, reject);
        }).then(finish);
      } else {
        finish(loader.parse(buffer));
      }
    } else {
      let text = await file.text();
      if (ext === 'obj') {
        // Blender can export loose edges as "l" elements. three.js turns the whole
        // group into a LineSegments object and draws the vertices as a white
        // wireframe, so they are removed before parsing. The game cannot render
        // them either.
        const stripped = stripObjLines(text);
        if (stripped.removed > 0) {
          state.strippedLines = stripped.removed;
        }
        text = stripped.text;
      }
      if (loader.parse.length >= 4) {
        await new Promise((resolve, reject) => {
          loader.parse(text, file.name, resolve, reject);
        }).then(finish);
      } else {
        finish(loader.parse(text));
      }
    }
    state.part.model = file.name;
    $('f-model').value = file.name;
    statusLine(t('status.modelLoaded', { name: file.name }), 'ok');
    return true;
  } catch (error) {
    statusLine(t('status.modelFailed', { error: error.message || error }), 'bad');
    return false;
  }
}

function applyModelTransform() {
  const units = UNITS[state.part.units] ?? 1;
  const scale = Number(state.part.scale) > 0 ? Number(state.part.scale) : 1;
  modelRoot.scale.setScalar(units * scale);
  scheduleVolumeMeasure(180);
  scheduleDynamicView();
  updateReentryShell();
}

function applyPreviewTextures(material, textures) {
  const set = textures || state.previewTextures;
  const tiling = state.part.material.tiling || [1, 1];
  const offset = state.part.material.offset || [0, 0];
  const prepare = (texture) => {
    if (!texture) return null;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(Number(tiling[0]) || 1, Number(tiling[1]) || 1);
    texture.offset.set(Number(offset[0]) || 0, Number(offset[1]) || 0);
    texture.needsUpdate = true;
    return texture;
  };

  material.map = prepare(set.albedo);
  material.normalMap = prepare(set.normal);
  material.roughnessMap = prepare(set.mask);
  if (material.map) material.color.set(0xffffff);
  material.needsUpdate = true;
}

function applyModelMaterial() {
  if (!state.modelObject) return;
  const usePartMaterial = $('chk-material').checked;
  const overrides = nodeMaterialOverrides();
  let hidden = 0;

  state.modelObject.traverse((node) => {
    if (!isRenderableObject(node)) {
      // Lines and points (the "l" elements of an OBJ) are drawn as a white
      // wireframe by three.js, but the game cannot render them at all.
      hidden++;
      node.visible = false;
      return;
    }

    if (!node.isMesh) return;
    const override = overrides.get(relativeNodePath(node)) || null;
    const source = override || state.part.material;

    if (usePartMaterial) {
      const opacity = Math.min(1, Math.max(0, Number(source.opacity ?? 1)));
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(source.color || '#c8ccd4'),
        metalness: Number(source.metallic) || 0,
        roughness: 1 - (Number(source.smoothness) || 0),
        // The game culls back faces, so the preview does the same: otherwise a
        // one sided shell (a tank wall) would hide its own interior.
        side: THREE.FrontSide,
        transparent: opacity < 1,
        opacity,
        emissive: new THREE.Color(source.emissive || '#000000'),
        emissiveIntensity: Number(source.emissiveIntensity) || 0,
      });
      applyPreviewTextures(material, override ? state.nodeTextures[relativeNodePath(node)] : null);

      // A mesh with several material groups (a Blender object with more than
      // one material) keeps an array of materials.
      const original = node.userData.originalMaterial;
      const isOriginal = (material) => {
        if (!material || !original) return false;
        return Array.isArray(original) ? original.includes(material) : original === material;
      };
      const replace = (old) => {
        if (!old || isOriginal(old)) return;
        // The preview textures are shared between the meshes, they are disposed
        // by the texture state and not here.
        if (old.map && !isSharedTexture(old.map)) old.map.dispose();
        old.dispose();
      };

      if (Array.isArray(node.material)) {
        for (const old of node.material) replace(old);
        node.material = node.material.map(() => material);
      } else {
        replace(node.material);
        node.material = material;
      }
    } else if (node.userData.originalMaterial) {
      // The original materials of the model (with the textures of the .mtl
      // file) are shown when the preview of the part material is switched off.
      if (node.material !== node.userData.originalMaterial) {
        const list = Array.isArray(node.material) ? node.material : [node.material];
        for (const old of list) {
          if (!old) continue;
          if (old.map && !isSharedTexture(old.map)) old.map.dispose();
          old.dispose();
        }
        node.material = node.userData.originalMaterial;
      }
    } else if (!node.material) {
      node.material = new THREE.MeshStandardMaterial({ color: 0xbcc4d0, side: THREE.FrontSide });
    }
  });

  if (hidden > 0) {
    state.hiddenObjects = hidden;
  }
}

function applyWireframe() {
  if (!state.modelObject) return;
  const wireframe = $('chk-wireframe').checked;
  state.modelObject.traverse((node) => {
    if (node.isMesh && node.material) node.material.wireframe = wireframe;
  });
}

function applyLabels() {
  const visible = $('chk-labels').checked;
  overlayRoot.traverse((node) => {
    if (node.userData.label) node.visible = visible;
  });
}

const BOX = new THREE.Box3();
const SPHERE = new THREE.Sphere();

function fitView() {
  BOX.makeEmpty();
  BOX.expandByObject(modelRoot);
  BOX.expandByObject(overlayRoot);
  if (BOX.isEmpty()) {
    BOX.setFromCenterAndSize(new THREE.Vector3(0, 0.4, 0), new THREE.Vector3(2, 2, 2));
  }
  BOX.getBoundingSphere(SPHERE);
  if (![SPHERE.center.x, SPHERE.center.y, SPHERE.center.z, SPHERE.radius].every(Number.isFinite)) {
    SPHERE.center.set(0, 0.4, 0);
    SPHERE.radius = 1;
  }
  const radius = Math.max(SPHERE.radius, 0.3);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.25;
  const dir = camera.position.clone().sub(orbit.target).normalize();
  if (dir.lengthSq() < 0.5) dir.set(1, 0.8, 1.4).normalize();
  orbit.target.copy(SPHERE.center);
  camera.position.copy(SPHERE.center).addScaledVector(dir, distance);
  camera.near = Math.max(distance / 1000, 0.001);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  orbit.update();
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function pointerNdc(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

canvas.addEventListener('pointerdown', (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener('pointerup', (event) => {
  if (!pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;
  if (moved > 4 || transform.dragging) return;

  pointerNdc(event);
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.intersectObject(transform.getHelper(), true).length) return;

  const hits = raycaster.intersectObjects(overlayRoot.children, true);
  if (!hits.length) {
    select(null);
    return;
  }
  let hit = hits[0].object;
  while (hit && !hit.userData?.kind) hit = hit.parent;
  if (hit?.userData?.kind) {
    select({
      kind: hit.userData.kind,
      att: hit.userData.att,
      socket: hit.userData.socket,
    });
  }
});

function select(selection) {
  state.selection = selection;
  refreshStructure();
}

// ---------------------------------------------------------------------------
// UI: selects and part fields
// ---------------------------------------------------------------------------

function fillSelect(select, values, labeler = (v) => v) {
  select.textContent = '';
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = labeler(value);
    select.append(option);
  }
}

fillSelect($('f-category'), CATEGORIES);
fillSelect($('f-units'), Object.keys(UNITS));

$('lang-select').addEventListener('change', () => {
  setLang($('lang-select').value);
  populateExamples();
  populateComponentSelect();
  populateVariantTypes();
  populateAnimationNodes();
  populateNodeMaterialSelect();
  refreshStructure();
});

function bindPartField(id, read, write) {
  const element = $(id);
  element.addEventListener('input', () => {
    write(read(element));
    onPartEdited();
  });
}

const asString = (el) => el.value;
const asNumber = (el) => (el.value === '' ? 0 : Number(el.value));

bindPartField('f-id', asString, (v) => { state.part.id = v.trim(); });
bindPartField('f-name', asString, (v) => { state.part.name = v; });
bindPartField('f-description', asString, (v) => { state.part.description = v; });
bindPartField('f-category', asString, (v) => { state.part.category = v; });
bindPartField('f-mass', asNumber, (v) => {
  state.part.mass = v;
  updateModelInfo();
});
bindPartField('f-impact', asNumber, (v) => { state.part.impactTolerance = v; });
bindPartField('f-assembly', asNumber, (v) => { state.part.assemblyPosition = v; });
bindPartField('f-defindex', asNumber, (v) => { state.part.defindex = Math.max(0, Math.floor(v)); });
bindPartField('f-tags', asString, (v) => {
  state.part.tags = v.split(',').map((s) => s.trim()).filter(Boolean);
});
bindPartField('f-model', asString, (v) => {
  state.part.model = v.trim();
  if (state.modelFileName && state.part.model !== state.modelFileName) {
    $('drop-hint').style.display = '';
  }
});
bindPartField('f-units', asString, (v) => {
  state.part.units = v;
  applyModelTransform();
  updateModelInfo();
});
bindPartField('f-scale', asNumber, (v) => {
  state.part.scale = v > 0 ? v : 1;
  applyModelTransform();
  updateModelInfo();
});
bindPartField('f-physics', asString, (v) => { state.part.physicsModel = v.trim(); });
bindPartField('f-icon', asString, (v) => { state.part.icon = v.trim(); });
bindPartField('f-color', asString, (v) => {
  state.part.material.color = v;
  applyModelMaterial();
});
bindPartField('f-metallic', asNumber, (v) => {
  state.part.material.metallic = Math.min(1, Math.max(0, v));
  applyModelMaterial();
});
bindPartField('f-smoothness', asNumber, (v) => {
  state.part.material.smoothness = Math.min(1, Math.max(0, v));
  applyModelMaterial();
});
bindPartField('f-emissive', asString, (v) => {
  state.part.material.emissive = v;
  applyModelMaterial();
});
bindPartField('f-emissive-intensity', asNumber, (v) => {
  state.part.material.emissiveIntensity = Math.max(0, v);
  applyModelMaterial();
});
bindPartField('f-opacity', asNumber, (v) => {
  state.part.material.opacity = Math.min(1, Math.max(0, v));
  applyModelMaterial();
});
bindPartField('f-tiling', asString, (v) => {
  state.part.material.tiling = parsePair(v, [1, 1]);
  applyModelMaterial();
});
bindPartField('f-offset', asString, (v) => {
  state.part.material.offset = parsePair(v, [0, 0]);
  applyModelMaterial();
});
bindPartField('f-albedo', asString, (v) => { state.part.material.albedo = v.trim(); });
bindPartField('f-normal', asString, (v) => { state.part.material.normal = v.trim(); });
bindPartField('f-mask', asString, (v) => { state.part.material.mask = v.trim(); });
bindPartField('f-radial', asNumber, (v) => { state.part.radialSnapping = v; });

$('chk-material').addEventListener('change', () => { applyModelMaterial(); applyWireframe(); });
$('chk-wireframe').addEventListener('change', applyWireframe);
$('chk-labels').addEventListener('change', applyLabels);
$('chk-grid').addEventListener('change', () => { grid.visible = $('chk-grid').checked; });
$('chk-snap').addEventListener('change', updateSnap);

// ---------------------------------------------------------------------------
// Textures and per node materials
// ---------------------------------------------------------------------------

function toPair(value, fallback) {
  if (Array.isArray(value) && value.length >= 2) {
    const numbers = value.map((v) => Number(v));
    return numbers.every((v) => Number.isFinite(v)) ? numbers.slice(0, 2) : fallback.slice();
  }
  if (typeof value === 'string') {
    return parsePair(value, fallback);
  }
  return fallback.slice();
}

function parsePair(text, fallback) {
  const parts = String(text || '').split(',').map((s) => Number(s.trim()));
  if (parts.length < 2 || parts.some((v) => !Number.isFinite(v))) return fallback.slice();
  return parts.slice(0, 2);
}

function loadPreviewTexture(file, key) {
  const url = URL.createObjectURL(file);
  new THREE.TextureLoader().load(url, (texture) => {
    URL.revokeObjectURL(url);
    const previous = state.previewTextures[key];
    state.previewTextures[key] = texture;
    if (previous) previous.dispose();
    applyModelMaterial();
  }, undefined, () => {
    URL.revokeObjectURL(url);
    statusLine(t('status.textureFailed', { name: file.name }), 'bad');
  });
}

function bindTextureInput(inputId, fileId, key, materialKey) {
  $(fileId).addEventListener('change', () => {
    const file = $(fileId).files[0];
    if (!file) return;
    state.part.material[materialKey] = file.name;
    $(inputId).value = file.name;
    loadPreviewTexture(file, key);
    readTextureSource(file, (source) => {
      state.textureSources[key] = source;
    });
    updateTextureButtons();
  });
  $(inputId).addEventListener('input', () => {
    state.part.material[materialKey] = $(inputId).value.trim();
  });
}

// Keeps the texture file as a data url, so the library can restore it.
function readTextureSource(file, done) {
  const reader = new FileReader();
  reader.onload = () => done(String(reader.result || ''));
  reader.onerror = () => done('');
  reader.readAsDataURL(file);
}

function loadTextureFromSource(source, done) {
  if (!source) {
    done(null);
    return;
  }
  new THREE.TextureLoader().load(source, (texture) => done(texture), undefined, () => done(null));
}

const TEXTURE_KEYS = [
  { key: 'albedo', materialKey: 'albedo', inputId: 'f-albedo', clearId: 'btn-clear-albedo' },
  { key: 'normal', materialKey: 'normal', inputId: 'f-normal', clearId: 'btn-clear-normal' },
  { key: 'mask', materialKey: 'mask', inputId: 'f-mask', clearId: 'btn-clear-mask' },
];

function clearPreviewTextures() {
  for (const key of Object.keys(state.previewTextures)) {
    const texture = state.previewTextures[key];
    if (texture) texture.dispose();
    state.previewTextures[key] = null;
    state.textureSources[key] = '';
  }
  for (const path of Object.keys(state.nodeTextures)) {
    const holder = state.nodeTextures[path];
    for (const key of Object.keys(holder)) {
      if (holder[key]) holder[key].dispose();
      holder[key] = null;
    }
    delete state.nodeTextures[path];
  }
  for (const path of Object.keys(state.nodeTextureSources)) {
    delete state.nodeTextureSources[path];
  }
  updateTextureButtons();
}

// Removes a texture from the part and from the preview.
function clearTexture(texture) {  state.part.material[texture.materialKey] = '';
  $(texture.inputId).value = '';

  const preview = state.previewTextures[texture.key];
  if (preview) preview.dispose();
  state.previewTextures[texture.key] = null;
  state.textureSources[texture.key] = '';

  applyModelMaterial();
  updateTextureButtons();
  renderStatus();
}

function updateTextureButtons() {
  for (const texture of TEXTURE_KEYS) {
    const button = $(texture.clearId);
    if (!button) continue;
    button.disabled = !state.part.material?.[texture.materialKey] && !state.previewTextures[texture.key];
  }
}

for (const texture of TEXTURE_KEYS) {
  $(texture.clearId).addEventListener('click', () => clearTexture(texture));
}

bindTextureInput('f-albedo', 'file-albedo', 'albedo', 'albedo');
bindTextureInput('f-normal', 'file-normal', 'normal', 'normal');
bindTextureInput('f-mask', 'file-mask', 'mask', 'mask');

function relativeNodePath(node) {
  const parts = [];
  let current = node;
  while (current && current !== state.modelObject) {
    parts.unshift(current.name);
    current = current.parent;
  }
  return parts.join('/');
}

function nodeMaterialOverrides() {
  const map = new Map();
  for (const entry of state.part.materials || []) {
    if (!entry || !entry.node) continue;
    const key = entry.node.startsWith('model/') ? entry.node.slice('model/'.length) : entry.node;
    map.set(key, entry);
  }
  return map;
}

function populateNodeMaterialSelect() {
  const select = $('node-material-select');
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '';

  const paths = modelNodePaths();
  if (!paths.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = t('anim.noNodes');
    select.append(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const path of paths) {
    const option = document.createElement('option');
    option.value = path;
    option.textContent = path;
    select.append(option);
  }
  if (paths.includes(previous)) select.value = previous;
}

function nodeMaterialField(key, entry, type, label) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';
  const caption = document.createElement('label');
  caption.textContent = label;
  wrapper.append(caption);

  const write = (value) => {
    entry[key] = value;
    applyModelMaterial();
    renderStatus();
  };

  if (type === 'color') {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = entry[key] || '#000000';
    input.addEventListener('input', () => write(input.value));
    wrapper.append(input);
    return wrapper;
  }

  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  if (key === 'opacity') {
    input.min = '0';
    input.max = '1';
    input.step = '0.05';
  }
  input.value = entry[key] ?? '';
  input.addEventListener('input', () => write(Number(input.value) || 0));
  wrapper.append(input);
  return wrapper;
}

// A texture of a single node: a file name, a picker and a remove button.
function nodeTextureField(entry, key, label, nodePath) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';
  const caption = document.createElement('label');
  caption.textContent = label;
  wrapper.append(caption);

  const row = document.createElement('div');
  row.className = 'input-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.value = entry[key] || '';

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.png,.jpg,.jpeg,.tga,.bmp';
  file.hidden = true;
  file.id = `node-file-${nodePath.replace(/[^a-z0-9]+/gi, '-')}-${key}`;

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'btn small';
  pick.textContent = t('btn.pick');
  pick.addEventListener('click', () => file.click());

  const clear = document.createElement('button');
  clear.className = 'icon-btn';
  clear.textContent = '✕';
  clear.title = t('btn.clearTexture');
  clear.disabled = !entry[key];

  input.addEventListener('input', () => {
    entry[key] = input.value.trim();
    clear.disabled = !entry[key];
    applyModelMaterial();
    renderStatus();
  });

  file.addEventListener('change', () => {
    const selected = file.files[0];
    if (!selected) return;
    entry[key] = selected.name;
    input.value = selected.name;
    clear.disabled = false;
    loadNodeTexture(nodePath, key, selected);
    readTextureSource(selected, (source) => {
      if (!state.nodeTextureSources[nodePath]) state.nodeTextureSources[nodePath] = {};
      state.nodeTextureSources[nodePath][key] = source;
    });
  });

  clear.addEventListener('click', () => {
    entry[key] = '';
    input.value = '';
    clear.disabled = true;
    clearNodeTexture(nodePath, key);
    if (state.nodeTextureSources[nodePath]) state.nodeTextureSources[nodePath][key] = '';
    applyModelMaterial();
    renderStatus();
  });

  row.append(input, pick, file, clear);
  wrapper.append(row);
  return wrapper;
}

function loadNodeTexture(nodePath, key, file) {
  const url = URL.createObjectURL(file);
  new THREE.TextureLoader().load(url, (texture) => {
    URL.revokeObjectURL(url);
    if (!state.nodeTextures[nodePath]) state.nodeTextures[nodePath] = {};
    const previous = state.nodeTextures[nodePath][key];
    if (previous) previous.dispose();
    state.nodeTextures[nodePath][key] = texture;
    applyModelMaterial();
  }, undefined, () => {
    URL.revokeObjectURL(url);
    statusLine(t('status.textureFailed', { name: file.name }), 'bad');
  });
}

function clearNodeTexture(nodePath, key) {
  const holder = state.nodeTextures[nodePath];
  if (!holder) return;
  if (holder[key]) holder[key].dispose();
  holder[key] = null;
}

function renderNodeMaterials() {
  const list = $('node-material-list');
  if (!list) return;
  list.textContent = '';

  const materials = state.part.materials || [];
  if (!materials.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = t('nodeMat.empty');
    list.append(empty);
  }

  materials.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'component-row' + (state.nodeMaterial === index ? ' selected' : '');

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = entry.node || '?';

    const title = document.createElement('span');
    title.className = 'label';
    title.textContent = entry.color || '#c8ccd4';

    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.textContent = '✕';
    remove.title = t('comp.remove');
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      materials.splice(index, 1);
      if (state.nodeMaterial === index) state.nodeMaterial = null;
      renderNodeMaterials();
      applyModelMaterial();
      renderStatus();
    });

    row.append(badge, title, remove);
    row.addEventListener('click', () => {
      state.nodeMaterial = state.nodeMaterial === index ? null : index;
      renderNodeMaterials();
    });
    list.append(row);

    if (state.nodeMaterial !== index) return;

    const editor = document.createElement('div');
    editor.className = 'component-editor';
    const nodePath = entry.node?.startsWith('model/') ? entry.node.slice('model/'.length) : (entry.node || '');
    editor.append(nodeMaterialField('color', entry, 'color', t('field.color')));
    editor.append(nodeMaterialField('metallic', entry, 'number', t('field.metallic')));
    editor.append(nodeMaterialField('smoothness', entry, 'number', t('field.smoothness')));
    editor.append(nodeMaterialField('emissive', entry, 'color', t('field.emissive')));
    editor.append(nodeMaterialField('emissiveIntensity', entry, 'number', t('field.emissiveIntensity')));
    editor.append(nodeMaterialField('opacity', entry, 'number', t('field.opacity')));
    editor.append(nodeTextureField(entry, 'albedo', t('field.albedo'), nodePath));
    editor.append(nodeTextureField(entry, 'normal', t('field.normal'), nodePath));
    editor.append(nodeTextureField(entry, 'mask', t('field.mask'), nodePath));
    list.append(editor);
  });
}

// ---------------------------------------------------------------------------
// Variants: fuel types, decoupler modes and other part variants
// ---------------------------------------------------------------------------

const VARIANT_TYPES = [
  'contentsType',
  'decoupleMode',
  'decouplerModule',
  'passResources',
  'controlSurface',
  'electricMotor',
  'heatShield',
];

// The fuel contents of the game. The ids, the subcategories and the icons are the ones
// of the stock tanks, so the picker of the game groups the variants the same way and the
// fuel icons of the game are used.
// "perCubic" is the amount of the propellant per cubic metre of the tank, "ratio" the
// mass of the oxidiser against the mass of the fuel.
const PROPELLANTS = [
  {
    key: 'empty',
    label: { en: 'Empty', ru: 'Пусто' },
    id: -2,
    subcategory: 1,
    name: '',
    icon: 'rocket_parts/no_fuel.png',
    modules: [],
  },
  {
    key: 'hydrazine',
    label: { en: 'Hydrazine', ru: 'Гидразин' },
    id: 20,
    subcategory: 1,
    name: '-H',
    icon: 'rocket_parts/hydrazine_droplet.png',
    modules: [{ module: 'Model.N2H4Module', perCubic: 890 }],
  },
  {
    key: 'keroseneO2',
    label: { en: 'Kerosene + O2', ru: 'Керосин + O2' },
    id: 5,
    subcategory: 2,
    name: '-K+O₂',
    icon: 'rocket_parts/kerosene_and_o2.png',
    modules: [
      { module: 'Model.KeroseneModule', perCubic: 317 },
      { module: 'Model.O2Module', ratio: 1.698 },
    ],
  },
  {
    key: 'ch4O2',
    label: { en: 'Methane + O2', ru: 'Метан + O2' },
    id: 8,
    subcategory: 2,
    name: '-CH₄+O₂',
    icon: 'rocket_parts/ch4_and_o2.png',
    modules: [
      { module: 'Model.CH4Module', perCubic: 367 },
      { module: 'Model.O2Module', ratio: 1.331 },
    ],
  },
  {
    key: 'h2O2',
    label: { en: 'Hydrogen + O2', ru: 'Водород + O2' },
    id: 2,
    subcategory: 2,
    name: '-H₂+O₂',
    icon: 'rocket_parts/h2_and_o2.png',
    modules: [
      { module: 'Model.H2Module', perCubic: 671 },
      { module: 'Model.O2Module', ratio: 0.274 },
    ],
  },
  {
    key: 'udmhN2O4',
    label: { en: 'UDMH + N2O4', ru: 'УДМХ + N2O4' },
    id: -1,
    subcategory: 2,
    name: '-UDMH+N₂O₄',
    icon: 'rocket_parts/udmh_and_n2o4.png',
    modules: [
      { module: 'Model.UDMHModule', perCubic: 324 },
      { module: 'Model.N2O4Module', ratio: 1.642 },
    ],
  },
  {
    key: 'kerosene',
    label: { en: 'Kerosene', ru: 'Керосин' },
    id: 6,
    subcategory: 3,
    name: '-K',
    icon: 'rocket_parts/kerosene_droplet.png',
    modules: [{ module: 'Model.KeroseneModule', perCubic: 890 }],
  },
  {
    key: 'ch4',
    label: { en: 'Methane', ru: 'Метан' },
    id: 9,
    subcategory: 3,
    name: '-CH₄',
    icon: 'rocket_parts/ch4_droplet.png',
    modules: [{ module: 'Model.CH4Module', perCubic: 890 }],
  },
  {
    key: 'h2',
    label: { en: 'Hydrogen', ru: 'Водород' },
    id: 3,
    subcategory: 3,
    name: '-H₂',
    icon: 'rocket_parts/h2_droplet.png',
    modules: [{ module: 'Model.H2Module', perCubic: 890 }],
  },
  {
    key: 'udmh',
    label: { en: 'UDMH', ru: 'УДМХ' },
    id: 0,
    subcategory: 3,
    name: '-UDMH',
    icon: 'rocket_parts/udmh_droplet.png',
    modules: [{ module: 'Model.UDMHModule', perCubic: 890 }],
  },
  {
    key: 'o2',
    label: { en: 'Oxygen', ru: 'Кислород' },
    id: 4,
    subcategory: 4,
    name: '-O₂',
    icon: 'rocket_parts/o2_droplet.png',
    modules: [{ module: 'Model.O2Module', perCubic: 890 }],
  },
  {
    key: 'n2o4',
    label: { en: 'N2O4', ru: 'N2O4' },
    id: 1,
    subcategory: 4,
    name: '-N₂O₄',
    icon: 'rocket_parts/n2o4_droplet.png',
    modules: [{ module: 'Model.N2O4Module', perCubic: 890 }],
  },
];

// Fills a variant with the contents of a fuel of the game: the modules of the
// propellant, the amounts (scaled with the size of the tank), the id and the icon
// the game uses for the fuel picker.
function applyPropellant(variant, key) {
  const propellant = PROPELLANTS.find((item) => item.key === key);
  if (!propellant) return;

  const volume = Math.max(meshVolume(), 0.1);
  const config = {};
  const state = {};
  let fuelAmount = 0;

  for (const module of propellant.modules) {
    const amount = module.ratio
      ? Math.round(fuelAmount * module.ratio * 100) / 100
      : Math.round(volume * module.perCubic * 100) / 100;
    config[module.module] = { maxAmount: amount };
    state[module.module] = { amount };
    if (!module.ratio) fuelAmount = amount;
  }

  variant.propellant = propellant.key;
  variant.type = 'contentsType';
  variant.id = propellant.id;
  variant.subcategory = propellant.subcategory;
  variant.name = propellant.name;
  variant.iconName = propellant.icon;
  variant.config = config;
  variant.state = state;
  clampVariantFuel(variant);
}

// The amounts of a propellant are scaled from the size of the tank, which is the
// sum of the meshes. The game bakes a union volume instead and compares the fuel
// with it: a tank whose meshes overlap or whose surface is open gets less, and a
// part filled to the brim makes the temperature of the whole rocket NaN. So the
// picker scales the amounts down to the safe share of the measured volume.
function clampVariantFuel(variant) {
  const status = fuelStatus(fuelUnitsOf(variant.config));
  if (!status) return;
  const limit = status.volume * FUEL_SAFE_RATIO * 1000;
  const units = fuelUnitsOf(variant.config);
  if (units <= limit) return;

  const factor = limit / units;
  for (const key of FUEL_MODULE_KEYS) {
    for (const bucket of [variant.config, variant.state]) {
      const entry = bucket && bucket[key];
      if (!entry) continue;
      for (const field of ['maxAmount', 'amount']) {
        const value = Number(entry[field]);
        if (Number.isFinite(value) && value > 0) {
          entry[field] = Math.round(value * factor * 10) / 10;
        }
      }
    }
  }

  const fitted = fuelUnitsOf(variant.config);
  statusLine(t('volume.clamped', {
    units: Math.round(fitted),
    m3: (fitted / 1000).toFixed(2),
  }), 'warn');
}

function variantTypeLabel(type) {
  return type || '?';
}

function populateVariantTypes() {
  const select = $('variant-select');
  if (!select) return;
  select.innerHTML = '';
  for (const type of VARIANT_TYPES) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    select.append(option);
  }
}

function variantField(key, variant, type, label) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';
  const caption = document.createElement('label');
  caption.textContent = label;
  wrapper.append(caption);

  const write = (value) => {
    variant[key] = value;
    renderStatus();
  };

  if (type === 'json') {
    const textarea = document.createElement('textarea');
    textarea.className = 'code';
    textarea.rows = 3;
    textarea.value = JSON.stringify(variant[key] ?? {}, null, 2);
    textarea.addEventListener('input', () => {
      try {
        write(JSON.parse(textarea.value || '{}'));
        textarea.classList.remove('invalid');
      } catch {
        textarea.classList.add('invalid');
      }
    });
    wrapper.append(textarea);
    return wrapper;
  }

  if (type === 'select') {
    const select = document.createElement('select');
    for (const option of PROPELLANTS) {
      const node = document.createElement('option');
      node.value = option.key;
      node.textContent = componentText(option.label);
      select.append(node);
    }
    select.value = variant.propellant || PROPELLANTS[0].key;
    select.addEventListener('change', () => {
      applyPropellant(variant, select.value);
      renderVariants();
      renderStatus();
    });
    wrapper.append(select);
    return wrapper;
  }

  const input = document.createElement('input');
  input.type = type === 'number' ? 'number' : 'text';
  if (type === 'number') input.step = 'any';
  input.value = variant[key] ?? '';
  input.addEventListener('input', () => {
    write(type === 'number' ? (Number(input.value) || 0) : input.value);
  });
  wrapper.append(input);
  return wrapper;
}

function renderVariants() {
  const list = $('variant-list');
  if (!list) return;
  list.textContent = '';

  const variants = state.part.variants || [];
  if (!variants.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = t('variant.empty');
    list.append(empty);
  }

  variants.forEach((variant, index) => {
    const row = document.createElement('div');
    row.className = 'component-row' + (state.variant === index ? ' selected' : '');

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = variantTypeLabel(variant.type);

    const title = document.createElement('span');
    title.className = 'label';
    title.textContent = variant.name || variant.module || variant.id || '';

    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.textContent = '✕';
    remove.title = t('comp.remove');
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      variants.splice(index, 1);
      if (state.variant === index) state.variant = null;
      renderVariants();
      renderStatus();
    });

    row.append(badge, title, remove);
    row.addEventListener('click', () => {
      state.variant = state.variant === index ? null : index;
      renderVariants();
    });
    list.append(row);

    if (state.variant !== index) return;

    const editor = document.createElement('div');
    editor.className = 'component-editor';
    if (variant.type === 'contentsType') {
      editor.append(variantField('propellant', variant, 'select', t('variant.propellant')));
    }
    editor.append(variantField('type', variant, 'text', t('variant.type')));
    editor.append(variantField('module', variant, 'text', t('variant.module')));
    editor.append(variantField('id', variant, 'number', t('variant.id')));
    editor.append(variantField('name', variant, 'text', t('variant.name')));
    editor.append(variantField('iconName', variant, 'text', t('variant.icon')));
    editor.append(variantField('subcategory', variant, 'number', t('variant.subcategory')));
    editor.append(variantField('massDelta', variant, 'number', t('variant.massDelta')));
    editor.append(variantField('config', variant, 'json', t('variant.config')));
    editor.append(variantField('state', variant, 'json', t('variant.state')));
    editor.append(variantField('overrides', variant, 'json', t('variant.overrides')));

    // The fuel of a tank variant has to fit the volume the game bakes.
    if (variant.type === 'contentsType') {
      const units = fuelUnitsOf(variant.config);
      const status = fuelStatus(units);
      if (units > 0 && status) {
        editor.append(volumeRowElement(status.kind, t('volume.variant', {
          units: Math.round(units),
          m3: (units / 1000).toFixed(2),
          percent: (status.ratio * 100).toFixed(0),
        })));
      } else if (units > 0 && !state.modelObject) {
        editor.append(volumeRowElement('warn', t('volume.variantNoMesh')));
      }
    }
    list.append(editor);
  });
}

$('btn-add-variant').addEventListener('click', () => {
  const type = $('variant-select').value || 'contentsType';
  state.part.variants = state.part.variants || [];
  const variant = {
    type,
    id: state.part.variants.length,
    name: '',
    iconName: '',
    massDelta: 0,
    config: {},
    state: {},
  };

  if (type === 'contentsType') {
    applyPropellant(variant, PROPELLANTS[0].key);
  }

  state.part.variants.push(variant);
  state.variant = state.part.variants.length - 1;
  renderVariants();
  renderStatus();
});

// ---------------------------------------------------------------------------
// Engine effects: the sounds and the flame prefabs of the game
// ---------------------------------------------------------------------------

const ENGINE_EFFECTS_KEY = 'Model.EngineEffectsModule';

function renderEngineEffects() {
  const wrap = $('engine-effects');
  if (!wrap) return;
  wrap.textContent = '';

  const modules = state.part.modules || (state.part.modules = {});
  const module = modules[ENGINE_EFFECTS_KEY];

  if (module) {
    // The game creates the modules of a part by walking its state: a module of
    // the config without an entry in the state is never created, so the flame
    // and the sound of the engine would be missing.
    const states = state.part.state || (state.part.state = {});
    if (!states[ENGINE_EFFECTS_KEY]) {
      states[ENGINE_EFFECTS_KEY] = {};
      commitComponents();
    }
  }

  if (!module) {
    const button = document.createElement('button');
    button.className = 'btn small';
    button.textContent = t('btn.addEngineEffects');
    button.addEventListener('click', () => {
      state.part.modules[ENGINE_EFFECTS_KEY] = {
        sound: 'rocket_engine_heavy',
        flames: ['engine_0_flame'],
      };
      // The game creates the modules of a part by walking its state: a module
      // of the config without an entry in the state is never created.
      const states = state.part.state || (state.part.state = {});
      if (!states[ENGINE_EFFECTS_KEY]) states[ENGINE_EFFECTS_KEY] = {};
      commitComponents();
      renderEngineEffects();
    });
    wrap.append(button);
    return;
  }

  const select = (labelText, value, options, onChange) => {
    const field = document.createElement('div');
    field.className = 'field';

    const label = document.createElement('label');
    label.textContent = labelText;
    field.append(label);

    const dropdown = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = t('engineEffects.none');
    dropdown.append(empty);
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option;
      node.textContent = option;
      dropdown.append(node);
    }
    if (value && !options.includes(value)) {
      const custom = document.createElement('option');
      custom.value = value;
      custom.textContent = value;
      dropdown.append(custom);
    }
    dropdown.value = value || '';
    dropdown.addEventListener('change', () => onChange(dropdown.value));
    field.append(dropdown);
    return field;
  };

  wrap.append(select(t('engineEffects.sound'), module.sound, ENGINE_SOUNDS, (value) => {
    if (value) module.sound = value;
    else delete module.sound;
    commitComponents();
  }));

  wrap.append(select(t('engineEffects.startSound'), module.startSound, ENGINE_SOUNDS, (value) => {
    if (value) module.startSound = value;
    else delete module.startSound;
    commitComponents();
  }));

  wrap.append(select(t('engineEffects.endSound'), module.endSound, ENGINE_SOUNDS, (value) => {
    if (value) module.endSound = value;
    else delete module.endSound;
    commitComponents();
  }));

  // The flames: a list of the prefabs of the game.
  const flamesField = document.createElement('div');
  flamesField.className = 'field';
  const flamesLabel = document.createElement('label');
  flamesLabel.textContent = t('engineEffects.flames');
  flamesField.append(flamesLabel);

  const list = document.createElement('div');
  list.className = 'compact-list';
  const flames = Array.isArray(module.flames) ? module.flames : [];

  flames.forEach((flame, index) => {
    const row = document.createElement('div');
    row.className = 'transition-row';

    const dropdown = document.createElement('select');
    for (const option of ENGINE_FLAMES) {
      const node = document.createElement('option');
      node.value = option;
      node.textContent = option;
      dropdown.append(node);
    }

    // The custom flames of the part: they are the flames of the editor, the
    // loader builds them from the files of the pack.
    const custom = customFlameNames();
    if (custom.length) {
      const group = document.createElement('optgroup');
      group.label = t('engineEffects.customFlames');
      for (const option of custom) {
        const node = document.createElement('option');
        node.value = option;
        node.textContent = option;
        group.append(node);
      }
      dropdown.append(group);
    }

    if (flame && !ENGINE_FLAMES.includes(flame) && !custom.includes(flame)) {
      const custom = document.createElement('option');
      custom.value = flame;
      custom.textContent = flame;
      dropdown.append(custom);
    }
    dropdown.value = flame || '';
    dropdown.addEventListener('change', () => {
      flames[index] = dropdown.value;
      module.flames = flames;
      commitComponents();
    });

    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.textContent = '✕';
    remove.title = t('comp.remove');
    remove.addEventListener('click', () => {
      flames.splice(index, 1);
      module.flames = flames;
      commitComponents();
      renderEngineEffects();
    });

    row.append(dropdown, remove);
    list.append(row);
  });

  const add = document.createElement('button');
  add.className = 'btn small';
  add.textContent = t('btn.addFlame');
  add.addEventListener('click', () => {
    flames.push(ENGINE_FLAMES[0]);
    module.flames = flames;
    commitComponents();
    renderEngineEffects();
  });
  list.append(add);

  flamesField.append(list);
  wrap.append(flamesField);
}

// ---------------------------------------------------------------------------
// Check before the game
// ---------------------------------------------------------------------------

const KNOWN_VARIANT_TYPES = new Set(VARIANT_TYPES);
let GAME_MODULE_NAMES = new Set();

// All the modules the game uses, taken from the stock parts.
let gameModules = null;
async function getGameModules() {
  if (gameModules) return gameModules;

  const { STOCK_PARTS } = await import('./stock-parts.js');
  const set = new Set();
  for (const part of STOCK_PARTS) {
    for (const key of Object.keys(part.modules || {})) set.add(key);
    for (const key of Object.keys(part.state || {})) set.add(key);
    for (const variant of part.variants || []) {
      for (const key of Object.keys(variant.config || {})) set.add(key);
      for (const key of Object.keys(variant.state || {})) set.add(key);
    }
  }

  gameModules = set;
  return set;
}

function runCheck() {
  const list = $('check-list');
  list.textContent = '';
  const part = state.part;
  const checks = [];

  const add = (kind, text) => checks.push({ kind, text });

  // The mesh
  if (!state.modelObject) {
    add('error', t('check.noMesh'));
  } else if (!meshHasTriangles()) {
    add('error', t('check.emptyMesh'));
  } else {
    add('ok', t('check.meshOk'));
  }

  // The mesh itself: the game cannot draw a few of the things three.js can, so
  // the faces are looked at before the export.
  const mesh = inspectMesh();
  if (state.modelObject && mesh.faces > 0) {
    if (mesh.broken > 0) add('error', t('check.meshBroken', { n: mesh.broken }));
    if (mesh.degenerate > 0) add('warn', t('check.meshDegenerate', { n: mesh.degenerate }));
    if (mesh.withoutNormals > 0) add('warn', t('check.meshNoNormals', { n: mesh.withoutNormals }));
    if (mesh.withoutUv > 0) add('warn', t('check.meshNoUv', { n: mesh.withoutUv }));
  }

  // The schema of part.json: the loader checks the same rules, so what is wrong
  // here is what the game would refuse.
  if (state.schema) {
    const schemaCheck = validateAgainstSchema(toJson(state.part), state.schema);
    for (const error of schemaCheck.errors) add('error', error);
    for (const warning of schemaCheck.warnings) add('warn', warning);
    if (!schemaCheck.errors.length && !schemaCheck.warnings.length) {
      add('ok', t('check.schemaOk'));
    }
  }

  // The defindex
  if (part.defindex) {
    add('ok', t('check.defindexSet', { id: part.defindex }));
  } else {
    add('warn', t('check.defindexAuto'));
  }

  // The modules
  const moduleKeys = Object.keys(part.modules || {});
  const unknown = moduleKeys.filter((key) => !COMPONENT_BY_KEY[key] && !GAME_MODULE_NAMES.has(key));
  if (unknown.length) {
    add('error', t('check.unknownModules', { names: unknown.join(', ') }));
  } else if (!moduleKeys.length) {
    add('warn', t('check.noModules'));
  } else {
    add('ok', t('check.modulesOk', { n: moduleKeys.length }));
  }

  // The textures
  const textures = part.material || {};
  const missing = [];
  for (const key of ['albedo', 'normal', 'mask']) {
    const name = textures[key];
    if (!name) continue;
    if (!state.textureSources[key]) missing.push(name);
  }
  if (missing.length) {
    add('warn', t('check.texturesNotLoaded', { names: missing.join(', ') }));
  } else {
    add('ok', t('check.texturesOk'));
  }

  // The variants
  const variants = part.variants || [];
  const badVariants = variants.filter((variant) => !KNOWN_VARIANT_TYPES.has(variant.type));
  if (badVariants.length) {
    add('error', t('check.variantTypes', { names: badVariants.map((v) => v.type).join(', ') }));
  } else {
    add('ok', t('check.variantsOk', { n: variants.length }));
  }

  // The attachments
  const attachments = part.attachments || [];
  const ids = new Set();
  let duplicate = false;
  for (const attachment of attachments) {
    if (ids.has(attachment.id)) duplicate = true;
    ids.add(attachment.id);
  }
  if (!attachments.length) {
    add('error', t('check.noAttachments'));
  } else if (duplicate) {
    add('error', t('check.duplicateIds'));
  } else {
    add('ok', t('check.attachmentsOk', { n: attachments.length }));
  }

  // The separator of a fairing or of a jettison breaks the connections it
  // names: detachConnIds are ids of the attachments of this part. The game
  // reads them without a null check (PayloadFairingModule.ApplyForces ->
  // part.GetAttachment(id).Config), and the exception escapes the flight
  // command buffer before it clears itself, so the decouple repeats every
  // frame and the rocket is thrown away. The loader repairs a part with a
  // single attachment and drops the jettison of a part with several.
  const separator = part.modules?.['Model.ResourceSeparatorModule'];
  const jettisonModule = part.modules?.['Model.PayloadFairingModule'] || part.modules?.['Model.JettisonModule'];
  if (separator) {
    const list = Array.isArray(separator.detachConnIds)
      ? separator.detachConnIds.map(Number).filter(Number.isFinite)
      : [];
    const bad = [...new Set(list.filter((id) => !ids.has(id)))];
    const available = [...ids].join(', ') || '—';
    if (!list.length) {
      add(ids.size === 1 ? 'warn' : 'error',
        t(ids.size === 1 ? 'check.separatorEmptyOne' : 'check.separatorEmpty', { ids: available }));
    } else if (bad.length) {
      add(ids.size === 1 ? 'warn' : 'error',
        t(ids.size === 1 ? 'check.separatorIdsOne' : 'check.separatorIds',
          { bad: bad.join(', '), ids: available }));
    } else {
      add('ok', t('check.separatorOk', { ids: [...new Set(list)].join(', ') }));
    }
  } else if (jettisonModule) {
    add('warn', t('check.jettisonNoSeparator'));
  }
  if (jettisonModule && !part.modules?.['Model.PartStateModule']) {
    add('warn', t('check.jettisonNoState'));
  }

  // Surface sockets: the game looks every config up in its own cache without a
  // check (RocketPartSchema.ProcessDynamicAttachments), so the loader drops an
  // id it does not know, and a socket without a shape connects to nothing.
  const dynamicSockets = part.dynamicAttachmentConfigs || [];
  attachments.forEach((attachment, index) => {
    if ((attachment.flags || []).includes('dynamic')) {
      add('warn', t('check.dynamicFlag', { i: index + 1 }));
    }
  });
  if (dynamicSockets.length) {
    const unknownIds = [];
    const unknownShapes = [];
    const unknownNames = [];
    dynamicSockets.forEach((entry, index) => {
      if (!dynamicPresetOf(entry.defindex)) unknownIds.push(entry.defindex);
      if (!dynamicKnownShapes(entry.shape).length) unknownShapes.push(index + 1);
      const bad = dynamicUnknownShapes(entry.shape);
      if (bad.length && dynamicKnownShapes(entry.shape).length) unknownNames.push(`#${index + 1} ${bad.join(', ')}`);
    });
    if (unknownIds.length) add('error', t('check.dynamicIds', { ids: unknownIds.join(', ') }));
    if (unknownShapes.length) add('error', t('check.dynamicShapes', { ids: unknownShapes.join(', ') }));
    if (unknownNames.length) add('warn', t('check.dynamicShapeName', { names: unknownNames.join('; ') }));
    const receivers = dynamicSockets.filter((entry) => dynamicPresetOf(entry.defindex)?.role === 'parent').length;
    if (!unknownIds.length && !unknownShapes.length) {
      add('ok', t('check.dynamicOk', {
        n: dynamicSockets.length,
        parents: receivers,
        current: dynamicSockets.length - receivers,
      }));
    }

    // The pivot is the point inside the hull the game aims at when the part is
    // put onto another one: a point outside the mesh has nothing to hit.
    const bounds = modelBounds();
    const pivot = part.dynamicCurrPivot;
    const needsPivot = dynamicSockets.some((entry) => dynamicPresetOf(entry.defindex)?.role === 'current');
    if (needsPivot && bounds && pivot) {
      const outside = pivot.some((value, axis) => (
        Number(value) < bounds.min[axis] - 1e-3 || Number(value) > bounds.max[axis] + 1e-3
      ));
      if (outside) add('warn', t('check.dynamicPivot'));
    }
  }

  // The animations point at nodes of the mesh
  const nodes = new Set(state.modelNodeMap ? state.modelNodeMap.keys() : []);
  const badNodes = (part.animations || [])
    .map((animation) => animation.path)
    .filter((path) => path && !nodes.has(path.replace(/^model\//, '')));
  if (badNodes.length) {
    add('error', t('check.animationNodes', { names: [...new Set(badNodes)].join(', ') }));
  } else if ((part.animations || []).length) {
    add('ok', checkAnimations(part.animations.length));
  }

  // The game only announces the transitions listed in Model.PartStateModule, so a
  // trigger name that is not there never fires (the motion waits in its first pose).
  // One name in both fields is fine: the transition then toggles the motion.
  const triggerNames = animationTriggers().map((item) => item.toLowerCase());
  const unknownTriggers = [];
  (part.animations || []).forEach((animation, index) => {
    for (const name of new Set([animation.trigger, animation.foldTrigger].filter(Boolean))) {
      if (!triggerNames.includes(name.toLowerCase())) {
        unknownTriggers.push(`${index + 1}: ${name}`);
      }
    }
  });
  if (unknownTriggers.length) {
    add('warn', t('check.animUnknownTrigger', { list: unknownTriggers.join(', ') }));
  }

  // The game creates the modules of a part by walking its state: a module of
  // the config without an entry in the state is never created.
  const states = part.state || {};
  const withoutState = Object.keys(part.modules || {}).filter((key) => states[key] === undefined);
  if (withoutState.length) {
    add('error', t('check.moduleState', { names: withoutState.join(', ') }));
  }

  // The engine effects
  const effects = part.modules?.[ENGINE_EFFECTS_KEY];
  if (effects) {
    const list = effects.flames || [];
    const saved = (name) => state.flames.some((flame) => flame.name === name);
    const custom = list.filter((flame) => !ENGINE_FLAMES.includes(flame));
    const unknown = custom.filter((flame) => !saved(flame));
    if (unknown.length) {
      add('warn', t('check.unknownFlames', { names: unknown.join(', ') }));
    } else {
      add('ok', t('check.effectsOk'));
    }

    // The flame of the part (flame.json) is used only when the list of the
    // engine does not name a custom flame.
    if (custom.length) {
      add('warn', t('check.partFlameUnused', { names: custom.join(', ') }));
      if (!custom.includes(state.flame?.name || '')) {
        add('warn', t('check.flameNotInList'));
      }
    }

    // The start and the stop sounds of the engine are optional: no stock engine
    // has them. The game plays the stop sound in full at shutdown and postpones
    // the fade of the loop by 0.9 of the start sound, so a loop set for both
    // leaves the engine roaring after the thrust is zero (the loader drops such
    // a pair, and it drops a sound that is the loop itself).
    const start = effects.startSound || '';
    const end = effects.endSound || '';
    const loop = effects.sound || '';
    if (start && end && start === end) {
      add('warn', t('check.startStopSame', { name: start }));
    } else if (start && start === loop) {
      add('warn', t('check.startStopLoop', { name: start }));
    } else if (end && end === loop) {
      add('warn', t('check.startStopLoop', { name: end }));
    }
  }

  // The gimbal of an engine turns the listed nodes: EngineGimbalModuleCtrl
  // looks every path up with transform.Find and then reads its rotation
  // without a null check, so a path that names no node throws in the game
  // (the loader drops such a path and removes a gimbal without nodes).
  const gimbal = part.modules?.['Model.EngineGimbalModule'];
  if (gimbal) {
    const chambers = Array.isArray(gimbal.combustionChambers) ? gimbal.combustionChambers : [];
    const missing = chambers.filter((path) => !resolveAnimationNode(path));
    if (!chambers.length) {
      add('warn', t('check.gimbalEmpty'));
    } else if (missing.length) {
      add('warn', t('check.gimbalMissing', { names: missing.join(', ') }));
    } else {
      add('ok', t('check.gimbalOk', { n: chambers.length }));
    }
  }

  // The length of the flame is in metres, so it has to be compared with the
  // part itself: a flame several times higher than its engine is the usual
  // mistake (the desc of the game counts in metres too). The check runs even
  // when the effects module is not there yet, because that is exactly when the
  // author picks the size of the flame.
  const flameSize = Number(state.flame?.params?.size);
  if (state.modelObject && flameSize > 0) {
    const box = new THREE.Box3().setFromObject(state.modelObject);
    const extent = box.getSize(new THREE.Vector3());
    const height = extent.y > 0.01 ? extent.y : Math.max(extent.x, extent.z);
    if (height > 0.01) {
      const ratio = flameSize / height;
      if (ratio > 2.5) {
        add('warn', t('check.flameLong', {
          size: flameSize.toFixed(2),
          height: height.toFixed(2),
          ratio: ratio.toFixed(1),
        }));
      } else {
        add('ok', t('check.flameSize', {
          size: flameSize.toFixed(2),
          height: height.toFixed(2),
        }));
      }
    }
  }

  // The fuel of the part and of its variants must stay inside the baked volume
  const volume = ensureVolumeInfo();
  if (volume) {
    const describe = (units) => ({
      percent: ((units / 1000 / volume.volume) * 100).toFixed(0),
      volume: volume.volume.toFixed(2),
    });
    const base = fuelModuleUnits();
    if (base > 0) {
      const ratio = base / 1000 / volume.volume;
      add(ratio >= 1 ? 'error' : ratio > FUEL_WARN_RATIO ? 'warn' : 'ok',
        t(ratio >= 1 ? 'check.fuelOver' : 'check.fuelOk', describe(base)));
    }
    for (const variant of part.variants || []) {
      const units = fuelUnitsOf(variant.config);
      if (!(units > 0)) continue;
      const ratio = units / 1000 / volume.volume;
      const name = variant.name || variant.id || '?';
      if (ratio >= 1) {
        add('error', t('check.fuelVariantOver', { name, ...describe(units) }));
      } else if (ratio > FUEL_WARN_RATIO) {
        add('warn', t('check.fuelVariantTight', { name, ...describe(units) }));
      }
    }

    // A mesh with a large surface over a small mass cools down instead of
    // heating up: the game radiates over the whole baked area and heats only the
    // silhouette that faces the Sun.
    const forecast = thermalForecast(volume);
    if (forecast && forecast.kind !== 'ok') {
      add(forecast.kind, t('check.thermal', {
        ratio: forecast.ratio.toFixed(1),
        kelvin: Math.round(forecast.kelvin),
      }));
    }

    // The skin is a 2.5 mm metal sheet over the whole area: heavier than the
    // part itself, the internal heat mass of the game turns negative and the
    // temperature jobs break (the game clamps it in ValidateAfterMerge; the
    // loader repeats the clamp after the overrides — SchemaFactory.ValidateThermo).
    const skinCheck = skinMassCheck(volume);
    if (skinCheck) add(skinCheck.kind, t('check.skinMass', skinCheck));
  } else if (state.modelObject) {
    add('warn', t('check.fuelNoMesh'));
  }

  for (const check of checks) {
    const row = document.createElement('div');
    row.className = `component-row check-${check.kind}`;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = check.kind === 'ok' ? '✓' : check.kind === 'warn' ? '!' : '✕';
    const text = document.createElement('span');
    text.className = 'label';
    text.textContent = check.text;
    row.append(badge, text);
    list.append(row);
  }

  const errors = checks.filter((check) => check.kind === 'error').length;
  const warnings = checks.filter((check) => check.kind === 'warn').length;
  statusLine(errors || warnings ? t('check.doneProblems', { errors, warnings }) : t('check.doneOk'), errors ? 'bad' : warnings ? 'warn' : 'ok');
}

// Looks at the mesh of the part: the game cannot draw a mesh without an index
// buffer, and a face with three points in one place or a number that is not a
// number makes the importer of the game stumble.
function inspectMesh() {
  const result = { meshes: 0, vertices: 0, faces: 0, degenerate: 0, broken: 0, withoutNormals: 0, withoutUv: 0 };
  const object = state.modelObject;
  if (!object) return result;

  object.updateWorldMatrix(true, true);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  object.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geometry = node.geometry;
    const position = geometry.getAttribute('position');
    if (!position) return;

    result.meshes++;
    result.vertices += position.count;
    if (!geometry.getAttribute('normal')) result.withoutNormals++;
    if (!geometry.getAttribute('uv')) result.withoutUv++;

    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    result.faces += Math.floor(count / 3);

    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(position, index ? index.getX(i) : i);
      b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1);
      c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2);

      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z) ||
          !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z) ||
          !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) {
        result.broken++;
        continue;
      }

      const ux = b.x - a.x;
      const uy = b.y - a.y;
      const uz = b.z - a.z;
      const vx = c.x - a.x;
      const vy = c.y - a.y;
      const vz = c.z - a.z;
      const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      if (area < 1e-12) result.degenerate++;
    }
  });

  return result;
}

function checkAnimations(count) {  return t('check.animationsOk', { n: count });
}

function meshHasTriangles() {
  if (!state.modelObject) return false;
  let triangles = 0;
  state.modelObject.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const index = node.geometry.getIndex();
    const count = index ? index.count : node.geometry.getAttribute('position')?.count || 0;
    triangles += Math.floor(count / 3);
  });
  return triangles > 0;
}

// ---------------------------------------------------------------------------
// Volume and fuel capacity
// ---------------------------------------------------------------------------

// The game bakes the volume of the part from its meshes (VolumeAreaBaker, an
// SDF voxelisation of the union of the meshes) and compares it with the fuel
// the part carries: DensityResourceContainer.Attach calls
// ChangeContentsVolume(maxAmount / 1000), so every fuel module adds its capacity
// in cubic metres. A part whose fuel fills the whole volume makes the free
// volume zero, the characteristic length of that volume invalid, and the
// temperature of the entire rocket NaN. The stock tanks fill 0.75-0.82 of their
// baked volume, so that ratio is what the tool recommends.
const FUEL_MODULE_KEYS = new Set([
  'Model.KeroseneModule',
  'Model.O2Module',
  'Model.N2H4Module',
  'Model.UDMHModule',
  'Model.N2O4Module',
  'Model.CH4Module',
  'Model.H2Module',
]);

const FUEL_SAFE_RATIO = 0.8;    // the stock tanks stay below this
const FUEL_WARN_RATIO = 0.9;    // above this the heat model of the rocket is at risk

// The values the game uses when part.json has no "thermo" block
// (RocketPartSchema.thermoDefault). They only feed the temperature forecast.
const THERMO_DEFAULTS = {
  heatCapacity: 900,
  emissivity: 0.8,
  absorption: 0.85,
  skinDensity: 2710,
};

const SOLAR_CONSTANT = 1361;          // W/m2 at the distance of the Earth of the game
const STEFAN_BOLTZMANN = 5.670374419e-8;
// Area over volume of a smooth sphere: 4*pi*r^2 / ((4/3)*pi*r^3) = 3/r
const SPHERE_AREA_FACTOR = 4.836;

// Area of the shadow the mesh casts on a plane, measured on a grid of cells
// (the silhouette of the part toward the Sun). The game heats a part by the
// projected area of its drag cube faces, so this is the solar input side of the
// balance; the radiation side uses the whole baked area.
function projectedArea(vertices, faces, min, max, resolution, axis) {
  const uAxis = (axis + 1) % 3;
  const vAxis = (axis + 2) % 3;
  const cellU = (max[uAxis] - min[uAxis]) / resolution;
  const cellV = (max[vAxis] - min[vAxis]) / resolution;
  if (!(cellU > 0) || !(cellV > 0)) return 0;

  const covered = new Uint8Array(resolution * resolution);

  for (let t = 0; t < faces; t++) {
    const o = t * 9;
    const au = vertices[o + uAxis];
    const av = vertices[o + vAxis];
    const bu = vertices[o + 3 + uAxis];
    const bv = vertices[o + 3 + vAxis];
    const cu = vertices[o + 6 + uAxis];
    const cv = vertices[o + 6 + vAxis];

    const den = (bv - cv) * (au - cu) + (cu - bu) * (av - cv);
    if (Math.abs(den) < 1e-12) continue;

    const i0 = Math.max(0, Math.ceil((Math.min(au, bu, cu) - min[uAxis]) / cellU - 0.5));
    const i1 = Math.min(resolution - 1, Math.floor((Math.max(au, bu, cu) - min[uAxis]) / cellU - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(av, bv, cv) - min[vAxis]) / cellV - 0.5));
    const j1 = Math.min(resolution - 1, Math.floor((Math.max(av, bv, cv) - min[vAxis]) / cellV - 0.5));

    for (let j = j0; j <= j1; j++) {
      const pv = min[vAxis] + (j + 0.5) * cellV;
      for (let i = i0; i <= i1; i++) {
        const pu = min[uAxis] + (i + 0.5) * cellU;
        const wA = ((bv - cv) * (pu - cu) + (cu - bu) * (pv - cv)) / den;
        const wB = ((cv - av) * (pu - cu) + (au - cu) * (pv - cv)) / den;
        if (wA < 0 || wB < 0 || wA + wB > 1) continue;
        covered[j * resolution + i] = 1;
      }
    }
  }

  let count = 0;
  for (let i = 0; i < covered.length; i++) count += covered[i];
  return count * cellU * cellV;
}

// The bake counts every triangle of the meshes, including the walls hidden
// inside a hollow model, so a tank with an inner frame radiates far more than
// its outside surface. The game passes that baked area straight to the heat
// model (RocketPart.cs: thermo.Add(this, partSchema.volumeData.area, ...)), and
// the schema merge of the loader lets part.json replace it:
// "overrides": { "volumeData": { "area": 17.6 } }.
function thermalAreaOverride() {
  const data = state.part.overrides && state.part.overrides.volumeData;
  const area = data ? Number(data.area) : NaN;
  return Number.isFinite(area) && area > 0 ? area : 0;
}

// The area the heat model will use: the override of part.json, else the bake.
function thermalAreaOf(info) {
  return thermalAreaOverride() || info.area;
}

function setThermalArea(area) {
  if (!state.part.overrides || typeof state.part.overrides !== 'object') state.part.overrides = {};
  const overrides = state.part.overrides;

  if (area > 0) {
    const data = overrides.volumeData && typeof overrides.volumeData === 'object' ? overrides.volumeData : {};
    data.area = Math.round(area * 100) / 100;
    overrides.volumeData = data;
  } else if (overrides.volumeData && typeof overrides.volumeData === 'object') {
    delete overrides.volumeData.area;
    if (!Object.keys(overrides.volumeData).length) delete overrides.volumeData;
  }

  const box = $('f-overrides');
  if (box && !state.jsonInvalid.overrides) {
    box.value = JSON.stringify(state.part.overrides, null, 2);
  }
  renderVolumeInfo();
  renderStatus();
}

// What the heat model of the game will do with the part, from its baked area
// and its mass. The game radiates over the whole baked area but heats the part
// only by the area that faces the Sun, so a mesh with many ribs or inner walls
// (a large area over a small volume) cools even in full sunlight, and in the
// shadow it falls towards 0 K: there is no heater and no lower clamp.
function thermalForecast(info) {
  const part = state.part;
  const mass = Number(part.mass) || 0;
  const area = info ? thermalAreaOf(info) : 0;
  if (!info || mass <= 0 || !(info.volume > 0) || !(area > 0)) return null;

  const thermo = part.thermo && typeof part.thermo === 'object' ? part.thermo : {};
  const pick = (key) => {
    const value = Number(thermo[key]);
    return Number.isFinite(value) && value > 0 ? value : THERMO_DEFAULTS[key];
  };
  const emissivity = pick('emissivity');
  const absorption = pick('absorption');
  const skinDensity = pick('skinDensity');

  // RocketPartSchema.ValidateAfterMerge: a skin heavier than the part is cut to
  // a quarter of the mass.
  const skinMass = Math.min(area * 0.0025 * skinDensity, mass * 0.25);
  const projected = Math.max(info.projectedMax || 0, 1e-4);
  const absorbed = SOLAR_CONSTANT * absorption * projected;
  const kelvin = Math.pow(absorbed / (emissivity * STEFAN_BOLTZMANN * area), 0.25);
  const ratio = area / info.volume;
  const sphere = SPHERE_AREA_FACTOR / Math.cbrt(info.volume);

  return {
    kelvin,
    celsius: kelvin - 273.15,
    skinMass,
    projected,
    area,
    bakedArea: info.area,
    ratio,
    sphere,
    kind: kelvin < 240 ? 'error' : kelvin < 265 ? 'warn' : 'ok',
  };
}

// The skin of the part is a 2.5 mm metal sheet spread over the whole surface
// (skinMass = skinDensity * 0.0025 * area). When it weighs more than the part
// itself, the internal heat mass (partMass - skinMass) turns negative and the
// temperature jobs of the game divide an exponent by it: at time warp the
// exponent underflows to zero and the NaN spreads over the whole rocket. The
// game clamps the skin density in ValidateAfterMerge, and the loader now repeats
// that clamp after the overrides (SchemaFactory.ValidateThermo) — this check
// only tells the author the numbers the flight will use.
function skinMassCheck(info) {
  const part = state.part;
  const mass = Number(part.mass) || 0;
  const area = thermalAreaOf(info);
  if (mass <= 0 || !(area > 0)) return null;

  const thermo = part.thermo && typeof part.thermo === 'object' ? part.thermo : {};
  const configured = Number(thermo.skinDensity);
  const skinDensity = Number.isFinite(configured) && configured > 0 ? configured : THERMO_DEFAULTS.skinDensity;
  const skinMass = area * 0.0025 * skinDensity;
  if (!(skinMass > mass)) return null;

  return {
    kind: 'warn',
    skin: skinMass.toFixed(1),
    mass: mass.toFixed(1),
    density: Math.round(mass * 0.25 / (0.0025 * area)),
  };
}

// Volume of the union of the meshes in the metres of the part. The inside of
// every ray of a grid is integrated exactly, which gives the same union the SDF
// bake of the game sees (overlapping meshes are counted once, a hollow hull
// counts as its hull).
function measureModelGeometry() {
  const object = state.modelObject;
  if (!object) return null;
  object.updateWorldMatrix(true, true);

  const vertices = [];
  const meshes = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  object.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const position = node.geometry.getAttribute('position');
    if (!position) return;
    const index = node.geometry.getIndex();
    const count = index ? index.count : position.count;
    const matrix = node.matrixWorld;
    const first = vertices.length;
    let signed = 0;
    let area = 0;

    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix);
      b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix);
      c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix);

      signed += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;

      const ux = b.x - a.x;
      const uy = b.y - a.y;
      const uz = b.z - a.z;
      const vx = c.x - a.x;
      const vy = c.y - a.y;
      const vz = c.z - a.z;
      area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);

      vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }

    if (vertices.length === first) return;
    meshes.push({
      name: node.name || 'mesh',
      volume: Math.abs(signed),
      area,
      faces: (vertices.length - first) / 9,
    });
  });

  if (!vertices.length) return null;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = vertices[i + k];
      if (value < min[k]) min[k] = value;
      if (value > max[k]) max[k] = value;
    }
  }

  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  let axis = 0;
  if (size[1] > size[axis]) axis = 1;
  if (size[2] > size[axis]) axis = 2;
  const uAxis = axis === 0 ? 1 : 0;
  const vAxis = axis === 2 ? 1 : 2;
  if (!(size[axis] > 0) || !(size[uAxis] > 0) || !(size[vAxis] > 0)) return null;

  const faces = vertices.length / 9;
  // Every ray tests every triangle, so the grid shrinks for dense meshes:
  // about thirty million triangle tests, never coarser than 32 x 32 rays.
  const rays = Math.max(32, Math.min(160, Math.round(Math.sqrt(3e7 / faces))));
  const cellU = size[uAxis] / rays;
  const cellV = size[vAxis] / rays;
  const crossings = new Array(rays * rays);

  for (let t = 0; t < faces; t++) {
    const o = t * 9;
    const au = vertices[o + uAxis];
    const av = vertices[o + vAxis];
    const ad = vertices[o + axis];
    const bu = vertices[o + 3 + uAxis];
    const bv = vertices[o + 3 + vAxis];
    const bd = vertices[o + 3 + axis];
    const cu = vertices[o + 6 + uAxis];
    const cv = vertices[o + 6 + vAxis];
    const cd = vertices[o + 6 + axis];

    const den = (bv - cv) * (au - cu) + (cu - bu) * (av - cv);
    if (Math.abs(den) < 1e-12) continue;

    const i0 = Math.max(0, Math.ceil((Math.min(au, bu, cu) - min[uAxis]) / cellU - 0.5));
    const i1 = Math.min(rays - 1, Math.floor((Math.max(au, bu, cu) - min[uAxis]) / cellU - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(av, bv, cv) - min[vAxis]) / cellV - 0.5));
    const j1 = Math.min(rays - 1, Math.floor((Math.max(av, bv, cv) - min[vAxis]) / cellV - 0.5));

    for (let j = j0; j <= j1; j++) {
      const pv = min[vAxis] + (j + 0.5) * cellV;
      for (let i = i0; i <= i1; i++) {
        const pu = min[uAxis] + (i + 0.5) * cellU;
        const wA = ((bv - cv) * (pu - cu) + (cu - bu) * (pv - cv)) / den;
        const wB = ((cv - av) * (pu - cu) + (au - cu) * (pv - cv)) / den;
        const wC = 1 - wA - wB;
        if (wA < 0 || wB < 0 || wC < 0) continue;
        const key = j * rays + i;
        if (!crossings[key]) crossings[key] = [];
        crossings[key].push(wA * ad + wB * bd + wC * cd);
      }
    }
  }

  let inner = 0;
  const eps = Math.max(1e-9, size[axis] * 1e-5);
  for (let key = 0; key < crossings.length; key++) {
    const list = crossings[key];
    if (!list || list.length < 2) continue;
    list.sort((x, y) => x - y);
    // Pairs of crossings bound the inside of the ray; two hits at a shared edge
    // land on the same depth and fall out as an empty interval.
    for (let k = 0; k + 1 < list.length; k += 2) {
      const depth = list[k + 1] - list[k];
      if (depth > eps) inner += depth;
    }
  }

  const area = meshes.reduce((sum, mesh) => sum + mesh.area, 0);
  const projectionRays = Math.max(24, Math.min(96, rays));
  const projected = [0, 1, 2].map((projectionAxis) => projectedArea(
    vertices, faces, min, max, projectionRays, projectionAxis,
  ));

  return {
    volume: inner * cellU * cellV,
    area,
    meshes,
    faces,
    rays,
    projected,
    projectedMax: Math.max(...projected),
  };
}

function fuelModuleUnits() {
  return fuelUnitsOf(state.part.modules);
}

// Capacity of the fuel modules of a config block: the modules of a part and the
// config of a contentsType variant use the same maxAmount fields.
function fuelUnitsOf(config) {
  if (!config || typeof config !== 'object') return 0;
  let units = 0;
  for (const key of Object.keys(config)) {
    if (!FUEL_MODULE_KEYS.has(key)) continue;
    const amount = Number(config[key] && config[key].maxAmount);
    if (Number.isFinite(amount) && amount > 0) units += amount;
  }
  return units;
}

// The checks and the fuel picker need the volume of the meshes. It is measured
// once and cached; the section of the volume measures it by itself and the
// button repeats the measurement.
let volumeTimer = null;

function invalidateVolume() {
  if (volumeTimer) {
    window.clearTimeout(volumeTimer);
    volumeTimer = null;
  }
  state.volumeInfo = null;
  state.volumePending = false;
}

function measureVolumeNow(report) {
  if (!state.modelObject) {
    state.volumeInfo = null;
    state.volumePending = false;
    renderVolumeInfo();
    if (report) statusLine(t('volume.noModel'), 'warn');
    return;
  }

  try {
    state.volumeInfo = measureModelGeometry();
  } catch (error) {
    state.volumeInfo = null;
    if (report) statusLine(t('volume.failed', { error: error.message || error }), 'bad');
  }
  state.volumePending = false;
  renderVolumeInfo();

  if (report && state.volumeInfo) {
    statusLine(t('status.volumeMeasured', {
      volume: state.volumeInfo.volume.toFixed(3),
      area: state.volumeInfo.area.toFixed(2),
    }), 'ok');
  }
}

// The ray grid runs on the main thread, so the measurement of a freshly loaded
// mesh waits a moment: the model and its info appear first, then the numbers.
function scheduleVolumeMeasure(delay = 120) {
  invalidateVolume();
  if (!state.modelObject) {
    renderVolumeInfo();
    return;
  }

  state.volumePending = true;
  renderVolumeInfo();
  volumeTimer = window.setTimeout(() => {
    volumeTimer = null;
    measureVolumeNow(false);
  }, delay);
}

function ensureVolumeInfo() {
  if (state.volumeInfo) return state.volumeInfo;
  if (!state.modelObject) return null;
  invalidateVolume();
  try {
    state.volumeInfo = measureModelGeometry();
  } catch (error) {
    state.volumeInfo = null;
  }
  renderVolumeInfo();
  return state.volumeInfo;
}

// How the fuel of a part or of a variant sits in the volume of the meshes.
function fuelStatus(units) {
  const info = ensureVolumeInfo();
  if (!info || info.volume <= 0 || units <= 0) return null;
  const ratio = units / 1000 / info.volume;
  return {
    ratio,
    volume: info.volume,
    kind: ratio >= 1 ? 'error' : ratio > FUEL_WARN_RATIO ? 'warn' : 'ok',
  };
}

function volumeRowElement(kind, text) {
  const row = document.createElement('div');
  row.className = `component-row check-${kind}`;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = kind === 'ok' ? '✓' : kind === 'warn' ? '!' : '✕';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = text;
  row.append(badge, label);
  return row;
}

function volumeRow(list, kind, text) {
  list.append(volumeRowElement(kind, text));
}

function renderVolumeInfo() {
  const list = $('volume-info');
  if (!list) return;
  list.textContent = '';

  if (!state.modelObject) {
    volumeRow(list, 'warn', t('volume.noModel'));
    return;
  }

  if (state.volumePending) {
    volumeRow(list, 'ok', t('volume.pending'));
    return;
  }

  const info = state.volumeInfo;
  if (!info) {
    volumeRow(list, 'ok', t('volume.ready'));
    return;
  }

  volumeRow(list, 'ok', t('volume.volume', {
    volume: info.volume.toFixed(3),
    nodes: info.meshes.length,
    faces: info.faces,
  }));
  volumeRow(list, 'ok', t('volume.area', { area: info.area.toFixed(2) }));

  // The heat model can use a smaller area than the bake counted (setThermalArea).
  const overrideArea = thermalAreaOverride();
  if (overrideArea) {
    volumeRow(list, 'ok', t('volume.thermalAreaSet', {
      area: overrideArea.toFixed(2),
      baked: info.area.toFixed(2),
    }));
  }

  const input = $('f-thermal-area');
  if (input) {
    input.placeholder = t('volume.thermalAreaBaked', { area: info.area.toFixed(2) });
    if (document.activeElement !== input) input.value = overrideArea || '';
  }

  if (info.meshes.length > 1) {
    const biggest = info.meshes
      .slice()
      .sort((left, right) => right.volume - left.volume)
      .slice(0, 4)
      .map((mesh) => `${mesh.name} ${mesh.volume.toFixed(2)}`)
      .join(', ');
    volumeRow(list, 'ok', t('volume.meshes', { list: biggest }));
  }

  // What the heat model of the game will do with the part
  const forecast = thermalForecast(info);
  if (forecast) {
    volumeRow(list, 'ok', t('volume.thermalSun', {
      kelvin: Math.round(forecast.kelvin),
      celsius: Math.round(forecast.celsius),
      projected: forecast.projected.toFixed(2),
      area: forecast.area.toFixed(1),
    }));
    volumeRow(list, forecast.kind, t(forecast.kind === 'ok' ? 'volume.thermalFine' : 'volume.thermalFreeze', {
      ratio: forecast.ratio.toFixed(1),
      sphere: forecast.sphere.toFixed(1),
      area: forecast.area.toFixed(1),
      mass: (Number(state.part.mass) || 0).toFixed(0),
    }));
  }

  volumeRow(list, 'ok', t('volume.recommended', {
    units: Math.floor(info.volume * FUEL_SAFE_RATIO * 1000),
    m3: (info.volume * FUEL_SAFE_RATIO).toFixed(2),
  }));

  const units = fuelModuleUnits();
  if (units <= 0) {
    volumeRow(list, 'warn', t('volume.none'));
    return;
  }

  const ratio = units / 1000 / Math.max(info.volume, 1e-6);
  const kind = ratio >= 1 ? 'error' : ratio > FUEL_WARN_RATIO ? 'warn' : 'ok';
  volumeRow(list, kind, t('volume.contents', {
    units: Math.round(units * 10) / 10,
    m3: (units / 1000).toFixed(2),
    percent: (ratio * 100).toFixed(0),
  }));
  volumeRow(list, kind, t(kind === 'error' ? 'volume.over' : kind === 'warn' ? 'volume.tight' : 'volume.fits'));
}

$('btn-measure-volume').addEventListener('click', () => {
  const button = $('btn-measure-volume');
  if (!state.modelObject) {
    state.volumeInfo = null;
    renderVolumeInfo();
    statusLine(t('volume.noModel'), 'warn');
    return;
  }

  const label = button.textContent;
  button.disabled = true;
  button.textContent = t('volume.measuring');
  state.volumePending = false;
  // The ray grid runs on this thread, so let the browser paint the label first.
  window.setTimeout(() => {
    try {
      state.volumeInfo = measureModelGeometry();
    } catch (error) {
      state.volumeInfo = null;
      statusLine(t('volume.failed', { error: error.message || error }), 'bad');
    } finally {
      button.disabled = false;
      button.textContent = label;
    }

    renderVolumeInfo();
    if (state.volumeInfo) {
      statusLine(t('status.volumeMeasured', {
        volume: state.volumeInfo.volume.toFixed(3),
        area: state.volumeInfo.area.toFixed(2),
      }), 'ok');
    }
  }, 0);
});

// A smooth body radiates four times its silhouette (the sphere relation), and
// that is what the stock tanks look like to the heat model. It is the sane
// value for a model whose hidden inner walls the bake counted as surface.
$('btn-thermal-area-auto').addEventListener('click', () => {
  const info = ensureVolumeInfo();
  if (!info || !(info.projectedMax > 0)) {
    statusLine(t('volume.noModel'), 'warn');
    return;
  }

  const area = Math.round(info.projectedMax * 4 * 10) / 10;
  setThermalArea(area);
  statusLine(t('volume.thermalAreaApplied', { area: area.toFixed(1) }), 'ok');
});

$('f-thermal-area').addEventListener('input', (event) => {
  const value = Number(event.target.value);
  setThermalArea(Number.isFinite(value) && value > 0 ? value : 0);
});

$('btn-check').addEventListener('click', async () => {
  GAME_MODULE_NAMES = await getGameModules();
  runCheck();
});

// Renders the part from a few angles for the gallery of the Workshop page.
function renderGalleryAngles() {
  const angles = [
    { name: 'front', direction: new THREE.Vector3(0, 0, 1) },
    { name: 'back', direction: new THREE.Vector3(0, 0, -1) },
    { name: 'left', direction: new THREE.Vector3(-1, 0, 0) },
    { name: 'right', direction: new THREE.Vector3(1, 0, 0) },
    { name: 'top', direction: new THREE.Vector3(0, 1, 0.001) },
    { name: 'iso', direction: new THREE.Vector3(0.6, 0.45, 1) },
  ];

  return angles.map((angle) => ({ name: angle.name, image: renderPreview(256, angle.direction) }));
}

$('btn-export-gallery').addEventListener('click', async () => {
  if (!state.modelObject) {
    statusLine(t('check.noMesh'), 'warn');
    return;
  }

  const images = renderGalleryAngles().filter((entry) => entry.image);
  if (!images.length) {
    statusLine(t('export.galleryFailed'), 'warn');
    return;
  }

  const files = images.map((entry) => ({ name: `preview_${entry.name}.png`, data: dataUrlToBytes(entry.image) }));
  files.push({ name: 'preview.png', data: dataUrlToBytes(images[0].image) });

  const blob = zipStore(files);
  const fileName = `${($('export-part-name').value || state.part.id || 'part').trim() || 'part'}_gallery.zip`;

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'Gallery', accept: { 'application/zip': ['.zip'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      statusLine(t('export.gallerySaved', { name: handle.name, n: images.length }), 'ok');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  statusLine(t('export.gallerySaved', { name: fileName, n: images.length }), 'ok');
});

// ---------------------------------------------------------------------------
// Pack export: a zip with pack.json, part.json, the mesh and a preview image
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeUtf8(text) {
  return new TextEncoder().encode(text);
}

function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = encodeUtf8(file.name);
    const data = file.data;
    const crc = crc32(data);

    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    header.set(name, 30);

    localParts.push(header, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);

    offset += header.length + data.length;
  }

  let centralSize = 0;
  for (const part of centralParts) centralSize += part.length;

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

// The OBJ is written from the rest pose: the animation preview and the exploded
// view are positions of the editor only. Baking them into the exported mesh made
// the next load of that mesh show the part already offset, and the animation added
// its own offset on top of it.
function exportObj(root, bakeScale = true, reference = modelRoot) {
  return withRestPose(() => exportObjRest(root, bakeScale, reference));
}

function exportObjRest(root, bakeScale, reference) {
  const units = UNITS[state.part.units] ?? 1;
  const scale = Number(state.part.scale) > 0 ? Number(state.part.scale) : 1;
  const factor = bakeScale ? units * scale : 1;

  const lines = ['# exported by the PartAdder part editor', `# units: ${state.part.units || 'm'}`];
  let vertexOffset = 1;
  let uvOffset = 1;

  root.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(reference.matrixWorld).invert();

  root.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geometry = node.geometry;
    const position = geometry.getAttribute('position');
    if (!position) return;

    const matrix = new THREE.Matrix4().copy(inverse).multiply(node.matrixWorld);
    const vector = new THREE.Vector3();

    lines.push(`o ${(node.name || 'mesh').replace(/\s+/g, '_')}`);
    for (let i = 0; i < position.count; i++) {
      vector.fromBufferAttribute(position, i).applyMatrix4(matrix).multiplyScalar(factor);
      // The preview shows the model mirrored (like the game), the export writes
      // the source orientation again, because the game mirrors it once more.
      lines.push(`v ${(-vector.x).toFixed(5)} ${vector.y.toFixed(5)} ${vector.z.toFixed(5)}`);
    }

    const normal = geometry.getAttribute('normal');
    if (normal) {
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
      for (let i = 0; i < normal.count; i++) {
        vector.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
        lines.push(`vn ${(-vector.x).toFixed(5)} ${vector.y.toFixed(5)} ${vector.z.toFixed(5)}`);
      }
    }

    const uv = geometry.getAttribute('uv');
    if (uv) {
      for (let i = 0; i < uv.count; i++) {
        lines.push(`vt ${uv.getX(i).toFixed(5)} ${uv.getY(i).toFixed(5)}`);
      }
    }

    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    const hasNormals = Boolean(normal);
    for (let i = 0; i + 2 < count; i += 3) {
      const a = (index ? index.getX(i) : i) + vertexOffset;
      const b = (index ? index.getX(i + 1) : i + 1) + vertexOffset;
      const c = (index ? index.getX(i + 2) : i + 2) + vertexOffset;
      // Undoing the mirror flips the winding, so the triangle is written as a c b.
      const uvIndex = (value) => value - vertexOffset + uvOffset;
      let face;
      if (uv && hasNormals) {
        face = `f ${a}/${uvIndex(a)}/${a} ${c}/${uvIndex(c)}/${c} ${b}/${uvIndex(b)}/${b}`;
      } else if (uv) {
        face = `f ${a}/${uvIndex(a)} ${c}/${uvIndex(c)} ${b}/${uvIndex(b)}`;
      } else if (hasNormals) {
        face = `f ${a}//${a} ${c}//${c} ${b}//${b}`;
      } else {
        face = `f ${a} ${c} ${b}`;
      }
      lines.push(face);
    }

    vertexOffset += position.count;
    if (uv) uvOffset += uv.count;
  });

  return lines.join('\n');
}

function renderPreview(size, direction) {
  if (!state.modelObject) return null;
  return withRestPose(() => renderPreviewRest(size, direction));
}

function renderPreviewRest(size, direction) {
  const box = new THREE.Box3().setFromObject(state.modelObject);
  if (box.isEmpty()) return null;

  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() * 0.5, 0.05);

  const camera = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 100);
  const view = (direction || new THREE.Vector3(0.6, 0.45, 1)).clone().normalize();
  camera.position.copy(center).addScaledVector(view, radius * 3);
  camera.lookAt(center);

  const target = new THREE.WebGLRenderTarget(size, size);
  const previousTarget = renderer.getRenderTarget();
  const background = scene.background;

  // The overlays (attachment boxes, socket markers and their labels) belong to the
  // editor, they must not show up in the picture of the part.
  const hidden = [];
  overlayRoot.traverse((node) => {
    if (node.visible && node !== overlayRoot) {
      hidden.push(node);
      node.visible = false;
    }
  });
  overlayRoot.visible = false;

  scene.background = new THREE.Color(0x11151d);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);

  const pixels = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
  renderer.setRenderTarget(previousTarget);
  scene.background = background;
  target.dispose();

  overlayRoot.visible = true;
  for (const node of hidden) node.visible = true;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const source = (size - 1 - y) * size * 4;
    const destination = y * size * 4;
    image.data.set(pixels.subarray(source, source + size * 4), destination);
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function dataUrlToBytes(dataUrl) {
  const base64 = String(dataUrl).split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Pack export: the current part and the parts of the library
// ---------------------------------------------------------------------------

function renderExportParts() {
  const list = $('export-parts');
  if (!list) return;
  list.textContent = '';

  const addRow = (checked, label, onChange) => {
    const row = document.createElement('label');
    row.className = 'component-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.addEventListener('change', () => onChange(box.checked));

    const text = document.createElement('span');
    text.className = 'label';
    text.textContent = label;

    row.append(box, text);
    list.append(row);
  };

  addRow(state.exportSelection.current, `${t('export.currentPart')}: ${state.part.name || state.part.id || '?'}`, (checked) => {
    state.exportSelection.current = checked;
  });

  const parts = libraryParts();
  for (const entry of parts) {
    addRow(state.exportSelection.library.has(entry.name), entry.name || entry.id || '?', (checked) => {
      if (checked) {
        state.exportSelection.library.add(entry.name);
      } else {
        state.exportSelection.library.delete(entry.name);
      }
    });
  }

  if (!parts.length) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = t('export.noLibraryParts');
    list.append(hint);
  }
}

// The flames the engine of the part takes: the names in the module.
function engineFlameNames(part) {
  const list = part?.modules?.[ENGINE_EFFECTS_KEY]?.flames;
  if (!Array.isArray(list)) return [];
  return list.filter((name) => typeof name === 'string' && name);
}

// Collects the files of one part: part.json, the mesh and the textures.
//
// The flames are written the way the loader reads them: the engine takes the
// flames of the list of the module. A custom flame of the list becomes the
// file "flames/<name>.json", and the file "flame.json" (the flame of the part
// itself) is written only when the engine takes no custom flame. So the pack
// never carries two flames where one is enough.
function collectPartFiles(packName, folder, part, mesh, textures, flame, flames) {
  const files = [];
  const json = { ...part };
  json.model = 'model.obj';
  delete json.$schema;

  files.push({ name: `${packName}/${folder}/part.json`, data: encodeUtf8(JSON.stringify(json, null, 2)) });
  if (mesh) files.push({ name: `${packName}/${folder}/model.obj`, data: encodeUtf8(mesh) });

  // The flames the engine takes.
  const wanted = new Set(engineFlameNames(part));

  // The custom flames of the part: they are the flames of the editor, the
  // loader builds them from these files.
  let written = 0;
  for (const custom of flames || []) {
    if (!wanted.has(custom.name)) continue;
    // The flame that is open in the editor wins over its saved copy, so the
    // changes of the author are not lost.
    const source = state.flame?.name === custom.name ? state.flame : custom;
    const config = flameToJson({
      base: source.base,
      params: source.params,
      profile: source.profile,
    });
    files.push({
      name: `${packName}/${folder}/flames/${custom.name}.json`,
      data: encodeUtf8(JSON.stringify(config, null, 2)),
    });
    written++;
  }

  // The sound of the engine: the loader reads it from the part folder.
  if (flame?.sound) {
    files.push({ name: `${packName}/${folder}/sound.wav`, data: dataUrlToBytes('data:,' + flame.sound) });
  }

  // The flame of the part itself: only when the engine takes no custom flame.
  if (flame?.json && written === 0) {
    const text = typeof flame.json === 'string'
      ? flame.json
      : JSON.stringify(flame.json, null, 2);
    files.push({ name: `${packName}/${folder}/flame.json`, data: encodeUtf8(text) });
  }

  for (const [name, source] of textures) {
    files.push({ name: `${packName}/${folder}/${name}`, data: dataUrlToBytes(source) });
  }

  return files;
}

// The textures of a part: the file name of the material and the data of the file.
function partTextures(part, sources, nodeSources) {
  const textures = new Map();

  for (const key of Object.keys(sources || {})) {
    const source = sources[key];
    const name = part?.material?.[key];
    if (!source || !name) continue;
    textures.set(name, source);
  }

  for (const path of Object.keys(nodeSources || {})) {
    for (const key of Object.keys(nodeSources[path])) {
      const source = nodeSources[path][key];
      const entry = (part?.materials || []).find((item) => {
        const node = item.node?.startsWith('model/') ? item.node.slice('model/'.length) : item.node;
        return node === path;
      });
      const name = entry?.[key];
      if (!source || !name) continue;
      textures.set(name, source);
    }
  }

  return textures;
}

$('btn-export-pack').addEventListener('click', async () => {
  const packName = ($('export-pack-name').value || 'MyPack').trim().replace(/\s+/g, '');
  if (!packName) {
    statusLine(t('export.nameRequired'), 'warn');
    return;
  }

  const files = [];
  files.push({
    name: `${packName}/pack.json`,
    data: encodeUtf8(JSON.stringify({
      id: packName.toLowerCase(),
      name: packName,
      author: '',
      version: '1.0',
      enabled: true,
    }, null, 2)),
  });

  let count = 0;
  let preview = null;

  // The current part: the mesh is written in metres.
  if (state.exportSelection.current) {
    const partName = ($('export-part-name').value || state.part.id || 'part').trim().replace(/\s+/g, '_');
    const part = toJson(state.part);
    part.units = 'm';
    const textures = partTextures(state.part, state.textureSources, state.nodeTextureSources);
    files.push(...collectPartFiles(packName, partName, part, state.modelObject ? exportObj(state.modelObject) : '', textures, {
      json: flameToJson(state.flame),
      sound: state.soundData,
    }, state.flames));
    preview = renderPreview(256);
    count++;
  }

  // The parts of the library: their mesh is stored without the scale, so the part keeps
  // its own units and the game scales it the same way.
  for (const entry of libraryParts()) {
    if (!state.exportSelection.library.has(entry.name)) continue;
    let part = null;
    try {
      part = JSON.parse(entry.json);
    } catch {
      continue;
    }
    const folder = slugify(entry.name || entry.id || 'part');
    const textures = partTextures(part, entry.textures, entry.nodeTextures);
    files.push(...collectPartFiles(packName, folder, toJson(part), entry.mesh || '', textures, entry.flame ? {
      json: entry.flame,
      sound: entry.sound || '',
    } : null, entry.flames || []));
    count++;
  }

  if (!count) {
    statusLine(t('export.nothingSelected'), 'warn');
    return;
  }

  if (preview) files.push({ name: 'preview.png', data: dataUrlToBytes(preview) });

  const missing = [];
  for (const key of Object.keys(state.part.material || {})) {
    const name = state.part.material[key];
    if (!name || !['albedo', 'normal', 'mask'].includes(key)) continue;
    if (!state.textureSources[key]) missing.push(name);
  }
  if (missing.length) {
    statusLine(t('export.texturesMissing', { names: missing.join(', ') }), 'warn');
  }

  const blob = zipStore(files);
  const fileName = `${packName}.zip`;

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'Pack', accept: { 'application/zip': ['.zip'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      statusLine(t('export.saved', { name: handle.name, count }), 'ok');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  statusLine(t('export.saved', { name: fileName }), 'ok');
});

// ---------------------------------------------------------------------------
// Stock parts: take a game part apart into a part.json to start from
// ---------------------------------------------------------------------------

let stockParts = null;

const RU_MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

function slugify(text) {
  let result = '';
  for (const char of String(text || '').toLowerCase()) {
    if (RU_MAP[char] !== undefined) {
      result += RU_MAP[char];
    } else if (/[a-z0-9]/.test(char)) {
      result += char;
    } else if (char === ' ' || char === '-' || char === '_') {
      result += '_';
    }
  }
  return result.replace(/_+/g, '_').replace(/^_|_$/g, '') || 'part';
}

async function ensureStockParts() {
  if (stockParts) return stockParts;
  const module = await import('./stock-parts.js');
  stockParts = module.STOCK_PARTS;
  return stockParts;
}

async function populateStockSelect() {
  const select = $('stock-select');
  const previous = select.value;
  select.innerHTML = '';
  select.disabled = true;

  const parts = await ensureStockParts();
  parts.forEach((part, index) => {
    // A part without connections cannot be built (the loader wants at least one
    // attachment), so it is not offered.
    if (!part.attachments?.length) return;
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${part.name} (${part.category})`;
    select.append(option);
  });

  select.disabled = false;
  if (previous && parts[Number(previous)]) select.value = previous;
}

// Unity's Euler order is Z, then X, then Y, so the decomposition has to match.
function quaternionToEulerZXY(q) {
  const { x, y, z, w } = q;
  const sinp = 2 * (w * y - z * x);
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [
    THREE.MathUtils.radToDeg(roll),
    THREE.MathUtils.radToDeg(pitch),
    THREE.MathUtils.radToDeg(yaw),
  ].map((value) => Math.round(value * 10000) / 10000);
}

function stockAttachments(stock) {
  return (stock.attachments || []).map((attachment) => {
    const out = {
      id: attachment.id,
      position: attachment.position || [0, 0, 0],
      shape: attachment.shape || 'single',
    };

    if (attachment.rotation?.length === 4) {
      // The stock connection stores the full orientation as a quaternion.
      out.rotation = quaternionToEulerZXY({
        x: attachment.rotation[0],
        y: attachment.rotation[1],
        z: attachment.rotation[2],
        w: attachment.rotation[3],
      });
    } else if (attachment.direction) {
      out.direction = attachment.direction;
    }

    if (attachment.sockets?.length) out.sockets = attachment.sockets;
    if (attachment.flags && attachment.flags !== 'none') out.flags = attachment.flags;
    if (attachment.center) out.center = attachment.center;
    if (attachment.size) out.size = attachment.size;
    return out;
  });
}

async function importStockPart() {
  const index = Number($('stock-select').value);
  const parts = await ensureStockParts();
  const stock = parts[index];
  if (!stock) return;

  const raw = {
    id: slugify(stock.name),
    name: stock.name,
    category: stock.category,
    mass: stock.mass,
    description: stock.description || '',
    impactTolerance: stock.impactTolerance ?? 10,
    tags: Array.isArray(stock.tags) ? stock.tags : [],
    modules: stock.modules && typeof stock.modules === 'object' ? structuredClone(stock.modules) : {},
    state: stock.state && typeof stock.state === 'object' ? structuredClone(stock.state) : {},
    variants: Array.isArray(stock.variants) ? structuredClone(stock.variants) : [],
    attachments: stockAttachments(stock),
    radialSnapping: stock.radialSnapping,
    dynamicAttachmentConfigs: Array.isArray(stock.dynamicAttachmentConfigs)
      ? structuredClone(stock.dynamicAttachmentConfigs)
      : [],
    dynamicCurrPivot: Array.isArray(stock.dynamicCurrPivot) ? structuredClone(stock.dynamicCurrPivot) : [0, 0, 0],
  };

  state.part = normalizePart(raw);
  resetPreviewForPart();
  state.selection = null;
  state.component = null;
  state.variant = null;
  state.animation = null;
  // The probe pointed at a socket of the previous part.
  state.dynamicProbe = null;
  disposeGroup(dynamicProbeRoot);

  fillForm();
  // A stock engine carries the flame of the game: the preview shows it at once.
  showEngineFlamePreview();
  applyEngineFlame();
  refreshStructure();
  statusLine(t('stock.imported', { name: stock.name }), 'ok');
}

$('btn-import-stock').addEventListener('click', () => {
  importStockPart().catch((error) => {
    statusLine(t('stock.failed', { error: error.message || error }), 'bad');
  });
});

// ---------------------------------------------------------------------------
// Exploded view: spread the objects of the mesh apart
// ---------------------------------------------------------------------------

function applyExplode(amount) {
  const root = state.modelObject;
  if (!root) return;

  const children = root.children;
  if (!children.length) return;

  // The rest positions are captured when the mesh loads (setModel), so a pose of
  // the animation preview can never be baked into the exploded view.
  if (!state.explodeRest || state.explodeRest.length !== children.length) {
    state.explodeRest = children.map((child) => {
      const base = previewBases.get(child);
      return (base ? base.position : child.position).clone();
    });
  }

  state.explodeOffsets = null;
  if (amount > 0.0001) {
    // The directions are measured in the rest pose: the preview must not move the
    // centre of a piece while the author spreads the view.
    children.forEach((child, index) => child.position.copy(state.explodeRest[index]));
    root.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const centers = children.map((child) => new THREE.Box3()
      .setFromObject(child)
      .getCenter(new THREE.Vector3())
      .applyMatrix4(inverse));

    const modelCenter = new THREE.Vector3();
    for (const center of centers) modelCenter.add(center);
    modelCenter.multiplyScalar(1 / centers.length);

    state.explodeOffsets = centers.map((center) => {
      const direction = center.clone().sub(modelCenter);
      const distance = direction.length();
      if (distance < 1e-4) return new THREE.Vector3();
      direction.normalize();
      return direction.multiplyScalar(distance * amount);
    });
  }

  // The offsets are composed with the animation pose in one place, so neither of
  // the two features eats the offset of the other.
  applyAnimationPreview();
}

$('f-explode').addEventListener('input', (event) => {
  applyExplode(Number(event.target.value));
});

// ---------------------------------------------------------------------------
// Engine preview: the flame at the force point and the sound of the engine
// ---------------------------------------------------------------------------

let flamePreview = null;
let flameMaterial = null;
let flameGeometry = null;
let flameClock = null;
let soundPlayer = null;
let soundUrl = null;

// The point where the thrust of the engine acts. It lives in the space of the
// prefab, the same space the game uses, so the flame shows up where the game
// puts it.
function engineForcePoint() {
  const engine = state.part.modules?.['Model.EngineModule'];
  const point = engine?.forcePoint;
  if (!point) return null;
  return new THREE.Vector3(Number(point.x) || 0, Number(point.y) || 0, Number(point.z) || 0);
}

// The flame of the engine. The game takes a prefab of the engine, copies its
// material and drives the shader every frame (the throttle, the pressure and
// the fade of the length). The preview draws the same thing with a shader of
// our own: the numbers are the ones of the game, so what the author sees here
// is what the flame does in the game.
function clearFlamePreview() {
  if (flamePreview) {
    overlayRoot.remove(flamePreview);
    flamePreview = null;
  }
  // Only the tube of the preview belongs to us: the geometry of the flame is
  // built from its profile.
  if (flameGeometry) {
    flameGeometry.dispose();
    flameGeometry = null;
  }
  if (flameMaterial) {
    flameMaterial.dispose();
    flameMaterial = null;
  }
}

function updateFlamePreview() {
  clearFlamePreview();
  updateForcePointMarker();

  if (!$('chk-flame')?.checked) return;

  const point = engineForcePoint();
  if (!point) return;

  const engine = state.part.modules?.['Model.EngineModule'];
  const thrust = Number(engine?.maxThrustAsl) || 0;
  const throttle = throttleValue();

    // The length of the flame in metres: the loader builds the geometry of the
  // flame in that size, so the preview and the game show the same flame. The
  // throttle makes it shorter while the engine runs down.
  const size = Number(state.flame.params.size) > 0 ? Number(state.flame.params.size) : 2.5;
  const length = size * (0.35 + 0.65 * throttle);

  // The radius of the flame: the profile says how wide it is along its
  // length, the widest point is the radius of the whole flame.
  const profile = state.flame.profile || [];
  let radius = 0;
  for (const point of profile) {
    radius = Math.max(radius, Number(point.r) || 0);
  }

  const material = createFlameMaterial();
  applyFlameParams(material, state.flame);
  material.uniforms.uThrottle.value = throttle;
  // The geometry is already built in the right length, the shader only scales
  // it with the throttle.
  material.uniforms.uLength.value = 1;
  material.uniforms.uRadius.value = radius;
  flameMaterial = material;

  const group = new THREE.Group();

  flameGeometry = createFlameGeometry(profile, length);
  const mesh = new THREE.Mesh(flameGeometry, material);
  group.add(mesh);

  group.position.copy(point);
  group.renderOrder = 3;
  flamePreview = group;
  overlayRoot.add(group);
}

function tickFlamePreview() {
  if (!flameMaterial) return;
  if (!flameClock) flameClock = new THREE.Clock();
  flameMaterial.uniforms.uTime.value = flameClock.getElapsedTime();
}

// The marker of the force point: the place where the flame of the game starts.
// The engine module carries it, so the author can see where the flame will
// grow and move the point in the fields of the engine.
let forcePointMarker = null;

function updateForcePointMarker() {
  if (forcePointMarker) {
    overlayRoot.remove(forcePointMarker);
    forcePointMarker.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) node.material.dispose();
    });
    forcePointMarker = null;
  }

  const point = engineForcePoint();
  if (!point) return;

  const group = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 14, 10),
    new THREE.MeshBasicMaterial({
      color: 0xffb347,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    }),
  );
  sphere.renderOrder = 6;
  group.add(sphere);

  // The axes stick out of the flame, so the point stays visible.
  const axes = new THREE.AxesHelper(0.32);
  axes.renderOrder = 6;
  group.add(axes);

  group.position.copy(point);
  forcePointMarker = group;
  overlayRoot.add(group);
}

// The curve editor of the flame: the radius of the flame along its length.
// The game builds the flame out of that profile, so it is the shape of the
// flame.
let flameCurve = null;

function initFlameCurve() {
  const canvas = $('flame-curve');
  if (!canvas) return;

  flameCurve = createCurveEditor(canvas, {
    getPoints: () => state.flame.profile || [],
    getLength: () => Number(state.flame.params?.size) || 0,
    onChange: (points) => {
      state.flame.profile = points;
      updateFlamePreview();
      renderStatus();
    },
  });

  $('btn-flame-curve-clear')?.addEventListener('click', () => {
    state.flame.profile = defaultFlameProfile();
    updateFlamePreview();
    renderStatus();
    if (flameCurve) flameCurve.draw();
  });

  flameCurve.draw();
}

function throttleValue() {
  return Math.min(1, Math.max(0, (Number($('f-throttle')?.value) || 0) / 100));
}

function updateSoundVolume() {
  if (!soundPlayer) return;
  soundPlayer.volume = 0.15 + throttleValue() * 0.85;
}

function toggleSound() {
  const file = $('file-sound')?.files?.[0];
  if (!file) {
    statusLine(t('sound.noFile'), 'warn');
    return;
  }

  if (!soundPlayer) {
    soundPlayer = new Audio();
    soundPlayer.loop = true;
  }

  if (soundUrl) URL.revokeObjectURL(soundUrl);
  soundUrl = URL.createObjectURL(file);
  soundPlayer.src = soundUrl;
  updateSoundVolume();
  soundPlayer.play().catch((error) => {
    statusLine(t('sound.failed', { error: error.message || error }), 'bad');
  });
  $('btn-sound-play').textContent = '❚❚';
  statusLine(t('sound.playing', { name: file.name }), 'ok');
}

function stopSound() {
  if (soundPlayer) soundPlayer.pause();
  const button = $('btn-sound-play');
  if (button) button.textContent = '▶';
}

$('chk-flame').addEventListener('change', () => {
  updateFlamePreview();
  // The flame hangs below the engine, so the view has to make room for it.
  fitView();
});
$('f-throttle').addEventListener('input', () => {
  updateFlamePreview();
  updateSoundVolume();
});
$('file-sound').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  $('f-sound-file').value = file ? file.name : '';
  // The sound of the engine travels with the part: the loader reads it from
  // the part folder and puts it into the audio cache of the game.
  state.soundFile = file || null;
  state.soundData = '';
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      state.soundData = comma >= 0 ? result.slice(comma + 1) : '';
    };
    reader.readAsDataURL(file);
  }
});
$('btn-sound-play').addEventListener('click', () => {
  if (soundPlayer && !soundPlayer.paused) {
    stopSound();
    return;
  }
  toggleSound();
});

// ---------------------------------------------------------------------------
// The flame of the engine: the parameters of the material and the own mesh
// ---------------------------------------------------------------------------

// One row per parameter of the material of the game. The numbers are written
// to flame.json and the loader copies them onto the material of the flame, so
// the flame in the game behaves like the preview here.
function renderFlameEditor() {
  const list = $('flame-params');
  const base = $('f-flame-base');
  if (!list || !base) return;

  list.textContent = '';

  // The flame is drawn at the force point of the engine, so a part without an
  // engine has nothing to show.
  if (!engineForcePoint()) {
    const warn = document.createElement('p');
    warn.className = 'hint';
    warn.textContent = t('flame.noEngine');
    list.append(warn);
  }

  if (!base.options.length) {
    for (const name of ENGINE_FLAMES) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      base.append(option);
    }
  }
  base.value = state.flame.base;

  renderFlameList();
  if (flameCurve) flameCurve.draw();

  const write = (key, value) => {
    state.flame.params[key] = value;
    applyFlameParams(flameMaterial, state.flame);
    updateFlamePreview();
    renderStatus();
  };

  for (const param of FLAME_PARAMS) {
    const row = document.createElement('div');
    row.className = 'component-row';

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = t('flame.' + param.key);
    row.append(label);

    const value = state.flame.params[param.key];

    if (param.type === 'color') {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = value?.hex || '#ffffff';
      input.addEventListener('input', () => write(param.key, { hex: input.value, hdr: null }));
      row.append(input);
    } else if (param.type === 'number') {
      const row2 = document.createElement('div');
      row2.className = 'input-row';
      const range = document.createElement('input');
      range.type = 'range';
      range.min = param.min;
      range.max = param.max;
      range.step = param.step;
      range.value = value;
      const number = document.createElement('input');
      number.type = 'number';
      number.min = param.min;
      number.max = param.max;
      number.step = param.step;
      number.value = value;
      range.addEventListener('input', () => {
        number.value = range.value;
        write(param.key, Number(range.value));
      });
      number.addEventListener('input', () => {
        range.value = number.value;
        write(param.key, Number(number.value));
      });
      row2.append(range, number);
      row.append(row2);
    } else {
      const row2 = document.createElement('div');
      row2.className = 'input-row';
      for (let i = 0; i < param.def.length; i++) {
        const number = document.createElement('input');
        number.type = 'number';
        number.step = '0.01';
        number.value = value[i];
        number.addEventListener('input', () => {
          const next = state.flame.params[param.key].slice();
          next[i] = Number(number.value) || 0;
          write(param.key, next);
        });
        row2.append(number);
      }
      row.append(row2);
    }

    list.append(row);
  }
}

// ---------------------------------------------------------------------------
// The custom flames of the part: they are saved under a name and can be put
// into the list of the flames of the engine
// ---------------------------------------------------------------------------

function customFlameNames() {
  return state.flames.map((flame) => flame.name);
}

function currentFlame(name) {
  return {
    name,
    base: state.flame.base,
    params: JSON.parse(JSON.stringify(state.flame.params || {})),
    profile: (state.flame.profile || []).map((point) => ({ v: point.v, r: point.r })),
  };
}

function renderFlameList() {
  const list = $('flame-list');
  if (!list) return;
  list.textContent = '';

  if (!state.flames.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = t('flame.libraryEmpty');
    list.append(empty);
    return;
  }

  state.flames.forEach((flame, index) => {
    const row = document.createElement('div');
    row.className = 'component-row';

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = flame.name;
    row.append(label);

    const load = document.createElement('button');
    load.className = 'icon-btn';
    load.textContent = '✎';
    load.title = t('flame.loadFlame');
    load.addEventListener('click', () => loadCustomFlame(index));
    row.append(load);

    const use = document.createElement('button');
    use.className = 'icon-btn';
    use.textContent = '→';
    use.title = t('flame.useFlame');
    use.addEventListener('click', () => useCustomFlame(flame.name));
    row.append(use);

    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.textContent = '✕';
    remove.title = t('comp.remove');
    remove.addEventListener('click', () => {
      state.flames.splice(index, 1);
      renderFlameList();
      renderEngineEffects();
      renderStatus();
    });
    row.append(remove);

    list.append(row);
  });
}

function saveCustomFlame() {
  const name = ($('flame-name')?.value || '').trim().replace(/\s+/g, '_');
  if (!name) {
    statusLine(t('flame.nameRequired'), 'warn');
    return;
  }
  if (customFlameNames().includes(name)) {
    statusLine(t('flame.nameTaken', { name }), 'warn');
    return;
  }

  state.flames.push(currentFlame(name));
  renderFlameList();
  statusLine(t('flame.saved', { name }), 'ok');
}

function updateCustomFlame() {
  const name = ($('flame-name')?.value || '').trim();
  const index = state.flames.findIndex((flame) => flame.name === name);
  if (index < 0) {
    statusLine(t('flame.notSaved'), 'warn');
    return;
  }
  state.flames[index] = currentFlame(name);
  renderFlameList();
  statusLine(t('flame.updated', { name }), 'ok');
}

function deleteCustomFlame() {
  const name = ($('flame-name')?.value || '').trim();
  const index = state.flames.findIndex((flame) => flame.name === name);
  if (index < 0) {
    statusLine(t('flame.notSaved'), 'warn');
    return;
  }
  state.flames.splice(index, 1);
  renderFlameList();
  renderEngineEffects();
  statusLine(t('flame.deleted', { name }), 'ok');
}

// Puts the flame into the list of the flames of the engine.
function useCustomFlame(name) {
  const modules = state.part.modules || (state.part.modules = {});
  const module = modules[ENGINE_EFFECTS_KEY] || (modules[ENGINE_EFFECTS_KEY] = {});
  const flames = Array.isArray(module.flames) ? module.flames : [];
  if (!flames.includes(name)) flames.push(name);
  module.flames = flames;
  commitComponents();
  renderEngineEffects();
  statusLine(t('flame.addedToEngine', { name }), 'ok');
}

// Loads a saved flame into the editor. The quiet mode is for the preview of a
// freshly loaded part: the status bar then tells about the part, not the flame.
async function loadCustomFlame(index, options) {
  const flame = state.flames[index];
  if (!flame) return;

  state.flame = defaultFlame(flame.base);
  state.flame.params = JSON.parse(JSON.stringify(flame.params || {}));
  state.flame.name = flame.name || '';
  if (Array.isArray(flame.profile) && flame.profile.length) {
    state.flame.profile = flame.profile.map((point) => ({ v: point.v, r: point.r }));
  }
  $('flame-name').value = flame.name;

  renderFlameEditor();
  updateFlamePreview();
  if (!options?.silent) statusLine(t('flame.loaded', { name: flame.name }), 'ok');
}

// Puts the preview on the flame the engine of the part takes: the first name of
// the list of the engine that the editor can show. A name of the library is
// loaded with the values of the author, a name of the game takes the preset of
// that flame. Without this the preview would keep the flame of the previous
// part, and the author would tune a flame the engine does not use.
function applyEngineFlame() {
  const names = engineFlameNames(state.part);
  if (!names.length) return false;

  // The flame that is open is already the flame of the engine.
  if (state.flame?.name && names.includes(state.flame.name)) return false;

  // A saved flame of the editor: the values of the author.
  for (const name of names) {
    const index = state.flames.findIndex((flame) => flame.name === name);
    if (index >= 0) {
      loadCustomFlame(index, { silent: true });
      return true;
    }
  }

  // A flame of the game: the preview shows the values of that flame.
  const stock = names.find((name) => ENGINE_FLAMES.includes(name));
  if (stock) {
    state.flame = defaultFlame(stock);
    applyFlamePreset(state.flame, stock);
    if ($('flame-name')) $('flame-name').value = '';
    return true;
  }

  // A custom flame that is not in the library: there is nothing to show.
  return false;
}

// The preview of a part with an engine shows the flame at once: the flame is a
// part of the look of the engine, not an optional extra of the preview.
function showEngineFlamePreview() {
  const box = $('chk-flame');
  if (!box || box.checked) return;
  if (!engineForcePoint()) return;
  box.checked = true;
}

$('btn-flame-save')?.addEventListener('click', saveCustomFlame);
$('btn-flame-update')?.addEventListener('click', updateCustomFlame);
$('btn-flame-delete')?.addEventListener('click', deleteCustomFlame);

// Puts the force point of the engine to the lowest point of the mesh: the
// flame of the game starts exactly there.
$('btn-flame-force-point')?.addEventListener('click', () => {
  if (!state.modelObject) {
    statusLine(t('flame.noMesh'), 'warn');
    return;
  }

  const modules = state.part.modules || (state.part.modules = {});
  const engine = modules['Model.EngineModule'];
  if (!engine) {
    statusLine(t('flame.noEngine'), 'warn');
    return;
  }

  const box = new THREE.Box3().setFromObject(state.modelObject);
  const min = modelRoot.worldToLocal(box.min.clone());
  const round = (value) => Math.round(value * 1000) / 1000;
  engine.forcePoint = { x: round(min.x), y: round(min.y), z: round(min.z) };
  commitComponents();
  renderEngineEffects();
  updateFlamePreview();
  statusLine(t('flame.forcePointMoved', { x: engine.forcePoint.x, y: engine.forcePoint.y, z: engine.forcePoint.z }), 'ok');
});

// Loads a flame file (flame.json of a part or a saved flame of the editor) into
// the editor, so it can be compared with the flame in the game.
$('file-flame-config')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    state.flame = flameFromJson(data);
    $('flame-name').value = state.flame.base || '';
    renderFlameEditor();
    updateFlamePreview();
    statusLine(t('flame.loaded', { name: file.name }), 'ok');
  } catch (error) {
    statusLine(t('flame.loadFailed', { error: error.message || error }), 'bad');
  }
});

$('f-flame-base')?.addEventListener('change', (event) => {
  state.flame.base = event.target.value;
  // The stock flames have their own values: they are the presets of the editor.
  if (applyFlamePreset(state.flame, state.flame.base)) {
    renderFlameEditor();
  }
  updateFlamePreview();
  renderStatus();
});

// ---------------------------------------------------------------------------
// Part library, model information and the stack check
// ---------------------------------------------------------------------------

// The library holds meshes and textures, so it needs more room than the 5 MB
// of localStorage. IndexedDB keeps the parts without that limit.
const LIBRARY_DB = 'partadder.editor';
const LIBRARY_STORE = 'parts';
const LIBRARY_LEGACY_KEY = 'partadder.editor.library';

function openLibraryDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = indexedDB.open(LIBRARY_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
        db.createObjectStore(LIBRARY_STORE, { keyPath: 'name' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function libraryRequest(mode, work) {
  return openLibraryDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(LIBRARY_STORE, mode);
    const store = transaction.objectStore(LIBRARY_STORE);
    let request = null;
    try {
      request = work(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

// Reads the whole library into the cache.
async function loadLibrary() {
  try {
    const entries = await libraryRequest('readonly', (store) => store.getAll());
    state.library = Array.isArray(entries) ? entries : [];
  } catch (error) {
    statusLine(t('library.loadFailed', { error: error.message || error }), 'bad');
    state.library = [];
  }

  if (await migrateLegacyLibrary()) {
    // The parts of the old editor version moved into the database, read them again.
    try {
      const entries = await libraryRequest('readonly', (store) => store.getAll());
      state.library = Array.isArray(entries) ? entries : [];
    } catch {
      // The list keeps what it has.
    }
  }

  renderLibrary();
  renderExportParts();
}

// Moves the parts of an older editor version into the database.
async function migrateLegacyLibrary() {
  let raw = null;
  try {
    raw = localStorage.getItem(LIBRARY_LEGACY_KEY);
  } catch {
    return false;
  }

  if (!raw) return false;

  let entries = [];
  try {
    entries = JSON.parse(raw) || [];
  } catch {
    entries = [];
  }

  let moved = false;
  for (const entry of entries) {
    if (!entry?.name) continue;
    try {
      await libraryRequest('readwrite', (store) => store.put(entry));
      moved = true;
    } catch {
      // The part stays in localStorage, it is tried again next time.
      return moved;
    }
  }

  try {
    localStorage.removeItem(LIBRARY_LEGACY_KEY);
  } catch {
    // Nothing to do.
  }

  return moved;
}

function libraryParts() {
  return state.library;
}

async function putLibraryEntry(entry) {
  await libraryRequest('readwrite', (store) => store.put(entry));
  const existing = state.library.findIndex((item) => item.name === entry.name);
  if (existing >= 0) {
    state.library[existing] = entry;
  } else {
    state.library.push(entry);
  }
}

async function removeLibraryEntry(name) {
  await libraryRequest('readwrite', (store) => store.delete(name));
  state.library = state.library.filter((item) => item.name !== name);
}

function renderLibrary() {
  const list = $('library-list');
  if (!list) return;
  list.textContent = '';

  const parts = libraryParts();
  if (!parts.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = t('library.empty');
    list.append(empty);
  }

  parts.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'component-row';

    const title = document.createElement('span');
    title.className = 'label';
    title.textContent = entry.name || entry.id || '?';

    const load = document.createElement('button');
    load.className = 'icon-btn';
    load.textContent = '↧';
    load.title = t('library.load');
    load.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        loadPart(JSON.parse(entry.json), entry.name);
        // The name of the part goes into the field of the library, so a second
        // save stores it under the same name again.
        $('library-name').value = entry.name || '';
        if (entry.mesh) {
          const file = new File([entry.mesh], entry.modelName || 'model.obj', { type: 'text/plain' });
          await loadModelFile(file);
        }
        if (entry.flame) {
          state.flame = flameFromJson(entry.flame);
          renderFlameEditor();
        }
        if (entry.flames) {
          state.flames = entry.flames.map((flame) => ({ ...flame }));
          renderFlameList();
          renderEngineEffects();
        }
        if (entry.sound) {
          const file = new File([dataUrlToBytes('data:,' + entry.sound)], 'sound.wav', { type: 'audio/wav' });
          state.soundFile = file;
          state.soundData = entry.sound;
          $('f-sound-file').value = 'sound.wav';
        }
        await restoreLibraryTextures(entry);
      } catch (error) {
        statusLine(t('library.loadFailed', { error: error.message || error }), 'bad');
      }
    });

    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.textContent = '✕';
    remove.title = t('comp.remove');
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        await removeLibraryEntry(entry.name);
      } catch (error) {
        statusLine(t('library.saveFailed', { error: error.message || error }), 'bad');
      }
      renderLibrary();
    });

    row.append(title, load, remove);
    list.append(row);
  });

  const select = $('library-stack');
  if (select) {
    const previous = select.value;
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = t('library.noPartner');
    select.append(none);
    for (const entry of parts) {
      const option = document.createElement('option');
      option.value = entry.name || entry.id || '';
      option.textContent = entry.name || entry.id || '?';
      select.append(option);
    }
    if (parts.some((entry) => (entry.name || entry.id) === previous)) select.value = previous;
  }

  updateStackInfo();
  renderExportParts();
}

async function saveToLibrary() {
  const name = ($('library-name').value || state.part.name || state.part.id || '').trim();
  if (!name) {
    statusLine(t('library.nameRequired'), 'warn');
    return;
  }

  const entry = {
    name,
    id: state.part.id,
    json: JSON.stringify(state.part),
    // The mesh travels with the part, so loading it from the library brings
    // the preview back. It is stored without the scale, the units of the part
    // are applied again when it is loaded.
    mesh: state.modelObject ? exportObj(state.modelObject, false) : '',
    modelName: state.part.model || 'model.obj',
    // The textures travel as well, otherwise the loaded part would lose them.
    textures: { ...state.textureSources },
    nodeTextures: structuredClone(state.nodeTextureSources),
    // The flame of the engine travels with the part: the parameters and the
    // profile of the flame.
    flame: flameToJson(state.flame),
    // The custom flames of the part travel with it.
    flames: JSON.parse(JSON.stringify(state.flames || [])),
    sound: state.soundData,
    savedAt: new Date().toISOString(),
  };

  try {
    await putLibraryEntry(entry);
  } catch (error) {
    statusLine(t('library.saveFailed', { error: error.message || error }), 'bad');
    return;
  }

  $('library-name').value = name;
  renderLibrary();
  statusLine(t('library.saved', { name }), 'ok');
}

$('btn-save-library').addEventListener('click', saveToLibrary);

function meshVolume() {
  let total = 0;
  if (!state.modelObject) return 0;

  state.modelObject.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const position = node.geometry.getAttribute('position');
    if (!position) return;
    const index = node.geometry.getIndex();
    const count = index ? index.count : position.count;

    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      const a = new THREE.Vector3().fromBufferAttribute(position, ia);
      const b = new THREE.Vector3().fromBufferAttribute(position, ib);
      const c = new THREE.Vector3().fromBufferAttribute(position, ic);
      total += a.dot(b.clone().cross(c)) / 6;
    }
  });

  return Math.abs(total);
}

function updateModelInfo() {
  const info = $('model-info');
  if (!info) return;

  if (!state.modelObject) {
    info.textContent = t('model.noMesh');
    return;
  }

  const units = UNITS[state.part.units] ?? 1;
  const scale = Number(state.part.scale) > 0 ? Number(state.part.scale) : 1;
  const factor = units * scale;
  const volume = meshVolume() * factor * factor * factor;
  info.textContent = t('model.info', {
    volume: volume.toFixed(3),
    mass: (Number(state.part.mass) || 0).toFixed(1),
  });
}

function attachmentDirection(attachment) {
  if (!attachment) return new THREE.Vector3(0, 1, 0);
  if (attachment.rotation && attachment.rotation.length === 3) {
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(attachment.rotation[0]),
      THREE.MathUtils.degToRad(attachment.rotation[1]),
      THREE.MathUtils.degToRad(attachment.rotation[2]),
      'ZXY',
    );
    return new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(euler));
  }

  const direction = attachment.direction || [0, 1, 0];
  return new THREE.Vector3(direction[0] || 0, direction[1] || 0, direction[2] || 0).normalize();
}

function socketOffset(attachment) {
  const sockets = attachment?.sockets || [];
  const socket = sockets[0] || [0, 0, 0];
  return new THREE.Vector3(socket[0] || 0, 0, socket[2] || 0);
}

function updateStackInfo() {
  const info = $('stack-info');
  if (!info) return;

  const name = $('library-stack')?.value;
  if (!name) {
    info.textContent = t('library.noPartner');
    return;
  }

  const entry = libraryParts().find((item) => (item.name || item.id) === name);
  if (!entry) {
    info.textContent = t('library.noPartner');
    return;
  }

  let partner;
  try {
    partner = JSON.parse(entry.json);
  } catch {
    info.textContent = t('library.loadFailed', { error: '?' });
    return;
  }

  const mine = state.part.attachments || [];
  const theirs = partner.attachments || [];
  if (!mine.length || !theirs.length) {
    info.textContent = t('library.noAttachments');
    return;
  }

  const bottom = mine[mine.length - 1];
  const top = theirs[0];
  const myDirection = attachmentDirection(bottom);
  const theirDirection = attachmentDirection(top);
  const opposite = myDirection.dot(theirDirection) < -0.7;
  const offset = socketOffset(bottom).distanceTo(socketOffset(top));
  const gap = Math.abs(bottom.position?.[1] ?? 0) + Math.abs(top.position?.[1] ?? 0);

  info.textContent = t('library.stack', {
    offset: (offset * 1000).toFixed(0),
    gap: (gap * 1000).toFixed(0),
    directions: opposite ? t('library.stackOk') : t('library.stackBad'),
  });
}

$('library-stack').addEventListener('change', updateStackInfo);

// Puts the textures of a library entry back into the preview.
async function restoreLibraryTextures(entry) {
  const sources = entry.textures || {};
  for (const key of Object.keys(sources)) {
    if (!sources[key]) continue;
    // eslint-disable-next-line no-await-in-loop
    const texture = await new Promise((resolve) => loadTextureFromSource(sources[key], resolve));
    if (!texture) continue;
    const previous = state.previewTextures[key];
    if (previous) previous.dispose();
    state.previewTextures[key] = texture;
    state.textureSources[key] = sources[key];
  }

  const nodeSources = entry.nodeTextures || {};
  for (const path of Object.keys(nodeSources)) {
    for (const key of Object.keys(nodeSources[path])) {
      if (!nodeSources[path][key]) continue;
      // eslint-disable-next-line no-await-in-loop
      const texture = await new Promise((resolve) => loadTextureFromSource(nodeSources[path][key], resolve));
      if (!texture) continue;
      if (!state.nodeTextures[path]) state.nodeTextures[path] = {};
      state.nodeTextures[path][key] = texture;
      if (!state.nodeTextureSources[path]) state.nodeTextureSources[path] = {};
      state.nodeTextureSources[path][key] = nodeSources[path][key];
    }
  }

  applyModelMaterial();
  updateTextureButtons();
}

$('btn-add-node-material').addEventListener('click', () => {
  const path = $('node-material-select').value;
  if (!path) return;

  state.part.materials = state.part.materials || [];
  const key = path.startsWith('model/') ? path : `model/${path}`;
  if (state.part.materials.some((entry) => entry.node === key)) {
    statusLine(t('nodeMat.exists', { path: key }), 'warn');
    return;
  }

  state.part.materials.push({
    node: key,
    color: '#c8ccd4',
    metallic: 0.2,
    smoothness: 0.4,
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
  });
  state.nodeMaterial = state.part.materials.length - 1;
  renderNodeMaterials();
  applyModelMaterial();
  renderStatus();
});

function updateSnap() {
  transform.translationSnap = $('chk-snap').checked ? 0.1 : null;
}

const COM = $('com-fields').querySelectorAll('input');
COM.forEach((input, axis) => {
  input.addEventListener('input', () => {
    state.part.centerOfMassAdjustment[axis] = Number(input.value) || 0;
    renderStatus();
  });
});

function bindJsonArea(id, prop) {
  const element = $(id);
  element.addEventListener('input', () => {
    const text = element.value.trim();
    if (!text) {
      state.part[prop] = {};
      state.jsonInvalid[prop] = false;
      element.classList.remove('invalid');
      renderStatus();
      renderComponents();
      return;
    }
    try {
      const value = JSON.parse(text);
      state.part[prop] = value;
      state.jsonInvalid[prop] = false;
      element.classList.remove('invalid');
      renderComponents();
    } catch {
      state.jsonInvalid[prop] = true;
      element.classList.add('invalid');
      statusLine(t('status.invalidJson', { field: prop }), 'bad');
    }
    renderStatus();
  });
}

// ---------------------------------------------------------------------------
// The reentry shell of the part: the stock shells are exact copies of the mesh of
// their own part (see PartLoader/PartLoader.cs, CreateReentryShell), so the preview
// draws the same copy with a glowing translucent material.
// ---------------------------------------------------------------------------

let reentryShell = null;
let reentryTriangles = null;
let reentryGeometry = null;
let reentrySource = null;

const reentryMaterial = new THREE.MeshStandardMaterial({
  color: 0x8a3a2a,
  emissive: 0x401008,
  roughness: 0.6,
  metalness: 0.1,
  transparent: true,
  opacity: 0.4,
  side: THREE.DoubleSide,
  depthWrite: false,
});

// The triangles of the model in the space of modelRoot, merged into one soup like
// the loader merges the meshes of the part into one shell mesh.
function collectModelTriangles(object) {
  object.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert();
  const positions = [];
  const indices = [];
  const vertex = new THREE.Vector3();

  object.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const position = node.geometry.getAttribute('position');
    if (!position) return;

    const matrix = new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld);
    const base = positions.length / 3;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
      positions.push(vertex.x, vertex.y, vertex.z);
    }

    const index = node.geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
    } else {
      for (let i = 0; i < position.count; i++) indices.push(base + i);
    }
  });

  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

function updateReentryShell(rebuild = false) {
  if (reentryShell) {
    modelRoot.remove(reentryShell);
    reentryShell = null;
  }

  if (!$('chk-reentry')?.checked || !state.modelObject) return;

  if (rebuild || reentrySource !== state.modelObject || !reentryTriangles) {
    reentryTriangles = collectModelTriangles(state.modelObject);
    reentrySource = state.modelObject;

    if (reentryGeometry) {
      reentryGeometry.dispose();
      reentryGeometry = null;
    }
  }

  if (!reentryGeometry) {
    // The loader copies the model as it is: no offset, no rounding.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(reentryTriangles.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(reentryTriangles.indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    reentryGeometry = geometry;
  }

  reentryShell = new THREE.Mesh(reentryGeometry, reentryMaterial);
  reentryShell.renderOrder = 2;
  modelRoot.add(reentryShell);
}

$('chk-reentry').addEventListener('change', () => updateReentryShell(true));

// ---------------------------------------------------------------------------
// Thermal values: the fields of the schema of the game
// ---------------------------------------------------------------------------

const THERMO_FIELDS = [
  { key: 'heatCapacity', label: { en: 'Heat capacity, J/K', ru: 'Теплоёмкость, Дж/К' }, default: 900 },
  { key: 'conductivity', label: { en: 'Conductivity, W/mK', ru: 'Теплопроводность, Вт/мК' }, default: 237 },
  { key: 'skinConductivity', label: { en: 'Skin conductivity, W/mK', ru: 'Теплопроводность обшивки, Вт/мК' }, default: 237 },
  { key: 'emissivity', label: { en: 'Emissivity', ru: 'Излучательная способность' }, default: 0.8 },
  { key: 'absorption', label: { en: 'Absorption', ru: 'Поглощение' }, default: 0.85 },
  { key: 'skinDensity', label: { en: 'Skin density, kg/m³', ru: 'Плотность обшивки, кг/м³' }, default: 2710 },
  { key: 'maxTemperatureInt', label: { en: 'Max temperature inside, K', ru: 'Макс. температура внутри, К' }, default: 900 },
  { key: 'maxTemperatureSkin', label: { en: 'Max temperature of the skin, K', ru: 'Макс. температура обшивки, К' }, default: 1000 },
];

function renderThermoFields() {
  const wrap = $('thermo-fields');
  if (!wrap) return;
  wrap.textContent = '';

  for (const field of THERMO_FIELDS) {
    const cell = document.createElement('div');
    cell.className = 'field';

    const label = document.createElement('label');
    label.textContent = componentText(field.label);
    cell.append(label);

    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.value = state.part.thermo?.[field.key] ?? field.default;
    input.addEventListener('input', () => {
      state.part.thermo = state.part.thermo || {};
      const value = Number(input.value);
      if (Number.isFinite(value) && value !== field.default) {
        state.part.thermo[field.key] = value;
      } else {
        delete state.part.thermo[field.key];
      }
      renderStatus();
      if (state.modelObject) renderVolumeInfo();
    });
    cell.append(input);
    wrap.append(cell);
  }
}

bindJsonArea('f-modules', 'modules');
bindJsonArea('f-state', 'state');
bindJsonArea('f-overrides', 'overrides');

// ---------------------------------------------------------------------------
// Components: an ECS-like editor for the modules a part carries
// ---------------------------------------------------------------------------

function componentText(label) {
  if (!label) return '';
  const lang = getLang();
  return label[lang] || label.en || '';
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    const copy = {};
    for (const [key, item] of Object.entries(value)) copy[key] = cloneValue(item);
    return copy;
  }
  return value;
}

function componentDefaults(fields) {
  const result = {};
  for (const field of fields || []) {
    result[field.path] = field.type === 'object' ? componentDefaults(field.fields) : cloneValue(field.default);
  }
  return result;
}

function getPath(target, path) {
  return String(path).split('.').reduce((node, key) => (node == null ? undefined : node[key]), target);
}

function setPath(target, path, value) {
  const keys = String(path).split('.');
  let node = target;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof node[keys[i]] !== 'object' || node[keys[i]] === null) node[keys[i]] = {};
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
}

function componentBucket(bucket) {
  const part = state.part;
  if (!part[bucket] || typeof part[bucket] !== 'object' || Array.isArray(part[bucket])) {
    part[bucket] = {};
  }
  return part[bucket];
}

function syncRawJson(prop) {
  if (state.jsonInvalid[prop]) return;
  const element = prop === 'modules' ? $('f-modules') : $('f-state');
  element.value = JSON.stringify(state.part[prop] || {}, null, 2);
}

function commitComponents() {
  syncRawJson('modules');
  syncRawJson('state');
  // The trigger list of the animations comes from the PartStateModule, so it
  // has to be rebuilt when the modules change.
  renderAnimations();
  updateFlamePreview();
  renderStatus();
}

function populateComponentSelect() {
  const select = $('component-select');
  select.innerHTML = '';
  for (const group of COMPONENT_GROUPS) {
    const items = COMPONENTS.filter((component) => component.group === group.id);
    if (!items.length) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = componentText(group.label);
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.key;
      option.textContent = componentText(item.label);
      optgroup.append(option);
    }
    select.append(optgroup);
  }
}

function renderComponents() {
  const list = $('component-list');
  if (!list) return;
  list.textContent = '';

  const modules = componentBucket('modules');
  const keys = Object.keys(modules);
  if (!keys.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = t('comp.empty');
    list.append(empty);
  }

  for (const key of keys) {
    const def = COMPONENT_BY_KEY[key];
    const row = document.createElement('div');
    row.className = 'component-row' + (state.component === key ? ' selected' : '');

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = def ? def.key.replace(/^Model\./, '') : '?';

    const title = document.createElement('span');
    title.className = 'label';
    title.textContent = def ? componentText(def.label) : key;

    // The state entry of this module was filled with the stock values: the game
    // creates the module with them, the author did not write them.
    let filled = null;
    if (filledStateModules.has(key)) {
      filled = document.createElement('span');
      filled.className = 'badge';
      filled.textContent = 'state';
      filled.title = t('comp.filledState');
    }

    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.textContent = '✕';
    remove.title = t('comp.remove');
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      removeComponent(key);
    });

    row.append(badge, title, remove);
    if (filled) row.append(filled);
    row.addEventListener('click', () => {
      state.component = state.component === key ? null : key;
      renderComponents();
    });
    list.append(row);

    if (state.component !== key) continue;

    const editor = document.createElement('div');
    editor.className = 'component-editor';
    if (!def) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = t('comp.unknown');
      editor.append(hint);
    } else {
      if (def.config.length) editor.append(componentBlock(t('comp.config'), def.config, key, 'modules'));
      if (def.state.length) editor.append(componentBlock(t('comp.state'), def.state, key, 'state'));
    }
    list.append(editor);
  }

  // The fuel capacity of the modules changes the ratio shown by the volume tool.
  if (state.volumeInfo) renderVolumeInfo();
}

function extraKeys(target, fields) {
  const known = new Set((fields || []).map((field) => field.path));
  const extra = [];
  for (const [name, value] of Object.entries(target || {})) {
    if (!known.has(name)) extra.push({ name, value });
  }
  return extra;
}

function componentBlock(title, fields, key, bucket) {
  const block = document.createElement('div');
  block.className = 'component-block';

  const head = document.createElement('h3');
  head.textContent = title;
  block.append(head);

  const holder = componentBucket(bucket);
  if (!holder[key] || typeof holder[key] !== 'object') holder[key] = {};
  const target = holder[key];

  for (const field of fields || []) {
    block.append(componentField(field, target));
  }

  const extra = extraKeys(target, fields);
  if (extra.length) {
    const names = extra.map((item) => item.name);
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    const label = document.createElement('label');
    label.textContent = t('comp.extra');
    wrapper.append(label);

    const textarea = document.createElement('textarea');
    textarea.className = 'code';
    textarea.rows = Math.min(8, names.length + 1);
    textarea.value = JSON.stringify(Object.fromEntries(extra.map((item) => [item.name, item.value])), null, 2);
    textarea.addEventListener('input', () => {
      try {
        const parsed = JSON.parse(textarea.value || '{}');
        for (const name of names) {
          if (!(name in parsed)) delete target[name];
        }
        Object.assign(target, parsed);
        textarea.classList.remove('invalid');
        commitComponents();
      } catch {
        textarea.classList.add('invalid');
      }
    });
    wrapper.append(textarea);
    block.append(wrapper);
  }

  return block;
}

function componentTransitionsField(field, target) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  const caption = document.createElement('label');
  caption.textContent = componentText(field.label);
  wrapper.append(caption);

  const list = document.createElement('div');
  list.className = 'transitions';

  const render = () => {
    list.textContent = '';
    const states = Array.isArray(target.states) ? target.states : [];
    const items = Array.isArray(target[field.path]) ? target[field.path] : [];

    const stateSelect = (value, onChange) => {
      const select = document.createElement('select');
      if (!states.length) {
        const option = document.createElement('option');
        option.value = '0';
        option.textContent = '0';
        select.append(option);
      }
      states.forEach((name, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = name;
        select.append(option);
      });
      select.value = String(value ?? 0);
      select.addEventListener('change', () => onChange(Number(select.value)));
      return select;
    };

    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'transition-row';

      const from = stateSelect(item.transition?.x, (value) => {
        item.transition = { x: value, y: Number(item.transition?.y ?? 0) };
        commitComponents();
      });

      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '→';

      const to = stateSelect(item.transition?.y, (value) => {
        item.transition = { x: Number(item.transition?.x ?? 0), y: value };
        commitComponents();
      });

      const trigger = document.createElement('input');
      trigger.type = 'text';
      trigger.placeholder = 'deploy';
      trigger.value = item.trigger || '';
      trigger.addEventListener('input', () => {
        item.trigger = trigger.value;
        commitComponents();
      });

      const remove = document.createElement('button');
      remove.className = 'icon-btn';
      remove.textContent = '✕';
      remove.title = t('comp.remove');
      remove.addEventListener('click', () => {
        items.splice(index, 1);
        render();
        commitComponents();
      });

      row.append(from, arrow, to, trigger, remove);
      list.append(row);
    });

    const add = document.createElement('button');
    add.className = 'btn small';
    add.textContent = t('comp.addTransition');
    add.addEventListener('click', () => {
      const items = Array.isArray(target[field.path]) ? target[field.path] : (target[field.path] = []);
      items.push({ transition: { x: 0, y: Math.min(1, Math.max(0, states.length - 1)) }, trigger: '' });
      render();
      commitComponents();
    });
    list.append(add);
  };

  render();
  wrapper.append(list);
  return wrapper;
}

function componentField(field, target) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  if (field.type !== 'bool') {
    const label = document.createElement('label');
    label.textContent = componentText(field.label);
    wrapper.append(label);
  }

  const write = (value) => {
    setPath(target, field.path, value);
    commitComponents();
  };

  if (field.type === 'object') {
    wrapper.classList.add('component-object');
    if (!getPath(target, field.path) || typeof getPath(target, field.path) !== 'object') {
      setPath(target, field.path, componentDefaults(field.fields));
    }
    const nested = getPath(target, field.path);
    for (const sub of field.fields) {
      wrapper.append(componentField(sub, nested));
    }
  } else if (field.type === 'transitions') {
    wrapper.append(componentTransitionsField(field, target));
  } else {
    wrapper.append(componentInput(field, target, write));
  }

  if (field.hint) {
    const hint = document.createElement('small');
    hint.textContent = componentText(field.hint);
    wrapper.append(hint);
  }

  return wrapper;
}

function componentInput(field, target, write) {
  const value = getPath(target, field.path);

  if (field.type === 'bool') {
    const wrapper = document.createElement('label');
    wrapper.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value === true;
    input.addEventListener('change', () => write(input.checked));
    wrapper.append(input, document.createTextNode(componentText(field.label)));
    return wrapper;
  }

  if (field.type === 'enum') {
    const select = document.createElement('select');
    for (const option of field.options || []) {
      const node = document.createElement('option');
      node.value = option;
      node.textContent = option;
      select.append(node);
    }
    select.value = value ?? field.default ?? '';
    select.addEventListener('change', () => write(select.value));
    return select;
  }

  if (field.type === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = field.step ?? 'any';
    input.value = value ?? '';
    input.addEventListener('input', () => write(input.value === '' ? 0 : Number(input.value)));
    return input;
  }

  if (field.type === 'text') {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value ?? '';
    input.addEventListener('input', () => write(input.value));
    return input;
  }

  if (field.type === 'nodes') {
    const wrapper = document.createElement('div');
    wrapper.className = 'node-picker';

    const current = () => {
      const list = getPath(target, field.path);
      return Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item) : [];
    };

    const chips = document.createElement('div');
    chips.className = 'node-chips';

    const refresh = () => {
      chips.textContent = '';
      const list = current();
      if (!list.length) {
        const empty = document.createElement('small');
        empty.className = 'hint';
        empty.textContent = t('nodes.empty');
        chips.append(empty);
        return;
      }

      list.forEach((path, index) => {
        const chip = document.createElement('span');
        chip.className = 'node-chip';
        chip.append(document.createTextNode(path));

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-btn';
        remove.title = t('nodes.remove');
        remove.textContent = '\u00d7';
        remove.addEventListener('click', () => {
          const next = current().slice();
          next.splice(index, 1);
          write(next);
          refresh();
        });
        chip.append(remove);
        chips.append(chip);
      });
    };

    const row = document.createElement('div');
    row.className = 'node-picker-row';

    const select = document.createElement('select');
    const paths = modelNodePaths();
    if (!paths.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = t('nodes.noNodes');
      select.append(option);
      select.disabled = true;
    } else {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = t('nodes.pick');
      select.append(placeholder);
      for (const path of paths) {
        const option = document.createElement('option');
        option.value = path;
        option.textContent = path;
        select.append(option);
      }
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn';
    button.title = t('nodes.add');
    button.textContent = '+';
    button.disabled = !paths.length;
    button.addEventListener('click', () => {
      if (!select.value) return;
      const next = current().slice();
      const path = 'model/' + select.value;
      if (!next.includes(path)) next.push(path);
      write(next);
      refresh();
      select.value = '';
    });

    row.append(select, button);
    wrapper.append(row, chips);
    refresh();
    return wrapper;
  }

  if (field.type === 'numbers' || field.type === 'strings') {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = Array.isArray(value) ? value.join(', ') : '';
    input.addEventListener('input', () => {
      const parts = input.value.split(',').map((item) => item.trim()).filter(Boolean);
      write(field.type === 'numbers' ? parts.map(Number).filter(Number.isFinite) : parts);
    });
    return input;
  }

  if (field.type === 'vector2' || field.type === 'vector3' || field.type === 'vector4') {
    const axes = field.type === 'vector2' ? ['x', 'y'] : field.type === 'vector3' ? ['x', 'y', 'z'] : ['x', 'y', 'z', 'w'];
    const wrapper = document.createElement('div');
    wrapper.className = field.type === 'vector4' ? 'vec4' : 'vec3';
    const current = value && typeof value === 'object' ? value : {};
    for (const axis of axes) {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.placeholder = axis;
      input.value = current[axis] ?? 0;
      input.addEventListener('input', () => {
        const next = { ...(getPath(target, field.path) || {}) };
        next[axis] = Number(input.value) || 0;
        write(next);
      });
      wrapper.append(input);
    }
    return wrapper;
  }

  if (field.type === 'quat' || field.type === 'rotation') {
    const wrapper = document.createElement('div');
    wrapper.className = 'vec4';
    const current = value && typeof value === 'object' ? (value.value || value) : {};
    for (const axis of ['x', 'y', 'z', 'w']) {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.placeholder = axis;
      input.value = current[axis] ?? 0;
      input.addEventListener('input', () => {
        const source = getPath(target, field.path) || {};
        const base = source.value || source;
        const next = { ...base };
        next[axis] = Number(input.value) || 0;
        write(field.type === 'rotation' ? { value: next } : next);
      });
      wrapper.append(input);
    }
    return wrapper;
  }

  const textarea = document.createElement('textarea');
  textarea.className = 'code';
  textarea.rows = 4;
  textarea.value = JSON.stringify(value ?? null, null, 2);
  textarea.addEventListener('input', () => {
    try {
      write(JSON.parse(textarea.value || 'null'));
      textarea.classList.remove('invalid');
    } catch {
      textarea.classList.add('invalid');
    }
  });
  return textarea;
}

// The attachment a part is mounted by: the one facing down when the part has
// it (the base of a nose cone or of a stage), else the only attachment left.
// The separator of a fairing breaks that connection, so a new one starts
// there instead of at a hard-coded stock id.
function baseAttachmentId() {
  const attachments = state.part.attachments || [];
  let best = null;
  for (const attachment of attachments) {
    const id = Number(attachment.id);
    if (!Number.isFinite(id)) continue;
    const y = toVec3(attachment.direction, [0, 1, 0])[1];
    if (!best || y < best.y) best = { id, y };
  }
  return best ? best.id : 0;
}

function addComponent(key) {
  const def = COMPONENT_BY_KEY[key];
  if (!def) return;

  const modules = componentBucket('modules');
  if (!modules[key] || typeof modules[key] !== 'object') modules[key] = componentDefaults(def.config);

  // The separator breaks the connections it names (detachConnIds are ids of
  // the attachments of this part) and the game reads them without a null
  // check: a stale stock id throws inside the decouple command, which the
  // game then repeats every frame. A fresh separator therefore points at the
  // connection the part is mounted by instead of a hard-coded number.
  if (key === 'Model.ResourceSeparatorModule' &&
      !(Array.isArray(modules[key].detachConnIds) && modules[key].detachConnIds.length)) {
    modules[key].detachConnIds = [baseAttachmentId()];
  }

  // The game creates the modules of a part from its state, so every module of
  // the config needs an entry there, even an empty one: a module without it is
  // never created (the loader adds the entry for the modules it fills itself).
  const states = componentBucket('state');
  if (!states[key] || typeof states[key] !== 'object') {
    states[key] = def.state.length ? componentDefaults(def.state) : {};
  }

  state.component = key;
  renderComponents();
  commitComponents();
}

function removeComponent(key) {
  delete componentBucket('modules')[key];
  delete componentBucket('state')[key];
  if (state.component === key) state.component = null;
  renderComponents();
  commitComponents();
}

$('btn-add-component').addEventListener('click', () => {
  const key = $('component-select').value;
  if (key) addComponent(key);
});


// ---------------------------------------------------------------------------
// Animations: procedural motions of the model nodes
// ---------------------------------------------------------------------------

const ANIMATION_TYPES = ['spin', 'deploy', 'keys'];

function animationTypeLabel(type) {
  if (type === 'deploy') return t('anim.deploy');
  if (type === 'keys') return t('anim.keys');
  return t('anim.spin');
}

function buildModelNodeMap() {
  const map = new Map();
  const root = state.modelObject;
  if (!root) return map;

  const walk = (object, prefix) => {
    for (const child of object.children) {
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      // Lines and points cannot be rendered by the game, so they are not nodes.
      if (!isRenderableObject(child)) continue;
      map.set(path, child);
      walk(child, path);
    }
  };
  walk(root, '');
  return map;
}

function isRenderableObject(object) {
  return !object.isLine && !object.isLineSegments && !object.isPoints;
}

function modelNodePaths() {
  return state.modelNodeMap ? [...state.modelNodeMap.keys()] : [];
}

// Resolves a part.json animation path ("model/dish") inside the loaded mesh.
function resolveAnimationNode(path) {
  if (!path || !state.modelNodeMap) return null;
  let relative = String(path);
  if (relative.startsWith('model/')) relative = relative.slice('model/'.length);
  return state.modelNodeMap.get(relative) || null;
}

function populateAnimationNodes() {
  const select = $('animation-node-select');
  const previous = select.value;
  select.innerHTML = '';

  const paths = modelNodePaths();
  if (!paths.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = t('anim.noNodes');
    select.append(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const path of paths) {
    const option = document.createElement('option');
    option.value = path;
    option.textContent = path;
    select.append(option);
  }
  if (paths.includes(previous)) select.value = previous;
}

function animationDefaults() {
  return {
    path: '',
    type: 'spin',
    axis: [0, 1, 0],
    pivot: [0, 0, 0],
    speed: 30,
    stowed: 0,
    deployed: 90,
    duration: 2,
    trigger: '',
    foldTrigger: '',
    tint: '',
    tintAmount: 1,
    translate: false,
    keys: [],
  };
}

// A motion with keys starts with two of them: the node at the start and at the
// end of the timeline.
function defaultAnimationKeys(duration = 2) {
  return [
    { time: 0, angle: 0, smooth: true },
    { time: Math.max(0.5, duration), angle: 90, smooth: true },
  ];
}

// The angle of a motion at a given time is read by the graph editor
// (anim-curve.js), the same way the runtime driver reads it
// (PartAnimationDriver.SampleKeys).

// ---------------------------------------------------------------------------
// The graph editor of a motion: the curve of the channel over the time, the
// keyframes on it and the playhead. It works like the graph editor of
// Blender: the curve is the value of the channel, the points on it are the
// keyframes and a point is dragged to move its keyframe.
// ---------------------------------------------------------------------------

let curveEditor = null;

// The height of the graph, kept between the sessions like the panel widths.
const CURVE_STORE = 'partadder.editor.curveHeight';
const CURVE_LIMITS = { min: 150, preferred: 190, max: 640 };

function applyCurveHeight(height) {
  const curve = $('anim-curve');
  if (!curve) return;
  if (height) {
    curve.style.height = `${height}px`;
  } else {
    // No height of its own: the svg inside picks its default.
    curve.style.height = '';
  }
}

function loadCurveHeight() {
  try {
    const stored = Number(localStorage.getItem(CURVE_STORE));
    if (Number.isFinite(stored) && stored >= CURVE_LIMITS.min) {
      applyCurveHeight(Math.min(CURVE_LIMITS.max, stored));
    }
  } catch {
    /* storage may be disabled; the height simply resets next time */
  }
}

// The drag handle of the graph: works like the splitters of the side panels.
function bindCurveResizer() {
  const resizer = $('anim-curve-resizer');
  const curve = $('anim-curve');
  if (!resizer || !curve) return;

  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  resizer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    startY = event.clientY;
    startHeight = curve.clientHeight || CURVE_LIMITS.preferred;
    resizer.classList.add('dragging');
    document.body.classList.add('resizing-curve');
    try {
      resizer.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers (tests) refuse capture; the window listeners
      // below still track the drag.
    }
  });

  const move = (event) => {
    if (!dragging) return;
    // Drag up to grow the graph, like pulling the bottom edge of a window.
    const height = Math.round(startHeight + (startY - event.clientY));
    applyCurveHeight(Math.max(CURVE_LIMITS.min, Math.min(CURVE_LIMITS.max, height)));
  };

  const stop = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.classList.remove('resizing-curve');
    try {
      const height = curve.clientHeight;
      if (height && Math.abs(height - CURVE_LIMITS.preferred) > 2) {
        localStorage.setItem(CURVE_STORE, String(height));
      } else {
        localStorage.removeItem(CURVE_STORE);
      }
    } catch {
      /* ignore storage failures */
    }
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);

  resizer.addEventListener('dblclick', () => {
    applyCurveHeight(null);
    try {
      localStorage.removeItem(CURVE_STORE);
    } catch {
      /* ignore */
    }
  });
}

function initCurveEditor() {
  const root = $('anim-curve');
  if (!root) return;

  curveEditor = createMotionCurve(root, {
    getAnimation: () => {
      const animations = state.part.animations || [];
      return state.animation === null ? null : animations[state.animation] || null;
    },
    getIndex: () => state.animation,
    getTime: () => state.animPreview.time,
    selectedKey: () => state.animPreview.key,
    onScrub: (time) => setPreviewTime(time),
    onSelectKey: (index) => {
      if (index < 0) return;
      state.animPreview.key = { track: state.animation, key: index };
      renderAnimations();
    },
    onAddKey: (time, value) => addAnimationKey(state.animation, time, value),
    onRemoveKey: (index) => {
      const animation = (state.part.animations || [])[state.animation];
      if (!animation?.keys?.[index]) return;
      animation.keys.splice(index, 1);
      state.animPreview.key = null;
      renderAnimations();
      renderStatus();
    },
    onDragKey: (point, time, value) => {
      writeMotionPoint(state.animation, point, time, value);
      applyAnimationPreview();
      renderStatus();
    },
    onDragEnd: () => {
      renderAnimations();
    },
  });
}

// Keeps the keyframes of a curve in time order. The runtime walks the pairs of
// neighbouring keys, so an unordered list is sampled wrongly; a typed time or a
// dragged point can cross a neighbour.
function sortAnimationKeys(animation) {
  if (!animation || animation.type !== 'keys' || !Array.isArray(animation.keys)) return;
  animation.keys.sort((a, b) => (Number(a?.time) || 0) - (Number(b?.time) || 0));
}

// Writes a point of the curve back into the motion. The types of the game
// store their curve in different fields, so the point is written into the
// field that belongs to it.
function writeMotionPoint(index, point, time, value) {
  const animation = (state.part.animations || [])[index];
  if (!animation) return;

  if (animation.type === 'keys') {
    const key = animation.keys?.[point.index];
    if (!key) return;
    // The keys of a motion live inside its loop, which is "duration" seconds long.
    // A time past the end lengthens the loop instead of snapping back in the
    // field: the runtime driver samples the curve over "duration", so a key
    // written after the end would never be reached. A key is a number in metres
    // or degrees, so it keeps hundredths (a step of 0.1 was too coarse for a
    // small translation).
    const at = Math.round(Math.max(0, time) * 100) / 100;
    const duration = motionDuration(animation);
    if (!(Number(animation.duration) > 0)) {
      // The motion has no length written yet: pin the one the preview is already
      // using, so the exported part.json loops over the same time.
      animation.duration = duration;
    } else if (at > duration) {
      animation.duration = at;
    }
    key.time = at;
    key.angle = Math.round(value * 100) / 100;
    return;
  }

  if (animation.type === 'deploy') {
    if (point.pose === 'stowed') {
      animation.stowed = Math.round(value * 10) / 10;
      return;
    }

    animation.deployed = Math.round(value * 10) / 10;
    animation.duration = Math.max(0.01, Math.round(time * 100) / 100);
    return;
  }

  // A spin: the slope of the line is the speed, the end of the line is the
  // length of the motion.
  const duration = Math.max(0.01, Math.round(time * 100) / 100);
  animation.duration = duration;
  animation.speed = Math.round((value / duration) * 10) / 10;
}

// The dope sheet of a motion: the points of the curve as a list, the way the
// dope sheet of Blender shows the keyframes of a channel.
function animationDopeSheet(animation, index) {
  const wrapper = document.createElement('div');
  wrapper.className = 'anim-keys';

  const header = document.createElement('div');
  header.className = 'anim-keys-head';
  for (const title of [t('anim.sheetTime'), t('anim.sheetValue'), t('anim.keySmooth')]) {
    const cell = document.createElement('span');
    cell.className = 'label';
    cell.textContent = title;
    header.append(cell);
  }
  wrapper.append(header);

  const list = document.createElement('div');
  list.className = 'compact-list';
  const points = motionPoints(animation);

  points.forEach((point, pointIndex) => {
    const row = document.createElement('div');
    const selected = state.animPreview.key?.track === index && state.animPreview.key?.key === point.index;
    row.className = 'component-row' + (selected ? ' selected' : '');

    // A live write of a field of the key. The list is NOT rebuilt here: a
    // renderAnimations() on every keystroke replaced the input the author was
    // typing in, so typing a number restarted from the value of the model (a
    // leading zero became 0 and the dot of a small number was lost). The row is
    // normalized once, on "change", when the field is left or Enter is pressed.
    const writeKey = (text, isTime) => {
      const trimmed = String(text).trim();
      if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '-.') return;
      const number = Number(trimmed);
      if (!Number.isFinite(number)) return;
      if (isTime) {
        writeMotionPoint(index, point, number, point.value);
      } else {
        writeMotionPoint(index, point, point.time, number);
      }
      applyAnimationPreview();
      renderStatus();
    };

    const time = document.createElement('input');
    time.type = 'number';
    time.step = '0.01';
    time.className = 'anim-key-time';
    time.value = String(Math.round(point.time * 100) / 100);
    time.addEventListener('input', () => writeKey(time.value, true));
    time.addEventListener('change', () => renderAnimations());

    const value = document.createElement('input');
    value.type = 'number';
    // "any" keeps the browser from rejecting a small value such as 0.05: it is a
    // number in metres, not a whole step of 0.1.
    value.step = 'any';
    value.className = 'anim-key-value';
    value.value = String(Math.round(point.value * 100) / 100);
    value.addEventListener('input', () => writeKey(value.value, false));
    value.addEventListener('change', () => renderAnimations());

    const smooth = document.createElement('label');
    smooth.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = point.smooth !== false;
    box.disabled = animation.type !== 'keys';
    box.addEventListener('change', () => {
      const key = animation.keys?.[point.index];
      if (!key) return;
      key.smooth = box.checked;
      renderStatus();
    });
    const text = document.createElement('span');
    text.textContent = animation.translate ? 'm' : '°';
    smooth.append(box, text);

    row.append(time, value, smooth);
    row.addEventListener('click', (event) => {
      if (event.target !== time && event.target !== value) {
        if (point.index >= 0) state.animPreview.key = { track: index, key: point.index };
        setPreviewTime(point.time);
        renderAnimations();
      }
    });
    list.append(row);
  });

  wrapper.append(list);

  // A motion with keys gets a button to add one at the end.
  if (animation.type === 'keys') {
    const buttons = document.createElement('div');
    buttons.className = 'input-row';
    const add = document.createElement('button');
    add.className = 'btn small';
    add.textContent = t('anim.addKey');
    add.addEventListener('click', () => {
      const duration = motionDuration(animation);
      const last = motionPoints(animation).at(-1);
      addAnimationKey(index, Math.min(duration, (last?.time ?? 0) + 0.5), (last?.value ?? 0) + 45);
    });
    buttons.append(add);

    const remove = document.createElement('button');
    remove.className = 'btn small';
    remove.textContent = t('anim.removeKey');
    remove.disabled = !state.animPreview.key || state.animPreview.key.track !== index;
    remove.addEventListener('click', () => removeAnimationKey());
    buttons.append(remove);
    wrapper.append(buttons);
  }

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = t('anim.keysHint');
  wrapper.append(hint);

  return wrapper;
}

// ---------------------------------------------------------------------------
// Animation preview: the same transform math the runtime driver applies
// ---------------------------------------------------------------------------

const previewBases = new Map();
const previewClock = new THREE.Clock();

function animationAxis(animation) {
  const values = animation.axis || [0, 1, 0];
  const axis = new THREE.Vector3(
    Number(values[0]) || 0,
    Number(values[1]) || 0,
    Number(values[2]) || 0,
  );
  if (!Number.isFinite(axis.x) || !Number.isFinite(axis.y) || !Number.isFinite(axis.z) || axis.lengthSq() < 1e-6) {
    axis.set(0, 1, 0);
  }
  return axis.normalize();
}

// The pivot of a motion: the point the node turns around, in the space of the
// node. Zero turns the node around its own origin.
function animationPivot(animation) {
  const values = animation.pivot;
  if (!values) return new THREE.Vector3();
  return new THREE.Vector3(
    Number(values[0]) || 0,
    Number(values[1]) || 0,
    Number(values[2]) || 0,
  );
}

// The exploded view moves the root children of the mesh, and the animation
// preview writes their positions and quaternions as well: every pose is rebuilt
// from the rest positions captured when the mesh loaded, so the two never bake
// an offset of one into the rest pose of the other.
function resetRootChildrenPositions() {
  const root = state.modelObject;
  if (!root || !state.explodeRest || state.explodeRest.length !== root.children.length) return;
  root.children.forEach((child, index) => child.position.copy(state.explodeRest[index]));
}

// The rest position of a root child, even while the preview or the exploded view
// hold it away from it.
function rootChildRestPosition(node) {
  const root = state.modelObject;
  if (!root || node.parent !== root || !state.explodeRest) return null;
  const index = root.children.indexOf(node);
  if (index < 0) return null;
  return state.explodeRest[index] || null;
}

// The exploded view is an offset on top of the pose of the animation, not a pose
// of its own.
function applyExplodeOffsets() {
  const root = state.modelObject;
  const offsets = state.explodeOffsets;
  if (!root || !offsets) return;
  offsets.forEach((offset, index) => {
    if (!offset) return;
    const child = root.children[index];
    if (child) child.position.add(offset);
  });
}

// Mirrors PartAnimationDriver: localRotation = base * AngleAxis(angle, axis).
// A motion with "translate" moves the node along the axis instead (metres), a
// motion with a "pivot" turns around a shifted point: the position is moved so
// that the pivot stays where it was.
function applyAnimationPreview() {
  const animations = state.part.animations || [];
  const only = state.animPreview.only;
  const time = state.animPreview.time;

  resetRootChildrenPositions();

  // A node of a motion that is gone (the motion was removed or its path was
  // changed) goes back to its rest pose instead of staying where the old motion
  // left it.
  const posed = new Set();
  animations.forEach((animation, index) => {
    if (only !== null && only !== index) return;
    const node = resolveAnimationNode(animation.path);
    if (node) posed.add(node);
  });
  for (const [node, base] of previewBases) {
    if (posed.has(node)) continue;
    node.quaternion.copy(base.quaternion);
    node.position.copy(base.position);
    previewBases.delete(node);
  }

  animations.forEach((animation, index) => {
    if (only !== null && only !== index) return;

    const node = resolveAnimationNode(animation.path);
    if (!node) return;

    if (!previewBases.has(node)) {
      const rest = rootChildRestPosition(node);
      previewBases.set(node, {
        quaternion: node.quaternion.clone(),
        position: (rest || node.position).clone(),
      });
    }
    const base = previewBases.get(node);

    let angle = 0;
    if (animation.type === 'keys') {
      // The keys of the motion: without a trigger the curve loops, with one it is
      // a one-shot motion that the part state fires (PartAnimationDriver), so the
      // preview holds the last pose instead of wrapping to the first one.
      const duration = motionDuration(animation);
      angle = animation.trigger || animation.foldTrigger
        ? sampleMotion(animation, Math.min(time, duration))
        : sampleMotion(animation, time % duration);
    } else {
      angle = sampleMotion(animation, time);
    }

    if (animation.translate) {
      node.position.copy(base.position).addScaledVector(animationAxis(animation), angle);
    } else {
      const rotation = new THREE.Quaternion().setFromAxisAngle(animationAxis(animation), THREE.MathUtils.degToRad(angle));
      node.quaternion.copy(base.quaternion).multiply(rotation);

      const pivot = animationPivot(animation);
      if (pivot.lengthSq() > 1e-6) {
        // base * (pivot - rotation * pivot), the same math the driver runs.
        const spin = pivot.clone().sub(pivot.clone().applyQuaternion(rotation));
        node.position.copy(base.position).add(spin.applyQuaternion(base.quaternion));
      }
    }
  });

  applyExplodeOffsets();
}

function restorePreviewBases() {
  for (const [node, base] of previewBases) {
    node.quaternion.copy(base.quaternion);
    node.position.copy(base.position);
  }
  previewBases.clear();
  // The exploded view is not part of the base pose: put its offsets back.
  resetRootChildrenPositions();
  applyExplodeOffsets();
}

// Runs a reader of the mesh (the OBJ export, the picture of the part) on the rest
// pose. The animation preview and the exploded view are positions of the editor
// only: a mesh exported while the preview played already had its animated node
// baked in the wrong place, and every load of it showed the offset again.
function withRestPose(callback) {
  const root = state.modelObject;
  for (const [node, base] of previewBases) {
    node.quaternion.copy(base.quaternion);
    node.position.copy(base.position);
  }
  const offsets = state.explodeOffsets;
  state.explodeOffsets = null;
  if (root && state.explodeRest && state.explodeRest.length === root.children.length) {
    root.children.forEach((child, index) => child.position.copy(state.explodeRest[index]));
  }
  try {
    return callback();
  } finally {
    state.explodeOffsets = offsets;
    // Brings the preview and the exploded view back to the screen.
    applyAnimationPreview();
  }
}

function setPreviewTime(time) {
  state.animPreview.time = Math.max(0, Number(time) || 0);
  applyAnimationPreview();
  updatePreviewUi();
  if (timeline) timeline.updatePlayhead();
  if (curveEditor) curveEditor.updatePlayhead();
}

function togglePreview() {
  const preview = state.animPreview;
  preview.playing = !preview.playing;
  if (preview.playing) {
    preview.only = null;
    restorePreviewBases();
  }
  renderAnimations();
  updatePreviewUi();
}

function previewSingle(index) {
  const preview = state.animPreview;
  if (preview.only === index) {
    preview.only = null;
    preview.playing = false;
    restorePreviewBases();
    applyAnimationPreview();
  } else {
    restorePreviewBases();
    preview.only = index;
    preview.playing = true;
    preview.time = 0;
    applyAnimationPreview();
  }
  renderAnimations();
  updatePreviewUi();
}

function resetPreview() {
  state.animPreview.playing = false;
  state.animPreview.time = 0;
  state.animPreview.only = null;
  restorePreviewBases();
  applyAnimationPreview();
  renderAnimations();
  updatePreviewUi();
}

// Another part is about to be loaded: the preview of the previous one must not
// shift the nodes of the new part at once (a leftover time would do exactly that)
// and its selected key belongs to the old list of motions.
function resetPreviewForPart() {
  restorePreviewBases();
  state.animPreview.playing = false;
  state.animPreview.time = 0;
  state.animPreview.only = null;
  state.animPreview.key = null;
  updatePreviewUi();
}

function updatePreviewUi() {
  const play = $('btn-anim-play');
  if (play) play.textContent = state.animPreview.playing ? t('anim.pause') : t('anim.play');

  const scrub = $('anim-scrub');
  if (scrub) {
    // The slider covers the whole timeline of the part.
    const length = animationTimelineDuration();
    if (Math.abs(Number(scrub.max) - length) > 0.001) scrub.max = String(length);
    const value = Math.min(length, state.animPreview.time);
    if (Math.abs(Number(scrub.value) - value) > 0.001) scrub.value = value;
  }

  const label = $('anim-time');
  if (label) label.textContent = `${state.animPreview.time.toFixed(2)} s`;
}

// The length of the timeline: the longest motion of the part.
function animationTimelineDuration() {
  let longest = 2;
  for (const animation of state.part.animations || []) {
    const value = Number(animation.duration);
    if (value > longest) longest = value;
  }
  return Math.ceil(longest);
}

function tickAnimationPreview() {
  const delta = Math.min(previewClock.getDelta(), 0.1);
  if (!state.animPreview.playing) return;
  state.animPreview.time += delta;
  applyAnimationPreview();
  updatePreviewUi();
  if (timeline) timeline.updatePlayhead();
  if (curveEditor) curveEditor.updatePlayhead();
}

function renderAnimations() {
  const list = $('animation-list');
  if (!list) return;
  list.textContent = '';

  const animations = state.part.animations || [];
  // The game reads the keys of a curve in order (it walks the neighbouring
  // pairs), so the list is kept sorted by time: typing a time or dragging a point
  // past its neighbour would otherwise leave a curve that the runtime samples
  // wrongly.
  animations.forEach(sortAnimationKeys);

  // The bar of the motions and the timeline belong to the viewport: they are
  // shown only when the part has at least one motion.
  document.body.classList.toggle('has-animations', animations.length > 0);

  if (!animations.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = t('anim.empty');
    list.append(empty);
  }

  animations.forEach((animation, index) => {
    const row = document.createElement('div');
    row.className = 'component-row' + (state.animation === index ? ' selected' : '');

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = animationTypeLabel(animation.type);

    const title = document.createElement('span');
    title.className = 'label';
    title.textContent = animation.path || t('anim.noPath');

    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.textContent = '✕';
    remove.title = t('comp.remove');
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      state.part.animations.splice(index, 1);
      if (state.animation === index) state.animation = null;
      renderAnimations();
      renderStatus();
    });

    const preview = document.createElement('button');
    preview.className = 'icon-btn';
    preview.textContent = state.animPreview.only === index ? '■' : '▶';
    preview.title = t('anim.previewOne');
    preview.addEventListener('click', (event) => {
      event.stopPropagation();
      previewSingle(index);
    });

    row.append(badge, title, preview, remove);
    row.addEventListener('click', () => {
      state.animation = state.animation === index ? null : index;
      renderAnimations();
    });
    list.append(row);

    if (state.animation !== index) return;

    const editor = document.createElement('div');
    editor.className = 'component-editor';
    editor.append(animationField('path', animation, 'text', t('anim.path')));
    editor.append(animationField('type', animation, 'select', t('anim.type'), ANIMATION_TYPES));
    editor.append(animationField('axis', animation, 'vector3', t('anim.axis')));
    editor.append(animationField('pivot', animation, 'vector3', t('anim.pivot')));
    editor.append(animationField('translate', animation, 'bool', t('anim.translate')));
    editor.append(animationField('trigger', animation, 'trigger', t('anim.trigger')));
    editor.append(animationField('foldTrigger', animation, 'trigger', t('anim.foldTrigger')));
    editor.append(animationField('tint', animation, 'color', t('anim.tint')));
    editor.append(animationField('tintAmount', animation, 'number', t('anim.tintAmount')));
    if (animation.type === 'keys') {
      // The length of the loop of the motion. The poses of the other types are
      // the points of the curve, they are edited on the graph.
      const durationField = animationField('duration', animation, 'number', t('anim.duration'));
      // The length is written while typing, but the graph and the dope sheet are
      // rebuilt only when the field is left: a rebuild on every keystroke would
      // replace the input being typed in.
      const durationInput = durationField.querySelector('input');
      if (durationInput) durationInput.addEventListener('change', () => renderAnimations());
      editor.append(durationField);
    }
    editor.append(animationDopeSheet(animation, index));
    list.append(editor);
  });

  // The graph editor of the selected motion: the curve of the channel over the
  // time, the keyframes on it and the playhead. The resizer under it follows.
  const curve = $('anim-curve');
  const resizer = $('anim-curve-resizer');
  if (curve) {
    const motion = state.animation === null ? null : animations[state.animation];
    curve.hidden = !motion;
    if (resizer) resizer.hidden = !motion;
    if (motion && curveEditor) curveEditor.render();
  }

  applyAnimationPreview();
  updatePreviewUi();
  renderTimeline();
}

// ---------------------------------------------------------------------------
// The timeline of the motions: one track per motion, the keys of a track can
// be dragged, the playhead scrubs the preview in the viewport
// ---------------------------------------------------------------------------

let timeline = null;

function initTimeline() {
  const root = $('anim-timeline');
  if (!root) return;

  timeline = createTimeline(root, {
    animations: () => state.part.animations || [],
    time: () => state.animPreview.time,
    selectedIndex: () => state.animation,
    soloIndex: () => state.animPreview.only,
    selectedKey: () => state.animPreview.key,
    onScrub: (time) => setPreviewTime(time),
    onSolo: (index) => previewSingle(index),
    onRemove: (index) => removeAnimation(index),
    onSelectKey: (track, key) => {
      state.animPreview.key = { track, key };
      state.animation = track;
      renderAnimations();
    },
    onAddKey: (track, time, angle) => addAnimationKey(track, time, angle),
    onChange: () => {
      renderAnimations();
      renderStatus();
    },
  });
}

function renderTimeline() {
  if (timeline) timeline.render();
}

// The key that is selected in the timeline.
function selectedAnimationKey() {
  const selection = state.animPreview.key;
  if (!selection) return null;
  const animation = (state.part.animations || [])[selection.track];
  const key = animation?.keys?.[selection.key];
  if (!animation || !key) return null;
  return { animation, key, track: selection.track, index: selection.key };
}

function addAnimationKey(track, time, angle) {
  const animation = (state.part.animations || [])[track];
  if (!animation || animation.type !== 'keys') return;

  if (!Array.isArray(animation.keys)) animation.keys = [];
  animation.keys.push({
    time: Math.round(Number(time) * 100) / 100,
    angle: Math.round(Number(angle) * 10) / 10,
    smooth: true,
  });
  animation.keys.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
  state.animPreview.key = { track, key: animation.keys.length - 1 };
  state.animation = track;
  renderAnimations();
  renderStatus();
}

function removeAnimationKey() {
  const selection = selectedAnimationKey();
  if (!selection) return;
  selection.animation.keys.splice(selection.index, 1);
  state.animPreview.key = null;
  renderAnimations();
  renderStatus();
}

function removeAnimation(index) {
  state.part.animations.splice(index, 1);
  if (state.animation === index) state.animation = null;
  state.animPreview.only = null;
  state.animPreview.key = null;
  renderAnimations();
  renderStatus();
}

// The keys of a motion with keyframes are edited on the graph and in the dope
// sheet of the motion (see animationDopeSheet).

function animationTriggers() {
  const module = (state.part.modules || {})['Model.PartStateModule'];
  const triggers = [];
  if (module && Array.isArray(module.triggersData)) {
    for (const item of module.triggersData) {
      if (item && item.trigger && !triggers.includes(item.trigger)) triggers.push(item.trigger);
    }
  }
  return triggers;
}

function animationField(key, animation, type, label, options) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  const caption = document.createElement('label');
  caption.textContent = label;
  wrapper.append(caption);

  const write = (value) => {
    animation[key] = value;
    renderStatus();
  };

  if (type === 'bool') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(animation[key]);
    checkbox.addEventListener('change', () => write(checkbox.checked));
    wrapper.append(checkbox);
    return wrapper;
  }

  if (type === 'color') {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = animation[key] || '#000000';
    input.addEventListener('input', () => write(input.value));
    wrapper.append(input);
    return wrapper;
  }

  if (type === 'trigger') {
    const select = document.createElement('select');
    const triggers = animationTriggers();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = t('anim.noTrigger');
    select.append(empty);
    for (const trigger of triggers) {
      const option = document.createElement('option');
      option.value = trigger;
      option.textContent = trigger;
      select.append(option);
    }
    if (animation[key] && !triggers.includes(animation[key])) {
      const custom = document.createElement('option');
      custom.value = animation[key];
      custom.textContent = animation[key];
      select.append(custom);
    }
    select.value = animation[key] || '';
    select.addEventListener('change', () => write(select.value));
    wrapper.append(select);
    if (!triggers.length) {
      const hint = document.createElement('small');
      hint.textContent = t('anim.noTriggers');
      wrapper.append(hint);
    }
    return wrapper;
  }

  if (type === 'select') {
    const select = document.createElement('select');
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option;
      node.textContent = animationTypeLabel(option);
      select.append(node);
    }
    select.value = animation[key];
    select.addEventListener('change', () => {
      const previous = animation[key];
      write(select.value);
      // A motion with keys needs its keys: the first two of the timeline.
      if (select.value === 'keys' && (!Array.isArray(animation.keys) || !animation.keys.length)) {
        animation.keys = defaultAnimationKeys(Number(animation.duration) || 2);
      }
      if (previous === 'keys' && select.value !== 'keys') {
        animation.keys = [];
      }
      renderAnimations();
    });
    wrapper.append(select);
    return wrapper;
  }

  if (type === 'vector3') {
    const box = document.createElement('div');
    box.className = 'vec3';
    ['x', 'y', 'z'].forEach((axis, index) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.placeholder = axis;
      input.value = animation[key]?.[index] ?? 0;
      input.addEventListener('input', () => {
        const next = [...(animation[key] || [0, 0, 0])];
        next[index] = Number(input.value) || 0;
        write(next);
      });
      box.append(input);
    });
    wrapper.append(box);
    return wrapper;
  }

  const input = document.createElement('input');
  input.type = type === 'number' ? 'number' : 'text';
  if (type === 'number') input.step = 'any';
  input.value = animation[key] ?? '';
  input.addEventListener('input', () => {
    write(type === 'number' ? (Number(input.value) || 0) : input.value);
  });
  wrapper.append(input);
  return wrapper;
}

function addAnimation(path) {
  const animation = animationDefaults();
  animation.path = path ? `model/${path}` : '';
  state.part.animations = state.part.animations || [];
  state.part.animations.push(animation);
  state.animation = state.part.animations.length - 1;
  renderAnimations();
  renderStatus();
}

function addTracking(path) {
  if (!path) return;

  const modules = state.part.modules && typeof state.part.modules === 'object' ? state.part.modules : {};
  const tracking = modules['Model.RotationTrackingModule'] && typeof modules['Model.RotationTrackingModule'] === 'object'
    ? modules['Model.RotationTrackingModule']
    : {};

  const rotatorPaths = Array.isArray(tracking.rotatorPaths) ? [...tracking.rotatorPaths] : [];
  const fullPath = `model/${path}`;
  if (!rotatorPaths.includes(fullPath)) rotatorPaths.push(fullPath);

  // One rotator is a yaw axis, two rotators are yaw + pitch, like the stock antennas.
  const type = rotatorPaths.length > 1 ? 'YX' : 'Y';
  tracking.type = type;
  tracking.rotatorPaths = rotatorPaths;
  tracking.limits = tracking.limits || { x: 0, y: 15, z: 0 };
  tracking.rotationSpeed = tracking.rotationSpeed || { x: 20, y: 10, z: 0 };
  tracking.consumption = tracking.consumption ?? 5;
  tracking.eceCoeff = tracking.eceCoeff ?? 0.8;

  modules['Model.RotationTrackingModule'] = tracking;
  state.part.modules = modules;

  if (!state.part.state['Model.RotationTrackingModule']) {
    state.part.state['Model.RotationTrackingModule'] = { flags: 'isEnabled', filter: 'relay', target: {} };
  }

  syncRawJson('modules');
  syncRawJson('state');
  renderComponents();
  renderStatus();
  statusLine(t('anim.trackingAdded', { path: fullPath }), 'ok');
}

$('btn-add-animation').addEventListener('click', () => {
  addAnimation($('animation-node-select').value);
});

$('btn-add-tracking').addEventListener('click', () => {
  addTracking($('animation-node-select').value);
});

$('btn-anim-play').addEventListener('click', togglePreview);

$('btn-anim-reset').addEventListener('click', resetPreview);

$('anim-scrub').addEventListener('input', (event) => {
  state.animPreview.playing = false;
  setPreviewTime(event.target.value);
});


// ---------------------------------------------------------------------------
// Attachments list and editor
// ---------------------------------------------------------------------------

function shapeLabel(shape) {
  return shape;
}

function nextAttachmentId() {
  const used = new Set(state.part.attachments.map((a) => Number(a.id)));
  let id = 0;
  while (used.has(id)) id += 1;
  return id;
}

function makeAttachment() {
  const preset = PRESETS.single;
  return {
    id: nextAttachmentId(),
    name: '',
    position: [0, 0.5, 0],
    direction: [0, 1, 0],
    rotation: null,
    shape: 'single',
    flags: [],
    spacing: 1,
    sockets: preset.sockets.map((s) => s.slice()),
  };
}

$('btn-add-attachment').addEventListener('click', () => {
  state.part.attachments.push(makeAttachment());
  state.selection = { kind: 'attachment', att: state.part.attachments.length - 1 };
  refreshStructure();
  history.push();
});

function renderAttachmentList() {
  const list = $('attachment-list');
  list.textContent = '';
  const attachments = state.part.attachments;
  if (!attachments.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = t('empty.list');
    list.append(empty);
    return;
  }
  attachments.forEach((att, index) => {
    const row = document.createElement('div');
    row.className = 'attachment-row';
    if (state.selection?.kind !== 'cable' && state.selection?.att === index) row.classList.add('selected');

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = String(att.id);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = att.name || `#${att.id}`;

    const meta = document.createElement('span');
    meta.className = 'meta';
    const sockets = socketOffsets(att).length;
    meta.textContent = `${att.shape} · ${sockets}`;

    const duplicate = document.createElement('button');
    duplicate.className = 'icon-btn';
    duplicate.type = 'button';
    duplicate.title = t('title.duplicate');
    duplicate.textContent = '⧉';
    duplicate.addEventListener('click', (event) => {
      event.stopPropagation();
      const copy = structuredClone(att);
      copy.id = nextAttachmentId();
      state.part.attachments.push(copy);
      state.selection = { kind: 'attachment', att: state.part.attachments.length - 1 };
      refreshStructure();
    });

    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.type = 'button';
    remove.title = t('title.remove');
    remove.textContent = '✕';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      state.part.attachments.splice(index, 1);
      state.selection = null;
      refreshStructure();
    });

    row.append(badge, label, meta, duplicate, remove);
    row.addEventListener('click', () => select({ kind: 'attachment', att: index }));
    list.append(row);
  });
}

function fieldElement(labelText, input, hintText) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  if (input.id) label.htmlFor = input.id;
  wrap.append(label, input);
  if (hintText) {
    const small = document.createElement('small');
    small.textContent = hintText;
    wrap.append(small);
  }
  return wrap;
}

function numberInput(value, step = 0.01) {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = String(step);
  input.value = value ?? 0;
  return input;
}

function vec3Editor(values, onChange, compact = false) {
  const wrap = document.createElement('div');
  wrap.className = 'vec3';
  ['x', 'y', 'z'].forEach((axis, index) => {
    const input = numberInput(values?.[index] ?? 0);
    input.setAttribute('aria-label', axis);
    input.addEventListener('input', () => {
      const next = values.slice();
      next[index] = Number(input.value) || 0;
      onChange(next);
    });
    wrap.append(input);
  });
  return wrap;
}

function renderAttachmentEditor() {
  const editor = $('attachment-editor');
  editor.textContent = '';
  const sel = state.selection;
  if (!sel || sel.kind === 'cable' || !state.part.attachments[sel.att]) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = t('hint.selectHint');
    editor.append(hint);
    return;
  }

  const index = sel.att;
  const att = state.part.attachments[index];
  const commit = () => {
    refreshScene();
    renderAttachmentList();
    renderStatus();
  };

  // The connection is put onto the mesh: the plane goes to the far end of the
  // mesh along its direction, the size is the silhouette of the mesh there.
  const fit = document.createElement('button');
  fit.className = 'btn small';
  fit.type = 'button';
  fit.textContent = t('btn.fitToMesh');
  fit.addEventListener('click', () => fitAttachmentToMesh(att));
  const fitRow = document.createElement('div');
  fitRow.className = 'input-row';
  fitRow.append(fit);
  editor.append(fitRow);

  const idInput = numberInput(att.id, 1);
  idInput.addEventListener('input', () => {
    att.id = Math.max(0, Math.floor(Number(idInput.value) || 0));
    commit();
    renderAttachmentEditor();
  });
  editor.append(fieldElement('id', idInput));

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = att.name || '';
  nameInput.addEventListener('input', () => {
    att.name = nameInput.value;
    commit();
  });
  editor.append(fieldElement(t('field.attachmentName'), nameInput));

  editor.append(fieldElement(t('field.position'), vec3Editor(att.position, (next) => {
    att.position = next;
    commit();
  })));

  const directionSelect = document.createElement('select');
  const directionOptions = [...Object.keys(DIRECTIONS), 'custom'];
  fillSelect(directionSelect, directionOptions, (v) => (v === 'custom' ? t('field.directionCustom') : v));
  const currentDirection = toVec3(att.direction, [0, 1, 0]);
  const keyword = Object.entries(DIRECTIONS).find(([, vec]) => vec.every((v, i) => Math.abs(v - currentDirection[i]) < 1e-6));
  directionSelect.value = keyword ? keyword[0] : 'custom';
  if (att.rotation) directionSelect.value = 'custom';

  const directionWrap = document.createElement('div');
  if (directionSelect.value === 'custom') {
    directionWrap.append(vec3Editor(currentDirection, (next) => {
      att.direction = next;
      commit();
    }));
  } else {
    att.direction = DIRECTIONS[directionSelect.value].slice();
  }
  directionSelect.addEventListener('change', () => {
    if (directionSelect.value === 'custom') {
      att.direction = att.direction || [0, 1, 0];
    } else {
      att.direction = DIRECTIONS[directionSelect.value].slice();
    }
    commit();
    renderAttachmentEditor();
  });
  editor.append(fieldElement(t('field.direction'), directionSelect, null));
  editor.append(directionWrap);

  const rotationCheck = document.createElement('label');
  rotationCheck.className = 'check';
  const rotationBox = document.createElement('input');
  rotationBox.type = 'checkbox';
  rotationBox.checked = Boolean(att.rotation);
  const rotationText = document.createElement('span');
  rotationText.textContent = t('field.useRotation');
  rotationCheck.append(rotationBox, rotationText);
  editor.append(rotationCheck);

  const rotationWrap = document.createElement('div');
  if (att.rotation) {
    rotationWrap.append(vec3Editor(att.rotation, (next) => {
      att.rotation = next;
      commit();
    }, true));
    editor.append(rotationWrap);
  }
  rotationBox.addEventListener('change', () => {
    att.rotation = rotationBox.checked ? (att.rotation || [0, 0, 0]) : null;
    commit();
    renderAttachmentEditor();
  });

  const shapeSelect = document.createElement('select');
  fillSelect(shapeSelect, SHAPES, shapeLabel);
  shapeSelect.value = att.shape;
  shapeSelect.addEventListener('change', () => {
    att.shape = shapeSelect.value;
    const preset = PRESETS[att.shape];
    att.sockets = preset ? preset.sockets.map((s) => s.slice()) : [];
    commit();
    renderAttachmentEditor();
  });
  editor.append(fieldElement(t('field.shape'), shapeSelect,
    SHAPE_ONLY.includes(att.shape) ? t('msg.shapeNeedsSockets', { i: index + 1, shape: att.shape }) : null));

  const spacingInput = numberInput(att.spacing, 0.1);
  spacingInput.addEventListener('input', () => {
    att.spacing = Number(spacingInput.value) || 1;
    commit();
  });
  editor.append(fieldElement(t('field.spacing'), spacingInput));

  editor.append(fieldElement(t('field.size'), vec3Editor(att.size || (presetOf(att)?.size ?? [0.7, 0.3, 0.7]), (next) => {
    att.size = next;
    commit();
  })));
  editor.append(fieldElement(t('field.center'), vec3Editor(att.center || [0, 0, 0], (next) => {
    att.center = next;
    commit();
  })));

  const flagsWrap = document.createElement('div');
  flagsWrap.className = 'flags';
  // "dynamic" is never offered: a fixed connection with that flag is dropped
  // when the game detaches it (RocketPart.RemoveDynamicConnection), which looks
  // like a random hole in the rocket. Surface sockets are their own thing.
  FLAGS.filter((f) => f !== 'none' && f !== 'dynamic').forEach((flag) => {
    const check = document.createElement('label');
    check.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = (att.flags || []).includes(flag);
    const text = document.createElement('span');
    text.textContent = flag;
    box.addEventListener('change', () => {
      const set = new Set(att.flags || []);
      if (box.checked) set.add(flag); else set.delete(flag);
      att.flags = [...set];
      renderStatus();
    });
    check.append(box, text);
    flagsWrap.append(check);
  });
  editor.append(fieldElement(t('field.flags'), flagsWrap));

  // Sockets
  const socketsWrap = document.createElement('div');
  socketsWrap.className = 'sockets-editor';
  socketsWrap.id = 'sockets-editor';
  editor.append(fieldElement(t('field.sockets'), socketsWrap));

  const addSocket = document.createElement('button');
  addSocket.type = 'button';
  addSocket.className = 'btn small';
  addSocket.textContent = t('btn.addSocket');
  addSocket.addEventListener('click', () => {
    att.sockets = [...(att.sockets || []), [0, 0, 0]];
    commit();
    renderSocketEditor();
    renderAttachmentEditor();
  });
  editor.append(addSocket);

  renderSocketEditor();
}

function renderSocketEditor() {
  const wrap = $('sockets-editor');
  if (!wrap) return;
  const sel = state.selection;
  if (!sel || sel.kind === 'cable') return;
  const att = state.part.attachments[sel.att];
  if (!att) return;

  wrap.textContent = '';
  const sockets = att.sockets || [];
  sockets.forEach((socket, socketIndex) => {
    const row = document.createElement('div');
    row.className = 'socket-row';

    const label = document.createElement('span');
    label.className = 'index';
    label.textContent = String(socketIndex);

    const vec = vec3Editor(socket, (next) => {
      const list = att.sockets.slice();
      list[socketIndex] = next;
      att.sockets = list;
      refreshScene();
      renderStatus();
    });

    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'icon-btn';
    selectButton.textContent = '◎';
    selectButton.title = t('field.socket');
    selectButton.addEventListener('click', () => select({ kind: 'socket', att: sel.att, socket: socketIndex }));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn';
    remove.textContent = '✕';
    remove.title = t('title.remove');
    remove.addEventListener('click', () => {
      att.sockets = att.sockets.filter((_, i) => i !== socketIndex);
      if (state.selection?.kind === 'socket' && state.selection.socket >= att.sockets.length) {
        state.selection = { kind: 'attachment', att: sel.att };
      }
      refreshStructure();
    });

    row.append(label, vec, selectButton, remove);
    wrap.append(row);
  });
  if (!sockets.length) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = t('empty.list');
    wrap.append(hint);
  }
}

function renderSocketEditorValues() {
  const wrap = $('sockets-editor');
  if (!wrap) return;
  const sel = state.selection;
  if (!sel || sel.kind !== 'socket') return;
  const att = state.part.attachments[sel.att];
  const socket = att?.sockets?.[sel.socket];
  const row = wrap.children[sel.socket];
  if (!socket || !row) return;
  row.querySelectorAll('.vec3 input').forEach((input, axis) => {
    input.value = socket[axis];
  });
}

// ---------------------------------------------------------------------------
// Dynamic sockets (the surface attachments of the game)
// ---------------------------------------------------------------------------

// part.json keeps the shapes exactly like the game does, as one string
// ("single, dual"); the panel works on a list.
function dynamicShapeNames(text) {
  const names = [];
  const raw = typeof text === 'number' ? text : String(text ?? '');
  if (typeof raw === 'number') {
    for (const [name, bit] of Object.entries(DYNAMIC_SHAPE_BITS)) {
      if ((raw & bit) !== 0) names.push(name);
    }
    return names;
  }
  for (const token of raw.split(/[,|+]+/)) {
    const name = token.trim().toLowerCase().replace(/[-\s]+/g, '_');
    if (name && name !== 'none' && !names.includes(name)) names.push(name);
  }
  return names;
}

function dynamicShapeText(names) {
  return names.filter((name) => name && name !== 'none').join(', ');
}

// The names the game itself knows: anything else is skipped by the loader.
function dynamicKnownShapes(text) {
  return dynamicShapeNames(text).filter((name) => Object.prototype.hasOwnProperty.call(DYNAMIC_SHAPE_BITS, name));
}

function dynamicUnknownShapes(text) {
  return dynamicShapeNames(text).filter((name) => !Object.prototype.hasOwnProperty.call(DYNAMIC_SHAPE_BITS, name));
}

function dynamicPresetOf(defindex) {
  return DYNAMIC_PRESETS.find((preset) => preset.defindex === Number(defindex)) || null;
}

function dynamicDirectionLabel(dir) {
  for (const [name, value] of Object.entries(DYNAMIC_DIRECTIONS)) {
    if (value.every((v, i) => Math.abs(v - dir[i]) < 1e-4)) return t(`dyn.dir.${name}`);
  }
  return `(${dir.map((v) => Math.round(v * 1000) / 1000).join(', ')})`;
}

function dynamicPresetLabel(preset) {
  return t('dyn.preset', {
    role: t(`dyn.role.${preset.role}`),
    restrict: t(`dyn.restrict.${preset.restrict}`),
    dir: dynamicDirectionLabel(preset.dir),
    spread: preset.angle
      ? t('dyn.band', { a: preset.angle[0], b: preset.angle[1] })
      : t('dyn.anywhere'),
  });
}

function fillDynamicPresetSelect(select, defindex) {
  select.textContent = '';
  for (const role of ['parent', 'current']) {
    const group = document.createElement('optgroup');
    group.label = t(`dyn.role.${role}`);
    for (const preset of DYNAMIC_PRESETS.filter((item) => item.role === role)) {
      const option = document.createElement('option');
      option.value = String(preset.defindex);
      option.textContent = dynamicPresetLabel(preset);
      group.append(option);
    }
    if (group.children.length) select.append(group);
  }
  select.value = String(defindex);
  // A defindex the game does not know (an old file, a typo): keep it visible
  // instead of silently jumping to another socket.
  if (select.value !== String(defindex)) {
    const option = document.createElement('option');
    option.value = String(defindex);
    option.textContent = t('dyn.unknown', { id: defindex });
    select.append(option);
    select.value = String(defindex);
  }
}

function dynamicPivotEditor() {
  const host = $('dynamic-pivot');
  host.textContent = '';
  if (!(state.part.dynamicAttachmentConfigs || []).length) return;

  const input = vec3Editor(state.part.dynamicCurrPivot || [0, 0, 0], (next) => {
    state.part.dynamicCurrPivot = next;
    renderDynamicProbe();
    scheduleDynamicView();
    renderStatus();
  });
  const field = fieldElement(t('field.dynamicCurrPivot'), input, t('hint.dynamicCurrPivot'));
  field.classList.add('dynamic-pivot-field');
  host.append(field);

  const fromMesh = document.createElement('button');
  fromMesh.type = 'button';
  fromMesh.className = 'btn small';
  fromMesh.textContent = t('btn.pivotFromMesh');
  fromMesh.addEventListener('click', () => {
    if (!state.modelObject) {
      statusLine(t('status.fitNoMesh'), 'warn');
      return;
    }
    const box = new THREE.Box3().setFromObject(state.modelObject);
    if (box.isEmpty()) {
      statusLine(t('status.fitNoMesh'), 'warn');
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    // The preview already works in metres of the prefab: the model root carries
    // the units and the extra scale of the part, so the world centre of the
    // mesh is the part-space point the game wants (nothing else scales it).
    state.part.dynamicCurrPivot = [center.x, center.y, center.z].map((v) => Math.round(v * 1000) / 1000);
    dynamicPivotEditor();
    renderDynamicProbe();
    scheduleDynamicView();
    renderStatus();
    history.push();
  });
  const row = document.createElement('div');
  row.className = 'input-row';
  row.append(fromMesh);
  host.append(row);
}

function renderDynamicList() {
  const list = $('dynamic-list');
  list.textContent = '';
  const entries = state.part.dynamicAttachmentConfigs || [];

  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = t('empty.dynamic');
    list.append(empty);
  }

  entries.forEach((entry, index) => {
    const preset = dynamicPresetOf(entry.defindex);
    const color = dynamicColor(index);
    const row = document.createElement('div');
    row.className = 'dynamic-row';
    if (state.dynamicProbe?.index === index) row.classList.add('active');

    const head = document.createElement('div');
    head.className = 'dynamic-head';

    const role = document.createElement('span');
    role.className = 'role';
    role.textContent = preset ? (preset.role === 'parent' ? '+' : '−') : '?';
    role.title = preset ? t(`dyn.role.${preset.role}`) : t('dyn.unknown', { id: entry.defindex });
    if (preset) {
      // The same colour the zones of this socket are drawn in on the model.
      role.style.color = color;
      role.style.borderColor = color;
    }

    const select = document.createElement('select');
    select.className = 'dynamic-preset';
    fillDynamicPresetSelect(select, entry.defindex);
    select.addEventListener('change', () => {
      entry.defindex = Number(select.value) || 0;
      renderDynamicList();
      renderStatus();
      history.push();
    });

    const visible = document.createElement('input');
    visible.type = 'checkbox';
    visible.className = 'dynamic-visible';
    visible.checked = !state.dynamicHidden.has(entry);
    visible.title = t('dyn.showOne');
    visible.addEventListener('change', () => {
      if (visible.checked) state.dynamicHidden.delete(entry);
      else state.dynamicHidden.add(entry);
      renderDynamicView();
    });

    const probe = document.createElement('button');
    probe.type = 'button';
    probe.className = 'icon-btn';
    probe.textContent = '◎';
    probe.title = t('dyn.probe');
    probe.addEventListener('click', () => {
      if (state.dynamicProbe?.index === index) {
        state.dynamicProbe = null;
      } else {
        state.dynamicProbe = { index, point: null, normal: null };
      }
      renderDynamicList();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn';
    remove.textContent = '✕';
    remove.title = t('title.remove');
    remove.addEventListener('click', () => {
      entries.splice(index, 1);
      if (state.dynamicProbe?.index === index) state.dynamicProbe = null;
      if (state.dynamicProbe && state.dynamicProbe.index > index) state.dynamicProbe.index -= 1;
      renderDynamicList();
      renderStatus();
      history.push();
    });

    head.append(role, select, visible, probe, remove);
    row.append(head);

    // The shapes the socket takes: every one of them is a separate socket in
    // the game, and it only connects to a fixed connection with a compatible
    // shape.
    const shapes = document.createElement('div');
    shapes.className = 'flags dynamic-shapes';
    const selected = dynamicShapeNames(entry.shape);
    for (const shape of DYNAMIC_SHAPES) {
      const check = document.createElement('label');
      check.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = selected.includes(shape);
      box.addEventListener('change', () => {
        const next = dynamicShapeNames(entry.shape);
        const at = next.indexOf(shape);
        if (box.checked && at === -1) next.push(shape);
        if (!box.checked && at !== -1) next.splice(at, 1);
        entry.shape = dynamicShapeText(next);
        renderStatus();
        renderDynamicProbe();
        scheduleDynamicView();
        history.push();
      });
      const text = document.createElement('span');
      text.textContent = shape;
      check.append(box, text);
      shapes.append(check);
    }
    row.append(shapes);
    list.append(row);
  });

  dynamicPivotEditor();
  renderDynamicProbe();
  scheduleDynamicView();
}

$('btn-add-dynamic').addEventListener('click', () => {
  if (!Array.isArray(state.part.dynamicAttachmentConfigs)) state.part.dynamicAttachmentConfigs = [];
  // The two ends of a pair are the usual set: a receiving ring socket and the
  // matching attaching one, then the same for a side socket. A defindex that is
  // already there is not repeated (the game would create the socket twice).
  const entries = state.part.dynamicAttachmentConfigs;
  const used = new Set(entries.map((entry) => Number(entry.defindex)));
  const defaults = [10001000, -10001000, 30001008, -30001000, 20001000];
  const defindex = defaults.find((id) => !used.has(id)) ?? 10001000;
  entries.push({ defindex, shape: 'single' });
  renderDynamicList();
  renderStatus();
  history.push();
});

// The sockets are drawn on the assembly box of the game (see renderDynamicView);
// the checkbox hides the whole layer without touching the part.
$('chk-dynamic-view').addEventListener('change', (event) => {
  state.dynamicView = event.target.checked;
  renderDynamicView();
});

// Restricted copy of the game's math (DynamicAttachment / RocketPart): where
// the socket may sit, and how it is turned on the surface. The preview of the
// editor and the game agree because the numbers are the same.
const DYNAMIC_DEG = Math.PI / 180;
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

function projectOnPlane(vector, planeNormal) {
  const lengthSq = planeNormal.dot(planeNormal);
  if (lengthSq < 1e-9) return vector.clone();
  return vector.clone().addScaledVector(planeNormal, -vector.dot(planeNormal) / lengthSq);
}

function orientedAngle(u, v, axis) {
  if (u.lengthSq() < 1e-12 || v.lengthSq() < 1e-12) return 0;
  const angle = u.angleTo(v);
  return axis.dot(new THREE.Vector3().crossVectors(u, v)) < 0 ? -angle : angle;
}

function dynamicRestrictDot(preset) {
  const angle = preset.angle && (preset.angle[0] || preset.angle[1]) ? preset.angle : [-15, 15];
  const sign = (value) => (value < 0 ? -1 : 1);
  return [
    (1 - Math.cos(angle[0] * DYNAMIC_DEG)) * sign(angle[0]),
    (1 - Math.cos(angle[1] * DYNAMIC_DEG)) * sign(angle[1]),
  ];
}

// RocketPart.SatisfyRestriction
function dynamicSatisfies(preset, normal) {
  const dot = dynamicRestrictDot(preset);
  const direction = new THREE.Vector3(...preset.dir).normalize();
  const value = direction.dot(normal);
  if (preset.restrict === 'directional') {
    return 1 - value < dot[1];
  }
  return (value >= dot[0] && value <= dot[1])
    || Math.abs(dot[0] - value) < 1e-4
    || Math.abs(dot[1] - value) < 1e-4;
}

// DynamicAttachment.GetRotation
function dynamicSocketRotation(preset, normal) {
  const base = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    preset.rotation[0] * DYNAMIC_DEG,
    preset.rotation[1] * DYNAMIC_DEG,
    preset.rotation[2] * DYNAMIC_DEG,
    'ZXY',
  ));
  if (preset.restrict !== 'radial' && preset.restrict !== 'spherical') return base;

  const axis = new THREE.Vector3(...preset.dir).normalize();
  const up = AXIS_Y.clone().applyQuaternion(base);
  // Angle(localNormal, axis): the turn of the normal around the restriction axis.
  const angle = orientedAngle(projectOnPlane(up, axis), projectOnPlane(normal, axis), axis);
  const rotY = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, angle);
  const turned = normal.clone().applyQuaternion(rotY.clone().invert());
  // GetSecondAxis: the axis the normal is told apart by — forward, unless the
  // restriction axis is the forward or the right one.
  const isRight = Math.abs(axis.x - 1) < 1e-6 && Math.abs(axis.y) < 1e-6 && Math.abs(axis.z) < 1e-6;
  const isForward = Math.abs(axis.z - 1) < 1e-6 && Math.abs(axis.y) < 1e-6 && Math.abs(axis.x) < 1e-6;
  const second = isRight || isForward ? AXIS_Y.clone() : AXIS_Z.clone();
  const angleZ = orientedAngle(projectOnPlane(up, second), projectOnPlane(turned, second), second);
  const rotZ = new THREE.Quaternion().setFromAxisAngle(AXIS_Z, angleZ);
  return rotY.multiply(rotZ.multiply(base));
}

function dynamicShapeOf(entry) {
  const names = dynamicShapeNames(entry.shape);
  return names.find((name) => PRESETS[name]) || 'single';
}

// One socket drawn at the origin: the ring of the connection in the plane of
// the surface, the sockets of its shape and the normal it is turned by. The
// local +Y is the normal of the hull, exactly like DynamicAttachment.GetRotation
// builds it.
function buildSocketGlyph(preset, entry, color) {
  const shape = dynamicShapeOf(entry);
  const presetShape = PRESETS[shape] || PRESETS.single;
  const radius = Math.max(presetShape.size[0], presetShape.size[2]) / 2;
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, Math.max(0.008, radius * 0.03), 8, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  // The ring lies in the plane of the connection, the sockets sit in it.
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const socketMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
  for (const socket of presetShape.sockets) {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.02, radius * 0.08), 12, 8),
      socketMaterial,
    );
    sphere.position.set(socket[0], socket[1], socket[2]);
    group.add(sphere);
  }

  const arrow = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, radius * 0.8, 0)]),
    new THREE.LineBasicMaterial({ color }),
  );
  group.add(arrow);

  return group;
}

function renderDynamicProbe() {
  disposeGroup(dynamicProbeRoot);
  const probe = state.dynamicProbe;
  if (!probe) return;

  const entry = (state.part.dynamicAttachmentConfigs || [])[probe.index];
  const preset = entry ? dynamicPresetOf(entry.defindex) : null;
  if (!preset) return;

  const normal = new THREE.Vector3(...probe.normal);
  if (normal.lengthSq() < 1e-9) return;
  normal.normalize();

  const allowed = dynamicSatisfies(preset, normal);
  const glyph = buildSocketGlyph(preset, entry, allowed ? 0x46d98a : 0xff6b6b);
  glyph.position.set(...probe.point);
  glyph.quaternion.copy(dynamicSocketRotation(preset, normal));
  dynamicProbeRoot.add(glyph);
}

// ---------------------------------------------------------------------------
// Surface sockets on the model
// ---------------------------------------------------------------------------

// One colour per socket of the part, so the zones on the model match the rows
// of the panel.
const DYNAMIC_COLORS = ['#4da3ff', '#ffb14d', '#46d98a', '#ff6bd6', '#9b8cff', '#ff6b6b', '#40d6d6', '#d8d84a'];

function dynamicColor(index) {
  return DYNAMIC_COLORS[index % DYNAMIC_COLORS.length];
}

// The box the loader builds as `assembly_physics`: the bounds of the model, with
// the axes of zero length padded to 0.1 m (PrefabBuilder.NonZero). The skin
// colliders of the mesh are convex, but the assembly collider of a mod part is
// this box, so a socket of the game can only land on one of its six faces.
function assemblyBox() {
  const root = state.modelObject;
  if (!root) return null;

  // The exploded view must not move the box: the game builds the collider once,
  // from the mesh in its rest pose.
  const children = root.children;
  const saved = children.map((child) => child.position.clone());
  if (state.explodeRest && state.explodeRest.length === children.length) {
    children.forEach((child, index) => child.position.copy(state.explodeRest[index]));
  }
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  children.forEach((child, index) => child.position.copy(saved[index]));
  root.updateWorldMatrix(true, true);

  if (box.isEmpty()) return null;
  const center = box.getCenter(new THREE.Vector3());
  const min = box.min.clone();
  const max = box.max.clone();
  for (const axis of ['x', 'y', 'z']) {
    if (max[axis] - min[axis] < 0.1) {
      min[axis] = center[axis] - 0.05;
      max[axis] = center[axis] + 0.05;
    }
  }
  return new THREE.Box3(min, max);
}

// The six faces of the box: the normal is what the restriction of the game is
// checked against, and the plane the sockets sit in is the face itself.
function assemblyFaces(box) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const list = [
    { normal: new THREE.Vector3(0, 1, 0), point: new THREE.Vector3(center.x, box.max.y, center.z), w: size.x, h: size.z },
    { normal: new THREE.Vector3(0, -1, 0), point: new THREE.Vector3(center.x, box.min.y, center.z), w: size.x, h: size.z },
    { normal: new THREE.Vector3(0, 0, 1), point: new THREE.Vector3(center.x, center.y, box.max.z), w: size.x, h: size.y },
    { normal: new THREE.Vector3(0, 0, -1), point: new THREE.Vector3(center.x, center.y, box.min.z), w: size.x, h: size.y },
    { normal: new THREE.Vector3(1, 0, 0), point: new THREE.Vector3(box.max.x, center.y, center.z), w: size.z, h: size.y },
    { normal: new THREE.Vector3(-1, 0, 0), point: new THREE.Vector3(box.min.x, center.y, center.z), w: size.z, h: size.y },
  ];
  const forward = new THREE.Vector3(0, 0, 1);
  for (const face of list) {
    face.quaternion = new THREE.Quaternion().setFromUnitVectors(forward, face.normal);
  }
  return list;
}

// Paints one face of the assembly box: the surface of a socket is the set of the
// faces its restriction allows (the normal of the rest is the same on the whole
// face).
function paintDynamicFace(face, color) {
  const geometry = new THREE.PlaneGeometry(face.w, face.h);
  const quad = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  quad.position.copy(face.point).addScaledVector(face.normal, 0.004);
  quad.quaternion.copy(face.quaternion);
  dynamicViewRoot.add(quad);

  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  border.position.copy(quad.position);
  border.quaternion.copy(quad.quaternion);
  dynamicViewRoot.add(border);
}

function clearDynamicView() {
  disposeGroup(dynamicViewRoot);
}

// Draws the sockets on the part: the box the game probes, the faces a socket can
// use, a glyph of the socket on every allowed face, and the aim point of the
// sockets that attach to another hull. The rebuild is coalesced into one run per
// task: a single change (a mesh load, a row of the panel) often touches several
// fields, and a timer would be throttled in a background tab.
let dynamicViewPending = false;

function scheduleDynamicView() {
  if (dynamicViewPending) return;
  dynamicViewPending = true;
  queueMicrotask(() => {
    dynamicViewPending = false;
    renderDynamicView();
  });
}

function renderDynamicView() {
  clearDynamicView();
  const entries = state.part.dynamicAttachmentConfigs || [];
  if (!state.dynamicView || !state.modelObject || !entries.length) return;

  const box = assemblyBox();
  if (!box) return;

  // The assembly collider itself, so the author sees what the game probes and
  // why a socket can only sit on a face of it.
  const size = box.getSize(new THREE.Vector3());
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
    new THREE.LineBasicMaterial({ color: 0x7f8da3, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  frame.position.copy(box.getCenter(new THREE.Vector3()));
  dynamicViewRoot.add(frame);

  const faces = assemblyFaces(box);
  entries.forEach((entry, index) => {
    if (state.dynamicHidden.has(entry)) return;
    const preset = dynamicPresetOf(entry.defindex);
    if (!preset) return;

    const color = new THREE.Color(dynamicColor(index));
    const shape = PRESETS[dynamicShapeOf(entry)] || PRESETS.single;
    const socketRadius = Math.max(shape.size[0], shape.size[2]) / 2;
    for (const face of faces) {
      if (!dynamicSatisfies(preset, face.normal)) continue;
      paintDynamicFace(face, color);
      const glyph = buildSocketGlyph(preset, entry, color.getHex());
      // The glyph shows the orientation, not the size: a socket wider than its
      // face would hide the part itself.
      const limit = Math.min(face.w, face.h) * 0.22;
      if (socketRadius > limit && socketRadius > 0) glyph.scale.setScalar(limit / socketRadius);
      glyph.position.copy(face.point).addScaledVector(face.normal, 0.006);
      glyph.quaternion.copy(dynamicSocketRotation(preset, face.normal));
      dynamicViewRoot.add(glyph);
    }
  });

  // The point the game aims at to stick the part onto another hull
  // (AssemblyShopPlacer.RaycastCurrent): a socket that attaches to a hull is
  // useless while it points outside the mesh, so it is drawn even when the part
  // has no sockets that attach.
  const pivot = state.part.dynamicCurrPivot;
  if (Array.isArray(pivot) && entries.some((entry) => (dynamicPresetOf(entry.defindex)?.role === 'current'))) {
    const point = new THREE.Vector3(Number(pivot[0]) || 0, Number(pivot[1]) || 0, Number(pivot[2]) || 0);
    const marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.035),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    marker.position.copy(point);
    dynamicViewRoot.add(marker);
    for (const [axis, colorHex] of [[AXIS_X, 0xff6b6b], [AXIS_Y, 0x46d98a], [AXIS_Z, 0x4da3ff]]) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([point.clone(), point.clone().addScaledVector(axis, 0.12)]),
        new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.85, depthWrite: false }),
      );
      dynamicViewRoot.add(line);
    }
  }
}

function updateDynamicProbe(event) {
  const probe = state.dynamicProbe;
  if (!probe || !state.modelObject) return;
  pointerNdc(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(modelRoot, true);
  if (!hits.length) {
    // Off the hull there is nothing the game could snap to.
    if (probe.point) {
      probe.point = null;
      probe.normal = null;
      renderDynamicProbe();
    }
    return;
  }

  const hit = hits[0];
  // The preview lives in metres of the prefab (the model root carries the units
  // and the extra scale), and dynamicCurrPivot is in that same space.
  const point = hit.point.clone();
  let normal;
  if (hit.face) {
    normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  } else {
    normal = new THREE.Vector3(0, 1, 0);
  }
  normal.normalize();

  probe.point = [point.x, point.y, point.z];
  probe.normal = [normal.x, normal.y, normal.z];
  renderDynamicProbe();
}

canvas.addEventListener('pointermove', (event) => {
  if (state.dynamicProbe) updateDynamicProbe(event);
});

canvas.addEventListener('pointerleave', () => {
  const probe = state.dynamicProbe;
  if (!probe) return;
  probe.point = null;
  probe.normal = null;
  renderDynamicProbe();
});

// ---------------------------------------------------------------------------
// Cable attachments
// ---------------------------------------------------------------------------

$('btn-add-cable').addEventListener('click', () => {
  const used = new Set((state.part.cableAttachments || []).map((c) => Number(c.id)));
  let id = 0;
  while (used.has(id)) id += 1;
  state.part.cableAttachments.push({ id, name: '', position: [0, 0, 0] });
  state.selection = { kind: 'cable', att: state.part.cableAttachments.length - 1 };
  refreshStructure();
});

function renderCables() {
  const list = $('cable-list');
  list.textContent = '';
  const cables = state.part.cableAttachments || [];
  if (!cables.length) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = t('empty.list');
    list.append(hint);
    return;
  }
  cables.forEach((cable, index) => {
    const row = document.createElement('div');
    row.className = 'compact-row';

    const vec = vec3Editor(cable.position, (next) => {
      cable.position = next;
      refreshScene();
      renderStatus();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn';
    remove.textContent = '✕';
    remove.title = t('title.remove');
    remove.addEventListener('click', () => {
      cables.splice(index, 1);
      state.selection = null;
      refreshStructure();
    });

    row.append(vec, remove);
    row.addEventListener('click', (event) => {
      if (event.target.closest('.icon-btn')) return;
      select({ kind: 'cable', att: index });
    });
    list.append(row);
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate() {
  const errors = [];
  const warnings = [];
  const part = state.part;

  if (!part.id || !part.id.trim()) errors.push(t('msg.required', { field: t('field.id') }));
  else if (!/^[A-Za-z0-9._-]+$/.test(part.id)) errors.push(t('msg.idPattern'));

  if (!(Number(part.mass) > 0)) errors.push(t('msg.mass'));
  if (!CATEGORIES.includes(part.category)) errors.push(t('msg.category'));
  if (part.defindex && (!Number.isInteger(part.defindex) || part.defindex <= 0)) {
    errors.push(t('msg.defindex'));
  }
  if (part.units && !(part.units in UNITS)) errors.push(t('msg.units', { units: part.units }));

  for (const [name, value] of [['metallic', part.material.metallic], ['smoothness', part.material.smoothness]]) {
    if (Number(value) < 0 || Number(value) > 1) {
      errors.push(t('msg.materialRange', { field: name }));
    }
  }

  if (!part.attachments.length) errors.push(t('msg.attachmentsEmpty'));

  const seenIds = new Map();
  const seenSockets = new Set();
  part.attachments.forEach((att, i) => {
    const n = i + 1;
    if (!Number.isInteger(att.id) || att.id < 0 || att.id > 65535) {
      errors.push(t('msg.attachmentId', { i: n }));
    } else if (seenIds.has(att.id)) {
      errors.push(t('msg.attachmentIdDuplicate', { i: n, id: att.id }));
    }
    seenIds.set(att.id, true);

    if (!(Number(att.spacing) > 0)) errors.push(t('msg.spacing', { i: n }));

    const dir = att.rotation ? null : att.direction;
    if (dir && (!Array.isArray(dir) || dir.length !== 3 || dir.some((v) => !Number.isFinite(Number(v))))) {
      errors.push(t('msg.direction', { i: n }));
    }

    if (att.shape && SHAPE_ONLY.includes(att.shape) && !(att.sockets || []).length) {
      errors.push(t('msg.shapeNeedsSockets', { i: n, shape: att.shape }));
    }

    for (const flag of att.flags || []) {
      if (!FLAGS.includes(flag)) errors.push(t('msg.flags', { i: n, flag }));
      else if (flag === 'dynamic') warnings.push(t('msg.dynamicFlag', { i: n }));
    }

    (att.sockets || []).forEach((socket, s) => {
      if (!Array.isArray(socket) || socket.length !== 3 || socket.some((v) => !Number.isFinite(Number(v)))) {
        errors.push(t('msg.socket', { i: n, s: s + 1 }));
        return;
      }
      const key = `${i}:${socket.map((v) => Number(v).toFixed(4)).join(',')}`;
      if (seenSockets.has(key)) warnings.push(t('msg.duplicateSocket', { i: n }));
      seenSockets.add(key);
    });
  });

  // Surface sockets: only the configs the game knows mean anything (the game
  // looks the defindex up in its own cache without a check), and a socket
  // without a shape is not used either.
  (part.dynamicAttachmentConfigs || []).forEach((entry, index) => {
    const n = index + 1;
    if (!dynamicPresetOf(entry.defindex)) warnings.push(t('msg.dynamicUnknown', { i: n, id: entry.defindex }));
    if (!dynamicKnownShapes(entry.shape).length) {
      warnings.push(t('msg.dynamicShape', { i: n }));
    } else if (dynamicUnknownShapes(entry.shape).length) {
      warnings.push(t('msg.dynamicShapeName', { i: n, names: dynamicUnknownShapes(entry.shape).join(', ') }));
    }
  });

  // The pivot is the point inside the hull the game aims at when this part is
  // put onto another one.
  const needsPivot = (part.dynamicAttachmentConfigs || [])
    .some((entry) => dynamicPresetOf(entry.defindex)?.role === 'current');
  const bounds = needsPivot ? modelBounds() : null;
  const pivot = part.dynamicCurrPivot;
  if (bounds && pivot && pivot.some((v) => Number(v))) {
    const outside = pivot.some((value, axis) => (
      Number(value) < bounds.min[axis] - 1e-3 || Number(value) > bounds.max[axis] + 1e-3
    ));
    if (outside) warnings.push(t('msg.dynamicPivot'));
  }

  if (!part.model || !part.model.trim()) {
    errors.push(t('msg.required', { field: t('field.model') }));
  } else if (!state.modelLoaded && state.modelFileName !== part.model) {
    warnings.push(t('status.selectModel', { name: part.model }));
  }

  const modules = part.modules && typeof part.modules === 'object' && !Array.isArray(part.modules) ? part.modules : {};
  const states = part.state && typeof part.state === 'object' && !Array.isArray(part.state) ? part.state : {};

  if (state.hiddenObjects > 0) {
    warnings.push(t('status.lineObjects', { n: state.hiddenObjects }));
  }

  if (state.strippedLines > 0) {
    warnings.push(t('status.strippedLines', { n: state.strippedLines }));
  }
  for (const key of Object.keys(modules)) {
    const def = COMPONENT_BY_KEY[key];
    if (!def) {
      warnings.push(t('msg.unknownModule', { key }));
      continue;
    }
    if (def.state.length && (!states[key] || typeof states[key] !== 'object')) {
      warnings.push(t('msg.missingState', { name: componentText(def.label) }));
    }
  }

  const nodePaths = modelNodePaths();
  (part.animations || []).forEach((animation, index) => {
    const n = index + 1;
    if (!animation.path) {
      errors.push(t('msg.animationPath', { i: n }));
      return;
    }
    if (!ANIMATION_TYPES.includes(animation.type)) {
      errors.push(t('msg.animationType', { i: n }));
      return;
    }
    if (!animation.axis || !animation.axis.some((value) => Number(value) !== 0)) {
      errors.push(t('msg.animationAxis', { i: n }));
    }
    if (animation.type === 'spin' && !Number(animation.speed)) {
      warnings.push(t('msg.animationSpeed', { i: n }));
    }
    if (animation.type === 'deploy' && !(Number(animation.duration) > 0)) {
      errors.push(t('msg.animationDuration', { i: n }));
    }
    // The game only announces the transitions of Model.PartStateModule: a trigger
    // that is not there never fires, and the motion waits in its first pose.
    // (The same name in both fields is fine: one transition then toggles it.)
    for (const name of new Set([animation.trigger, animation.foldTrigger].filter(Boolean))) {
      if (!(part.modules || {})['Model.PartStateModule']) {
        warnings.push(t('msg.animNoState', { i: n, trigger: name }));
      } else if (!animationTriggers().some((item) => item.toLowerCase() === name.toLowerCase())) {
        warnings.push(t('msg.animUnknownTrigger', { i: n, trigger: name }));
      }
    }
    if (nodePaths.length && !animation.path.startsWith('model/')) {
      warnings.push(t('msg.animationModelPath', { i: n }));
    } else if (nodePaths.length && !nodePaths.includes(animation.path.slice('model/'.length))) {
      warnings.push(t('msg.animationNode', { i: n, path: animation.path }));
    }
  });

  return { errors, warnings };
}

function renderStatus() {
  const { errors, warnings } = validate();
  const main = $('status-main');
  const list = $('status-messages');
  list.textContent = '';

  if (errors.length) {
    main.textContent = t('status.errors', { n: errors.length });
    main.className = 'status-main bad';
  } else if (warnings.length) {
    main.textContent = t('status.warnings', { n: warnings.length });
    main.className = 'status-main warn';
  } else {
    main.textContent = t('status.ok');
    main.className = 'status-main ok';
  }

  for (const message of errors) {
    const item = document.createElement('li');
    item.className = 'error';
    item.textContent = message;
    list.append(item);
  }
  for (const message of warnings) {
    const item = document.createElement('li');
    item.className = 'warning';
    item.textContent = message;
    list.append(item);
  }
}

function statusLine(text, kind) {
  const main = $('status-main');
  main.textContent = text;
  main.className = `status-main ${kind || ''}`.trim();
  setTimeout(renderStatus, 2500);
}

function setStatusMessage(key, vars) {
  statusLine(t(key, vars), 'bad');
}

function onPartEdited() {
  renderStatus();
  // The temperature forecast follows the mass and the thermal fields
  if (state.modelObject) renderVolumeInfo();
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

function normalizePart(raw) {
  const part = defaultPart();
  Object.assign(part, raw);
  part.material = Object.assign({ color: '#c8ccd4', metallic: 0.2, smoothness: 0.4, emissive: '#000000', emissiveIntensity: 0, opacity: 1 }, raw.material || {});
  part.material.tiling = toPair(raw.material?.tiling, [1, 1]);
  part.material.offset = toPair(raw.material?.offset, [0, 0]);
  part.materials = (raw.materials || []).map((entry) => ({
    node: entry.node || '',
    color: entry.color || '#c8ccd4',
    metallic: Number(entry.metallic) || 0,
    smoothness: Number(entry.smoothness) || 0,
    emissive: entry.emissive || '#000000',
    emissiveIntensity: Number(entry.emissiveIntensity) || 0,
    opacity: entry.opacity === undefined ? 1 : Number(entry.opacity),
    albedo: entry.albedo || '',
    normal: entry.normal || '',
    mask: entry.mask || '',
  }));
  part.attachments = (raw.attachments || []).map((att, index) => ({
    id: Number.isInteger(att.id) ? att.id : index,
    name: att.name || '',
    position: toVec3(att.position, [0, 0, 0]),
    direction: toVec3(att.direction, [0, 1, 0]),
    rotation: att.rotation ? toVec3(att.rotation, [0, 0, 0]) : null,
    shape: att.shape || 'single',
    flags: toFlags(att.flags),
    spacing: Number(att.spacing) > 0 ? Number(att.spacing) : 1,
    sockets: (att.sockets || []).map((s) => toVec3(s, [0, 0, 0])),
    size: att.size ? toVec3(att.size, [0.7, 0.3, 0.7]) : null,
    center: att.center ? toVec3(att.center, [0, 0, 0]) : null,
  }));
  part.cableAttachments = (raw.cableAttachments || []).map((cable, index) => ({
    id: Number.isInteger(cable.id) ? cable.id : index,
    name: cable.name || '',
    position: toVec3(cable.position, [0, 0, 0]),
  }));
  part.tags = raw.tags || [];
  part.variants = (raw.variants || []).map((variant) => ({
    // Keep the raw fields (module, overrides, subcategory, ...), only the
    // known ones are normalized.
    ...variant,
    type: variant.type || '',
    id: variant.id === undefined ? 0 : Number(variant.id),
    name: variant.name || '',
    iconName: variant.iconName || '',
    subcategory: variant.subcategory === undefined ? 0 : Number(variant.subcategory),
    massDelta: variant.massDelta === undefined ? 0 : Number(variant.massDelta),
    config: variant.config && typeof variant.config === 'object' ? variant.config : {},
    state: variant.state && typeof variant.state === 'object' ? variant.state : {},
  }));
  part.centerOfMassAdjustment = toVec3(raw.centerOfMassAdjustment, [0, 0, 0]);
  // -1 is "keep the snapping the player chose" and it is what the stock parts
  // mostly use, so it is the default of the editor too.
  part.radialSnapping = raw.radialSnapping === undefined ? -1 : Number(raw.radialSnapping);
  // part.json may carry the shapes as one string or as the numeric mask of the
  // game's enum; the panel and the export work on names.
  part.dynamicAttachmentConfigs = (raw.dynamicAttachmentConfigs || []).map((entry) => ({
    defindex: Number(entry.defindex) || 0,
    shape: typeof entry.shape === 'number'
      ? dynamicShapeText(dynamicShapeNames(entry.shape))
      : String(entry.shape ?? ''),
  }));
  part.dynamicCurrPivot = toVec3(raw.dynamicCurrPivot, [0, 0, 0]);
  part.animations = (raw.animations || []).map((animation) => ({
    path: animation.path || '',
    type: ['spin', 'deploy', 'keys'].includes(animation.type) ? animation.type : 'spin',
    axis: toVec3(animation.axis, [0, 1, 0]),
    speed: Number(animation.speed) || 0,
    stowed: Number(animation.stowed) || 0,
    deployed: Number(animation.deployed) || 0,
    duration: Number(animation.duration) || 1,
    trigger: animation.trigger || '',
    foldTrigger: animation.foldTrigger || '',
    tint: animation.tint || '',
    tintAmount: animation.tintAmount === undefined ? 1 : Number(animation.tintAmount),
    // A motion can move the node along the axis instead of turning it; the
    // keys travel with the motion (they were lost on import before).
    translate: Boolean(animation.translate),
    keys: (Array.isArray(animation.keys) ? animation.keys : [])
      .map((key) => ({
        time: Number(key.time) || 0,
        angle: Number(key.angle) || 0,
        smooth: key.smooth !== false,
      }))
      // The game samples the curve in the order of the list.
      .sort((a, b) => a.time - b.time),
  }));
  fillMissingStates(part);
  return part;
}

// The game creates the modules of a part by walking its state: a module
// without an entry there is never created and the part behaves as if the
// module was not there at all. The stock defaults are filled in here, so the
// exported part.json is complete without the author writing them by hand
// (the loader does the same when the game loads the part).
//
// The modules whose entry was filled are remembered: the panel of the modules
// shows them, so the author sees what the game will do.
const filledStateModules = new Set();

function fillMissingStates(part) {
  const modules = part.modules;
  if (!modules || typeof modules !== 'object') return;
  const config = part.state && typeof part.state === 'object' ? part.state : (part.state = {});
  for (const name of Object.keys(modules)) {
    if (config[name]) continue;
    const defaults = STATE_DEFAULTS[name];
    if (!defaults) continue;
    const entry = structuredClone(defaults);
    // -1 stands for "the full amount of the module" (the stock tanks fill
    // their state with the maxAmount of the config).
    if (entry.amount === -1) {
      const module = modules[name] || {};
      entry.amount = Number(module.maxAmount) || Number(module.amount) || 0;
    }
    config[name] = entry;
    filledStateModules.add(name);
  }
}

function fillForm() {
  const part = state.part;
  state.jsonInvalid = { modules: false, state: false, overrides: false };
  $('f-id').value = part.id || '';
  $('f-name').value = part.name || '';
  $('f-description').value = part.description || '';
  $('f-category').value = part.category || 'structure';
  $('f-mass').value = part.mass ?? 0;
  $('f-impact').value = part.impactTolerance ?? 0;
  $('f-assembly').value = part.assemblyPosition ?? 0;
  $('f-defindex').value = part.defindex || 0;
  $('f-tags').value = (part.tags || []).join(', ');
  $('f-model').value = part.model || '';
  $('f-units').value = part.units || 'm';
  $('f-scale').value = part.scale ?? 1;
  $('f-physics').value = part.physicsModel || '';
  $('f-icon').value = part.icon || '';
  $('f-color').value = part.material.color || '#c8ccd4';
  $('f-metallic').value = part.material.metallic ?? 0;
  $('f-smoothness').value = part.material.smoothness ?? 0;
  $('f-emissive').value = part.material.emissive || '#000000';
  $('f-emissive-intensity').value = part.material.emissiveIntensity ?? 0;
  $('f-opacity').value = part.material.opacity ?? 1;
  $('f-tiling').value = (part.material.tiling || [1, 1]).join(', ');
  $('f-offset').value = (part.material.offset || [0, 0]).join(', ');
  $('f-albedo').value = part.material.albedo || '';
  $('f-normal').value = part.material.normal || '';
  $('f-mask').value = part.material.mask || '';
  updateTextureButtons();
  $('f-explode').value = 0;
  $('f-radial').value = part.radialSnapping ?? -1;
  COM.forEach((input, axis) => {
    input.value = part.centerOfMassAdjustment?.[axis] ?? 0;
  });
  $('f-modules').value = JSON.stringify(part.modules || {}, null, 2);
  $('f-state').value = JSON.stringify(part.state || {}, null, 2);
  $('f-overrides').value = JSON.stringify(part.overrides || {}, null, 2);
  renderThermoFields();
  applyModelTransform();
  applyModelMaterial();
  applyWireframe();
}

function cleanVector(vec, fallback) {
  return toVec3(vec, fallback).map((v) => Math.round(v * 100000) / 100000);
}

function toJson(part) {
  const json = {
    formatVersion: 1,
    id: part.id,
    name: part.name,
    category: part.category,
    mass: part.mass,
  };
  if (part.description) json.description = part.description;
  if (part.tags?.length) json.tags = part.tags;
  if (part.impactTolerance) json.impactTolerance = part.impactTolerance;
  if (part.assemblyPosition) json.assemblyPosition = part.assemblyPosition;
  if (part.defindex) json.defindex = part.defindex;
  json.model = part.model;
  if (part.units && part.units !== 'm') json.units = part.units;
  if (part.scale && part.scale !== 1) json.scale = part.scale;
  if (part.physicsModel) json.physicsModel = part.physicsModel;
  if (part.icon) json.icon = part.icon;

  const material = part.material || {};
  if (material.color) json.material = { color: material.color };
  if (material.metallic) json.material.metallic = material.metallic;
  if (material.smoothness) json.material.smoothness = material.smoothness;
  if (material.emissive && material.emissive !== '#000000') json.material.emissive = material.emissive;
  if (material.emissiveIntensity) json.material.emissiveIntensity = material.emissiveIntensity;
  if (material.opacity !== undefined && Number(material.opacity) < 1) json.material.opacity = material.opacity;
  if (material.albedo) json.material.albedo = material.albedo;
  if (material.normal) json.material.normal = material.normal;
  if (material.mask) json.material.mask = material.mask;
  if (material.tiling && (Number(material.tiling[0]) !== 1 || Number(material.tiling[1]) !== 1)) {
    json.material.tiling = [Number(material.tiling[0]) || 1, Number(material.tiling[1]) || 1];
  }
  if (material.offset && (Number(material.offset[0]) || Number(material.offset[1]))) {
    json.material.offset = [Number(material.offset[0]) || 0, Number(material.offset[1]) || 0];
  }

  if (part.variants?.length) {
    json.variants = part.variants.map((variant) => {
      const out = { ...variant };
      // The editor keeps the name of the preset, the game does not know it.
      delete out.propellant;
      out.type = variant.type;
      out.id = variant.id;
      if (!variant.name) delete out.name;
      if (!variant.iconName) delete out.iconName;
      if (!variant.massDelta) delete out.massDelta;
      if (!variant.config || !Object.keys(variant.config).length) delete out.config;
      if (!variant.state || !Object.keys(variant.state).length) delete out.state;
      return out;
    });
  }

  if (part.materials?.length) {
    json.materials = part.materials.map((entry) => {
      const out = { node: entry.node };
      if (entry.color) out.color = entry.color;
      if (entry.metallic) out.metallic = entry.metallic;
      if (entry.smoothness) out.smoothness = entry.smoothness;
      if (entry.emissive && entry.emissive !== '#000000') out.emissive = entry.emissive;
      if (entry.emissiveIntensity) out.emissiveIntensity = entry.emissiveIntensity;
      if (entry.opacity !== undefined && Number(entry.opacity) < 1) out.opacity = entry.opacity;
      if (entry.albedo) out.albedo = entry.albedo;
      if (entry.normal) out.normal = entry.normal;
      if (entry.mask) out.mask = entry.mask;
      return out;
    });
  }

  json.attachments = part.attachments.map((att) => {
    const out = {
      id: att.id,
      position: cleanVector(att.position, [0, 0, 0]),
      shape: att.shape,
    };
    if (att.name) out.name = att.name;
    if (att.rotation) out.rotation = cleanVector(att.rotation, [0, 0, 0]);
    else out.direction = cleanVector(att.direction, [0, 1, 0]);
    if (att.flags?.length) out.flags = att.flags.join(', ');
    if (att.spacing && att.spacing !== 1) out.spacing = att.spacing;
    if (att.size) out.size = cleanVector(att.size, [0.7, 0.3, 0.7]);
    if (att.center) out.center = cleanVector(att.center, [0, 0, 0]);
    if (att.sockets?.length) out.sockets = att.sockets.map((s) => cleanVector(s, [0, 0, 0]));
    return out;
  });

  if (part.cableAttachments?.length) {
    json.cableAttachments = part.cableAttachments.map((cable) => {
      const out = { id: cable.id, position: cleanVector(cable.position, [0, 0, 0]) };
      if (cable.name) out.name = cable.name;
      return out;
    });
  }

  if (part.centerOfMassAdjustment?.some((v) => v)) {
    json.centerOfMassAdjustment = cleanVector(part.centerOfMassAdjustment, [0, 0, 0]);
  }
  // -1 is the default of the game (keep the player's setting), so only a real
  // value goes into the file.
  if (Number(part.radialSnapping) >= 0) json.radialSnapping = Number(part.radialSnapping);

  // Surface sockets: only the entries with a config and a shape mean anything
  // to the game, and the pivot is read only if there is a socket at all. Two
  // entries of the same config are merged (the game would create the socket
  // twice), exactly like the loader merges them.
  const dynamicMerged = new Map();
  for (const entry of part.dynamicAttachmentConfigs || []) {
    const defindex = Number(entry.defindex) || 0;
    const names = dynamicKnownShapes(entry.shape);
    if (!names.length) continue;
    const previous = dynamicMerged.get(defindex) || [];
    dynamicMerged.set(defindex, [...new Set([...previous, ...names])]);
  }
  const dynamicConfigs = [...dynamicMerged.entries()]
    .map(([defindex, names]) => ({ defindex, shape: dynamicShapeText(names) }));
  if (dynamicConfigs.length) {
    json.dynamicAttachmentConfigs = dynamicConfigs;
    if (part.dynamicCurrPivot?.some((v) => Number(v))) {
      json.dynamicCurrPivot = cleanVector(part.dynamicCurrPivot, [0, 0, 0]);
    }
  }
  for (const key of ['modules', 'state', 'overrides']) {
    if (part[key] && Object.keys(part[key]).length) json[key] = part[key];
  }
  if (part.thermo && Object.keys(part.thermo).length) json.thermo = part.thermo;

  if (part.animations?.length) {
    json.animations = part.animations.map((animation) => {
      const out = {
        path: animation.path,
        type: animation.type,
        axis: cleanVector(animation.axis, [0, 1, 0]),
      };
      if (animation.type === 'deploy') {
        out.stowed = animation.stowed;
        out.deployed = animation.deployed;
        out.duration = animation.duration;
      } else if (animation.type === 'keys') {
        out.duration = animation.duration;
        out.keys = (animation.keys || []).map((key) => ({
          time: Number(key.time) || 0,
          angle: Number(key.angle) || 0,
          smooth: key.smooth !== false,
        }));
      } else {
        out.speed = animation.speed;
      }
      if (animation.trigger) out.trigger = animation.trigger;
      if (animation.foldTrigger) out.foldTrigger = animation.foldTrigger;
      if (animation.translate) out.translate = true;
      if (animation.tint) {
        out.tint = animation.tint;
        out.tintAmount = animation.tintAmount ?? 1;
      }
      return out;
    });
  }

  return json;
}

function jsonText() {
  return JSON.stringify(toJson(state.part), null, 2);
}

$('btn-download').addEventListener('click', async () => {
  const text = jsonText();
  const fileName = `${state.part.id || 'part'}.json`;
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });

  // Chromium can ask for a folder and a file name; other browsers fall back
  // to the regular download of the same content.
  if ('showSaveFilePicker' in window) {
    let handle = null;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'part.json', accept: { 'application/json': ['.json'] } }],
      });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      // The dialog was refused or unsupported: use the anchor download below.
    }
    if (handle) {
      try {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        const saved = await handle.getFile();
        if (saved.size === 0) throw new Error('written file is empty');
        statusLine(t('status.exported', { name: handle.name }), 'ok');
        return;
      } catch (error) {
        // Leave a working download instead of a truncated file.
        console.warn('Save picker failed, falling back to a download', error);
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking the URL too early aborts the download in some browsers and
  // leaves a 0-byte file behind.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  statusLine(t('status.exported', { name: fileName }), 'ok');
});

$('btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(jsonText());
    statusLine(t('status.jsonCopied'), 'ok');
  } catch {
    statusLine(t('status.jsonCopied'), 'warn');
  }
});

$('file-json').addEventListener('change', async () => {
  const file = $('file-json').files[0];
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    loadPart(raw, file.name);
  } catch (error) {
    statusLine(t('status.modelFailed', { error: error.message || error }), 'bad');
  }
  $('file-json').value = '';
});

function loadPart(raw, fileName) {
  resetPreviewForPart();
  state.part = normalizePart(raw);
  state.selection = null;
  state.component = null;
  disposeModel();
  clearPreviewTextures();
  $('drop-hint').style.display = '';
  fillForm();
  // The preview takes the flame of the engine of the new part at once.
  showEngineFlamePreview();
  applyEngineFlame();
  refreshStructure();
  history.reset();
  statusLine(t('status.imported', { name: fileName || state.part.id }), 'ok');
}

// A new part: the skeleton of the category that is chosen in the form. The
// modules, the state and the connections of that category are already there,
// the author only has to fill in the numbers and the mesh.
$('btn-new').addEventListener('click', () => {
  const category = $('f-category').value || 'structure';
  resetPreviewForPart();
  state.part = templateFor(category);
  state.selection = null;
  state.component = null;
  disposeModel();
  clearPreviewTextures();
  state.flame = defaultFlame(ENGINE_FLAMES[0]);
  $('drop-hint').style.display = '';
  fillForm();
  refreshStructure();
  history.reset();
  statusLine(t('status.newPart', { category }), 'ok');
});

function populateExamples() {
  const select = $('example-select');
  const previous = select.value;
  select.innerHTML = '';
  for (const example of EXAMPLES) {
    const option = document.createElement('option');
    option.value = example.key;
    option.textContent = t(`example.${example.key}`);
    select.appendChild(option);
  }
  if (EXAMPLES.some((example) => example.key === previous)) {
    select.value = previous;
  }
}

let exampleMeshRequest = 0;

// Fetches the preview mesh bundled with an example and feeds it through the
// normal mesh loader, keeping the name from part.json (model.obj) so the
// exported JSON matches the file the author has to ship.
async function loadExampleMesh(example, label) {
  const request = ++exampleMeshRequest;
  const fileName = example.part.model || 'model.obj';
  try {
    const response = await fetch(example.mesh);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    if (request !== exampleMeshRequest) return;
    const loaded = await loadModelFile(new File([blob], fileName, { type: blob.type || 'text/plain' }));
    if (!loaded || request !== exampleMeshRequest) return;
    statusLine(t('status.exampleLoaded', { name: label, mesh: fileName }), 'ok');
  } catch (error) {
    if (request !== exampleMeshRequest) return;
    statusLine(t('status.modelFailed', { error: error.message || error }), 'warn');
  }
}

$('btn-load-example').addEventListener('click', () => {
  const example = EXAMPLES.find((item) => item.key === $('example-select').value);
  if (!example) return;
  const label = t(`example.${example.key}`);
  // structuredClone keeps EXAMPLES untouched, so loading twice starts clean.
  loadPart(structuredClone(example.part), label);
  if (example.mesh) {
    loadExampleMesh(example, label);
  }
});

// ---------------------------------------------------------------------------
// Drag & drop
// ---------------------------------------------------------------------------

const wrap = document.querySelector('.viewport-wrap');
wrap.addEventListener('dragover', (event) => {
  event.preventDefault();
  wrap.classList.add('dragover');
});
wrap.addEventListener('dragleave', () => wrap.classList.remove('dragover'));
wrap.addEventListener('drop', async (event) => {
  event.preventDefault();
  wrap.classList.remove('dragover');
  const files = event.dataTransfer?.files;
  if (!files || !files.length) return;

  const list = [...files];
  const json = list.find((file) => extensionOf(file.name) === 'json');
  if (json) {
    try {
      loadPart(JSON.parse(await json.text()), json.name);
    } catch (error) {
      statusLine(t('status.modelFailed', { error: error.message || error }), 'bad');
    }
    return;
  }

  await loadMeshWithMaterials(list);
});

$('file-model').addEventListener('change', async () => {
  const files = $('file-model').files;
  if (!files || !files.length) return;
  await loadMeshWithMaterials([...files]);
  $('file-model').value = '';
});

$('btn-fit').addEventListener('click', fitView);

// ---------------------------------------------------------------------------
// Resizable side panels
// ---------------------------------------------------------------------------

const layoutEl = document.querySelector('.layout');
const PANEL_LIMITS = {
  left: { min: 220, preferred: 320, max: 640, cssVar: '--left-w' },
  right: { min: 240, preferred: 340, max: 680, cssVar: '--right-w' },
};
const CENTER_MIN = 260;
const PANEL_STORE = 'partadder.editor.panels';
const panelSizes = {
  left: PANEL_LIMITS.left.preferred,
  right: PANEL_LIMITS.right.preferred,
};

function clampPanelSize(side, value) {
  const limits = PANEL_LIMITS[side];
  const other = side === 'left' ? panelSizes.right : panelSizes.left;
  const free = layoutEl.clientWidth - other - CENTER_MIN - 12;
  const max = Math.max(limits.min, Math.min(limits.max, free));
  return Math.round(Math.min(max, Math.max(limits.min, value)));
}

function applyPanelSizes() {
  layoutEl.style.setProperty(PANEL_LIMITS.left.cssVar, `${panelSizes.left}px`);
  layoutEl.style.setProperty(PANEL_LIMITS.right.cssVar, `${panelSizes.right}px`);
}

function savePanelSizes() {
  try {
    localStorage.setItem(PANEL_STORE, JSON.stringify(panelSizes));
  } catch {
    /* storage may be disabled; sizes simply reset next time */
  }
}

function loadPanelSizes() {
  try {
    const stored = JSON.parse(localStorage.getItem(PANEL_STORE) || 'null');
    if (stored) {
      if (Number.isFinite(Number(stored.left))) panelSizes.left = Number(stored.left);
      if (Number.isFinite(Number(stored.right))) panelSizes.right = Number(stored.right);
    }
  } catch {
    /* ignore broken storage */
  }
  panelSizes.left = clampPanelSize('left', panelSizes.left);
  panelSizes.right = clampPanelSize('right', panelSizes.right);
  applyPanelSizes();
}

function bindSplitter(splitter, side) {
  if (!splitter) return;
  let dragging = false;
  let startX = 0;
  let startSize = 0;

  splitter.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startSize = panelSizes[side];
    splitter.classList.add('dragging');
    document.body.classList.add('resizing');
    try {
      splitter.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers (tests) and some browsers refuse capture; the
      // window listeners below still track the drag.
    }
  });

  const move = (event) => {
    if (!dragging) return;
    const delta = event.clientX - startX;
    panelSizes[side] = clampPanelSize(side, side === 'left' ? startSize + delta : startSize - delta);
    applyPanelSizes();
  };

  const stop = () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    document.body.classList.remove('resizing');
    savePanelSizes();
    onResize();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);

  splitter.addEventListener('dblclick', () => {
    panelSizes[side] = clampPanelSize(side, PANEL_LIMITS[side].preferred);
    applyPanelSizes();
    savePanelSizes();
    onResize();
  });
}

window.addEventListener('resize', () => {
  panelSizes.left = clampPanelSize('left', panelSizes.left);
  panelSizes.right = clampPanelSize('right', panelSizes.right);
  applyPanelSizes();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function refreshStructure() {
  renderAttachmentList();
  renderAttachmentEditor();
  renderCables();
  renderDynamicList();
  renderComponents();
  renderAnimations();
  renderNodeMaterials();
  renderVariants();
  renderLibrary();
  renderEngineEffects();
  renderFlameEditor();
  renderExportParts();
  updateModelInfo();
  refreshScene();
  // After the scene: the flame preview and the marker of the force point live in
  // the overlay, which the scene refresh clears.
  updateFlamePreview();
  renderStatus();
}

// The open sections of the panels stay open after a reload: a part has a lot
// of fields, and the author works with a few sections at a time.
const SECTIONS_KEY = 'partadder.editor.sections';

function sectionKey(section) {
  const heading = section.querySelector('summary h2') || section.querySelector('summary');
  return heading ? heading.dataset.i18n : null;
}

function initSections() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SECTIONS_KEY) || 'null');
  } catch (error) {
    saved = null;
  }

  for (const section of document.querySelectorAll('.panel details.group')) {
    const key = sectionKey(section);
    if (key && saved && typeof saved[key] === 'boolean') section.open = saved[key];

    section.addEventListener('toggle', () => {
      const state = {};
      for (const item of document.querySelectorAll('.panel details.group')) {
        const name = sectionKey(item);
        if (name) state[name] = item.open;
      }
      try {
        localStorage.setItem(SECTIONS_KEY, JSON.stringify(state));
      } catch (error) {
        // Without storage the sections just do not persist.
      }
    });
  }
}

function init() {
  const saved = localStorage.getItem('partadder.editor.lang');
  const initial = saved === 'ru' ? 'ru' : 'en';
  $('lang-select').value = initial;
  setLang(initial);
  populateExamples();
  populateComponentSelect();
  populateVariantTypes();
  populateAnimationNodes();
  populateNodeMaterialSelect();
  populateStockSelect().catch(() => {});
  fillDensitySelect();
  loadLibrary();
  initTimeline();
  initCurveEditor();
  bindCurveResizer();
  loadCurveHeight();
  initFlameCurve();
  initSections();
  $('lang-select').addEventListener('change', () => {
    localStorage.setItem('partadder.editor.lang', getLang());
    fillDensitySelect();
  });

  // The schema of part.json: the loader checks the same rules, so the editor can
  // show what the game would refuse.
  loadSchema()
    .then((schema) => {
      state.schema = schema;
      renderStatus();
    })
    .catch(() => {
      // The editor works without it, the loader does not need it either.
    });

  // The draft of the last session comes back, when there is one.
  const drafted = restoreDraft();

  fillForm();
  loadPanelSizes();
  bindSplitter($('splitter-left'), 'left');
  bindSplitter($('splitter-right'), 'right');
  updateSnap();
  onResize();
  refreshStructure();
  fitView();
  history.reset();
  updateHistoryButtons();

  if (drafted) {
    // A moment later, so the message is not overwritten by the status line of
    // the validation.
    setTimeout(() => {
      statusLine(t('status.draftRestored', { name: state.part.name || state.part.id }), 'ok');
    }, 500);
  }

  renderer.setAnimationLoop(() => {
    tickAnimationPreview();
    tickFlamePreview();
    orbit.update();
    renderer.render(scene, camera);
  });
}

$('btn-undo')?.addEventListener('click', () => history.undo());
$('btn-redo')?.addEventListener('click', () => history.redo());
$('btn-mass-from-mesh')?.addEventListener('click', massFromMesh);

init();