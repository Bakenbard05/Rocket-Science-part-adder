# Part format

PartAdder loads parts from folders next to the mod DLL, at game start. No Unity
installation, AssetBundle or Addressables catalog is involved: the loader builds the
prefab at runtime and bakes it with the game's own baker.

```text
<Rocket Science>/Mods/<mod>/
  config.json              mod metadata read by the game
  RSExtension.dll          this mod
  Parts/
    <Pack>/
      pack.json            optional pack metadata
      <Part>/
        part.json          required, describes the part
        model.obj          required, the mesh (any Assimp format)
        physics.obj        optional collision mesh
        icon.png           optional shop thumbnail
        albedo.png         optional material textures
        normal.png
        mask.png
```

Pack and part folder names are arbitrary. The loader scans `Parts/*/*/part.json`,
sorted by folder name. Every `part.json` path is resolved relative to its own part
folder.

Start the game and open the shop: loaded parts appear in their category. If a part
does not appear, read `PartAdder.log` next to the DLL — it records every part that was
loaded, every warning and the reason each failure happened.

## pack.json

Optional. Without it the folder name is used as the pack id.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Pack id, used in prefab names and in the automatic defindex. |
| `name` | string | Display name. Currently informational. |
| `author` | string | Informational. |
| `version` | string | Informational. |
| `enabled` | bool | `false` skips the whole pack. Default `true`. |

## part.json

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `formatVersion` | int | no | Format version, currently `1`. Reserved for future migrations. |
| `id` | string | no | Unique id inside the pack. Defaults to the folder name. Letters, digits, `_`, `-`, `.` only. |
| `name` | string | no | Shop name. Defaults to `id`. |
| `description` | string | no | Shop description. |
| `category` | string | **yes** | Shop category, see below. |
| `mass` | number | **yes** | Mass in kg, must be positive. |
| `tags` | string[] | no | Free-form search tags. |
| `impactTolerance` | number | no | Impact tolerance in m/s. Default `10`. |
| `assemblyPosition` | int | no | Editor sort order inside the category. Default `0`. |
| `defindex` | int | no | Persistent part id. Leave empty unless you need a specific value. |
| `model` | string | **yes** | Path to the mesh, relative to the part folder. |
| `units` | string | no | Units the mesh is authored in: `m` (default), `cm`, `mm`, `in`, `ft`. |
| `scale` | number | no | Extra multiplier on top of `units`. Default `1`. |
| `physicsModel` | string | no | Separate collision mesh. Defaults to the render mesh. |
| `icon` | string | no | Shop thumbnail (PNG/JPG). Falls back to the category icon. |
| `material` | object | no | PBR material, see below. |
| `attachments` | array | **yes** | Attachment points, at least one. |
| `cableAttachments` | array | no | Points where cables can be routed. |
| `centerOfMassAdjustment` | vector | no | Offset of the centre of mass, in metres. Default `[0, 0, 0]`. |
| `radialSnapping` | number | no | Radial symmetry step in degrees. Default `0` (off). |
| `modules` | object | no | Module config, copied to the schema verbatim. See [MODULES.md](MODULES.md). |
| `state` | object | no | Initial module state, copied verbatim. |
| `thermo` | object | no | Thermal config, copied to `RocketPartSchema.thermoConfig`. |
| `overrides` | object | no | Advanced: raw `RocketPartSchema` fields applied after baking. |

`formatVersion`, `id`, `name`, `description`, `category`, `mass`, `tags`,
`impactTolerance`, `assemblyPosition`, `defindex`, `model`, `units`, `scale`,
`physicsModel`, `icon`, `material`, `attachments`, `cableAttachments`,
`centerOfMassAdjustment`, `radialSnapping`, `modules`, `state`, `thermo` and
`overrides` are all the fields the loader understands. Unknown fields are reported in
the log and ignored, so typos are visible.

### Categories

`command`, `fuelTank`, `engine`, `control`, `coupling`, `adapter`, `structure`,
`aero`, `electricity`, `thermal`, `communication`, `instrument`, `utility`, `station`,
`cargo`, `hidden`.

### Meshes

The loader imports meshes with the game's Assimp-based importer, so `.obj`, `.fbx`,
`.glb`, `.gltf`, `.dae`, `.stl`, `.ply`, `.3ds` and `.blend` all work; OBJ is the
simplest for hand-written parts.

Conventions, identical to the stock parts:

- Metres, Y up, Z forward. Write the mesh at the part origin: attachment positions
  are measured from the prefab origin, not from the mesh bounds.
- The stock grid uses a 0.9–1.0 m footprint, with attachment planes 0.3 m thick and
  sockets 0.7 m apart. A 1 m cube with attachments at `±0.5` on Y lines up with stock
  `single` connections.
- Do not pre-scale the mesh for `units`; the importer applies `units`/`scale` for you.
- Every mesh becomes a convex collider unless `physicsModel` is given. Meshes with
  more than 2500 vertices fall back to a few box colliders that are fitted to the
  shape of the mesh (a simple clustering of its vertices).
- Meshes without drawable triangles (zero-area slivers or 2-vertex faces left over
  from degenerate polygons) are skipped with a warning, because Unity keeps no index
  buffer for them and the game's volume baker cannot bake them. If every mesh in the
  file is like that, the part fails. Loose edges (the `l` elements of an OBJ) end up
  in such a mesh — export the model without them.
- One material is applied to the whole model. Use `materials` (see below) for parts
  that need more than one colour.
- If the part has no `icon`, the loader draws a shop icon from the mesh itself, so
  every mod part is recognisable in the shop.
- `reentryModel` names a mesh that is used as the reentry shell. Without it the
  loader generates one from the model itself: the part surface pushed out by 2 % of
  its largest size and smoothed, the same kind of shell the stock parts have.

### Material

All materials are built from the game's HDRP template, so they get the correct HDRP
keywords, render queue and shadow passes without shipping a Unity project.

| Field | Type | Description |
| --- | --- | --- |
| `color` | string or vector | `"#RRGGBB"`, `[r, g, b]` (0..1) or `{"r":..,"g":..,"b":..,"a":..}`. Sets `_BaseColor`. |
| `metallic` | number | 0..1, sets `_Metallic`. |
| `smoothness` | number | 0..1, sets `_Smoothness`. |
| `albedo` | string | Base colour texture (`_BaseColorMap`). |
| `normal` | string | Normal map (`_NormalMap`), loaded as linear data. |
| `mask` | string | HDRP mask map (`_MaskMap`, metallic/AO/detail/smoothness channels). |
| `tiling` | vector2 | `[x, y]` UV tiling, also applied to `mainTextureScale`. |
| `offset` | vector2 | `[x, y]` UV offset. |
| `shader` | string | Only used when the game template material is unavailable; forces a shader name. |
| `emissive` | string or vector | Emissive colour, for glowing windows or an engine glow. |
| `emissiveIntensity` | number | Strength of the emissive colour. |
| `opacity` | number | Below 1 the part becomes transparent (canopies, lamps). |

#### Materials per node

`materials` gives single objects of the mesh their own material, for example a
white tank with a metal nozzle. The path is the node path inside the model, the
same one the animations use:

```json
"materials": [
  { "node": "model/nozzle", "color": "#2b2b30", "metallic": 0.9, "smoothness": 0.6 },
  { "node": "model/tank", "color": "#f2f2f0", "metallic": 0.1 }
]
```

Values that a node does not define are taken from the part material, so a node only
states what is different. A node can also have its own `albedo`, `normal` and
`mask` texture. The game applies one material to the whole model, so this is the
only way to get several looks out of one mesh.

Textures are loaded from the part folder at runtime and use repeat wrapping and
trilinear filtering. PNG and JPG work; anything `Texture2D.LoadImage` accepts is passed
to it directly.

### Attachments

Each attachment becomes a `single`-style connection unless `shape` says otherwise.
They are numbered from `0`; the connection id must stay stable between saves, so use
explicit `id`s if you ever reorder the array.

| Field | Type | Description |
| --- | --- | --- |
| `id` | int | Connection id, `0..65535`. Defaults to the array index. |
| `name` | string | Optional label, for your own reference. |
| `position` | vector | Centre of the connection box, relative to the prefab origin. Default `[0, 0, 0]`. |
| `direction` | string or vector | Connection normal: `up`, `down`, `left`, `right`, `forward`, `back`, or a vector. Default `up`. |
| `rotation` | vector | Euler angles in degrees. When present it replaces `direction`. |
| `shape` | string | Socket layout preset, see below. Default `single`. |
| `spacing` | number | Scales the preset socket spacing and box size. Default `1`. |
| `size` | vector | Explicit connection box size `[x, y, z]`, overriding the preset. |
| `center` | vector | Centre of the connection box relative to `position`. Default `[0, 0.1, 0]`. |
| `sockets` | vector[] | Explicit socket offsets in the attachment's local plane (Y is the normal). Overrides the preset layout. |
| `flags` | string | `none` (default), `dynamic`, `primary`, `axial`, or a combination such as `"dynamic, primary"`. An array of these names (`["dynamic", "primary"]`) is also accepted, but the string form is canonical. |

Available shape presets, copied from stock parts: `single`, `dual`, `triple`,
`triangle`, `rectangle`, `butterfly`, `hexagon`, `hexdual`, `line`, `wide`, `broad`,
`wide_quad`, `broad_quad`, `heptahedron`, `star`, `docking_small`, `docking_medium`.
`ConnectionShape` also contains `heptahedron_range_1` and `hexagon_range_1`, but those
have no preset — pass `sockets` explicitly for them.

`direction` and `sockets` work in the attachment's local frame: sockets are offsets in
the plane perpendicular to the connection normal, so `[x, 0, z]` values put the part
on the stock 0.7 m grid. When a preset and `spacing` are combined, sockets are
multiplied by `spacing` and the box size is scaled the same way.

If the shape has no preset and no `sockets`, loading fails with a message that says
so. If two attachments share an id, or an id is outside `0..65535`, loading fails.

### Cable attachments

Cables (fuel lines, struts placed by the player) can start and end at these points.
They are simple named transforms:

```json
"cableAttachments": [
  { "id": 0, "position": [0.45, 0.2, 0.45] }
]
```

### Modules and state

`modules` and `state` are copied to `RocketPartSchema.config` and
`RocketPartSchema.state` unchanged. A battery, for example:

```json
"modules": {
  "Model.ElectricityModule": { "maxAmount": 2000000 }
},
"state": {
  "Model.ElectricityModule": { "amount": 2000000 }
}
```

See [MODULES.md](MODULES.md) for every module key the stock parts use and a complete
example of each. The part editor has a component editor for this: add the module
in the **Components** section and fill in its properties instead of writing the
JSON by hand. `thermo` is copied to `RocketPartSchema.thermoConfig` the same way:

```json
"thermo": {
  "heatCapacity": 900, "conductivity": 237,
  "skinConductivity": 237, "emissivity": 0.8, "absorption": 0.85,
  "skinDensity": 2710, "maxTemperatureInt": 800, "maxTemperatureSkin": 900
}
```

Thermal values you omit fall back to the game's defaults, the same ones stock parts
get. The schema is round-tripped through the game's serializer, so every default the
game normally applies on load (thermal settings derived from `thermo`, the reentry
visual name, the default explosion effect) is applied to modded parts too. The part
editor has normal fields for the values of `thermo` (heat capacity, conductivity,
conductivity of the skin, emissivity, absorption, density of the skin, maximum
temperature inside and of the skin); only the changed values are written.

### Variants

`variants` are the alternatives a part offers in the shop: the propellant of a tank,
the mode of a decoupler and so on. The game builds the typed variants from these
objects itself, so the format is the one of the stock parts:

```json
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
  }
]
```

Known types are `contentsType`, `decouplerModule`, `passResources`, `decoupleMode`,
`controlSurface`, `electricMotor` and `heatShield`. A variant with another type is
ignored with a warning, because the game could not build it. The part editor has a
**Variants** section with a fuel preset that fills the propellant modules, and
taking a stock part apart brings its variants along.

A `contentsType` variant is the fuel of a tank. The game groups them by
`subcategory` and shows them with its own fuel icons, so the stock values are the
right ones:

| Fuel | Modules | id | subcategory |
| --- | --- | --- | --- |
| Empty | — | -2 | 1 |
| Hydrazine | `Model.N2H4Module` | 20 | 1 |
| Kerosene + O2 | `Model.KeroseneModule` + `Model.O2Module` | 5 | 2 |
| Methane + O2 | `Model.CH4Module` + `Model.O2Module` | 8 | 2 |
| Hydrogen + O2 | `Model.H2Module` + `Model.O2Module` | 2 | 2 |
| UDMH + N2O4 | `Model.UDMHModule` + `Model.N2O4Module` | -1 | 2 |
| Kerosene | `Model.KeroseneModule` | 6 | 3 |
| Methane | `Model.CH4Module` | 9 | 3 |
| Hydrogen | `Model.H2Module` | 3 | 3 |
| UDMH | `Model.UDMHModule` | 0 | 3 |
| Oxygen | `Model.O2Module` | 4 | 4 |
| N2O4 | `Model.N2O4Module` | 1 | 4 |

The mass of the oxidiser follows the fuel: kerosene 1 : 1.698, methane 1 : 1.331,
hydrogen 1 : 0.274, UDMH 1 : 1.642. The amount of the tank is about 890 kg per
cubic metre of the tank, the stock tanks use the same ratio. The `iconName` of the
variant points at the fuel icon of the game (`rocket_parts/kerosene_and_o2.png` and
so on).

### Part states and triggers

`Model.PartStateModule` gives a part states and the transitions between them. It is
what the animations react to: the game announces the trigger of a transition and the
mod moves the node.

```json
"modules": {
  "Model.PartStateModule": {
    "states": ["folded", "deployed"],
    "triggersData": [
      { "transition": { "x": 0, "y": 1 }, "trigger": "deploy" }
    ]
  }
},
"state": {
  "Model.PartStateModule": { "state": 0 }
}
```

- `states` — the names of the states in order. The first one is the state the part
  starts in; the current one is the index in the state block (`state`).
- `triggersData[].transition` — `{ "x": from, "y": to }`, the indices in `states`.
- `triggersData[].trigger` — the name of the trigger. The name is yours: the game
  only announces it. Put the same name into the `trigger` field of an animation.
- Every transition must have an entry, otherwise the game refuses the state change
  (`CanSetState` fails) — a decoupler without a `decouple` trigger does not even
  separate.

Stock parts use these names: `decouple` (decouplers), `deploy` (parachutes),
`open`/`close` (solar panels), `dock`/`undock` (docking ports),
`trigger`/`explode` (self destruction).

Something has to change the state, otherwise it stays in the first one:

| Module | Changes the state |
| --- | --- |
| `Model.DecouplerModule` | to state 1 when the part separates |
| `Model.AntennaModule` | extends and retracts the antenna (part menu) |
| `Model.DockingPortModule` | docked / undocked |
| `Model.SelfDestructionModule` | triggered / exploded |
| `Model.ParachuteModule`, `Model.PilotChuteModule` | deployed |

The part editor has a form for this: add the **Part states** component, name the
states and add the transitions (from, to and the trigger name). The trigger list of
the animations fills itself from them.

### Animations

The game only animates parts that carry a Unity `Animator` with a controller asset,
and such an asset cannot be created at runtime, so mod parts move their own nodes.
The `animations` array describes those motions. Paths point into the model, relative
to the part root (`model/<node>`) — the same paths the game uses for its own
rotators, so the visible mesh has to contain those nodes.

```json
"animations": [
  {
    "path": "model/antenna_y",
    "type": "spin",
    "axis": [0, 1, 0],
    "speed": 20
  },
  {
    "path": "model/antenna_arm",
    "type": "deploy",
    "axis": [1, 0, 0],
    "stowed": 0,
    "deployed": 90,
    "duration": 2,
    "trigger": "extend"
  }
]
```

- `spin` turns the node around `axis` with `speed` degrees per second.
- `deploy` moves the node between the `stowed` and the `deployed` angle. It plays
  when the part fires the state transition named in `trigger` (trigger names come
  from the `Model.PartStateModule` config) and moves back when the transition named
  in `foldTrigger` fires. Without a `foldTrigger` every other transition folds the
  node back. Without a trigger at all the node simply keeps the deployed pose.
- For the way back the part needs a second transition in its
  `Model.PartStateModule` (for example `deployed → folded` with the trigger
  `fold`) and something in the game that switches the state back (the antenna
  menu, the docking port, ...).
- `tint` (a colour) and `tintAmount` (0..1) darken the whole part when the same
  trigger fires, for example to show a burnt or damaged part.
- The driver is part of the prefab, so every placed instance of the part animates
  itself; the axis is interpreted in the local space of the node.

### Tracking a target

Pointing a node at a target is done by the game itself: add the
`Model.RotationTrackingModule` module and list the rotator nodes in `rotatorPaths`.
The game turns them towards the tracked target, exactly like the stock antennas.

```json
"modules": {
  "Model.RotationTrackingModule": {
    "type": "YX",
    "rotatorPaths": ["model/antenna_y", "model/antenna_pitch"],
    "limits": { "x": 0, "y": 15, "z": 0 },
    "rotationSpeed": { "x": 20, "y": 10, "z": 0 },
    "consumption": 5,
    "eceCoeff": 0.8
  }
}
```

`type` is the axis order: `Y` turns around the vertical axis, `YX` adds a second node
for the horizontal one. The editor fills this module with the **Track node** button.

### Defindex

The defindex is the persistent part id used by saved crafts. Leave it out and the
loader derives a stable one with FNV-1a over `"<packId>/<partId>"`, in the mod range
`1_000_000_000..2_000_000_000`. Stock parts stay below `222777`, so collisions are
unlikely; if one happens the part fails to load and the log asks for an explicit
`defindex`.

Do not change a part's `id` or `defindex` after publishing, and never reuse one for a
different part: existing saves would silently load the wrong part.

### overrides

Advanced escape hatch. `overrides` is merged into the serialized `RocketPartSchema`
after baking, using JSON merge semantics (arrays are replaced). `defindex`,
`prefabName` and `iconName` are protected and cannot be overridden this way.

```json
"overrides": {
  "vfxConfig": { "explosion": "explosion_medium" },
  "isDeprecated": false
}
```

A failed merge is reported in the log and ignored; it never prevents the part from
loading.

The heat model of the game radiates from `volumeData.area`, which the bake computes
as the sum of **every** triangle of the meshes. A hollow model with inner walls,
ribs or a frame hidden inside therefore gets an area several times larger than its
outside surface, radiates more than the Sun gives it and cools down even in
sunlight. Such a part takes a smaller area:

```json
"overrides": {
  "volumeData": { "area": 17.6 }
}
```

`volume` and `voxels` stay from the bake (only `area` is replaced). The editor
computes both numbers: the section **Volume and fuel** shows the baked area and the
temperature the part will settle at, and the field **Thermal area** writes this
override (`4 × silhouette`, the area of a smooth body, gives the same temperature
as the stock parts).

## The flame and the sound of an engine

The game does not build a flame from data: it takes a prefab of the engine
(`ContinuousFlame.Setup` → `CacheStore.prefabs`), copies its material and drives
the shader every frame (the throttle, the pressure, the fade of the length). The
sound comes from the audio cache (`AudioController.GetSound` →
`CacheStore.audio`). Both caches are private, so the loader puts its own objects
into them and the part names them.

The flames of an engine are the names in the `flames` list of the module
`Model.EngineEffectsModule`. A name the game knows is a flame prefab of the game
(`engine_0_flame` and the other fourteen). **A name the game does not know is a
custom flame of the part**: the loader builds it from the file
`flames/<name>.json` in the part folder and registers it in the game under that
name.

The file `flame.json` is the flame of the part itself. It is used when the list
of the engine does not name a custom flame, and it replaces the list then: the
part has exactly one flame, the one of the file. If the list names a custom
flame, the file `flame.json` is not used (the loader says so in the log and
the check section of the editor warns about it).

A part folder may carry these extra files:

| file | what it is |
|---|---|
| `flames/<name>.json` | a custom flame: the base flame, the parameters and the profile |
| `flame.json` | the flame of the part itself (it replaces the list of the flames) |
| `sound.wav` | the sound of the engine (optional, PCM 16 bit) |

```json
{
  "base": "engine_0_flame",
  "params": {
    "color": [0.6911, 0.784, 2.8729],
    "rimColor": [44.727, 10.772, 2.3417],
    "size": 2.5,
    "rimPower": 2.59,
    "flameLevel": 1.55,
    "brightness": 1,
    "intensity": 6.76,
    "lengthFade": 1,
    "blend": 1,
    "speed": 2.25,
    "pow": 1.89,
    "taper": [0, 0],
    "move": 0,
    "scroll": [1.17, 2.2],
    "flipbook": [1, 1],
    "flutter": [1, 0.1, 0.44],
    "pulse": [0.7, 0.1, 1],
    "angle": [0, 0, 1.89],
    "against": [0.248, 5.1],
    "scale": [1, 1, 1],
    "soften": [1, 0.7, 0.6],
    "noiseST": [1, 0.15, 0, 0]
  },
  "profile": [
    { "v": 0, "r": 0 },
    { "v": 0.015, "r": 0.038 },
    { "v": 0.048, "r": 0.067 },
    { "v": 0.349, "r": 0.11 },
    { "v": 0.502, "r": 0.116 },
    { "v": 0.785, "r": 0.119 },
    { "v": 1, "r": 0.12 }
  ]
}
```

`base` is the flame prefab of the game the flame is cloned from (the fifteen
`engine_*_flame` prefabs); the parameters are written on the material of that
clone and are the names of the shader, so the flame flickers, waves and reacts
to the throttle and the pressure exactly like the stock ones. Only the
parameters that are listed are changed, the rest stays as the game has it.

The colors are HDR (the rim of `engine_0_flame` is 44.7), so they are written as
the three numbers of the shader; a hex string is accepted as well.

The editor starts from the values of the chosen stock flame: they are read out
of the assets of the game into `flame-presets.js`
(`tools/part-editor/generate-flame-presets.py`, needs UnityPy). So the exported
values are the stock ones and the flame in the game looks exactly like the
flame of the game until a value is changed.

**The shape of the flame is the profile**: the game draws the flame with its
shader, which builds it out of the *desc* of the flame (`FlameDesc`): the curve
of the radius along the length (`vacuumProfileCrv` / `seaLevelProfileCrv`), the
length of the layer and its radius. The mesh of the flame prefab is only a flat
ring, the shader makes the shape. So `profile` is the curve of the radius of
the flame in **metres**: `v` is the place along the flame (0 at the nozzle, 1 at
the end) and `r` is the radius there. The editor draws that curve and the
author drags the points.

**The size of the flame** is not a material value either: `size` is the
**length of the flame in metres** (`size: 2.5` is a flame of 2.5 metres,
whatever the base flame of the game looks like). The shader draws the flame out
of the desc, and one unit of the desc is one metre (the flame of `engine_0` has
a desc of 30 units and is 3 m long in the game; its mesh is only a tube of UV
rings, its height comes from the shader), so the loader scales the length of
the layer to `size` and keeps the width from the profile. The profile of the
flame carries the width in metres, the length comes from the size.

The flame is placed at the force point of the engine, so it comes out of the
nozzle. The flames of the game hide their tip inside the engine (the offset of
`engine_0_flame` is 1.5 m, about half of its length), but that offset belongs
to the engine and not to the flame.

`lengthFade` (the parameter **Visibility**) is not the length either: it is how
much of the flame is visible, the game fades the flame out with it when the
engine stops. `scale` (the parameter **Scale in the shader**) is the scale of
the shader itself.

The loader registers the flame and the sound in the caches of the game under
the names of the part (`<prefab>_flame`, `<prefab>_sound`) and writes them into
the module `Model.EngineEffectsModule` (`flames`, `sound`). The module is
created when the part has an engine (`Model.EngineModule`), so a part with an
engine needs nothing but the files above.

### The sound of the engine

`sound` of the module is a name in the audio cache of the game: either a stock
sound (`rocket_engine_heavy` and the other thirteen) or the `sound.wav` of the
part, which the loader registers as `<prefab>_sound`. The game plays it as a
loop on the `module_sounds` prefab (`ModuleContinuousSounds` of
`EngineModuleCtrl`) and keeps its volume between 0.7 and 1
(`volumeRange` of the controller, remapped by the limited throttle), so the
engine is heard even at the minimum throttle; the loop is stopped when the
engine stops (thrust or thrust limiter zero, or the engine disabled), not when
the throttle is low.

`startSound` and `endSound` are optional, and **not a single stock engine has
them**. The game plays the start sound once at ignition, plays the stop sound
**in full** at shutdown, and postpones the fade of the loop by 0.9 of the length
of the start sound. A long loop put into both fields (the usual mistake when the
editor writes them) leaves the engine roaring after the thrust is zero, so the
loader drops a pair that is equal to each other or to `sound` itself, and a name
the game does not know; it says so in `PartAdder.log`. Leave both empty unless
you have a real short ignition/shutdown clip.

**The module needs an entry in the `state` as well.** The game creates the
modules of a part by walking its state (`RocketPart.DeserializeConfig`): a
module of the `config` without an entry in the `state` is never created, so the
flame and the sound of the engine stay missing. The stock parts have
`"Model.EngineEffectsModule": {}` in their state:

```json
"state": {
  "Model.EngineModule": { "thrustLimiter": 1 },
  "Model.EngineEffectsModule": {}
}
```

The loader adds the entry if it is missing and warns about every other module
without one; the editor writes it and the check section reports it.

The editor writes the files: the section **Flame** has the parameters, an
animated preview in the viewport and the field for the own mesh.

## Settings

An optional `PartAdder.json` next to the DLL changes the behaviour of the mod:

```json
{
  "verbose": false,
  "drawIcons": true,
  "checkDefindex": true,
  "maxTextureSize": 2048
}
```

| Setting | Meaning |
| --- | --- |
| `verbose` | Write more details into `PartAdder.log`. |
| `drawIcons` | Draw the shop icon from the mesh when the part has no `icon` file. |
| `checkDefindex` | Refuse parts whose defindex clashes with another part. |
| `maxTextureSize` | Scale textures down when they are larger than this (0 disables it). |

## Validation and errors

Loading is per part and per pack: one broken part does not stop the others. A part
fails, with a message in `PartAdder.log`, when:

- `part.json` is not valid JSON, `model` or `mass` is missing, `mass <= 0`;
- `category` is missing or unknown, or `units` is unknown;
- a required file is missing, or an optional texture is missing (warning only);
- two parts in a pack share an `id`, or two parts share a `defindex`;
- an attachment has a duplicate id, an id outside `0..65535`, an unknown shape or
  flags value, or a non-positive `spacing`;
- the mesh cannot be imported, contains no meshes, or has no drawable triangles.

Warnings only: a variant with an unknown type is ignored, a `materials` entry that
names a node that is not in the mesh does nothing, and a `reentryModel` that cannot
be imported falls back to the generated shell.

## Minimal example

```json
{
  "formatVersion": 1,
  "id": "my_cube",
  "name": "My Cube",
  "description": "A 1 m structural cube.",
  "category": "structure",
  "mass": 50,
  "model": "model.obj",
  "units": "m",
  "material": { "color": "#B9BEC4", "metallic": 0.2, "smoothness": 0.4 },
  "attachments": [
    { "id": 0, "position": [0, 0.5, 0], "direction": "up", "shape": "single" },
    { "id": 1, "position": [0, -0.5, 0], "direction": "down", "shape": "single" }
  ]
}
```
