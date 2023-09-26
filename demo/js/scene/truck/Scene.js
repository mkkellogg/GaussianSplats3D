import * as GaussianSplat3D from '../../../lib/gaussian-splat-3d.module.js';

export class Scene {

    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
    }

    load() {
        const viewer = new GaussianSplat3D.Viewer();
        viewer.loadFile('assets/data/truck/truck.splat')
        .then(() => {
            viewer.start();
        });
    }
}