# SPDX-License-Identifier: GPL-3.0-or-later
"""Generate the pinned native one-codepoint case map; no Python Unicode-version inference."""
import hashlib
import json
import argparse
from pathlib import Path
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
COMMIT = '02f0899d78e374b63e7181d9061e1f7ab03419cc'
SOURCE = 'source/blender/blenlib/intern/string_utf8.cc'
URL = f'https://raw.githubusercontent.com/blender/blender/{COMMIT}/{SOURCE}'
SOURCE_SHA256 = '41fc7140c5f81a4364de7bb33557b687031cb06d77f8c146712550aad07d9b49'


def function(source, name):
    start = source.index('char32_t BLI_str_utf32_char_to_' + name)
    opening = source.index('{', start)
    cursor, depth = opening + 1, 1
    while depth:
        depth += (source[cursor] == '{') - (source[cursor] == '}')
        cursor += 1
    return source[start:cursor]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify the committed table without rewriting it')
    args = parser.parse_args()
    data = urllib.request.urlopen(URL).read()
    assert hashlib.sha256(data).hexdigest() == SOURCE_SHA256, 'Review changed native case source before regenerating'
    source = data.decode('utf-8')
    program = '#include <cstdio>\n#include <cstddef>\n#define ARRAY_SIZE(a) (sizeof(a)/sizeof((a)[0]))\n'
    program += function(source, 'upper') + '\n' + function(source, 'lower')
    program += '\nint main(){for(unsigned i=0;i<=0x10ffff;i++){if(i>=0xd800&&i<=0xdfff)continue;auto u=BLI_str_utf32_char_to_upper(i),l=BLI_str_utf32_char_to_lower(i);if(u!=i||l!=i)std::printf("%u %u %u\\n",i,unsigned(u),unsigned(l));}}\n'
    with tempfile.TemporaryDirectory(prefix='scenetoweb-native-case-') as folder:
        cpp, executable = Path(folder) / 'case.cc', Path(folder) / 'case'
        cpp.write_text(program)
        subprocess.run(['/usr/bin/clang++', '-std=c++17', '-O2', str(cpp), '-o', str(executable)], check=True)
        rows = subprocess.check_output([str(executable)], text=True).splitlines()
    upper, lower = {}, {}
    for row in rows:
        codepoint, up, low = map(int, row.split())
        if up != codepoint:
            upper[str(codepoint)] = up
        if low != codepoint:
            lower[str(codepoint)] = low
    record = {'schemaVersion': 1, 'model': 'blender-simple-unicode-case-53-v1',
              'license': 'GPL-2.0-or-later',
              'copyright': ['1999 Tom Tromey', '2000 Red Hat, Inc. All rights reserved.', '2011 Blender Authors'],
              'sourceCommit': COMMIT, 'source': URL, 'sourceSha256': SOURCE_SHA256,
              'method': 'Enumerate every Unicode scalar through the two unchanged pinned native C++ case functions. Unlisted codepoints are identity; this never uses Python upper/lower Unicode tables.',
              'upper': upper, 'lower': lower}
    target = ROOT / 'packages/blender-addon/static_string_case_data.json'
    generated = (json.dumps(record, indent=2) + '\n').encode('utf-8')
    if args.check:
        assert target.read_bytes() == generated, 'Committed native case table differs from fresh pinned source generation'
    else:
        target.write_bytes(generated)
    print(json.dumps({'path': str(target), 'sha256': hashlib.sha256(generated).hexdigest(), 'upperMappings': len(upper), 'lowerMappings': len(lower), 'mode': 'check' if args.check else 'generate', 'numericalNodeCredit': 0}))


if __name__ == '__main__':
    main()
