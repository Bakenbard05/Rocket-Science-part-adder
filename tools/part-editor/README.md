# PartAdder part editor

A browser-based editor for `part.json` files: load a mesh, place attachments and
sockets in a 3D view, watch the loader's validation rules, and download the JSON.

It is a static site — plain HTML, CSS and ES modules. There is no build step,
no npm, and no dependencies beyond the copy of three.js vendored in `vendor/`.

## Run

```powershell
.\serve.ps1            # http://localhost:8137/ and opens the browser
.\serve.ps1 -Port 9000
.\serve.ps1 -NoBrowser
```

`serve.ps1` is a small `HttpListener` static file server. Opening `index.html`
directly from disk (`file://`) does not work: browsers block ES module imports and
the three.js addons need HTTP.

The side panels are resizable: drag the thin separator between a panel and the
viewport, or double-click it to restore the default width. Sizes are remembered in
`localStorage`; below 1100 px wide the separators are hidden and the panels use
fixed widths.

## Workflow

1. Fill in `Id`, `Name`, `Category`, `Mass` — or press **New part**, which
   creates the skeleton of the category that is chosen in the form: the modules,
   the state and the connections that category needs (an engine gets its
   thrust, its propellants and its flame, a tank its propellants, a command pod
   its control module). Pick one of the built-in examples (**Example** dropdown →
   **Load example**) to start from a working structural block, battery, engine,
   command pod, decoupler, RCS block or solar panel. The examples mirror
   `docs/EXAMPLES.md` and come with a 1 × 1 × 1 m cube
   (`assets/example-cube.obj`), which is loaded into the preview automatically as
   `model.obj` — replace it with your own mesh before shipping the part.
2. Drop a mesh (`.obj`, `.glb`, `.gltf`, `.stl`, `.ply`, `.fbx`, `.dae`) onto the
   viewport, or use **Load mesh**. The file name is written to `model`.
   Set **Mesh units** to the unit the mesh was exported in; the preview applies
   `units × scale` exactly like the loader.
3. **Add attachment**, choose a shape and place it with the gizmo. Click the
   attachment box or a socket sphere in the viewport to select it, then drag the
   arrows. **Snap 0.1 m** rounds the gizmo to decimetres.
   **Fit to the mesh** puts the selected connection onto the far end of the mesh
   along its direction and sizes it after the silhouette of the mesh there.
4. Sockets are listed under the shape controls. Each one has a position in the
   attachment's local X/Z plane (metres before `spacing`); **Add socket** adds a
   custom one, `◎` selects it for gizmo dragging. Custom `size` and `center`
   override the preset box.
5. Cable attachment points are edited in their own list, and are shown as pink
   spheres.
6. **Download part.json** opens the browser's save dialog (Chromium), so you can pick
   the folder and the file name; other browsers just download the file.
   **Copy JSON** puts it on the clipboard.
   **Open part.json** loads an existing file, and dropping a `.json` onto the
   viewport does the same.

**Undo** and **redo** (also Ctrl+Z and Ctrl+Y) walk through the changes of the
part. The work of the session is kept as a draft in the browser, so a closed tab
does not cost it; the draft of the last session comes back when the editor is
opened again.

**Mass from the mesh** computes the mass from the volume of the mesh and the
chosen density. The same rule is in the loader: a part.json without a mass gets
1000 kg/m³ from the volume of its mesh.

## Dynamic sockets

A dynamic socket is a connection the game makes on the surface of a part itself:
the player drops a part onto the hull, and the game picks the point and the normal.
One part receives the other on its surface, so a socket always comes in two ends —
the receiving config on one part and the matching attaching config on the other.

The **Dynamic sockets** section of the right panel lists the sockets of the part:

- **Add socket** adds an entry with a stock config of the game. The dropdown groups
  the configs by role: **Receives a part on the hull** (a positive defindex, another
  part can be stuck to this one) and **Attaches to a hull** (a negative one, this
  part can be stuck to another one). Only the configs the game itself registers are
  offered; an id of an older file that the list does not know stays visible as its
  own option, and **Check** warns about it.
- The checkboxes are the shapes the socket takes. Several can be combined
  (`single, dual`) and the game creates one socket for every shape; the socket only
  connects to a fixed connection of another part with a compatible shape.
- **Pivot on the hull** (`dynamicCurrPivot`) is the point the game aims at when this
  part is placed on another one. It has to be inside the hull; **Pivot from mesh**
  puts it at the centre of the mesh, and the loader warns when it is outside.
- The `◎` button probes the hull: move the pointer over the mesh and a ghost socket
  follows the surface, turned the way the game would turn it. It is green where the
  restriction of the config allows the socket and red where it does not (a ring
  config allows a band around its axis, a side config only its direction, a cap
  config a cone). Nothing of the probe is exported.
- The sockets are also drawn on the part, on the box the game actually probes: the
  assembly collider of a mod part is a box over its mesh, so a socket can only sit
  on one of its six faces. Every face the restriction allows is painted in the
  colour of the row, a ring of the socket sits on each of them, and the pivot is
  marked with an octahedron and the axes. The eye in the row and **Show the sockets
  on the model** hide the layer; the drawing is not part of the export.

The `dynamic` flag of a fixed attachment is not offered: the game removes such a
connection when the part is detached, so the loader strips it and **Check** warns.

The status bar mirrors the loader validation: missing id/mass/model, bad
defindex, duplicate attachment ids, unknown flags/units, sockets on shapes that
need them, material values outside 0..1. Warnings (for example identical socket
positions, or a mesh that was not loaded for preview) do not block export.

The **Check** button goes further: it runs the same rules the loader runs (the
schema of `part.json` is the one description of the format, the editor reads the
same file the loader has in the DLL) and looks at the mesh of the part — faces
without area, numbers that are not numbers, meshes without normals or without
texture coordinates are the things the importer of the game stumbles over.

Attachment flags are picked with checkboxes but written to `part.json` as one
comma-separated string (`"primary, axial"`), matching the loader and
`docs/part.schema.json`; the older array form is still accepted on import.

The sections of the left panel are collapsible cards: the heading opens and
closes a section, and the editor remembers which ones are open (`localStorage`
key `partadder.editor.sections`), so a part with a lot of fields does not turn
into one long wall. The motions of the part have their own bar under the
viewport: **Play**/**Reset**, the time readout and the time slider, and the
timeline of every motion. A second click on a track adds a key, dragging a key
changes its time and angle, `▶` of a track previews that motion alone.

## Components

The **Components** section is an ECS-like editor for the modules a part carries.
Pick a module in the dropdown and press **Add**: it shows up in the list, and
clicking it opens its properties as a form (numbers, text, switches, vectors,
nested groups). Everything is written straight into `modules` and `state` of
`part.json`, and the raw JSON in **Advanced JSON** stays in sync — it is still
the way to edit anything the registry does not cover.

The registry (`components.js`) covers the stock modules of `docs/MODULES.md` with
their stock values as defaults: engine, generator, engine effects and gimbal,
battery, solar panel, cryocooler, RTG, decoupler, stage decoupler, jettison,
fairing, RCS, RCS block, command pod, cockpit, reaction wheel, control and aero
surfaces, heat shield, aero protection, docking port, wheel, landing strut,
antenna, light, instruments, probe core, parachute, pilot chute, self
destruction and more. Labels are bilingual and follow the language switch.

Fields the registry does not know are still shown as raw JSON under **Other
fields**, and a module that is not in the registry at all is listed with a
warning, so a typo in a module name shows up before you ship the part.

The **Part states** component is special: its transitions are a form (from state,
to state and the name of the trigger), because the game needs one entry for every
state change. The trigger list of the animations fills itself from these names.

## Animations

The **Animations** section moves model nodes without Unity's Animator, which the
game cannot use for mod parts (an AnimatorController cannot be created at
runtime). Load a mesh, pick one of its nodes in the dropdown and press **Add
motion**.

A motion is a **curve**: the horizontal axis is the time, the vertical one the
angle of the node (or the distance in metres when the motion slides instead of
turning). It works like the graph editor of Blender:

- **drag a point** on the curve to move its key (the time and the value),
- **click in the curve** to add a key (a click on the axes around it only
  moves the playhead — a key from the margin would land outside the window),
- **right click a point** to delete it (the Delete key does the same for the
  selected key),
- **drag in the header** of the graph to move the playhead,
- the **space** plays the motion and stops it again.

A key cannot be dragged out of the window: when the pointer goes past the top
or the bottom edge, the axis of the value grows in round steps (15° for
rotations, 0.25 m for slides — the view zooms out with the drag) and the point
rides the edge. The value follows the pointer one to one in the scale of the
moment of the grab, so the numbers cannot run away. The timeline behaves the
same way, one lane per motion.

Under the graph is the **dope sheet**: the points of the curve as a list, with
the time and the value editable. The values in the list are the same as the
points on the curve. Type into a field normally: it is applied while you type and
the field is not rebuilt until you leave it (Enter or a click elsewhere), so
decimals such as `0.05` are entered one character at a time. The value field takes
hundredths of a metre (or of a degree), and `0.05` in a translation is 5 cm along
the axis.

The **type** of a motion only says what the curve means:

- **Rotation** (`spin`) is a straight line — the slope of the line is the speed
  in degrees per second. Drag the end of the line to change it: wheels, spinning
  antennas, reaction gyros.
- **Deploy** (`deploy`) is the move from the stowed pose to the deployed one.
  Drag the two points to change the poses and the length of the motion. It
  plays when the part fires the state transition named in **State trigger** (the
  trigger names come from the `Model.PartStateModule` module) and returns when
  another transition starts — the behaviour of the stock antennas.
- **Keyframes** (`keys`) is the free curve: the points are the keys of the
  motion and the curve repeats every **Duration** seconds.

**Move instead of turn** (the checkbox on a motion) slides the node along the
axis in metres instead of rotating it: the speed is m/s, the poses and the keys
are metres — landing legs, pistons, telescopes. The node must be a separate
object of the mesh, the same rule as for a rotation.

**Pivot** (the vector field on a motion) moves the centre of the rotation: the
node turns around that point instead of its own origin — a wheel on a short
axle, a flap on the edge of a wing. The point is written in the space of the
node; `0, 0, 0` turns the node around itself, as before. A pure offset of the
node is the **Move instead of turn** checkbox.

The graph window is resizable: drag the bar under it up or down (double click
resets), the height is kept between the sessions.

**Track node** does the opposite: it fills the `Model.RotationTrackingModule`
module with the picked node, so the *game* turns it towards the tracked target
(yaw only with one node, yaw plus pitch with two), exactly like the stock
antennas.

**Preview.** The motions are played right in the viewport, with the same
transform math as the runtime driver (`base rotation × angle around the axis`):
**Play** runs the time, the slider scrubs it (0…10 s) and **Reset** returns to
the stowed pose. The ▶ button of a single motion previews only that motion, so
you can check one antenna or one hatch at a time. The preview needs the mesh to
be loaded — the node names come from it. Loading another part or mesh starts the
preview from the stowed pose; the **explode** slider spreads the view on top of
the pose of the preview instead of replacing it, so the two never add an offset
twice.

## Materials and textures

The **Mesh and material** section has the colour, metalness, smoothness, emissive
colour and opacity of the part, plus the albedo texture, normal map and mask map
with their tiling and offset. Picking a texture file previews it on the mesh right
away, so you can check the mapping before exporting. The ✕ button next to a texture
removes it again (from the part and from the preview).

**Loading a Blender export.** Select the `.obj`, its `.mtl` and the texture files
together (the file dialog accepts several files, drag & drop works too). The
editor reads the `.mtl`, puts the colours and the textures back on the model and
fills the albedo texture of the part. Unchecking **Preview part material** shows
the original Blender materials instead of the material of the part. The textures
are written into the zip of the pack export, otherwise the game cannot find them.

**Node materials** gives single objects of the mesh their own material (a white tank
with a metal nozzle): pick a node of the model, press **Add** and set its colour,
metalness, smoothness, emissive and opacity. A node can also have its own albedo
texture, normal map and mask map — the game applies one material to the whole
model, so this is the way to get several looks out of one mesh. The preview shows
the result and `part.json` gets a `materials` array. The **Pick** button of a node
texture opens the file dialog of the browser (the file is only read, it stays on
your disk).

Below the material fields the editor shows the volume of the loaded mesh and the
mass of the part, which helps with balancing.

## Variants

The **Variants** section is the fuel picker of a tank and the other alternatives a
part offers in the shop. The fuel preset fills the propellant modules of the game
(single propellants and the pairs kerosene + O2, methane + O2, hydrogen + O2,
UDMH + N2O4) with the ids, the icons and the mass ratio of the stock tanks, and
the amount follows the size of the mesh. The result is the `variants` array of
`part.json`.

## Stock parts and the exploded view

**Stock parts** takes a game part apart: pick one of the 199 stock parts and press
**Take apart**. Its category, mass, description, modules, state, variants (the fuel
picker of a tank), the static connection points (id, position, orientation, shape,
sockets, flags, box size) and the dynamic sockets (`dynamicAttachmentConfigs`,
`dynamicCurrPivot`, `radialSnapping`) become the current part, ready to be edited. The
orientation of the stock connections is a quaternion, it is converted to the Euler
angles the editor uses. The stock mesh is not part of the editor, so add your own
mesh to the folder.

The list is generated from the game's `AllParts.txt` by
`tools/part-editor/generate-stock-parts.ps1`; run it again when the game updates.

**Explode the objects** (the slider under the material fields) spreads the objects
of the mesh apart, so you can see the pieces of a model and put the attachments
and animations on the right one.

## Library, stack check and export

**Thermal** section has the heat values of the part as normal fields: heat capacity,
conductivity, conductivity of the skin, emissivity, absorption, density of the skin
and the two maximum temperatures. The values shown are the defaults of the game,
only the changed ones are written to `part.json`.

**Reentry shell** (the checkbox under the material fields) draws the shell the game
puts around the part when it enters the atmosphere. The stock shells are exact copies
of the mesh of their part, so the preview draws your mesh with a glowing material, the
same way the loader builds it for the mod parts (`CreateReentryShell` in
`PartLoader/PartLoader.cs`); a `reentryModel` replaces it with that mesh.

**Engine effects** section edits the `Model.EngineEffectsModule` of the part: the
sound of the engine, the start and stop sounds (all fourteen sounds of the game in
a dropdown) and the flame prefabs (the fifteen flame prefabs of the game). The flames
are prefabs of the game that are placed at the force point of the engine, not
objects of your mesh.

The **Flame preview** draws that flame in the viewport: at the force point of
`Model.EngineModule`, exactly where the game puts it. Its length follows the thrust
of the engine and the throttle slider, so you can see whether the nozzle sticks out
of the mesh. The sounds of the game live inside its asset bundles and cannot be
played by a browser — the sound field takes a file of your own, and the throttle
sets its volume.

Loading a part puts the preview on the flame of its engine, so the author does not
tune a flame the engine never uses: the first name of the list of
`Model.EngineEffectsModule` that the editor can show wins — a saved flame is loaded
with its own values, a stock name takes the values of that flame of the game, and a
part without a flame list keeps the flame that is open (its `flame.json`).

**Flame** section tunes the flame itself. The game never builds a flame from data:
it takes a flame prefab of the engine, copies its material and drives the shader
every frame (the throttle, the pressure, the fade of the length), so the flame
flickers, waves and reacts to the throttle exactly like the stock ones. The section
has the base flame (the fifteen flame prefabs of the game), the numbers of the
material — the names of the shader, so they are the same in the game — the length
of the flame and the field for your own mesh of the flame.

**Custom flames** are saved under a name: type a name and press **Save as new**,
the flame joins the list of the section (the library of the part, it is written to
the folder `flames` of the pack and travels with the part in the library). The
arrow button of a saved flame puts it into the list of the flames of the engine
(**Engine effects** → **Flame prefabs**), where the stock flames of the game and
your own ones are both offered. The loader builds a flame of the part from
`flames/<name>.json` and registers it in the game under that name, so the engine
uses your flame instead of the stock one.

**Open a flame file** loads a `flame.json` (of a part or of a saved flame) into
the editor, so a flame can be compared with the one in the game.

Picking a base flame fills the fields with the values that flame has in the game:
they are read out of the assets of the game into `flame-presets.js`
(`generate-flame-presets.py`, needs UnityPy), so the preview shows the stock flame
and the exported values are the stock ones until something is changed. The colors
of the game are HDR (the rim of `engine_0_flame` is 44.7), so they are kept as
the numbers of the shader and the field shows the plain colour.

The length and the width of a flame come from its geometry: the flame of a part
gets its own cone (the stock flame prefabs only give the shader) and
**Length of the flame** is that length in metres — the preview in the viewport
draws the same cone in the same size. The preview is a shader of our own (the
shader of the game cannot run in a browser), but it uses the same numbers and
the same rules, so what you see is what the flame does in the game.

**Check** runs the checks that otherwise only show up in the log of the game: the
mesh has triangles, the defindex, the modules are known to the game, the textures
are in place, the variant types are known, the attachment ids are unique, the
animations point at nodes that exist in the mesh and the flame prefabs are known.

The **Resource separator** (`detachConnIds`) of a fairing or a jettison is checked
too: the ids must be the attachments of this part, because the game reads them
without a null check and repeats the decouple command every frame when one is
missing (the log floods with `NullReferenceException` and the rocket is thrown
away). The loader completes the set — it points a separator at the only
attachment of the part, drops the ids the part does not have and removes the
jettison of a part with several attachments and no valid id — and the check
reports what it would do. A new separator starts at the attachment the part is
mounted by (the bottom one, or its only one), not at a stock number.

**Volume and fuel** measures the volume of the meshes the way the game bakes it and
compares it with the fuel the part carries. The game bakes the volume of the union of
the meshes and compares it with the contents of the fuel modules: every module adds
`maxAmount / 1000` m³, and a part whose fuel fills its own volume makes the free
volume zero, which turns the temperature of the whole rocket into NaN. The stock tanks
fill 0.75–0.82 of their baked volume, so the tool suggests 0.8 of the measured volume
as the safe capacity and warns above 0.9. The section measures the mesh by itself as
soon as it is loaded (and again when the units or the scale change), so the numbers and
the verdicts appear without pressing the button: the volume of the union, the surface
area, the enclosed volume of the separate meshes (larger when they overlap or a surface
is open) and the ratio of the current fuel; the ratio follows the `maxAmount` fields of
the components, so it updates as you edit them. The row under them repeats the heat
model of the game and says what the temperature of the part will do: the part radiates
with its whole baked area but catches sunlight only with the silhouette that faces the
Sun, so the temperature it settles on in space follows from those two areas. A mesh with
many inner walls (much more surface per m³ than a smooth sphere of the same volume)
cools even in the sun and falls towards 0 K in the shadow — the game has no heater and
no lower temperature clamp. **ft_spherite** is such a case: 38.4 m² of surface for
2.35 m³, so it settles at about 233 K.

**Thermal area** fixes that: the heat model of the game takes the area from the bake,
and the loader lets `part.json` replace it (`overrides.volumeData.area`; the baked
volume and voxels stay), so a detailed mesh can radiate like its outside surface. The
button fills in `4 × silhouette`, the area of a smooth body, which settles at the same
temperature as the stock parts; leaving the field empty keeps the baked area. With
17.6 m² the tank above settles at 283 K instead of 233 K. The fuel of the
variants is checked the same way: a fuel variant shows its own ratio in the variant
editor, picking a propellant scales the amounts down to the safe share of the volume
(the status bar says when it had to), and **Check the part** reports every variant
whose fuel reaches the volume.

The second way a part breaks the temperature of the whole rocket is a **skin heavier
than the part itself**: the game models the skin as a 2.5 mm metal sheet over the whole
area (`skinDensity × 0.0025 × area`), and when that weighs more than the part, the
internal heat mass goes negative and the temperature jobs of the game produce NaN as
soon as the part has to exchange heat at time warp. The game clamps the skin density so
the skin weighs 25 % of the mass (`ValidateAfterMerge`), and the loader repeats the
clamp after the overrides — **Check the part** warns when it fires and says the density
the flight will use. A large light fairing (23.9 m² of area at 111.6 kg) is the typical
case; the forecast row already assumed the clamp, so its numbers were always the
post-clamp ones.

**Export gallery** writes the part from six angles (front, back, left, right, top,
iso) into a zip with a `preview.png` for the Workshop page.

**Library** keeps finished parts in the browser so you can reuse them. The mesh
and the textures are saved with the part, so loading it from the library brings the
preview back. The library lives in IndexedDB, not in localStorage: the 5 MB of
localStorage are not enough for meshes and textures. Parts of an older editor
version are moved over automatically. Picking a part as the **stack partner**
compares its connections with the current part: the lateral offset of the sockets,
the distance between the connection planes and whether the directions really face
each other.

**Export pack** writes a zip with `pack.json`, a folder per part (`part.json` and
the mesh exported from the preview), the textures of every part and a
`preview.png` for the Workshop page. The section **Parts of the pack** lists the
current part and the parts of the library with checkboxes — tick the ones that
belong into the pack and export them all at once. The preview image shows the part
alone, without the markers of the editor. The mesh and the image are always taken
from the **rest pose**: the animation preview and the exploded view are editor
positions and are never written into the exported OBJ (an old export could bake a
moved node into the mesh, and every later load of that file showed the part
offset).

## Language

English and Russian; the switch is in the top bar and the choice is remembered
in `localStorage`. Texts live in `i18n.js`.

## Coordinates

The editor uses the same space as `part.json`: metres, origin at the prefab
origin, Y up. Attachments are stored as `position` plus either `direction`
(keyword or vector) or `rotation` (Euler degrees, Unity ZXY order). Socket world
position is `position + quaternion × (offset × spacing)`.

The game's importer converts the model from the source system (Blender: Y up,
-Z forward) to Unity (Y up, +Z forward) by mirroring it in X. The preview does the
same, so a part looks in the editor exactly like it does in the game and the
attachments line up with the mesh. The exported OBJ is written in the source
orientation again, because the game mirrors it once more.

## Limitations

- `.gltf` files that reference external `.bin`/textures will not resolve those
  references in the browser; pack them as `.glb` or keep the mesh in one file.
- `.fbx`/`.dae` textures are only found when they sit next to the model and the
  browser can fetch them; the preview falls back to the part material.
- The material preview is an approximation of the game's HDRP material — colour,
  metallic and smoothness only.
- Loose edges (the `l` elements of an OBJ) are removed before the preview: three.js
  would draw the whole group as a white wireframe, and the game cannot render such
  a mesh at all. The editor says how many were removed.
- The editor validates what it can see in `part.json`; the loader remains the
  source of truth (attachment placement relative to prefab bounds, module
  behaviour, defindex collisions).
- `pack.json` is not edited here.

## Files

```text
index.html      layout and form
app.js          three.js preview, gizmo, model loading, validation, JSON I/O
schema.js       the schema of part.json (docs/part.schema.json) and its validator
history.js      the undo history of the part
templates.js    the skeletons of the new parts (one per category)
anim-curve.js   the graph editor of a motion (the curve of the channel)
flame.js        the parameters of the flame of the engine and its preview shader
flame-presets.js  generated: the values of the stock flames of the game
generate-flame-presets.py  regenerates flame-presets.js from the assets of the game
examples.js     built-in part examples (mirrors docs/EXAMPLES.md)
components.js   component registry: stock modules with typed fields (mirrors docs/MODULES.md)
presets.js      socket layouts, categories, units, flags (mirrors AttachmentPresets.cs)
dynamic-presets.js  generated: the stock dynamic attachment configs and the shapes
generate-dynamic-presets.py  regenerates dynamic-presets.js from the assets of the game
stock-parts.js  generated: the 199 stock parts, to take a game part apart
i18n.js         English/Russian strings
styles.css      dark theme
serve.ps1       static file server (also serves /docs of the repository)
generate-stock-parts.ps1  regenerates stock-parts.js from the game's AllParts.txt
assets/         example-cube.obj, the 1 m preview mesh for the built-in examples
vendor/three/   three.js r170 and the addons the editor imports
```

`presets.js` is a copy of `PartLoader/AttachmentPresets.cs`; when a socket layout
changes there, update both. `dynamic-presets.js` is generated from the configs the
game registers; `PartLoader/DynamicSockets.cs` checks the same ids and shapes on the
mod side.
