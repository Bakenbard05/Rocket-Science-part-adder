using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnbeGames.Model;
using Unity.Mathematics;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Dynamic sockets are the connections the game puts onto the surface of a
    /// part at runtime instead of storing them in the prefab: a part that carries
    /// a "receiving" config can have another part attached anywhere on its hull,
    /// and a part that carries an "attaching" config can be stuck onto any hull.
    ///
    /// The game builds both lists itself from the raw configs
    /// (RocketPartSchema.dynamicAttachmentConfigs → its own OnDeserialized hook →
    /// DynamicAttachment with one entry per shape bit), so the loader does not
    /// have to create attachments at all. It only has to make sure the defindexes
    /// exist: the game reads them from its own dictionary without a check
    /// (RocketPartCache.GetDynamicAttachConfig throws KeyNotFoundException for an
    /// unknown id), which would kill the whole part. The ids of the stock configs
    /// are listed in docs/PART_FORMAT.md and in the editor's presets.
    /// </summary>
    internal static class DynamicSockets
    {
        internal sealed class Result
        {
            internal DynamicAttachmentConfigItem[] Items = new DynamicAttachmentConfigItem[0];

            /// <summary>dynamicCurrPivot: the point the socket of a placed part is aimed at.</summary>
            internal float3 Pivot;

            internal bool HasCurrent
            {
                get
                {
                    for (int i = 0; i < Items.Length; i++)
                    {
                        if (Items[i].defindex < 0)
                        {
                            return true;
                        }
                    }

                    return false;
                }
            }
        }

        /// <summary>
        /// Reads and checks the dynamic sockets of a part. Runs before the prefab is
        /// built, because it also drops the "dynamic" flag of fixed connections.
        /// Never throws: a socket that the game would not understand is dropped and
        /// the part is loaded without it.
        /// </summary>
        internal static Result Prepare(RocketPartCache cache, PartDefinition definition, string label)
        {
            var result = new Result();
            StripDynamicFlags(definition, label);

            if (definition.DynamicCurrPivot != null && definition.DynamicCurrPivot.Type != JTokenType.Null)
            {
                if (JsonHelp.TryVector3(definition.DynamicCurrPivot, out Vector3 pivot))
                {
                    result.Pivot = new float3(pivot.x, pivot.y, pivot.z);
                }
                else
                {
                    Diagnostics.Warn(label + ": dynamicCurrPivot must be [x, y, z], the origin is used instead");
                }
            }

            DynamicAttachmentDefinition[] configs = definition.DynamicAttachmentConfigs;
            if (configs == null || configs.Length == 0)
            {
                return result;
            }

            var order = new List<int>();
            var shapes = new Dictionary<int, ConnectionShape>();
            for (int i = 0; i < configs.Length; i++)
            {
                DynamicAttachmentDefinition config = configs[i];
                if (config == null)
                {
                    continue;
                }

                if (!GameKnowsConfig(cache, config.Defindex))
                {
                    Diagnostics.Warn(label + ": dynamicAttachmentConfigs[" + i + "] uses the defindex " + config.Defindex +
                                     ", which the game does not know — the socket was dropped. The stock ids are " +
                                     "10001000..10001003/10001100..10001105, 20001000/20001100, 30001000..30001018 " +
                                     "and 30001100..30001129 for a receiving socket; an attaching socket uses " +
                                     "-10001000, -10001102..-10001105 or -30001000..-30001018 (see docs/PART_FORMAT.md)");
                    continue;
                }

                ConnectionShape shape;
                if (!TryParseShapes(config.Shape, out shape))
                {
                    Diagnostics.Warn(label + ": dynamicAttachmentConfigs[" + i + "] has no usable shape (\"" +
                                     (config.Shape ?? string.Empty) + "\") — the socket was dropped. Use the connection " +
                                     "shapes, for example \"single, dual\"");
                    continue;
                }

                ConnectionShape existing;
                if (shapes.TryGetValue(config.Defindex, out existing))
                {
                    shapes[config.Defindex] = existing | shape;
                    Diagnostics.Verbose(label + ": dynamicAttachmentConfigs[" + i + "] repeats the defindex " +
                                        config.Defindex + ", the shapes are merged");
                    continue;
                }

                shapes.Add(config.Defindex, shape);
                order.Add(config.Defindex);
            }

            if (order.Count == 0)
            {
                return result;
            }

            var items = new DynamicAttachmentConfigItem[order.Count];
            int receiving = 0;
            int attaching = 0;
            var summary = new List<string>();
            for (int i = 0; i < order.Count; i++)
            {
                int defindex = order[i];
                ConnectionShape shape = shapes[defindex];
                items[i] = new DynamicAttachmentConfigItem { defindex = defindex, shape = shape };

                if (defindex >= 0)
                {
                    receiving += CountShapes(shape);
                }
                else
                {
                    attaching += CountShapes(shape);
                }

                summary.Add((defindex >= 0 ? "+" : "") + defindex + " (" + DescribeShapes(shape) + ")");
            }

            result.Items = items;
            Diagnostics.Info(label + ": dynamic sockets: " + receiving + " receiving, " + attaching +
                             " attaching — " + string.Join(", ", summary.ToArray()));
            return result;
        }

        /// <summary>
        /// The game casts a ray from the surface of a part that is being placed
        /// towards its dynamicCurrPivot (<c>AssemblyShopPlacer.RaycastCurrent</c>) to
        /// find the point and the normal of the surface it touches, so the pivot has
        /// to sit inside the hull. The stock parts leave it at the origin or put it
        /// slightly inside (<c>engine_0</c> has 0, -0.2, 0).
        /// </summary>
        internal static void CheckPivot(Result sockets, Bounds bounds, string label)
        {
            if (sockets == null || !sockets.HasCurrent)
            {
                return;
            }

            Bounds outer = bounds;
            outer.Expand(0.05f);
            var pivot = new Vector3(sockets.Pivot.x, sockets.Pivot.y, sockets.Pivot.z);
            if (!outer.Contains(pivot))
            {
                Diagnostics.Warn(label + ": dynamicCurrPivot " + JsonHelp.Invariant(pivot) +
                                 " is outside the hull of the part (the collider spans " +
                                 JsonHelp.Invariant(bounds.min) + ".." + JsonHelp.Invariant(bounds.max) +
                                 ") — the game cannot aim the socket at the surface of the part and it can not be " +
                                 "placed on one");
            }
        }

        /// <summary>
        /// A fixed connection must not carry the "dynamic" flag: the game treats such
        /// a connection as one it created itself and drops it from the part when the
        /// part is detached (<c>RocketPart.RemoveDynamicConnection</c>), so the
        /// hand-made connection of the part.json is gone for good.
        /// </summary>
        private static void StripDynamicFlags(PartDefinition definition, string label)
        {
            AttachmentDefinition[] attachments = definition.Attachments;
            if (attachments == null)
            {
                return;
            }

            for (int i = 0; i < attachments.Length; i++)
            {
                AttachmentDefinition attachment = attachments[i];
                if (attachment == null || string.IsNullOrEmpty(attachment.Flags))
                {
                    continue;
                }

                string[] parts = attachment.Flags.Split(new[] { ',', '|', '+', ' ' }, StringSplitOptions.RemoveEmptyEntries);
                var kept = new List<string>();
                bool dropped = false;
                for (int p = 0; p < parts.Length; p++)
                {
                    if (string.Equals(parts[p].Trim(), "dynamic", StringComparison.OrdinalIgnoreCase))
                    {
                        dropped = true;
                        continue;
                    }

                    kept.Add(parts[p].Trim());
                }

                if (!dropped)
                {
                    continue;
                }

                Diagnostics.Warn(label + ": attachment #" + i + " carries the \"dynamic\" flag. A connection of the " +
                                 "prefab is a fixed one: the game removes a connection with that flag when the part " +
                                 "is detached. The flag was dropped; use \"dynamicAttachmentConfigs\" for a surface " +
                                 "socket");
                attachment.Flags = kept.Count == 0 ? null : string.Join(", ", kept.ToArray());
            }
        }

        private static bool GameKnowsConfig(RocketPartCache cache, int defindex)
        {
            if (cache == null)
            {
                return false;
            }

            try
            {
                // Returns the config of the game, throws KeyNotFoundException for an
                // id it does not have (the game itself does not survive that check).
                cache.GetDynamicAttachConfig(defindex);
                return true;
            }
            catch (KeyNotFoundException)
            {
                return false;
            }
            catch (Exception e)
            {
                Diagnostics.Warn("the dynamic attachment configs of the game could not be read (" +
                                 e.GetType().Name + ": " + e.Message + "), the sockets of the part are dropped");
                return false;
            }
        }

        /// <summary>
        /// "single, dual" → the two shape bits. The string is what the game's own
        /// schema files use (ConnectionShape is a flags enum with a string converter).
        /// </summary>
        internal static bool TryParseShapes(string text, out ConnectionShape shape)
        {
            shape = ConnectionShape.none;
            if (string.IsNullOrEmpty(text))
            {
                return false;
            }

            string[] parts = text.Split(new[] { ',', '|', '+' }, StringSplitOptions.RemoveEmptyEntries);
            bool any = false;
            for (int i = 0; i < parts.Length; i++)
            {
                string name = AttachmentPresets.Normalize(parts[i].Trim());
                if (name.Length == 0 || char.IsDigit(name[0]))
                {
                    continue;
                }

                ConnectionShape parsed;
                if (!Enum.TryParse(name, true, out parsed) || !Enum.IsDefined(typeof(ConnectionShape), parsed))
                {
                    Diagnostics.Warn("unknown connection shape \"" + parts[i].Trim() + "\" (use for example single, dual, triple, rectangle, hexdual)");
                    continue;
                }

                // "all" would make the game create a socket for every shape it
                // knows (twenty of them per config) — the author writes the ones
                // the part really has. "none" is no socket at all.
                if (parsed == ConnectionShape.all)
                {
                    Diagnostics.Warn("\"all\" is not a shape of a dynamic socket, list the shapes instead");
                    continue;
                }

                if (parsed == ConnectionShape.none)
                {
                    continue;
                }

                shape |= parsed;
                any = true;
            }

            return any;
        }

        /// <summary>How many shapes a mask holds, i.e. how many sockets the game creates.</summary>
        private static int CountShapes(ConnectionShape shape)
        {
            uint mask = (uint)shape;
            int count = 0;
            for (int i = 0; i < 32; i++)
            {
                if ((mask & (1u << i)) != 0)
                {
                    count++;
                }
            }

            return count;
        }

        private static string DescribeShapes(ConnectionShape shape)
        {
            var names = new List<string>();
            foreach (ConnectionShape value in Enum.GetValues(typeof(ConnectionShape)))
            {
                if (value == ConnectionShape.none || value == ConnectionShape.all)
                {
                    continue;
                }

                if ((shape & value) == value)
                {
                    names.Add(value.ToString());
                }
            }

            return string.Join("+", names.ToArray());
        }
    }
}
