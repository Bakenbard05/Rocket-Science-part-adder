using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using UnbeGames.Controller;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// One procedural motion of a model node, authored in part.json under "animations".
    /// The fields are public and serializable: the driver lives on the part prefab, so
    /// Unity copies them into every instance of the part.
    /// </summary>
    [Serializable]
    public sealed class PartAnimationEntry
    {
        /// <summary>Path of the node, for example "model/antenna_y".</summary>
        public string path;

        /// <summary>"spin" (constant rotation) or "deploy" (pose change).</summary>
        public string type;

        /// <summary>Rotation axis in the local space of the node.</summary>
        public Vector3 axis = Vector3.up;

        /// <summary>Rotation speed in degrees per second ("spin").</summary>
        public float speed;

        /// <summary>Angle of the stowed pose in degrees ("deploy").</summary>
        public float stowed;

        /// <summary>Angle of the deployed pose in degrees ("deploy").</summary>
        public float deployed;

        /// <summary>
        /// Duration of the pose change in seconds ("deploy"), or of the curve ("keys").
        /// </summary>
        public float duration = 1f;

        /// <summary>
        /// Part state trigger that starts the deploy. When it is empty the node simply
        /// keeps the deployed pose.
        /// </summary>
        public string trigger;

        /// <summary>
        /// Part state trigger that folds the node back to its stowed pose. When it is
        /// empty, any other transition folds the node back. The same name as the
        /// <see cref="trigger"/> means one transition toggles the motion.
        /// </summary>
        public string foldTrigger;

        /// <summary>
        /// Colour the part is tinted to when the trigger fires, for example "#3a2a1a" for a
        /// burnt part. Empty means no tint.
        /// </summary>
        public string tint;

        /// <summary>How strong the tint is (0..1).</summary>
        public float tintAmount = 1f;

        /// <summary>
        /// The motion moves the node along the axis instead of turning it: the
        /// numbers mean metres (speed m/s, stowed/deployed/keys m, keys values m).
        /// </summary>
        public bool translate;

        /// <summary>
        /// The point the node turns around, in the local space of the node. Zero
        /// (the default) turns the node around its own origin.
        /// </summary>
        public Vector3 pivot;

        /// <summary>Keyframes of the motion ("keys"): the angle of the node over the time.</summary>
        public AnimationKey[] keys;
    }

    /// <summary>
    /// One keyframe of a motion: the angle of the node at that time.
    /// </summary>
    [Serializable]
    public sealed class AnimationKey
    {
        /// <summary>Time of the key in seconds.</summary>
        public float time;

        /// <summary>Angle of the node in degrees.</summary>
        public float angle;

        /// <summary>True (the default) interpolates the segment smoothly, false linearly.</summary>
        public bool smooth = true;
    }

    /// <summary>
    /// The motions of every loaded part, keyed by the prefab name of the part.
    ///
    /// The driver keeps them in a serialized field, but a component added at runtime
    /// does not always carry that field into the instances the game clones (the list
    /// came out empty in the game while the loader had read the animation), so the
    /// definitions are also kept here and the driver fetches them by the prefab name
    /// of the part it is placed on. The field stays the primary source: it is what a
    /// prefab made in the editor would use.
    /// </summary>
    internal static class PartAnimationRegistry
    {
        private static readonly Dictionary<string, List<PartAnimationEntry>> Entries =
            new Dictionary<string, List<PartAnimationEntry>>(StringComparer.OrdinalIgnoreCase);

        internal static void Register(string prefabName, List<PartAnimationEntry> entries)
        {
            if (string.IsNullOrEmpty(prefabName))
            {
                return;
            }

            Entries[prefabName] = entries ?? new List<PartAnimationEntry>();
        }

        internal static void Unregister(string prefabName)
        {
            if (!string.IsNullOrEmpty(prefabName))
            {
                Entries.Remove(prefabName);
            }
        }

        internal static List<PartAnimationEntry> Find(string prefabName)
        {
            if (string.IsNullOrEmpty(prefabName))
            {
                return null;
            }

            List<PartAnimationEntry> found;
            return Entries.TryGetValue(prefabName, out found) ? found : null;
        }
    }

    /// <summary>
    /// Moves model nodes of a part without Unity's Animator.
    ///
    /// The game only animates parts that carry an Animator with a controller asset, and
    /// such assets cannot be created at runtime, so mod parts drive their own transforms.
    /// The driver is added to the part prefab, therefore every placed instance of the part
    /// animates itself. Deploy motions react to the part state transitions of the game
    /// (the same events the Animator based parts use) and are looked up by reflection, so a
    /// game update that renames the interface only disables this feature instead of
    /// breaking the whole mod.
    /// </summary>
    public sealed class PartAnimationDriver : MonoBehaviour
    {
        [SerializeField] private List<PartAnimationEntry> entries = new List<PartAnimationEntry>();

        private readonly List<Motion> motions = new List<Motion>();
        private readonly Dictionary<Material, Material> tintedMaterials = new Dictionary<Material, Material>();
        private readonly Dictionary<Material, Color> originalColors = new Dictionary<Material, Color>();
        private bool listening;
        private int listenCooldown;
        private bool reported;
        private int reportFrames;
        private bool registryChecked;

        /// <summary>Parts whose driver already wrote its start line, so a fleet of one part logs once.</summary>
        private static readonly HashSet<string> reportedStart = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        private sealed class Motion
        {
            internal PartAnimationEntry Entry;
            internal Transform Node;
            internal Quaternion Base;
            internal Vector3 BasePos;
            internal float Angle;
            internal float FromAngle;
            internal float ToAngle;
            internal float Elapsed;
            internal float Time;
            internal int Direction = 1;
            internal bool Started;
            internal bool Animating;
        }

        /// <summary>Fills the driver with the motions of the part.</summary>
        internal void Configure(IEnumerable<PartAnimationEntry> definitions)
        {
            entries = new List<PartAnimationEntry>();
            if (definitions != null)
            {
                foreach (PartAnimationEntry definition in definitions)
                {
                    if (definition == null)
                    {
                        continue;
                    }

                    entries.Add(definition);
                }
            }

            // AddComponent calls Awake at once, because the prefab root of the
            // loader is active: Awake has already seen an empty list, so the
            // motions are built here as well. Without this the driver sits with
            // zero motions and never touches the model (the part is static in the
            // game even though the log says the animations were read).
            RebuildMotions();
        }

        private void Awake()
        {
            RebuildMotions();
        }

        private void Start()
        {
            if (entries == null)
            {
                entries = new List<PartAnimationEntry>();
            }

            // The prefab a mod part is built from is made at runtime, and the list of
            // motions is a field the loader wrote into it: the clones the game makes
            // sometimes come up with an empty list (the loader had read the
            // animation, the part was still in the game). The registry of the loader
            // holds the same definitions under the prefab name of the part, so the
            // motions are taken from there when the field is empty.
            string source = "the prefab";
            if (entries.Count == 0 && TakeFromRegistry())
            {
                source = "the registry of the loader";
            }

            if (entries.Count == 0)
            {
                Diagnostics.Live(PartLabel() + ": animation driver: the part has no motions (the prefab " +
                                 "carried none and the loader has no animation for '" +
                                 (PartPrefabName() ?? "?") + "')");
                return;
            }

            // One line per part, not per placed instance: it tells whether the
            // definitions reached the game at all, which the loader log can not.
            if (reportedStart.Add(PartPrefabName() ?? PartLabel()))
            {
                Diagnostics.Live(PartLabel() + ": animation driver: " + motions.Count + " motion(s) from " + source);
            }
        }

        /// <summary>
        /// Fills the driver from the definitions the loader keeps for the part. True
        /// when the registry had them.
        /// </summary>
        private bool TakeFromRegistry()
        {
            if (registryChecked)
            {
                return false;
            }

            string prefabName = PartPrefabName();
            if (string.IsNullOrEmpty(prefabName))
            {
                // The part view is not attached yet; the next frame tries again.
                return false;
            }

            registryChecked = true;
            List<PartAnimationEntry> stored = PartAnimationRegistry.Find(prefabName);
            if (stored == null || stored.Count == 0)
            {
                return false;
            }

            entries = new List<PartAnimationEntry>(stored);
            RebuildMotions();
            return true;
        }

        private string PartPrefabName()
        {
            RocketPartCtrl ctrl = GetComponentInParent<RocketPartCtrl>();
            if (ctrl == null || ctrl.part == null || ctrl.part.partSchema == null)
            {
                return null;
            }

            return ctrl.part.partSchema.prefabName;
        }

        private string PartLabel()
        {
            RocketPartCtrl ctrl = GetComponentInParent<RocketPartCtrl>();
            if (ctrl != null && ctrl.part != null && !string.IsNullOrEmpty(ctrl.part.strId))
            {
                return ctrl.part.strId;
            }

            return string.IsNullOrEmpty(transform.name) ? "part" : transform.name;
        }

        private void RebuildMotions()
        {
            motions.Clear();
            for (int i = 0; i < entries.Count; i++)
            {
                PartAnimationEntry entry = entries[i];
                if (entry == null || string.IsNullOrEmpty(entry.path))
                {
                    continue;
                }

                motions.Add(new Motion
                {
                    Entry = entry,
                    // A triggered curve waits in its first pose until the part state
                    // fires; a curve without a trigger runs in a loop and starts at 0.
                    Angle = IsDeploy(entry)
                        ? entry.stowed
                        : (IsKeys(entry) && HasTrigger(entry) ? SampleKeys(entry.keys, 0f) : 0f)
                });
            }
        }

        private void Update()
        {
            if (motions.Count == 0)
            {
                // The entries can arrive after Awake (the loader fills them), and a
                // clone of the prefab may have been activated before the list was
                // serialized. Building them here makes the driver self-healing.
                if (entries == null)
                {
                    entries = new List<PartAnimationEntry>();
                }

                if (entries.Count > 0)
                {
                    RebuildMotions();
                }

                if (motions.Count == 0)
                {
                    TakeFromRegistry();
                }

                if (motions.Count == 0)
                {
                    return;
                }
            }

            ReportMotionsOnce();

            if (!listening)
            {
                listenCooldown--;
                if (listenCooldown <= 0)
                {
                    listenCooldown = 30;
                    TryListen();
                }
            }

            float deltaTime = Time.deltaTime;
            for (int i = 0; i < motions.Count; i++)
            {
                Motion motion = motions[i];
                if (motion.Node == null)
                {
                    motion.Node = FindNode(motion.Entry.path);
                    if (motion.Node != null)
                    {
                        motion.Base = motion.Node.localRotation;
                        motion.BasePos = motion.Node.localPosition;
                        Apply(motion);
                    }

                    continue;
                }

                if (IsDeploy(motion.Entry))
                {
                    if (!motion.Animating)
                    {
                        continue;
                    }

                    motion.Elapsed += deltaTime;
                    float duration = motion.Entry.duration > 0f ? motion.Entry.duration : 0.0001f;
                    float t = Mathf.Clamp01(motion.Elapsed / duration);
                    motion.Angle = Mathf.Lerp(motion.FromAngle, motion.ToAngle, t * t * (3f - 2f * t));
                    Apply(motion);
                    if (t >= 1f)
                    {
                        motion.Animating = false;
                    }

                    continue;
                }

                if (IsKeys(motion.Entry))
                {
                    if (HasTrigger(motion.Entry))
                    {
                        // The trigger turns the curve into a one-shot motion: it runs
                        // from the first key to the duration and holds the last pose,
                        // the fold trigger runs it back. Without this a curve with a
                        // trigger kept looping from the first frame, which looked like
                        // an animation that had already played.
                        if (!motion.Animating)
                        {
                            continue;
                        }

                        float curveDuration = motion.Entry.duration > 0f ? motion.Entry.duration : 0.0001f;
                        motion.Time = Mathf.Clamp(motion.Time + deltaTime * motion.Direction, 0f, curveDuration);
                        motion.Angle = SampleKeys(motion.Entry.keys, motion.Time);
                        Apply(motion);
                        if (motion.Direction > 0 ? motion.Time >= curveDuration : motion.Time <= 0f)
                        {
                            motion.Animating = false;
                        }

                        continue;
                    }

                    // The keyframes of the motion, the timeline loops over the duration.
                    motion.Time += deltaTime;
                    float duration = motion.Entry.duration > 0f ? motion.Entry.duration : 0.0001f;
                    float time = motion.Time % duration;
                    motion.Angle = SampleKeys(motion.Entry.keys, time);
                    Apply(motion);
                    continue;
                }

                motion.Angle += motion.Entry.speed * deltaTime;
                Apply(motion);
            }
        }

        /// <summary>
        /// The pose is written once more at the end of the frame. The game's own
        /// controllers (the gimbal of an engine, the tracking of a rotator) write the
        /// same node in Update, and the order of two Update methods is not defined;
        /// an animated node belongs to the animation, so it has to be the last
        /// writer. Without this the motion of a node that a module also drives looks
        /// static in the game while the editor shows it.
        /// </summary>
        private void LateUpdate()
        {
            for (int i = 0; i < motions.Count; i++)
            {
                Motion motion = motions[i];
                if (motion.Node != null)
                {
                    Apply(motion);
                }
            }
        }

        /// <summary>
        /// Writes the state of the motions into the log once per placed part. A path
        /// that does not resolve leaves the part perfectly still and nothing else
        /// says why, so the first seconds of an animated part are reported.
        /// </summary>
        private void ReportMotionsOnce()
        {
            if (reported)
            {
                return;
            }

            // The visible mesh arrives through Addressables a few frames after the
            // part, so the nodes are looked up for a while before the state is
            // written. Good news goes out as soon as every node is there; a path that
            // stays unresolved is reported after about five seconds.
            bool allFound = true;
            for (int i = 0; i < motions.Count; i++)
            {
                if (motions[i].Node == null)
                {
                    allFound = false;
                    break;
                }
            }

            if (!allFound && ++reportFrames < 300)
            {
                return;
            }

            reported = true;

            Transform model = transform.Find("model");
            int found = 0;
            string details = string.Empty;
            string missing = string.Empty;
            for (int i = 0; i < motions.Count; i++)
            {
                Motion motion = motions[i];
                if (motion.Node != null)
                {
                    found++;
                    details += " '" + motion.Entry.path + "' = " + JsonHelp.Invariant(motion.Angle) +
                               (motion.Entry.translate ? " m" : " deg");
                }
                else
                {
                    missing += " '" + motion.Entry.path + "'";
                }
            }

            string message = (string.IsNullOrEmpty(transform.name) ? "part" : transform.name) +
                             ": animation: " + found + "/" + motions.Count + " node(s) found";
            if (model == null)
            {
                message += ", the part has no 'model' child";
            }

            if (!string.IsNullOrEmpty(details))
            {
                message += ";" + details;
            }

            if (!string.IsNullOrEmpty(missing) || model == null)
            {
                message += "; missing:" + missing + "; children of " +
                           (model != null ? "model" : "the part") + ": " +
                           ChildNames(model != null ? model : transform);
            }

            // This runs long after the load, so the line has to be appended to the
            // log file itself; Diagnostics.Info only feeds the buffer that Flush
            // has already written.
            if (string.IsNullOrEmpty(missing) && model != null)
            {
                Diagnostics.Live(message);
            }
            else
            {
                Diagnostics.Live("WARNING: " + message + " (the motion does nothing)");
            }
        }

        private static string ChildNames(Transform root)
        {
            if (root == null)
            {
                return "-";
            }

            string names = string.Empty;
            int count = Mathf.Min(root.childCount, 16);
            for (int i = 0; i < count; i++)
            {
                if (i > 0)
                {
                    names += ", ";
                }

                Transform child = root.GetChild(i);
                names += child != null ? child.name : "?";
            }

            if (root.childCount > count)
            {
                names += ", ... (" + root.childCount + ")";
            }

            return string.IsNullOrEmpty(names) ? "-" : names;
        }

        private static bool IsDeploy(PartAnimationEntry entry)
        {
            return string.Equals(entry.type, "deploy", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsKeys(PartAnimationEntry entry)
        {
            return string.Equals(entry.type, "keys", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// True when the motion reacts to a part state transition. A curve with a
        /// trigger is a one-shot motion; a curve without one runs in a loop.
        /// </summary>
        private static bool HasTrigger(PartAnimationEntry entry)
        {
            return !string.IsNullOrEmpty(entry.trigger) || !string.IsNullOrEmpty(entry.foldTrigger);
        }

        /// <summary>
        /// The angle of a motion with keyframes at the given time. The segments are
        /// interpolated smoothly unless the key says otherwise.
        /// </summary>
        internal static float SampleKeys(AnimationKey[] keys, float time)
        {
            if (keys == null || keys.Length == 0)
            {
                return 0f;
            }

            if (keys.Length == 1)
            {
                return keys[0].angle;
            }

            if (time <= keys[0].time)
            {
                return keys[0].angle;
            }

            for (int i = 0; i < keys.Length - 1; i++)
            {
                AnimationKey from = keys[i];
                AnimationKey to = keys[i + 1];
                if (time > to.time)
                {
                    continue;
                }

                float span = to.time - from.time;
                float t = span <= 0.0001f ? 1f : (time - from.time) / span;
                t = Mathf.Clamp01(t);
                if (to.smooth)
                {
                    t = t * t * (3f - 2f * t);
                }

                return Mathf.Lerp(from.angle, to.angle, t);
            }

            return keys[keys.Length - 1].angle;
        }

        private void Apply(Motion motion)
        {
            PartAnimationEntry entry = motion.Entry;
            Vector3 axis = entry.axis.sqrMagnitude > 0.0001f ? entry.axis.normalized : Vector3.up;
            if (entry.translate)
            {
                motion.Node.localPosition = motion.BasePos + axis * motion.Angle;
                return;
            }

            Quaternion rotation = Quaternion.AngleAxis(motion.Angle, axis);
            motion.Node.localRotation = motion.Base * rotation;
            if (entry.pivot.sqrMagnitude > 0.0001f)
            {
                // The node turns around a shifted pivot: the position is moved so
                // that the pivot point stays where it was. All of it in the space
                // of the node — the base rotation of the node puts the offset back
                // into the space of the parent.
                motion.Node.localPosition = motion.BasePos + motion.Base * (entry.pivot - rotation * entry.pivot);
            }
        }

        /// <summary>
        /// Finds a node of the part. The visible mesh is instantiated by the game as a child
        /// named "model", so paths are written relative to the part root ("model/antenna").
        /// </summary>
        private Transform FindNode(string path)
        {
            if (string.IsNullOrEmpty(path))
            {
                return null;
            }

            string relative = path;
            Transform model = transform.Find("model");
            if (model != null && path.StartsWith("model/", StringComparison.Ordinal))
            {
                relative = path.Substring("model/".Length);
            }

            Transform node = relative.Length > 0 ? transform.Find(relative) : null;
            if (node == null && model != null && relative != path)
            {
                node = model.Find(relative);
            }

            // The importer keeps a node the author does not see in some formats, so
            // the path is searched at any depth before the motion gives up: a node
            // that is not found leaves the part still, and that is the hardest bug
            // to notice from the game.
            if (node == null && model != null)
            {
                node = FindDeep(model, relative);
            }

            return node;
        }

        /// <summary>
        /// Searches a path inside a subtree. The full path from the root or its tail
        /// matches, so a wrapper node the importer added does not break the look up.
        /// </summary>
        private static Transform FindDeep(Transform root, string relative)
        {
            if (root == null || string.IsNullOrEmpty(relative))
            {
                return null;
            }

            Transform[] all = root.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < all.Length; i++)
            {
                Transform candidate = all[i];
                if (candidate == null || candidate == root)
                {
                    continue;
                }

                string built = candidate.name;
                Transform parent = candidate.parent;
                while (parent != null && parent != root)
                {
                    built = parent.name + "/" + built;
                    parent = parent.parent;
                }

                if (string.Equals(built, relative, StringComparison.Ordinal) ||
                    built.EndsWith("/" + relative, StringComparison.Ordinal))
                {
                    return candidate;
                }
            }

            return null;
        }

        private void StartDeploy(Motion motion, bool deploy)
        {
            float target = deploy ? motion.Entry.deployed : motion.Entry.stowed;
            if (Mathf.Approximately(target, motion.ToAngle) && !motion.Animating)
            {
                return;
            }

            motion.FromAngle = motion.Angle;
            motion.ToAngle = target;
            motion.Elapsed = 0f;
            motion.Started = true;
            motion.Direction = deploy ? 1 : -1;
            motion.Animating = true;
        }

        /// <summary>
        /// The direction of the next one-shot motion when the play and the fold trigger
        /// are the same transition: the game fires one event for both directions, so the
        /// motion alternates like a button (the first event plays it forward).
        /// </summary>
        private static int ToggleDirection(Motion motion)
        {
            int direction = !motion.Started || motion.Direction < 0 ? 1 : -1;
            motion.Started = true;
            motion.Direction = direction;
            return direction;
        }

        /// <summary>
        /// Starts a curve motion in the given direction (1 forward, -1 back). The pose
        /// of the moment is the start of the motion, exactly like a deploy turns from
        /// the angle the node is at right now.
        /// </summary>
        private static void StartCurve(Motion motion, int direction)
        {
            motion.Direction = direction;
            motion.Animating = true;
        }

        /// <summary>Called through the part state event of the game.</summary>
        private void OnTransition(string trigger)
        {
            for (int i = 0; i < motions.Count; i++)
            {
                Motion motion = motions[i];
                PartAnimationEntry entry = motion.Entry;

                bool deploy = Matches(entry.trigger, trigger);
                bool fold = Matches(entry.foldTrigger, trigger);

                if (IsDeploy(entry))
                {
                    if (string.IsNullOrEmpty(entry.trigger) && string.IsNullOrEmpty(entry.foldTrigger))
                    {
                        continue;
                    }

                    if (deploy && fold)
                    {
                        // The same trigger plays and folds the motion: one event, so the
                        // deploy alternates.
                        StartDeploy(motion, ToggleDirection(motion) > 0);
                    }
                    else if (deploy)
                    {
                        StartDeploy(motion, true);
                    }
                    else if (fold)
                    {
                        StartDeploy(motion, false);
                    }
                    else if (string.IsNullOrEmpty(entry.foldTrigger))
                    {
                        // Without an explicit fold trigger every other transition folds back.
                        StartDeploy(motion, false);
                    }
                }
                else if (IsKeys(entry) && HasTrigger(entry))
                {
                    // A curve with a trigger is a one-shot motion, like a deploy:
                    // the trigger plays it forward, the fold trigger plays it back,
                    // and without a fold trigger every other transition plays it back.
                    if (deploy && fold)
                    {
                        StartCurve(motion, ToggleDirection(motion));
                    }
                    else if (deploy)
                    {
                        StartCurve(motion, 1);
                    }
                    else if (fold)
                    {
                        StartCurve(motion, -1);
                    }
                    else if (string.IsNullOrEmpty(entry.foldTrigger))
                    {
                        StartCurve(motion, -1);
                    }
                }

                if ((deploy || fold) && !string.IsNullOrEmpty(entry.tint))
                {
                    ApplyTint(entry.tint, entry.tintAmount);
                }
            }
        }

        private static bool Matches(string entryTrigger, string trigger)
        {
            return !string.IsNullOrEmpty(entryTrigger) &&
                   string.Equals(entryTrigger, trigger, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Darkens the part with a colour, for example after it was damaged or burnt. The
        /// materials are cloned once, so the tint does not leak into other parts that share them.
        /// </summary>
        private void ApplyTint(string tint, float amount)
        {
            Color color;
            if (!ColorUtility.TryParseHtmlString(tint, out color))
            {
                return;
            }

            Transform model = transform.Find("model");
            if (model == null)
            {
                model = transform;
            }

            Renderer[] renderers = model.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < renderers.Length; i++)
            {
                Material[] sources = renderers[i].sharedMaterials;
                Material[] result = new Material[sources.Length];
                for (int m = 0; m < sources.Length; m++)
                {
                    Material source = sources[m];
                    if (source == null)
                    {
                        result[m] = null;
                        continue;
                    }

                    Material instance;
                    if (!tintedMaterials.TryGetValue(source, out instance))
                    {
                        instance = new Material(source);
                        tintedMaterials[source] = instance;
                        originalColors[source] = source.HasProperty("_BaseColor")
                            ? source.GetColor("_BaseColor")
                            : Color.white;
                    }

                    if (instance.HasProperty("_BaseColor"))
                    {
                        Color baseColor = originalColors[source];
                        instance.SetColor("_BaseColor", Color.Lerp(baseColor, baseColor * color, Mathf.Clamp01(amount)));
                    }

                    result[m] = instance;
                }

                renderers[i].sharedMaterials = result;
            }
        }

        /// <summary>
        /// Subscribes to the part state events of the game. The interface is looked up by
        /// name on purpose: a renamed interface must not stop the mod from loading.
        /// </summary>
        private void TryListen()
        {
            Component[] components = GetComponents<Component>();
            for (int i = 0; i < components.Length; i++)
            {
                Component component = components[i];
                if (component == null)
                {
                    continue;
                }

                Type[] interfaces = component.GetType().GetInterfaces();
                for (int j = 0; j < interfaces.Length; j++)
                {
                    if (interfaces[j].Name != "IPartStateEventSource")
                    {
                        continue;
                    }

                    EventInfo start = interfaces[j].GetEvent("OnStartTransition");
                    if (start == null)
                    {
                        continue;
                    }

                    try
                    {
                        MethodInfo method = typeof(PartAnimationDriver).GetMethod(
                            "OnTransition",
                            BindingFlags.Instance | BindingFlags.NonPublic);
                        Delegate handler = Delegate.CreateDelegate(start.EventHandlerType, this, method);
                        start.AddEventHandler(component, handler);
                    }
                    catch (Exception)
                    {
                        // The event signature changed: keep the part working without it.
                    }

                    listening = true;
                }
            }
        }
    }
}
