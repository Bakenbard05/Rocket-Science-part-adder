using System;
using System.Collections.Generic;
using System.Globalization;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Small helpers for reading tolerant, human-friendly JSON values.
    /// Vectors can be written as [x, y, z] or {"x":0,"y":1,"z":0}; colours as
    /// "#RRGGBB", [r, g, b] (0..1) or {"r":..,"g":..,"b":..,"a":..}.
    /// </summary>
    internal static class JsonHelp
    {
        internal static bool TryVector3(JToken token, out Vector3 value)
        {
            value = Vector3.zero;
            if (token == null || token.Type == JTokenType.Null)
            {
                return false;
            }

            if (token is JArray array && array.Count >= 3)
            {
                value = new Vector3(
                    array[0].Value<float>(),
                    array[1].Value<float>(),
                    array[2].Value<float>());
                return true;
            }

            if (token is JObject obj)
            {
                JToken x = obj["x"];
                JToken y = obj["y"];
                JToken z = obj["z"];
                if (x != null && y != null && z != null)
                {
                    value = new Vector3(x.Value<float>(), y.Value<float>(), z.Value<float>());
                    return true;
                }
            }

            return false;
        }

        internal static Vector3 Vector3Or(JToken token, Vector3 fallback)
        {
            Vector3 value;
            return TryVector3(token, out value) ? value : fallback;
        }

        internal static bool TryVector2(JToken token, out Vector2 value)
        {
            value = Vector2.zero;
            if (token is JArray array && array.Count >= 2)
            {
                value = new Vector2(array[0].Value<float>(), array[1].Value<float>());
                return true;
            }

            if (token is JObject obj && obj["x"] != null && obj["y"] != null)
            {
                value = new Vector2(obj["x"].Value<float>(), obj["y"].Value<float>());
                return true;
            }

            return false;
        }

        /// <summary>Direction keyword (up/down/left/right/forward/back) or a vector.</summary>
        internal static bool TryDirection(JToken token, out Vector3 direction)
        {
            direction = Vector3.up;
            if (token == null || token.Type == JTokenType.Null)
            {
                return true;
            }

            if (token.Type == JTokenType.String)
            {
                string text = token.Value<string>();
                if (string.IsNullOrEmpty(text))
                {
                    return true;
                }

                switch (text.Trim().ToLowerInvariant())
                {
                    case "up":
                    case "top":
                        direction = Vector3.up;
                        return true;
                    case "down":
                    case "bottom":
                        direction = Vector3.down;
                        return true;
                    case "left":
                        direction = Vector3.left;
                        return true;
                    case "right":
                        direction = Vector3.right;
                        return true;
                    case "forward":
                    case "front":
                        direction = Vector3.forward;
                        return true;
                    case "back":
                    case "backward":
                        direction = Vector3.back;
                        return true;
                    default:
                        return false;
                }
            }

            Vector3 vector;
            if (TryVector3(token, out vector))
            {
                if (vector.sqrMagnitude < 1e-8f)
                {
                    return false;
                }

                direction = vector.normalized;
                return true;
            }

            return false;
        }

        internal static bool TryColor(JToken token, out Color color)
        {
            color = Color.white;
            if (token == null || token.Type == JTokenType.Null)
            {
                return false;
            }

            if (token.Type == JTokenType.String)
            {
                string text = token.Value<string>();
                if (string.IsNullOrEmpty(text))
                {
                    return false;
                }

                Color parsed;
                if (ColorUtility.TryParseHtmlString(text, out parsed))
                {
                    color = parsed;
                    return true;
                }

                return false;
            }

            if (token is JArray array)
            {
                if (array.Count < 3)
                {
                    return false;
                }

                float alpha = array.Count >= 4 ? array[3].Value<float>() : 1f;
                color = new Color(
                    array[0].Value<float>(),
                    array[1].Value<float>(),
                    array[2].Value<float>(),
                    alpha);
                return true;
            }

            if (token is JObject obj)
            {
                JToken r = obj["r"];
                JToken g = obj["g"];
                JToken b = obj["b"];
                if (r == null || g == null || b == null)
                {
                    return false;
                }

                JToken a = obj["a"];
                color = new Color(
                    r.Value<float>(),
                    g.Value<float>(),
                    b.Value<float>(),
                    a == null ? 1f : a.Value<float>());
                return true;
            }

            return false;
        }

        internal static string StringOr(JToken token, string fallback)
        {
            if (token == null || token.Type == JTokenType.Null)
            {
                return fallback;
            }

            return token.Value<string>();
        }

        internal static float FloatOr(JToken token, float fallback)
        {
            if (token == null || token.Type == JTokenType.Null)
            {
                return fallback;
            }

            try { return token.Value<float>(); }
            catch { return fallback; }
        }

        internal static int IntOr(JToken token, int fallback)
        {
            if (token == null || token.Type == JTokenType.Null)
            {
                return fallback;
            }

            try { return token.Value<int>(); }
            catch { return fallback; }
        }

        internal static bool BoolOr(JToken token, bool fallback)
        {
            if (token == null || token.Type == JTokenType.Null)
            {
                return fallback;
            }

            try { return token.Value<bool>(); }
            catch { return fallback; }
        }

        internal static string Invariant(float value)
        {
            return value.ToString("0.####", CultureInfo.InvariantCulture);
        }

        internal static string Invariant(double value)
        {
            return value.ToString("0.####", CultureInfo.InvariantCulture);
        }

        internal static string Invariant(Vector3 value)
        {
            return "(" + Invariant(value.x) + ", " + Invariant(value.y) + ", " + Invariant(value.z) + ")";
        }
    }
}
