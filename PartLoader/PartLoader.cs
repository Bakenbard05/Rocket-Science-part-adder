using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnbeGames.Model;
using UnbeGames.Services;
using UnbeGames.Support;
using Unity.Mathematics;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Scans "Parts/&lt;Pack&gt;/&lt;Part&gt;/part.json", builds prefabs at runtime,
    /// bakes physics with the game's own baker and registers the parts in the shop cache.
    /// </summary>
    internal static class PartLoader
    {
        private const string PartsFolder = "Parts";
        private const string PartFileName = "part.json";
        private const string PackFileName = "pack.json";

        private const string ReentryMaterialName = "template_reentry";

        /// <summary>
        /// The module that rotates the nozzle of an engine: the game turns the
        /// nodes listed in it (<see cref="ValidateGimbal"/>).
        /// </summary>
        private const string GimbalModule = "Model.EngineGimbalModule";

        /// <summary>
        /// The fairing and the jettison of the game read these modules without a
        /// null check (<see cref="ValidateJettisonModules"/>).
        /// </summary>
        private const string FairingModuleName = "Model.PayloadFairingModule";
        private const string JettisonModuleName = "Model.JettisonModule";
        private const string SeparatorModuleName = "Model.ResourceSeparatorModule";
        private const string PartStateModuleName = "Model.PartStateModule";


    // The effects of the RCS thrusters: the game plays the vfx and the sound of
    // this module itself (RCSModuleCtrl), the loader only has to make sure the
    // module gets its entry in the state.
    internal const string ContinuousEffectsModule = "Model.ContinuousEffectModule";



        private static Transform templatesRoot;

        // Shells that still carry the fallback material: the game's reentry shader lives in an
        // asset that is preloaded asynchronously, so it is applied later (see ApplyReentryMaterial).
        private static readonly List<GameObject> reentryShells = new List<GameObject>();
        private static Material reentryMaterial;
        private static bool reentryMaterialUnavailable;
        private static bool reentryMaterialPendingLogged;

        internal static int LoadedParts { get; private set; }
        internal static int FailedParts { get; private set; }
        internal static int LoadedPacks { get; private set; }

        /// <summary>
        /// The parts the mod has built, so a reload can take them out of the cache of
        /// the game before the new ones are built.
        /// </summary>
        private static readonly List<LoadedPart> loadedParts = new List<LoadedPart>();

        private sealed class LoadedPart
        {
            internal int Defindex;
            internal string PrefabKey;
            internal string PrefabName;
            internal string ModelKey;
            internal string ReentryKey;
            internal GameObject Prefab;
            internal GameObject Model;
            internal GameObject Reentry;
        }

        internal static void LoadAll()
        {
            LoadAll(false);
        }

        /// <summary>
        /// Builds the parts again. With <paramref name="appendLog"/> the log file keeps
        /// what it had (the reload writes its lines under the old ones).
        /// </summary>
        internal static void LoadAll(bool appendLog)
        {
            string modDirectory;
            try
            {
                modDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            }
            catch (Exception e)
            {
                Diagnostics.Reset(null);
                Diagnostics.Exception("Could not resolve the mod folder", e);
                return;
            }

            string logPath = string.IsNullOrEmpty(modDirectory) ? null : Path.Combine(modDirectory, "PartAdder.log");
            Diagnostics.Reset(logPath, appendLog);

            LoadedParts = 0;
            FailedParts = 0;
            LoadedPacks = 0;

            Diagnostics.Info("PartAdder " + typeof(PartLoader).Assembly.GetName().Version +
                             (appendLog ? " reloading the parts" : " starting"));
            Diagnostics.Info("Mod folder: " + modDirectory);

            ModSettings.Load(modDirectory);

            if (string.IsNullOrEmpty(modDirectory))
            {
                Diagnostics.Error("Could not resolve the mod folder");
                Diagnostics.Flush(0, 0, 0);
                return;
            }

            string partsDirectory = Path.Combine(modDirectory, PartsFolder);
            if (!Directory.Exists(partsDirectory))
            {
                Diagnostics.Warn("No '" + PartsFolder + "' folder next to the DLL; nothing to load");
                Diagnostics.Flush(0, 0, 0);
                return;
            }

            RocketPartCache cache = null;
            RocketPartBaker baker = null;
            try
            {
                CacheAccess.EnsureInitialized();
                cache = CacheStore.Get<RocketPartCache>();
                if (cache == null)
                {
                    Diagnostics.Error("RocketPartCache is not available; is the game fully loaded?");
                    Diagnostics.Flush(0, 0, 0);
                    return;
                }

                baker = CreateBaker(cache);
                if (baker == null)
                {
                    Diagnostics.Flush(0, 0, 0);
                    return;
                }

                var usedDefindexes = new HashSet<int>();
                foreach (RocketPartSchema schema in cache.All())
                {
                    usedDefindexes.Add(schema.defindex);
                }

                string[] packDirectories = Directory.GetDirectories(partsDirectory);
                Array.Sort(packDirectories, StringComparer.OrdinalIgnoreCase);

                foreach (string packDirectory in packDirectories)
                {
                    LoadPack(packDirectory, cache, baker, usedDefindexes);
                }
            }
            catch (Exception e)
            {
                Diagnostics.Exception("Fatal error while loading parts", e);
            }
            finally
            {
                if (baker != null)
                {
                    UnityEngine.Object.Destroy(baker);
                }
            }

            Diagnostics.Info("Loaded " + LoadedParts + " part(s) from " + LoadedPacks + " pack(s), " + FailedParts + " failure(s)");
            Diagnostics.Flush(LoadedPacks, LoadedParts, FailedParts, appendLog);
        }

        /// <summary>
        /// Takes the parts of the mod out of the cache of the game, so they can be
        /// built again (the reload of the live parts). The stock parts stay where
        /// they are.
        /// </summary>
        internal static int UnloadParts(RocketPartCache cache)
        {
            if (cache == null)
            {
                return 0;
            }

            Dictionary<int, RocketPartSchema> schemas = CacheAccess.GetSchemas(cache);
            Dictionary<int, GameObject> parts = CacheAccess.GetParts(cache);
            Dictionary<int, PostprocessPartData> postprocess = CacheAccess.GetPostprocessData(cache);

            int count = loadedParts.Count;
            for (int i = 0; i < loadedParts.Count; i++)
            {
                LoadedPart loaded = loadedParts[i];
                if (schemas != null)
                {
                    schemas.Remove(loaded.Defindex);
                }

                if (parts != null)
                {
                    parts.Remove(loaded.Defindex);
                }

                if (postprocess != null)
                {
                    postprocess.Remove(loaded.Defindex);
                }

                if (!string.IsNullOrEmpty(loaded.ModelKey))
                {
                    ModelAddressables.Unregister(loaded.ModelKey);
                }

                if (!string.IsNullOrEmpty(loaded.ReentryKey))
                {
                    ModelAddressables.Unregister(loaded.ReentryKey);
                }

                PartAnimationRegistry.Unregister(loaded.PrefabName);

                if (loaded.Prefab != null)
                {
                    UnityEngine.Object.Destroy(loaded.Prefab);
                }

                if (loaded.Model != null)
                {
                    UnityEngine.Object.Destroy(loaded.Model);
                }

                if (loaded.Reentry != null)
                {
                    UnityEngine.Object.Destroy(loaded.Reentry);
                }
            }

            loadedParts.Clear();
            reentryShells.Clear();
            return count;
        }

        /// <summary>
        /// Builds the parts of the mod again: the old ones leave the cache of the game
        /// first, so the new ones can take their place. The defindex of a part does
        /// not change (it comes from the pack and the id), so the rockets that are
        /// already flying keep their parts.
        /// </summary>
        internal static void ReloadAll()
        {
            RocketPartCache cache = CacheStore.Get<RocketPartCache>();
            if (cache == null)
            {
                Diagnostics.Error("RocketPartCache is not available; the parts cannot be reloaded");
                return;
            }

            int removed = UnloadParts(cache);
            Diagnostics.Info("Reload: " + removed + " part(s) left the cache of the game");
            LoadAll(true);
            Diagnostics.Info("Reload: done, the shop has to be opened again to show the new parts");
        }

        private static RocketPartBaker CreateBaker(RocketPartCache cache)
        {
            try
            {
                GameObject prefab = CacheStore.prefabs.Get("drag_cube_baker");
                if (prefab == null)
                {
                    Diagnostics.Error("Prefab 'drag_cube_baker' was not found; parts cannot be baked. The game version is probably unsupported.");
                    return null;
                }

                RocketPartBaker baker = Helpers.Instantiate<RocketPartBaker>(prefab);
                if (baker == null)
                {
                    Diagnostics.Error("Could not instantiate RocketPartBaker from 'drag_cube_baker'");
                    return null;
                }

                CacheAccess.SetBaker(cache, baker);
                return baker;
            }
            catch (Exception e)
            {
                Diagnostics.Exception("Could not create the part baker", e);
                return null;
            }
        }

        private static void LoadPack(string packDirectory, RocketPartCache cache, RocketPartBaker baker, HashSet<int> usedDefindexes)
        {
            try
            {
                PackDefinition pack = ReadPack(packDirectory);
                if (pack.Enabled.HasValue && !pack.Enabled.Value)
                {
                    Diagnostics.Info("Pack '" + pack.Id + "' is disabled, skipping");
                    return;
                }

                string[] partDirectories = Directory.GetDirectories(packDirectory);
                Array.Sort(partDirectories, StringComparer.OrdinalIgnoreCase);

                int loadedBefore = LoadedParts;
                var partIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                foreach (string partDirectory in partDirectories)
                {
                    string partFile = Path.Combine(partDirectory, PartFileName);
                    if (!File.Exists(partFile))
                    {
                        continue;
                    }

                    string folderName = Path.GetFileName(partDirectory);
                    try
                    {
                        if (LoadPart(partDirectory, pack, cache, baker, usedDefindexes, partIds))
                        {
                            LoadedParts++;
                        }
                        else
                        {
                            FailedParts++;
                        }
                    }
                    catch (Exception e)
                    {
                        FailedParts++;
                        Diagnostics.Exception("[" + pack.Id + "/" + folderName + "] " + e.Message, e);
                    }
                }

                if (LoadedParts > loadedBefore)
                {
                    LoadedPacks++;
                    Diagnostics.Info("Pack '" + pack.Id + "': " + (LoadedParts - loadedBefore) + " part(s) loaded");
                }
                else
                {
                    Diagnostics.Warn("Pack '" + pack.Id + "': no parts loaded");
                }
            }
            catch (Exception e)
            {
                Diagnostics.Exception("[" + Path.GetFileName(packDirectory) + "] pack failed to load", e);
            }
        }

        private static PackDefinition ReadPack(string packDirectory)
        {
            string folderName = Path.GetFileName(packDirectory);
            string configPath = Path.Combine(packDirectory, PackFileName);

            PackDefinition pack = null;
            if (File.Exists(configPath))
            {
                try
                {
                    pack = JsonConvert.DeserializeObject<PackDefinition>(File.ReadAllText(configPath));
                }
                catch (Exception e)
                {
                    Diagnostics.Warn("[" + folderName + "] pack.json is invalid, using folder name: " + e.Message);
                }
            }

            if (pack == null)
            {
                pack = new PackDefinition();
            }

            if (string.IsNullOrEmpty(pack.Id))
            {
                pack.Id = folderName;
            }

            if (string.IsNullOrEmpty(pack.Name))
            {
                pack.Name = pack.Id;
            }

            return pack;
        }

        private static bool LoadPart(
            string partDirectory,
            PackDefinition pack,
            RocketPartCache cache,
            RocketPartBaker baker,
            HashSet<int> usedDefindexes,
            HashSet<string> partIds)
        {
            string folderName = Path.GetFileName(partDirectory);
            string partFile = Path.Combine(partDirectory, PartFileName);
            string json = File.ReadAllText(partFile);

            JObject raw;
            try
            {
                raw = JObject.Parse(json);
            }
            catch (Exception e)
            {
                throw new InvalidOperationException("part.json is not valid JSON: " + e.Message, e);
            }

            // The schema of part.json is the one description of the format: the editor
            // checks the same rules, so what the editor lets through is what the loader
            // takes. The rules that need the game (the files of the part, the nodes of
            // the mesh) are checked further down.
            PartSchema.Result schemaResult = PartSchema.Validate(raw);
            for (int i = 0; i < schemaResult.Warnings.Count; i++)
            {
                Diagnostics.Warn(folderName + ": " + schemaResult.Warnings[i]);
            }

            if (schemaResult.Errors.Count > 0)
            {
                for (int i = 0; i < schemaResult.Errors.Count; i++)
                {
                    Diagnostics.Warn(folderName + ": " + schemaResult.Errors[i]);
                }

                throw new InvalidOperationException(schemaResult.Errors[0]);
            }

            var definition = JsonConvert.DeserializeObject<PartDefinition>(json);
            if (definition == null)
            {
                throw new InvalidOperationException("part.json is empty");
            }

            definition.Id = string.IsNullOrEmpty(definition.Id) ? folderName : definition.Id.Trim();
            ValidateId(definition.Id);

            if (!partIds.Add(definition.Id))
            {
                throw new InvalidOperationException("duplicate part id '" + definition.Id + "' in this pack");
            }

            if (string.IsNullOrEmpty(definition.Model))
            {
                throw new InvalidOperationException("'model' is required");
            }

            string categoryError;
            PartCategory category = SchemaFactory.ParseCategory(definition, out categoryError);
            if (categoryError != null)
            {
                throw new InvalidOperationException(categoryError);
            }

            float unitScale;
            if (!UnitScale.TryGet(definition.Units, out unitScale))
            {
                throw new InvalidOperationException("unknown 'units' value '" + definition.Units + "' (use m, cm, mm, in or ft)");
            }

            float scale = unitScale * (definition.Scale ?? 1f);
            if (scale <= 0f || float.IsNaN(scale) || float.IsInfinity(scale))
            {
                throw new InvalidOperationException("'scale' must be a positive number");
            }

            VerifyFile(partDirectory, definition.Model, "model", true);
            VerifyFile(partDirectory, definition.PhysicsModel, "physicsModel", false);
            VerifyFile(partDirectory, definition.Icon, "icon", false);
            if (definition.Material != null)
            {
                VerifyFile(partDirectory, definition.Material.Albedo, "material.albedo", false);
                VerifyFile(partDirectory, definition.Material.Normal, "material.normal", false);
                VerifyFile(partDirectory, definition.Material.Mask, "material.mask", false);
            }

            int defindex = ResolveDefindex(definition, pack, usedDefindexes);
            string prefabKey = MakePrefabKey(pack.Id, definition.Id);

            Diagnostics.Info("[" + pack.Id + "/" + definition.Id + "] loading (defindex " + defindex + ", scale " + JsonHelp.Invariant(scale) + ")");

            GameObject prefabRoot = null;
            GameObject modelTemplate = null;
            GameObject reentryTemplate = null;
            string modelKey = null;
            string reentryKey = null;
            Material material = null;
            try
            {
                material = MaterialFactory.Create(definition.Material, partDirectory, definition.Id);

                // The dynamic sockets of the part: the defindexes are checked
                // against the game's own table here, because the game reads them
                // without a check later (see DynamicSockets.Prepare). A fixed
                // connection with the "dynamic" flag is a trap and is fixed here
                // as well, so this runs before the prefab is built.
                DynamicSockets.Result sockets = DynamicSockets.Prepare(cache, definition, prefabKey);

                BuiltPrefab built = PrefabBuilder.Build(definition, partDirectory, material, scale, prefabKey);

                prefabRoot = built.Root;

                DynamicSockets.CheckPivot(sockets, built.Bounds, prefabKey);

                string iconName = IconFactory.Resolve(definition, partDirectory, pack.Id, category, cache, built.Model, material);

                // The flame and the sound of the engine: the loader puts them
                // into the caches of the game and writes their names into the
                // module of the effects, so the part.json does not have to know
                // the names of the caches.
                EngineEffects.Apply(definition, partDirectory, prefabKey);

                // The gimbal of an engine rotates the nodes of its list, so every
                // path has to name a node of the part: the game looks them up
                // without a null check.
                ValidateGimbal(definition, prefabRoot);

                // The fairing and the jettison read their modules and the
                // connection ids without a null check, so the set has to be
                // complete before the schema is built (<see
                // cref="ValidateJettisonModules"/>). It runs before the state
                // entries are filled, because it may add modules.
                ValidateJettisonModules(definition);

                FillMissingStateEntries(definition);

                RocketPartSchema schema = SchemaFactory.Create(definition, built, category, defindex, prefabKey, iconName, sockets);

                PostprocessPartData postprocessData = PartPostprocessor.Bake(schema, prefabRoot, baker);

                // A part that does not name a mass gets one from the volume of its
                // mesh: the author writes the numbers of the part, not the weight of
                // the steel it is made of.
                if (!definition.Mass.HasValue)
                {
                    schema.mass = MassFromVolume(postprocessData.volumeData.volume);
                    Diagnostics.Info(prefabKey + ": no mass in part.json, it is computed from the volume: " +
                                     JsonHelp.Invariant(postprocessData.volumeData.volume) + " m3 -> " +
                                     JsonHelp.Invariant(schema.mass) + " kg");
                }

                schema = SchemaFactory.Finalize(schema, definition.Overrides);

                AddAnimationDriver(prefabRoot, definition, schema.prefabName);

                // The game creates the modules of a part by walking its state, so
                // the log of the loader can not tell whether the modules of the
                // part exist in the game. The diagnostics write it in the flight.
                if (definition.Modules != null &&
                    (definition.Modules[EngineEffects.EffectsModule] != null ||
                     definition.Modules[ContinuousEffectsModule] != null))
                {
                    prefabRoot.AddComponent<PartDiagnostics>();
                }

                // The game loads the visible mesh from Addressables at runtime instead of using
                // a "model" child of the prefab, so the baked model becomes the addressable asset.
                modelTemplate = built.Model;
                built.Model = null;
                modelTemplate.transform.SetParent(null, false);

                modelKey = ModelAddressables.KeyFor(schema.prefabName);
                ModelAddressables.Register(modelKey, modelTemplate);
                ParkModelTemplate(modelTemplate);

                // Auto-generated reentryName ("reentry/<part>.prefab") has no bundle; without a
                // registered asset InstantiateReentry would fault. The stand-in needs a renderer
                // because the game reads currReentry.GetComponent<MeshRenderer>().material.
                reentryKey = schema.reentryName;
                if (!string.IsNullOrEmpty(reentryKey))
                {
                    // The game positions the shell at part.bounds.center, which is the center of
                    // the baked *volume*, not of the model. For sparse or dense meshes (several
                    // box colliders) the two can differ, and the shell would then hang beside its
                    // part. Anchor the shell on the same bounds the game will use.
                    Bounds partBounds = AABBExtensions.ToBounds(postprocessData.volumeData.bounds);
                    if ((partBounds.center - built.Bounds.center).sqrMagnitude > 0.0001f)
                    {
                        Diagnostics.Info(prefabKey + ": reentry shell anchored at the volume center " +
                                         JsonHelp.Invariant(partBounds.center) + " (model center " +
                                         JsonHelp.Invariant(built.Bounds.center) + ")");
                    }

                    reentryTemplate = BuildReentryTemplate(prefabKey, material, modelTemplate, partBounds, partDirectory, definition.ReentryModel);
                    ModelAddressables.Register(reentryKey, reentryTemplate);
                    ParkModelTemplate(reentryTemplate);
                }

                Register(cache, schema, prefabRoot, postprocessData);
                ParkTemplate(prefabRoot);

                loadedParts.Add(new LoadedPart
                {
                    Defindex = defindex,
                    PrefabKey = prefabKey,
                    PrefabName = schema.prefabName,
                    ModelKey = modelKey,
                    ReentryKey = reentryKey,
                    Prefab = prefabRoot,
                    Model = modelTemplate,
                    Reentry = reentryTemplate
                });

                Diagnostics.Info("[" + pack.Id + "/" + definition.Id + "] OK: " + built.MeshCount + " mesh(es), " +
                                 built.VertexCount + " vertices, " + built.AttachmentCount + " connection(s), mass " +
                                 JsonHelp.Invariant(schema.mass) + " kg");
                return true;
            }
            catch
            {
                if (modelKey != null)
                {
                    ModelAddressables.Unregister(modelKey);
                }

                if (reentryKey != null)
                {
                    ModelAddressables.Unregister(reentryKey);
                }

                if (reentryTemplate != null)
                {
                    UnityEngine.Object.Destroy(reentryTemplate);
                }

                if (modelTemplate != null)
                {
                    UnityEngine.Object.Destroy(modelTemplate);
                }

                if (prefabRoot != null)
                {
                    UnityEngine.Object.Destroy(prefabRoot);
                }

                if (material != null)
                {
                    UnityEngine.Object.Destroy(material);
                }

                throw;
            }
        }

        /// <summary>
        /// The mass of a part that does not name one: the volume of the baked mesh
        /// times the density of a light structure (1000 kg/m3). The editor uses the
        /// same rule, so a part that is measured there and written without a mass
        /// gets the same number here.
        /// </summary>
        internal const float DefaultDensity = 1000f;

        private static float MassFromVolume(float volume)
        {
            if (volume <= 0f || float.IsNaN(volume) || float.IsInfinity(volume))
            {
                return 1f;
            }

            return Mathf.Max(1f, Mathf.Round(volume * DefaultDensity));
        }

        private static void Register(RocketPartCache cache, RocketPartSchema schema, GameObject prefab, PostprocessPartData postprocessData)
        {
            Dictionary<int, RocketPartSchema> schemas = CacheAccess.GetSchemas(cache);
            Dictionary<int, GameObject> parts = CacheAccess.GetParts(cache);
            Dictionary<int, PostprocessPartData> postprocess = CacheAccess.GetPostprocessData(cache);

            if (schemas == null || parts == null || postprocess == null)
            {
                throw new InvalidOperationException("RocketPartCache containers are unavailable (game version mismatch)");
            }

            if (schemas.ContainsKey(schema.defindex))
            {
                throw new InvalidOperationException("defindex " + schema.defindex + " is already registered");
            }

            schemas.Add(schema.defindex, schema);
            parts.Add(schema.defindex, prefab);
            postprocess[schema.defindex] = postprocessData;

            try
            {
                RocketPartCache.OnPartProcessed?.Invoke(schema.prefabName);
            }
            catch (Exception e)
            {
                Diagnostics.Warn("OnPartProcessed handler failed for " + schema.prefabName + ": " + e.Message);
            }
        }

        /// <summary>
        /// Hides a registered prefab without deactivating it. The game instantiates these objects
        /// with Object.Instantiate, and a clone inherits activeSelf: deactivating the template
        /// yields invisible parts. An inactive holder keeps the template out of the scene while
        /// its own activeSelf stays true, so the clones are active.
        /// </summary>
        private static void ParkTemplate(GameObject prefab)
        {
            EnsureTemplatesRoot();
            prefab.transform.SetParent(templatesRoot, false);
            prefab.transform.localPosition = Vector3.zero;
            prefab.transform.localRotation = Quaternion.identity;
            prefab.transform.localScale = Vector3.one;
        }

        /// <summary>
        /// Parks the runtime model template the same way. Its own transform is kept as imported
        /// (the importer may bake orientation/scale into the root) because Addressables clones it
        /// with its local transform unchanged.
        /// </summary>
        private static void ParkModelTemplate(GameObject model)
        {
            EnsureTemplatesRoot();
            model.transform.SetParent(templatesRoot, false);
        }

        /// <summary>
        /// Parks the flame template of an engine. Its own transform (the offset of
        /// the flame and the size the part asked for) is kept, because the game
        /// copies the template and keeps its local transform. The template stays
        /// active: the game clones it and the clone has to run its Awake (the flame
        /// builds its mesh there), an inactive template would postpone it.
        /// </summary>
        internal static void ParkFlameTemplate(GameObject flame)
        {
            EnsureTemplatesRoot();
            flame.transform.SetParent(templatesRoot, false);
        }

        /// <summary>
        /// Builds the asset served for the auto-generated "reentry/&lt;part&gt;.prefab" key.
        /// RocketPartCtrl.InstantiateReentry() does currReentry.GetComponent&lt;MeshRenderer&gt;().material
        /// and EnableReentry() assigns that renderer, both without null checks, so the asset must
        /// carry a renderer and a material even when the part has no dedicated reentry shell.
        ///
        /// Without a "reentryModel" the game's own kind of shell is generated: a copy of the
        /// hull of the model (the stock shells are copies of their part's mesh), so a mod part
        /// does not fly into the atmosphere naked and does not look like a cone either.
        /// </summary>
        private static GameObject BuildReentryTemplate(string prefabKey, Material sourceMaterial, GameObject model, Bounds bounds, string partDirectory, string reentryModel)
        {
            GameObject reentry = null;

            if (!string.IsNullOrEmpty(reentryModel) && !string.IsNullOrEmpty(partDirectory))
            {
                string path = Path.Combine(partDirectory, reentryModel);
                if (File.Exists(path))
                {
                    try
                    {
                        reentry = MeshFactory.Import(path, sourceMaterial, 1f, prefabKey + " reentry");
                        reentry.name = prefabKey + "_reentry";
                    }
                    catch (Exception e)
                    {
                        Diagnostics.Warn(prefabKey + ": reentry model could not be imported: " + e.Message);
                        reentry = null;
                    }
                }
                else
                {
                    Diagnostics.Warn(prefabKey + ": reentry model not found: " + reentryModel);
                }
            }

            if (reentry == null)
            {
                reentry = new GameObject(prefabKey + "_reentry");
                var filter = reentry.AddComponent<MeshFilter>();
                filter.sharedMesh = CreateReentryShell(model, bounds, prefabKey);

                var renderer = reentry.AddComponent<MeshRenderer>();
                if (sourceMaterial != null)
                {
                    renderer.sharedMaterial = new Material(sourceMaterial);
                }
                MakeShellRenderer(renderer);

                // The game positions the instance at part.bounds.center (see ReentryAnchor), the
                // mesh itself is in the space of the part, so the anchor cancels that move.
                reentry.AddComponent<ReentryAnchor>();

                // The game moves the instance to part.bounds.center itself, the mesh is built
                // around that point, so the template itself stays at the origin.
                reentry.transform.position = Vector3.zero;

                reentryShells.Add(reentry);
            }
            else
            {
                // A user supplied reentry model keeps its own renderers, but it must not cast
                // shadows either: the shell is a hollow copy of the part, so its shadow lands
                // on the part itself as a dark blob (and it is invisible for most of the flight).
                MeshRenderer[] renderers = reentry.GetComponentsInChildren<MeshRenderer>(true);
                for (int i = 0; i < renderers.Length; i++)
                {
                    MakeShellRenderer(renderers[i]);
                }

                // The mesh of the author is in the space of the part, the same one the model lives
                // in, so the placement of the game is cancelled the same way as for a copy.
                reentry.AddComponent<ReentryAnchor>();
            }

            if (Layer.rocketLayer >= 0)
            {
                reentry.layer = Layer.rocketLayer;
            }

            return reentry;
        }

        /// <summary>
        /// Swaps the placeholder material of the generated shells for the game's own reentry
        /// shader (a glowing gradient), which is closer to the stock shells than the part material.
        /// The materials of the game are loaded from Addressables in the background, so this is
        /// retried until the cache is ready. Does nothing when the material is missing in this
        /// build of the game.
        /// </summary>
        internal static void ApplyReentryMaterial()
        {
            if (reentryShells.Count == 0)
            {
                return;
            }

            Material template = ObtainReentryMaterial();
            if (template == null)
            {
                return;
            }

            for (int i = 0; i < reentryShells.Count; i++)
            {
                SetShellMaterial(reentryShells[i], template);
            }

            Diagnostics.Info("Reentry shells use the game's '" + ReentryMaterialName + "' material");
            reentryShells.Clear();
        }

        /// <summary>
        /// Called from the Addressables provider right before a reentry shell is handed to the
        /// game. The prefab cache is preloaded long before a flight starts, so this is the point
        /// where the game's material is certainly available - an extension <c>Update()</c> is not
        /// guaranteed to run early enough. <see cref="RocketPartCtrl.InstantiateReentry"/> takes
        /// <c>GetComponent&lt;MeshRenderer&gt;().material</c> of the instance, so whatever this
        /// template carries becomes the part's reentry material.
        /// </summary>
        internal static void EnsureReentryMaterial(GameObject shell)
        {
            if (shell == null)
            {
                return;
            }

            Material template = ObtainReentryMaterial();
            if (template != null)
            {
                SetShellMaterial(shell, template);
            }

            var anchor = shell.GetComponentInChildren<ReentryAnchor>(true);
            Diagnostics.Info("reentry instance '" + shell.name + "': anchor=" + (anchor != null) +
                             ", position " + JsonHelp.Invariant(shell.transform.localPosition) +
                             ", active " + shell.activeSelf + ", children " + shell.transform.childCount);
        }

        private static void SetShellMaterial(GameObject shell, Material template)
        {
            if (shell == null)
            {
                return;
            }

            MeshRenderer renderer = shell.GetComponent<MeshRenderer>();
            if (renderer != null)
            {
                renderer.sharedMaterial = template;
            }
        }

        /// <summary>
        /// A reentry shell is a thin copy of the part surface that the game turns on only while
        /// the part is glowing, otherwise it is invisible (the shader fades it out). Its shadow
        /// caster would still be solid, so the shell of a mod part shows up as a dark blob on the
        /// part. Stock reentry prefabs do not cast shadows either; a pure glow does not.
        /// Everything else is left exactly like the stock prefabs (receive shadows, probes on,
        /// per-object motion vectors). The motion vectors matter: the transparent pass writes
        /// them (`_TRANSPARENT_WRITES_MOTION_VEC`), and a renderer created in code defaults to
        /// camera-only vectors, so a glowing shell that moves with the rocket leaves a smear
        /// behind the part in TAA instead of cancelling out.
        /// </summary>
        private static void MakeShellRenderer(MeshRenderer renderer)
        {
            if (renderer == null)
            {
                return;
            }

            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = true;
            renderer.motionVectorGenerationMode = UnityEngine.MotionVectorGenerationMode.Object;
            renderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.BlendProbes;
            renderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.BlendProbes;
            renderer.allowOcclusionWhenDynamic = true;
        }

        /// <summary>
        /// The game's reentry material, fetched once from the preloaded prefab cache. Returns null
        /// while the cache is still loading or when the game has no such material.
        /// </summary>
        private static Material ObtainReentryMaterial()
        {
            if (reentryMaterial != null || reentryMaterialUnavailable)
            {
                return reentryMaterial;
            }

            try
            {
                PrefabCache prefabs = CacheStore.prefabs;
                if (prefabs == null || !prefabs.isPreloaded)
                {
                    if (!reentryMaterialPendingLogged)
                    {
                        reentryMaterialPendingLogged = true;
                        Diagnostics.Info("The prefab cache is not preloaded yet; the reentry shells wait for '" +
                                         ReentryMaterialName + "'");
                    }

                    return null;
                }

                reentryMaterial = prefabs.InstantiateMaterial(ReentryMaterialName);
                if (reentryMaterial == null)
                {
                    reentryMaterialUnavailable = true;
                    Diagnostics.Warn("The game's reentry material '" + ReentryMaterialName +
                                     "' is empty; the shells keep the part material");
                }
            }
            catch (Exception e)
            {
                reentryMaterialUnavailable = true;
                Diagnostics.Warn("The game's reentry material '" + ReentryMaterialName + "' is not available (" +
                                 e.Message + "); the shells keep the part material");
            }

            return reentryMaterial;
        }

        /// <summary>
        /// The heat shell of the part. It is not a rounded hull: every stock
        /// "&lt;part&gt;_reentry" mesh is an exact copy of the visible mesh of its own part
        /// (checked against battery_0 and engine_0 - identical vertex sets), so the glow lies on
        /// the surface of the part and never sticks out of it. The loader does the same: the
        /// meshes of the model are merged into one mesh (the game reads a single renderer on the
        /// shell root), in the space of the part, and <see cref="ReentryAnchor"/> cancels the
        /// placement the game applies. Falls back to a cone when the model has no surface.
        /// </summary>
        private static Mesh CreateReentryShell(GameObject model, Bounds bounds, string prefabKey)
        {
            if (model == null)
            {
                return CreateFallbackCone(bounds);
            }

            var vertices = new List<Vector3>(4096);
            var normals = new List<Vector3>(4096);
            var uv = new List<Vector2>(4096);
            var triangles = new List<int>(8192);
            bool hasNormals = true;
            bool hasUv = true;

            // The mesh stays in the space of the part: the game moves the instance to
            // part.bounds.center and ReentryAnchor cancels that move, so the shell lies exactly
            // where the model is, whatever the origin of the model is.
            Matrix4x4 toModel = model.transform.worldToLocalMatrix;

            MeshFilter[] filters;
            try
            {
                filters = model.GetComponentsInChildren<MeshFilter>(true);
            }
            catch (Exception e)
            {
                // A broken mesh must not cost the player the whole part: degrade to the cone.
                Diagnostics.Exception(prefabKey + ": the reentry shell could not be built", e);
                return CreateFallbackCone(bounds);
            }

            for (int i = 0; i < filters.Length; i++)
            {
                MeshFilter filter = filters[i];
                Mesh source = filter.sharedMesh;
                if (source == null || source.vertexCount == 0)
                {
                    continue;
                }

                Vector3[] positions;
                int[] indices;
                Vector3[] sourceNormals;
                Vector2[] sourceUv;
                try
                {
                    positions = source.vertices;
                    indices = source.triangles;
                    sourceNormals = source.normals;
                    sourceUv = source.uv;
                }
                catch (Exception)
                {
                    continue;
                }

                bool meshNormals = sourceNormals != null && sourceNormals.Length == positions.Length;
                bool meshUv = sourceUv != null && sourceUv.Length == positions.Length;
                if (!meshNormals)
                {
                    hasNormals = false;
                }

                if (!meshUv)
                {
                    hasUv = false;
                }

                Matrix4x4 matrix = toModel * filter.transform.localToWorldMatrix;
                Matrix4x4 normalMatrix = matrix.inverse.transpose;
                int first = vertices.Count;
                for (int v = 0; v < positions.Length; v++)
                {
                    vertices.Add(matrix.MultiplyPoint3x4(positions[v]));
                    normals.Add(meshNormals ? normalMatrix.MultiplyVector(sourceNormals[v]).normalized : Vector3.up);
                    uv.Add(meshUv ? sourceUv[v] : Vector2.zero);
                }

                for (int t = 0; t < indices.Length; t++)
                {
                    triangles.Add(first + indices[t]);
                }
            }

            if (triangles.Count == 0)
            {
                Diagnostics.Warn(prefabKey + ": the model has no usable surface, the reentry shell is a cone");
                return CreateFallbackCone(bounds);
            }

            var mesh = new Mesh();
            mesh.name = prefabKey + "_reentry";
            if (vertices.Count > 65535)
            {
                // A dense model can pass the 16 bit index limit.
                mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            }

            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            if (hasNormals)
            {
                mesh.SetNormals(normals);
            }
            else
            {
                mesh.RecalculateNormals();
            }

            if (hasUv)
            {
                mesh.SetUVs(0, uv);
            }

            mesh.RecalculateBounds();

            Diagnostics.Info(prefabKey + ": reentry shell " + vertices.Count + " vertices, " +
                             (triangles.Count / 3) + " triangles, a copy of the model, bounds " +
                             JsonHelp.Invariant(mesh.bounds.center) + " / " +
                             JsonHelp.Invariant(mesh.bounds.size) + ", model at " +
                             JsonHelp.Invariant(model.transform.localPosition) + " rot " +
                             JsonHelp.Invariant(model.transform.localEulerAngles) + " scale " +
                             JsonHelp.Invariant(model.transform.localScale));
            return mesh;
        }

        /// <summary>Generates a simple capsule like shell that covers the part.</summary>
        private static Mesh CreateFallbackCone(Bounds bounds)
        {
            const int segments = 16;

            float radius = Mathf.Max(bounds.extents.x, bounds.extents.z) * 1.05f;
            float height = Mathf.Max(bounds.size.y * 1.4f, radius * 2f);
            if (radius < 0.05f)
            {
                radius = 0.05f;
            }

            var vertices = new List<Vector3>();
            var triangles = new List<int>();

            // The cone is built in the space of the part (ReentryAnchor keeps the shell there),
            // so it is centered on the bounds of the part instead of its origin.
            Vector3 center = bounds.center;

            // Top and bottom cap of the shell, then the side wall.
            vertices.Add(new Vector3(0f, height * 0.5f, 0f) + center);
            for (int i = 0; i < segments; i++)
            {
                float angle = i / (float)segments * Mathf.PI * 2f;
                vertices.Add(new Vector3(Mathf.Cos(angle) * radius, -height * 0.5f, Mathf.Sin(angle) * radius) + center);
            }

            for (int i = 0; i < segments; i++)
            {
                int next = 1 + (i + 1) % segments;
                triangles.Add(0);
                triangles.Add(next);
                triangles.Add(1 + i);
            }

            int bottom = vertices.Count;
            vertices.Add(new Vector3(0f, -height * 0.5f, 0f) + center);
            for (int i = 0; i < segments; i++)
            {
                int next = 1 + (i + 1) % segments;
                triangles.Add(bottom);
                triangles.Add(1 + i);
                triangles.Add(next);
            }

            var mesh = new Mesh();
            mesh.name = "PartAdderReentry";
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void EnsureTemplatesRoot()
        {
            if (templatesRoot == null)
            {
                var holder = new GameObject("PartAdderTemplates");
                holder.SetActive(false);
                UnityEngine.Object.DontDestroyOnLoad(holder);
                templatesRoot = holder.transform;
            }
        }

        private static int ResolveDefindex(PartDefinition definition, PackDefinition pack, HashSet<int> used)
        {
            int defindex;
            if (definition.Defindex.HasValue)
            {
                defindex = definition.Defindex.Value;
                if (defindex <= 0)
                {
                    throw new InvalidOperationException("'defindex' must be a positive number");
                }
            }
            else
            {
                defindex = DefindexAllocator.Compute(pack.Id, definition.Id);
            }

            if (!used.Add(defindex))
            {
                if (ModSettings.CheckDefindex)
                {
                    throw new InvalidOperationException("defindex " + defindex +
                                                        " collides with another part. Set an explicit unique 'defindex' in part.json");
                }

                Diagnostics.Warn("defindex " + defindex + " collides with another part, but the check is switched off");
            }

            return defindex;
        }

        private static void ValidateId(string id)
        {
            if (string.IsNullOrEmpty(id))
            {
                throw new InvalidOperationException("'id' must not be empty");
            }

            for (int i = 0; i < id.Length; i++)
            {
                char c = id[i];
                bool valid = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                             c == '_' || c == '-' || c == '.';
                if (!valid)
                {
                    throw new InvalidOperationException("'id' may only contain letters, digits, '_', '-' and '.' (got '" + id + "')");
                }
            }
        }

        private static string MakePrefabKey(string packId, string partId)
        {
            return "partadder/" + Sanitize(packId) + "/" + Sanitize(partId);
        }

        private static string Sanitize(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return "part";
            }

            var builder = new StringBuilder(value.Length);
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                bool valid = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                             c == '_' || c == '-';
                builder.Append(valid ? c : '_');
            }

            return builder.ToString();
        }

        private static void VerifyFile(string partDirectory, string relativePath, string label, bool required)
        {
            if (string.IsNullOrEmpty(relativePath))
            {
                if (required)
                {
                    throw new InvalidOperationException("'" + label + "' is required");
                }

                return;
            }

            string fullPath = Path.Combine(partDirectory, relativePath);
            if (!File.Exists(fullPath))
            {
                if (required)
                {
                    throw new InvalidOperationException("'" + label + "' file not found: " + relativePath);
                }

                Diagnostics.Warn("'" + label + "' file not found: " + relativePath);
            }
        }

        /// <summary>
        /// Adds the procedural motion driver to the part prefab. The visible mesh is
        /// instantiated by the game after the part is placed, so the driver resolves its
        /// nodes at runtime instead of at build time.
        /// </summary>
        /// <summary>
        /// The game creates the modules of a part by walking its state
        /// (RocketPart.DeserializeConfig): a module of the config without an entry
        /// in the state is never created, so the part behaves as if the module was
        /// not there at all.
        /// </summary>
        /// <summary>
        /// The gimbal of an engine turns the nodes listed in its module: the game
        /// does <c>transform.Find(path)</c> and then reads
        /// <c>chambers[i].localRotation</c> without a null check, so a path that
        /// does not name a node makes the part throw. The paths are checked
        /// against the built prefab here, the bad ones are dropped, and a gimbal
        /// without a single node is removed (the nozzle then simply stays put).
        /// </summary>
        private static void ValidateGimbal(PartDefinition definition, GameObject prefabRoot)
        {
            JObject module = definition.Modules == null ? null : definition.Modules[GimbalModule] as JObject;
            if (module == null || prefabRoot == null)
            {
                return;
            }

            var kept = new JArray();
            var paths = module["combustionChambers"] as JArray;
            if (paths != null)
            {
                for (int i = 0; i < paths.Count; i++)
                {
                    string path = paths[i].Value<string>();
                    if (string.IsNullOrEmpty(path))
                    {
                        continue;
                    }

                    if (prefabRoot.transform.Find(path) == null)
                    {
                        Diagnostics.Warn(definition.Id + ": the gimbal chamber '" + path +
                                         "' is not a node of the part (the game would throw), it is dropped");
                        continue;
                    }

                    kept.Add(path);
                }
            }

            if (kept.Count == 0)
            {
                definition.Modules.Remove(GimbalModule);
                if (definition.State != null)
                {
                    definition.State.Remove(GimbalModule);
                }

                Diagnostics.Warn(definition.Id + ": the module " + GimbalModule +
                                 " has no node to rotate, so it is removed (the nozzle will not move)");
                return;
            }

            module["combustionChambers"] = kept;

            // The game creates the modules of a part from its state, so the gimbal
            // needs its entry there (an empty object, like the stock engines).
            if (definition.State == null)
            {
                definition.State = new JObject();
            }

            if (definition.State[GimbalModule] == null)
            {
                definition.State[GimbalModule] = new JObject();
            }

            // The game turns the nozzle with (range * 2) degrees per second, and a
            // range of zero keeps it still.
            JToken range = module["range"];
            float degrees = range != null && (range.Type == JTokenType.Integer || range.Type == JTokenType.Float)
                ? range.Value<float>()
                : 0f;
            if (degrees <= 0f)
            {
                Diagnostics.Warn(definition.Id + ": the gimbal range is " + JsonHelp.Invariant(degrees) +
                                 " degrees, the nozzle will not move");
            }

            var names = new List<string>();
            for (int i = 0; i < kept.Count; i++)
            {
                names.Add(kept[i].Value<string>());
            }

            Diagnostics.Info(definition.Id + ": gimbal: range " + JsonHelp.Invariant(degrees) + " degrees, node(s) " +
                             string.Join(", ", names.ToArray()));
        }

        /// <summary>
        /// Fills every state entry the part.json forgot. The game creates the
        /// modules of a part by walking its state (RocketPart.DeserializeConfig),
        /// so a module of the config without an entry in the state is never
        /// created; and the state is read straight into the module struct
        /// without defaults, so an empty {} would make an engine limp
        /// (thrustLimiter 0) and a tank empty (amount 0). The entries therefore
        /// get the values the stock parts carry (ModuleStateDefaults, generated
        /// from the 199 stock schemas), and "amount" is taken from the maxAmount
        /// of the module config (the stock parts always carry a full tank).
        /// The author does not have to write a state at all.
        /// </summary>
        private static void FillMissingStateEntries(PartDefinition definition)
        {
            if (definition.Modules == null)
            {
                return;
            }

            if (definition.State == null)
            {
                definition.State = new JObject();
            }

            var filled = new List<string>();
            foreach (var property in definition.Modules.Properties())
            {
                if (definition.State[property.Name] != null)
                {
                    continue;
                }

                JObject state = ModuleStateDefaults.For(property.Name);
                if (state == null)
                {
                    // A module the stock parts do not use: it still needs its
                    // entry, but there are no stock values to copy.
                    state = new JObject();
                    Diagnostics.Warn(definition.Id + ": no default state is known for the module '" +
                                     property.Name + "', an empty one was filled (the values of the " +
                                     "module are the zero values now)");
                }
                else if (ModuleStateDefaults.WantsFullAmount(state))
                {
                    double maxAmount = definition.Modules[property.Name]?["maxAmount"]?.Value<double>() ?? 0.0;
                    state["amount"] = maxAmount;
                }

                definition.State[property.Name] = state;
                filled.Add(property.Name);
            }

            if (filled.Count > 0)
            {
                Diagnostics.Info(definition.Id + ": the state entries were filled automatically: " +
                                 string.Join(", ", filled));
            }
        }

        /// <summary>
        /// The fairing and the jettison of the game only work as a set of modules,
        /// and every piece of the set is read without a null check:
        ///
        /// * the simulation reads the part state of Model.PartStateModule
        ///   (isActivated/isCoupled: partState.PartState), so a part without it
        ///   throws every frame;
        /// * the decouple walks the connections of Model.ResourceSeparatorModule
        ///   (SpacecraftSplitter.Decouple, mode undock: part.GetModule
        ///   &lt;ResourceSeparatorModule&gt;().detachConnIds), so a fairing without
        ///   the separator throws at the jettison;
        /// * PayloadFairingModule.ApplyForces then reads
        ///   part.GetAttachment(resourceSeparator.detachConnId).Config, so an id
        ///   the part does not have throws inside the decouple command.
        ///
        /// The last one is the worst: the exception escapes FlightCommandBuffer
        /// .Execute before ClearAfterExecute, so the game repeats the decouple
        /// command every frame (the log fills with NullReferenceException), and
        /// every repeat rebases the vessel again — the rocket is thrown away.
        /// The loader therefore completes the set where it can and drops the
        /// jettison where it cannot: a part with a single attachment gets its
        /// separator pointed at it, a part with several loses the ids it does
        /// not have (and the fairing when none is left), and the stock state
        /// module is added when the author forgot it.
        /// </summary>
        private static void ValidateJettisonModules(PartDefinition definition)
        {
            if (definition.Modules == null)
            {
                return;
            }

            bool hasFairing = definition.Modules.GetValue(FairingModuleName) != null;
            bool hasJettison = definition.Modules.GetValue(JettisonModuleName) != null;
            if (!hasFairing && !hasJettison)
            {
                // A separator on its own only splits the resource groups; the game
                // reads its ids only when a fairing or a jettison decouples.
                return;
            }

            var attachmentIds = new List<int>();
            AttachmentDefinition[] attachments = definition.Attachments;
            if (attachments != null)
            {
                for (int i = 0; i < attachments.Length; i++)
                {
                    // The prefab builder numbers an attachment without an id by
                    // its place in the list (PrefabBuilder.BuildAttachments).
                    int id = attachments[i].Id ?? i;
                    if (!attachmentIds.Contains(id))
                    {
                        attachmentIds.Add(id);
                    }
                }
            }

            string available = attachmentIds.Count > 0
                ? string.Join(", ", attachmentIds.ConvertAll(id => id.ToString()).ToArray())
                : "none";

            if (definition.Modules.GetValue(PartStateModuleName) == null)
            {
                definition.Modules[PartStateModuleName] = new JObject
                {
                    ["states"] = new JArray("coupled", "decoupled"),
                    ["triggersData"] = new JArray(new JObject
                    {
                        ["transition"] = new JObject { ["x"] = 0, ["y"] = 1 },
                        ["trigger"] = "decouple",
                    }),
                };
                Diagnostics.Warn(definition.Id + ": the fairing/jettison has no Model.PartStateModule and the " +
                                 "game reads its part state without a null check; the stock module was added " +
                                 "(states [coupled, decoupled], the trigger 'decouple' for 0 -> 1)");
            }

            JObject separator = definition.Modules.GetValue(SeparatorModuleName) as JObject;
            if (separator == null)
            {
                if (attachmentIds.Count == 1)
                {
                    definition.Modules[SeparatorModuleName] = new JObject
                    {
                        ["detachConnIds"] = new JArray(attachmentIds[0]),
                    };
                    Diagnostics.Warn(definition.Id + ": the fairing/jettison has no Model.ResourceSeparatorModule; " +
                                     "the stock one was added and it breaks the only attachment of the part (" +
                                     attachmentIds[0] + ")");
                    return;
                }

                DropJettison(definition, available);
                return;
            }

            var kept = new List<int>();
            var dropped = new List<string>();
            JArray detach = separator["detachConnIds"] as JArray;
            if (detach != null)
            {
                for (int i = 0; i < detach.Count; i++)
                {
                    JToken token = detach[i];
                    int id;
                    try
                    {
                        id = token.Value<int>();
                    }
                    catch (Exception)
                    {
                        dropped.Add(token.ToString());
                        continue;
                    }

                    if (!attachmentIds.Contains(id))
                    {
                        dropped.Add(id.ToString());
                    }
                    else if (!kept.Contains(id))
                    {
                        kept.Add(id);
                    }
                }
            }

            if (kept.Count == 0)
            {
                if (attachmentIds.Count == 1)
                {
                    separator["detachConnIds"] = new JArray(attachmentIds[0]);
                    Diagnostics.Warn(definition.Id + ": the separator names no connection the part has (" +
                                     (dropped.Count > 0 ? string.Join(", ", dropped.ToArray()) : "none") +
                                     "); its only attachment " + attachmentIds[0] + " is used instead");
                    return;
                }

                DropJettison(definition, available);
                return;
            }

            if (dropped.Count > 0 || kept.Count != (detach?.Count ?? 0))
            {
                var array = new JArray();
                for (int i = 0; i < kept.Count; i++)
                {
                    array.Add(kept[i]);
                }

                separator["detachConnIds"] = array;
                Diagnostics.Warn(definition.Id + ": the separator names " + string.Join(", ", dropped.ToArray()) +
                                 ", which the part does not have; it now breaks " +
                                 string.Join(", ", kept.ConvertAll(id => id.ToString()).ToArray()) +
                                 " (the attachments are: " + available + ")");
            }
        }

        /// <summary>
        /// Removes the jettison of a part that cannot work: without a connection
        /// the separator may break, the game throws inside the decouple command
        /// (<see cref="ValidateJettisonModules"/>), and the exception repeats
        /// every frame. The part then flies as a plain part and nothing throws.
        /// </summary>
        private static void DropJettison(PartDefinition definition, string available)
        {
            bool removed = definition.Modules.Remove(FairingModuleName);
            removed |= definition.Modules.Remove(JettisonModuleName);
            if (definition.State != null)
            {
                definition.State.Remove(FairingModuleName);
                definition.State.Remove(JettisonModuleName);
            }

            if (removed)
            {
                Diagnostics.Warn(definition.Id + ": the fairing/jettison was removed: Model.ResourceSeparatorModule " +
                                 "needs \"detachConnIds\" naming the attachments it breaks, and this part has: " +
                                 available + ". The part loads without the jettison instead of throwing in the game");
            }
        }

        /// <summary>
        /// The driver reacts to the trigger names of the part state, and the game only
        /// announces the transitions listed in the Model.PartStateModule config. A name
        /// that is not there never fires, so the motion stays in its first pose — the
        /// usual reason a mod part "does not animate at all".
        /// </summary>
        private static void WarnAboutUnknownTrigger(PartDefinition definition, int index, string trigger)
        {
            JObject module = definition.Modules == null ? null : definition.Modules[PartStateModuleName] as JObject;
            if (module == null)
            {
                Diagnostics.Warn(definition.Id + ": animation #" + (index + 1) + ": the part has no " +
                                 PartStateModuleName + ", so no transition ever fires '" + trigger +
                                 "' and the motion does not play");
                return;
            }

            if (module["triggersData"] is JArray transitions)
            {
                for (int t = 0; t < transitions.Count; t++)
                {
                    if (transitions[t] is JObject item &&
                        string.Equals((string)item["trigger"], trigger, StringComparison.OrdinalIgnoreCase))
                    {
                        return;
                    }
                }
            }

            Diagnostics.Warn(definition.Id + ": animation #" + (index + 1) + ": no transition of " +
                             PartStateModuleName + " is named '" + trigger +
                             "', so the motion never plays; add it to \"triggersData\"");
        }

        private static void AddAnimationDriver(GameObject prefabRoot, PartDefinition definition, string prefabName)
        {
            if (definition.Animations == null || definition.Animations.Length == 0)
            {
                return;
            }

            var entries = new List<PartAnimationEntry>();
            for (int i = 0; i < definition.Animations.Length; i++)
            {
                AnimationDefinition animation = definition.Animations[i];
                if (animation == null || string.IsNullOrEmpty(animation.Path))
                {
                    throw new InvalidOperationException("animation #" + (i + 1) + ": 'path' is required");
                }

                string type = string.IsNullOrEmpty(animation.Type) ? "spin" : animation.Type.Trim().ToLowerInvariant();
                if (type != "spin" && type != "deploy" && type != "keys")
                {
                    throw new InvalidOperationException("animation #" + (i + 1) + ": unknown type '" + animation.Type +
                                                        "' (use spin, deploy or keys)");
                }

                if (!string.IsNullOrEmpty(animation.Trigger))
                {
                    WarnAboutUnknownTrigger(definition, i, animation.Trigger);
                }

                if (!string.IsNullOrEmpty(animation.FoldTrigger) &&
                    !string.Equals(animation.FoldTrigger, animation.Trigger, StringComparison.OrdinalIgnoreCase))
                {
                    WarnAboutUnknownTrigger(definition, i, animation.FoldTrigger);
                }

                Vector3 axis;
                if (!JsonHelp.TryVector3(animation.Axis, out axis) || axis.sqrMagnitude < 0.0001f)
                {
                    axis = Vector3.up;
                }

                Vector3 pivot;
                if (!JsonHelp.TryVector3(animation.Pivot, out pivot))
                {
                    pivot = Vector3.zero;
                }

                var keys = new List<AnimationKey>();
                if (animation.Keys != null)
                {
                    for (int k = 0; k < animation.Keys.Length; k++)
                    {
                        AnimationKeyDefinition key = animation.Keys[k];
                        if (key == null)
                        {
                            continue;
                        }

                        keys.Add(new AnimationKey
                        {
                            time = key.Time,
                            angle = key.Angle,
                            smooth = key.Smooth ?? true
                        });
                    }

                    keys.Sort((a, b) => a.time.CompareTo(b.time));
                }

                entries.Add(new PartAnimationEntry
                {
                    path = animation.Path.Trim(),
                    type = type,
                    axis = axis,
                    speed = animation.Speed ?? 0f,
                    stowed = animation.Stowed ?? 0f,
                    deployed = animation.Deployed ?? 0f,
                    duration = animation.Duration ?? 1f,
                    trigger = animation.Trigger,
                    foldTrigger = animation.FoldTrigger,
                    translate = animation.Translate ?? false,
                    pivot = pivot,
                    keys = keys.ToArray()
                });
            }

            for (int i = 0; i < entries.Count; i++)
            {
                PartAnimationEntry entry = entries[i];
                // The model is still a child of the prefab here (it is detached for
                // Addressables right after this), so the path can be checked against
                // the built part: a typo would otherwise only show up as a part that
                // does not move in the game.
                if (prefabRoot.transform.Find(entry.path) == null)
                {
                    Diagnostics.Warn(definition.Id + ": animation #" + (i + 1) + ": the part has no node '" +
                                     entry.path + "', so the motion will do nothing");
                }

                WarnAboutAnimationNodeConflict(definition, i, entry.path);
            }

            PartAnimationDriver driver = prefabRoot.AddComponent<PartAnimationDriver>();
            driver.Configure(entries);

            // The component a mod part is built from is created at runtime, and the
            // clones of such a prefab can come up with an empty serialized list (the
            // loader had read the animations, the part still did not move), so the
            // definitions are kept under the prefab name and the driver takes them
            // from there when its own list is empty.
            PartAnimationRegistry.Register(prefabName, entries);
            Diagnostics.Info(definition.Id + ": " + entries.Count + " animation(s)");
        }

        /// <summary>
        /// The gimbal of an engine and a motion can name the same node. The animation is
        /// applied in LateUpdate, after the controllers of the game, so it wins and the
        /// nozzle stops turning with the thrust vector: the author has to pick one.
        /// </summary>
        private static void WarnAboutAnimationNodeConflict(PartDefinition definition, int index, string path)
        {
            JObject module = definition.Modules == null ? null : definition.Modules[GimbalModule] as JObject;
            JArray chambers = module == null ? null : module["combustionChambers"] as JArray;
            if (chambers == null)
            {
                return;
            }

            for (int i = 0; i < chambers.Count; i++)
            {
                string chamber = (chambers[i].Value<string>() ?? string.Empty).Trim();
                if (string.Equals(chamber, path, StringComparison.OrdinalIgnoreCase))
                {
                    Diagnostics.Warn(definition.Id + ": animation #" + (index + 1) + " turns '" + path +
                                     "', the same node the gimbal rotates: the animation is applied last (LateUpdate), " +
                                     "so the thrust vector of the engine is not visible; remove the gimbal or point " +
                                     "the motion at another node");
                    return;
                }
            }
        }

    }

    internal static class DefindexAllocator
    {
        internal const int MinModDefindex = 1000000000;
        internal const int MaxModDefindex = 2000000000;

        internal static int Compute(string packId, string partId)
        {
            string key = (packId ?? string.Empty) + "/" + (partId ?? string.Empty);

            // FNV-1a, stable across runs and platforms.
            ulong hash = 14695981039346656037UL;
            for (int i = 0; i < key.Length; i++)
            {
                hash ^= key[i];
                hash *= 1099511628211UL;
            }

            uint range = MaxModDefindex - MinModDefindex;
            return MinModDefindex + (int)(hash % range);
        }
    }

    internal static class IconFactory
    {
        internal static string Resolve(
            PartDefinition definition,
            string partDirectory,
            string packId,
            PartCategory category,
            RocketPartCache cache,
            GameObject model,
            Material material)
        {
            if (!string.IsNullOrEmpty(definition.Icon))
            {
                string path = Path.Combine(partDirectory, definition.Icon);
                if (File.Exists(path))
                {
                    Sprite sprite = TextureFactory.LoadSprite(path);
                    if (sprite != null)
                    {
                        Dictionary<string, Sprite> sprites = GetSprites();
                        if (sprites != null)
                        {
                            string key = "partadder/" + packId + "/" + definition.Id;
                            sprites[key] = sprite;
                            return key;
                        }
                    }
                }
            }

            // No icon file: draw one from the model, so every part is recognisable in the shop.
            if (model != null && ModSettings.DrawIcons)
            {
                try
                {
                    Color color = new Color(0.78f, 0.8f, 0.84f, 1f);
                    if (material != null && material.HasProperty("_BaseColor"))
                    {
                        color = material.GetColor("_BaseColor");
                    }

                    Sprite sprite = IconRenderer.Render(model, color, 128);
                    if (sprite != null)
                    {
                        Dictionary<string, Sprite> sprites = GetSprites();
                        if (sprites != null)
                        {
                            string key = "partadder/" + packId + "/" + definition.Id;
                            sprites[key] = sprite;
                            Diagnostics.Info(definition.Id + ": shop icon drawn from the model");
                            return key;
                        }
                    }
                }
                catch (Exception e)
                {
                    Diagnostics.Warn(definition.Id + ": could not draw the shop icon: " + e.Message);
                }
            }

            string fallback = FindCategoryIcon(cache, category);
            if (string.IsNullOrEmpty(fallback))
            {
                Diagnostics.Warn(definition.Id + ": no icon and no fallback icon for category " + category);
            }

            return fallback;
        }

        private static Dictionary<string, Sprite> GetSprites()
        {
            try
            {
                return CacheAccess.GetSprites();
            }
            catch (Exception e)
            {
                Diagnostics.Warn("Sprite cache is unavailable: " + e.Message);
                return null;
            }
        }

        private static string FindCategoryIcon(RocketPartCache cache, PartCategory category)
        {
            if (cache == null)
            {
                return null;
            }

            try
            {
                foreach (RocketPartSchema schema in cache.All())
                {
                    if (schema.category == category && !string.IsNullOrEmpty(schema.iconName))
                    {
                        return schema.iconName;
                    }
                }
            }
            catch (Exception)
            {
                // Cache may be mid-load; a missing icon only affects the shop thumbnail.
            }

            return null;
        }
    }
}
