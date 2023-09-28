import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';
import { PlyLoader } from './PlyLoader.js';
import { SplatLoader } from './SplatLoader.js';


function createWorker(self) {
	let buffer;
    let precomputedCenterCovariance;
	let vertexCount = 0;
	let viewProj;
	let depthMix = new BigInt64Array();
	let lastProj = [];

	const runSort = (viewProj) => {

		if (!buffer) return;

		const f_buffer = new Float32Array(buffer);
		const u_buffer = new Uint8Array(buffer);
        const pcc_buffer = new Float32Array(precomputedCenterCovariance);

		const color = new Float32Array(4 * vertexCount);
        const centerCov = new Float32Array(9 * vertexCount);

		if (depthMix.length !== vertexCount) {
			depthMix = new BigInt64Array(vertexCount);
			const indexMix = new Uint32Array(depthMix.buffer);
			for (let j = 0; j < vertexCount; j++) {
				indexMix[2 * j] = j;
			}
		} else {
			let dot =
				lastProj[2] * viewProj[2] +
				lastProj[6] * viewProj[6] +
				lastProj[10] * viewProj[10];
			if (Math.abs(dot - 1) < 0.01) {
				return;
			}
		}

		const floatMix = new Float32Array(depthMix.buffer);
		const indexMix = new Uint32Array(depthMix.buffer);

		for (let j = 0; j < vertexCount; j++) {
			let i = indexMix[2 * j];
			floatMix[2 * j + 1] =
				10000 +
				viewProj[2] * f_buffer[8 * i + 0] +
				viewProj[6] * f_buffer[8 * i + 1] +
				viewProj[10] * f_buffer[8 * i + 2];
		}

		lastProj = viewProj;

		depthMix.sort();

		for (let j = 0; j < vertexCount; j++) {
			const i = indexMix[2 * j];

			centerCov[9 * j + 0] = pcc_buffer[9 * i + 0]; 
			centerCov[9 * j + 1] = pcc_buffer[9 * i + 1]; 
			centerCov[9 * j + 2] = pcc_buffer[9 * i + 2];

			color[4 * j + 0] = u_buffer[32 * i + 24 + 0] / 255;
			color[4 * j + 1] = u_buffer[32 * i + 24 + 1] / 255;
			color[4 * j + 2] = u_buffer[32 * i + 24 + 2] / 255;
			color[4 * j + 3] = u_buffer[32 * i + 24 + 3] / 255;

			centerCov[9 * j + 3 + 0] = pcc_buffer[9 * i + 3]; 
			centerCov[9 * j + 3 + 1] = pcc_buffer[9 * i + 4]; 
			centerCov[9 * j + 3 + 2] = pcc_buffer[9 * i + 5]; 
			centerCov[9 * j + 6 + 0] = pcc_buffer[9 * i + 6]; 
			centerCov[9 * j + 6 + 1] = pcc_buffer[9 * i + 7]; 
			centerCov[9 * j + 6 + 2] = pcc_buffer[9 * i + 8]; 
		}

		self.postMessage({ color, centerCov, viewProj }, [
			color.buffer,
			centerCov.buffer,
		]);

	};

	const throttledSort = () => {
		if (!sortRunning) {
			sortRunning = true;
			let lastView = viewProj;
			runSort(lastView);
			setTimeout(() => {
				sortRunning = false;
				if (lastView !== viewProj) {
					throttledSort();
				}
			}, 0);
		}
	};

	let sortRunning;
	self.onmessage = (e) => {
        if (e.data.bufferUpdate) {
			buffer = e.data.bufferUpdate.buffer;
            precomputedCenterCovariance = e.data.bufferUpdate.precomputedCenterCovariance;
			vertexCount = e.data.bufferUpdate.vertexCount;
		} else if (e.data.sort) {
			viewProj = e.data.sort.view;
			throttledSort();
		}
	};
}

const DEFAULT_CAMERA_SPECS = {
    'fx': 1159.5880733038064,
    'fy': 1164.6601287484507,
    'near': 0.1,
    'far': 500
}

export class Viewer {

    constructor(rootElement = null, cameraUp = [0, 1, 0], cameraSpecs = null, controls = null, selfDrivenMode = true) {
        this.rootElement = rootElement;
        this.cameraUp = new THREE.Vector3().fromArray(cameraUp);
        this.cameraSpecs = cameraSpecs || DEFAULT_CAMERA_SPECS;
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
        this.worker = null;
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

        return function () {
            this.renderer.setSize(1, 1);
            this.getRenderDimensions(renderDimensions);
            this.camera.aspect = renderDimensions.x / renderDimensions.y;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(renderDimensions.x, renderDimensions.y);
            this.updateRealProjectionMatrix(renderDimensions);
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
        this.camera.position.set(0, 10, 15);
        this.camera.up.copy(this.cameraUp).normalize();
        this.updateRealProjectionMatrix(renderDimensions);
    
        this.scene = new THREE.Scene();
    
        this.renderer = new THREE.WebGLRenderer({
            antialias: true
        });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setSize(renderDimensions.x, renderDimensions.y);

        if (!this.controls) {
            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.maxPolarAngle = (0.9 * Math.PI) / 2;
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.15;
        }
    
        window.addEventListener('resize', this.resizeFunc, false);
    
        this.rootElement.appendChild(this.renderer.domElement);

        this.worker = new Worker(
            URL.createObjectURL(
                new Blob(["(", createWorker.toString(), ")(self)"], {
                    type: "application/javascript",
                }),
            ),
        );

        let lastData, lastProj;
        this.worker.onmessage = (e) => {
            if (e.data.buffer) {

            } else {
                this.getRenderDimensions(renderDimensions);

                let { color, centerCov, viewProj } = e.data;
                lastData = e.data;
    
                lastProj = viewProj;
                const vertexCount = centerCov.length / 9;

                const geometry  = this.splatMesh.geometry;

                geometry.attributes.splatCenterCovariance.set(centerCov);
                geometry.attributes.splatCenterCovariance.needsUpdate = true;

                geometry.attributes.splatColor.set(color);
                geometry.attributes.splatColor.needsUpdate = true;

                this.splatMesh.material.uniforms.realProjectionMatrix.value.copy(this.realProjectionMatrix);
                this.splatMesh.material.uniforms.focal.value.set(this.cameraSpecs.fx, this.cameraSpecs.fy);
                this.splatMesh.material.uniforms.viewport.value.set(renderDimensions.x, renderDimensions.y);
                this.splatMesh.material.uniformsNeedUpdate = true;

                geometry.instanceCount = vertexCount;
            }
        };
    }

    loadFile(fileName) {
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
            })
        });

        return loadPromise.then((splatBuffer) => {
            this.splatBuffer = splatBuffer;
            this.splatMesh = this.buildMesh(this.splatBuffer);
            this.splatMesh.frustumCulled = false;
            this.scene.add(this.splatMesh);

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

            this.updateWorkerBuffer();

        });
    }

    start() {
        if (this.selfDrivenMode) {
            requestAnimationFrame(this.selfDrivenUpdateFunc);
        } else {
            throw new Error("Cannot start viewer unless it is in self driven mode.");
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

    updateView = function () {

        const tempMatrix = new THREE.Matrix4();
        const tempVector2 = new THREE.Vector2();

        return function () {
            this.getRenderDimensions(tempVector2);
            tempMatrix.copy(this.camera.matrixWorld).invert();
            tempMatrix.premultiply(this.realProjectionMatrix);
            this.worker.postMessage({
                sort: {
                    'view': tempMatrix.elements
                }
            });
        };

    }();

    updateWorkerBuffer = function () {

        return function () {
            this.worker.postMessage({
                bufferUpdate: {
                    buffer: this.splatBuffer.getBufferData(),
                    precomputedCenterCovariance: this.splatBuffer.getCenterCovarianceBufferData(),
                    vertexCount: this.splatBuffer.getVertexCount()
                }
            });
        };

    }();

    buildMaterial(useLogarithmicDepth = false) {

        let vertexShaderSource = `
            #include <common>
        `;

        if (useLogarithmicDepth) {
            vertexShaderSource += `
                #include <logdepthbuf_pars_vertex> 
            `;
        }

        vertexShaderSource += `
            precision mediump float;
        
            attribute vec4 splatColor;
            attribute mat3 splatCenterCovariance;
        
            uniform mat4 realProjectionMatrix;
            uniform vec2 focal;
            uniform vec2 viewport;
        
            varying vec4 vColor;
            varying vec2 vPosition;
        
            void main () {

            vec3 splatCenter = vec3(splatCenterCovariance[0][0], splatCenterCovariance[0][1], splatCenterCovariance[0][2]);
            vec3 covA = vec3(splatCenterCovariance[1][0], splatCenterCovariance[1][1], splatCenterCovariance[1][2]);
            vec3 covB = vec3(splatCenterCovariance[2][0], splatCenterCovariance[2][1], splatCenterCovariance[2][2]);

            vec4 camspace = viewMatrix * vec4(splatCenter, 1);
            vec4 pos2d = realProjectionMatrix * camspace;

            float bounds = 1.2 * pos2d.w;
            if (pos2d.z < -pos2d.w || pos2d.x < -bounds || pos2d.x > bounds
                || pos2d.y < -bounds || pos2d.y > bounds) {
                gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                return;
            }
        
            mat3 Vrk = mat3(
                covA.x, covA.y, covA.z, 
                covA.y, covB.x, covB.y,
                covA.z, covB.y, covB.z
            );
            
            mat3 J = mat3(
                focal.x / camspace.z, 0., -(focal.x * camspace.x) / (camspace.z * camspace.z), 
                0., focal.y / camspace.z, -(focal.y * camspace.y) / (camspace.z * camspace.z), 
                0., 0., 0.
            );

           /* float limx = 1.3f * .00001;
            float limy = 1.3f * .00001;
            float txtz = camspace.x / camspace.z;
            float tytz = camspace.y / camspace.z;
            camspace.x = min(limx, max(-limx, txtz)) * camspace.z;
            camspace.y = min(limy, max(-limy, tytz)) * camspace.z;

            mat3 J = mat3(
                500.0 / camspace.z, 0., -(500.0  * camspace.x) / (camspace.z * camspace.z), 
                0., 500.0  / camspace.z, -(500.0 * camspace.y) / (camspace.z * camspace.z), 
                0., 0., 0.
            );*/
        
            mat3 W = transpose(mat3(viewMatrix));
            mat3 T = W * J;
            mat3 cov = transpose(T) * Vrk * T;
            
            vec2 vCenter = vec2(pos2d) / pos2d.w;
        
            float diagonal1 = (cov[0][0] + 0.3);
            float offDiagonal = cov[0][1];
            float diagonal2 = (cov[1][1] + 0.3);
        
            float mid = 0.5 * (diagonal1 + diagonal2);
            float radius = length(vec2((diagonal1 - diagonal2) / 2.0, offDiagonal));
            float lambda1 = mid + radius;
            float lambda2 = max(mid - radius, 0.1);
            vec2 diagonalVector = normalize(vec2(offDiagonal, lambda1 - diagonal1));
            vec2 v1 = min(sqrt(2.0 * lambda1), 1024.0) * diagonalVector;
            vec2 v2 = min(sqrt(2.0 * lambda2), 1024.0) * vec2(diagonalVector.y, -diagonalVector.x);
        
            vColor = splatColor;
            vPosition = position.xy;
        
             gl_Position = vec4(
                 vCenter
                     + position.x * v1 / viewport * 2.0
                     + position.y * v2 / viewport * 2.0, 0.0, 1.0);
                     `;

        if (useLogarithmicDepth) {
            vertexShaderSource += `
                #include <logdepthbuf_vertex>
            `;
        }
      
        vertexShaderSource += `}`;
      
        let fragmentShaderSource = `
            #include <common>
        `;

        if (useLogarithmicDepth) {
            fragmentShaderSource += `
                #include <logdepthbuf_pars_fragment>
            `;
        }

        fragmentShaderSource += `
            precision mediump float;
            
            varying vec4 vColor;
            varying vec2 vPosition;
        
            void main () {`;

        if (useLogarithmicDepth) {
            fragmentShaderSource += `
                #include <logdepthbuf_fragment>
            `;
        }    

        fragmentShaderSource += `
                float A = -dot(vPosition, vPosition);
                if (A < -4.0) discard;
                float B = exp(A) * vColor.a;
                gl_FragColor = vec4(B * vColor.rgb, B);
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
            side:  THREE.DoubleSide
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


        const geometry  = new THREE.InstancedBufferGeometry().copy(baseGeometry);

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