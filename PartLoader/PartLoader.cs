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

        internal static void LoadAll()
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
            Diagnostics.Reset(logPath);

            LoadedParts = 0;
            FailedParts = 0;
            LoadedPacks = 0;

            Diagnostics.Info("PartAdder " + typeof(PartLoader).Assembly.GetName().Version + " starting");
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
            Diagnostics.Flush(LoadedPacks, LoadedParts, FailedParts);
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

            CheckUnknownKeys(raw, folderName);

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

            if (!definition.Mass.HasValue || definition.Mass.Value <= 0f)
            {
                throw new InvalidOperationException("'mass' must be a positive number");
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
                BuiltPrefab built = PrefabBuilder.Build(definition, partDirectory, material, scale, prefabKey);

                prefabRoot = built.Root;

                string iconName = IconFactory.Resolve(definition, partDirectory, pack.Id, category, cache, built.Model, material);

                // The flame and the sound of the engine: the loader puts them
                // into the caches of the game and writes their names into the
                // module of the effects, so the part.json does not have to know
                // the names of the caches.
                EngineEffects.Apply(definition, partDirectory, prefabKey);

                RocketPartSchema schema = SchemaFactory.Create(definition, built, category, defindex, prefabKey, iconName);

                WarnAboutModulesWithoutState(definition);

                PostprocessPartData postprocessData = PartPostprocessor.Bake(schema, prefabRoot, baker);
                schema = SchemaFactory.Finalize(schema, definition.Overrides);

                AddAnimationDriver(prefabRoot, definition);

                // The game creates the modules of a part by walking its state, so
                // the log of the loader can not tell whether the modules of the
                // part exist in the game. The diagnostics write it in the flight.
                if (definition.Modules != null && definition.Modules[EngineEffects.EffectsModule] != null)
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
        private static void WarnAboutModulesWithoutState(PartDefinition definition)
        {
            if (definition.Modules == null || definition.State == null)
            {
                return;
            }

            var missing = new List<string>();
            foreach (var property in definition.Modules.Properties())
            {
                if (definition.State[property.Name] == null)
                {
                    missing.Add(property.Name);
                }
            }

            if (missing.Count > 0)
            {
                Diagnostics.Warn(definition.Id + ": module(s) without an entry in the state, the game will not create them: " +
                                 string.Join(", ", missing));
            }
        }

        private static void AddAnimationDriver(GameObject prefabRoot, PartDefinition definition)
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

                Vector3 axis;
                if (!JsonHelp.TryVector3(animation.Axis, out axis) || axis.sqrMagnitude < 0.0001f)
                {
                    axis = Vector3.up;
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
                    keys = keys.ToArray()
                });
            }

            PartAnimationDriver driver = prefabRoot.AddComponent<PartAnimationDriver>();
            driver.Configure(entries);
            Diagnostics.Info(definition.Id + ": " + entries.Count + " animation(s)");
        }

        private static void CheckUnknownKeys(JObject raw, string partId)
        {
            foreach (JProperty property in raw.Properties())
            {
                if (!KnownKeys.Contains(property.Name))
                {
                    Diagnostics.Warn(partId + ": unknown field '" + property.Name + "' in part.json (ignored)");
                }
            }
        }

        private static readonly HashSet<string> KnownKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "formatVersion", "id", "name", "description", "category", "mass", "tags", "impactTolerance",
            "assemblyPosition", "defindex", "model", "units", "scale", "physicsModel", "reentryModel", "icon",
            "material", "attachments", "cableAttachments", "centerOfMassAdjustment", "radialSnapping", "modules",
            "state", "thermo", "overrides", "animations", "materials", "variants", "$schema"
        };
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
