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
        private static FieldInfo prefabsField;
        private static FieldInfo soundsField;

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

            // The flames of the engines live in the prefab cache of the game, the
            // sounds of the engines in its audio cache.
            PrefabCache prefabCache = CacheStore.prefabs;
            if (prefabCache == null)
            {
                throw new InvalidOperationException("CacheStore.prefabs is not available yet");
            }

            prefabsField = RequireField(typeof(PrefabCache), "prefabs");

            AudioCache audioCache = CacheStore.audio;
            if (audioCache != null)
            {
                soundsField = RequireField(typeof(AudioCache), "sounds");
            }
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

        /// <summary>
        /// The prefab cache of the game holds the flame prefabs of the engines.
        /// </summary>
        internal static bool TryGetPrefab(string name, out GameObject prefab)
        {
            prefab = null;
            PrefabCache cache = CacheStore.prefabs;
            if (cache == null || prefabsField == null)
            {
                return false;
            }

            var prefabs = prefabsField.GetValue(cache) as Dictionary<string, GameObject>;
            return prefabs != null && prefabs.TryGetValue(name, out prefab);
        }

        /// <summary>
        /// Puts a prefab into the cache of the game, so the game can find it by
        /// name (the flames of the engines are taken from there).
        /// </summary>
        internal static bool TrySetPrefab(string name, GameObject prefab)
        {
            PrefabCache cache = CacheStore.prefabs;
            if (cache == null || prefabsField == null || prefab == null)
            {
                return false;
            }

            var prefabs = prefabsField.GetValue(cache) as Dictionary<string, GameObject>;
            if (prefabs == null)
            {
                return false;
            }

            prefabs[name] = prefab;
            return true;
        }

        /// <summary>
        /// Puts a sound into the audio cache of the game, so the engines can
        /// play it by name (AudioController.GetSound).
        /// </summary>
        internal static bool TrySetSound(string name, AudioClip clip)
        {
            AudioCache cache = CacheStore.audio;
            if (cache == null || soundsField == null || clip == null)
            {
                return false;
            }

            var sounds = soundsField.GetValue(cache) as Dictionary<string, AudioClip>;
            if (sounds == null)
            {
                return false;
            }

            sounds[name] = clip;
            return true;
        }

        /// <summary>
        /// Says if the game knows a sound: the name has to be in the audio cache,
        /// otherwise AudioController.GetSound returns null and the engine stays
        /// silent. A null result means the cache itself could not be read.
        /// </summary>
        internal static bool? HasSound(string name)
        {
            AudioCache cache = CacheStore.audio;
            if (cache == null || soundsField == null)
            {
                return null;
            }

            var sounds = soundsField.GetValue(cache) as Dictionary<string, AudioClip>;
            if (sounds == null)
            {
                return null;
            }

            return !string.IsNullOrEmpty(name) && sounds.ContainsKey(name) && sounds[name] != null;
        }
    }
}
