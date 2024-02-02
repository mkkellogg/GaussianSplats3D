import * as THREE from 'three';
import { Viewer } from './Viewer.js';

/**
 * @typedef {Omit<
 *  import('./Viewer.js').ViewerOptions,
 *  | 'selfDrivenMode'
 *  | 'useBuiltInControls'
 *  | 'rootElement'
 *  | 'ignoreDevicePixelRatio'
 *  | 'dropInMode'
 *  | 'camera'
 *  | 'renderer'
 * >} DropInViewerOptions
 */

/**
 * DropInViewer: Wrapper for a Viewer instance that enables it to be added to a Three.js scene like
 * any other Three.js scene object (Mesh, Object3D, etc.)
 */
export class DropInViewer extends THREE.Group {

    constructor(/** @type {DropInViewerOptions} */ options = {}) {
        super();

        options.selfDrivenMode = false;
        options.useBuiltInControls = false;
        options.rootElement = null;
        options.ignoreDevicePixelRatio = false;
        options.dropInMode = true;
        options.camera = undefined;
        options.renderer = undefined;

        /** @type {import('./Viewer.js').Viewer} */
        this.viewer = new Viewer(options);

        /** @type {THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial, THREE.Object3DEventMap>} */
        this.callbackMesh = DropInViewer.createCallbackMesh();
        this.add(this.callbackMesh);
        this.callbackMesh.onBeforeRender = DropInViewer.onBeforeRender.bind(this, this.viewer);

    }

    /**
     * Add a single splat scene to the viewer.
     * @param {string} path Path to splat scene to be loaded
     * @param {import('./Viewer.js').AddSplatOptions} options
     * @return {AbortablePromise}
     */
    addSplatScene(path, options = {}) {
        if (options.showLoadingSpinner !== false) options.showLoadingSpinner = true;
        const loadPromise = this.viewer.addSplatScene(path, options);
        loadPromise.then(() => {
            this.add(this.viewer.splatMesh);
        });
        return loadPromise;
    }

    /**
     * Add multiple splat scenes to the viewer.
     * @param {import('./Viewer.js').AddSplatsOptions} sceneOptions Array of per-scene options
     * @param {boolean} showLoadingSpinner Display a loading spinner while the scene is loading, defaults to true
     * @return {AbortablePromise}
     */
    addSplatScenes(sceneOptions, showLoadingSpinner) {
        if (showLoadingSpinner !== false) showLoadingSpinner = true;
        const loadPromise = this.viewer.addSplatScenes(sceneOptions, showLoadingSpinner);
        loadPromise.then(() => {
            this.add(this.viewer.splatMesh);
        });
        return loadPromise;
    }

    /**
     * Get a reference to a splat scene.
     * @param {number} sceneIndex The index of the scene to which the reference will be returned
     * @return {SplatScene}
     */
    getSplatScene(sceneIndex) {
        return this.viewer.getSplatScene(sceneIndex);
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
