import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';
import { PlyLoader } from './PlyLoader.js';
import { SplatLoader } from './SplatLoader.js';
import { SplatBuffer } from './SplatBuffer.js';
import { createSortWorker } from './SortWorker.js';
import { LoadingSpinner } from './LoadingSpinner.js';

const DEFAULT_CAMERA_SPECS = {
    'fx': 1159.5880733038064,
    'fy': 1164.6601287484507,
    'near': 0.1,
    'far': 500
};

export class Viewer {

    constructor(rootElement = null, cameraUp = [0, 1, 0], initialCameraPos = [0, 10, 15], initialCameraLookAt = [0, 0, 0],
                cameraSpecs = DEFAULT_CAMERA_SPECS, controls = null, selfDrivenMode = true) {
        this.rootElement = rootElement;
        this.cameraUp = new THREE.Vector3().fromArray(cameraUp);
        this.initialCameraPos = new THREE.Vector3().fromArray(initialCameraPos);
        this.initialCameraLookAt = new THREE.Vector3().fromArray(initialCameraLookAt);
        this.cameraSpecs = cameraSpecs;
        this.controls = controls;
        this.selfDrivenMode = selfDrivenMode;
        this.scene = null;
        this.camera = null;
        this.realProjectionMatrix = new THREE.Matrix4();
        this.renderer = null;
        this.splatBuffer = null;
        this.splatMesh = null;
        this.selfDrivenUpdateFunc = this.update.bind(this);
        this.resizeFunc = this.onResize.bind(this);
        this.sortWorker = null;

        const sab = new SharedArrayBuffer(1024);
    }

    getRenderDimensions(outDimensions) {
        outDimensions.x = this.rootElement.offsetWidth;
        outDimensions.y = this.rootElement.offsetHeight;
    }

    updateRealProjectionMatrix(renderDimensions) {
        this.realProjectionMatrix.elements = [
            [(2 * this.cameraSpecs.fx) / renderDimensions.x, 0, 0, 0],
            [0, (2 * this.cameraSpecs.fy) / renderDimensions.y, 0, 0],
            [0, 0, -(this.cameraSpecs.far + this.cameraSpecs.near) / (this.cameraSpecs.far - this.cameraSpecs.near), -1],
            [0, 0, -(2.0 * this.cameraSpecs.far * this.cameraSpecs.near) / (this.cameraSpecs.far - this.cameraSpecs.near), 0],
        ].flat();
    }
    onResize = function() {

        const renderDimensions = new THREE.Vector2();

        return function() {
            this.renderer.setSize(1, 1);
            this.getRenderDimensions(renderDimensions);
            this.camera.aspect = renderDimensions.x / renderDimensions.y;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(renderDimensions.x, renderDimensions.y);
            this.updateRealProjectionMatrix(renderDimensions);
            this.updateSplatMeshUniforms();
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
        this.updateRealProjectionMatrix(renderDimensions);

        this.scene = new THREE.Scene();

        this.renderer = new THREE.WebGLRenderer({
            antialias: false
        });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setSize(renderDimensions.x, renderDimensions.y);

        if (!this.controls) {
            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.maxPolarAngle = (0.9 * Math.PI) / 2;
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.15;
            this.controls.target.copy(this.initialCameraLookAt);
        }

        window.addEventListener('resize', this.resizeFunc, false);

        this.rootElement.appendChild(this.renderer.domElement);

        this.sortWorker = new Worker(
            URL.createObjectURL(
                new Blob(['(', createSortWorker.toString(), ')(self)'], {
                    type: 'application/javascript',
                }),
            ),
        );

        this.sortWorker.onmessage = (e) => {
            let {color, centerCov} = e.data;
            this.updateSplatMeshAttributes(color, centerCov);
            this.updateSplatMeshUniforms();
        };
    }

    updateSplatMeshAttributes(colors, centerCovariances) {
        const vertexCount = centerCovariances.length / 9;
        const geometry = this.splatMesh.geometry;

        geometry.attributes.splatCenterCovariance.set(centerCovariances);
        geometry.attributes.splatCenterCovariance.needsUpdate = true;

        geometry.attributes.splatColor.set(colors);
        geometry.attributes.splatColor.needsUpdate = true;

        geometry.instanceCount = vertexCount;
    }

    updateSplatMeshUniforms = function() {

        const renderDimensions = new THREE.Vector2();

        return function() {
            this.getRenderDimensions(renderDimensions);
            this.splatMesh.material.uniforms.realProjectionMatrix.value.copy(this.realProjectionMatrix);
            this.splatMesh.material.uniforms.focal.value.set(this.cameraSpecs.fx, this.cameraSpecs.fy);
            this.splatMesh.material.uniforms.viewport.value.set(renderDimensions.x, renderDimensions.y);
            this.splatMesh.material.uniformsNeedUpdate = true;
        };

    }();

    loadFile(fileName) {
        const loadingSpinner = new LoadingSpinner();
        loadingSpinner.show();
        const loadPromise = new Promise((resolve, reject) => {
            let fileLoadPromise;
            if (fileName.endsWith('.splat')) {
                fileLoadPromise = new SplatLoader().loadFromFile(fileName);
            } else if (fileName.endsWith('.ply')) {
                fileLoadPromise = new PlyLoader().loadFromFile(fileName);
            } else {
                reject(new Error(`Viewer::loadFile -> File format not supported: ${fileName}`));
            }
            fileLoadPromise
            .then((splatBuffer) => {
                resolve(splatBuffer);
            })
            .catch((e) => {
                reject(new Error(`Viewer::loadFile -> Could not load file ${fileName}`));
            });
        });

        return loadPromise.then((splatBuffer) => {
            this.splatBuffer = splatBuffer;
            this.splatMesh = this.buildMesh(this.splatBuffer);
            this.splatMesh.frustumCulled = false;
            loadingSpinner.hide();
            this.scene.add(this.splatMesh);
            this.updateWorkerBuffer();

        });
    }

    addDebugMeshesToScene() {
        const sphereGeometry = new THREE.SphereGeometry(1, 32, 32);

        let sphereMesh = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({color: 0xff0000}));
        this.scene.add(sphereMesh);
        sphereMesh.position.set(-50, 0, 0);

        sphereMesh = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({color: 0xff0000}));
        this.scene.add(sphereMesh);
        sphereMesh.position.set(50, 0, 0);

        sphereMesh = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({color: 0x00ff00}));
        this.scene.add(sphereMesh);
        sphereMesh.position.set(0, 0, -50);

        sphereMesh = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({color: 0x00ff00}));
        this.scene.add(sphereMesh);
        sphereMesh.position.set(0, 0, 50);
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
        this.updateView();
        this.renderer.autoClear = false;
        this.renderer.render(this.scene, this.camera);
    }

    updateView = function() {

        const tempMatrix = new THREE.Matrix4();
        const tempVector2 = new THREE.Vector2();
        const cameraPositionArray = [];

        return function() {
            this.getRenderDimensions(tempVector2);
            tempMatrix.copy(this.camera.matrixWorld).invert();
            tempMatrix.premultiply(this.realProjectionMatrix);
            cameraPositionArray[0] = this.camera.position.x;
            cameraPositionArray[1] = this.camera.position.y;
            cameraPositionArray[2] = this.camera.position.z;
            this.sortWorker.postMessage({
                sort: {
                    'view': tempMatrix.elements,
                    'cameraPosition': cameraPositionArray
                }
            });
        };

    }();

    updateWorkerBuffer = function() {

        return function() {
            this.sortWorker.postMessage({
                bufferUpdate: {
                    rowSizeFloats: SplatBuffer.RowSizeFloats,
                    rowSizeBytes: SplatBuffer.RowSizeBytes,
                    splatBuffer: this.splatBuffer.getBufferData(),
                    precomputedCovariance: this.splatBuffer.getCovarianceBufferData(),
                    precomputedColor: this.splatBuffer.getColorBufferData(),
                    vertexCount: this.splatBuffer.getVertexCount(),
                }
            });
        };

    }();

    buildMaterial() {

        const vertexShaderSource = `
            #include <common>
            precision mediump float;

            attribute vec4 splatColor;
            attribute mat3 splatCenterCovariance;

            uniform mat4 realProjectionMatrix;
            uniform vec2 focal;
            uniform vec2 viewport;

            varying vec4 vColor;
            varying vec2 vPosition;
            varying vec2 vUv;
            varying vec4 conicOpacity;

            void main () {

            vec3 splatCenter = splatCenterCovariance[0];
            vec3 cov3D_M11_M12_M13 = splatCenterCovariance[1];
            vec3 cov3D_M22_M23_M33 = splatCenterCovariance[2];

            vec4 camspace = viewMatrix * vec4(splatCenter, 1);
            vec4 pos2d = realProjectionMatrix * camspace;

            float bounds = 1.2 * pos2d.w;
            if (pos2d.z < -pos2d.w || pos2d.x < -bounds || pos2d.x > bounds
                || pos2d.y < -bounds || pos2d.y > bounds) {
                gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                return;
            }



            
            mat3 Vrk = mat3(
                cov3D_M11_M12_M13.x, cov3D_M11_M12_M13.y, cov3D_M11_M12_M13.z,
                cov3D_M11_M12_M13.y, cov3D_M22_M23_M33.x, cov3D_M22_M23_M33.y,
                cov3D_M11_M12_M13.z, cov3D_M22_M23_M33.y, cov3D_M22_M23_M33.z
            );

            mat3 J = mat3(
                focal.x / camspace.z, 0., -(focal.x * camspace.x) / (camspace.z * camspace.z),
                0., focal.y / camspace.z, -(focal.y * camspace.y) / (camspace.z * camspace.z),
                0., 0., 0.
            );

            mat3 W = transpose(mat3(viewMatrix));
            mat3 T = W * J;
            mat3 cov2Dm = transpose(T) * Vrk * T;
            cov2Dm[0][0] += 0.3;
            cov2Dm[1][1] += 0.3;
            vec3 cov2Dv = vec3(cov2Dm[0][0], cov2Dm[0][1], cov2Dm[1][1]);


            vec2 vCenter = vec2(pos2d) / pos2d.w;

            float diagonal1 = cov2Dv.x;
            float offDiagonal = cov2Dv.y;
            float diagonal2 = cov2Dv.z;

            float mid = 0.5 * (diagonal1 + diagonal2);
            float radius = length(vec2((diagonal1 - diagonal2) / 2.0, offDiagonal));
            float lambda1 = mid + radius;
            float lambda2 = max(mid - radius, 0.1);
            vec2 diagonalVector = normalize(vec2(offDiagonal, lambda1 - diagonal1));
            vec2 v1 = min(sqrt(2.0 * lambda1), 1024.0) * diagonalVector;
            vec2 v2 = min(sqrt(2.0 * lambda2), 1024.0) * vec2(diagonalVector.y, -diagonalVector.x);

            vColor = splatColor;
            vPosition = position.xy;

            vec2 projectedCovariance = vCenter +
                                       position.x * v1 / viewport * 2.0 +
                                       position.y * v2 / viewport * 2.0;

            gl_Position = vec4(projectedCovariance, 0.0, 1.0);

        }`;

        const fragmentShaderSource = `
            #include <common>
            precision mediump float;

            varying vec4 vColor;
            varying vec2 vPosition;
            varying vec4 conicOpacity;
            varying vec2 vUv;

            void main () {
    
                float A = -dot(vPosition, vPosition);
                if (A < -4.0) discard;
                float B = exp(A) * vColor.a;
                gl_FragColor = vec4(B * vColor.rgb, B);

                /*
                // we want the distance from the gaussian to the fragment while uv
                // is the reverse
                vec2 d = -vUv.xy;
                vec3 conic = conicOpacity.xyz;
                float power = -0.5 * (conic.x * d.x * d.x + conic.z * d.y * d.y) + conic.y * d.x * d.y;
                float opacity = conicOpacity.w;
            
                if (power > 0.0) discard;
            
                float alpha = min(0.99, opacity * exp(power));
            
                gl_FragColor = vec4(vColor.rgb * alpha, alpha);*/




            }`;

        const uniforms = {
            'realProjectionMatrix': {
                'type': 'v4v',
                'value': new THREE.Matrix4()
            },
            'focal': {
                'type': 'v2',
                'value': new THREE.Vector2()
            },
            'viewport': {
                'type': 'v2',
                'value': new THREE.Vector2()
            },
        };

        return new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: vertexShaderSource,
            fragmentShader: fragmentShaderSource,
            transparent: true,
            alphaTest: 1.0,
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneMinusDstAlphaFactor,
            blendDst: THREE.OneFactor,
            blendSrcAlpha: THREE.OneMinusDstAlphaFactor,
            blendDstAlpha: THREE.OneFactor,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide
        });
    }

    buildGeomtery(splatBuffer) {

        const baseGeometry = new THREE.BufferGeometry();

        const positionsArray = new Float32Array(18);
        const positions = new THREE.BufferAttribute(positionsArray, 3);
        baseGeometry.setAttribute('position', positions);
        positions.setXYZ(2, -2.0, 2.0, 0.0);
        positions.setXYZ(1, -2.0, -2.0, 0.0);
        positions.setXYZ(0, 2.0, 2.0, 0.0);
        positions.setXYZ(5, -2.0, -2.0, 0.0);
        positions.setXYZ(4, 2.0, -2.0, 0.0);
        positions.setXYZ(3, 2.0, 2.0, 0.0);
        positions.needsUpdate = true;

        const geometry = new THREE.InstancedBufferGeometry().copy(baseGeometry);

        const splatColorsArray = new Float32Array(splatBuffer.getVertexCount() * 4);
        const splatColors = new THREE.InstancedBufferAttribute(splatColorsArray, 4, false);
        splatColors.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('splatColor', splatColors);

        const splatCentersArray = new Float32Array(splatBuffer.getVertexCount() * 9);
        const splatCenters = new THREE.InstancedBufferAttribute(splatCentersArray, 9, false);
        splatCenters.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('splatCenterCovariance', splatCenters);

        return geometry;
    }

    buildMesh(splatBuffer) {
        const geometry = this.buildGeomtery(splatBuffer);
        const material = this.buildMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        return mesh;
    }
}
