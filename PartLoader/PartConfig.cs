using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>Optional pack.json placed next to the part folders.</summary>
    internal sealed class PackDefinition
    {
        [JsonProperty("id")] public string Id;
        [JsonProperty("name")] public string Name;
        [JsonProperty("author")] public string Author;
        [JsonProperty("version")] public string Version;
        [JsonProperty("enabled")] public bool? Enabled;
    }

    /// <summary>Author-facing part.json. All paths are relative to the part folder.</summary>
    internal sealed class PartDefinition
    {
        [JsonProperty("formatVersion")] public int FormatVersion = 1;
        [JsonProperty("id")] public string Id;
        [JsonProperty("name")] public string Name;
        [JsonProperty("description")] public string Description;
        [JsonProperty("category")] public string Category;
        [JsonProperty("mass")] public float? Mass;
        [JsonProperty("tags")] public string[] Tags;
        [JsonProperty("impactTolerance")] public float? ImpactTolerance;
        [JsonProperty("assemblyPosition")] public int? AssemblyPosition;
        [JsonProperty("defindex")] public int? Defindex;

        [JsonProperty("model")] public string Model;
        [JsonProperty("units")] public string Units;
        [JsonProperty("scale")] public float? Scale;
        [JsonProperty("physicsModel")] public string PhysicsModel;
        /// <summary>Optional mesh used as the reentry shell of the part.</summary>
        [JsonProperty("reentryModel")] public string ReentryModel;
        [JsonProperty("icon")] public string Icon;

        [JsonProperty("material")] public MaterialDefinition Material;
        [JsonProperty("attachments")] public AttachmentDefinition[] Attachments;
        [JsonProperty("cableAttachments")] public CableAttachmentDefinition[] CableAttachments;

        [JsonProperty("centerOfMassAdjustment")] public JToken CenterOfMassAdjustment;
        [JsonProperty("radialSnapping")] public float? RadialSnapping;

        [JsonProperty("modules")] public JObject Modules;
        [JsonProperty("state")] public JObject State;
        [JsonProperty("thermo")] public JToken Thermo;

        /// <summary>Advanced escape hatch: raw RocketPartSchema fields applied after baking.</summary>
        [JsonProperty("overrides")] public JObject Overrides;

        /// <summary>Procedural motions of the model nodes, see PartAnimationDriver.</summary>
        [JsonProperty("animations")] public AnimationDefinition[] Animations;
        /// <summary>Per node materials, see MaterialFactory.</summary>
        [JsonProperty("materials")] public NodeMaterialDefinition[] Materials;
        /// <summary>
        /// Raw variants of the part (fuel types, decoupler modes, ...). The game builds the
        /// typed variants from these tokens, see SchemaFactory.ResolveVariants.
        /// </summary>
        [JsonProperty("variants")] public JToken[] Variants;
    }

    /// <summary>One procedural motion of a model node ("animations" in part.json).</summary>
    internal sealed class AnimationDefinition
    {
        [JsonProperty("path")] public string Path;
        [JsonProperty("type")] public string Type;
        [JsonProperty("axis")] public JToken Axis;
        [JsonProperty("speed")] public float? Speed;
        [JsonProperty("stowed")] public float? Stowed;
        [JsonProperty("deployed")] public float? Deployed;
        [JsonProperty("duration")] public float? Duration;
        [JsonProperty("trigger")] public string Trigger;
        /// <summary>Trigger that folds the node back, see PartAnimationDriver.</summary>
        [JsonProperty("foldTrigger")] public string FoldTrigger;
        /// <summary>Keyframes of the motion ("keys"), see PartAnimationDriver.</summary>
        [JsonProperty("keys")] public AnimationKeyDefinition[] Keys;
    }

    /// <summary>
    /// One keyframe of a motion: the angle of the node at that time.
    /// </summary>
    internal sealed class AnimationKeyDefinition
    {
        [JsonProperty("time")] public float Time;
        [JsonProperty("angle")] public float Angle;
        /// <summary>True (the default) interpolates the segment smoothly, false linearly.</summary>
        [JsonProperty("smooth")] public bool? Smooth;
    }

    internal sealed class MaterialDefinition
    {
        [JsonProperty("color")] public JToken Color;
        [JsonProperty("metallic")] public float? Metallic;
        [JsonProperty("smoothness")] public float? Smoothness;
        [JsonProperty("albedo")] public string Albedo;
        [JsonProperty("normal")] public string Normal;
        [JsonProperty("mask")] public string Mask;
        [JsonProperty("tiling")] public JToken Tiling;
        [JsonProperty("offset")] public JToken Offset;
        [JsonProperty("shader")] public string Shader;
        /// <summary>Emissive colour, for glowing windows or engine glow.</summary>
        [JsonProperty("emissive")] public JToken Emissive;
        [JsonProperty("emissiveIntensity")] public float? EmissiveIntensity;
        /// <summary>Opacity below 1 makes the part transparent.</summary>
        [JsonProperty("opacity")] public float? Opacity;
    }

    /// <summary>Material of a single model node ("materials" in part.json).</summary>
    internal sealed class NodeMaterialDefinition
    {
        /// <summary>Node path, for example "model/nozzle" or "nozzle".</summary>
        [JsonProperty("node")] public string Node;
        [JsonProperty("color")] public JToken Color;
        [JsonProperty("metallic")] public float? Metallic;
        [JsonProperty("smoothness")] public float? Smoothness;
        [JsonProperty("albedo")] public string Albedo;
        [JsonProperty("normal")] public string Normal;
        [JsonProperty("mask")] public string Mask;
        [JsonProperty("emissive")] public JToken Emissive;
        [JsonProperty("emissiveIntensity")] public float? EmissiveIntensity;
        [JsonProperty("opacity")] public float? Opacity;
    }

    internal sealed class AttachmentDefinition
    {
        /// <summary>Connection id (0..65535). Defaults to the attachment index.</summary>
        [JsonProperty("id")] public int? Id;
        [JsonProperty("name")] public string Name;
        [JsonProperty("position")] public JToken Position;
        [JsonProperty("direction")] public JToken Direction;
        /// <summary>Optional Euler rotation in degrees, overrides 'direction'.</summary>
        [JsonProperty("rotation")] public JToken Rotation;
        [JsonProperty("shape")] public string Shape;
        [JsonProperty("flags")]
        [JsonConverter(typeof(FlagsConverter))]
        public string Flags;
        /// <summary>Scales both the preset box and the preset socket spacing.</summary>
        [JsonProperty("spacing")] public JToken Spacing;
        [JsonProperty("size")] public JToken Size;
        [JsonProperty("center")] public JToken Center;
        [JsonProperty("sockets")] public JToken[] Sockets;
    }

    internal sealed class CableAttachmentDefinition
    {
        [JsonProperty("id")] public int? Id;
        [JsonProperty("name")] public string Name;
        [JsonProperty("position")] public JToken Position;
    }

    /// <summary>
    /// Reads 'flags' as the documented string ("dynamic, primary") and also
    /// accepts the array form written by older editor builds.
    /// </summary>
    internal sealed class FlagsConverter : JsonConverter
    {
        public override bool CanConvert(Type objectType)
        {
            return objectType == typeof(string);
        }

        public override object ReadJson(JsonReader reader, Type objectType, object existingValue, JsonSerializer serializer)
        {
            if (reader.TokenType == JsonToken.Null)
            {
                return null;
            }

            if (reader.TokenType == JsonToken.StartArray)
            {
                var flags = new List<string>();
                while (reader.Read() && reader.TokenType != JsonToken.EndArray)
                {
                    if (reader.TokenType == JsonToken.String)
                    {
                        flags.Add((string)reader.Value);
                    }
                }

                return string.Join(", ", flags);
            }

            if (reader.TokenType == JsonToken.String)
            {
                return (string)reader.Value;
            }

            throw new JsonSerializationException("'flags' must be a string such as \"dynamic, primary\"");
        }

        public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer)
        {
            writer.WriteValue((string)value);
        }
    }
}
