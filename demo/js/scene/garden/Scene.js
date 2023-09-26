import * as GaussianSplat3D from '../../../lib/gaussian-splat-3d.module.js';

export class Scene {

    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
    }

    load() {
        const plyLoader = new GaussianSplat3D.PlyLoader();
        plyLoader.load('assets/data/garden.splat')
        .then((data) => {
            
        });
    }
}