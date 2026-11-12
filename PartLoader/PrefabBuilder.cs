using System;
using System.Collections.Generic;
using System.IO;
using UnbeGames.Model;
using UnbeGames.Support;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    internal sealed class ConnectionInfo
    {
        internal int Id;
        internal Vector3 Position;
        internal Quaternion Rotation;
        internal List<Vector3> Sockets;
        internal Vector3 Center;
        internal Vector3 Size;
        internal ConnectionShape Shape;
        internal PartConnectionConfig.Flags Flags;
    }

    internal sealed class BuiltPrefab
    {
        internal GameObject Root;
        internal GameObject Model;
        internal Bounds Bounds;
        internal int MeshCount;
        internal int VertexCount;
        internal int ColliderCount;
        internal int AttachmentCount;
        internal readonly List<ConnectionInfo> Connections = new List<ConnectionInfo>();
    }

    /// <summary>
    /// Builds the prefab hierarchy the game's baker expects:
    ///   model / physics / attachments/&lt;id&gt;/slot/&lt;socket&gt; /
    ///   cable_attachments / assembly_physics / reentry
    /// </summary>
    internal static class PrefabBuilder
    {
        internal const string ModelName = "model";
        internal const string PhysicsName = "physics";
        internal const string AttachmentsName = "attachments";
        internal const string CableAttachmentsName = "cable_attachments";
        internal const string AssemblyPhysicsName = "assembly_physics";
        internal const string ReentryName = "reentry";
        internal const string AttachmentsModeName = "attachments_mode";
        internal const string SolidModeName = "solid_mode";

        internal static BuiltPrefab Build(PartDefinition definition, string partDirectory, Material material, float scale, string prefabName)
        {
            var built = new BuiltPrefab();

            var root = new GameObject(prefabName);
            built.Root = root;
            root.transform.position = Vector3.zero;
            root.transform.rotation = Quaternion.identity;
            root.transform.localScale = Vector3.one;

            try
            {
                root.tag = Tag.rocketPart;
            }
            catch (Exception)
            {
                Diagnostics.Warn("Tag '" + Tag.rocketPart + "' is not defined in this build; part prefab is untagged");
            }

            var physics = new GameObject(PhysicsName);
            physics.transform.SetParent(root.transform, false);

            GameObject model = MeshFactory.Import(
                Path.Combine(partDirectory, definition.Model),
                material,
                scale,
                definition.Id);
            model.name = ModelName;
            model.transform.SetParent(root.transform, false);

            // RocketPartCtrl.CreateModel reads these two children from the addressable model
            // without null checks, and PlacablePart toggles them between attachment and solid view.
            AddModeChild(model.transform, AttachmentsModeName);
            AddModeChild(model.transform, SolidModeName);

            WarnAboutModelTransform(model, definition.Id);

            ApplyNodeMaterials(model, definition, partDirectory, material);

            built.Model = model;
            built.MeshCount = MeshFactory.CountMeshes(model);
            built.VertexCount = MeshFactory.CountVertices(model);

            if (!string.IsNullOrEmpty(definition.PhysicsModel))
            {
                GameObject physicsModel = MeshFactory.Import(
                    Path.Combine(partDirectory, definition.PhysicsModel),
                    material,
                    scale,
                    definition.Id + " (physics)");

                built.ColliderCount = MeshFactory.BuildColliders(physicsModel, physics);
                UnityEngine.Object.Destroy(physicsModel);
            }
            else
            {
                built.ColliderCount = MeshFactory.BuildColliders(model, physics);
            }

            built.Bounds = MeshFactory.ComputeBounds(model);

            if (built.ColliderCount == 0)
            {
                var box = physics.AddComponent<BoxCollider>();
                box.center = built.Bounds.center;
                box.size = NonZero(built.Bounds.size, 0.1f);
                built.ColliderCount = 1;
                Diagnostics.Warn(definition.Id + ": no physics geometry, using a box collider around the model");
            }

            var assemblyPhysics = new GameObject(AssemblyPhysicsName);
            assemblyPhysics.transform.SetParent(root.transform, false);
            var assemblyCollider = assemblyPhysics.AddComponent<BoxCollider>();
            assemblyCollider.center = built.Bounds.center;
            assemblyCollider.size = NonZero(built.Bounds.size, 0.1f);

            var attachments = new GameObject(AttachmentsName);
            attachments.transform.SetParent(root.transform, false);
            BuildAttachments(definition, attachments.transform, built);
            built.AttachmentCount = built.Connections.Count;

            var cableAttachments = new GameObject(CableAttachmentsName);
            cableAttachments.transform.SetParent(root.transform, false);
            BuildCableAttachments(definition, cableAttachments.transform);

            // RocketPartCtrl.Create destroys child "reentry" when the part is instantiated
            // without physics (shop placement). Stock prefabs carry an empty one; without it
            // the game throws a NullReferenceException while creating the part view.
            var reentry = new GameObject(ReentryName);
            reentry.transform.SetParent(root.transform, false);

            // The game finds parts and connections with Physics raycasts limited to these
            // layers: colliders on Default would make parts unpickable and unconnectable.
            SetLayer(root, Layer.rocketLayer);
            SetLayer(attachments, Layer.attachmentLayer);

            return built;
        }

        /// <summary>
        /// Assigns a dedicated material to the model nodes that name one in part.json
        /// ("materials": [{ "node": "model/nozzle", "color": "#222222" }]). The path is the
        /// node path inside the model, the same one the animations use.
        /// </summary>
        private static void ApplyNodeMaterials(GameObject model, PartDefinition definition, string partDirectory, Material defaultMaterial)
        {
            if (definition.Materials == null || definition.Materials.Length == 0)
            {
                return;
            }

            var byNode = new Dictionary<string, NodeMaterialDefinition>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < definition.Materials.Length; i++)
            {
                NodeMaterialDefinition node = definition.Materials[i];
                if (node == null || string.IsNullOrEmpty(node.Node))
                {
                    continue;
                }

                string key = node.Node.StartsWith("model/", StringComparison.OrdinalIgnoreCase)
                    ? node.Node.Substring("model/".Length)
                    : node.Node;
                byNode[key] = node;
            }

            Renderer[] renderers = model.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                string path = RelativePath(model.transform, renderer.transform);

                NodeMaterialDefinition node;
                if (!byNode.TryGetValue(path, out node))
                {
                    continue;
                }

                Material material = MaterialFactory.CreateForNode(node, definition.Material, partDirectory, definition.Id);
                if (material == null)
                {
                    continue;
                }

                renderer.sharedMaterial = material;
                Diagnostics.Info(definition.Id + ": own material for node '" + path + "'");
            }

            if (byNode.Count > 0)
            {
                Diagnostics.Info(definition.Id + ": " + byNode.Count + " node material(s) defined");
            }
        }

        private static string RelativePath(Transform root, Transform target)
        {
            var parts = new List<string>();
            Transform current = target;
            while (current != null && current != root)
            {
                parts.Add(current.name);
                current = current.parent;
            }

            parts.Reverse();
            return string.Join("/", parts.ToArray());
        }

        private static void AddModeChild(Transform parent, string name)
        {
            var child = new GameObject(name);
            child.transform.SetParent(parent, false);
        }

        private static void SetLayer(GameObject gameObject, int layer)
        {
            if (layer < 0)
            {
                return;
            }

            gameObject.layer = layer;
            foreach (Transform child in gameObject.transform)
            {
                SetLayer(child.gameObject, layer);
            }
        }

        private static void BuildAttachments(PartDefinition definition, Transform parent, BuiltPrefab built)
        {
            AttachmentDefinition[] definitions = definition.Attachments;
            if (definitions == null || definitions.Length == 0)
            {
                throw new InvalidOperationException("part has no attachments; at least one connection is required");
            }

            var usedIds = new HashSet<int>();
            for (int i = 0; i < definitions.Length; i++)
            {
                AttachmentDefinition attachment = definitions[i];
                int id = attachment.Id ?? i;

                if (id < 0 || id > ushort.MaxValue)
                {
                    throw new InvalidOperationException("attachment #" + i + ": id " + id + " is outside 0..65535");
                }

                if (!usedIds.Add(id))
                {
                    throw new InvalidOperationException("attachment #" + i + ": duplicate id " + id);
                }

                Vector3 position;
                if (!JsonHelp.TryVector3(attachment.Position, out position))
                {
                    if (attachment.Position != null)
                    {
                        throw new InvalidOperationException("attachment #" + i + ": position must be [x, y, z]");
                    }

                    position = Vector3.zero;
                }

                Vector3 direction;
                if (!JsonHelp.TryDirection(attachment.Direction, out direction))
                {
                    throw new InvalidOperationException("attachment #" + i + ": direction must be up/down/left/right/forward/back or a vector");
                }

                Quaternion rotation = Quaternion.FromToRotation(Vector3.up, direction);
                Vector3 euler;
                if (JsonHelp.TryVector3(attachment.Rotation, out euler))
                {
                    rotation = Quaternion.Euler(euler);
                }

                float spacing = JsonHelp.FloatOr(attachment.Spacing, 1f);
                if (spacing <= 0f || float.IsNaN(spacing) || float.IsInfinity(spacing))
                {
                    throw new InvalidOperationException("attachment #" + i + ": spacing must be a positive number");
                }

                ConnectionShape shape;
                if (string.IsNullOrEmpty(attachment.Shape))
                {
                    shape = ConnectionShape.single;
                }
                else if (!AttachmentPresets.TryParseShape(attachment.Shape, out shape))
                {
                    throw new InvalidOperationException("attachment #" + i + ": unknown shape '" + attachment.Shape + "'");
                }

                Vector3 boxSize;
                List<Vector3> sockets = ResolveSockets(attachment, i, spacing, out boxSize);
                PartConnectionConfig.Flags flags = ResolveFlags(attachment, i);

                Vector3 boxCenter;
                if (!JsonHelp.TryVector3(attachment.Center, out boxCenter))
                {
                    boxCenter = new Vector3(0f, 0.1f, 0f);
                }

                var attachmentObject = new GameObject(id.ToString());
                attachmentObject.transform.SetParent(parent, false);
                attachmentObject.transform.localPosition = position;
                attachmentObject.transform.localRotation = rotation;

                var collider = attachmentObject.AddComponent<BoxCollider>();
                collider.center = boxCenter;
                collider.size = NonZero(boxSize, 0.1f);

                var slot = new GameObject("slot");
                slot.transform.SetParent(attachmentObject.transform, false);

                for (int s = 0; s < sockets.Count; s++)
                {
                    var socket = new GameObject(s.ToString());
                    socket.transform.SetParent(slot.transform, false);
                    socket.transform.localPosition = sockets[s];
                }

                built.Connections.Add(new ConnectionInfo
                {
                    Id = id,
                    Position = position,
                    Rotation = rotation,
                    Sockets = sockets,
                    Center = boxCenter,
                    Size = NonZero(boxSize, 0.1f),
                    Shape = shape,
                    Flags = flags
                });
            }
        }

        private static PartConnectionConfig.Flags ResolveFlags(AttachmentDefinition attachment, int index)
        {
            if (string.IsNullOrEmpty(attachment.Flags))
            {
                return PartConnectionConfig.Flags.none;
            }

            // Flags is a bit mask, so accept combinations such as "dynamic, primary".
            PartConnectionConfig.Flags flags = PartConnectionConfig.Flags.none;
            string[] parts = attachment.Flags.Split(new[] { ',', '|', '+', ' ' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < parts.Length; i++)
            {
                PartConnectionConfig.Flags parsed;
                if (!Enum.TryParse(AttachmentPresets.Normalize(parts[i]), true, out parsed))
                {
                    throw new InvalidOperationException("attachment #" + index + ": unknown flags '" + attachment.Flags +
                                                        "' (use none, dynamic, primary or axial)");
                }

                flags |= parsed;
            }

            return flags;
        }

        private static List<Vector3> ResolveSockets(AttachmentDefinition attachment, int index, float spacing, out Vector3 boxSize)
        {
            AttachmentPreset preset;
            bool hasPreset = AttachmentPresets.TryGet(attachment.Shape, out preset);

            if (!hasPreset && !string.IsNullOrEmpty(attachment.Shape))
            {
                ConnectionShape parsed;
                if (!AttachmentPresets.TryParseShape(attachment.Shape, out parsed))
                {
                    throw new InvalidOperationException("attachment #" + index + ": unknown shape '" + attachment.Shape + "'");
                }
            }

            var sockets = new List<Vector3>();

            if (attachment.Sockets != null && attachment.Sockets.Length > 0)
            {
                for (int i = 0; i < attachment.Sockets.Length; i++)
                {
                    Vector3 socket;
                    if (!JsonHelp.TryVector3(attachment.Sockets[i], out socket))
                    {
                        throw new InvalidOperationException("attachment #" + index + ": sockets[" + i + "] must be [x, y, z]");
                    }

                    sockets.Add(socket);
                }

                if (JsonHelp.TryVector3(attachment.Size, out boxSize))
                {
                    return sockets;
                }

                if (hasPreset)
                {
                    boxSize = preset.Size * spacing;
                }
                else
                {
                    boxSize = BoxAround(sockets);
                }

                return sockets;
            }

            if (!hasPreset)
            {
                throw new InvalidOperationException("attachment #" + index + ": shape '" + (attachment.Shape ?? "") +
                                                    "' has no built-in socket layout; specify 'sockets' explicitly");
            }

            for (int i = 0; i < preset.Sockets.Length; i++)
            {
                sockets.Add(preset.Sockets[i] * spacing);
            }

            if (!JsonHelp.TryVector3(attachment.Size, out boxSize))
            {
                boxSize = preset.Size * spacing;
            }

            return sockets;
        }

        private static Vector3 BoxAround(List<Vector3> sockets)
        {
            float minX = float.MaxValue, maxX = float.MinValue;
            float minZ = float.MaxValue, maxZ = float.MinValue;

            for (int i = 0; i < sockets.Count; i++)
            {
                minX = Mathf.Min(minX, sockets[i].x);
                maxX = Mathf.Max(maxX, sockets[i].x);
                minZ = Mathf.Min(minZ, sockets[i].z);
                maxZ = Mathf.Max(maxZ, sockets[i].z);
            }

            return new Vector3(maxX - minX + 0.7f, 0.3f, maxZ - minZ + 0.7f);
        }

        private static void BuildCableAttachments(PartDefinition definition, Transform parent)
        {
            if (definition.CableAttachments == null)
            {
                return;
            }

            var usedIds = new HashSet<int>();
            for (int i = 0; i < definition.CableAttachments.Length; i++)
            {
                CableAttachmentDefinition cable = definition.CableAttachments[i];
                int id = cable.Id ?? i;

                if (!usedIds.Add(id))
                {
                    Diagnostics.Warn(definition.Id + ": duplicate cable attachment id " + id + " ignored");
                    continue;
                }

                Vector3 position;
                if (!JsonHelp.TryVector3(cable.Position, out position))
                {
                    position = Vector3.zero;
                }

                var cableObject = new GameObject(id.ToString());
                cableObject.transform.SetParent(parent, false);
                cableObject.transform.localPosition = position;
            }
        }

        private static void WarnAboutModelTransform(GameObject model, string partId)
        {
            Transform transform = model.transform;
            if (transform.localPosition.sqrMagnitude > 1e-6f || Quaternion.Angle(transform.localRotation, Quaternion.identity) > 0.5f)
            {
                Diagnostics.Warn(partId + ": model root has a non-identity transform (" + JsonHelp.Invariant(transform.localPosition) +
                                 "). Attachment positions are measured from the prefab origin, so export the mesh at the origin");
            }
        }

        private static Vector3 NonZero(Vector3 value, float fallback)
        {
            if (Mathf.Abs(value.x) < 1e-4f) value.x = fallback;
            if (Mathf.Abs(value.y) < 1e-4f) value.y = fallback;
            if (Mathf.Abs(value.z) < 1e-4f) value.z = fallback;
            return value;
        }
    }
}
