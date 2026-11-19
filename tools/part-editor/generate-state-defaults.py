# Generates the default state entries of the game modules from one table.
#
# The game creates a module only when its name is in the part state
# (RocketPart.DeserializeConfig), and the state is deserialized straight into
# the module struct without any defaults: an empty {} would make an engine
# limp (thrustLimiter 0) and a tank empty (amount 0). So a part.json that
# only lists the module in "modules" needs the values the stock parts carry.
#
# The table below is hand-picked from the 199 stock schemas (the most common
# state per module; "amount" is a -1 sentinel that means config.maxAmount).
#
# Output:
#   RSExtensionTemplate/PartLoader/ModuleStateDefaults.cs  (the loader fills
#       missing state entries from it)
#   tools/part-editor/state-defaults.js                   (the editor does the
#       same on load, so an exported part.json carries the entries already)
#
# Run: python tools/part-editor/generate-state-defaults.py
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))

# module -> default state. -1 in "amount" means "take config.maxAmount".
DEFAULTS = {
    'Model.AeroProtectionModule': {},
    'Model.AeroSurfaceModule': {},
    'Model.AntennaModule': {'bandwidthLimiter': 0.5, 'flags': 'isEnabled'},
    'Model.CockpitModule': {},
    'Model.CommandModule': {
        'autoCorrection': 'enabled',
        'currRotation': {'value': {'w': 1, 'x': 0, 'y': 0, 'z': 0}},
        'currThrustLimiter': 1,
        'targetRotation': {'value': {'w': 1, 'x': 0, 'y': 0, 'z': 0}},
    },
    'Model.CommandModuleProxy': {},
    'Model.ContinuousEffectModule': {},
    'Model.ControlSurfaceModule': {'control': {'w': 0, 'x': 0, 'y': 0, 'z': 0}, 'maxAngle': 0},
    'Model.CraftSpawnerModule': {},
    'Model.CryocoolerModule': {'flags': 'isEnabled', 'flowRatio': 1, 'massRatio': 1,
                               'targetPartId': 0, 'temperature': {'x': 600, 'y': 600}},
    'Model.DecouplerModule': {'decoupleMode': 'undock', 'forcePercent': 1},
    'Model.DockingPortModule': {'resourceTransfer': {}},
    'Model.DragCubeModifer': {},
    'Model.ElectricityModule': {'amount': -1},
    'Model.EngineEffectsModule': {},
    'Model.EngineGenerator': {},
    'Model.EngineGimbalModule': {},
    'Model.EngineModule': {'thrustLimiter': 1},
    'Model.HeatShieldModule': {'thickness': 0.1},
    'Model.InstrumentModule': {'enabledState': 0},
    'Model.JettisonModule': {},
    'Model.JointProducerModule': {},
    'Model.KeroseneModule': {'amount': -1},
    'Model.LandingStrutModule': {},
    'Model.LightModule': {'isEnabled': False},
    'Model.MirrorModule': {},
    'Model.N2H4Module': {'amount': -1},
    'Model.N2O4Module': {'amount': -1},
    'Model.O2Module': {'amount': -1},
    'Model.ParachuteModule': {},
    'Model.ParachuteSpawnerModule': {},
    'Model.PartStateModule': {},
    'Model.PartStateSoundsModule': {},
    'Model.PayloadFairingCapModule': {},
    'Model.PayloadFairingModule': {},
    'Model.PhysicsStateModule': {},
    'Model.PilotChuteModule': {},
    'Model.ProbeCoreModule': {'state': 100},
    'Model.RCSBlockModule': {},
    'Model.RCSModule': {'isEnabled': True, 'thrustLimiter': 1},
    'Model.ReactionWheelModule': {'isEnabled': True},
    'Model.ResourceSeparatorModule': {'passResources': False},
    'Model.RitegModule': {},
    'Model.RotationTrackingModule': {'filter': 'relay', 'flags': 'isEnabled', 'target': {}},
    'Model.RotationalSuspensionModule': {},
    'Model.RoverModule': {},
    'Model.SelfDestructionModule': {'delay': 5},
    'Model.SolarPanelModule': {},
    'Model.SplitedDecouplerModule': {},
    'Model.TurbopropModule': {},
    'Model.UDMHModule': {'amount': -1},
    'Model.VerticalAlignerModule': {},
    'Model.WheelModule': {'steeringAngle': 20, 'steeringSign': 1},
    'Model.WheelMultiModule': {'steeringAngle': 10, 'steeringSign': 1},
}

AMOUNT_MODULES = [name for name, state in DEFAULTS.items() if state.get('amount') == -1]


def csharp_literal(value, indent):
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, (int, float)):
        text = json.dumps(value)
        if isinstance(value, float) and '.' not in text and 'e' not in text:
            text += '0'
        return text + ('f' if isinstance(value, float) and text not in ('0',) else '')
    if isinstance(value, str):
        return '@"' + value.replace('"', '""') + '"'
    if isinstance(value, dict):
        lines = []
        for key, item in value.items():
            lines.append(' ' * indent + '["' + key + '"] = ' + csharp_literal(item, indent + 2) + ',')
        return 'new JObject\n    {\n' + '\n'.join(lines) + '\n' + ' ' * (indent - 4) + '}'
    if isinstance(value, list):
        return 'new JArray(' + ', '.join(csharp_literal(item, indent) for item in value) + ')'
    raise TypeError(type(value))


def write_csharp(path):
    out = io.StringIO()
    out.write('''using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// The default state entries of the game modules, generated by
    /// tools/part-editor/generate-state-defaults.py from the 199 stock schemas.
    ///
    /// The game creates a module only when its name is in the part state, and
    /// the state is deserialized straight into the module struct without any
    /// defaults (RocketModule(part, config, state): ToObject&lt;S&gt;()): an
    /// empty {} would make an engine limp (thrustLimiter 0) and a tank empty
    /// (amount 0). A part.json that only lists a module in "modules" gets the
    /// stock values here, so the author does not have to write any state.
    ///
    /// The value -1 in "amount" means "take config.maxAmount" (the stock parts
    /// always carry amount = maxAmount, a full tank).
    /// </summary>
    internal static class ModuleStateDefaults
    {
        private static readonly Dictionary<string, JObject> Defaults = new Dictionary<string, JObject>
        {
''')
    for name in sorted(DEFAULTS):
        state = DEFAULTS[name]
        out.write('            ["%s"] = ' % name)
        if not state:
            out.write('new JObject()')
        else:
            out.write(csharp_literal(state, 12))
        out.write(',\n')
    out.write('''        };

        /// <summary>The default state of a module, or null when the module is unknown.</summary>
        internal static JObject For(string module)
        {
            return Defaults.TryGetValue(module, out JObject state) ? (JObject)state.DeepClone() : null;
        }

        /// <summary>True when the table says the state has to carry the full amount.</summary>
        internal static bool WantsFullAmount(JObject state)
        {
            JToken amount = state["amount"];
            return amount != null && amount.Type == JTokenType.Integer && (int)amount == -1;
        }
    }
}
''')
    io.open(path, 'w', encoding='utf-8', newline='\r\n').write(out.getvalue())
    print('wrote', path)


def js_literal(value, indent):
    if isinstance(value, dict):
        lines = []
        for key, item in value.items():
            lines.append(' ' * indent + '%s: %s,' % (json.dumps(key), js_literal(item, indent + 2)))
        return '{\n' + '\n'.join(lines) + '\n' + ' ' * (indent - 2) + '}'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    return json.dumps(value)


def write_js(path):
    out = io.StringIO()
    out.write('// The default state entries of the game modules: GENERATED by\n')
    out.write('// generate-state-defaults.py from the 199 stock schemas, do not edit.\n')
    out.write('//\n')
    out.write('// The game creates a module only when its name is in the part state, and the\n')
    out.write('// state is read straight into the module struct without defaults: an empty {}\n')
    out.write('// would make an engine limp (thrustLimiter 0) and a tank empty (amount 0). The\n')
    out.write('// editor fills the missing entries with these values when a part is loaded, so\n')
    out.write('// the author never has to write a state by hand. The value -1 in "amount"\n')
    out.write('// means "take config.maxAmount" (the stock parts always carry a full tank).\n\n')
    out.write('export const STATE_DEFAULTS = {\n')
    for name in sorted(DEFAULTS):
        state = DEFAULTS[name]
        if state:
            out.write('  %s: %s,\n' % (json.dumps(name), js_literal(state, 4)))
        else:
            out.write('  %s: {},\n' % json.dumps(name))
    out.write('};\n')
    io.open(path, 'w', encoding='utf-8', newline='\n').write(out.getvalue())
    print('wrote', path)


if __name__ == '__main__':
    write_csharp(os.path.join(ROOT, 'RSExtensionTemplate', 'PartLoader', 'ModuleStateDefaults.cs'))
    write_js(os.path.join(HERE, 'state-defaults.js'))
