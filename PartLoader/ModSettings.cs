using System;
using System.IO;
using Newtonsoft.Json.Linq;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Optional settings file "PartAdder.json" next to the DLL:
    /// {
    ///   "verbose": false,        // more messages in PartAdder.log
    ///   "drawIcons": true,       // draw a shop icon from the model when no icon file is given
    ///   "checkDefindex": true,   // refuse defindexes that clash with another part
    ///   "maxTextureSize": 2048,  // textures larger than this are scaled down
    ///   "autoReload": true       // build the parts again when a file of "Parts" changes
    /// }
    /// </summary>
    internal static class ModSettings
    {
        internal const string FileName = "PartAdder.json";

        internal static bool Verbose { get; private set; }
        internal static bool DrawIcons { get; private set; }
        internal static bool CheckDefindex { get; private set; }
        internal static int MaxTextureSize { get; private set; }

        /// <summary>Build the parts again when a file of the parts folder changes.</summary>
        internal static bool AutoReload { get; private set; }

        internal static void Load(string modDirectory)
        {
            Verbose = false;
            DrawIcons = true;
            CheckDefindex = true;
            MaxTextureSize = 2048;
            AutoReload = true;

            if (string.IsNullOrEmpty(modDirectory))
            {
                return;
            }

            string path = Path.Combine(modDirectory, FileName);
            if (!File.Exists(path))
            {
                return;
            }

            try
            {
                JObject json = JObject.Parse(File.ReadAllText(path));
                Verbose = json["verbose"]?.ToObject<bool>() ?? Verbose;
                DrawIcons = json["drawIcons"]?.ToObject<bool>() ?? DrawIcons;
                CheckDefindex = json["checkDefindex"]?.ToObject<bool>() ?? CheckDefindex;
                MaxTextureSize = json["maxTextureSize"]?.ToObject<int>() ?? MaxTextureSize;
                if (MaxTextureSize < 64)
                {
                    MaxTextureSize = 64;
                }

                AutoReload = json["autoReload"]?.ToObject<bool>() ?? AutoReload;

                Diagnostics.Info("Settings loaded from " + FileName);
            }
            catch (Exception e)
            {
                Diagnostics.Warn("Could not read " + FileName + ": " + e.Message);
            }
        }
    }
}
