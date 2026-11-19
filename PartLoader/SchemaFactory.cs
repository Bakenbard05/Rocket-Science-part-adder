using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnbeGames.Model;
using Unity.Mathematics;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    internal static class SchemaFactory
    {
        internal static PartCategory ParseCategory(PartDefinition definition, out string error)
        {
            error = null;
            if (string.IsNullOrEmpty(definition.Category))
            {
                error = "category is required";
                return PartCategory.utility;
            }

            PartCategory category;
            if (Enum.TryParse(definition.Category.Trim(), true, out category) && category != PartCategory.none && category != PartCategory.all)
            {
                return category;
            }

            error = "unknown category '" + definition.Category + "'";
            return PartCategory.utility;
        }

        internal static RocketPartSchema Create(
            PartDefinition definition,
            BuiltPrefab built,
            PartCategory category,
            int defindex,
            string prefabName,
            string iconName,
            DynamicSockets.Result dynamicSockets)
        {
            var connections = new PartConnectionConfig[built.Connections.Count];
            for (int i = 0; i < built.Connections.Count; i++)
            {
                ConnectionInfo info = built.Connections[i];
                Vector3 direction = info.Rotation * Vector3.up;

                var sockets = new float3[info.Sockets.Count];
                for (int s = 0; s < info.Sockets.Count; s++)
                {
                    sockets[s] = new float3(info.Sockets[s].x, info.Sockets[s].y, info.Sockets[s].z);
                }

                connections[i] = new PartConnectionConfig
                {
                    id = (ushort)info.Id,
                    position = new float3(info.Position.x, info.Position.y, info.Position.z),
                    direction = new float3(direction.x, direction.y, direction.z),
                    rotation = new quaternion(info.Rotation.x, info.Rotation.y, info.Rotation.z, info.Rotation.w),
                    shape = info.Shape,
                    sockets = sockets,
                    flags = info.Flags,
                    center = new float3(info.Center.x, info.Center.y, info.Center.z),
                    dimensions = new float4(
                        info.Size.x,
                        info.Size.y,
                        info.Size.z,
                        Mathf.Min(info.Size.x, info.Size.z) * 0.5f)
                };
            }

            Vector3 comAdjustment = JsonHelp.Vector3Or(definition.CenterOfMassAdjustment, Vector3.zero);

            return new RocketPartSchema
            {
                defindex = defindex,
                name = string.IsNullOrEmpty(definition.Name) ? definition.Id : definition.Name,
                description = definition.Description ?? string.Empty,
                tags = definition.Tags ?? new string[0],
                category = category,
                mass = definition.Mass ?? 1f,
                impactTolerance = definition.ImpactTolerance ?? 10f,
                assemblyPosition = definition.AssemblyPosition ?? 0,
                prefabName = prefabName + ".prefab",
                iconName = iconName ?? string.Empty,
                radialSnapping = definition.RadialSnapping ?? -1f,
                centerOfMassAdjustment = new float3(comAdjustment.x, comAdjustment.y, comAdjustment.z),
                partConnections = connections,
                // The game turns these raw configs into its own DynamicAttachment
                // lists in the OnDeserialized hook of the schema (one socket per
                // shape bit), so the round-trip of Finalize is enough — see
                // DynamicSockets.
                dynamicAttachmentConfigs = dynamicSockets == null ? new DynamicAttachmentConfigItem[0] : dynamicSockets.Items,
                dynamicCurrPivot = dynamicSockets == null ? float3.zero : dynamicSockets.Pivot,
                config = definition.Modules ?? new JObject(),
                state = definition.State ?? new JObject(),
                variantsConfig = ResolveVariants(definition),
                thermoConfig = definition.Thermo,
                vfxConfig = new VFXConfig { explosion = "explosion_combined_0" },
                isDeprecated = false
            };
        }

        /// <summary>
        /// The game turns the raw variant list into typed variants itself (its schema does that
        /// in an OnDeserialized hook), so the loader only has to pass the tokens through. A
        /// variant with an unknown type would break the whole schema deserialization, so such
        /// variants are dropped with a warning.
        /// </summary>
        private static JToken[] ResolveVariants(PartDefinition definition)
        {
            if (definition.Variants == null || definition.Variants.Length == 0)
            {
                return null;
            }

            var variants = new List<JToken>();
            for (int i = 0; i < definition.Variants.Length; i++)
            {
                JToken token = definition.Variants[i];
                if (token == null || token.Type != JTokenType.Object)
                {
                    Diagnostics.Warn("variant #" + (i + 1) + " is not an object and was ignored");
                    continue;
                }

                string type = token["type"]?.ToObject<string>();
                if (!IsKnownVariantType(type))
                {
                    Diagnostics.Warn("variant #" + (i + 1) + " has an unknown type '" + type +
                                     "' and was ignored (use one of " + string.Join(", ", VariantTypes) + ")");
                    continue;
                }

                variants.Add(token);
            }

            return variants.Count > 0 ? variants.ToArray() : null;
        }

        private static bool IsKnownVariantType(string type)
        {
            if (string.IsNullOrEmpty(type))
            {
                return false;
            }

            for (int i = 0; i < VariantTypes.Length; i++)
            {
                if (string.Equals(VariantTypes[i], type, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>Variant types the game knows how to build.</summary>
        private static readonly string[] VariantTypes =
        {
            "contentsType", "decouplerModule", "passResources", "decoupleMode",
            "controlSurface", "electricMotor", "heatShield"
        };

        /// <summary>
        /// Round-trips the schema through the game's serializer so its own defaults
        /// (thermoSettings, thermoConfig merge, reentryName) are applied, then merges
        /// the optional "overrides" object. Identity fields are protected.
        /// </summary>
        internal static RocketPartSchema Finalize(RocketPartSchema schema, JObject overrides)
        {
            bool hasOverrides = overrides != null && overrides.Count > 0;
            int defindex = schema.defindex;
            string prefabName = schema.prefabName;
            string iconName = schema.iconName;

            try
            {
                JObject json = JObject.FromObject(schema);
                if (hasOverrides)
                {
                    json.Merge(overrides, new JsonMergeSettings
                    {
                        MergeArrayHandling = MergeArrayHandling.Replace,
                        MergeNullValueHandling = MergeNullValueHandling.Merge
                    });
                }

                RocketPartSchema patched = JsonConvert.DeserializeObject<RocketPartSchema>(json.ToString(Formatting.None));
                if (patched == null)
                {
                    throw new InvalidOperationException("schema round-trip produced an empty result");
                }

                patched.defindex = defindex;
                patched.prefabName = prefabName;
                patched.iconName = iconName;

                if (patched.category == PartCategory.none)
                {
                    patched.category = schema.category;
                }

                ValidateThermo(patched);

                if (hasOverrides)
                {
                    Diagnostics.Info("Applied overrides: " + string.Join(", ", GetKeys(overrides)));
                }

                return patched;
            }
            catch (Exception e)
            {
                Diagnostics.Warn((hasOverrides ? "overrides were ignored: " : "game defaults could not be applied: ") + e.Message);
                return schema;
            }
        }

        private static string[] GetKeys(JObject obj)
        {
            var keys = new List<string>();
            foreach (JProperty property in obj.Properties())
            {
                keys.Add(property.Name);
            }

            return keys.ToArray();
        }

        /// <summary>
        /// The game clamps the skin density inside schema.Merge в†’ ValidateAfterMerge: a
        /// skin heavier than the part itself (skinDensity * 0.0025 * area > mass) is cut
        /// to a quarter of the mass. That clamp runs before the round-trip and before the
        /// overrides, and the [OnDeserialized] hook of the round-trip rebuilds
        /// thermoSettings from thermoConfig — so the clamp never survives for mod parts.
        /// A part that flies with skin heavier than itself has a negative internal heat
        /// mass; the temperature jobs of the game put it into the denominator of an
        /// exponent, the exponent underflows to zero and 1 - 1/0 (the game only guards
        /// +Infinity) drives the temperature of the whole rocket to NaN. The game's own
        /// validation is therefore repeated on the final numbers.
        /// </summary>
        private static void ValidateThermo(RocketPartSchema schema)
        {
            if (schema.volumeData.volume == 0f)
            {
                Diagnostics.Warn(schema.prefabName + ": volume is 0 after the overrides, falling back to 1 m3");
                schema.volumeData.volume = 1f;
            }

            if (schema.volumeData.area == 0f)
            {
                Diagnostics.Warn(schema.prefabName + ": area is 0 after the overrides, falling back to 1 m2");
                schema.volumeData.area = 1f;
            }

            float skinMass = schema.thermoSettings.skinDensity * 0.0025f * schema.volumeData.area;
            if (skinMass == 0f || skinMass > schema.mass)
            {
                float clamped = schema.mass * 0.25f / (0.0025f * schema.volumeData.area);
                Diagnostics.Warn(schema.prefabName + ": the skin weighs " + JsonHelp.Invariant(skinMass) +
                                 " kg, more than the part itself (" + JsonHelp.Invariant(schema.mass) +
                                 " kg) — the rocket temperature goes NaN in flight. Skin density clamped " +
                                 JsonHelp.Invariant(schema.thermoSettings.skinDensity) + " -> " + JsonHelp.Invariant(clamped) + " kg/m3");
                schema.thermoSettings.skinDensity = clamped;
            }
        }
    }

    /// <summary>
    /// Runs the same baking sequence the game runs for stock parts, using only
    /// public RocketPartBaker entry points, then merges the baked data into the schema.
    /// </summary>
    internal static class PartPostprocessor
    {
        internal static PostprocessPartData Bake(RocketPartSchema schema, GameObject prefab, RocketPartBaker baker)
        {
            GameObject instance = UnityEngine.Object.Instantiate(prefab);
            instance.name = prefab.name;
            instance.transform.position = Vector3.zero;
            instance.transform.rotation = Quaternion.identity;
            instance.transform.localScale = Vector3.one;

            Transform modelTransform = instance.transform.Find(PrefabBuilder.ModelName);
            if (modelTransform == null)
            {
                UnityEngine.Object.Destroy(instance);
                throw new InvalidOperationException("prefab has no '" + PrefabBuilder.ModelName + "' child");
            }

            var data = new PostprocessPartData
            {
                slotPositions = new List<AttachmentData>(),
                cableAttachments = new List<CableAttachmentData>()
            };

            try
            {
                string modelName = schema.prefabName.Replace(".prefab", "_model.prefab");

                RocketPartBaker.BakePartVolume(modelTransform.gameObject, modelName, ref data.volumeData);
                RocketPartBaker.ProcessConnections(instance, ref data);
                RocketPartBaker.ProcessCableAttachments(instance, ref data);
                RocketPartBaker.ProcessAssemblyCollider(instance, ref data.assemblyCollider);
                RocketPartBaker.ProcessCenterOfMass(instance, ref data.centerOfMass, schema.centerOfMassAdjustment);

                if (baker == null)
                {
                    throw new InvalidOperationException("RocketPartBaker is not available; drag data cannot be baked");
                }

                baker.Bake(instance, ref data.dragData, AABBExtensions.ToBounds(data.volumeData.bounds), data.centerOfMass);

                if (schema.config != null && schema.HasPhysicsStateConfigs())
                {
                    baker.ProcessStates(instance, ref data, schema.GetStateNames());
                }

                if (schema.config != null && schema.HasPartStateConfig())
                {
                    baker.ProcessStateTransitions(instance, ref data, schema.GetPartStateConfig());
                }
            }
            finally
            {
                UnityEngine.Object.Destroy(instance);
            }

            if (data.slotPositions.Count != schema.partConnections.Length)
            {
                Diagnostics.Warn(schema.prefabName + ": " + schema.partConnections.Length + " schema connections but " +
                                 data.slotPositions.Count + " baked connections");
            }

            schema.Merge(data);
            return data;
        }
    }
}
