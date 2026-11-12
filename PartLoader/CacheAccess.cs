using System;
using System.Collections.Generic;
using System.Reflection;
using UnbeGames.Model;
using UnbeGames.Services;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// The mod has to touch a few private game containers because there is no public
    /// API for adding parts. Everything that depends on private game internals is
    /// isolated here so a game update only breaks one file with a clear error.
    /// </summary>
    internal static class CacheAccess
    {
        private static FieldInfo partsField;
        private static FieldInfo schemaField;
        private static FieldInfo postprocessField;
        private static FieldInfo bakerField;
        private static FieldInfo spritesField;

        internal static void EnsureInitialized()
        {
            if (partsField != null)
            {
                return;
            }

            partsField = RequireField(typeof(RocketPartCache), "parts");
            schemaField = RequireField(typeof(SchemaCache<RocketPartSchema>), "schemaItems");
            postprocessField = RequireField(typeof(RocketPartCache), "postprocessData");
            bakerField = RequireField(typeof(RocketPartCache), "baker");

            SpriteCache spriteCache = CacheStore.sprites;
            if (spriteCache == null)
            {
                throw new InvalidOperationException("CacheStore.sprites is not available yet");
            }

            spritesField = RequireField(typeof(SpriteCache), "sprites");
        }

        private static FieldInfo RequireField(Type type, string name)
        {
            FieldInfo field = type.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic);
            if (field == null)
            {
                throw new MissingFieldException(type.FullName, name);
            }

            return field;
        }

        internal static Dictionary<int, GameObject> GetParts(RocketPartCache cache)
        {
            return partsField.GetValue(cache) as Dictionary<int, GameObject>;
        }

        internal static Dictionary<int, RocketPartSchema> GetSchemas(RocketPartCache cache)
        {
            return schemaField.GetValue(cache) as Dictionary<int, RocketPartSchema>;
        }

        internal static Dictionary<int, PostprocessPartData> GetPostprocessData(RocketPartCache cache)
        {
            return postprocessField.GetValue(cache) as Dictionary<int, PostprocessPartData>;
        }

        internal static void SetBaker(RocketPartCache cache, RocketPartBaker baker)
        {
            bakerField.SetValue(cache, baker);
        }

        internal static Dictionary<string, Sprite> GetSprites()
        {
            SpriteCache spriteCache = CacheStore.sprites;
            if (spriteCache == null)
            {
                return null;
            }

            return spritesField.GetValue(spriteCache) as Dictionary<string, Sprite>;
        }
    }
}
