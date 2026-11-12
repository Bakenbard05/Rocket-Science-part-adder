# PartAdder

A mod for [Rocket Science](https://store.steampowered.com/app/890520) that adds custom
parts to the game without Unity, an AssetBundle or Addressables.

You drop a folder with a mesh and a `part.json` next to the mod DLL. At game start
PartAdder builds the prefab, imports the mesh with the game's own Assimp importer,
creates an HDRP material, bakes volume, drag, colliders and centre of mass with the
game's baker, and registers the part in the shop.

- **No Unity install.** OBJ, FBX, glTF/GLB, DAE, STL, PLY and 3DS meshes are imported
  at runtime.
- **Everything about the part is data:** name, category, mass, impact tolerance,
  material, textures, icon, attachment points, module config and initial state.
- **Stock-compatible connections.** Named socket layouts (`single`, `dual`,
  `hexagon`, `star`, ...) line parts up with stock ones, with explicit `sockets` as an
  escape hatch.
- **Stable saves.** Every part gets a deterministic defindex derived from its pack and
  part id, so crafts keep working across sessions.

## Install

Copy the mod folder into the game's Workshop content folder (or subscribe to it on the
Steam Workshop):

```text
steamapps/workshop/content/890520/<item id>/
  config.json
  preview.png
  RSExtension.dll
  Parts/
```

For a local, unpublished mod the folder can also live anywhere the game scans mods.
Enable the extension in the game's mod list, then restart the game.

## Add your own parts

```text
Parts/
  MyPack/
    pack.json                 optional: pack id, name, author, enabled
    MyPart/
      part.json               required: characteristics and attachments
      model.obj               required: mesh
      icon.png                optional: shop thumbnail
```

A minimal part:

```json
{
  "id": "my_cube",
  "name": "My Cube",
  "category": "structure",
  "mass": 50,
  "model": "model.obj",
  "attachments": [
    { "id": 0, "position": [0, 0.5, 0], "direction": "up" },
    { "id": 1, "position": [0, -0.5, 0], "direction": "down" }
  ]
}
```

The full field reference, mesh conventions, material options and attachment shapes are
in [docs/PART_FORMAT.md](docs/PART_FORMAT.md). Every module key the stock parts use,
with a real example of each config, is in [docs/MODULES.md](docs/MODULES.md). Complete
`part.json` examples by category — structural block, battery, engine, command pod,
decoupler, RCS block, solar panel, tracking antenna, fuel tank — are in
[docs/EXAMPLES.md](docs/EXAMPLES.md), which
also lists what does not work yet (parachutes, engine plumes, damage models).
The example pack under `Parts/ExamplePack` contains a structural block and a working
battery.

What a part can do beyond the plain JSON:

- **Materials** — colour, metalness, smoothness, emissive colour and opacity, plus
  albedo texture, normal map and mask map with tiling and offset.
- **Own materials per node** (`materials`) — a white tank with a metal nozzle.
- **Variants** (`variants`) — the fuel picker of a tank, the mode of a decoupler.
- **Animations** (`animations`) — nodes that spin or deploy when the part changes
  its state, and a tint for a burnt part.
- **Tracking** — the game turns a node towards the tracked target itself.
- **A reentry shell** — generated from the bounds of the part, or your own mesh.
- **A shop icon** — drawn from the mesh when the part has no `icon` file.

`docs/part.schema.json` and `docs/pack.schema.json` are JSON Schemas: add
`"$schema": "../../../docs/part.schema.json"` to your `part.json` to get
autocompletion and validation in VS Code and other editors.

An optional `PartAdder.json` next to the DLL changes the behaviour of the mod
(`verbose`, `drawIcons`, `checkDefindex`, `maxTextureSize`), see
[docs/PART_FORMAT.md](docs/PART_FORMAT.md#settings).

## Part editor

`tools/part-editor` is a browser-based editor for `part.json`. It loads the mesh,
lets you drag attachments and sockets in a 3D view, applies the loader's validation
rules and exports the finished JSON. It is a static site with a vendored copy of
three.js, so there is nothing to build:

```powershell
.\tools\part-editor\serve.ps1
```

It serves on <http://localhost:8137> and opens the browser. See
[tools/part-editor/README.md](tools/part-editor/README.md) for the workflow and
limitations.

The editor is more than a JSON writer: it has a component editor for the game
modules, a variant editor for the fuel picker of a tank, a material editor with
textures and per node materials, a preview of the animations in the viewport, a
library of parts with a stacking check, and it exports a ready to install zip
(`pack.json`, the part folder with its mesh and a `preview.png`).

## Build

Requirements: .NET SDK (8 or newer) and Rocket Science installed.

```powershell
dotnet build RSExtension.csproj -c Release
```

The project references the game assemblies with absolute `HintPath`s. If the game is
not installed at `E:\SteamLibrary\steamapps\common\Rocket Science`, update those paths
in `RSExtension.csproj`. Game assemblies are not copied to the output (`Private=false`),
so `bin/Release/netstandard2.1` contains only the mod DLL, `config.json` and `Parts/`,
which makes it directly deployable.

### Deploy and package

```powershell
# copy the build into a Workshop item folder
.\scripts\deploy.ps1 -WorkshopId 1234567890

# build, deploy and create dist\PartAdder-<timestamp>.zip for uploading
.\scripts\deploy.ps1 -WorkshopId 1234567890 -Zip

# deploy anywhere else
.\scripts\deploy.ps1 -TargetDirectory "D:\mods\PartAdder"
```

The script mirrors the target folder, so files removed from the build disappear from
the mod folder too. `preview.png` is required for a Steam Workshop upload; the script
warns when it is missing.

## Troubleshooting

- **No parts in the shop.** Open `PartAdder.log` next to the DLL. It lists every part
  that loaded, every warning, and the reason each failure happened. A pack with one
  broken part still loads its other parts.
- **A part loaded but is not in the shop.** The shop is built from the part cache;
  check `%USERPROFILE%\AppData\LocalLow\unbeGames\Rocket Science\Player.log` for
  exceptions from this mod after `OnStart`.
- **Part is invisible or pink.** The material template could not be found, or the
  shader fell back to a non-HDRP shader. The log says which.
- **Part is misaligned with stock parts.** Export the mesh at the origin, in metres,
  Y up, and keep the attachment plane 0.3 m thick; see the mesh conventions in the
  part format reference.
- **Game update broke loading.** The game API is private; if `drag_cube_baker`,
  `RocketPartCache` or the baker signatures change, the log reports a version
  mismatch instead of failing silently.

## Known limitations

- One material per part.
- Modules are passed through, but modules that animate named objects inside the model
  (part states, engine effects, parachutes) need the same object hierarchy as the
  stock parts.
- The loader runs once, at game start. New parts appear after a restart.
- Legacy `partList.json` content from the old prototype is no longer loaded.

## Layout of this repository

```text
RSExtensionTemplate/
  PartRotatorExtension.cs     extension entrypoint (calls PartLoader)
  PartLoader/                 runtime loader: scan, mesh, material, prefab, bake, cache
  Parts/ExamplePack/          reference part pack
  docs/                       author documentation and JSON Schemas
  tools/part-editor/          browser-based part.json editor (no build step)
  scripts/deploy.ps1          build + deploy + zip
  config.json                 mod metadata read by the game
```
