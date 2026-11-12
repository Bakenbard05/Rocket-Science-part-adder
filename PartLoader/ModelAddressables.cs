using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AddressableAssets;
using UnityEngine.AddressableAssets.ResourceLocators;
using UnityEngine.ResourceManagement.ResourceLocations;
using UnityEngine.ResourceManagement.ResourceProviders;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// The game never uses the prefab meshes directly: RocketPartCtrl.CreateModel loads
    /// "&lt;prefab&gt;_model.prefab" through Addressables and parents it under the part view.
    /// Mod parts have no asset bundles, so this bridge advertises those model keys through a
    /// custom Addressables locator and serves the runtime-built model GameObjects from a
    /// custom resource provider. Addressables instantiates the returned object normally.
    /// </summary>
    internal static class ModelAddressables
    {
        private const string LocatorId = "PartAdder.RuntimeModels";

        private static RuntimeModelProvider provider;
        private static RuntimeModelLocator locator;

        internal static string KeyFor(string prefabName)
        {
            // Same transformation as RocketPartSchema.GetModelName().
            return prefabName.Replace(".prefab", "_model.prefab");
        }

        internal static void Register(string key, GameObject model)
        {
            if (model == null)
            {
                throw new ArgumentNullException("model");
            }

            EnsureInitialized();
            provider.Add(key, model);
            locator.Add(key);
            Diagnostics.Info("Addressable model registered: " + key);
        }

        internal static void Unregister(string key)
        {
            if (provider != null)
            {
                provider.Remove(key);
                locator.Remove(key);
            }
        }

        private static void EnsureInitialized()
        {
            if (provider != null)
            {
                return;
            }

            try
            {
                provider = new RuntimeModelProvider();
                locator = new RuntimeModelLocator(provider.ProviderId);

                // GetResourceProvider() resolves by ProviderId while iterating this list,
                // so a provider added after Addressables initialization is picked up too.
                Addressables.ResourceManager.ResourceProviders.Add(provider);
                Addressables.AddResourceLocator(locator, null, null);
            }
            catch (Exception e)
            {
                provider = null;
                locator = null;
                throw new InvalidOperationException("Addressables model bridge could not be installed: " + e.Message, e);
            }
        }

        private sealed class RuntimeModelProvider : ResourceProviderBase
        {
            private readonly Dictionary<string, GameObject> models =
                new Dictionary<string, GameObject>(StringComparer.Ordinal);

            internal void Add(string key, GameObject model)
            {
                models[key] = model;
            }

            internal void Remove(string key)
            {
                models.Remove(key);
            }

            public override Type GetDefaultType(IResourceLocation location)
            {
                return typeof(GameObject);
            }

            public override void Provide(ProvideHandle handle)
            {
                string key = handle.Location == null ? null : handle.Location.PrimaryKey;
                GameObject model;
                if (key != null && models.TryGetValue(key, out model) && model != null)
                {
                    // The game asks for a reentry shell exactly when a flight starts, so the
                    // prefab cache is ready and the shell can still be switched to the game's
                    // own reentry material before the part clones it.
                    if (key.StartsWith("reentry/", StringComparison.Ordinal))
                    {
                        PartLoader.EnsureReentryMaterial(model);
                    }

                    handle.Complete(model, true, null);
                    return;
                }

                handle.Complete<GameObject>(null, false,
                    new InvalidOperationException("PartAdder has no runtime model registered for '" + key + "'"));
            }
        }

        private sealed class RuntimeModelLocator : IResourceLocator
        {
            private readonly Dictionary<object, IResourceLocation> locations =
                new Dictionary<object, IResourceLocation>();

            private readonly string providerId;

            internal RuntimeModelLocator(string providerId)
            {
                this.providerId = providerId;
            }

            public string LocatorId
            {
                get { return ModelAddressables.LocatorId; }
            }

            public IEnumerable<object> Keys
            {
                get { return locations.Keys; }
            }

            public bool Locate(object key, Type type, out IList<IResourceLocation> results)
            {
                IResourceLocation location;
                if (key != null && locations.TryGetValue(key, out location) &&
                    (type == null || type.IsAssignableFrom(typeof(GameObject))))
                {
                    results = new List<IResourceLocation>(1) { location };
                    return true;
                }

                results = null;
                return false;
            }

            internal void Add(string key)
            {
                locations[key] = new RuntimeModelLocation(key, providerId);
            }

            internal void Remove(string key)
            {
                locations.Remove(key);
            }
        }

        private sealed class RuntimeModelLocation : IResourceLocation
        {
            private readonly string key;
            private readonly string providerId;

            internal RuntimeModelLocation(string key, string providerId)
            {
                this.key = key;
                this.providerId = providerId;
            }

            public string InternalId
            {
                get { return key; }
            }

            public string ProviderId
            {
                get { return providerId; }
            }

            public IList<IResourceLocation> Dependencies
            {
                get { return Array.Empty<IResourceLocation>(); }
            }

            public int DependencyHashCode
            {
                get { return 0; }
            }

            public bool HasDependencies
            {
                get { return false; }
            }

            public string PrimaryKey
            {
                get { return key; }
            }

            public Type ResourceType
            {
                get { return typeof(GameObject); }
            }

            public object Data
            {
                get { return null; }
            }

            public int Hash(Type resultType)
            {
                return key.GetHashCode();
            }
        }
    }
}
