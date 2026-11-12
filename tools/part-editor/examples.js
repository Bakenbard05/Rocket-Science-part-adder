// Built-in examples, mirrored from docs/EXAMPLES.md. They assume a 1 x 1 x 1 m
// cube mesh centred on the origin. `mesh` is fetched by the editor for the
// preview only; the exported part.json still references `model.obj`, so the
// author has to ship a mesh of their own (assets/example-cube.obj is a starter).
const EXAMPLE_MESH = 'assets/example-cube.obj';

export const EXAMPLES = [
  {
    key: 'structural',
    mesh: EXAMPLE_MESH,
    part: {
      formatVersion: 1,
      id: 'my_block',
      name: 'My Block',
      category: 'structure',
      mass: 60,
      impactTolerance: 10,
      model: 'model.obj',
      units: 'm',
      material: { color: '#B9BEC4', metallic: 0.25, smoothness: 0.45 },
      attachments: [
        { id: 0, name: 'top', position: [0, 0.5, 0], direction: 'up', shape: 'single' },
        { id: 1, name: 'bottom', position: [0, -0.5, 0], direction: 'down', shape: 'single' },
      ],
      modules: {},
      state: {},
    },
  },
  {
    key: 'battery',
    mesh: EXAMPLE_MESH,
    part: {
      formatVersion: 1,
      id: 'my_battery',
      name: 'My Battery',
      category: 'electricity',
      mass: 40,
      model: 'model.obj',
      units: 'm',
      attachments: [
        { id: 0, name: 'top', position: [0, 0.5, 0], direction: 'up', shape: 'dual' },
        { id: 1, name: 'bottom', position: [0, -0.5, 0], direction: 'down', shape: 'dual' },
      ],
      modules: {
        'Model.ElectricityModule': { maxAmount: 2000000 },
      },
      state: {
        'Model.ElectricityModule': { amount: 2000000 },
      },
    },
  },
  {
    key: 'engine',
    mesh: EXAMPLE_MESH,
    part: {
      formatVersion: 1,
      id: 'my_engine',
      name: 'My Engine',
      category: 'engine',
      mass: 900,
      impactTolerance: 8,
      model: 'model.obj',
      units: 'm',
      attachments: [
        { id: 0, name: 'top', position: [0, 0.5, 0], direction: 'up', shape: 'single' },
      ],
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
      },
      state: {
        'Model.EngineModule': { thrustLimiter: 1 },
      },
    },
  },
  {
    key: 'command',
    mesh: EXAMPLE_MESH,
    part: {
      formatVersion: 1,
      id: 'my_pod',
      name: 'My Pod',
      category: 'command',
      mass: 1200,
      model: 'model.obj',
      units: 'm',
      attachments: [
        { id: 0, name: 'bottom', position: [0, -0.5, 0], direction: 'down', shape: 'single' },
      ],
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
      },
    },
  },
  {
    key: 'decoupler',
    mesh: EXAMPLE_MESH,
    part: {
      formatVersion: 1,
      id: 'my_decoupler',
      name: 'My Decoupler',
      category: 'coupling',
      mass: 120,
      model: 'model.obj',
      units: 'm',
      attachments: [
        { id: 0, name: 'top', position: [0, 0.5, 0], direction: 'up', shape: 'single' },
        { id: 1, name: 'bottom', position: [0, -0.5, 0], direction: 'down', shape: 'single' },
      ],
      modules: {
        'Model.DecouplerModule': { force: 5000 },
      },
      state: {
        'Model.DecouplerModule': { decoupleMode: 'undock', forcePercent: 1 },
      },
    },
  },
  {
    key: 'rcs',
    mesh: EXAMPLE_MESH,
    part: {
      formatVersion: 1,
      id: 'my_rcs',
      name: 'My RCS Block',
      category: 'control',
      mass: 30,
      model: 'model.obj',
      units: 'm',
      attachments: [
        { id: 0, name: 'top', position: [0, 0.5, 0], direction: 'up', shape: 'single' },
      ],
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
        'Model.RCSModule': {},
        'Model.RCSBlockModule': {},
      },
    },
  },
  {
    key: 'solar',
    mesh: EXAMPLE_MESH,
    part: {
      formatVersion: 1,
      id: 'my_solar',
      name: 'My Solar Panel',
      category: 'electricity',
      mass: 25,
      model: 'model.obj',
      units: 'm',
      attachments: [
        { id: 0, name: 'bottom', position: [0, -0.5, 0], direction: 'down', shape: 'single' },
      ],
      modules: {
        'Model.SolarPanelModule': {
          energyConversion: 0.123,
          area: 1.1,
          panelDirections: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }],
          occlusionFactors: [1, 1],
        },
      },
      state: {
        'Model.SolarPanelModule': {},
      },
    },
  },
  {
    key: 'antenna',
    mesh: 'assets/example-antenna.obj',
    part: {
      formatVersion: 1,
      id: 'my_antenna',
      name: 'My Antenna',
      description: 'Mast with a rotating dish. The mast tracks the target, the dish spins.',
      category: 'communication',
      mass: 20,
      model: 'model.obj',
      units: 'm',
      attachments: [
        { id: 0, name: 'bottom', position: [0, -0.5, 0], direction: 'down', shape: 'single' },
      ],
      modules: {
        'Model.AntennaModule': {
          frequencies: [2400000000],
          bandwidths: [1000000],
          transmisionPower: [8],
          efficiency: 0.9,
          type: 'monopole',
          direction: { x: 1, y: 0, z: 0 },
        },
        'Model.RotationTrackingModule': {
          type: 'Y',
          rotatorPaths: ['model/mast'],
          limits: { x: 0, y: 15, z: 0 },
          rotationSpeed: { x: 20, y: 10, z: 0 },
          consumption: 5,
          eceCoeff: 0.8,
        },
      },
      state: {
        'Model.AntennaModule': { flags: 'isEnabled', bandwidthLimiter: 0.5 },
        'Model.RotationTrackingModule': { flags: 'isEnabled', filter: 'relay', target: {} },
      },
      animations: [
        { path: 'model/dish', type: 'spin', axis: [0, 1, 0], speed: 20 },
      ],
    },
  },
];
