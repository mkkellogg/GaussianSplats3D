import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';
import { SplatMesh } from './SplatMesh.js';
import { LoadingSpinner } from './LoadingSpinner.js';

const DEFAULT_CAMERA_SPECS = {
    'fx': 1159.5880733038064,
    'fy': 1164.6601287484507,
    'near': 0.1,
    'far': 500
};

export class Viewer {

    constructor(rootElement = null, cameraUp = [0, 1, 0], initialCameraPos = [0, 10, 15], initialCameraLookAt = [0, 0, 0],
                splatAlphaRemovalThreshold = 0, cameraSpecs = DEFAULT_CAMERA_SPECS, controls = null, selfDrivenMode = true) {
        this.rootElement = rootElement;
        this.splatMesh = new SplatMesh(cameraSpecs, splatAlphaRemovalThreshold);
        this.cameraUp = new THREE.Vector3().fromArray(cameraUp);
        this.initialCameraPos = new THREE.Vector3().fromArray(initialCameraPos);
        this.initialCameraLookAt = new THREE.Vector3().fromArray(initialCameraLookAt);
        this.cameraSpecs = cameraSpecs;
        this.controls = controls;
        this.selfDrivenMode = selfDrivenMode;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.selfDrivenUpdateFunc = this.update.bind(this);
        this.resizeFunc = this.onResize.bind(this);
    }

    getRenderDimensions(outDimensions) {
        outDimensions.x = this.rootElement.offsetWidth;
        outDimensions.y = this.rootElement.offsetHeight;
    }

    onResize = function() {

        const renderDimensions = new THREE.Vector2();

        return function() {
            this.renderer.setSize(1, 1);
            this.getRenderDimensions(renderDimensions);
            this.camera.aspect = renderDimensions.x / renderDimensions.y;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(renderDimensions.x, renderDimensions.y);
            this.splatObject.updateRealProjectionMatrix(renderDimensions);
            this.splatObject.updateSplatMeshUniforms();
        };

    }();

    init() {

        if (!this.rootElement) {
            this.rootElement = document.createElement('div');
            this.rootElement.style.width = '100%';
            this.rootElement.style.height = '100%';
            document.body.appendChild(this.rootElement);
        }

        const renderDimensions = new THREE.Vector2();
        this.getRenderDimensions(renderDimensions);

        this.camera = new THREE.PerspectiveCamera(70, renderDimensions.x / renderDimensions.y, 0.1, 500);
        this.camera.position.copy(this.initialCameraPos);
        this.camera.lookAt(this.initialCameraLookAt);
        this.camera.up.copy(this.cameraUp).normalize();

        this.scene = new THREE.Scene();

        this.splatMesh.setCamera(this.camera);
        this.splatMesh.updateRealProjectionMatrix(renderDimensions);

        this.renderer = new THREE.WebGLRenderer({
            antialias: false
        });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setSize(renderDimensions.x, renderDimensions.y);

        if (!this.controls) {
            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.rotateSpeed = 0.5;
            this.controls.maxPolarAngle = (0.9 * Math.PI) / 2;
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.15;
            this.controls.target.copy(this.initialCameraLookAt);
        }

        window.addEventListener('resize', this.resizeFunc, false);

        this.rootElement.appendChild(this.renderer.domElement);
    }

    loadFile(fileName) {
        const loadingSpinner = new LoadingSpinner();
        loadingSpinner.show();
        return new Promise((resolve, reject) => {
            this.splatMesh.loadFile(fileName)
            .then((splatMesh) => {
                this.scene.add(splatMesh);
                loadingSpinner.hide();
                resolve();
            })
            .catch((e) => {
                reject(e);
            });
        });
    }

    addDebugMeshesToScene(renderOrder) {
        const sphereGeometry = new THREE.SphereGeometry(1, 32, 32);

        const debugMeshRoot = new THREE.Object3D();
        this.scene.add(debugMeshRoot);

        let sphereMesh = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({color: 0xff0000}));
        sphereMesh.renderOrder = renderOrder;
        debugMeshRoot.add(sphereMesh);
        sphereMesh.position.set(-50, 0, 0);

        sphereMesh = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({color: 0xff0000}));
        sphereMesh.renderOrder = renderOrder;
        debugMeshRoot.add(sphereMesh);
        sphereMesh.position.set(50, 0, 0);

        sphereMesh = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({color: 0x00ff00}));
        sphereMesh.renderOrder = renderOrder;
        debugMeshRoot.add(sphereMesh);
        sphereMesh.position.set(0, 0, -50);

        sphereMesh = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({color: 0x00ff00}));
        sphereMesh.renderOrder = renderOrder;
        debugMeshRoot.add(sphereMesh);
        sphereMesh.position.set(0, 0, 50);

        return debugMeshRoot;
    }

    start() {
        if (this.selfDrivenMode) {
            requestAnimationFrame(this.selfDrivenUpdateFunc);
        } else {
            throw new Error('Cannot start viewer unless it is in self driven mode.');
        }
    }

    update() {
        if (this.selfDrivenMode) {
            requestAnimationFrame(this.selfDrivenUpdateFunc);
        }
        this.controls.update();
        this.splatMesh.updateView(this.camera);
        this.renderer.autoClear = false;
        this.renderer.render(this.scene, this.camera);
    }
}
