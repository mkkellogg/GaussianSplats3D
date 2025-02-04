import * as THREE from 'three';
import { Viewer } from './Viewer.js';

/**
 * DropInViewer: Wrapper for a Viewer instance that enables it to be added to a Three.js scene like
 * any other Three.js scene object (Mesh, Object3D, etc.)
 */
export class DropInViewer extends THREE.Group {

    constructor(options = {}) {
        super();

        options.selfDrivenMode = false;
        options.useBuiltInControls = false;
        options.rootElement = null;
        options.dropInMode = true;
        options.camera = undefined;
        options.renderer = undefined;

        this.viewer = new Viewer(options);
        this.splatMesh = null;
        this.updateSplatMesh();

        this.callbackMesh = DropInViewer.createCallbackMesh();
        this.add(this.callbackMesh);
        this.callbackMesh.onBeforeRender = DropInViewer.onBeforeRender.bind(this, this.viewer);

        this.viewer.onSplatMeshChanged(() => {
            this.updateSplatMesh();
        });

    }

    updateSplatMesh() {
        if (this.splatMesh !== this.viewer.splatMesh) {
            if (this.splatMesh) {
                this.remove(this.splatMesh);
            }
            this.splatMesh = this.viewer.splatMesh;
            this.add(this.viewer.splatMesh);
        }
    }

    /**
     * Add a single splat scene to the viewer.
     * @param {string} path Path to splat scene to be loaded
     * @param {object} options {
     *
     *         splatAlphaRemovalThreshold: Ignore any splats with an alpha less than the specified
     *                                     value (valid range: 0 - 255), defaults to 1
     *
     *         showLoadingUI:         Display a loading spinner while the scene is loading, defaults to true
     *
     *         position (Array<number>):   Position of the scene, acts as an offset from its default position, defaults to [0, 0, 0]
     *
     *         rotation (Array<number>):   Rotation of the scene represented as a quaternion, defaults to [0, 0, 0, 1]
     *
     *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
     *
     *         onProgress:                 Function to be called as file data are received
     *
     * }
     * @return {AbortablePromise}
     */
    addSplatScene(path, options = {}) {
        if (options.showLoadingUI !== false) options.showLoadingUI = true;
        return this.viewer.addSplatScene(path, options);
    }

    /**
     * Add multiple splat scenes to the viewer.
     * @param {Array<object>} sceneOptions Array of per-scene options: {
     *
     *         path: Path to splat scene to be loaded
     *
     *         splatAlphaRemovalThreshold: Ignore any splats with an alpha less than the specified
     *                                     value (valid range: 0 - 255), defaults to 1
     *
     *         position (Array<number>):   Position of the scene, acts as an offset from its default position, defaults to [0, 0, 0]
     *
     *         rotation (Array<number>):   Rotation of the scene represented as a quaternion, defaults to [0, 0, 0, 1]
     *
     *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
     * }
     * @param {boolean} showLoadingUI Display a loading spinner while the scene is loading, defaults to true
     * @return {AbortablePromise}
     */
    addSplatScenes(sceneOptions, showLoadingUI) {
        if (showLoadingUI !== false) showLoadingUI = true;
        return this.viewer.addSplatScenes(sceneOptions, showLoadingUI);
    }

    /**
     * Get a reference to a splat scene.
     * @param {number} sceneIndex The index of the scene to which the reference will be returned
     * @return {SplatScene}
     */
    getSplatScene(sceneIndex) {
        return this.viewer.getSplatScene(sceneIndex);
    }

    removeSplatScene(index, showLoadingUI = true) {
        return this.viewer.removeSplatScene(index, showLoadingUI);
    }

    removeSplatScenes(indexes, showLoadingUI = true) {
        return this.viewer.removeSplatScenes(indexes, showLoadingUI);
    }

    getSceneCount() {
        return this.viewer.getSceneCount();
    }

    setActiveSphericalHarmonicsDegrees(activeSphericalHarmonicsDegrees) {
        this.viewer.setActiveSphericalHarmonicsDegrees(activeSphericalHarmonicsDegrees);
    }

    async dispose() {
        return await this.viewer.dispose();
    }

    static onBeforeRender(viewer, renderer, threeScene, camera) {
        viewer.update(renderer, camera);
    }

    static createCallbackMesh() {
        const geometry = new THREE.SphereGeometry(1, 8, 8);
        const material = new THREE.MeshBasicMaterial();
        material.colorWrite = false;
        material.depthWrite = false;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        return mesh;
    }

}
