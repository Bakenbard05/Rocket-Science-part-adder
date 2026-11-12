using System;
using System.Collections.Generic;
using UnbeGames.Model;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Socket layouts for the stock connection shapes. Sockets are offsets in the
    /// attachment's local X/Z plane (Y is the connection normal). Values were taken
    /// from the game's own parts so modded parts line up with stock ones.
    /// </summary>
    internal sealed class AttachmentPreset
    {
        internal string Name;
        internal ConnectionShape Shape;
        internal Vector3[] Sockets;
        internal Vector3 Size;
    }

    internal static class AttachmentPresets
    {
        private static readonly Dictionary<string, AttachmentPreset> presets =
            new Dictionary<string, AttachmentPreset>(StringComparer.OrdinalIgnoreCase);

        static AttachmentPresets()
        {
            Add("single", ConnectionShape.single, new Vector3(0.7f, 0.3f, 0.7f),
                new Vector3(0f, 0f, 0f));

            Add("dual", ConnectionShape.dual, new Vector3(1.0f, 0.3f, 1.0f),
                new Vector3(-0.35f, 0f, 0f), new Vector3(0.35f, 0f, 0f));

            Add("triple", ConnectionShape.triple, new Vector3(2.0f, 0.3f, 0.7f),
                new Vector3(-0.7f, 0f, 0f), new Vector3(0f, 0f, 0f), new Vector3(0.7f, 0f, 0f));

            Add("triangle", ConnectionShape.triangle, new Vector3(1.7f, 0.3f, 1.7f),
                new Vector3(0f, 0f, -0.7f),
                new Vector3(0.6062f, 0f, 0.35f),
                new Vector3(-0.6062f, 0f, 0.35f));

            Add("rectangle", ConnectionShape.rectangle, new Vector3(1.7f, 0.3f, 1.7f),
                new Vector3(-0.6062f, 0f, -0.35f),
                new Vector3(-0.6062f, 0f, 0.35f),
                new Vector3(0.6062f, 0f, 0.35f),
                new Vector3(0.6062f, 0f, -0.35f));

            Add("hexagon", ConnectionShape.hexagon, new Vector3(1.7f, 0.3f, 1.7f),
                new Vector3(0f, 0f, -0.7f),
                new Vector3(-0.6062f, 0f, -0.35f),
                new Vector3(-0.6062f, 0f, 0.35f),
                new Vector3(0f, 0f, 0.7f),
                new Vector3(0.6062f, 0f, 0.35f),
                new Vector3(0.6062f, 0f, -0.35f));

            Add("hexdual", ConnectionShape.hexdual, new Vector3(1.9f, 0.3f, 0.4f),
                new Vector3(-0.7f, 0f, 0f), new Vector3(0.7f, 0f, 0f));

            Add("wide", ConnectionShape.wide, new Vector3(3.5f, 0.3f, 0.7f),
                new Vector3(-1.25f, 0f, 0f), new Vector3(1.25f, 0f, 0f));

            Add("broad", ConnectionShape.broad, new Vector3(3.5f, 0.3f, 0.7f),
                new Vector3(-1.72f, 0f, 0f), new Vector3(1.72f, 0f, 0f));

            Add("wide_quad", ConnectionShape.wide_quad, new Vector3(3.5f, 0.3f, 3.5f),
                new Vector3(-1.25f, 0f, -1.25f),
                new Vector3(-1.25f, 0f, 1.25f),
                new Vector3(1.25f, 0f, 1.25f),
                new Vector3(1.25f, 0f, -1.25f));

            Add("broad_quad", ConnectionShape.broad_quad, new Vector3(4.4f, 0.3f, 4.4f),
                new Vector3(-1.72f, 0f, -1.72f),
                new Vector3(-1.72f, 0f, 1.72f),
                new Vector3(1.72f, 0f, 1.72f),
                new Vector3(1.72f, 0f, -1.72f));

            Add("butterfly", ConnectionShape.butterfly, new Vector3(1.7f, 0.3f, 1.7f),
                new Vector3(-0.6062f, 0f, -0.35f),
                new Vector3(-0.6062f, 0f, 0.35f),
                new Vector3(0f, 0f, 0f),
                new Vector3(0.6062f, 0f, 0.35f),
                new Vector3(0.6062f, 0f, -0.35f));

            Add("line", ConnectionShape.line, new Vector3(0.7f, 0.3f, 1.4f),
                new Vector3(0f, 0f, -0.35f), new Vector3(0f, 0f, 0.35f));

            // Large rings and docking ports share one layout on every stock part.
            Add("heptahedron", ConnectionShape.heptahedron, new Vector3(1.65f, 0.3f, 1.65f),
                new Vector3(0f, 0f, 0.7f),
                new Vector3(-0.6062f, 0f, 0.35f),
                new Vector3(-0.6062f, 0f, -0.35f),
                new Vector3(0f, 0f, -0.7f),
                new Vector3(0.6062f, 0f, -0.35f),
                new Vector3(0.6062f, 0f, 0.35f),
                new Vector3(0f, 0f, 0f));

            Add("star", ConnectionShape.star, new Vector3(4.0f, 0.3f, 4.0f),
                new Vector3(0f, 0f, 0.7f),
                new Vector3(-0.6062f, 0f, 0.35f),
                new Vector3(-0.6062f, 0f, -0.35f),
                new Vector3(0f, 0f, -0.7f),
                new Vector3(0.6062f, 0f, -0.35f),
                new Vector3(0.6062f, 0f, 0.35f),
                new Vector3(0f, 0f, 1.4f),
                new Vector3(-1.2124f, 0f, 0.7f),
                new Vector3(-1.2124f, 0f, -0.7f),
                new Vector3(0f, 0f, -1.4f),
                new Vector3(1.2124f, 0f, -0.7f),
                new Vector3(1.2124f, 0f, 0.7f));

            Add("docking_small", ConnectionShape.docking_small, new Vector3(1.0f, 0.3f, 1.0f),
                new Vector3(0f, 0f, 0f));

            Add("docking_medium", ConnectionShape.docking_medium, new Vector3(1.7f, 0.3f, 1.7f),
                new Vector3(0f, 0f, 0f));
        }

        private static void Add(string name, ConnectionShape shape, Vector3 size, params Vector3[] sockets)
        {
            presets[name] = new AttachmentPreset
            {
                Name = name,
                Shape = shape,
                Size = size,
                Sockets = sockets
            };
        }

        internal static bool TryGet(string name, out AttachmentPreset preset)
        {
            preset = null;
            if (string.IsNullOrEmpty(name))
            {
                return false;
            }

            return presets.TryGetValue(Normalize(name), out preset);
        }

        internal static bool TryParseShape(string name, out ConnectionShape shape)
        {
            shape = ConnectionShape.none;
            if (string.IsNullOrEmpty(name))
            {
                return false;
            }

            return Enum.TryParse(Normalize(name), true, out shape);
        }

        internal static string Normalize(string name)
        {
            if (name == null)
            {
                return string.Empty;
            }

            return name.Trim().ToLowerInvariant().Replace("-", "_").Replace(" ", "_");
        }
    }

    internal static class UnitScale
    {
        internal static bool TryGet(string units, out float factor)
        {
            factor = 1f;
            if (string.IsNullOrEmpty(units))
            {
                return true;
            }

            switch (units.Trim().ToLowerInvariant())
            {
                case "m":
                case "meter":
                case "meters":
                    factor = 1f;
                    return true;
                case "cm":
                case "centimeter":
                case "centimeters":
                    factor = 0.01f;
                    return true;
                case "mm":
                case "millimeter":
                case "millimeters":
                    factor = 0.001f;
                    return true;
                case "in":
                case "inch":
                case "inches":
                    factor = 0.0254f;
                    return true;
                case "ft":
                case "foot":
                case "feet":
                    factor = 0.3048f;
                    return true;
                default:
                    return false;
            }
        }
    }
}
