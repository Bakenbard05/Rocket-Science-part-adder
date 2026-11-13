// The flame of an engine: the parameters of the material of the game, the
// preview in the viewport and the file that the loader reads.
//
// The game builds the flame from a prefab ("engine_0_flame" and friends) that
// carries the flame shader and a procedural mesh. ContinuousFlame.Setup()
// clones that prefab, copies its material and drives the shader every frame:
// _throttle (smoothed with 3/s), _pressure and _LengthFade (4/s). Everything
// else animates inside the shader: _Speed + _Scroll + _Noise_ST scroll the
// noise, _FlipBook plays the frames, _Flutter and _Pulse wave the tongues.
//
// So a custom flame is the stock prefab with other numbers on its material.
// The numbers below are the names of the shader, so they are the same in the
// game and in the preview.
import * as THREE from 'three';
import { FLAME_PRESETS } from './flame-presets.js';
import { defaultFlameProfile } from './flame-curve.js';

// The parameters the editor writes into flame.json. The names are the ones of
// the shader, the loader copies them onto the material of the flame.
export const FLAME_PARAMS = [
  // The defaults are the look of the stock flames: a red core with a yellow
  // rim. The game writes every parameter of flame.json onto the material, so
  // the values here are the values the flame gets in the game.
  { key: 'color', type: 'color', def: '#ff3a00' },
  { key: 'rimColor', type: 'color', def: '#ffe680' },
  // The length of the flame in metres. The loader builds the geometry of the
  // flame in that size, so the preview and the game show the same flame.
  { key: 'size', type: 'number', min: 0.2, max: 12, step: 0.1, def: 2.5 },
  { key: 'rimPower', type: 'number', min: 0, max: 8, step: 0.01, def: 2.59 },
  { key: 'flameLevel', type: 'number', min: 0, max: 4, step: 0.01, def: 1 },
  { key: 'brightness', type: 'number', min: 0, max: 4, step: 0.01, def: 1 },
  { key: 'intensity', type: 'number', min: 0, max: 20, step: 0.01, def: 6.76 },
  // How much of the flame is visible. The game fades the flame out with it.
  { key: 'lengthFade', type: 'number', min: 0, max: 2, step: 0.01, def: 1 },
  { key: 'blend', type: 'number', min: 0, max: 2, step: 0.01, def: 1 },
  { key: 'speed', type: 'number', min: 0, max: 12, step: 0.01, def: 2.25 },
  // The falloff of the flame along its length.
  { key: 'pow', type: 'number', min: 0.2, max: 6, step: 0.01, def: 1.89 },
  { key: 'taper', type: 'vec2', def: [0, 0] },
  { key: 'move', type: 'number', min: 0, max: 4, step: 0.01, def: 0 },
  { key: 'scroll', type: 'vec2', def: [1.17, 2.2] },
  { key: 'flipbook', type: 'vec2', def: [1, 1] },
  { key: 'flutter', type: 'vec3', def: [1, 0.1, 0.44] },
  { key: 'pulse', type: 'vec3', def: [0.1, 0.1, 1] },
  { key: 'angle', type: 'vec3', def: [0, 0, 1.89] },
  { key: 'against', type: 'vec2', def: [0.2, 5.1] },
  { key: 'scale', type: 'vec3', def: [1, 1, 1] },
  { key: 'soften', type: 'vec3', def: [1, 0.7, 0.6] },
  { key: 'noiseST', type: 'vec4', def: [1, 0.15, 0, 0] },
];

export function defaultFlameParams() {
  const params = {};
  for (const param of FLAME_PARAMS) {
    if (param.type === 'color') {
      params[param.key] = { hex: param.def, hdr: null };
    } else if (Array.isArray(param.def)) {
      params[param.key] = param.def.slice();
    } else {
      params[param.key] = param.def;
    }
  }
  return params;
}

export function defaultFlame(base) {
  const flame = {
    base: base || 'engine_0_flame',
    params: defaultFlameParams(),
    profile: defaultFlameProfile(),
    name: '',
  };
  // The stock flames have their own values: start from them.
  applyFlamePreset(flame, flame.base);
  return flame;
}

// The values of a stock flame of the game, so the editor can start from them.
export function flamePreset(name) {
  return FLAME_PRESETS[name] || null;
}

// Fills the parameters with the values of a stock flame of the game.
export function applyFlamePreset(flame, name) {
  const preset = flamePreset(name);
  if (!preset) return false;
  const params = defaultFlameParams();
  for (const param of FLAME_PARAMS) {
    const value = preset.params[param.key];
    if (value === undefined) continue;
    if (param.type === 'color') {
      params[param.key] = typeof value === 'string'
        ? { hex: value, hdr: null }
        : { hex: value.hex, hdr: value.hdr.slice() };
    } else if (Array.isArray(param.def)) {
      params[param.key] = value.slice();
    } else {
      params[param.key] = value;
    }
  }
  flame.params = params;
  return true;
}

// The file the loader reads next to part.json.
export function flameToJson(flame) {
  const params = {};
  for (const param of FLAME_PARAMS) {
    const value = flame.params[param.key];
    if (value === undefined) continue;
    if (param.type === 'color') {
      // The colors of the game are HDR, so they are written as the values.
      params[param.key] = value.hdr ? value.hdr.slice() : value.hex;
    } else {
      params[param.key] = value;
    }
  }

  return {
    base: flame.base,
    params,
    ...(flame.profile && flame.profile.length ? { profile: flame.profile.map((point) => ({ v: point.v, r: point.r })) } : {}),
  };
}

export function flameFromJson(data) {
  const flame = defaultFlame(data?.base);
  if (data?.params && typeof data.params === 'object') {
    for (const param of FLAME_PARAMS) {
      const value = data.params[param.key];
      if (value === undefined || value === null) continue;
      if (param.type === 'color') {
        if (Array.isArray(value)) {
          flame.params[param.key] = { hex: rgbToHex(value), hdr: value.slice() };
        } else {
          flame.params[param.key] = { hex: String(value), hdr: null };
        }
      } else if (Array.isArray(param.def)) {
        flame.params[param.key] = Array.isArray(value) ? value.slice() : param.def.slice();
      } else if (param.type === 'number') {
        const number = Number(value);
        flame.params[param.key] = Number.isFinite(number) ? number : param.def;
      } else {
        flame.params[param.key] = value;
      }
    }
  }
  if (Array.isArray(data?.profile) && data.profile.length) {
    flame.profile = data.profile
      .filter((point) => point && Number.isFinite(Number(point.v)))
      .map((point) => ({ v: Number(point.v), r: Number(point.r) || 0 }))
      .sort((a, b) => a.v - b.v);
  }
  return flame;
}

function hexToRgb(hex) {
  const value = String(hex || '#ffffff').replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.padEnd(6, '0');
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

function rgbToHex(rgb) {
  const values = Array.isArray(rgb) ? rgb : [0, 0, 0];
  return '#' + values.slice(0, 3)
    .map((c) => Math.max(0, Math.min(255, Math.round(Number(c) * 255))).toString(16).padStart(2, '0'))
    .join('');
}

// A tiling value noise, used by the preview. The game uses a baked noise
// texture; the preview makes its own so that it needs no file.
let noiseTexture = null;

function makeNoiseTexture(size = 64) {
  const cells = 8;
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();

  const at = (x, y) => {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    const fx = x - gx;
    const fy = y - gy;
    const ix = ((gx % cells) + cells) % cells;
    const iy = ((gy % cells) + cells) % cells;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const v00 = grid[iy * (cells + 1) + ix];
    const v10 = grid[iy * (cells + 1) + ix + 1];
    const v01 = grid[(iy + 1) * (cells + 1) + ix];
    const v11 = grid[(iy + 1) * (cells + 1) + ix + 1];
    const a = v00 + (v10 - v00) * sx;
    const b = v01 + (v11 - v01) * sx;
    return a + (b - a) * sy;
  };

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cells;
      const v = (y / size) * cells;
      const value = at(u, v) * 0.6 + at(u * 2, v * 2) * 0.3 + at(u * 4, v * 4) * 0.1;
      const index = (y * size + x) * 4;
      const byte = Math.max(0, Math.min(255, Math.round(value * 255)));
      data[index] = byte;
      data[index + 1] = byte;
      data[index + 2] = byte;
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function noise() {
  if (!noiseTexture) noiseTexture = makeNoiseTexture();
  return noiseTexture;
}

const VERTEX_SHADER = `
uniform float uTime;
uniform float uThrottle;
uniform float uLength;
uniform float uTaper;
uniform float uRadius;
uniform vec3 uFlutter;
uniform vec3 uPulse;
uniform vec3 uAngle;
uniform vec2 uAgainst;
uniform vec3 uScale;
uniform float uMove;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;

void main() {
  vUv = uv;
  float t = uv.y;                      // 0 at the nozzle, 1 at the bottom
  vec3 p = position;

  // The flame of the game is a bell: narrow at the nozzle and wide at the
  // bottom, where the shader lets it fade out.
  float taper = max(0.05, 1.0 - uTaper * (1.0 - t));
  p.x *= taper;
  p.z *= taper;

  // The tongues of the flame wave more the further they are from the nozzle.
  float wave = sin(uTime * 3.0 + t * 7.0 + uv.x * 6.2831) * uFlutter.x * 0.22 * uRadius * t * t;
  float wave2 = sin(uTime * 2.3 + t * 5.0 + uv.x * 3.1) * uFlutter.y * 0.22 * uRadius * t * t;
  p.x += wave;
  p.z += wave2;

  float beat = sin(uTime * 5.0 + t * 9.0) * uPulse.x * 0.12 * uRadius * t;
  p.x += beat;
  p.z += beat * uPulse.z;

  // The flame leans to the side: the angle of the game bends it, the counter
  // bend holds it back.
  float lean = t * t * uAngle.z * 0.06;
  p.x += lean;
  p.z += lean * uAgainst.y * 0.06;
  p.x -= lean * uAgainst.x * 0.15;

  p.y += uMove * t * t;

  // The scale of the shader: x and z are the width, y is the length.
  p.x *= uScale.x;
  p.z *= uScale.z;
  p.y *= uScale.y;

  // The throttle shortens the flame, the same way the game writes _throttle.
  p.y *= uLength * (0.3 + 0.7 * uThrottle);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT_SHADER = `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uSpeed;
uniform vec2 uScroll;
uniform vec2 uFlipBook;
uniform vec4 uNoiseST;
uniform vec3 uColor;
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uFlameLevel;
uniform float uBrightness;
uniform float uIntensity;
uniform float uLengthFade;
uniform float uBlend;
uniform float uThrottle;
uniform float uPow;
uniform vec3 uSoften;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;

void main() {
  float t = vUv.y;                             // 0 at the nozzle, 1 at the bottom

  // The noise of the game scrolls with the speed and the scroll of the shader.
  float scroll = uTime * uSpeed * uScroll.y * max(uFlipBook.x, 0.05);
  vec2 nuv = vec2(vUv.x * uNoiseST.x, vUv.y * uNoiseST.y - scroll);
  float n = texture2D(uNoise, nuv).r;
  float n2 = texture2D(uNoise, nuv * 2.3 + vec2(uTime * 0.13, -uTime * 0.7)).r;
  float grain = mix(n, n2, 0.45);

  // The flame is a solid cone: the whole geometry is visible, the noise only
  // softens the edges a little. The falloff (_Pow) dims it towards the wide end,
  // in the game the flame is the brightest at the nozzle.
  float body = 1.0 - t;
  float mask = smoothstep(0.0, 0.3, grain + 0.4);
  mask *= uThrottle * uLengthFade;
  mask = clamp(mask, 0.0, 1.0);
  if (mask <= 0.001) discard;

  float falloff = pow(clamp(body, 0.0, 1.0), 1.0 + (uPow - 1.0) * 0.25);
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), uRimPower * max(uSoften.x, 0.05));
  vec3 col = (uColor * (uBrightness * (0.45 + 0.55 * grain)) + uRimColor * rim * uIntensity * 0.12) * falloff;
  float alpha = clamp(mask * uBlend, 0.0, 1.0);

  // The game renders in HDR with a bloom, so the bright parts of the flame blow
  // out to white. The preview does the same with a simple tonemap.
  col = col / (1.0 + col);

  gl_FragColor = vec4(col * alpha, alpha);
}
`;

// The mesh of the flame: the profile of the flame revolved around the axis.
// The tip sits on the nozzle (y = 0) and the flame hangs down from it, the
// same way the game draws it. The UVs are the ones of the game: u around the
// axis, v along the flame (0 at the nozzle).
export function createFlameGeometry(profile, length = 1) {
  const points = (profile && profile.length ? profile : defaultFlameProfile())
    .map((point) => new THREE.Vector2(
      Math.max(0.002, Number(point.r) || 0),
      -(Number(point.v) || 0) * length));

  return new THREE.LatheGeometry(points, 28);
}

export function createFlameMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uThrottle: { value: 1 },
      uLength: { value: 1 },
      uTaper: { value: 0 },
      uRadius: { value: 0.08 },
      uMove: { value: 0 },
      uSpeed: { value: 2.25 },
      uScroll: { value: new THREE.Vector2(1.17, 2.2) },
      uFlipBook: { value: new THREE.Vector2(1, 1) },
      uNoiseST: { value: new THREE.Vector4(1, 0.15, 0, 0) },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uRimColor: { value: new THREE.Color(1, 1, 0) },
      uRimPower: { value: 2.59 },
      uFlameLevel: { value: 1 },
      uBrightness: { value: 1 },
      uIntensity: { value: 6.76 },
      uLengthFade: { value: 1 },
      uBlend: { value: 1 },
      uPow: { value: 1.89 },
      uSoften: { value: new THREE.Vector3(1, 0.7, 0.6) },
      uFlutter: { value: new THREE.Vector3(1, 0.1, 0.44) },
      uPulse: { value: new THREE.Vector3(0.1, 0.1, 1) },
      uAngle: { value: new THREE.Vector3(0, 0, 1.89) },
      uAgainst: { value: new THREE.Vector2(0.2, 5.1) },
      uScale: { value: new THREE.Vector3(1, 1, 1) },
      uNoise: { value: noise() },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    // The preview always shows the flame, even when the model hides it.
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// Copies the parameters of the editor onto the material of the preview.
export function applyFlameParams(material, flame) {
  const params = flame?.params || {};
  const u = material.uniforms;
  const color = (value) => (value && value.hdr ? value.hdr : hexToRgb(value?.hex));

  const rgb = color(params.color);
  u.uColor.value.setRGB(rgb[0], rgb[1], rgb[2]);
  const rim = color(params.rimColor);
  u.uRimColor.value.setRGB(rim[0], rim[1], rim[2]);

  u.uRimPower.value = Number(params.rimPower) || 0;
  u.uFlameLevel.value = Number(params.flameLevel) || 0;
  u.uBrightness.value = Number(params.brightness) || 0;
  u.uIntensity.value = Number(params.intensity) || 0;
  u.uLengthFade.value = Number(params.lengthFade) || 0;
  u.uBlend.value = Number(params.blend) || 0;
  u.uSpeed.value = Number(params.speed) || 0;
  u.uTaper.value = Number(params.taper?.[0]) || 0;
  u.uMove.value = Number(params.move) || 0;
  u.uPow.value = Number(params.pow) || 1;
  u.uScroll.value.set(Number(params.scroll?.[0]) || 0, Number(params.scroll?.[1]) || 0);
  u.uFlipBook.value.set(Number(params.flipbook?.[0]) || 1, Number(params.flipbook?.[1]) || 1);
  u.uNoiseST.value.set(
    Number(params.noiseST?.[0]) || 0,
    Number(params.noiseST?.[1]) || 0,
    Number(params.noiseST?.[2]) || 0,
    Number(params.noiseST?.[3]) || 0,
  );
  u.uFlutter.value.set(
    Number(params.flutter?.[0]) || 0,
    Number(params.flutter?.[1]) || 0,
    Number(params.flutter?.[2]) || 0,
  );
  u.uPulse.value.set(
    Number(params.pulse?.[0]) || 0,
    Number(params.pulse?.[1]) || 0,
    Number(params.pulse?.[2]) || 0,
  );
  u.uAngle.value.set(
    Number(params.angle?.[0]) || 0,
    Number(params.angle?.[1]) || 0,
    Number(params.angle?.[2]) || 0,
  );
  u.uAgainst.value.set(Number(params.against?.[0]) || 0, Number(params.against?.[1]) || 0);
  u.uScale.value.set(
    Number(params.scale?.[0]) || 1,
    Number(params.scale?.[1]) || 1,
    Number(params.scale?.[2]) || 1,
  );
  u.uSoften.value.set(
    Number(params.soften?.[0]) || 1,
    Number(params.soften?.[1]) || 1,
    Number(params.soften?.[2]) || 1,
  );
}
