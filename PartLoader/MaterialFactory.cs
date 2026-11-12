using System;
using System.IO;
using Newtonsoft.Json.Linq;
using UnbeGames.Mods;
using UnbeGames.Services;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Builds an HDRP-compatible material. The game's own mod pipeline keeps a
    /// template HDRP/Lit material, so cloning it guarantees correct HDRP setup
    /// (keywords, render queue, shadow passes) without shipping a Unity project.
    /// </summary>
    internal static class MaterialFactory
    {
        private static Material template;
        private static bool templateSearched;

        internal static Material Create(MaterialDefinition definition, string partDirectory, string partId)
        {
            Material material = CreateBase(definition);
            if (material == null)
            {
                return null;
            }

            material.name = "PartAdder_" + partId;

            if (definition == null)
            {
                return material;
            }

            Color color;
            if (JsonHelp.TryColor(definition.Color, out color) && material.HasProperty("_BaseColor"))
            {
                material.SetColor("_BaseColor", color);
            }
            else if (definition.Color != null && material.HasProperty("_BaseColor"))
            {
                Diagnostics.Warn(partId + ": could not parse material.color, expected \"#RRGGBB\" or [r, g, b]");
            }

            if (definition.Metallic.HasValue && material.HasProperty("_Metallic"))
            {
                material.SetFloat("_Metallic", Mathf.Clamp01(definition.Metallic.Value));
            }

            if (definition.Smoothness.HasValue && material.HasProperty("_Smoothness"))
            {
                material.SetFloat("_Smoothness", Mathf.Clamp01(definition.Smoothness.Value));
            }

            Vector2 tiling;
            if (JsonHelp.TryVector2(definition.Tiling, out tiling))
            {
                if (material.HasProperty("_Tiling"))
                {
                    material.SetVector("_Tiling", new Vector4(tiling.x, tiling.y, 0f, 0f));
                }

                if (material.HasProperty("_BaseColorMap"))
                {
                    material.mainTextureScale = tiling;
                }
            }

            Vector2 offset;
            if (JsonHelp.TryVector2(definition.Offset, out offset))
            {
                if (material.HasProperty("_Offset"))
                {
                    material.SetVector("_Offset", new Vector4(offset.x, offset.y, 0f, 0f));
                }

                if (material.HasProperty("_BaseColorMap"))
                {
                    material.mainTextureOffset = offset;
                }
            }

            ApplyTexture(material, "_BaseColorMap", definition.Albedo, partDirectory, partId, false);
            ApplyTexture(material, "_NormalMap", definition.Normal, partDirectory, partId, true);
            ApplyTexture(material, "_MaskMap", definition.Mask, partDirectory, partId, true);

            ApplyEmissive(material, definition.Emissive, definition.EmissiveIntensity);
            ApplyOpacity(material, definition.Opacity, definition.Color);

            return material;
        }

        /// <summary>
        /// Builds the material of a single model node. Values that the node does not define are
        /// taken from the part material, so a node only has to state what is different.
        /// </summary>
        internal static Material CreateForNode(NodeMaterialDefinition node, MaterialDefinition baseDefinition, string partDirectory, string partId)
        {
            if (node == null)
            {
                return null;
            }

            Material material = CreateBase(null);
            if (material == null)
            {
                return null;
            }

            material.name = "PartAdder_" + partId + "_" + node.Node;

            if (baseDefinition != null)
            {
                if (baseDefinition.Color != null && node.Color == null)
                {
                    SetColor(material, baseDefinition.Color, partId);
                }

                if (baseDefinition.Metallic.HasValue && !node.Metallic.HasValue)
                {
                    SetFloat(material, "_Metallic", Mathf.Clamp01(baseDefinition.Metallic.Value));
                }

                if (baseDefinition.Smoothness.HasValue && !node.Smoothness.HasValue)
                {
                    SetFloat(material, "_Smoothness", Mathf.Clamp01(baseDefinition.Smoothness.Value));
                }
            }

            if (node.Color != null)
            {
                SetColor(material, node.Color, partId);
            }

            if (node.Metallic.HasValue)
            {
                SetFloat(material, "_Metallic", Mathf.Clamp01(node.Metallic.Value));
            }

            if (node.Smoothness.HasValue)
            {
                SetFloat(material, "_Smoothness", Mathf.Clamp01(node.Smoothness.Value));
            }

            ApplyTexture(material, "_BaseColorMap", node.Albedo, partDirectory, partId, false);
            ApplyTexture(material, "_NormalMap", node.Normal, partDirectory, partId, true);
            ApplyTexture(material, "_MaskMap", node.Mask, partDirectory, partId, true);

            ApplyEmissive(material, node.Emissive, node.EmissiveIntensity);
            ApplyOpacity(material, node.Opacity, node.Color);

            return material;
        }

        private static void SetColor(Material material, JToken token, string partId)
        {
            Color color;
            if (JsonHelp.TryColor(token, out color) && material.HasProperty("_BaseColor"))
            {
                material.SetColor("_BaseColor", color);
            }
            else if (token != null && material.HasProperty("_BaseColor"))
            {
                Diagnostics.Warn(partId + ": could not parse material.color, expected \"#RRGGBB\" or [r, g, b]");
            }
        }

        private static void SetFloat(Material material, string property, float value)
        {
            if (material.HasProperty(property))
            {
                material.SetFloat(property, value);
            }
        }

        private static void ApplyEmissive(Material material, JToken emissiveToken, float? intensity)
        {
            Color emissive;
            bool hasEmissive = JsonHelp.TryColor(emissiveToken, out emissive);

            if (hasEmissive && material.HasProperty("_EmissiveColor"))
            {
                material.SetColor("_EmissiveColor", emissive);
            }

            if (intensity.HasValue && material.HasProperty("_EmissiveIntensity"))
            {
                material.SetFloat("_EmissiveIntensity", Mathf.Max(0f, intensity.Value));
            }
            else if (hasEmissive && material.HasProperty("_EmissiveIntensity"))
            {
                material.SetFloat("_EmissiveIntensity", 1f);
            }

            if (hasEmissive && material.HasProperty("_EmissiveEnabled"))
            {
                material.SetFloat("_EmissiveEnabled", 1f);
            }
        }

        private static void ApplyOpacity(Material material, float? opacity, JToken colorToken)
        {
            if (!opacity.HasValue)
            {
                return;
            }

            float alpha = Mathf.Clamp01(opacity.Value);
            if (alpha >= 1f)
            {
                return;
            }

            if (material.HasProperty("_Surface"))
            {
                material.SetFloat("_Surface", 1f);
            }

            if (material.HasProperty("_Blend"))
            {
                material.SetFloat("_Blend", 0f);
            }

            if (material.HasProperty("_Alpha"))
            {
                material.SetFloat("_Alpha", alpha);
            }

            if (material.HasProperty("_ZWrite"))
            {
                material.SetFloat("_ZWrite", 0f);
            }

            if (material.HasProperty("_SrcBlend"))
            {
                material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            }

            if (material.HasProperty("_DstBlend"))
            {
                material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            }

            Color color;
            if (JsonHelp.TryColor(colorToken, out color) && material.HasProperty("_BaseColor"))
            {
                color.a = alpha;
                material.SetColor("_BaseColor", color);
            }

            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.DisableKeyword("_ALPHATEST_ON");
            material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
        }

        private static Material CreateBase(MaterialDefinition definition)
        {
            Material source = GetTemplate();
            if (source != null)
            {
                return new Material(source);
            }

            string[] shaderNames = { "HDRP/Lit", "HDRP/LitTessellation", "Lit", "Standard" };
            Shader shader = null;
            for (int i = 0; i < shaderNames.Length && shader == null; i++)
            {
                shader = Shader.Find(shaderNames[i]);
            }

            if (definition != null && !string.IsNullOrEmpty(definition.Shader))
            {
                Shader custom = Shader.Find(definition.Shader);
                if (custom != null)
                {
                    shader = custom;
                }
                else
                {
                    Diagnostics.Warn("Shader '" + definition.Shader + "' was not found; using " + (shader == null ? "null" : shader.name));
                }
            }

            if (shader == null)
            {
                Diagnostics.Error("No usable shader found. Custom parts will render with a missing material.");
                return null;
            }

            Diagnostics.Warn("Game template material was not available; created '" + shader.name + "' from scratch");
            return new Material(shader);
        }

        private static Material GetTemplate()
        {
            if (templateSearched)
            {
                return template;
            }

            templateSearched = true;

            try
            {
                ModsLoader loader = ModsLoader.instance;
                if (loader != null)
                {
                    template = loader.templateMaterial != null ? loader.templateMaterial : loader.defaultMaterial;
                }
            }
            catch (Exception e)
            {
                Diagnostics.Warn("Could not read ModsLoader template material: " + e.Message);
            }

            if (template == null)
            {
                try
                {
                    GameObject prefab = CacheStore.prefabs.Get("drag_cube_baker");
                    if (prefab != null)
                    {
                        Renderer renderer = prefab.GetComponentInChildren<Renderer>(true);
                        if (renderer != null)
                        {
                            template = renderer.sharedMaterial;
                        }
                    }
                }
                catch (Exception e)
                {
                    Diagnostics.Warn("Could not find a template material on drag_cube_baker: " + e.Message);
                }
            }

            if (template == null)
            {
                Diagnostics.Warn("No template material found; falling back to Shader.Find");
            }

            return template;
        }

        private static void ApplyTexture(Material material, string property, string relativePath, string partDirectory, string partId, bool linear)
        {
            if (string.IsNullOrEmpty(relativePath) || material == null)
            {
                return;
            }

            if (!material.HasProperty(property) && property != "_BaseColorMap")
            {
                Diagnostics.Warn(partId + ": material has no '" + property + "' property; skipping " + relativePath);
                return;
            }

            string path = Path.Combine(partDirectory, relativePath);
            if (!File.Exists(path))
            {
                Diagnostics.Warn(partId + ": texture not found: " + relativePath);
                return;
            }

            Texture2D texture = TextureFactory.Load(path, linear);
            if (texture == null)
            {
                Diagnostics.Warn(partId + ": could not decode texture " + relativePath + " (use PNG or JPG)");
                return;
            }

            material.SetTexture(property, texture);
        }
    }

    internal static class TextureFactory
    {
        internal static Texture2D Load(string path, bool linear)
        {
            try
            {
                byte[] bytes = File.ReadAllBytes(path);
                var texture = new Texture2D(2, 2, TextureFormat.RGBA32, true, linear);
                if (!texture.LoadImage(bytes))
                {
                    UnityEngine.Object.Destroy(texture);
                    return null;
                }

                texture.name = Path.GetFileNameWithoutExtension(path);
                texture.wrapMode = TextureWrapMode.Repeat;
                texture.filterMode = FilterMode.Trilinear;
                texture.anisoLevel = 4;

                int limit = ModSettings.MaxTextureSize;
                if (limit > 0 && (texture.width > limit || texture.height > limit))
                {
                    float scale = limit / (float)Mathf.Max(texture.width, texture.height);
                    int width = Mathf.Max(1, Mathf.RoundToInt(texture.width * scale));
                    int height = Mathf.Max(1, Mathf.RoundToInt(texture.height * scale));
                    texture.Resize(width, height);
                    Diagnostics.Warn("Texture '" + Path.GetFileName(path) + "' was scaled down to " + width + "x" + height);
                }

                return texture;
            }
            catch (Exception e)
            {
                Diagnostics.Warn("Texture '" + path + "' failed to load: " + e.Message);
                return null;
            }
        }

        internal static Sprite LoadSprite(string path)
        {
            try
            {
                byte[] bytes = File.ReadAllBytes(path);
                var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                if (!texture.LoadImage(bytes))
                {
                    UnityEngine.Object.Destroy(texture);
                    return null;
                }

                texture.name = Path.GetFileNameWithoutExtension(path);
                texture.wrapMode = TextureWrapMode.Clamp;
                texture.filterMode = FilterMode.Bilinear;

                var sprite = Sprite.Create(
                    texture,
                    new Rect(0f, 0f, texture.width, texture.height),
                    new Vector2(0.5f, 0.5f),
                    100f,
                    0,
                    SpriteMeshType.FullRect);
                sprite.name = texture.name;
                return sprite;
            }
            catch (Exception e)
            {
                Diagnostics.Warn("Icon '" + path + "' failed to load: " + e.Message);
                return null;
            }
        }
    }
}
