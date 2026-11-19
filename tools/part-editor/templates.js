// The skeletons of the new parts: every category gets the modules, the state and
// the connections it needs, so the author only has to fill in the numbers and the
// mesh. The values are the ones of the examples (docs/EXAMPLES.md), they are a
// starting point and nothing more.

const TOP = { id: 0, name: 'top', position: [0, 0.5, 0], direction: 'up', shape: 'single' };
const BOTTOM = { id: 1, name: 'bottom', position: [0, -0.5, 0], direction: 'down', shape: 'single' };

function part(overrides) {
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
    attachments: [{ ...TOP }],
    cableAttachments: [],
    centerOfMassAdjustment: [0, 0, 0],
    radialSnapping: -1,
    dynamicAttachmentConfigs: [],
    dynamicCurrPivot: [0, 0, 0],
    modules: {},
    state: {},
    variants: [],
    thermo: {},
    overrides: {},
    animations: [],
    ...overrides,
  };
}

export const TEMPLATES = {
  structure: () => part({
    id: 'my_structure',
    name: 'My Structure',
    category: 'structure',
    mass: 60,
    attachments: [{ ...TOP }, { ...BOTTOM }],
  }),

  engine: () => part({
    id: 'my_engine',
    name: 'My Engine',
    category: 'engine',
    mass: 900,
    impactTolerance: 8,
    attachments: [{ ...TOP }],
    modules: {
      'Model.EngineModule': {
        chamberHeatTransfer: 0.02,
        burnTime: 180,
        maxThrustAsl: 250000,
        maxThrustVac: 290000,
        fuel: { type: 'udmh', amount: 60 },
        oxidizer: { type: 'n2o4', amount: 100 },
        throttleLimits: { x: 0.05, y: 1 },
        forcePoint: { x: 0, y: -0.5, z: 0 },
      },
      'Model.EngineGenerator': { charge: 22000 },
      'Model.EngineEffectsModule': { flames: ['engine_0_flame'] },
    },
    state: {
      'Model.EngineModule': { thrustLimiter: 1 },
      'Model.EngineGenerator': {},
      'Model.EngineEffectsModule': {},
    },
  }),

  fuelTank: () => part({
    id: 'my_tank',
    name: 'My Tank',
    category: 'fuelTank',
    mass: 300,
    attachments: [{ ...TOP }, { ...BOTTOM }],
    modules: {
      'Model.KeroseneModule': { maxAmount: 100 },
      'Model.N2O4Module': { maxAmount: 160 },
    },
    state: {
      'Model.KeroseneModule': { amount: 100 },
      'Model.N2O4Module': { amount: 160 },
    },
  }),

  command: () => part({
    id: 'my_pod',
    name: 'My Pod',
    category: 'command',
    mass: 1200,
    attachments: [{ ...BOTTOM, id: 0, name: 'bottom' }],
    modules: {
      'Model.CommandModule': {
        headingPid: { x: 14.945, y: 0.02, z: 0.394 },
        angularVelocityPid: { x: 2.35, y: 0.001, z: 0.369 },
      },
      'Model.CockpitModule': {},
    },
    state: {
      'Model.CommandModule': {
        autoCorrection: 'enabled',
        currThrustLimiter: 1,
        currRotation: { value: { x: 0, y: 0, z: 0, w: 1 } },
        targetRotation: { value: { x: 0, y: 0, z: 0, w: 1 } },
      },
      'Model.CockpitModule': {},
    },
  }),

  coupling: () => part({
    id: 'my_decoupler',
    name: 'My Decoupler',
    category: 'coupling',
    mass: 120,
    attachments: [{ ...TOP }, { ...BOTTOM }],
    modules: {
      'Model.DecouplerModule': { force: 5000 },
    },
    state: {
      'Model.DecouplerModule': { decoupleMode: 'undock', forcePercent: 1 },
    },
  }),

  control: () => part({
    id: 'my_rcs',
    name: 'My RCS Block',
    category: 'control',
    mass: 30,
    attachments: [{ ...TOP }],
    modules: {
      'Model.RCSModule': {
        maxThrustAsl: 100,
        maxThrustVac: 238,
        monopropellant: { type: 'n2h4', amount: 0.1 },
      },
      'Model.RCSBlockModule': {},
      'Model.ContinuousEffectModule': { sound: 'rcs_micro', vfx: 'rcs_0' },
    },
    state: {
      'Model.RCSModule': { isEnabled: true, thrustLimiter: 1 },
      'Model.RCSBlockModule': {},
    },
  }),

  electricity: () => part({
    id: 'my_battery',
    name: 'My Battery',
    category: 'electricity',
    mass: 40,
    attachments: [
      { ...TOP, shape: 'dual' },
      { ...BOTTOM, shape: 'dual' },
    ],
    modules: {
      'Model.ElectricityModule': { maxAmount: 2000000 },
    },
    state: {
      'Model.ElectricityModule': { amount: 2000000 },
    },
  }),

  communication: () => part({
    id: 'my_antenna',
    name: 'My Antenna',
    category: 'communication',
    mass: 20,
    attachments: [{ ...BOTTOM, id: 0, name: 'bottom' }],
    modules: {
      'Model.AntennaModule': {
        frequencies: [2400000000],
        bandwidths: [1000000],
        transmisionPower: [8],
        efficiency: 0.9,
        type: 'monopole',
        direction: { x: 1, y: 0, z: 0 },
      },
    },
    state: {
      'Model.AntennaModule': { flags: 'isEnabled', bandwidthLimiter: 0.5 },
    },
  }),

  thermal: () => part({
    id: 'my_shield',
    name: 'My Heat Shield',
    category: 'thermal',
    mass: 150,
    attachments: [{ ...BOTTOM, id: 0, name: 'bottom' }],
    modules: {
      'Model.HeatShieldModule': { thickness: 0.1 },
    },
    state: {
      'Model.HeatShieldModule': { thickness: 0.1 },
    },
  }),
};

// The skeleton of a category; the categories without one get a plain structure.
export function templateFor(category) {
  const build = TEMPLATES[category] || TEMPLATES.structure;
  return build();
}
