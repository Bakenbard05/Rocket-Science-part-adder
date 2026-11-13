using System.Collections.Generic;
using System.Text;
using UnbeGames.Controller;
using UnbeGames.Model;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Writes what the game made of the part into the player log: the modules it
    /// created and the flame of the engine.
    ///
    /// The game creates the modules of a part by walking its state, so a module
    /// of the config without an entry in the state is missing at runtime and the
    /// log of the loader can not show it. The component sits on the part prefab,
    /// so every placed instance of the part writes the line in the flight.
    /// </summary>
    public sealed class PartDiagnostics : MonoBehaviour
    {
        private void Start()
        {
            RocketPartCtrl ctrl = GetComponentInParent<RocketPartCtrl>();
            if (ctrl == null || ctrl.part == null)
            {
                Debug.Log("[PartAdder] diagnostics: the part view was not found");
                return;
            }

            var text = new StringBuilder();
            text.Append("[PartAdder] part ").Append(ctrl.part.strId).Append(" modules:");
            foreach (KeyValuePair<System.Type, BaseRocketModule> module in ctrl.part.modules)
            {
                text.Append(' ').Append(module.Key.Name);
            }

            EngineEffectsModule effects = ctrl.part.GetModule<EngineEffectsModule>();
            text.Append(" | effects: ");
            if (effects == null)
            {
                text.Append("MISSING");
            }
            else
            {
                text.Append("flames=").Append(string.Join(",", effects.Flames ?? new string[0]));
                text.Append(" sound=").Append(effects.Sound ?? "-");
            }

            text.Append(" | flame prefabs:");
            string[] flames = effects != null ? effects.Flames : null;
            if (flames != null)
            {
                for (int i = 0; i < flames.Length; i++)
                {
                    GameObject prefab;
                    bool found = CacheAccess.TryGetPrefab(flames[i], out prefab);
                    text.Append(' ').Append(flames[i]).Append('=').Append(found ? "found" : "MISSING");
                }
            }

            Debug.Log(text.ToString());
        }
    }
}
