using System;
using System.Collections.Generic;
using System.IO;
using UnbeGames.Mods;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Wraps the game's Assimp-based MeshImporter so no Unity editor is needed.
    /// The importer bakes the scale into the mesh transforms, therefore the rest of
    /// the loader works with final, meter-based coordinates.
    /// </summary>
    internal static class MeshFactory
    {
        private static readonly HashSet<string> SupportedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".obj", ".fbx", ".glb", ".gltf", ".dae", ".stl", ".ply", ".3ds", ".blend"
        };

        internal static GameObject Import(string path, Material material, float scale, string partId)
        {
            if (string.IsNullOrEmpty(path))
            {
                throw new ArgumentException("model path is empty");
            }

            if (!File.Exists(path))
            {
                throw new FileNotFoundException("model file not found: " + path);
            }

            string extension = Path.GetExtension(path);
            if (!SupportedExtensions.Contains(extension))
            {
                Diagnostics.Warn(partId + ": unusual model extension '" + extension + "', trying to import anyway");
            }

            GameObject root;
            try
            {
                var importer = new MeshImporter(scale, material);
                root = importer.Load(path, null);
            }
            catch (Exception e)
            {
                throw new InvalidOperationException("Assimp could not import " + Path.GetFileName(path) + ": " + e.Message, e);
            }

            if (root == null)
            {
                throw new InvalidOperationException("imported model is empty: " + Path.GetFileName(path));
            }

            if (root.GetComponentsInChildren<MeshFilter>(true).Length == 0)
            {
                throw new InvalidOperationException("model contains no meshes: " + Path.GetFileName(path));
            }

            int skipped = RemoveUnrenderableMeshes(root, partId);
            if (root.GetComponentsInChildren<MeshFilter>(true).Length == 0)
            {
                throw new InvalidOperationException("model has no renderable triangles" +
                                                    (skipped > 0 ? " (every mesh is degenerate)" : "") + ": " +
                                                    Path.GetFileName(path));
            }

            return root;
        }

        /// <summary>
        /// The game's importer hands the Assimp index list straight to Mesh.SetIndices. A mesh made
        /// only of degenerate faces (for example a 2-vertex face that Assimp keeps after welding
        /// duplicate vertices) gets an index count that is not a multiple of three, Unity stores no
        /// index buffer for it, and the game's volume baker later throws "Mesh '...' index buffer is
        /// null" while baking the part. Such a mesh cannot be rendered as triangles either, so drop
        /// it and keep the rest of the model.
        /// </summary>
        private static int RemoveUnrenderableMeshes(GameObject root, string partId)
        {
            int removed = 0;
            MeshFilter[] filters = root.GetComponentsInChildren<MeshFilter>(true);
            for (int i = 0; i < filters.Length; i++)
            {
                MeshFilter filter = filters[i];
                Mesh mesh = filter.sharedMesh;
                if (mesh == null || HasRenderableTriangles(mesh))
                {
                    continue;
                }

                Diagnostics.Warn(partId + ": mesh '" + mesh.name +
                                 "' has no renderable triangles (degenerate faces in the source model); skipping it");

                MeshRenderer renderer = filter.GetComponent<MeshRenderer>();
                if (renderer != null)
                {
                    UnityEngine.Object.DestroyImmediate(renderer);
                }

                UnityEngine.Object.DestroyImmediate(filter);
                removed++;
            }

            return removed;
        }

        /// <summary>
        /// The game's volume baker reads the GPU index buffer, which Unity does not create for
        /// index counts that cannot describe triangles, and then throws "index buffer is null".
        /// Checking the stored index counts avoids touching those buffers and catches the same
        /// meshes: Unity rejects such SetIndices calls, so the counts stay zero.
        /// </summary>
        private static bool HasRenderableTriangles(Mesh mesh)
        {
            if (mesh.vertexCount == 0 || mesh.subMeshCount <= 0)
            {
                return false;
            }

            try
            {
                int indexCount = 0;
                for (int i = 0; i < mesh.subMeshCount; i++)
                {
                    indexCount += (int)mesh.GetIndexCount(i);
                }

                return indexCount >= 3 && indexCount % 3 == 0;
            }
            catch (Exception)
            {
                return false;
            }
        }

        internal static int CountVertices(GameObject root)
        {
            int vertices = 0;
            foreach (MeshFilter filter in root.GetComponentsInChildren<MeshFilter>(true))
            {
                if (filter.sharedMesh != null)
                {
                    vertices += filter.sharedMesh.vertexCount;
                }
            }

            return vertices;
        }

        internal static int CountMeshes(GameObject root)
        {
            return root.GetComponentsInChildren<MeshFilter>(true).Length;
        }

        /// <summary>Creates convex colliders under the physics root, mirroring the imported model.</summary>
        internal static int BuildColliders(GameObject source, GameObject physicsRoot)
        {
            int created = 0;
            MeshFilter[] filters = source.GetComponentsInChildren<MeshFilter>(true);
            for (int i = 0; i < filters.Length; i++)
            {
                MeshFilter filter = filters[i];
                if (filter.sharedMesh == null)
                {
                    continue;
                }

                var colliderObject = new GameObject("col_" + i);
                colliderObject.transform.SetParent(physicsRoot.transform, false);
                colliderObject.transform.position = filter.transform.position;
                colliderObject.transform.rotation = filter.transform.rotation;
                colliderObject.transform.localScale = filter.transform.lossyScale;

                if (filter.sharedMesh.vertexCount <= 2500)
                {
                    var collider = colliderObject.AddComponent<MeshCollider>();
                    collider.sharedMesh = filter.sharedMesh;
                    collider.convex = true;
                }
                else
                {
                    // Very dense meshes cannot be cooked into a convex hull reliably, so a few
                    // boxes are fitted to the shape of the mesh instead of one box around it.
                    int boxes = BuildClusterColliders(filter, colliderObject);
                    Diagnostics.Warn("Mesh '" + filter.sharedMesh.name + "' is dense (" + filter.sharedMesh.vertexCount +
                                     " vertices); physics uses " + boxes + " box collider(s) for it");
                }

                created++;
            }

            return created;
        }

        /// <summary>
        /// Fits a few boxes to the shape of a dense mesh with a simple k-means clustering of its
        /// vertices. The result is much closer to the real silhouette than one big box.
        /// </summary>
        private static int BuildClusterColliders(MeshFilter filter, GameObject colliderObject)
        {
            const int clusters = 4;
            const int maxIterations = 8;

            Mesh mesh = filter.sharedMesh;
            Vector3[] vertices;
            try
            {
                vertices = mesh.vertices;
            }
            catch (Exception)
            {
                vertices = null;
            }

            if (vertices == null || vertices.Length == 0)
            {
                var fallback = colliderObject.AddComponent<BoxCollider>();
                fallback.center = mesh.bounds.center;
                fallback.size = NonZero(mesh.bounds.size);
                return 1;
            }

            var centers = new Vector3[clusters];
            centers[0] = vertices[0];
            for (int i = 1; i < clusters; i++)
            {
                Vector3 best = centers[0];
                float bestDistance = -1f;
                for (int v = 0; v < vertices.Length; v++)
                {
                    float distance = (vertices[v] - centers[i - 1]).sqrMagnitude;
                    if (distance > bestDistance)
                    {
                        bestDistance = distance;
                        best = vertices[v];
                    }
                }

                centers[i] = best;
            }

            var assignment = new int[vertices.Length];
            for (int iteration = 0; iteration < maxIterations; iteration++)
            {
                bool changed = false;
                for (int v = 0; v < vertices.Length; v++)
                {
                    int best = 0;
                    float bestDistance = float.MaxValue;
                    for (int c = 0; c < clusters; c++)
                    {
                        float distance = (vertices[v] - centers[c]).sqrMagnitude;
                        if (distance < bestDistance)
                        {
                            bestDistance = distance;
                            best = c;
                        }
                    }

                    if (assignment[v] != best)
                    {
                        assignment[v] = best;
                        changed = true;
                    }
                }

                var sums = new Vector3[clusters];
                var counts = new int[clusters];
                for (int v = 0; v < vertices.Length; v++)
                {
                    sums[assignment[v]] += vertices[v];
                    counts[assignment[v]]++;
                }

                for (int c = 0; c < clusters; c++)
                {
                    if (counts[c] > 0)
                    {
                        centers[c] = sums[c] / counts[c];
                    }
                }

                if (!changed && iteration > 0)
                {
                    break;
                }
            }

            int created = 0;
            for (int c = 0; c < clusters; c++)
            {
                bool hasBounds = false;
                var bounds = new Bounds(centers[c], Vector3.zero);
                for (int v = 0; v < vertices.Length; v++)
                {
                    if (assignment[v] != c)
                    {
                        continue;
                    }

                    if (!hasBounds)
                    {
                        bounds = new Bounds(vertices[v], Vector3.zero);
                        hasBounds = true;
                    }
                    else
                    {
                        bounds.Encapsulate(vertices[v]);
                    }
                }

                if (!hasBounds)
                {
                    continue;
                }

                var box = colliderObject.AddComponent<BoxCollider>();
                box.center = bounds.center;
                box.size = NonZero(bounds.size);
                created++;
            }

            if (created == 0)
            {
                var fallback = colliderObject.AddComponent<BoxCollider>();
                fallback.center = mesh.bounds.center;
                fallback.size = NonZero(mesh.bounds.size);
                created = 1;
            }

            return created;
        }

        private static Vector3 NonZero(Vector3 value)
        {
            if (Mathf.Abs(value.x) < 1e-3f) value.x = 0.01f;
            if (Mathf.Abs(value.y) < 1e-3f) value.y = 0.01f;
            if (Mathf.Abs(value.z) < 1e-3f) value.z = 0.01f;
            return value;
        }

        internal static Bounds ComputeBounds(GameObject root)
        {
            bool hasBounds = false;
            Bounds bounds = new Bounds(Vector3.zero, Vector3.zero);

            foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>(true))
            {
                if (!hasBounds)
                {
                    bounds = renderer.bounds;
                    hasBounds = true;
                }
                else
                {
                    bounds.Encapsulate(renderer.bounds);
                }
            }

            if (!hasBounds)
            {
                foreach (MeshFilter filter in root.GetComponentsInChildren<MeshFilter>(true))
                {
                    if (filter.sharedMesh == null)
                    {
                        continue;
                    }

                    Bounds meshBounds = filter.sharedMesh.bounds;
                    Vector3 center = filter.transform.TransformPoint(meshBounds.center);
                    Vector3 extents = Vector3.Scale(meshBounds.extents, filter.transform.lossyScale);
                    Bounds transformed = new Bounds(center, extents * 2f);

                    if (!hasBounds)
                    {
                        bounds = transformed;
                        hasBounds = true;
                    }
                    else
                    {
                        bounds.Encapsulate(transformed);
                    }
                }
            }

            if (!hasBounds)
            {
                bounds = new Bounds(Vector3.zero, Vector3.one * 0.1f);
                Diagnostics.Warn("Could not compute model bounds; using a 0.1 m placeholder");
            }

            return bounds;
        }
    }
}
