using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using UnbeGames.Model;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Refreshes the part grid of the assembly shop after the parts were reloaded
    /// without a restart. The grid of the game (UnbeGames.UI.AssemblyParts) is built
    /// once per entry into the building scene (AssemblyShopController.Attach calls
    /// Setup), so a hot reload passes unnoticed while the author stays in the mode.
    ///
    /// This finds the window and syncs its items with the live cache: parts that are
    /// gone or were built again (a fresh schema object) are returned to the window's
    /// own pool, new parts are added, the siblings are ordered like Setup orders
    /// them, and the current filters are applied. Everything of the window is
    /// private, so every step is looked up by reflection and a game update that
    /// renames one of them only skips the refresh with a log line — the parts
    /// themselves keep working, the grid is then simply rebuilt on the next entry
    /// into the building scene.
    /// </summary>
    internal static class ShopRefresh
    {
        private static Type windowType;
        private static FieldInfo moduleField;
        private static FieldInfo itemsField;
        private static FieldInfo itemsByIdField;
        private static FieldInfo poolField;
        private static PropertyInfo itemPartProperty;
        private static MethodInfo addPartMethod;
        private static MethodInfo filterMethod;
        private static MethodInfo reclaimMethod;
        private static bool initialized;
        private static bool broken;

        internal static void Refresh()
        {
            if (broken)
            {
                return;
            }

            try
            {
                if (!initialized)
                {
                    Initialize();
                    initialized = true;
                }
            }
            catch (Exception e)
            {
                // A renamed member only means the grid is rebuilt on the next entry
                // into the building scene, like before this class existed.
                broken = true;
                Diagnostics.Warn("The shop grid cannot be refreshed (the game changed): " + e.Message);
                return;
            }

            try
            {
                Component window = FindObjectOfType(windowType);
                if (window == null)
                {
                    // The shop is not on the screen: its Setup rebuilds the grid
                    // from the cache the next time the author enters the scene.
                    return;
                }

                RefreshWindow(window);
            }
            catch (Exception e)
            {
                Diagnostics.Warn("The shop grid could not be refreshed: " + e.Message);
            }
        }

        private static void RefreshWindow(Component window)
        {
            AssemblyShopModule module = moduleField.GetValue(window) as AssemblyShopModule;
            if (module == null)
            {
                return;
            }

            // What the grid has to show after the reload.
            var available = new Dictionary<int, RocketPartSchema>();
            foreach (RocketPartSchema schema in module.GetAvailableParts())
            {
                if (schema != null)
                {
                    available[schema.defindex] = schema;
                }
            }

            IDictionary byId = (IDictionary)itemsByIdField.GetValue(window);
            if (byId == null)
            {
                return;
            }

            // Gone or rebuilt: the schema object of a reloaded part is a new one,
            // so a reference comparison finds every part the reload touched.
            var stale = new List<object>();
            foreach (DictionaryEntry entry in byId)
            {
                int defindex = (int)entry.Key;
                RocketPartSchema schema;
                bool alive = available.TryGetValue(defindex, out schema);
                if (alive)
                {
                    alive = ReferenceEquals(itemPartProperty.GetValue(entry.Value), schema);
                }

                if (!alive)
                {
                    stale.Add(entry.Value);
                }
            }

            int removed = 0;
            if (stale.Count > 0)
            {
                IList items = (IList)itemsField.GetValue(window);
                object pool = poolField.GetValue(window);
                Type itemType = itemsField.FieldType.GetGenericArguments()[0];
                foreach (object item in stale)
                {
                    // Hide() and back into the pool of the window, the same way
                    // the game itself recycles the items of the grid.
                    reclaimMethod.MakeGenericMethod(itemType).Invoke(pool, new[] { item });
                    if (items != null)
                    {
                        items.Remove(item);
                    }

                    var schema = (RocketPartSchema)itemPartProperty.GetValue(item);
                    byId.Remove(schema.defindex);
                    removed++;
                }
            }

            int added = 0;
            foreach (KeyValuePair<int, RocketPartSchema> pair in available)
            {
                if (!byId.Contains(pair.Key))
                {
                    addPartMethod.Invoke(window, new object[] { pair.Value });
                    added++;
                }
            }

            if (added > 0)
            {
                OrderItems(window);
            }

            if (added == 0 && removed == 0)
            {
                return;
            }

            // Re-apply the search and the category filters, so the new parts show
            // up under the same filter the author currently looks at.
            filterMethod.Invoke(window, null);
            Diagnostics.Info("The shop grid was refreshed: " + added + " added, " + removed + " removed");
        }

        /// <summary>
        /// Orders the items of the grid the way Setup does it (category, then
        /// defindex + assemblyPosition), so a re-added part does not land at the
        /// end of the panel but between its neighbours.
        /// </summary>
        private static void OrderItems(Component window)
        {
            IList items = (IList)itemsField.GetValue(window);
            if (items == null || items.Count == 0)
            {
                return;
            }

            var ordered = new List<object>();
            foreach (object item in items)
            {
                ordered.Add(item);
            }

            ordered.Sort(CompareItems);
            for (int i = 0; i < ordered.Count; i++)
            {
                Component component = ordered[i] as Component;
                if (component != null)
                {
                    component.transform.SetSiblingIndex(i);
                }
            }
        }

        private static int CompareItems(object left, object right)
        {
            RocketPartSchema a = itemPartProperty.GetValue(left) as RocketPartSchema;
            RocketPartSchema b = itemPartProperty.GetValue(right) as RocketPartSchema;
            if (a == null || b == null)
            {
                return a == null ? (b == null ? 0 : 1) : -1;
            }

            if (a.category != b.category)
            {
                return a.category.CompareTo(b.category);
            }

            return (a.defindex + a.assemblyPosition).CompareTo(b.defindex + b.assemblyPosition);
        }

        private static Component FindObjectOfType(Type type)
        {
            Array found = UnityEngine.Object.FindObjectsOfType(type);
            return found.Length > 0 ? (Component)found.GetValue(0) : null;
        }

        private static void Initialize()
        {
            windowType = FindType("UnbeGames.UI.AssemblyParts");
            if (windowType == null)
            {
                throw new InvalidOperationException("the type UnbeGames.UI.AssemblyParts does not exist");
            }

            moduleField = RequireField(windowType, "module");
            itemsField = RequireField(windowType, "parts");
            itemsByIdField = RequireField(windowType, "partById");
            poolField = RequireField(windowType, "pool");

            Type itemType = itemsField.FieldType.GetGenericArguments()[0];
            itemPartProperty = itemType.GetProperty("part", BindingFlags.Public | BindingFlags.Instance);
            if (itemPartProperty == null)
            {
                throw new InvalidOperationException("AssemblyPartItem.part does not exist");
            }

            addPartMethod = windowType.GetMethod("AddPart", BindingFlags.NonPublic | BindingFlags.Instance);
            if (addPartMethod == null || addPartMethod.GetParameters().Length != 1)
            {
                throw new InvalidOperationException("AssemblyParts.AddPart does not exist");
            }

            filterMethod = windowType.GetMethod("Filter", BindingFlags.NonPublic | BindingFlags.Instance);
            if (filterMethod == null || filterMethod.GetParameters().Length != 0)
            {
                throw new InvalidOperationException("AssemblyParts.Filter does not exist");
            }

            foreach (MethodInfo method in poolField.FieldType.GetMethods(BindingFlags.Public | BindingFlags.Instance))
            {
                if (method.Name == "Reclaim" && method.IsGenericMethodDefinition &&
                    method.GetParameters().Length == 1)
                {
                    reclaimMethod = method;
                    break;
                }
            }

            if (reclaimMethod == null)
            {
                throw new InvalidOperationException("CustomGameObjectPool.Reclaim does not exist");
            }
        }

        private static FieldInfo RequireField(Type type, string name)
        {
            FieldInfo field = type.GetField(name, BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Public);
            if (field == null)
            {
                throw new InvalidOperationException(type.Name + "." + name + " does not exist");
            }

            return field;
        }

        private static Type FindType(string fullName)
        {
            foreach (Assembly assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type type = assembly.GetType(fullName, false);
                if (type != null)
                {
                    return type;
                }
            }

            return null;
        }
    }
}
