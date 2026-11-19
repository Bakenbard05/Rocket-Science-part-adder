"""
Generates tools/part-editor/dynamic-presets.js from the game's dynamic attachment
configs, so the editor can offer the configs the game itself knows.

The configs live in the "schemas" bundle of the game:
    Assets/Schemas/dynamic_attachments/parent/{radial,spherical,directional}.json
    Assets/Schemas/dynamic_attachments/current/{radial,directional}.json
Every entry is a DynamicAttachmentConfig: its defindex names it, the sign of the
defindex says which end of the connection it is (>= 0 parent, < 0 current), and
rotation / restrictType / restrictDir / restrictAngle describe where the socket
is allowed to sit on the surface.

Usage:
    python generate-dynamic-presets.py
    python generate-dynamic-presets.py --bundle "D:\\...\\schemas_group_....bundle"
    python generate-dynamic-presets.py --dump "C:\\temp\\dynamic_schemas" --keep
"""

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.join(HERE, 'dynamic-presets.js')

DEFAULT_GAME = r'E:\SteamLibrary\steamapps\common\Rocket Science'
BUNDLE_NAME = 'schemas_group_assets_all_31b1a81c16a2601163133b472cd30578.bundle'
ROLES = ('parent', 'current')


def find_bundle(game):
    assets = os.path.join(game, 'Rocket Science_Data', 'StreamingAssets', 'aa', 'StandaloneWindows64')
    path = os.path.join(assets, BUNDLE_NAME)
    if os.path.isfile(path):
        return path
    if os.path.isdir(assets):
        for name in sorted(os.listdir(assets)):
            if name.startswith('schemas_group') and name.endswith('.bundle'):
                return os.path.join(assets, name)
    return None


def read_bundle(bundle):
    """Returns {('parent', 'radial'): text, ...} from the schemas bundle."""
    import UnityPy  # imported here so --dump works without it

    documents = {}
    env = UnityPy.load(bundle)
    for path, obj in env.container.items():
        if 'dynamic_attachments' not in path:
            continue
        parts = path.split('/')
        if len(parts) < 4 or parts[-3] not in ROLES:
            continue
        content = obj.read().m_Script
        if not isinstance(content, str):
            content = content.decode('utf-8', 'replace')
        documents[(parts[-3], os.path.splitext(parts[-1])[0])] = content
    return documents


def read_dump(folder):
    """Returns the same mapping from a folder of <role>_<kind>.json files."""
    documents = {}
    for name in os.listdir(folder):
        match = re.match(r'^(parent|current)_([a-z]+)\.json$', name)
        if not match:
            continue
        with open(os.path.join(folder, name), 'r', encoding='utf-8') as handle:
            documents[(match.group(1), match.group(2))] = handle.read()
    return documents


def parse_configs(text):
    """Newtonsoft accepts a trailing comma, Python's json does not."""
    cleaned = re.sub(r',(\s*[}\]])', r'\1', text)
    return json.loads(cleaned)


def number(value):
    rounded = round(float(value), 6)
    if rounded == 0:
        return 0
    text = ('%.6f' % rounded).rstrip('0').rstrip('.')
    return text


def vec(value, default):
    if not isinstance(value, dict):
        return default
    return [number(value.get(axis, 0)) for axis in ('x', 'y', 'z')]


def angle(value):
    if not isinstance(value, dict):
        return None
    a = float(value.get('x', 0))
    b = float(value.get('y', 0))
    if a == 0 and b == 0:
        return None
    return [number(a), number(b)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--game', default=DEFAULT_GAME)
    parser.add_argument('--bundle', default=None)
    parser.add_argument('--dump', default=None, help='Folder of <role>_<kind>.json files')
    parser.add_argument('--keep', action='store_true', help='Write the raw configs into --dump')
    args = parser.parse_args()

    if args.dump and not args.keep:
        documents = read_dump(args.dump)
    else:
        bundle = args.bundle or find_bundle(args.game)
        if not bundle:
            print('The schemas bundle of the game was not found. Pass --bundle or --dump.', file=sys.stderr)
            return 1
        documents = read_bundle(bundle)
        if args.dump and args.keep:
            os.makedirs(args.dump, exist_ok=True)
            for (role, kind), text in documents.items():
                with open(os.path.join(args.dump, '%s_%s.json' % (role, kind)), 'w', encoding='utf-8') as handle:
                    handle.write(text)

    presets = []
    for (role, kind), text in sorted(documents.items()):
        for entry in parse_configs(text):
            defindex = int(entry['defindex'])
            expected = 'parent' if defindex >= 0 else 'current'
            if expected != role:
                print('warning: %s/%s has defindex %d, which is a %s config' % (role, kind, defindex, expected),
                      file=sys.stderr)
            presets.append({
                'defindex': defindex,
                'role': role,
                'restrict': str(entry.get('restrictType', 'none')).lower(),
                'rotation': vec(entry.get('rotation'), [0, 0, 0]),
                'dir': vec(entry.get('restrictDir'), [0, 1, 0]),
                'angle': angle(entry.get('restrictAngle')),
            })

    restrict_order = {'radial': 0, 'spherical': 1, 'directional': 2, 'none': 3}
    presets.sort(key=lambda p: (p['role'] != 'parent', restrict_order.get(p['restrict'], 9), abs(p['defindex'])))

    def entry(preset):
        fields = [
            'defindex: %d' % preset['defindex'],
            "role: '%s'" % preset['role'],
            "restrict: '%s'" % preset['restrict'],
            'rotation: [%s]' % ', '.join(str(v) for v in preset['rotation']),
            'dir: [%s]' % ', '.join(str(v) for v in preset['dir']),
        ]
        if preset['angle']:
            fields.append('angle: [%s]' % ', '.join(str(v) for v in preset['angle']))
        return '  { %s },' % ', '.join(fields)

    lines = [
        '// Generated from the dynamic attachment configs of the game - do not edit by hand.',
        '// Run tools/part-editor/generate-dynamic-presets.py again when the game updates.',
        '//',
        "// One entry per config the game knows. The defindex names it, the sign says",
        "// which end of the connection it is (>= 0 receives a part on its surface,",
        "// < 0 puts this part onto the surface of another one), restrictType/restrictDir/",
        "// restrictAngle say where on that surface the socket may sit, and rotation is",
        "// the base rotation of the socket (Euler degrees, the game order ZXY).",
        'export const DYNAMIC_PRESETS = [',
    ]
    lines.extend(entry(preset) for preset in presets)
    lines.extend([
        '];',
        '',
        '// Direction keywords for the restrict direction of a preset.',
        "export const DYNAMIC_DIRECTIONS = { up: [0, 1, 0], down: [0, -1, 0], right: [1, 0, 0], left: [-1, 0, 0], forward: [0, 0, 1], back: [0, 0, -1] };",
        '',
        '// The shapes a dynamic socket can take. The game only connects a dynamic',
        '// socket to a static connection of the other part that it is compatible',
        '// with, and these are the shapes both kinds of connection actually use.',
        "export const DYNAMIC_SHAPES = ['single', 'dual', 'triple', 'triangle', 'rectangle', 'hexdual', 'hexagon', 'heptahedron'];",
        '',
        '// The bit of every shape in ConnectionShape: a part.json may carry the mask',
        '// as a number, the editor reads it back into names.',
        'export const DYNAMIC_SHAPE_BITS = {',
        '  single: 1, dual: 2, hexdual: 4, triple: 8, triangle: 16, rectangle: 32,',
        '  butterfly: 64, hexagon: 128, heptahedron: 256, line: 1024, star: 2048,',
        '  hexagon_range_1: 4096, heptahedron_range_1: 8192, wide: 16384, broad: 32768,',
        '  wide_quad: 131072, broad_quad: 262144, docking_small: 524288, docking_medium: 1048576,',
        '};',
        '',
    ])

    with open(OUTPUT, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write('\n'.join(lines))
    print('wrote %s: %d presets' % (os.path.basename(OUTPUT), len(presets)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
