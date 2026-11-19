// Generated from the dynamic attachment configs of the game - do not edit by hand.
// Run tools/part-editor/generate-dynamic-presets.py again when the game updates.
//
// One entry per config the game knows. The defindex names it, the sign says
// which end of the connection it is (>= 0 receives a part on its surface,
// < 0 puts this part onto the surface of another one), restrictType/restrictDir/
// restrictAngle say where on that surface the socket may sit, and rotation is
// the base rotation of the socket (Euler degrees, the game order ZXY).
export const DYNAMIC_PRESETS = [
  { defindex: 10001000, role: 'parent', restrict: 'radial', rotation: [0, 0, 90], dir: [0, 1, 0] },
  { defindex: 10001001, role: 'parent', restrict: 'radial', rotation: [-90, 0, 90], dir: [0, 1, 0] },
  { defindex: 10001002, role: 'parent', restrict: 'radial', rotation: [0, 0, 90], dir: [1, 0, 0] },
  { defindex: 10001003, role: 'parent', restrict: 'radial', rotation: [0, 0, 90], dir: [0, 0, 1] },
  { defindex: 10001100, role: 'parent', restrict: 'radial', rotation: [0, 0, 55.5], dir: [0, 1, 0], angle: [54, 57] },
  { defindex: 10001101, role: 'parent', restrict: 'radial', rotation: [0, 0, 90], dir: [0, 1, 0], angle: [-45, 45] },
  { defindex: 10001102, role: 'parent', restrict: 'radial', rotation: [0, 0, 90], dir: [0, 1, 0], angle: [-45, 0] },
  { defindex: 10001103, role: 'parent', restrict: 'radial', rotation: [0, 0, 90], dir: [0, 1, 0], angle: [0, 45] },
  { defindex: 10001104, role: 'parent', restrict: 'radial', rotation: [0, 0, 90], dir: [0, 1, 0], angle: [0, 85] },
  { defindex: 10001105, role: 'parent', restrict: 'radial', rotation: [0, 0, 90], dir: [0, 1, 0], angle: [-85, 0] },
  { defindex: 20001000, role: 'parent', restrict: 'spherical', rotation: [0, 0, 90], dir: [0, 1, 0], angle: [-90, 90] },
  { defindex: 20001100, role: 'parent', restrict: 'spherical', rotation: [0, 0, 90], dir: [0, 1, 0], angle: [-70, 75] },
  { defindex: 30001000, role: 'parent', restrict: 'directional', rotation: [0, 0, 90], dir: [-1, 0, 0] },
  { defindex: 30001001, role: 'parent', restrict: 'directional', rotation: [0, 180, 90], dir: [1, 0, 0] },
  { defindex: 30001002, role: 'parent', restrict: 'directional', rotation: [0, -90, 90], dir: [0, 0, -1] },
  { defindex: 30001003, role: 'parent', restrict: 'directional', rotation: [0, 90, 90], dir: [0, 0, 1] },
  { defindex: 30001004, role: 'parent', restrict: 'directional', rotation: [0, 60, 90], dir: [-0.5, 0, 0.866025] },
  { defindex: 30001005, role: 'parent', restrict: 'directional', rotation: [-180, -60, -90], dir: [0.5, 0, 0.866025] },
  { defindex: 30001006, role: 'parent', restrict: 'directional', rotation: [-180, 60, -90], dir: [0.5, 0, -0.866025] },
  { defindex: 30001007, role: 'parent', restrict: 'directional', rotation: [0, -60, 90], dir: [-0.5, 0, -0.866025] },
  { defindex: 30001008, role: 'parent', restrict: 'directional', rotation: [0, 0, 0], dir: [0, 1, 0] },
  { defindex: 30001009, role: 'parent', restrict: 'directional', rotation: [180, 0, 0], dir: [0, -1, 0] },
  { defindex: 30001010, role: 'parent', restrict: 'directional', rotation: [0, 90, 0], dir: [0, 1, 0] },
  { defindex: 30001011, role: 'parent', restrict: 'directional', rotation: [-90, 0, 0], dir: [0, 0, -1] },
  { defindex: 30001012, role: 'parent', restrict: 'directional', rotation: [-90, 0, 180], dir: [0, 0, 1] },
  { defindex: 30001013, role: 'parent', restrict: 'directional', rotation: [-90, 0, 90], dir: [-1, 0, 0] },
  { defindex: 30001014, role: 'parent', restrict: 'directional', rotation: [-90, 0, -90], dir: [1, 0, 0] },
  { defindex: 30001015, role: 'parent', restrict: 'directional', rotation: [0, 45, 90], dir: [-0.707106, 0, 0.707107] },
  { defindex: 30001016, role: 'parent', restrict: 'directional', rotation: [0, 135, 90], dir: [0.707106, 0, 0.707107] },
  { defindex: 30001017, role: 'parent', restrict: 'directional', rotation: [0, 225, 90], dir: [0.707106, 0, -0.707107] },
  { defindex: 30001018, role: 'parent', restrict: 'directional', rotation: [0, 315, 90], dir: [-0.707106, 0, -0.707107] },
  { defindex: 30001100, role: 'parent', restrict: 'directional', rotation: [0, 22.5, 90], dir: [-0.939693, 0, 0.34202] },
  { defindex: 30001101, role: 'parent', restrict: 'directional', rotation: [0, 157.5, 90], dir: [0.939693, 0, 0.34202] },
  { defindex: 30001102, role: 'parent', restrict: 'directional', rotation: [0, 0, 61], dir: [-0.87462, 0.48481, 0] },
  { defindex: 30001103, role: 'parent', restrict: 'directional', rotation: [0, 180, 61], dir: [0.87462, 0.48481, 0] },
  { defindex: 30001104, role: 'parent', restrict: 'directional', rotation: [0, 0, 95.5], dir: [-1, 0, 0] },
  { defindex: 30001105, role: 'parent', restrict: 'directional', rotation: [0, 180, 95.5], dir: [1, 0, 0] },
  { defindex: 30001106, role: 'parent', restrict: 'directional', rotation: [21, 0, 18.5], dir: [-0.317305, 0.885336, 0.339849] },
  { defindex: 30001107, role: 'parent', restrict: 'directional', rotation: [21, 0, -18.5], dir: [0.317305, 0.885336, 0.339849] },
  { defindex: 30001108, role: 'parent', restrict: 'directional', rotation: [21, 0, 0], dir: [0, 0.93358, 0.358368], angle: [0, 30] },
  { defindex: 30001109, role: 'parent', restrict: 'directional', rotation: [-23, 0, 180], dir: [0, -0.920505, 0.390731], angle: [0, 20] },
  { defindex: 30001110, role: 'parent', restrict: 'directional', rotation: [-150, 0, 0], dir: [0, -0.866025, -0.5] },
  { defindex: 30001111, role: 'parent', restrict: 'directional', rotation: [0, 88.5, 88.5], dir: [-0.026168, 0.026177, 0.999315] },
  { defindex: 30001112, role: 'parent', restrict: 'directional', rotation: [0, -91.5, 94], dir: [0.026113, -0.069757, -0.997222] },
  { defindex: 30001113, role: 'parent', restrict: 'directional', rotation: [180, -92, -91.6], dir: [-0.034886, 0.027921, 0.999001] },
  { defindex: 30001114, role: 'parent', restrict: 'directional', rotation: [180, 88, -84.7], dir: [0.03475, -0.092371, -0.995118] },
  { defindex: 30001115, role: 'parent', restrict: 'directional', rotation: [-56.5, 0, 0], dir: [0, 0.551937, -0.833886] },
  { defindex: 30001116, role: 'parent', restrict: 'directional', rotation: [-56.5, 180, 0], dir: [0, 0.551937, 0.833886] },
  { defindex: 30001117, role: 'parent', restrict: 'directional', rotation: [-56.5, 90, 0], dir: [-0.833886, 0.551937, 0] },
  { defindex: 30001118, role: 'parent', restrict: 'directional', rotation: [-56.5, -90, 0], dir: [0.833886, 0.551937, 0] },
  { defindex: 30001119, role: 'parent', restrict: 'directional', rotation: [0, 0, 45], dir: [-0.707107, 0.707107, 0] },
  { defindex: 30001120, role: 'parent', restrict: 'directional', rotation: [0, 0, 66.5], dir: [-0.91706, 0.39875, 0] },
  { defindex: 30001121, role: 'parent', restrict: 'directional', rotation: [0, 180, 66.5], dir: [0.91706, 0.39875, 0] },
  { defindex: 30001122, role: 'parent', restrict: 'directional', rotation: [0, 36, 90], dir: [-0.809017, 0, 0.587785] },
  { defindex: 30001123, role: 'parent', restrict: 'directional', rotation: [0, 72, 90], dir: [-0.309017, 0, 0.951056] },
  { defindex: 30001124, role: 'parent', restrict: 'directional', rotation: [0, 108, 90], dir: [0.309017, 0, 0.951056] },
  { defindex: 30001125, role: 'parent', restrict: 'directional', rotation: [0, 144, 90], dir: [0.809017, 0, 0.587785] },
  { defindex: 30001126, role: 'parent', restrict: 'directional', rotation: [0, 216, 90], dir: [0.809017, 0, -0.587785] },
  { defindex: 30001127, role: 'parent', restrict: 'directional', rotation: [0, 252, 90], dir: [0.309017, 0, -0.951056] },
  { defindex: 30001128, role: 'parent', restrict: 'directional', rotation: [0, 288, 90], dir: [-0.309017, 0, -0.951056] },
  { defindex: 30001129, role: 'parent', restrict: 'directional', rotation: [0, 324, 90], dir: [-0.809017, 0, -0.587785] },
  { defindex: -10001000, role: 'current', restrict: 'radial', rotation: [180, 0, -90], dir: [0, 1, 0] },
  { defindex: -10001102, role: 'current', restrict: 'radial', rotation: [180, 0, -90], dir: [0, 1, 0], angle: [-45, 0] },
  { defindex: -10001103, role: 'current', restrict: 'radial', rotation: [180, 0, -90], dir: [0, 1, 0], angle: [0, 45] },
  { defindex: -10001104, role: 'current', restrict: 'radial', rotation: [180, 0, -90], dir: [0, 1, 0], angle: [0, 80] },
  { defindex: -10001105, role: 'current', restrict: 'radial', rotation: [0, 0, 90], dir: [0, 1, 0], angle: [-80, 0] },
  { defindex: -30001000, role: 'current', restrict: 'directional', rotation: [0, 0, 90], dir: [-1, 0, 0] },
  { defindex: -30001001, role: 'current', restrict: 'directional', rotation: [0, 180, 90], dir: [1, 0, 0] },
  { defindex: -30001002, role: 'current', restrict: 'directional', rotation: [0, -90, 90], dir: [0, 0, -1] },
  { defindex: -30001003, role: 'current', restrict: 'directional', rotation: [0, 90, 90], dir: [0, 0, 1] },
  { defindex: -30001004, role: 'current', restrict: 'directional', rotation: [0, 60, 90], dir: [-0.5, 0, 0.866025] },
  { defindex: -30001005, role: 'current', restrict: 'directional', rotation: [-180, -60, -90], dir: [0.5, 0, 0.866025] },
  { defindex: -30001006, role: 'current', restrict: 'directional', rotation: [-180, 60, -90], dir: [0.5, 0, -0.866025] },
  { defindex: -30001007, role: 'current', restrict: 'directional', rotation: [0, -60, 90], dir: [-0.5, 0, -0.866025] },
  { defindex: -30001011, role: 'current', restrict: 'directional', rotation: [90, 0, 180], dir: [0, 0, -1] },
  { defindex: -30001012, role: 'current', restrict: 'directional', rotation: [90, 0, 0], dir: [0, 0, 1] },
  { defindex: -30001015, role: 'current', restrict: 'directional', rotation: [0, 45, 90], dir: [-0.707106, 0, 0.707107] },
  { defindex: -30001016, role: 'current', restrict: 'directional', rotation: [0, 135, 90], dir: [0.707106, 0, 0.707107] },
  { defindex: -30001017, role: 'current', restrict: 'directional', rotation: [0, 225, 90], dir: [0.707106, 0, -0.707107] },
  { defindex: -30001018, role: 'current', restrict: 'directional', rotation: [0, 315, 90], dir: [-0.707106, 0, -0.707107] },
];

// Direction keywords for the restrict direction of a preset.
export const DYNAMIC_DIRECTIONS = { up: [0, 1, 0], down: [0, -1, 0], right: [1, 0, 0], left: [-1, 0, 0], forward: [0, 0, 1], back: [0, 0, -1] };

// The shapes a dynamic socket can take. The game only connects a dynamic
// socket to a static connection of the other part that it is compatible
// with, and these are the shapes both kinds of connection actually use.
export const DYNAMIC_SHAPES = ['single', 'dual', 'triple', 'triangle', 'rectangle', 'hexdual', 'hexagon', 'heptahedron'];

// The bit of every shape in ConnectionShape: a part.json may carry the mask
// as a number, the editor reads it back into names.
export const DYNAMIC_SHAPE_BITS = {
  single: 1, dual: 2, hexdual: 4, triple: 8, triangle: 16, rectangle: 32,
  butterfly: 64, hexagon: 128, heptahedron: 256, line: 1024, star: 2048,
  hexagon_range_1: 4096, heptahedron_range_1: 8192, wide: 16384, broad: 32768,
  wide_quad: 131072, broad_quad: 262144, docking_small: 524288, docking_medium: 1048576,
};
