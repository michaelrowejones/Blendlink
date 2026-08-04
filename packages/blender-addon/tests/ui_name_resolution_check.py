# SPDX-License-Identifier: GPL-3.0-or-later
"""Every name a panel's draw path reads must actually resolve.

A draw helper that reads ``context`` without taking it as a parameter is
valid Python right up to the moment it runs, and it only runs when an artist
reaches that branch of that panel. The Lighting States panel carried exactly
that defect: the hidden-collection loop referenced an undefined ``context``,
so the panel raised ``NameError`` and stopped drawing the instant a state
hid its first collection - taking the remove buttons and the Add Hidden
Collection action with it. Nothing caught it, because nothing draws a panel:
Blender in background mode has no window to draw into, so the interactive UI
is the one surface with no runtime test.

This check does statically what no test can do at runtime. It parses each UI
module, resolves every name a function reads against that function's own
scope chain, the module's globals, and the builtins, and reports anything
left over. It needs no bpy and no Blender window.

It is deliberately conservative: only a name that cannot resolve ANYWHERE is
reported, so a false positive requires the module to be genuinely unable to
find that name at runtime too.
"""
from __future__ import annotations

import ast
import builtins
import sys
from pathlib import Path


ADDON_DIR = Path(__file__).resolve().parents[1]

# Every module that draws. A module added here is checked; a UI module that
# is NOT here is simply unchecked, so keep this list matched to the panels.
UI_MODULES = (
    "ui.py",
    "components_ui.py",
    "presentation_ui.py",
    "syncstatus.py",
    "validation.py",
    "ui_state.py",
    "ownership.py",
    "prefs.py",
)

BUILTIN_NAMES = frozenset(dir(builtins)) | {"__file__", "__name__", "__package__", "__doc__"}


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def _module_globals(tree: ast.Module) -> set[str]:
    """Every name the module body binds: imports, assignments, defs, classes."""
    names: set[str] = set()
    for node in tree.body:
        _collect_bindings(node, names, module_level=True)
    return names


def _collect_bindings(node, names: set[str], *, module_level: bool = False) -> None:
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        for alias in node.names:
            names.add((alias.asname or alias.name).split(".")[0])
    elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        names.add(node.name)
    elif isinstance(node, ast.Assign):
        for target in node.targets:
            _collect_target(target, names)
    elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        _collect_target(node.target, names)
    elif isinstance(node, ast.Try):
        # Names bound inside a try/except at module level (the addon's
        # dual-mode sibling imports) are still module globals.
        for child in (*node.body, *node.orelse, *node.finalbody):
            _collect_bindings(child, names, module_level=module_level)
        for handler in node.handlers:
            for child in handler.body:
                _collect_bindings(child, names, module_level=module_level)
    elif isinstance(node, (ast.If, ast.For, ast.While, ast.With)):
        for child in (*node.body, *getattr(node, "orelse", ())):
            _collect_bindings(child, names, module_level=module_level)
        if isinstance(node, ast.For):
            _collect_target(node.target, names)
        if isinstance(node, ast.With):
            for item in node.items:
                if item.optional_vars is not None:
                    _collect_target(item.optional_vars, names)


def _collect_target(target, names: set[str]) -> None:
    if isinstance(target, ast.Name):
        names.add(target.id)
    elif isinstance(target, (ast.Tuple, ast.List)):
        for element in target.elts:
            _collect_target(element, names)
    elif isinstance(target, ast.Starred):
        _collect_target(target.value, names)


class _ScopeWalker(ast.NodeVisitor):
    """Resolve every Name load against the enclosing function scope chain."""

    def __init__(self, module_globals: set[str], path: str):
        self.module_globals = module_globals
        self.path = path
        self.unresolved: list[tuple[str, str, int]] = []
        self._scopes: list[set[str]] = []
        self._function_names: list[str] = []

    def _bind(self, name: str) -> None:
        if self._scopes:
            self._scopes[-1].add(name)

    def _visible(self, name: str) -> bool:
        return (
            any(name in scope for scope in self._scopes)
            or name in self.module_globals
            or name in BUILTIN_NAMES
        )

    def _function_scope(self, node) -> set[str]:
        scope = set()
        args = node.args
        for group in (args.posonlyargs, args.args, args.kwonlyargs):
            for argument in group:
                scope.add(argument.arg)
        if args.vararg:
            scope.add(args.vararg.arg)
        if args.kwarg:
            scope.add(args.kwarg.arg)
        for statement in ast.walk(node):
            if statement is node:
                continue
            _collect_bindings(statement, scope)
            if isinstance(statement, (ast.comprehension,)):
                _collect_target(statement.target, scope)
            elif isinstance(statement, ast.ExceptHandler) and statement.name:
                scope.add(statement.name)
            elif isinstance(statement, (ast.Global, ast.Nonlocal)):
                scope.update(statement.names)
            elif isinstance(statement, ast.NamedExpr):
                _collect_target(statement.target, scope)
            elif isinstance(statement, ast.Lambda):
                for group in (
                    statement.args.posonlyargs,
                    statement.args.args,
                    statement.args.kwonlyargs,
                ):
                    for argument in group:
                        scope.add(argument.arg)
        return scope

    def visit_FunctionDef(self, node):  # noqa: N802 - ast API
        self._bind(node.name)
        self._scopes.append(self._function_scope(node))
        self._function_names.append(node.name)
        for child in node.body:
            self.visit(child)
        # Default expressions evaluate in the ENCLOSING scope, but checking
        # them inside is harmless here: a default that reads a local would be
        # unresolvable either way.
        self._function_names.pop()
        self._scopes.pop()

    visit_AsyncFunctionDef = visit_FunctionDef  # noqa: N815 - ast API

    def visit_ClassDef(self, node):  # noqa: N802 - ast API
        self._bind(node.name)
        self._scopes.append({
            statement.name for statement in node.body
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef))
        })
        for child in node.body:
            self.visit(child)
        self._scopes.pop()

    def visit_ListComp(self, node):  # noqa: N802 - ast API
        # A comprehension has its own scope, at module level as much as inside
        # a function. Without this the module-level generator that builds the
        # category enum reads as an undefined name.
        scope = set()
        for generator in node.generators:
            _collect_target(generator.target, scope)
        self._scopes.append(scope)
        self.generic_visit(node)
        self._scopes.pop()

    visit_SetComp = visit_ListComp  # noqa: N815 - ast API
    visit_DictComp = visit_ListComp  # noqa: N815 - ast API
    visit_GeneratorExp = visit_ListComp  # noqa: N815 - ast API

    def visit_Lambda(self, node):  # noqa: N802 - ast API
        scope = set()
        for group in (node.args.posonlyargs, node.args.args, node.args.kwonlyargs):
            for argument in group:
                scope.add(argument.arg)
        if node.args.vararg:
            scope.add(node.args.vararg.arg)
        if node.args.kwarg:
            scope.add(node.args.kwarg.arg)
        self._scopes.append(scope)
        self.generic_visit(node)
        self._scopes.pop()

    def visit_Name(self, node):  # noqa: N802 - ast API
        if isinstance(node.ctx, ast.Load) and not self._visible(node.id):
            where = self._function_names[-1] if self._function_names else "<module>"
            self.unresolved.append((node.id, where, node.lineno))
        self.generic_visit(node)


def check_module(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    walker = _ScopeWalker(_module_globals(tree), str(path))
    walker.visit(tree)
    return [
        f"{path.name}:{line} {name!r} is read by {where}() but is not a "
        f"parameter, a local, a module global, or a builtin"
        for name, where, line in walker.unresolved
    ]


def main() -> None:
    problems: list[str] = []
    checked = 0
    for module in UI_MODULES:
        path = ADDON_DIR / module
        expect(path.exists(), f"{module} is listed for checking but does not exist")
        problems.extend(check_module(path))
        checked += 1
    expect(
        checked == len(UI_MODULES),
        f"expected to check {len(UI_MODULES)} UI modules, checked {checked}",
    )
    expect(
        not problems,
        "unresolved names in draw paths:\n  " + "\n  ".join(problems),
    )

    # The check has to be able to fail, or it is decoration. Prove it against
    # the exact shape of the defect it exists for.
    broken = ast.parse(
        "import bpy\n"
        "def _draw(layout, project):\n"
        "    layout.label(text=context.scene.name)\n",
    )
    walker = _ScopeWalker(_module_globals(broken), "<synthetic>")
    walker.visit(broken)
    expect(
        [name for name, _where, _line in walker.unresolved] == ["context"],
        f"the check no longer detects a draw helper reading an undefined name: {walker.unresolved}",
    )

    print(f"UI name resolution: {checked} modules, every draw-path name resolves")
    print("BLENDLINK_UI_NAME_RESOLUTION_CHECK_PASSED")


main()
