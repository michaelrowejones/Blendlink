# SPDX-License-Identifier: GPL-3.0-or-later
"""Proof-only independent AST derivation of the native packaging closure.

Production copy-assets uses a JS line regex. This reader parses Python imports,
including all aliases in flat-module absolute imports and literal _sibling calls.
Relative addon-package branches are not executable in the flat exporter context.
It never imports/evaluates authored modules or changes packaging.
"""
import ast
import hashlib
import json
from pathlib import Path


def native_artifact_closure(root):
    root=Path(root).resolve();sdk=root/'packages/blendlink/blender';addon=root/'packages/blender-addon'
    sdk_files=sorted(sdk.glob('*.py'));addon_py={p.stem:p for p in addon.glob('*.py')};addon_json=sorted(addon.glob('*.json'))
    overlap={p.stem for p in sdk_files}&set(addon_py)
    assert not overlap,('Ambiguous native source basenames',sorted(overlap))
    pending=list(sdk_files);visited=set();modules=set()
    while pending:
        path=pending.pop()
        if path in visited:continue
        visited.add(path);tree=ast.parse(path.read_text(),filename=str(path));names=set()
        for node in ast.walk(tree):
            if isinstance(node,ast.Import):names.update(alias.name.split('.')[0]for alias in node.names)
            elif isinstance(node,ast.ImportFrom)and node.level==0:
                if node.module:names.add(node.module.split('.')[0])
                else:names.update(alias.name.split('.')[0]for alias in node.names)
            elif isinstance(node,ast.Call)and isinstance(node.func,ast.Name)and node.func.id=='_sibling'and node.args and isinstance(node.args[0],ast.Constant)and isinstance(node.args[0].value,str):names.add(node.args[0].value)
        for name in sorted(names&set(addon_py)):
            if name not in modules:modules.add(name);pending.append(addon_py[name])
    inputs=[]
    def add(source,target):
        inputs.append({'source':str(source.relative_to(root)),'artifact':str((root/'packages/blendlink/dist'/target/source.name).relative_to(root)),'sha256':hashlib.sha256(source.read_bytes()).hexdigest()})
    for source in sdk_files:
        for target in ['blender','addon']:add(source,target)
    for name,source in sorted(addon_py.items()):
        add(source,'addon')
        if name in modules:add(source,'blender')
    for source in addon_json:
        for target in ['blender','addon']:add(source,target)
    inputs.sort(key=lambda row:row['artifact'])
    return {'schemaVersion':1,'method':'independent-python-ast-flat-import-and-literal-sibling-closure-v1','flatAddonModules':sorted(modules),'sourceFiles':sorted(str(p.relative_to(root))for p in sdk_files+list(addon_py.values())+addon_json),'artifactInputs':inputs,'inventories':{target:sorted(Path(row['artifact']).name for row in inputs if row['artifact'].startswith('packages/blendlink/dist/'+target+'/'))for target in ['blender','addon']}}


if __name__=='__main__':
    import sys
    print(json.dumps(native_artifact_closure(sys.argv[1])))
