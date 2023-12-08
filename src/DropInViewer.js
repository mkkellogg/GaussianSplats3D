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
        options.ignoreDevicePixelRatio = false;
        options.dropInMode = true;
        options.camera = undefined;
        options.renderer = undefined;

        this.viewer = new Viewer(options);

        this.callbackMesh = DropInViewer.createCallbackMesh();
        this.add(this.callbackMesh);
        this.callbackMesh.onBeforeRender = DropInViewer.onBeforeRender.bind(this, this.viewer);

    }

    /**
     * Load a splat scene into the viewer.
     * @param {string} path Path to splat scene to be loaded
     * @param {object} options {
     *
     *         splatAlphaRemovalThreshold: Ignore any splats with an alpha less than the specified
     *                                     value (valid range: 0 - 255). Defaults to 1.
     *
     *         showLoadingSpinner:         Display a loading spinner while the scene is loading, defaults to true
     *
     *         position (Array<number>):   Position of the scene, acts as an offset from its default position.
     *                                     Defaults to [0, 0, 0]
     *
     *         rotation (Array<number>):   Rotation of the scene represented as a quaternion.
     *                                     Defaults to [0, 0, 0, 1]
     *
     *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
     *
     *         onProgress:                 Function to be called as file data are received
     *
     * }
     * @return {Promise}
     */
    addSceneFromFile(path, options = {}) {
        if (options.showLoadingSpinner !== false) options.showLoadingSpinner = true;
        return this.viewer.loadFile(path, options).then(() => {
            this.add(this.viewer.splatMesh);
        });
    }

    /**
     * Load multiple splat scenes into the viewer.
     * @param {Array<object>} files Array of per-file options: {
     *
     *         path: Path to splat scene to be loaded
     *
     *         splatAlphaRemovalThreshold: Ignore any splats with an alpha less than the specified
     *                                     value (valid range: 0 - 255). Defaults to 1.
     *
     *         position (Array<number>):   Position of the scene, acts as an offset from its default position.
     *                                     Defaults to [0, 0, 0]
     *
     *         rotation (Array<number>):   Rotation of the scene represented as a quaternion.
     *                                     Defaults to [0, 0, 0, 1]
     *
     *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
     * }
     * @param {boolean} showLoadingSpinner Display a loading spinner while the scene is loading, defaults to true
     * @return {Promise}
     */
    addScenesFromFiles(files, showLoadingSpinner) {
        if (showLoadingSpinner !== false) showLoadingSpinner = true;
        return this.viewer.loadFiles(files, showLoadingSpinner).then(() => {
            this.add(this.viewer.splatMesh);
        });
    }

    static onBeforeRender(viewer, renderer, scene, camera) {
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
