import * as THREE from 'three'

const matrix = rows => new THREE.Matrix4().set(...rows.flat())
export function geometryFrame(input) {
    if (!['blender-z-up', 'gltf-y-up'].includes(input.basis)) throw Error('Explicit geometry basis required')
    const change = input.basis === 'gltf-y-up'
        ? new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1) : new THREE.Matrix4()
    const convert = values => input.basis === 'gltf-y-up' ? values.map(([x, y, z]) => [x, z, -y]) : values
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(convert(input.position).flat(), 3))
    // A basis rotation must not normalize the raw authored normal before
    // the existing native SNORM stage packs it. Preserve Float32 words.
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(convert(input.normal).flat(), 3))
    geometry.setIndex(input.index)
    const mesh = new THREE.Mesh(geometry); mesh.matrixAutoUpdate = false
    mesh.matrix.copy(change.clone().multiply(matrix(input.modelMatrix)).multiply(change.clone().transpose()))
    const data = input.camera, xs = data.viewFrame.map(v => v[0]), ys = data.viewFrame.map(v => v[1])
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.max(...ys), bottom = Math.min(...ys)
    let camera
    if (data.type === 'ORTHO') camera = new THREE.OrthographicCamera(left, right, top, bottom, data.near, data.far)
    else if (data.type === 'PERSP') {
        camera = new THREE.PerspectiveCamera(50, 16, data.near, data.far)
        const ratio = data.near / -data.viewFrame[0][2]
        // Native camera inputs include shift. Reconstruct the declared
        // frustum in the renderer's coordinate system, without fitting pixels.
        camera.updateProjectionMatrix = function () {
            this.projectionMatrix.makePerspective(left * ratio, right * ratio, top * ratio, bottom * ratio, data.near, data.far, this.coordinateSystem)
            this.projectionMatrixInverse.copy(this.projectionMatrix).invert()
        }
        camera.updateProjectionMatrix()
    } else throw Error('Unsupported native source camera type')
    camera.matrixAutoUpdate = false; camera.matrix.copy(change.clone().multiply(matrix(data.matrix)))
    const scene = new THREE.Scene(); scene.add(mesh); scene.updateMatrixWorld(true); camera.updateMatrixWorld(true)
    return { scene, mesh, camera, dispose() { geometry.dispose() } }
}
