import * as THREE from 'three';
import { Viewer } from './Viewer,js';

export class RenderableViewer extends THREE.GROUP {

    constructor(params = {}) {
        super();

        params.selfDrivenMode = false;
        params.useBuiltInControls = false;
        params.rootElement = null;
        params.ignoreDevicePixelRatio = false;

        this.viewer = new Viewer(params);
    }

    onBeforeRender() {
        this.viewer.update();
   }

}