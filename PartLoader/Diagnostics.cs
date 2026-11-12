using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnbeGames.Support;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Collects loader diagnostics and mirrors them into the game log.
    /// Never throws: a broken log file must not break part loading.
    /// </summary>
    internal static class Diagnostics
    {
        private const string Prefix = "[PartAdder] ";

        internal static readonly List<string> Errors = new List<string>();
        internal static readonly List<string> Warnings = new List<string>();
        internal static readonly List<string> Lines = new List<string>();

        internal static string LogFilePath;

        internal static void Reset(string logFilePath)
        {
            Errors.Clear();
            Warnings.Clear();
            Lines.Clear();
            LogFilePath = logFilePath;
        }

        internal static void Info(string message)
        {
            string line = Prefix + message;
            Lines.Add(line);
            try { Log.Info(line); } catch { }
        }

        /// <summary>Only written when the verbose setting is on.</summary>
        internal static void Verbose(string message)
        {
            if (!ModSettings.Verbose)
            {
                return;
            }

            Info(message);
        }

        internal static void Warn(string message)
        {
            Warnings.Add(message);
            string line = Prefix + "WARNING: " + message;
            Lines.Add(line);
            try { Log.Warn(line, null); } catch { }
        }

        internal static void Error(string message)
        {
            Errors.Add(message);
            string line = Prefix + "ERROR: " + message;
            Lines.Add(line);
            try { Log.Error(line, null); } catch { }
        }

        internal static void Exception(string message, Exception exception)
        {
            string text = message + ": " + (exception == null ? "unknown error" : exception.GetType().Name + ": " + exception.Message);
            Errors.Add(text);
            string line = Prefix + "ERROR: " + text;
            Lines.Add(line);
            try { Log.Exception(line, exception); } catch { }
        }

        internal static void Flush(int packs, int loaded, int failed)
        {
            if (string.IsNullOrEmpty(LogFilePath))
            {
                return;
            }

            try
            {
                var builder = new StringBuilder();
                builder.AppendLine("PartAdder log - " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
                builder.AppendLine("Packs: " + packs + ", parts loaded: " + loaded + ", parts failed: " + failed);
                builder.AppendLine();
                foreach (string line in Lines)
                {
                    builder.AppendLine(line);
                }

                File.WriteAllText(LogFilePath, builder.ToString(), Encoding.UTF8);
            }
            catch (Exception e)
            {
                try { Log.Warn(Prefix + "Could not write " + LogFilePath + ": " + e.Message, null); } catch { }
            }
        }
    }
}
