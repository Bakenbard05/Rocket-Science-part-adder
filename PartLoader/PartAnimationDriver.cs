using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
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

        /// <summary>Duration of the pose change in seconds ("deploy").</summary>
        public float duration = 1f;

        /// <summary>
        /// Part state trigger that starts the deploy. When it is empty the node simply
        /// keeps the deployed pose.
        /// </summary>
        public string trigger;

        /// <summary>
        /// Part state trigger that folds the node back to its stowed pose. When it is
        /// empty, any other transition folds the node back.
        /// </summary>
        public string foldTrigger;

        /// <summary>
        /// Colour the part is tinted to when the trigger fires, for example "#3a2a1a" for a
        /// burnt part. Empty means no tint.
        /// </summary>
        public string tint;

        /// <summary>How strong the tint is (0..1).</summary>
        public float tintAmount = 1f;

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

        private sealed class Motion
        {
            internal PartAnimationEntry Entry;
            internal Transform Node;
            internal Quaternion Base;
            internal float Angle;
            internal float FromAngle;
            internal float ToAngle;
            internal float Elapsed;
            internal float Time;
            internal bool Animating;
        }

        /// <summary>Fills the driver with the motions of the part.</summary>
        internal void Configure(IEnumerable<PartAnimationEntry> definitions)
        {
            entries = new List<PartAnimationEntry>();
            if (definitions == null)
            {
                return;
            }

            foreach (PartAnimationEntry definition in definitions)
            {
                if (definition == null)
                {
                    continue;
                }

                entries.Add(definition);
            }
        }

        private void Awake()
        {
            RebuildMotions();
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
                    Angle = IsDeploy(entry) ? entry.stowed : 0f
                });
            }
        }

        private void Update()
        {
            if (motions.Count == 0)
            {
                return;
            }

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

        private static bool IsDeploy(PartAnimationEntry entry)
        {
            return string.Equals(entry.type, "deploy", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsKeys(PartAnimationEntry entry)
        {
            return string.Equals(entry.type, "keys", StringComparison.OrdinalIgnoreCase);
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
            motion.Node.localRotation = motion.Base * Quaternion.AngleAxis(motion.Angle, axis);
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

            return node;
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

                    if (deploy)
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
