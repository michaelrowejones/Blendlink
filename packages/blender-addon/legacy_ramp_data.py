# SPDX-License-Identifier: GPL-3.0-or-later
"""Read legacy ColorBand hidden slots through a private, self-describing snapshot.

No ctypes, fixed DNA offsets, artist-tree edits, or source-file saves. The 4.2
EEVEE two-slot optimization reads data[1] even when only data[0] is visible.
"""
from contextlib import contextmanager
import math
from pathlib import Path
import re
import struct
import tempfile

import bpy


class LegacyRampDataError(ValueError):
    pass


def _has_id_reference(value):
    if isinstance(value, bpy.types.ID): return True
    if hasattr(value, 'values'): return any(_has_id_reference(item) for item in value.values())
    if isinstance(value, (list, tuple)): return any(_has_id_reference(item) for item in value)
    return False


def _check_private_properties(owner, tree):
    # Blender4.2 duplicates some embedded-tree ID-property user counts during
    # ID.copy(), even when the copy is immediately deleted. Refuse before the
    # copy; clearing/recomputing artist ID users would mutate unrelated data.
    values = [owner, tree, *tree.nodes, *tree.interface.items_tree]
    values.extend(socket for node in tree.nodes for socket in [*node.inputs, *node.outputs])
    if any(_has_id_reference(dict(value.items())) for value in values):
        raise LegacyRampDataError('Legacy private color-band snapshot cannot copy custom properties referencing Blender IDs; add a second visible stop')


def _hidden_from_snapshot(raw, address, visible):
    if raw[:7] != b'BLENDER' or raw[7:8] not in {b'-', b'_'} or raw[8:9] not in {b'v', b'V'}:
        raise LegacyRampDataError('Unrecognized private Blender snapshot header')
    if raw[9:12] not in {b'402', b'403'}:
        raise LegacyRampDataError('Private color-band snapshot has an unverified native version')
    pointer = 8 if raw[7:8] == b'-' else 4
    endian = '<' if raw[8:9] == b'v' else '>'
    header = struct.Struct(endian + ('4sIQII' if pointer == 8 else '4sIIII'))
    cursor, blocks = 12, []
    while cursor + header.size <= len(raw):
        code, size, old, schema, count = header.unpack_from(raw, cursor)
        cursor += header.size
        if size > len(raw) - cursor: raise LegacyRampDataError('Truncated private Blender block')
        blocks.append((code, old, schema, count, raw[cursor:cursor + size]))
        cursor += size
        if code == b'ENDB': break
    dna = next((block[4] for block in blocks if block[0] == b'DNA1'), None)
    if dna is None: raise LegacyRampDataError('Private snapshot has no SDNA')
    cursor = 0

    def token(value):
        nonlocal cursor
        if dna[cursor:cursor + 4] != value: raise LegacyRampDataError('Malformed private SDNA section')
        cursor += 4

    def number(code):
        nonlocal cursor
        size = struct.calcsize(code)
        value = struct.unpack_from(endian + code, dna, cursor)[0]
        cursor += size
        return value

    def strings(count):
        nonlocal cursor
        if count > len(dna): raise LegacyRampDataError('Invalid private SDNA name count')
        values = []
        for _ in range(count):
            end = dna.index(b'\0', cursor)
            values.append(dna[cursor:end].decode('utf8'))
            cursor = end + 1
        cursor = (cursor + 3) & ~3
        return values

    token(b'SDNA'); token(b'NAME'); names = strings(number('I'))
    token(b'TYPE'); types = strings(number('I'))
    token(b'TLEN'); lengths = [number('H') for _ in types]
    cursor = (cursor + 3) & ~3
    token(b'STRC')
    structures = []
    for _ in range(number('I')):
        type_index = number('H')
        fields = [(number('H'), number('H')) for _ in range(number('H'))]
        structures.append((type_index, fields))

    def layout(name):
        definition = next((value for value in structures if types[value[0]] == name), None)
        if definition is None: raise LegacyRampDataError('Private SDNA lacks ' + name)
        position, fields = 0, {}
        for type_index, name_index in definition[1]:
            label = names[name_index]
            # These two native structs contain only inline fields. Refuse a
            # changed pointer/layout instead of guessing an ABI or alignment.
            if '*' in label: raise LegacyRampDataError('Changed native color-band pointer layout')
            base = re.sub(r'\[\d+\]', '', label)
            if not re.fullmatch(r'[A-Za-z_]\w*', base): raise LegacyRampDataError('Changed native color-band field layout')
            count = 1
            for size in re.findall(r'\[(\d+)\]', label): count *= int(size)
            fields[base] = (position, types[type_index], count, lengths[type_index])
            position += lengths[type_index] * count
        if position != lengths[definition[0]]:
            raise LegacyRampDataError('Private color-band layout has unmodeled padding')
        return lengths[definition[0]], fields

    band_size, band = layout('ColorBand')
    row_size, row = layout('CBData')
    selected = [block for block in blocks if block[1] == address]
    if len(selected) != 1: raise LegacyRampDataError('Private color-band storage address was not retained')
    _, _, schema, count, data = selected[0]
    if schema >= len(structures) or types[structures[schema][0]] != 'ColorBand' or count != 1:
        raise LegacyRampDataError('Private color-band storage has a different native type')
    if len(data) != band_size:
        raise LegacyRampDataError('Private color-band storage does not match its native SDNA size')
    if band.get('tot', (None, None, None, None))[1:] != ('short', 1, 2):
        raise LegacyRampDataError('Changed native color-band count field')
    if struct.unpack_from(endian + 'h', data, band['tot'][0])[0] != 1:
        raise LegacyRampDataError('Private color-band snapshot no longer has one visible stop')
    if 'data' not in band or band['data'][1] != 'CBData' or band['data'][2] < 2:
        raise LegacyRampDataError('Private color-band snapshot lacks its second native slot')
    if any(row.get(key, (None, None, None, None))[1:] != ('float', 1, 4) for key in ['r', 'g', 'b', 'a', 'pos']):
        raise LegacyRampDataError('Changed native color-band channel layout')
    rows = [[struct.unpack_from(endian + 'f', data, band['data'][0] + index * row_size + row[key][0])[0]
             for key in ['r', 'g', 'b', 'a', 'pos']] for index in [0, 1]]
    if rows[0] != visible: raise LegacyRampDataError('Private color-band visible row did not match the authored stop')
    if not all(math.isfinite(value) for value in rows[1]) or not 0 <= rows[1][4] <= 1:
        raise LegacyRampDataError('Hidden color-band slot has no finite portable value')
    return {'color': rows[1][:4], 'position': rows[1][4]}


@contextmanager
def _isolated_owner(node):
    tree = node.id_data
    collection = bpy.data.node_groups
    if tree.is_embedded_data:
        source = None
        for candidates in [bpy.data.materials, bpy.data.worlds, bpy.data.lights]:
            source = next((value for value in candidates if getattr(value, 'node_tree', None) == tree), None)
            if source is not None:
                collection = candidates
                break
        if source is None: raise LegacyRampDataError('Embedded color-band owner could not be isolated')
        if getattr(source, 'is_grease_pencil', False): raise LegacyRampDataError('Legacy grease-pencil storage is not isolated by this shader snapshot')
        _check_private_properties(source, tree)
        # Material.copy() also double-increments embedded-tree ID references
        # on4.2. A plain group copy balances those references correctly. Do
        # not touch artist counts to compensate for Blender's copy behavior.
        if any(source in users for dependency, users in bpy.data.user_map().items() if dependency != source):
            raise LegacyRampDataError('Legacy private color-band owner references other Blender IDs; add a second visible stop')
        owned = source.copy()
        temporary = owned.node_tree
    else:
        _check_private_properties(tree, tree)
        owned = tree.copy()
        temporary = owned
    try:
        if owned.library or owned.override_library:
            raise LegacyRampDataError('Private color-band owner still references library override storage')
        owned.animation_data_clear()
        temporary.animation_data_clear()
        target = temporary.nodes[node.name]
        for sibling in list(temporary.nodes):
            if sibling != target: temporary.nodes.remove(sibling)
        target.parent = None
        temporary.interface.clear()
        for value in [owned, temporary, target]:
            for key in list(value.keys()): del value[key]
        if owned.asset_data: owned.asset_clear()
        yield owned, target
    finally:
        collection.remove(owned)


def hidden_ramp_stop(node):
    if not (4, 2, 0) <= bpy.app.version < (4, 4, 0) or len(node.color_ramp.elements) != 1:
        raise LegacyRampDataError('Hidden-slot readback is limited to legacy one-stop Color Ramp storage')
    visible = [*map(float, node.color_ramp.elements[0].color), float(node.color_ramp.elements[0].position)]
    try:
        with _isolated_owner(node) as (owned, target):
            address = target.color_ramp.as_pointer()
            with tempfile.TemporaryDirectory(prefix='blendlink-private-colorband-') as folder:
                path = Path(folder) / 'storage.blend'
                bpy.data.libraries.write(str(path), {owned}, path_remap='NONE', fake_user=False, compress=False)
                if path.stat().st_size > 2 * 1024 * 1024:
                    raise LegacyRampDataError('Private color-band snapshot contains unexpected extra data')
                return _hidden_from_snapshot(path.read_bytes(), address, visible)
    except LegacyRampDataError:
        raise
    except (OSError, RuntimeError, ValueError, TypeError, AttributeError, struct.error, StopIteration, IndexError) as error:
        raise LegacyRampDataError('Native hidden color-band storage could not be validated') from error
