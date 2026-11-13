import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageVersion = JSON.parse(readFileSync(
  join(root, 'packages', 'blendlink', 'package.json'), 'utf8',
)).version
const cli = join(root, 'packages', 'blendlink', 'dist', 'cli.js')
const testsDir = join(root, 'packages', 'blender-addon', 'tests')
const addonTest = join(testsDir, 'run_headless.py')
const nativeCompositorMathProbe = readFileSync(join(testsDir, 'native_compositor_math_check.py'), 'utf8')
const legacyCurveSidecarTest = join(
  root, 'experiments', 'legacy-curve-sidecar-differential', 'run.py',
)
const desktopSmoke = process.argv.includes('--desktop-smoke')
const installedNodeFamilies = [
  ['ShaderNodeBlackbody', 'spectral'], ['ShaderNodeWavelength', 'spectral'],
  ['ShaderNodeRGBCurve', 'curve_native'], ['ShaderNodeFloatCurve', 'curve_native'],
  ['ShaderNodeVectorCurve', 'curve_native'], ['ShaderNodeTexBrick', 'tex_brick'],
  ['ShaderNodeObjectInfo', 'object_info'], ['ShaderNodeCombineColor', 'color_convert'],
  ['ShaderNodeClamp', 'clamp_minmax'], ['ShaderNodeValToRGB', 'ramp_lut'],
  ['ShaderNodeVectorTransform', 'vector_transform'], ['ShaderNodeTexWave', 'tex_wave'],
  ['ShaderNodeTexMagic', 'tex_magic_native'],
  ['ShaderNodeTexNoise', 'noise_fractal'], ['ShaderNodeTexNoise', 'noise_normalized'], ['ShaderNodeTexNoise', 'noise_varying_native'], ['ShaderNodeNormalMap', 'normal_map_native'],
  ['ShaderNodeNormalMap', 'normal_map_tangent_native'], ['ShaderNodeNormalMap', 'noise_normalized'],
  ['ShaderNodeBump', 'bump_passthrough_native'],
  ['ShaderNodeTangent', 'tangent_native'],
  ['ShaderNodeNormal', 'const_vec3'],
  ['ShaderNodeNewGeometry', 'geometry_context'], ['ShaderNodeTexCoord', 'geometry_context'],
  ['ShaderNodeTexCoord', 'uv_active'],
]
const installedCompositorFamilies = ['CompositorNodeSetAlpha', 'CompositorNodePremulKey',
  'CompositorNodeFilter', 'CompositorNodeNormal', 'CompositorNodeLumaMatte', 'CompositorNodeDiffMatte',
  'CompositorNodeColorSpill', 'CompositorNodeColorMatte', 'CompositorNodeChromaMatte', 'CompositorNodeCrop',
  'CompositorNodePixelate', 'CompositorNodeDistanceMatte', 'CompositorNodeChannelMatte', 'CompositorNodeSplit']

// Human labels for discovered modules. A missing label degrades the console
// line to a derived one; it can never make a suite silently not run, which
// is the whole point of discovering instead of enumerating.
const SUITE_LABELS = new Map([
  ['ui_state_check.py', 'pure UI-state contract'],
  ['probe_authoring_test.py', 'pure reflection-source contract'],
  ['weblights_test.py', 'pure web-light policy contract'],
  ['probe_authoring_check.py', 'real reflection render and authoring transaction'],
  ['bake_save_check.py', 'real supersampled atlas save contract'],
  ['material_compiler_check.py', 'portable material compiler contract'],
  ['evaluated_material_bindings_check.py',
   'evaluated render-used material binding differential'],
  ['plan_material_diagnostics_check.py', 'plan-only material diagnostics contract'],
  ['channel_routing_check.py', 'per-channel coordinate-space routing contract'],
  ['material_channel_bake_check.py', 'isolated channel-bake primitives contract'],
  ['material_bake_check.py', 'per-channel Material bake contract'],
  ['material_tsl_ir_check.py', 'per-channel TSL IR evidence contract'],
  ['legacy_shader_hsv_check.py', 'actual legacy HSV availability and source admission'],
  ['automatic_material_translation_check.py', 'automatic live material and static channel export'],
  ['compositor_graph_check.py', 'connected compositor graph structure and animation refusals'],
  ['evaluated_geometry_check.py', 'budgeted evaluated-geometry realization contract'],
  ['external_dependency_check.py', 'external dependency reachability contract'],
  ['pip_refusal_check.py', 'Pip animated-material refusal contract'],
  ['component_batch2_check.py', 'Batch 2 component authoring contract'],
  ['scoped_uv_edit_check.py', 'scoped UV editing seam contract'],
  ['scene_state_transaction_check.py', 'scene-state transaction contract'],
  ['uvgeometry_check.py', 'pure UV/atlas geometry contract'],
  ['constant_channel_check.py', 'constant-channel elision contract'],
  ['tsl_ir_ops_check.py', 'TSL IR op vocabulary conformance'],
  ['bake_ladder_check.py', 'bake atlas resolution ladder contract'],
  ['component_schema_check.py', 'component schema contract'],
  ['presentation_check.py', 'responsive framing and reference capture contract'],
  ['vocab_test.py', 'pure vocabulary contract'],
  ['ownership_known_issues_test.py', 'ownership known-issues contract'],
  ['sync_status_check.py', 'sync status contract'],
  ['overlay_gpu_check.py', 'overlay GPU draw contract'],
  ['run_headless.py', 'registered addon suite'],
])

function derivedLabel(file) {
  return file.replace(/\.py$/, '').replace(/_/g, ' ')
}

/** A module declares itself a suite by printing a BLENDLINK_* sentinel, or
 * opts out with `# blendlink-headless-suite: manual <reason>`. Anything
 * else is reported: silent unreachability is what let seven conforming
 * modules rot into documentation. */
function discoverSuites() {
  const suites = []
  const unregistered = []
  for (const file of readdirSync(testsDir).filter((name) => name.endsWith('.py')).sort()) {
    const source = readFileSync(join(testsDir, file), 'utf8')
    const manual = source.match(/^#\s*blendlink-headless-suite:\s*manual\s*(.*)$/m)
    if (manual) continue
    // The sentinel need not be the whole literal: several modules append
    // measured counts after it (`print("BLENDLINK_X_PASSED " f"n={n}")`).
    // Shared native compositor fixtures publish through oracle.finish().
    const printedSentinels = [...source.matchAll(/(?:print|oracle\.finish)\(\s*f?["'](BLENDLINK_[A-Z0-9_]+)/g)]
      .map((match) => match[1])
    const declaredSentinel = source.match(/^#\s*blendlink-headless-sentinel:\s*(BLENDLINK_[A-Z0-9_]+)\s*$/m)?.[1]
    if (declaredSentinel && !printedSentinels.includes(declaredSentinel)) {
      throw new Error(`${file} declares a default success sentinel that it never prints`)
    }
    const sentinel = declaredSentinel ?? printedSentinels.at(-1)
    if (!sentinel) {
      unregistered.push(file)
      continue
    }
    suites.push({
      file,
      path: join(testsDir, file),
      sentinel,
      label: SUITE_LABELS.get(file) ?? derivedLabel(file),
    })
  }
  if (unregistered.length) {
    throw new Error(
      `These headless test modules print no BLENDLINK_* success sentinel, so ` +
        `nothing can prove they ran: ${unregistered.join(', ')}. Print a ` +
        'sentinel on success, or declare the module manual with a ' +
        '`# blendlink-headless-suite: manual <reason>` comment.',
    )
  }
  // run_headless.py last: it is by far the longest, so every focused
  // contract reports before the omnibus one starts.
  return suites.sort((left, right) =>
    Number(left.file === 'run_headless.py') - Number(right.file === 'run_headless.py'))
}

console.log('BLENDLINK_FULL_TEST addon: discovering the supported local Blender installation')
const discovery = spawnSync(process.execPath, [cli, 'discover'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
})
if (discovery.stdout) process.stdout.write(discovery.stdout)
if (discovery.stderr) process.stderr.write(discovery.stderr)
if (discovery.error || discovery.status !== 0) {
  throw new Error(
    `Could not discover Blender for the headless addon suite` +
      `${discovery.status === null ? '' : ` (exit ${discovery.status})`}: ` +
      `${discovery.error?.message ?? 'see discovery output above'}`,
  )
}
const blender = discovery.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
if (!blender) throw new Error('SceneToWeb discovery returned no Blender executable')

console.log(`BLENDLINK_FULL_TEST addon: ${blender}`)

function runHeadlessSuite(label, testPath, sentinel) {
  console.log(`BLENDLINK_FULL_TEST addon: ${label}`)
  const cpuOnly = process.env.BLENDLINK_TEST_CYCLES_DEVICE === 'CPU'
  if (cpuOnly) console.log('BLENDLINK_FULL_TEST addon: Cycles CPU override (not GPU evidence)')
  const result = spawnSync(blender, [
    '--background',
    '--factory-startup',
    '--python-exit-code', '1',
    ...(cpuOnly ? ['--python-expr', 'import _cycles; _cycles.set_device_override("CPU")'] : []),
    '--python', testPath,
  ], {
    cwd: join(root, 'packages', 'blender-addon'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (!output.includes(sentinel)) {
    const tail = output.trim().split(/\r?\n/).slice(-30).join('\n')
    throw new Error(
      `${label} did not publish its success sentinel` +
        `${result.status === null ? '' : ` (exit ${result.status})`}` +
        `${result.signal ? ` (signal ${result.signal})` : ''}` +
        `${result.error ? `: ${result.error.message}` : ''}` +
      `${tail ? `\n--- Blender output tail ---\n${tail}` : ''}`,
    )
  }
  const forbiddenDiagnostic = [
    'Code marked as unreachable has been executed.',
    'source\\blender\\makesrna\\intern\\rna_mesh.cc:1549',
  ].find((diagnostic) => output.includes(diagnostic))
  if (forbiddenDiagnostic) {
    throw new Error(
      `${label} emitted Blender's internal RNA diagnostic: ${forbiddenDiagnostic}. ` +
        'Do not accept the success sentinel until the invalid RNA access is removed.',
    )
  }
  if (result.status !== 0) {
    console.warn(
      `BLENDLINK_FULL_TEST addon: Blender exited ${result.signal ?? String(result.status)} after ${label} passed; ` +
        'accepting the explicit success sentinel because Blender can fail during shutdown.',
    )
  }
}

if (!desktopSmoke) {
  const suites = discoverSuites()
  const only = process.env.BLENDLINK_HEADLESS_ONLY
  const selected = only
    ? suites.filter((suite) =>
        only.split(',').some((needle) => suite.file.includes(needle.trim())))
    : suites
  if (only && !selected.length) {
    throw new Error(
      `BLENDLINK_HEADLESS_ONLY=${only} matched no discovered suite. ` +
        `Available: ${suites.map((suite) => suite.file).join(', ')}`,
    )
  }
  if (only) {
    console.log(
      `BLENDLINK_FULL_TEST addon: BLENDLINK_HEADLESS_ONLY is set - running ` +
        `${selected.length}/${suites.length} suites. This is a focused rerun, ` +
        'not the gate.',
    )
  } else {
    console.log(`BLENDLINK_FULL_TEST addon: ${suites.length} discovered suites`)
  }
  runHeadlessSuite(
    'linked legacy Curve sidecar diagnostic differential', legacyCurveSidecarTest,
    'BLENDLINK_LEGACY_CURVE_SIDECAR_DIFFERENTIAL_PASSED',
  )
  for (const suite of selected) {
    runHeadlessSuite(suite.label, suite.path, suite.sentinel)
  }
  console.log('BLENDLINK_FULL_TEST addon: passed')
} else {
  console.log('BLENDLINK_DESKTOP_SMOKE: installation and managed tools only; not the full material gate')
}

const installRoot = mkdtempSync(join(tmpdir(), 'scenetoweb-addon-install-'))
const resources = join(installRoot, 'resources')
const archive = join(installRoot, 'scenetoweb.zip')
const savedScene = join(installRoot, 'Scene With Spaces.blend')
const installEnvironment = { ...process.env, BLENDER_USER_RESOURCES: resources, BLENDLINK_REINSTALL_NODE: process.execPath }
mkdirSync(resources, { recursive: true })

function runInstallStep(label, args) {
  const step = spawnSync(blender, args, {
    cwd: root,
    env: installEnvironment,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  const output = `${step.stdout ?? ''}\n${step.stderr ?? ''}`
  if (step.error || step.status !== 0) {
    throw new Error(
      `${label} failed${step.status === null ? '' : ` (exit ${step.status})`}: ` +
        `${step.error?.message ?? output.trim().split(/\r?\n/).slice(-30).join('\n')}`,
    )
  }
  return output
}

try {
  console.log('BLENDLINK_FULL_TEST addon: isolated archive install + enable verification')
  runInstallStep('isolated extension build', [
    '--command', 'extension', 'build',
    '--source-dir', join(root, 'packages', 'blendlink', 'dist', 'addon'),
    '--output-filepath', archive,
  ])
  if (!existsSync(archive)) throw new Error(`Blender did not create the extension archive: ${archive}`)
  // Exercise the public install command across the identity change. This
  // fixture retains the legacy extension ID and serialized RNA vocabulary;
  // it is not evidence of a particular previously distributed binary.
  const legacySource = join(installRoot, 'legacy-identity-source')
  cpSync(join(root, 'packages', 'blendlink', 'dist', 'addon'), legacySource, { recursive: true })
  const legacyManifest = join(legacySource, 'blender_manifest.toml')
  writeFileSync(legacyManifest, readFileSync(legacyManifest, 'utf8')
    .replace(/^id = "scenetoweb"$/m, 'id = "blendlink"')
    .replace(/^name = "SceneToWeb"$/m, 'name = "Blendlink"'))
  const legacyArchive = join(installRoot, 'legacy-blendlink.zip')
  runInstallStep('legacy identity fixture build', [
    '--command', 'extension', 'build', '--source-dir', legacySource,
    '--output-filepath', legacyArchive,
  ])
  runInstallStep('legacy identity fixture install', [
    '--command', 'extension', 'install-file', '-r', 'user_default', '-e', legacyArchive,
  ])
  const migrationScene = join(installRoot, 'Legacy Artist Scene.blend')
  const legacyPreferences = { category: 'Artist Tools', overlay_xray: true,
    preview_package: join(root, 'packages', 'blendlink') }
  const migrationState = join(installRoot, 'migration-before.json')
  runInstallStep('legacy preferences and saved scene', [
    '--background', '--python-exit-code', '1', '--python-expr', `
import bpy, hashlib, json
from pathlib import Path
preferences = bpy.context.preferences.addons["bl_ext.user_default.blendlink"].preferences
for key, value in json.loads(${JSON.stringify(JSON.stringify(legacyPreferences))}).items():
    setattr(preferences, key, value)
bpy.context.scene.blendlink_project.preview_samples = 37
bpy.context.scene["blendlink_recipe"] = "legacy saved artist recipe"
bpy.context.scene["artist_intent"] = "preserve this scene"
bpy.data.objects[0]["blendlink_id"] = "legacy-migration-proof"
bpy.ops.wm.save_userpref()
bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(migrationScene)})
path = Path(${JSON.stringify(migrationScene)})
Path(${JSON.stringify(migrationState)}).write_text(json.dumps({"sha256": hashlib.sha256(path.read_bytes()).hexdigest()}))
`,
  ])
  const migration = spawnSync(process.execPath, [cli, 'addon', 'install'], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    env: { ...installEnvironment, SCENETOWEB_BLENDER: blender, BLENDLINK_BLENDER: blender },
  })
  if (migration.error || migration.status !== 0) {
    throw new Error(`SceneToWeb CLI legacy migration failed:\n${migration.error?.message ?? ''}\n${migration.stdout ?? ''}\n${migration.stderr ?? ''}`)
  }
  const migrated = runInstallStep('legacy identity migration verification', [
    '--background', '--python-exit-code', '1', '--python-expr', `
import bpy, hashlib, json
from pathlib import Path
assert "bl_ext.user_default.blendlink" not in bpy.context.preferences.addons
assert "bl_ext.user_default.scenetoweb" in bpy.context.preferences.addons
preferences = bpy.context.preferences.addons["bl_ext.user_default.scenetoweb"].preferences
for key, value in json.loads(${JSON.stringify(JSON.stringify(legacyPreferences))}).items():
    assert getattr(preferences, key) == value, (key, getattr(preferences, key), value)
path = Path(${JSON.stringify(migrationScene)})
assert hashlib.sha256(path.read_bytes()).hexdigest() == json.loads(Path(${JSON.stringify(migrationState)}).read_text())["sha256"]
bpy.ops.wm.open_mainfile(filepath=str(path))
assert bpy.context.scene.blendlink_project.preview_samples == 37
assert bpy.context.scene["artist_intent"] == "preserve this scene"
assert bpy.data.objects[0]["blendlink_id"] == "legacy-migration-proof"
print("BLENDLINK_SCENETOWEB_MIGRATION_PASSED")
`,
  ])
  if (!migrated.includes('BLENDLINK_SCENETOWEB_MIGRATION_PASSED')) {
    throw new Error(`SceneToWeb migration did not preserve preferences and the saved scene:\n${migrated}`)
  }
  console.log('BLENDLINK_FULL_TEST addon: CLI legacy identity migration, preferences and scene preservation passed')
  const probeScript = `
import bpy, importlib, json, tomllib
from pathlib import Path
module_name = "bl_ext.user_default.scenetoweb"
repo = next(item for item in bpy.context.preferences.extensions.repos if item.module == "user_default")
manifest = Path(repo.directory) / "scenetoweb" / "blender_manifest.toml"
version = tomllib.loads(manifest.read_text(encoding="utf8"))["version"]
module = importlib.import_module(module_name)
# Exercise package-qualified compiler imports from the actual installed ZIP.
# Registering classes alone cannot catch a helper that imports successfully
# only when the source checkout is injected into sys.path.
mesh = bpy.data.meshes.new("Installed Node Translation Probe")
mesh.from_pydata([(0,0,0),(1,0,0),(1,1,0),(0,1,0)], [], [(0,1,2,3)])
uv = mesh.uv_layers.new(name="Installed Probe UV")
for index, value in enumerate(((0,0),(1,0),(1,1),(0,1))): uv.data[index].uv = value
owner = bpy.data.objects.new("Installed Node Translation Probe", mesh)
bpy.context.scene.collection.objects.link(owner)
material = bpy.data.materials.new("Installed Native Node Families")
material.use_nodes = True
owner.data.materials.append(material)
tree = material.node_tree
root = next(node for node in tree.nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
families = ${JSON.stringify(installedNodeFamilies)}
if bpy.app.version[:3] == (4, 2, 0):
    families.extend([(name, "color_convert") for name in ("ShaderNodeCombineHSV", "ShaderNodeSeparateHSV")])
# These shared utility classes are absent in4.2 shader trees. Probe creation,
# rather than assuming an RNA class can be used in this tree context.
for utility in ("FunctionNodeInputBool", "FunctionNodeInputInt", "FunctionNodeInputVector"):
    try:
        candidate = tree.nodes.new(utility)
    except RuntimeError:
        continue
    tree.nodes.remove(candidate)
    families.append((utility, "const_vec3" if utility == "FunctionNodeInputVector" else "typed_const"))
def contains_op(value, expected):
    if isinstance(value, dict):
        return value.get("op") == expected or any(contains_op(child, expected) for child in value.values())
    return isinstance(value, list) and any(contains_op(child, expected) for child in value)
for node_type, expected in families:
    node = tree.nodes.new(node_type)
    if node_type == "ShaderNodeCombineColor": node.mode = "HSL"
    if node_type == "ShaderNodeNormalMap": node.space = "TANGENT" if expected in {"normal_map_tangent_native", "noise_normalized"} else "WORLD"
    previous_engine = bpy.context.scene.render.engine
    if node_type in {"ShaderNodeTangent", "ShaderNodeBump", "ShaderNodeTexMagic", "ShaderNodeCombineHSV", "ShaderNodeSeparateHSV"} or (node_type == "ShaderNodeNormalMap" and expected in {"normal_map_tangent_native", "noise_normalized"}):
        if node_type == "ShaderNodeTangent": node.direction_type = "UV_MAP"
        engines = {item.identifier for item in bpy.context.scene.render.bl_rna.properties["engine"].enum_items}
        bpy.context.scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
        for polygon in mesh.polygons: polygon.use_smooth = True
    if node_type == "ShaderNodeNormalMap" and expected == "noise_normalized":
        child_noise = tree.nodes.new("ShaderNodeTexNoise")
        child_noise.normalize = True
        child_noise.inputs["Scale"].default_value = 0.15
        child_noise.inputs["Detail"].default_value = 1
        child_noise.inputs["Distortion"].default_value = 0
        tree.links.new(child_noise.outputs["Fac"], node.inputs["Strength"])
    if node_type == "ShaderNodeClamp": node.clamp_type = "RANGE"
    if node_type == "ShaderNodeTexNoise":
        if expected in {"noise_normalized", "noise_varying_native"}:
            engines = {item.identifier for item in bpy.context.scene.render.bl_rna.properties["engine"].enum_items}
            bpy.context.scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
            node.noise_type = "FBM"
            node.normalize = True
            node.inputs["Detail"].default_value = 1
        else:
            node.noise_type = "MULTIFRACTAL"
        coordinate = tree.nodes.new("ShaderNodeTexCoord")
        tree.links.new(coordinate.outputs["UV"], node.inputs["Vector"])
        if expected == "noise_varying_native":
            live_roughness = tree.nodes.new("ShaderNodeSeparateXYZ")
            roughness_clamp = tree.nodes.new("ShaderNodeClamp")
            tree.links.new(coordinate.outputs["UV"], live_roughness.inputs[0])
            tree.links.new(live_roughness.outputs[0], roughness_clamp.inputs["Value"])
            tree.links.new(roughness_clamp.outputs[0], node.inputs["Roughness"])
    if node_type == "ShaderNodeValToRGB":
        node.color_ramp.interpolation = "B_SPLINE"
        coordinate = tree.nodes.new("ShaderNodeTexCoord")
        separate = tree.nodes.new("ShaderNodeSeparateXYZ")
        tree.links.new(coordinate.outputs["UV"], separate.inputs[0])
        tree.links.new(separate.outputs[0], node.inputs["Fac"])
    if node_type in {"ShaderNodeNewGeometry", "ShaderNodeTexCoord"}:
        output = node.outputs["UV" if expected == "uv_active" else "Normal"]
    else:
        output = node.outputs["Color"] if node_type == "ShaderNodeObjectInfo" else node.outputs[0]
    tree.links.new(output, root.inputs["Base Color"])
    before = len(tree.nodes), len(tree.links), len(bpy.data.node_groups)
    try:
        decision = module.material_compiler.plan_materials([owner], automatic_programs=True).decisions[0]
    finally:
        bpy.context.scene.render.engine = previous_engine
    channel = next(item for item in decision.channel_plan["channels"] if item["channel"] == "Base Color")
    assert channel["route"] == "program" and contains_op(channel.get("tslIr"), expected), (node_type, channel)
    assert before == (len(tree.nodes), len(tree.links), len(bpy.data.node_groups)), node_type
    tree.nodes.remove(node)
    if node_type == "ShaderNodeValToRGB":
        tree.nodes.remove(separate)
        tree.nodes.remove(coordinate)
    if node_type == "ShaderNodeTexNoise":
        tree.nodes.remove(coordinate)
        if expected == "noise_varying_native":
            tree.nodes.remove(live_roughness)
            tree.nodes.remove(roughness_clamp)
    if node_type == "ShaderNodeNormalMap" and expected == "noise_normalized": tree.nodes.remove(child_noise)
bpy.data.objects.remove(owner, do_unlink=True)
bpy.data.meshes.remove(mesh)
bpy.data.materials.remove(material)
# The exact installed scalar C bindings must agree with Blender CPU fields.
# This trusted verification function receives installed modules explicitly;
# its standalone checkout imports never execute inside the isolated package.
cmath_namespace = {"__name__": "blendlink_installed_cmath_probe"}
exec(${JSON.stringify(nativeCompositorMathProbe)}, cmath_namespace)
native_math_qualification = cmath_namespace["verify_native_math"](
    importlib.import_module(module_name + ".compositor_chroma_key"),
    importlib.import_module(module_name + ".compositor_affine"),
    importlib.import_module(module_name + ".compositor_blur"))
print("BLENDLINK_INSTALLED_NATIVE_MATH_PASSED " + json.dumps(native_math_qualification, sort_keys=True))

# Exercise compositor sibling imports through the installed package too.
compositor_scene = bpy.data.scenes.new("Installed Compositor Translation Probe")
compositor_tree = None
try:
    modern_compositor = hasattr(compositor_scene, "compositing_node_group")
    if modern_compositor:
        compositor_tree = bpy.data.node_groups.new("Installed Compositor Translation Probe", "CompositorNodeTree")
        compositor_tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        compositor_scene.compositing_node_group = compositor_tree
    else:
        compositor_scene.use_nodes = True
        compositor_tree = compositor_scene.node_tree
        compositor_tree.nodes.clear()
    source = compositor_tree.nodes.new("CompositorNodeRLayers")
    source.scene = compositor_scene
    sink = compositor_tree.nodes.new("NodeGroupOutput" if modern_compositor else "CompositorNodeComposite")
    mask = compositor_tree.nodes.new("CompositorNodeSetAlpha")
    conversion = compositor_tree.nodes.new("CompositorNodePremulKey")
    enhancement = compositor_tree.nodes.new("CompositorNodeFilter")
    direction = compositor_tree.nodes.new("CompositorNodeNormal")
    luminance_key = compositor_tree.nodes.new("CompositorNodeLumaMatte")
    difference_key = compositor_tree.nodes.new("CompositorNodeDiffMatte")
    spill = compositor_tree.nodes.new("CompositorNodeColorSpill")
    color_key = compositor_tree.nodes.new("CompositorNodeColorMatte")
    chroma_key = compositor_tree.nodes.new("CompositorNodeChromaMatte")
    crop = compositor_tree.nodes.new("CompositorNodeCrop")
    if modern_compositor: crop.inputs["Alpha Crop"].default_value = True
    else: crop.use_crop_size = False
    chroma_key.inputs["Key Color"].default_value = (0, 1, 0, 1)
    if modern_compositor: chroma_key.inputs["Minimum"].default_value = 0
    else: chroma_key.threshold = 0
    compositor_scene.render.compositor_device = "CPU"
    compositor_tree.links.new(source.outputs["Image"], mask.inputs["Image"])
    compositor_tree.links.new(mask.outputs[0], conversion.inputs["Image"])
    compositor_tree.links.new(conversion.outputs[0], enhancement.inputs["Image"])
    compositor_tree.links.new(direction.outputs["Normal"], enhancement.inputs["Fac"])
    compositor_tree.links.new(enhancement.outputs[0], luminance_key.inputs["Image"])
    compositor_tree.links.new(luminance_key.outputs["Image"], difference_key.inputs["Image 1"])
    compositor_tree.links.new(enhancement.outputs[0], difference_key.inputs["Image 2"])
    compositor_tree.links.new(difference_key.outputs["Image"], spill.inputs["Image"])
    compositor_tree.links.new(spill.outputs["Image"], color_key.inputs["Image"])
    compositor_tree.links.new(color_key.outputs["Image"], chroma_key.inputs["Image"])
    compositor_tree.links.new(chroma_key.outputs["Image"], crop.inputs["Image"])
    compositor_tree.links.new(crop.outputs["Image"], sink.inputs[0])
    before = len(compositor_tree.nodes), len(compositor_tree.links), len(bpy.data.node_groups)
    compositor_module = importlib.import_module(module_name + ".compositor_graph")
    compositor_program = compositor_module.extract(compositor_scene)
    assert compositor_program["status"] == "extracted", compositor_program
    assert {"set-alpha", "convert-alpha", "filter", "normal-direction", "luminance-key", "difference-key", "color-spill", "color-key", "chroma-key", "alpha-crop"} <= {op["kind"] for op in compositor_program["ops"]}, compositor_program
    if bpy.app.version[:2] in {(5, 2), (5, 3)}:
        crop.inputs["Alpha Crop"].default_value = False
        resized_program = compositor_module.extract(compositor_scene)
        assert resized_program["status"] == "extracted", resized_program
        assert "image-crop" in {op["kind"] for op in resized_program["ops"]}, resized_program
        crop.inputs["Alpha Crop"].default_value = True
    assert before == (len(compositor_tree.nodes), len(compositor_tree.links), len(bpy.data.node_groups))
    pixelate = compositor_tree.nodes.new("CompositorNodePixelate")
    compositor_tree.links.new(crop.outputs[0], pixelate.inputs["Color"])
    compositor_tree.links.new(pixelate.outputs[0], sink.inputs[0])
    pixelate_program = compositor_module.extract(compositor_scene)
    assert pixelate_program["status"] == "extracted", pixelate_program
    assert "pixelate" in {op["kind"] for op in pixelate_program["ops"]}, pixelate_program
    distance_key = compositor_tree.nodes.new("CompositorNodeDistanceMatte")
    compositor_tree.links.new(pixelate.outputs[0], distance_key.inputs["Image"])
    compositor_tree.links.new(distance_key.outputs["Image"], sink.inputs[0])
    distance_program = compositor_module.extract(compositor_scene)
    assert distance_program["status"] == "extracted", distance_program
    assert "distance-key" in {op["kind"] for op in distance_program["ops"]}, distance_program
    channel_key = compositor_tree.nodes.new("CompositorNodeChannelMatte")
    if modern_compositor:
        channel_key.inputs["Minimum"].default_value = 0
        channel_key.inputs["Maximum"].default_value = .5
    else:
        channel_key.limit_min, channel_key.limit_max = 0, .5
    compositor_tree.links.new(distance_key.outputs["Image"], channel_key.inputs["Image"])
    compositor_tree.links.new(channel_key.outputs["Image"], sink.inputs[0])
    channel_program = compositor_module.extract(compositor_scene)
    assert channel_program["status"] == "extracted", channel_program
    assert "channel-key" in {op["kind"] for op in channel_program["ops"]}, channel_program
    split = compositor_tree.nodes.new("CompositorNodeSplit")
    compositor_tree.links.new(channel_key.outputs["Image"], split.inputs["Image"])
    compositor_tree.links.new(split.outputs["Image"], sink.inputs[0])
    split_program = compositor_module.extract(compositor_scene)
    assert split_program["status"] == "extracted", split_program
    assert "image-split" in {op["kind"] for op in split_program["ops"]}, split_program
    if bpy.app.version[:3] == (4, 2, 0):
        mapping = compositor_tree.nodes.new("CompositorNodeMapValue")
        mapping.inputs["Value"].default_value = .25
        mapping.offset[0], mapping.size[0] = .125, 2
        final_alpha = compositor_tree.nodes.new("CompositorNodeSetAlpha")
        compositor_tree.links.new(split.outputs["Image"], final_alpha.inputs["Image"])
        compositor_tree.links.new(mapping.outputs["Value"], final_alpha.inputs["Alpha"])
        compositor_tree.links.new(final_alpha.outputs[0], sink.inputs[0])
        mapped_program = compositor_module.extract(compositor_scene)
        assert mapped_program["status"] == "extracted", mapped_program
        assert "map-value" in {op["kind"] for op in mapped_program["ops"]}, mapped_program
    else:
        try:
            compositor_tree.nodes.new("CompositorNodeMapValue")
        except RuntimeError:
            pass
        else:
            raise AssertionError("Review newly creatable Map Value before claiming its installed capability")
finally:
    bpy.data.scenes.remove(compositor_scene)
    if modern_compositor and compositor_tree is not None: bpy.data.node_groups.remove(compositor_tree)
${desktopSmoke ? `assert len(bpy.data.objects) > 0, "Expected Blender's default scene"
bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(savedScene)})` : ''}
print("##scenetoweb-addon-install " + json.dumps({
    "enabled": module_name in bpy.context.preferences.addons,
    "operator": hasattr(bpy.ops.blendlink, "setup_website_export"),
    "package": bool(module.__file__),
    "version": version,
    "exportOperator": bpy.ops.blendlink.export_website.get_rna_type().identifier,
    "atlasOperator": bpy.ops.blendlink.check_atlas_fit.get_rna_type().identifier,
    "bootstrap": str(Path(module.__file__).parent / "bootstrap.py"),
    "compositorFamilies": ${JSON.stringify(installedCompositorFamilies)},
    "nativeMath": native_math_qualification,
    "nodeFamilies": len({node_type for node_type, _expected in families}),
    "testedNodeFamilies": list(dict.fromkeys(node_type for node_type, _expected in families)),
    "testedNodeCapabilities": [node_type + "#" + expected for node_type, expected in families],
}, sort_keys=True))
`
  const probeFile = join(installRoot, 'verify-installed.py')
  writeFileSync(probeFile, probeScript)
  const probeOutput = runInstallStep('isolated extension verification', [
    '--background', '--python-exit-code', '1', '--python', probeFile,
  ])
  const sentinel = probeOutput.split(/\r?\n/).find(
    (line) => line.startsWith('##scenetoweb-addon-install '),
  )
  if (!sentinel) throw new Error('Installed extension did not emit its verification sentinel')
  const status = JSON.parse(sentinel.slice('##scenetoweb-addon-install '.length))
  const tested = status.testedNodeFamilies
  const required = installedNodeFamilies.map(([name]) => name)
  const capabilities = status.testedNodeCapabilities
  const requiredCapabilities = installedNodeFamilies.map(([name, op]) => name + '#' + op)
  const validCapabilities = Array.isArray(capabilities) && new Set(capabilities).size === capabilities.length &&
    requiredCapabilities.every(capability => capabilities.includes(capability))
  const optional = ['FunctionNodeInputBool', 'FunctionNodeInputInt', 'FunctionNodeInputVector',
    'ShaderNodeCombineHSV', 'ShaderNodeSeparateHSV']
  const validNodeFamilies = Array.isArray(tested) && tested.length === status.nodeFamilies &&
    new Set(tested).size === tested.length && required.every(name => tested.includes(name)) &&
    tested.every(name => required.includes(name) || optional.includes(name))
  const validNativeMath = status.nativeMath?.exactScalarComparisons === 144 && status.nativeMath?.points === 16 &&
    status.nativeMath?.renderRequired === false && status.nativeMath?.oracle === 'actual Geometry Nodes CPU float fields' &&
    JSON.stringify(status.nativeMath?.functions) === JSON.stringify(['sinf', 'cosf', 'tanf', 'sqrtf', 'atan2f', 'expf'])
  if (status.version !== packageVersion || !status.enabled || !status.operator || !status.package ||
      !validNativeMath || !validNodeFamilies || !validCapabilities || JSON.stringify(status.compositorFamilies) !== JSON.stringify(installedCompositorFamilies) ||
      status.exportOperator !== 'BLENDLINK_OT_export_website' || status.atlasOperator !== 'BLENDLINK_OT_check_atlas_fit') {
    throw new Error(`Installed extension failed its postconditions: ${JSON.stringify(status)}`)
  }
  console.log('BLENDLINK_FULL_TEST addon: isolated install passed')
  const reinstallOutput = runInstallStep('same-process extension reinstall', [
    '--background', '--factory-startup', '--python-exit-code', '1',
    '--python', join(testsDir, 'reinstall_check.py'), '--',
    '--archive', archive, '--work', join(installRoot, 'reinstall'),
  ])
  if (!reinstallOutput.includes('BLENDLINK_ADDON_REINSTALL_PASSED ')) {
    throw new Error(`Same-process extension reinstall did not pass:\n${reinstallOutput}`)
  }
  console.log('BLENDLINK_FULL_TEST addon: same-version reinstall, scene preservation and cleanup passed')
  if (desktopSmoke) {
    // Exercise the exact installed Python entry point with global Node/npm
    // removed. The local compiler override lets an unpublished revision run.
    const cache = join(installRoot, 'Private Tools With Spaces')
    const systemPath = process.platform === 'win32'
      ? [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'), process.env.SystemRoot ?? 'C:\\Windows'].join(';')
      : '/usr/bin:/bin'
    installEnvironment.PATH = systemPath
    installEnvironment.XDG_CACHE_HOME = join(installRoot, 'cache')
    if (process.platform === 'win32') installEnvironment.LOCALAPPDATA = join(installRoot, 'cache')
    const base = ['--background', '--factory-startup', '--python-exit-code', '1', '--python', status.bootstrap, '--',
      '--cache', cache, '--version', packageVersion, '--cli', cli, '--blender', blender]
    const website = join(installRoot, 'Website With Spaces')
    const exported = runInstallStep('fresh managed runtime + website export', [
      ...base, '--', 'export', '--blend', savedScene, '--out', website,
    ])
    if (!exported.includes('downloading Node 24.22.3') ||
        !existsSync(join(website, 'index.html')) || !existsSync(join(website, 'THIRD_PARTY_NOTICES.txt'))) {
      throw new Error(`Desktop bootstrap did not download tools and export a complete website:\n${exported}`)
    }
    const cached = runInstallStep('offline cached runtime execution', [...base, '--offline', '--', 'discover'])
    if (cached.includes('downloading Node') || !cached.includes(blender)) {
      throw new Error(`Desktop tools did not reuse the verified runtime offline:\n${cached}`)
    }
    console.log('BLENDLINK_DESKTOP_SMOKE_PASSED installed extension, fresh tools, website export and offline reuse')
  }
} finally {
  const owned = resolve(installRoot)
  if (resolve(tmpdir()) !== resolve(owned, '..') || !owned.includes('scenetoweb-addon-install-')) {
    throw new Error(`Refusing to remove unexpected addon-test directory: ${owned}`)
  }
  rmSync(owned, { recursive: true, force: true })
}
