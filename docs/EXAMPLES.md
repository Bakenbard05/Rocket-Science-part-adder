# Part examples

Ready-to-copy `part.json` files. Every example uses a **1 × 1 × 1 m cube** named
`model.obj`, centred on the origin, unless the section says otherwise — put your own
mesh next to `part.json` and move the attachments to match it. The editor bundles
that cube as `tools/part-editor/assets/example-cube.obj` and loads it into the
preview automatically; copy it next to `part.json` as `model.obj` (or use your own
mesh of the same size) before shipping the part.

Rules that apply to all examples:

- `defindex` is omitted: the loader allocates a stable value from
  `packId/partId` (range 1 000 000 000..2 000 000 000) and checks it against every
  stock and mod part. Only set it explicitly to keep an old id.
- Attachment positions are in metres in prefab space; `direction` may be a keyword
  (`up`, `down`, `left`, `right`, `forward`, `back`) or an `[x, y, z]` vector.
- `state` mirrors `modules`: stock schemas keep per-module state in a separate object
  keyed by the module type. Values shown here are the stock defaults, so a part starts
  in a sane state.
- Module configs are real stock values; `docs/MODULES.md` lists every module the
  stock parts use, with a complete example of each config.

The editor in `tools/part-editor` has the same set built in (**Example** dropdown →
**Load example**), so you can load one, adjust the sockets and export it without
copying the JSON by hand.

## Structural block

The simplest part: no modules, one socket on each side. `shape` can be any preset
from `docs/PART_FORMAT.md` (`single`, `dual`, `hexagon`, `heptahedron`, `star`, …).

```json
{
  "formatVersion": 1,
  "id": "my_block",
  "name": "My Block",
  "category": "structure",
  "mass": 60,
  "impactTolerance": 10,
  "model": "model.obj",
  "units": "m",
  "material": { "color": "#B9BEC4", "metallic": 0.25, "smoothness": 0.45 },
  "attachments": [
    { "id": 0, "name": "top", "position": [0, 0.5, 0], "direction": "up", "shape": "single" },
    { "id": 1, "name": "bottom", "position": [0, -0.5, 0], "direction": "down", "shape": "single" }
  ],
  "modules": {},
  "state": {}
}
```

## Battery

Storage is a module plus its state; both are required, otherwise the part starts
empty (and the shop shows 0 % charge).

```json
{
  "formatVersion": 1,
  "id": "my_battery",
  "name": "My Battery",
  "category": "electricity",
  "mass": 40,
  "model": "model.obj",
  "units": "m",
  "attachments": [
    { "id": 0, "name": "top", "position": [0, 0.5, 0], "direction": "up", "shape": "dual" },
    { "id": 1, "name": "bottom", "position": [0, -0.5, 0], "direction": "down", "shape": "dual" }
  ],
  "modules": {
    "Model.ElectricityModule": { "maxAmount": 2000000 }
  },
  "state": {
    "Model.ElectricityModule": { "amount": 2000000 }
  }
}
```

## Engine

`Model.EngineModule` holds thrust, propellant and the throttle range; the thrust
acts at `forcePoint`, so keep it at the nozzle end. `Model.EngineGenerator` turns
part of the output into electricity. `Model.EngineEffectsModule` and
`Model.EngineGimbalModule` reference child objects inside the model
(`flames`, `combustionChambers`) — they only do something when your mesh has those
named nodes, so they are omitted here.

```json
{
  "formatVersion": 1,
  "id": "my_engine",
  "name": "My Engine",
  "category": "engine",
  "mass": 900,
  "impactTolerance": 8,
  "model": "model.obj",
  "units": "m",
  "attachments": [
    { "id": 0, "name": "top", "position": [0, 0.5, 0], "direction": "up", "shape": "single" }
  ],
  "modules": {
    "Model.EngineModule": {
      "chamberHeatTransfer": 0.02,
      "burnTime": 180,
      "maxThrustAsl": 250000,
      "maxThrustVac": 290000,
      "fuel": { "type": "udmh", "amount": 60 },
      "oxidizer": { "type": "n2o4", "amount": 100 },
      "throttleLimits": { "x": 0.05, "y": 1 },
      "forcePoint": { "x": 0, "y": -0.5, "z": 0 }
    },
    "Model.EngineGenerator": { "charge": 22000 }
  },
  "state": {
    "Model.EngineModule": { "thrustLimiter": 1 }
  }
}
```

## Command pod

A crewed pod needs `Model.CommandModule` (control) and usually
`Model.CockpitModule` (crew interior). The PID values are copied from stock pods;
`state` starts the autopilot disabled and the throttle at 100 %.

```json
{
  "formatVersion": 1,
  "id": "my_pod",
  "name": "My Pod",
  "category": "command",
  "mass": 1200,
  "model": "model.obj",
  "units": "m",
  "attachments": [
    { "id": 0, "name": "bottom", "position": [0, -0.5, 0], "direction": "down", "shape": "single" }
  ],
  "modules": {
    "Model.CommandModule": {
      "headingPid": { "x": 14.945, "y": 0.02, "z": 0.394 },
      "angularVelocityPid": { "x": 2.35, "y": 0.001, "z": 0.369 }
    },
    "Model.CockpitModule": {}
  },
  "state": {
    "Model.CommandModule": {
      "autoCorrection": "enabled",
      "currThrustLimiter": 1,
      "currRotation": { "value": { "x": 0, "y": 0, "z": 0, "w": 1 } },
      "targetRotation": { "value": { "x": 0, "y": 0, "z": 0, "w": 1 } }
    }
  }
}
```

## Decoupler

Two sockets, `Model.DecouplerModule`, and the matching state. `force` is in newtons;
`decoupleMode` is `undock` (push apart without changing the stack) or `jettison`.

```json
{
  "formatVersion": 1,
  "id": "my_decoupler",
  "name": "My Decoupler",
  "category": "coupling",
  "mass": 120,
  "model": "model.obj",
  "units": "m",
  "attachments": [
    { "id": 0, "name": "top", "position": [0, 0.5, 0], "direction": "up", "shape": "single" },
    { "id": 1, "name": "bottom", "position": [0, -0.5, 0], "direction": "down", "shape": "single" }
  ],
  "modules": {
    "Model.DecouplerModule": { "force": 5000 }
  },
  "state": {
    "Model.DecouplerModule": { "decoupleMode": "undock", "forcePercent": 1 }
  }
}
```

## RCS block

`Model.RCSModule` carries thrust and monopropellant. A block needs the passive
`Model.RCSBlockModule` so the game treats it as a multi-nozzle unit, and
`Model.ContinuousEffectModule` for the sound/VFX while firing:

```json
{
  "formatVersion": 1,
  "id": "my_rcs",
  "name": "My RCS Block",
  "category": "control",
  "mass": 30,
  "model": "model.obj",
  "units": "m",
  "attachments": [
    { "id": 0, "name": "top", "position": [0, 0.5, 0], "direction": "up", "shape": "single" }
  ],
  "modules": {
    "Model.RCSModule": {
      "maxThrustAsl": 100,
      "maxThrustVac": 238,
      "monopropellant": { "type": "n2h4", "amount": 0.1 }
    },
    "Model.RCSBlockModule": {},
    "Model.ContinuousEffectModule": { "sound": "rcs_micro", "vfx": "rcs_0" }
  },
  "state": {
    "Model.RCSModule": {},
    "Model.RCSBlockModule": {}
  }
}
```

## Solar panel

`panelDirections` are local +Y vectors of the panel surfaces; `area` is the total
cell area in m² and `energyConversion` the efficiency. Rotate the part so the
panels face the sun — the game uses the direction vectors, not the mesh normals.

```json
{
  "formatVersion": 1,
  "id": "my_solar",
  "name": "My Solar Panel",
  "category": "electricity",
  "mass": 25,
  "model": "model.obj",
  "units": "m",
  "attachments": [
    { "id": 0, "name": "bottom", "position": [0, -0.5, 0], "direction": "down", "shape": "single" }
  ],
  "modules": {
    "Model.SolarPanelModule": {
      "energyConversion": 0.123,
      "area": 1.1,
      "panelDirections": [{ "x": 0, "y": 1, "z": 0 }, { "x": 0, "y": 1, "z": 0 }],
      "occlusionFactors": [1, 1]
    }
  },
  "state": {
    "Model.SolarPanelModule": {}
  }
}
```

## Antenna with a tracking dish

The game animates its own parts with Unity `Animator`s, which cannot be created at
runtime, so a mod part moves its own nodes: the `animations` array of `part.json`
describes the motions. The editor writes it for you in the **Animations** section.

Pointing a node at a target needs no code: the `Model.RotationTrackingModule`
module makes the game turn the listed rotators towards the tracked target, exactly
like the stock antennas.

```json
{
  "formatVersion": 1,
  "id": "my_antenna",
  "name": "My Antenna",
  "category": "communication",
  "mass": 20,
  "model": "model.obj",
  "units": "m",
  "attachments": [
    { "id": 0, "name": "bottom", "position": [0, -0.5, 0], "direction": "down", "shape": "single" }
  ],
  "modules": {
    "Model.AntennaModule": {
      "frequencies": [2400000000],
      "bandwidths": [1000000],
      "transmisionPower": [8],
      "efficiency": 0.9,
      "type": "monopole",
      "direction": { "x": 1, "y": 0, "z": 0 }
    },
    "Model.RotationTrackingModule": {
      "type": "Y",
      "rotatorPaths": ["model/mast"],
      "limits": { "x": 0, "y": 15, "z": 0 },
      "rotationSpeed": { "x": 20, "y": 10, "z": 0 },
      "consumption": 5,
      "eceCoeff": 0.8
    }
  },
  "state": {
    "Model.AntennaModule": { "flags": "isEnabled", "bandwidthLimiter": 0.5 },
    "Model.RotationTrackingModule": { "flags": "isEnabled", "filter": "relay", "target": {} }
  },
  "animations": [
    { "path": "model/dish", "type": "spin", "axis": [0, 1, 0], "speed": 20 }
  ]
}
```

The mesh needs two named objects, `mast` and `dish`: the paths in `rotatorPaths`
and `animations` point at them. The editor ships such a mesh as
`tools/part-editor/assets/example-antenna.obj` — copy it into the part folder as
`model.obj`. A `deploy` motion instead of `spin` moves a node between two angles
when the part fires the state transition named in `trigger`.

## Fuel tank with propellant variants

A tank does not store its propellant in `modules`, it offers it as *variants*: the
game shows the tank with a fuel picker. The part needs the tank modules in every
variant and the variant list in `variants`:

```json
{
  "formatVersion": 1,
  "id": "my_tank",
  "name": "My Tank",
  "category": "structure",
  "mass": 120,
  "model": "model.obj",
  "units": "m",
  "attachments": [
    { "id": 0, "name": "top", "position": [0, 0.5, 0], "direction": "up", "shape": "single" },
    { "id": 1, "name": "bottom", "position": [0, -0.5, 0], "direction": "down", "shape": "single" }
  ],
  "modules": {},
  "state": {},
  "variants": [
    {
      "type": "contentsType",
      "id": 0,
      "name": "Kerosene",
      "config": { "Model.KeroseneModule": { "maxAmount": 100000 } },
      "state": { "Model.KeroseneModule": { "amount": 100000 } }
    },
    {
      "type": "contentsType",
      "id": 1,
      "name": "Oxygen",
      "config": { "Model.O2Module": { "maxAmount": 125000 } },
      "state": { "Model.O2Module": { "amount": 125000 } }
    },
    {
      "type": "contentsType",
      "id": 2,
      "name": "Hydrazine",
      "config": { "Model.N2H4Module": { "maxAmount": 100000 } },
      "state": { "Model.N2H4Module": { "amount": 100000 } }
    }
  ]
}
```

The amount is the mass of the propellant in the tank; pick it so that the tank is not
heavier than its `mass`. The editor has a **Variants** section with a propellant
preset that fills these modules.

## What does not work yet

- **Parachutes.** `Model.ParachuteModule` needs a full `dragStateModifiers` table
  and `Model.ParachuteSpawnerModule` spawns another registered part by id; copy both
  from a stock parachute schema, see `docs/MODULES.md`. The spawner can also point at
  a *stock* parachute, so a mod part can deploy one without a mod parachute.
- **Engine plumes and gimbal visuals.** `flames` and `combustionChambers` point at
  object paths inside the model (`model/engine_1/combustion_chamber`). Without those
  nodes the engine still produces thrust, but nothing moves and no flame shows.
  Name the objects in your mesh the same way and the stock effects work.
- **Damage models.** The game swaps in a damaged mesh through its own prefabs; a mod
  part has no damaged variant, so it keeps its mesh after an impact (the tint of the
  `animations` entry is the only way to show it).

## Checking a part

1. Copy the folder to `<mod>/Parts/<Pack>/<Part>/` (`part.json` + `model.obj`).
2. Restart the game; the shop entry appears after loading.
3. `PartAdder.log` next to the DLL lists the defindex, sockets and any validation
   error for every part. If the part is missing from the shop, the log says why.
