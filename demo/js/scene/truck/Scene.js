import * as GaussianSplat3D from '../../../lib/gaussian-splat-3d.module.js';

export class Scene {

    constructor() {
    }

    load() {
        const viewer = new GaussianSplat3D.Viewer();
        viewer.init();
        viewer.loadFile('assets/data/truck/truck.splat')
        .then(() => {
            viewer.start();
        });
    }
}