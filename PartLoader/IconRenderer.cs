using System;
using System.Collections.Generic;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Draws a small shaded picture of the model so that every mod part gets its own shop
    /// icon. The picture is rasterized on the CPU: no camera, no render texture and no
    /// dependency on the graphics state of the game, so it also works while the game is
    /// still starting up.
    /// </summary>
    internal static class IconRenderer
    {
        private struct Triangle
        {
            internal Vector3 A;
            internal Vector3 B;
            internal Vector3 C;
        }

        internal static Sprite Render(GameObject model, Color baseColor, int size)
        {
            if (model == null || size <= 8)
            {
                return null;
            }

            List<Triangle> triangles = Collect(model);
            if (triangles.Count == 0)
            {
                return null;
            }

            Bounds bounds = ComputeBounds(triangles);
            float radius = Mathf.Max(bounds.extents.magnitude, 0.001f);
            Vector3 center = bounds.center;

            // A fixed three quarter view, the same for every part.
            Vector3 forward = new Vector3(-0.55f, -0.38f, -1f).normalized;
            Vector3 right = Vector3.Cross(Vector3.up, forward).normalized;
            Vector3 up = Vector3.Cross(forward, right).normalized;
            Vector3 light = new Vector3(0.45f, 0.8f, 0.55f).normalized;

            var pixels = new Color32[size * size];
            var depth = new float[size * size];
            for (int i = 0; i < depth.Length; i++)
            {
                depth[i] = float.MinValue;
                pixels[i] = new Color32(0, 0, 0, 0);
            }

            float scale = size * 0.46f / radius;
            for (int i = 0; i < triangles.Count; i++)
            {
                Triangle triangle = triangles[i];

                Vector3 normal = Vector3.Cross(triangle.B - triangle.A, triangle.C - triangle.A);
                if (normal.sqrMagnitude < 1e-12f)
                {
                    continue;
                }

                normal.Normalize();
                float shade = 0.32f + 0.68f * Mathf.Max(0f, Vector3.Dot(normal, light));
                Color color = new Color(
                    Mathf.Clamp01(baseColor.r * shade),
                    Mathf.Clamp01(baseColor.g * shade),
                    Mathf.Clamp01(baseColor.b * shade),
                    1f);

                Vector2 a = Project(triangle.A - center, right, up, scale, size);
                Vector2 b = Project(triangle.B - center, right, up, scale, size);
                Vector2 c = Project(triangle.C - center, right, up, scale, size);
                float da = Depth(triangle.A - center, forward);
                float db = Depth(triangle.B - center, forward);
                float dc = Depth(triangle.C - center, forward);

                Rasterize(pixels, depth, a, b, c, da, db, dc, color, size);
            }

            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false);
            texture.SetPixels32(pixels);
            texture.Apply();
            texture.name = "PartAdderIcon";
            texture.wrapMode = TextureWrapMode.Clamp;
            texture.filterMode = FilterMode.Bilinear;

            var sprite = Sprite.Create(
                texture,
                new Rect(0f, 0f, size, size),
                new Vector2(0.5f, 0.5f),
                100f,
                0,
                SpriteMeshType.FullRect);
            sprite.name = texture.name;
            return sprite;
        }

        private static List<Triangle> Collect(GameObject model)
        {
            var triangles = new List<Triangle>();
            MeshFilter[] filters = model.GetComponentsInChildren<MeshFilter>(true);
            for (int i = 0; i < filters.Length; i++)
            {
                MeshFilter filter = filters[i];
                Mesh mesh = filter.sharedMesh;
                if (mesh == null || mesh.vertexCount == 0)
                {
                    continue;
                }

                int[] indices;
                Vector3[] vertices;
                try
                {
                    indices = mesh.triangles;
                    vertices = mesh.vertices;
                }
                catch (Exception)
                {
                    // A mesh without an index buffer cannot be drawn.
                    continue;
                }

                Matrix4x4 matrix = filter.transform.localToWorldMatrix;
                for (int t = 0; t + 2 < indices.Length; t += 3)
                {
                    triangles.Add(new Triangle
                    {
                        A = matrix.MultiplyPoint3x4(vertices[indices[t]]),
                        B = matrix.MultiplyPoint3x4(vertices[indices[t + 1]]),
                        C = matrix.MultiplyPoint3x4(vertices[indices[t + 2]])
                    });
                }
            }

            return triangles;
        }

        private static Bounds ComputeBounds(List<Triangle> triangles)
        {
            var bounds = new Bounds(triangles[0].A, Vector3.zero);
            for (int i = 0; i < triangles.Count; i++)
            {
                bounds.Encapsulate(triangles[i].A);
                bounds.Encapsulate(triangles[i].B);
                bounds.Encapsulate(triangles[i].C);
            }

            return bounds;
        }

        private static Vector2 Project(Vector3 point, Vector3 right, Vector3 up, float scale, int size)
        {
            float x = Vector3.Dot(point, right) * scale + size * 0.5f;
            float y = size * 0.5f - Vector3.Dot(point, up) * scale;
            return new Vector2(x, y);
        }

        private static float Depth(Vector3 point, Vector3 forward)
        {
            return Vector3.Dot(point, forward);
        }

        private static void Rasterize(
            Color32[] pixels,
            float[] depth,
            Vector2 a,
            Vector2 b,
            Vector2 c,
            float da,
            float db,
            float dc,
            Color color,
            int size)
        {
            int minX = Mathf.Max(0, Mathf.FloorToInt(Mathf.Min(a.x, Mathf.Min(b.x, c.x))));
            int maxX = Mathf.Min(size - 1, Mathf.CeilToInt(Mathf.Max(a.x, Mathf.Max(b.x, c.x))));
            int minY = Mathf.Max(0, Mathf.FloorToInt(Mathf.Min(a.y, Mathf.Min(b.y, c.y))));
            int maxY = Mathf.Min(size - 1, Mathf.CeilToInt(Mathf.Max(a.y, Mathf.Max(b.y, c.y))));

            float area = Edge(a, b, c);
            if (Mathf.Abs(area) < 1e-6f)
            {
                return;
            }

            var color32 = (Color32)color;
            for (int y = minY; y <= maxY; y++)
            {
                for (int x = minX; x <= maxX; x++)
                {
                    var point = new Vector2(x + 0.5f, y + 0.5f);
                    float w0 = Edge(b, c, point);
                    float w1 = Edge(c, a, point);
                    float w2 = Edge(a, b, point);

                    bool inside = area > 0f
                        ? (w0 >= 0f && w1 >= 0f && w2 >= 0f)
                        : (w0 <= 0f && w1 <= 0f && w2 <= 0f);
                    if (!inside)
                    {
                        continue;
                    }

                    float u = w0 / area;
                    float v = w1 / area;
                    float w = w2 / area;
                    float z = da * u + db * v + dc * w;

                    int index = y * size + x;
                    if (z <= depth[index])
                    {
                        continue;
                    }

                    depth[index] = z;
                    pixels[index] = color32;
                }
            }
        }

        private static float Edge(Vector2 a, Vector2 b, Vector2 c)
        {
            return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        }
    }
}
