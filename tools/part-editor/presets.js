// Socket layouts mirrored from PartLoader/AttachmentPresets.cs.
// Sockets are offsets in the attachment's local X/Z plane (Y is the connection normal).
export const PRESETS = {
  single: { shape: 'single', size: [0.7, 0.3, 0.7], sockets: [[0, 0, 0]] },
  dual: { shape: 'dual', size: [1.0, 0.3, 1.0], sockets: [[-0.35, 0, 0], [0.35, 0, 0]] },
  triple: { shape: 'triple', size: [2.0, 0.3, 0.7], sockets: [[-0.7, 0, 0], [0, 0, 0], [0.7, 0, 0]] },
  triangle: { shape: 'triangle', size: [1.7, 0.3, 1.7], sockets: [[0, 0, -0.7], [0.6062, 0, 0.35], [-0.6062, 0, 0.35]] },
  rectangle: {
    shape: 'rectangle', size: [1.7, 0.3, 1.7],
    sockets: [[-0.6062, 0, -0.35], [-0.6062, 0, 0.35], [0.6062, 0, 0.35], [0.6062, 0, -0.35]],
  },
  hexagon: {
    shape: 'hexagon', size: [1.7, 0.3, 1.7],
    sockets: [[0, 0, -0.7], [-0.6062, 0, -0.35], [-0.6062, 0, 0.35], [0, 0, 0.7], [0.6062, 0, 0.35], [0.6062, 0, -0.35]],
  },
  hexdual: { shape: 'hexdual', size: [1.9, 0.3, 0.4], sockets: [[-0.7, 0, 0], [0.7, 0, 0]] },
  wide: { shape: 'wide', size: [3.5, 0.3, 0.7], sockets: [[-1.25, 0, 0], [1.25, 0, 0]] },
  broad: { shape: 'broad', size: [3.5, 0.3, 0.7], sockets: [[-1.72, 0, 0], [1.72, 0, 0]] },
  wide_quad: {
    shape: 'wide_quad', size: [3.5, 0.3, 3.5],
    sockets: [[-1.25, 0, -1.25], [-1.25, 0, 1.25], [1.25, 0, 1.25], [1.25, 0, -1.25]],
  },
  broad_quad: {
    shape: 'broad_quad', size: [4.4, 0.3, 4.4],
    sockets: [[-1.72, 0, -1.72], [-1.72, 0, 1.72], [1.72, 0, 1.72], [1.72, 0, -1.72]],
  },
  butterfly: {
    shape: 'butterfly', size: [1.7, 0.3, 1.7],
    sockets: [[-0.6062, 0, -0.35], [-0.6062, 0, 0.35], [0, 0, 0], [0.6062, 0, 0.35], [0.6062, 0, -0.35]],
  },
  line: { shape: 'line', size: [0.7, 0.3, 1.4], sockets: [[0, 0, -0.35], [0, 0, 0.35]] },
  heptahedron: {
    shape: 'heptahedron', size: [1.65, 0.3, 1.65],
    sockets: [
      [0, 0, 0.7], [-0.6062, 0, 0.35], [-0.6062, 0, -0.35], [0, 0, -0.7],
      [0.6062, 0, -0.35], [0.6062, 0, 0.35], [0, 0, 0],
    ],
  },
  star: {
    shape: 'star', size: [4.0, 0.3, 4.0],
    sockets: [
      [0, 0, 0.7], [-0.6062, 0, 0.35], [-0.6062, 0, -0.35], [0, 0, -0.7],
      [0.6062, 0, -0.35], [0.6062, 0, 0.35],
      [0, 0, 1.4], [-1.2124, 0, 0.7], [-1.2124, 0, -0.7], [0, 0, -1.4],
      [1.2124, 0, -0.7], [1.2124, 0, 0.7],
    ],
  },
  docking_small: { shape: 'docking_small', size: [1.0, 0.3, 1.0], sockets: [[0, 0, 0]] },
  docking_medium: { shape: 'docking_medium', size: [1.7, 0.3, 1.7], sockets: [[0, 0, 0]] },
};

// Shapes accepted by the loader that have no built-in socket layout; they need explicit sockets.
export const SHAPE_ONLY = ['heptahedron_range_1', 'hexagon_range_1'];

export const SHAPES = [...Object.keys(PRESETS), ...SHAPE_ONLY];

export const CATEGORIES = [
  'command', 'fuelTank', 'engine', 'control', 'coupling', 'adapter',
  'structure', 'aero', 'electricity', 'thermal', 'communication',
  'instrument', 'utility', 'station', 'cargo', 'hidden',
];

export const UNITS = {
  m: 1, meter: 1, meters: 1,
  cm: 0.01, centimeter: 0.01, centimeters: 0.01,
  mm: 0.001, millimeter: 0.001, millimeters: 0.001,
  in: 0.0254, inch: 0.0254, inches: 0.0254,
  ft: 0.3048, foot: 0.3048, feet: 0.3048,
};

export const FLAGS = ['none', 'dynamic', 'primary', 'axial'];

export const DIRECTIONS = {
  up: [0, 1, 0],
  top: [0, 1, 0],
  down: [0, -1, 0],
  bottom: [0, -1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  forward: [0, 0, 1],
  front: [0, 0, 1],
  back: [0, 0, -1],
  backward: [0, 0, -1],
};
