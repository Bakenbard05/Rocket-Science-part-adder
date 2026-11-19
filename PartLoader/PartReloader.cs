using System;
using System.IO;
using System.Text;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Watches the parts folder of the mod and builds the parts again when a file
    /// changes. The author saves a part.json (or a mesh) in the editor, exports it
    /// into the mod folder, and the game picks it up within a second: no restart
    /// between two tries.
    ///
    /// The watcher only looks at the names and the times of the files, so it costs
    /// nothing when nothing changes. It can be switched off in "PartAdder.json"
    /// ("autoReload": false).
    /// </summary>
    internal static class PartReloader
    {
        /// <summary>How often the folder is looked at, in seconds.</summary>
        private const float PollInterval = 1f;

        private static string partsDirectory;
        private static string signature;
        private static float nextCheck;

        /// <summary>Prepares the watcher for the parts folder of the mod.</summary>
        internal static void Watch(string modDirectory)
        {
            partsDirectory = string.IsNullOrEmpty(modDirectory) ? null : Path.Combine(modDirectory, "Parts");
            signature = null;
            nextCheck = 0f;
        }

        /// <summary>
        /// Looks at the folder once a second and reloads the parts when something
        /// changed. Called every frame by the extension.
        /// </summary>
        internal static void Tick()
        {
            if (!ModSettings.AutoReload || string.IsNullOrEmpty(partsDirectory))
            {
                return;
            }

            if (Time.realtimeSinceStartup < nextCheck)
            {
                return;
            }

            nextCheck = Time.realtimeSinceStartup + PollInterval;

            string current = Signature();
            if (current == signature)
            {
                return;
            }

            bool first = signature == null;
            signature = current;
            if (first)
            {
                // The first look only remembers how the folder looks now.
                return;
            }

            Diagnostics.Info("The parts folder changed, the parts are built again");
            try
            {
                PartLoader.ReloadAll();

                // The grid of the shop does not look at the cache on its own while
                // the author is in the building scene: sync it right away, so the
                // changed parts show up without leaving the mode.
                ShopRefresh.Refresh();
            }
            catch (Exception e)
            {
                Diagnostics.Exception("The parts could not be reloaded", e);
            }
        }

        /// <summary>
        /// The names, the times and the sizes of the files of the parts folder. A
        /// change of any of them means that something was written.
        /// </summary>
        private static string Signature()
        {
            try
            {
                if (!Directory.Exists(partsDirectory))
                {
                    return string.Empty;
                }

                string[] files = Directory.GetFiles(partsDirectory, "*", SearchOption.AllDirectories);
                Array.Sort(files, StringComparer.OrdinalIgnoreCase);

                var builder = new StringBuilder();
                for (int i = 0; i < files.Length; i++)
                {
                    var info = new FileInfo(files[i]);
                    builder.Append(info.FullName)
                        .Append('|')
                        .Append(info.LastWriteTimeUtc.Ticks)
                        .Append('|')
                        .Append(info.Length)
                        .Append(';');
                }

                return builder.ToString();
            }
            catch (Exception)
            {
                // A folder that cannot be read is simply not watched.
                return string.Empty;
            }
        }
    }
}
