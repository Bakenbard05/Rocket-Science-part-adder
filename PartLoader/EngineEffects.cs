using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// The flame and the sound of an engine.
    ///
    /// The game never builds a flame from data: it takes a prefab of the engine
    /// (ContinuousFlame.Setup -> CacheStore.prefabs.TryInstantiate), copies its
    /// material and drives the shader every frame. The sound comes from the audio
    /// cache (AudioController.GetSound -> CacheStore.audio.Get). Both caches are
    /// private, so the loader puts its own objects into them by reflection and
    /// the part.json only names them.
    ///
    /// A part folder may carry "flame.json" (the flame of the part itself),
    /// the folder "flames" (one file per custom flame of the part) and
    /// "sound.wav" (the sound of the engine). The loader turns them into flame
    /// prefabs and a sound and writes the names into the module
    /// "Model.EngineEffectsModule". The shape of a flame is its profile, not a
    /// mesh: the game draws the flame of its prefab with its own shader.
    /// </summary>
    internal static class EngineEffects
    {
        internal const string FlameFile = "flame.json";
        internal const string CustomFlamesFolder = "flames";

        /// <summary>The length of a flame in metres, when the part does not ask for one.</summary>
        private const float DefaultLength = 2.5f;

        /// <summary>
        /// One unit of the desc of the game is one metre (the flame of the part
        /// is not scaled: the shader draws it from the desc, see
        /// FlameDesc.SyncMaterial, which writes "_TotalLength"). The mesh of a
        /// flame of the game is a tube of UVs, so only the desc carries the
        /// length.
        /// </summary>
        private const float FlameUnit = 1f;

        internal const string SoundFile = "sound.wav";
        internal const string EffectsModule = "Model.EngineEffectsModule";
        internal const string EngineModule = "Model.EngineModule";

        /// <summary>
        /// Reads the flame and the sound of the part and writes the names they
        /// are registered under into the module "Model.EngineEffectsModule".
        ///
        /// The flames of the engine are the names in the list "flames" of the
        /// module. A name the game knows is a flame of the game, a name it does
        /// not know is a custom flame of the part: it is built from the file
        /// "flames/&lt;name&gt;.json" in the part folder. The file "flame.json"
        /// is the flame of the part itself: it is used when the list does not
        /// name a custom flame, and it replaces the list then.
        /// </summary>
        internal static void Apply(PartDefinition definition, string partDirectory, string prefabName)
        {
            if (definition == null || string.IsNullOrEmpty(partDirectory))
            {
                return;
            }

            string soundKey = null;

            try
            {
                string soundPath = Path.Combine(partDirectory, SoundFile);
                if (File.Exists(soundPath))
                {
                    soundKey = BuildSound(soundPath, prefabName);
                }
            }
            catch (Exception e)
            {
                Diagnostics.Warn(prefabName + ": the sound could not be built: " + e.Message);
            }

            if (soundKey == null)
            {
                // Nothing to build, but the module of the config still needs its
                // entry in the state.
                JObject existing = definition.Modules;
                if (existing == null || existing[EffectsModule] == null)
                {
                    return;
                }
            }

            JObject modules = definition.Modules;
            if (modules == null)
            {
                // Without an engine there is nothing to attach the effects to.
                if (!HasEngine(definition))
                {
                    return;
                }

                modules = new JObject();
                definition.Modules = modules;
            }

            JToken effects = modules[EffectsModule];
            if (effects == null || effects.Type != JTokenType.Object)
            {
                if (!HasEngine(definition))
                {
                    return;
                }

                effects = new JObject();
                modules[EffectsModule] = effects;
            }

            JObject config = effects as JObject;

            // The custom flames of the part: the names of the list that the
            // game does not know are built from the folder "flames".
            bool custom = BuildCustomFlames(config, partDirectory, prefabName);

            // The flame of the part itself.
            string flamePath = Path.Combine(partDirectory, FlameFile);
            if (File.Exists(flamePath))
            {
                if (custom)
                {
                    Diagnostics.Warn(prefabName + ": the flame of the part (" + FlameFile +
                                     ") is not used: the engine takes the flames of the list");
                }
                else
                {
                    try
                    {
                        string key = BuildFlame(flamePath, partDirectory, prefabName + "_flame", prefabName);
                        if (key != null)
                        {
                            config["flames"] = new JArray(key);
                        }
                    }
                    catch (Exception e)
                    {
                        Diagnostics.Warn(prefabName + ": the flame could not be built: " + e.Message);
                    }
                }
            }

            if (soundKey != null)
            {
                config["sound"] = soundKey;
            }

            // The start and the stop sounds of the engine are optional: no stock
            // engine has them. A wrong one leaves the engine roaring after the
            // thrust is zero, so they are checked here.
            SanitizeSounds(config, prefabName);

            // The game walks the state of the part and creates the modules it
            // finds there (RocketPart.DeserializeConfig): a module of the config
            // without an entry in the state is never created, so the flame and
            // the sound of the engine would be missing.
            JObject states = definition.State;
            if (states == null)
            {
                states = new JObject();
                definition.State = states;
            }

            if (states[EffectsModule] == null)
            {
                states[EffectsModule] = new JObject();
            }

            var flames = config["flames"] as JArray;
            var names = new List<string>();
            if (flames != null)
            {
                for (int i = 0; i < flames.Count; i++)
                {
                    names.Add(flames[i].Value<string>());
                }
            }

            Diagnostics.Info(prefabName + ": effects module: flames=" +
                             (names.Count > 0 ? string.Join(",", names.ToArray()) : "-") +
                             ", sound=" + (config["sound"]?.Value<string>() ?? "-") +
                             ", start=" + (config["startSound"]?.Value<string>() ?? "-") +
                             ", end=" + (config["endSound"]?.Value<string>() ?? "-"));
        }

        /// <summary>
        /// The start and the stop sounds of the engine are optional: not a single
        /// stock engine has them. A wrong one is worse than nothing: the game
        /// plays the stop sound in full when the engine shuts down and postpones
        /// the fade of the loop by 0.9 of the start sound, so a loop set for both
        /// (or for the start) leaves the engine roaring after the thrust is zero.
        /// The loader keeps them only when the game knows them, when they differ
        /// from the loop of the engine and from each other.
        /// </summary>
        private static void SanitizeSounds(JObject config, string prefabName)
        {
            string loop = config["sound"]?.Value<string>();
            string start = config["startSound"]?.Value<string>();
            string end = config["endSound"]?.Value<string>();

            // The same clip for the ignition and for the shutdown is what the
            // editor writes when the author does not pick the sounds: the game
            // then plays that clip in full after the engine stops.
            if (!string.IsNullOrEmpty(start) && start == end)
            {
                Diagnostics.Warn(prefabName + ": the same sound '" + start +
                                 "' is used for starting and stopping the engine; the game would play it in full after shutdown, so both are dropped (the sound of the engine is '" + (loop ?? "-") + "')");
                config.Remove("startSound");
                config.Remove("endSound");
                return;
            }

            DropSound(config, "startSound", loop, prefabName);
            DropSound(config, "endSound", loop, prefabName);
        }

        /// <summary>
        /// Drops one optional sound of the engine when it is empty, when it is the
        /// loop of the engine itself or when the game does not know it.
        /// </summary>
        private static void DropSound(JObject config, string field, string loop, string prefabName)
        {
            string name = config[field]?.Value<string>();
            if (string.IsNullOrEmpty(name))
            {
                config.Remove(field);
                return;
            }

            if (name == loop)
            {
                Diagnostics.Warn(prefabName + ": " + field + " '" + name +
                                 "' is the sound of the engine itself, so it is dropped (the loop would play on top of itself)");
                config.Remove(field);
                return;
            }

            bool? known = CacheAccess.HasSound(name);
            if (known == false)
            {
                Diagnostics.Warn(prefabName + ": " + field + " '" + name +
                                 "' is not known to the game, so it is dropped (the engine would stay silent when it plays)");
                config.Remove(field);
            }
        }

        /// <summary>
        /// Builds the flames of the part that the game does not know: they are the
        /// custom flames of the editor, one file per flame in the folder "flames".
        /// It says if the list of the engine names a custom flame.
        /// </summary>
        private static bool BuildCustomFlames(JObject config, string partDirectory, string prefabName)
        {
            JToken token = config["flames"];
            var names = token as JArray;
            if (names == null)
            {
                return false;
            }

            bool custom = false;
            for (int i = 0; i < names.Count; i++)
            {
                string name = names[i].Value<string>();
                if (string.IsNullOrEmpty(name))
                {
                    continue;
                }

                GameObject known;
                if (CacheAccess.TryGetPrefab(name, out known))
                {
                    // A flame of the game, nothing to build.
                    continue;
                }

                custom = true;

                string path = Path.Combine(partDirectory, CustomFlamesFolder, name + ".json");
                if (!File.Exists(path))
                {
                    Diagnostics.Warn(prefabName + ": the flame '" + name + "' is not known to the game and there is no file " +
                                     CustomFlamesFolder + "/" + name + ".json");
                    continue;
                }

                try
                {
                    BuildFlame(path, partDirectory, name, prefabName);
                }
                catch (Exception e)
                {
                    Diagnostics.Warn(prefabName + ": the flame '" + name + "' could not be built: " + e.Message);
                }
            }

            return custom;
        }

        private static bool HasEngine(PartDefinition definition)
        {
            return definition.Modules != null && definition.Modules[EngineModule] != null;
        }

        /// <summary>
        /// Builds the flame of a part: a copy of the prefab of the game with
        /// the desc of the part (the profile of the flame, its length and the
        /// parameters of its material). The game draws the flame with its own
        /// shader, so the shape of the flame is the curve of the radius along
        /// its length and nothing else.
        /// </summary>
        private static string BuildFlame(string flamePath, string partDirectory, string key, string prefabName)
        {
            FlameConfig config = ParseFlameConfig(flamePath);
            if (config == null || string.IsNullOrEmpty(config.Base))
            {
                Diagnostics.Warn(prefabName + ": " + flamePath + " has no base flame");
                return null;
            }

            if (!CacheAccess.TryGetPrefab(config.Base, out GameObject source) || source == null)
            {
                Diagnostics.Warn(prefabName + ": the flame prefab '" + config.Base + "' is not known to the game");
                return null;
            }

            if (!string.IsNullOrEmpty(config.Mesh))
            {
                // The game draws the flame with its shader: the shape is the
                // profile, the mesh of the flame is a flat ring.
                Diagnostics.Warn(prefabName + ": the flame has no own mesh any more, its shape is the profile");
            }

            Renderer sourceRenderer = source.GetComponent<Renderer>();
            if (sourceRenderer == null || sourceRenderer.sharedMaterial == null)
            {
                // ContinuousFlame.Setup reads the renderer of the root of the
                // prefab without a null check.
                Diagnostics.Warn(prefabName + ": the flame '" + config.Base + "' has no material");
                return null;
            }

            // The clone of the prefab of the game. Its mesh is the cone of the
            // assets (the game never builds it: the shape comes from the
            // shader), so the clone gets its own copy of it.
            GameObject flame = UnityEngine.Object.Instantiate(source);
            flame.name = prefabName + "_flame";

            Material material = new Material(sourceRenderer.sharedMaterial);

            FlameDescProxy desc = FlameDescProxy.From(flame, out string reason);
            if (desc == null)
            {
                Diagnostics.Warn(prefabName + ": the flame '" + config.Base + "' has no desc (" + reason + ")");
                UnityEngine.Object.Destroy(flame);
                return null;
            }

            // The length of the flame in metres. The shader of the game draws
            // the flame from the description: the mesh of the prefab is only a
            // tube of UVs (0..1 along the flame), so the length comes from the
            // layer of the desc ("_TotalLength" of the material, see
            // FlameDesc.SyncMaterial) and the scale of the prefab stays 1.
            float size = ReadSize(config);
            float stockLength = desc.LayerLength(0);
            float factor = stockLength > 0.01f ? size / stockLength : 1f;

            // The profile of the part: the curve of the radius along the flame
            // (a factor of the radius of the layer) and the radius itself. The
            // desc counts in metres, the same units the preview of the editor
            // uses.
            float radius = 0f;
            if (config.Profile != null && config.Profile.Count >= 2)
            {
                radius = ProfileRadius(config.Profile);
            }

            // Every layer of the desc keeps its proportions: the place where it
            // sits and its length follow the size of the flame, its radius
            // follows the profile of the part (the inner cones of the flame of
            // the game stay inside the flame of the part).
            float stockRadius = desc.LayerRadius(0);
            float radiusFactor = radius > 0f && stockRadius > 0.0001f ? radius / stockRadius : factor;
            desc.ScaleLayers(factor, radiusFactor);

            if (radius > 0f)
            {
                desc.SetProfile(0, BuildProfile(config.Profile), radius);
            }

            // The parameters of the part go into the desc of the game: it writes
            // them onto the material every time the flame syncs, so they would
            // be lost if they were only on the material.
            desc.SetMaterial(material);
            desc.ApplyParameters(config.Params);
            desc.Sync();

            // The parameters the desc does not know (the falloff of the shader).
            ApplyParameters(material, config);

            // The bounds of the flame: the shader moves the vertices, Unity
            // culls the renderer by the bounds of the mesh, so they are the
            // size of the flame (the game's own builder does the same in
            // FlameBuilder.SyncMaterial). The mesh of the flame gets its own
            // copy, so the flames of the game keep their bounds.
            SetFlameBounds(flame, size, radius);

            // The tip of the flame sits exactly at the force point, so the
            // flame comes out of the nozzle. The flames of the game hide their
            // tip inside the engine (their offset is about half of the length
            // of the flame), but that offset belongs to the engine of the game
            // and not to the flame, and the preview of the editor draws the
            // flame at the force point.
            flame.transform.localScale = Vector3.one;
            flame.transform.localPosition = Vector3.zero;

            Renderer renderer = flame.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;

            Diagnostics.Info(prefabName + ": flame '" + config.Base + "' is " +
                             JsonHelp.Invariant(size) + " m long (the flame of the game is " +
                             JsonHelp.Invariant(stockLength * FlameUnit) + " m, the scale of the desc is " +
                             JsonHelp.Invariant(factor) + ", at the force point)" +
                             DescribeFlame(flame, material));

            // The registered clone is only a template: the game copies it for
            // every engine and hides the copy until the engine runs. It is parked
            // out of sight, but it stays active: the copy has to run its Awake
            // (the flame of the game builds its mesh there).
            PartLoader.ParkFlameTemplate(flame);

            if (!CacheAccess.TrySetPrefab(key, flame))
            {
                Diagnostics.Warn(prefabName + ": the flame '" + key + "' could not be registered in the game");
                UnityEngine.Object.Destroy(flame);
                return null;
            }

            Diagnostics.Info(prefabName + ": flame '" + config.Base + "' registered as '" + key + "'");
            return key;
        }

        /// <summary>
        /// Reads a wave file and registers it in the audio cache of the game.
        /// </summary>
        private static string BuildSound(string soundPath, string prefabName)
        {
            AudioClip clip = WaveReader.Read(soundPath);
            if (clip == null)
            {
                Diagnostics.Warn(prefabName + ": the sound file could not be read");
                return null;
            }

            string key = prefabName.Replace(".prefab", string.Empty) + "_sound";
            if (!CacheAccess.TrySetSound(key, clip))
            {
                Diagnostics.Warn(prefabName + ": the sound could not be registered in the game");
                UnityEngine.Object.Destroy(clip);
                return null;
            }

            Diagnostics.Info(prefabName + ": sound registered as '" + key + "'");
            return key;
        }

        private static FlameConfig ParseFlameConfig(string path)
        {
            string text = File.ReadAllText(path);
            return JsonConvert.DeserializeObject<FlameConfig>(text);
        }

        /// <summary>
        /// Describes the flame for the log: the mesh, the material and the
        /// textures. The flame of the game is a procedural one, so this is the
        /// only way to see what the game really got.
        /// </summary>
        private static string DescribeFlame(GameObject flame, Material material)
        {
            var text = new System.Text.StringBuilder();
            text.Append(", mesh ");

            MeshFilter filter = flame.GetComponentInChildren<MeshFilter>(true);
            Mesh mesh = filter != null ? filter.sharedMesh : null;
            if (mesh == null)
            {
                text.Append("none");
            }
            else
            {
                int vertices = 0;
                try
                {
                    vertices = mesh.vertexCount;
                }
                catch (Exception)
                {
                }

                text.Append(vertices).Append(" vertices, bounds ").Append(mesh.bounds.size.ToString("0.00"));
            }

            text.Append(", material ");
            if (material == null)
            {
                text.Append("none");
            }
            else
            {
                text.Append(material.shader != null ? material.shader.name : "no shader");
                text.Append(", color ").Append(material.GetColor("_Color").ToString("0.00"));
                text.Append(", intensity ").Append(material.GetFloat("_Intensity").ToString("0.00"));
                text.Append(", texture ").Append(material.GetTexture("_ColorsTex") != null ? "ok" : "missing");
            }

            return text.ToString();
        }

        /// <summary>
        /// The size of the flame: the scale of the flame prefab. Zero or missing
        /// means the size of the stock flame of the game.
        /// </summary>
        private static float ReadSize(FlameConfig config)
        {
            if (config.Params == null)
            {
                return DefaultLength;
            }

            JToken token;
            if (!config.Params.TryGetValue("size", out token) || token == null)
            {
                return DefaultLength;
            }

            try
            {
                return Mathf.Clamp(token.Value<float>(), 0.1f, 50f);
            }
            catch (Exception)
            {
                return DefaultLength;
            }
        }

        /// <summary>
        /// The widest point of the profile: the radius of the flame in metres.
        /// </summary>
        private static float ProfileRadius(List<ProfilePoint> points)
        {
            float widest = 0f;
            for (int i = 0; i < points.Count; i++)
            {
                widest = Mathf.Max(widest, points[i].R);
            }

            return widest > 0.0001f ? widest : 0.1f;
        }

        /// <summary>
        /// The curve of the radius along the flame: the profile of the part.
        /// The values are in metres and a unit of the desc of the game is a
        /// metre as well, so the curve is normalized and the radius of the
        /// layer carries the width of the part.
        /// </summary>
        private static AnimationCurve BuildProfile(List<ProfilePoint> points)
        {
            var sorted = new List<ProfilePoint>(points);
            sorted.Sort((a, b) => a.V.CompareTo(b.V));

            float widest = 0f;
            for (int i = 0; i < sorted.Count; i++)
            {
                widest = Mathf.Max(widest, sorted[i].R);
            }

            if (widest <= 0.0001f)
            {
                widest = 1f;
            }

            var keys = new Keyframe[sorted.Count];
            for (int i = 0; i < sorted.Count; i++)
            {
                keys[i] = new Keyframe(sorted[i].V, sorted[i].R / widest);
            }

            // The slope of the neighbours, so the curve is smooth like the
            // curves of the game.
            for (int i = 0; i < keys.Length; i++)
            {
                int before = i > 0 ? i - 1 : i;
                int after = i < keys.Length - 1 ? i + 1 : i;
                float span = keys[after].time - keys[before].time;
                float slope = span > 0.0001f ? (keys[after].value - keys[before].value) / span : 0f;
                keys[i].inTangent = slope;
                keys[i].outTangent = slope;
            }

            return new AnimationCurve(keys);
        }

        /// <summary>
        /// The bounds of the flame: the shader moves the vertices of the mesh
        /// (the mesh of the prefab is a tube of UVs), so Unity has to know how
        /// long and how wide the flame is, otherwise the renderer is culled
        /// while it is on screen. The game's own builder does the same in
        /// FlameBuilder.SyncMaterial. The mesh gets its own copy, so the flames
        /// of the game keep their bounds.
        /// </summary>
        private static void SetFlameBounds(GameObject flame, float length, float radius)
        {
            MeshFilter filter = flame.GetComponent<MeshFilter>();
            if (filter == null || filter.sharedMesh == null)
            {
                return;
            }

            Mesh mesh = UnityEngine.Object.Instantiate(filter.sharedMesh);
            filter.sharedMesh = mesh;

            Bounds bounds = mesh.bounds;
            float width = Mathf.Max(bounds.size.x, radius * 2f);
            float depth = Mathf.Max(bounds.size.z, radius * 2f);
            mesh.bounds = new Bounds(
                new Vector3(bounds.center.x, -length / 2f, bounds.center.z),
                new Vector3(width, length, depth));
        }

        /// <summary>
        /// The desc of a flame of the game (FlameDesc): the profile of the
        /// flame, the length of its layers and the parameters of its material.
        /// The game keeps the desc private, so the loader works with it by
        /// reflection.
        /// </summary>
        private sealed class FlameDescProxy
        {
            /// <summary>The textures the desc bakes for itself.</summary>
            private static readonly string[] TextureFields =
            {
                "geomTexture",
                "colorsTexture",
                "deformsTexture",
                "visualsTexture",
                "submeshParamTexture"
            };

            /// <summary>The parameters of the material that are plain numbers.</summary>
            private static readonly string[] FloatParams =
            {
                "rimPower",
                "flameLevel",
                "brightness",
                "intensity",
                "lengthFade",
                "blend",
                "speed",
                "move",
                "pressure",
                "throttle",
                "rotation"
            };

            /// <summary>The parameters of the material that are vectors.</summary>
            private static readonly KeyValuePair<string, int>[] VectorParams =
            {
                new KeyValuePair<string, int>("soften", 3),
                new KeyValuePair<string, int>("noiseST", 4),
                new KeyValuePair<string, int>("maskST", 4),
                new KeyValuePair<string, int>("flipbook", 2),
                new KeyValuePair<string, int>("scroll", 2),
                new KeyValuePair<string, int>("angle", 3),
                new KeyValuePair<string, int>("against", 2),
                new KeyValuePair<string, int>("taper", 2),
                new KeyValuePair<string, int>("scale", 3),
                new KeyValuePair<string, int>("flutter", 3),
                new KeyValuePair<string, int>("pulse", 3)
            };

            private readonly ScriptableObject desc;
            private readonly FieldInfo layersField;
            private readonly FieldInfo materialDescField;
            private readonly FieldInfo matField;
            private readonly System.Collections.IList layers;

            private FlameDescProxy(ScriptableObject desc)
            {
                this.desc = desc;

                Type type = desc.GetType();
                layersField = FindField(type, "layers");
                materialDescField = FindField(type, "materialDesc");
                matField = FindField(type, "mat");
                layers = layersField != null ? layersField.GetValue(desc) as System.Collections.IList : null;
            }

            /// <summary>
            /// Takes the desc of the flame of the prefab and makes a copy of it:
            /// the flame of a part gets its own desc, so the flames of the game
            /// keep theirs. The desc sits in the component "FlameReference" of
            /// the prefab (the game named it differently in different versions,
            /// so the component with the field is searched).
            /// </summary>
            public static FlameDescProxy From(GameObject flame, out string reason)
            {
                reason = null;

                Component reference = flame.GetComponent("FlameReference");
                if (reference == null)
                {
                    MonoBehaviour[] components = flame.GetComponents<MonoBehaviour>();
                    for (int i = 0; i < components.Length; i++)
                    {
                        if (components[i] != null && FindField(components[i].GetType(), "flameDesc") != null)
                        {
                            reference = components[i];
                            break;
                        }
                    }
                }

                if (reference == null)
                {
                    reason = "the prefab has no component with the desc";
                    return null;
                }

                FieldInfo descField = FindField(reference.GetType(), "flameDesc");
                if (descField == null)
                {
                    reason = "the component has no field with the desc";
                    return null;
                }

                var source = descField.GetValue(reference) as ScriptableObject;
                if (source == null)
                {
                    reason = "the desc of the prefab is empty";
                    return null;
                }

                ScriptableObject copy = UnityEngine.Object.Instantiate(source);

                // The textures of the copy are the ones of the game: the desc
                // bakes them again every time it syncs, so the copy gets its
                // own, otherwise the profile of the part would be baked into
                // the texture of the stock flame.
                for (int i = 0; i < TextureFields.Length; i++)
                {
                    FieldInfo field = FindField(copy.GetType(), TextureFields[i]);
                    if (field != null)
                    {
                        field.SetValue(copy, null);
                    }
                }

                descField.SetValue(reference, copy);
                return new FlameDescProxy(copy);
            }

            /// <summary>The length of a layer of the flame in the units of the game.</summary>
            public float LayerLength(int index)
            {
                object layer = GetLayer(index);
                if (layer == null)
                {
                    return 0f;
                }

                var field = FindField(layer.GetType(), "length");
                if (field == null)
                {
                    return 0f;
                }

                return Convert.ToSingle(field.GetValue(layer));
            }

            /// <summary>The radius of a layer of the flame in the units of the game.</summary>
            public float LayerRadius(int index)
            {
                object layer = GetLayer(index);
                if (layer == null)
                {
                    return 0f;
                }

                var field = FindField(layer.GetType(), "radius");
                if (field == null)
                {
                    return 0f;
                }

                return Convert.ToSingle(field.GetValue(layer));
            }

            /// <summary>
            /// Scales every layer of the flame: the place where it sits and its
            /// length by one factor, its radius by another one. The layers keep
            /// their proportions.
            /// </summary>
            public void ScaleLayers(float factor, float radiusFactor)
            {
                if (layers == null)
                {
                    return;
                }

                for (int i = 0; i < layers.Count; i++)
                {
                    object layer = layers[i];
                    if (layer == null)
                    {
                        continue;
                    }

                    Type type = layer.GetType();
                    SetFloat(type, layer, "length", ReadFloat(type, layer, "length") * factor);
                    SetFloat(type, layer, "radius", ReadFloat(type, layer, "radius") * radiusFactor);
                    ScaleVector(type, layer, "position", factor);
                    layers[i] = layer;
                }
            }

            /// <summary>
            /// The profile of the flame: the curve of the radius along it and
            /// the radius of the layer (in the units of the mesh).
            /// </summary>
            public void SetProfile(int index, AnimationCurve curve, float radiusUnits)
            {
                object layer = GetLayer(index);
                if (layer == null || curve == null || curve.length == 0)
                {
                    return;
                }

                Type type = layer.GetType();

                SetCurve(type, layer, "vacuumProfileCrv", curve);
                SetCurve(type, layer, "seaLevelProfileCrv", curve);

                // The radius of the layer carries the size of the flame: the
                // curve of the desc is a factor of it.
                SetFloat(type, layer, "radius", radiusUnits);
                layers[index] = layer;
            }

            /// <summary>The material of the desc: the flame draws with it.</summary>
            public void SetMaterial(Material material)
            {
                if (matField != null && material != null)
                {
                    matField.SetValue(desc, material);
                }
            }

            /// <summary>
            /// Writes the parameters of the part into the description of the
            /// material of the desc: the game copies them onto the material
            /// every time the flame wakes up.
            /// </summary>
            public void ApplyParameters(Dictionary<string, JToken> values)
            {
                if (values == null || materialDescField == null)
                {
                    return;
                }

                object materialDesc = materialDescField.GetValue(desc);
                if (materialDesc == null)
                {
                    return;
                }

                Type type = materialDesc.GetType();

                for (int i = 0; i < FloatParams.Length; i++)
                {
                    JToken token;
                    if (!values.TryGetValue(FloatParams[i], out token) || token == null)
                    {
                        continue;
                    }

                    SetFloat(type, materialDesc, FloatParams[i], token.Value<float>());
                }

                for (int i = 0; i < VectorParams.Length; i++)
                {
                    string key = VectorParams[i].Key;
                    int count = VectorParams[i].Value;

                    JToken token;
                    if (!values.TryGetValue(key, out token) || token == null || token.Type != JTokenType.Array)
                    {
                        continue;
                    }

                    var array = token as JArray;
                    if (array == null)
                    {
                        continue;
                    }

                    float[] numbers = new float[count];
                    for (int n = 0; n < count && n < array.Count; n++)
                    {
                        numbers[n] = array[n].Value<float>();
                    }

                    SetVector(type, materialDesc, key, numbers);
                }

                JToken color;
                if (values.TryGetValue("color", out color) && color != null)
                {
                    Color parsed;
                    if (TryParseColor(color, out parsed))
                    {
                        SetColor(type, materialDesc, "color", parsed);
                    }
                }

                JToken rim;
                if (values.TryGetValue("rimColor", out rim) && rim != null)
                {
                    Color parsed;
                    if (TryParseColor(rim, out parsed))
                    {
                        SetColor(type, materialDesc, "rimColor", parsed);
                    }
                }

                materialDescField.SetValue(desc, materialDesc);
            }

            /// <summary>
            /// Bakes the textures of the desc again and writes the parameters
            /// onto the material of the desc.
            /// </summary>
            public void Sync()
            {
                MethodInfo sync = desc.GetType().GetMethod(
                    "Sync",
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (sync != null)
                {
                    sync.Invoke(desc, null);
                }
            }

            private object GetLayer(int index)
            {
                if (layers == null || index < 0 || index >= layers.Count)
                {
                    return null;
                }

                return layers[index];
            }

            private static FieldInfo FindField(Type type, string name)
            {
                if (type == null)
                {
                    return null;
                }

                return type.GetField(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            }

            private static float ReadFloat(Type type, object target, string name)
            {
                FieldInfo field = FindField(type, name);
                if (field == null)
                {
                    return 0f;
                }

                try
                {
                    return Convert.ToSingle(field.GetValue(target));
                }
                catch (Exception)
                {
                    return 0f;
                }
            }

            private static void SetFloat(Type type, object target, string name, float value)
            {
                FieldInfo field = FindField(type, name);
                if (field == null)
                {
                    return;
                }

                try
                {
                    field.SetValue(target, value);
                }
                catch (Exception)
                {
                }
            }

            /// <summary>
            /// Multiplies a vector field of a layer: the place where the layer
            /// sits is a float3 of the game.
            /// </summary>
            private static void ScaleVector(Type type, object target, string name, float factor)
            {
                FieldInfo field = FindField(type, name);
                if (field == null)
                {
                    return;
                }

                try
                {
                    object value = field.GetValue(target);
                    if (value == null)
                    {
                        return;
                    }

                    Type vectorType = value.GetType();
                    var parts = new float[3];
                    for (int i = 0; i < parts.Length; i++)
                    {
                        FieldInfo part = FindField(vectorType, i == 0 ? "x" : i == 1 ? "y" : "z");
                        if (part == null)
                        {
                            return;
                        }

                        parts[i] = Convert.ToSingle(part.GetValue(value)) * factor;
                    }

                    var arguments = new object[parts.Length];
                    for (int i = 0; i < parts.Length; i++)
                    {
                        arguments[i] = parts[i];
                    }

                    field.SetValue(target, Activator.CreateInstance(vectorType, arguments));
                }
                catch (Exception)
                {
                }
            }

            private static void SetCurve(Type type, object target, string name, AnimationCurve curve)            {
                FieldInfo field = FindField(type, name);
                if (field == null)
                {
                    return;
                }

                try
                {
                    field.SetValue(target, curve);
                }
                catch (Exception)
                {
                }
            }

            private static void SetColor(Type type, object target, string name, Color value)
            {
                FieldInfo field = FindField(type, name);
                if (field == null)
                {
                    return;
                }

                try
                {
                    field.SetValue(target, value);
                }
                catch (Exception)
                {
                }
            }

            /// <summary>
            /// Writes a vector into a field of the description of the material:
            /// the vectors of the game are float2, float3 and float4.
            /// </summary>
            private static void SetVector(Type type, object target, string name, float[] values)
            {
                FieldInfo field = FindField(type, name);
                if (field == null)
                {
                    return;
                }

                try
                {
                    var arguments = new object[values.Length];
                    for (int i = 0; i < values.Length; i++)
                    {
                        arguments[i] = values[i];
                    }

                    object value = Activator.CreateInstance(field.FieldType, arguments);
                    field.SetValue(target, value);
                }
                catch (Exception)
                {
                }
            }

            private static bool TryParseColor(JToken token, out Color color)
            {
                color = Color.white;

                if (token.Type == JTokenType.String)
                {
                    return ColorUtility.TryParseHtmlString(token.Value<string>(), out color);
                }

                if (token.Type != JTokenType.Array)
                {
                    return false;
                }

                var array = token as JArray;
                if (array == null || array.Count < 3)
                {
                    return false;
                }

                color = new Color(array[0].Value<float>(), array[1].Value<float>(), array[2].Value<float>(), 1f);
                return true;
            }
        }

        /// <summary>
        /// Copies the parameters of the part on the material of the flame. The
        /// names are the ones of the shader of the game (FlameDesc.SyncMaterial).
        /// </summary>
        private static void ApplyParameters(Material material, FlameConfig config)
        {
            if (material == null || config.Params == null)
            {
                return;
            }

            Dictionary<string, JToken> values = config.Params;

            SetColor(material, values, "_Color", "color");
            SetColor(material, values, "_RimColor", "rimColor");

            SetFloat(material, values, "_RimPower", "rimPower");
            SetFloat(material, values, "_FlameLevel", "flameLevel");
            SetFloat(material, values, "_Brightness", "brightness");
            SetFloat(material, values, "_Intensity", "intensity");
            SetFloat(material, values, "_LengthFade", "lengthFade");
            SetFloat(material, values, "_Blend", "blend");
            SetFloat(material, values, "_Speed", "speed");
            SetFloat(material, values, "_Move", "move");
            SetFloat(material, values, "_Pow", "pow");

            SetVector(material, values, "_Soften", "soften", 3);
            SetVector(material, values, "_Mask_ST", "maskST", 4);
            SetVector(material, values, "_Noise_ST", "noiseST", 4);
            SetVector(material, values, "_FlipBook", "flipbook", 2);
            SetVector(material, values, "_Scroll", "scroll", 2);
            SetVector(material, values, "_Angle", "angle", 3);
            SetVector(material, values, "_Against", "against", 2);
            SetVector(material, values, "_Taper", "taper", 2);
            SetVector(material, values, "_Scale", "scale", 3);
            SetVector(material, values, "_Flutter", "flutter", 3);
            SetVector(material, values, "_Pulse", "pulse", 3);
        }

        private static void SetColor(Material material, Dictionary<string, JToken> values, string property, string key)
        {
            JToken token;
            if (!values.TryGetValue(key, out token) || token == null)
            {
                return;
            }

            Color color;
            if (token.Type == JTokenType.String)
            {
                if (!ColorUtility.TryParseHtmlString(token.Value<string>(), out color))
                {
                    return;
                }
            }
            else if (token.Type == JTokenType.Array)
            {
                JArray array = token as JArray;
                if (array == null || array.Count < 3)
                {
                    return;
                }

                color = new Color(array[0].Value<float>(), array[1].Value<float>(), array[2].Value<float>(), 1f);
            }
            else
            {
                return;
            }

            if (material.HasProperty(property))
            {
                material.SetColor(property, color);
            }
        }

        private static void SetFloat(Material material, Dictionary<string, JToken> values, string property, string key)
        {
            JToken token;
            if (!values.TryGetValue(key, out token) || token == null)
            {
                return;
            }

            float value = token.Value<float>();
            if (material.HasProperty(property))
            {
                material.SetFloat(property, value);
            }
        }

        private static void SetVector(Material material, Dictionary<string, JToken> values, string property, string key, int count)
        {
            JToken token;
            if (!values.TryGetValue(key, out token) || token == null || token.Type != JTokenType.Array)
            {
                return;
            }

            JArray array = token as JArray;
            if (array == null)
            {
                return;
            }

            var vector = new Vector4();
            for (int i = 0; i < count && i < array.Count; i++)
            {
                vector[i] = array[i].Value<float>();
            }

            if (material.HasProperty(property))
            {
                material.SetVector(property, vector);
            }
        }

        /// <summary>
        /// The parameters of the flame, as the editor writes them.
        /// </summary>
        internal sealed class FlameConfig
        {
            [JsonProperty("base")]
            public string Base { get; set; }

            [JsonProperty("params")]
            public Dictionary<string, JToken> Params { get; set; }

            [JsonProperty("profile")]
            public List<ProfilePoint> Profile { get; set; }

            [JsonProperty("mesh")]
            public string Mesh { get; set; }
        }

        /// <summary>
        /// One point of the profile of the flame: the position along the flame
        /// and the radius there.
        /// </summary>
        internal sealed class ProfilePoint
        {
            [JsonProperty("v")]
            public float V { get; set; }

            [JsonProperty("r")]
            public float R { get; set; }
        }
    }
}
