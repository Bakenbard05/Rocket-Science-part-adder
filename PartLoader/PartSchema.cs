using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// The schema of part.json (docs/part.schema.json) is the one description of the
    /// format: the loader validates every part against it, and the editor shows the
    /// same rules, so the two cannot drift apart.
    ///
    /// The schema is embedded into the DLL (the docs folder is not shipped with the
    /// mod), and the subset of JSON Schema it uses is small: type, required,
    /// properties, additionalProperties, enum, the number and string limits, items,
    /// $ref into the definitions of the document and oneOf.
    /// </summary>
    internal static class PartSchema
    {
        private const string ResourceName = "part.schema.json";

        private static JObject document;
        private static bool attempted;

        /// <summary>The findings of one check: what is wrong and what only looks wrong.</summary>
        internal sealed class Result
        {
            internal readonly List<string> Errors = new List<string>();
            internal readonly List<string> Warnings = new List<string>();
        }

        /// <summary>The schema itself, or null when it could not be read.</summary>
        internal static JObject Document
        {
            get
            {
                if (!attempted)
                {
                    attempted = true;
                    document = Load();
                }

                return document;
            }
        }

        private static JObject Load()
        {
            try
            {
                Assembly assembly = typeof(PartSchema).Assembly;
                using (Stream stream = assembly.GetManifestResourceStream(ResourceName))
                {
                    if (stream == null)
                    {
                        Diagnostics.Warn("The schema of part.json is not in the DLL, the format is not checked");
                        return null;
                    }

                    using (var reader = new StreamReader(stream))
                    {
                        return JObject.Parse(reader.ReadToEnd());
                    }
                }
            }
            catch (Exception e)
            {
                Diagnostics.Warn("The schema of part.json could not be read: " + e.Message);
                return null;
            }
        }

        /// <summary>
        /// Checks a part.json against the schema. The messages name the field and say
        /// what is wrong with it, the same way the editor writes them.
        /// </summary>
        internal static Result Validate(JObject part)
        {
            var result = new Result();
            JObject schema = Document;
            if (schema == null || part == null)
            {
                return result;
            }

            Validate(part, schema, string.Empty, schema, result);
            return result;
        }

        private static void Validate(JToken instance, JObject schema, string path, JObject root, Result result)
        {
            if (schema == null)
            {
                return;
            }

            JToken reference = schema["$ref"];
            if (reference != null)
            {
                JObject target = Resolve(reference.Value<string>(), root);
                if (target != null)
                {
                    Validate(instance, target, path, root, result);
                }

                return;
            }

            JToken alternatives = schema["oneOf"];
            if (alternatives is JArray forms)
            {
                if (!MatchesAny(instance, forms, path, root))
                {
                    var first = new Result();
                    Validate(instance, forms.Count > 0 ? forms[0] as JObject : null, path, root, first);
                    result.Errors.Add(first.Errors.Count > 0 ? first.Errors[0] : Describe(path) + " has not an allowed form");
                }

                return;
            }

            string type = schema["type"]?.Value<string>();
            if (type != null && !MatchesType(instance, type))
            {
                result.Errors.Add(Describe(path) + " must be " + type);
                return;
            }

            JToken allowed = schema["enum"];
            if (allowed is JArray values && !Contains(values, instance))
            {
                var names = new List<string>();
                for (int i = 0; i < values.Count; i++)
                {
                    names.Add(values[i].ToString());
                }

                result.Errors.Add(Describe(path) + " must be one of " + string.Join(", ", names.ToArray()));
            }
            if (instance.Type == JTokenType.Integer || instance.Type == JTokenType.Float)
            {
                double number = instance.Value<double>();
                Check(schema, "minimum", number, path, result, "at least ");
                Check(schema, "maximum", number, path, result, "at most ");
                CheckExclusive(schema, "exclusiveMinimum", number, path, result, "more than ");
                CheckExclusive(schema, "exclusiveMaximum", number, path, result, "less than ");
            }

            if (instance.Type == JTokenType.String)
            {
                string text = instance.Value<string>();
                int minLength = schema["minLength"]?.Value<int>() ?? 0;
                if (text.Length < minLength)
                {
                    result.Errors.Add(Describe(path) + " must have at least " + minLength + " characters");
                }

                int maxLength = schema["maxLength"]?.Value<int>() ?? int.MaxValue;
                if (text.Length > maxLength)
                {
                    result.Errors.Add(Describe(path) + " must have at most " + maxLength + " characters");
                }

                string pattern = schema["pattern"]?.Value<string>();
                if (pattern != null && !Regex.IsMatch(text, pattern))
                {
                    result.Errors.Add(Describe(path) + " does not match " + pattern);
                }
            }

            if (instance.Type == JTokenType.Array)
            {
                var array = (JArray)instance;
                int minItems = schema["minItems"]?.Value<int>() ?? 0;
                if (array.Count < minItems)
                {
                    result.Errors.Add(Describe(path) + (minItems == 1
                        ? " must have at least one entry"
                        : " must have at least " + minItems + " entries"));
                }

                if (schema["items"] is JObject itemSchema)
                {
                    for (int i = 0; i < array.Count; i++)
                    {
                        Validate(array[i], itemSchema, path + "[" + i + "]", root, result);
                    }
                }
            }

            if (instance.Type != JTokenType.Object)
            {
                return;
            }

            var obj = (JObject)instance;
            JToken required = schema["required"];
            if (required is JArray requiredNames)
            {
                for (int i = 0; i < requiredNames.Count; i++)
                {
                    string name = requiredNames[i].Value<string>();
                    if (obj[name] == null)
                    {
                        result.Errors.Add(Describe(Join(path, name)) + " is required");
                    }
                }
            }

            bool noExtras = false;
            JToken additional = schema["additionalProperties"];
            if (additional is JValue flag && flag.Type == JTokenType.Boolean)
            {
                noExtras = !flag.Value<bool>();
            }

            JToken properties = schema["properties"];
            if (properties is JObject propertyList)
            {
                foreach (JProperty property in obj.Properties())
                {
                    if (propertyList[property.Name] is JObject propertySchema)
                    {
                        Validate(property.Value, propertySchema, Join(path, property.Name), root, result);
                    }
                    else if (noExtras)
                    {
                        // A field the schema does not know: the part still works, but
                        // the author wanted something that is not there.
                        result.Warnings.Add(Describe(Join(path, property.Name)) + " is not a known field (it is ignored)");
                    }
                }
            }
        }

        private static void Check(JObject schema, string key, double number, string path, Result result, string word)
        {
            JToken limit = schema[key];
            if (limit == null)
            {
                return;
            }

            double value = limit.Value<double>();
            bool broken = key == "minimum" ? number < value : number > value;
            if (broken)
            {
                result.Errors.Add(Describe(path) + " must be " + word + JsonHelp.Invariant(value));
            }
        }

        private static void CheckExclusive(JObject schema, string key, double number, string path, Result result, string word)
        {
            JToken limit = schema[key];
            if (limit == null)
            {
                return;
            }

            double value = limit.Value<double>();
            bool broken = key == "exclusiveMinimum" ? number <= value : number >= value;
            if (broken)
            {
                result.Errors.Add(Describe(path) + " must be " + word + JsonHelp.Invariant(value));
            }
        }

        private static bool MatchesAny(JToken instance, JArray forms, string path, JObject root)
        {
            for (int i = 0; i < forms.Count; i++)
            {
                var errors = new Result();
                Validate(instance, forms[i] as JObject, path, root, errors);
                if (errors.Errors.Count == 0)
                {
                    return true;
                }
            }

            return false;
        }

        private static bool MatchesType(JToken instance, string type)
        {
            switch (type)
            {
                case "object":
                    return instance.Type == JTokenType.Object;
                case "array":
                    return instance.Type == JTokenType.Array;
                case "string":
                    return instance.Type == JTokenType.String;
                case "number":
                    return instance.Type == JTokenType.Integer || instance.Type == JTokenType.Float;
                case "integer":
                    return instance.Type == JTokenType.Integer;
                case "boolean":
                    return instance.Type == JTokenType.Boolean;
                case "null":
                    return instance.Type == JTokenType.Null;
                default:
                    return true;
            }
        }

        private static bool Contains(JArray values, JToken instance)
        {
            for (int i = 0; i < values.Count; i++)
            {
                if (values[i].Type == instance.Type && string.Equals(values[i].ToString(), instance.ToString(), StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }

        private static JObject Resolve(string reference, JObject root)
        {
            if (string.IsNullOrEmpty(reference) || !reference.StartsWith("#/", StringComparison.Ordinal))
            {
                return null;
            }

            JToken current = root;
            string[] parts = reference.Substring(2).Split('/');
            for (int i = 0; i < parts.Length; i++)
            {
                if (current == null)
                {
                    return null;
                }

                current = current[parts[i]];
            }

            return current as JObject;
        }

        private static string Join(string path, string name)
        {
            return string.IsNullOrEmpty(path) ? name : path + "." + name;
        }

        private static string Describe(string path)
        {
            return string.IsNullOrEmpty(path) ? "the part" : "'" + path + "'";
        }
    }
}
