import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';
import { PlyLoader } from './PlyLoader.js';
import { SplatLoader } from './SplatLoader.js';


function createWorker(self) {
	let buffer;
	let vertexCount = 0;
	let viewProj;
	// 6*4 + 4 + 4 = 8*4
	// XYZ - Position (Float32)
	// XYZ - Scale (Float32)
	// RGBA - colors (uint8)
	// IJKL - quaternion/rot (uint8)
	const rowLength = 3 * 4 + 3 * 4 + 4 + 4;
	let depthMix = new BigInt64Array();
	let lastProj = [];

	const runSort = (viewProj) => {

		if (!buffer) return;

		const f_buffer = new Float32Array(buffer);
		const u_buffer = new Uint8Array(buffer);

		const covA = new Float32Array(3 * vertexCount);
		const covB = new Float32Array(3 * vertexCount);

		const center = new Float32Array(3 * vertexCount);
		const color = new Float32Array(4 * vertexCount);

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
		// console.time("sort");

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

			center[3 * j + 0] = f_buffer[8 * i + 0];
			center[3 * j + 1] = f_buffer[8 * i + 1];
			center[3 * j + 2] = f_buffer[8 * i + 2];

			color[4 * j + 0] = u_buffer[32 * i + 24 + 0] / 255;
			color[4 * j + 1] = u_buffer[32 * i + 24 + 1] / 255;
			color[4 * j + 2] = u_buffer[32 * i + 24 + 2] / 255;
			color[4 * j + 3] = u_buffer[32 * i + 24 + 3] / 255;

			let scale = [
				f_buffer[8 * i + 3 + 0],
				f_buffer[8 * i + 3 + 1],
				f_buffer[8 * i + 3 + 2],
			];
			let rot = [
				(u_buffer[32 * i + 28 + 0] - 128) / 128,
				(u_buffer[32 * i + 28 + 1] - 128) / 128,
				(u_buffer[32 * i + 28 + 2] - 128) / 128,
				(u_buffer[32 * i + 28 + 3] - 128) / 128,
			];

			const R = [
				1.0 - 2.0 * (rot[2] * rot[2] + rot[3] * rot[3]),
				2.0 * (rot[1] * rot[2] + rot[0] * rot[3]),
				2.0 * (rot[1] * rot[3] - rot[0] * rot[2]),

				2.0 * (rot[1] * rot[2] - rot[0] * rot[3]),
				1.0 - 2.0 * (rot[1] * rot[1] + rot[3] * rot[3]),
				2.0 * (rot[2] * rot[3] + rot[0] * rot[1]),

				2.0 * (rot[1] * rot[3] + rot[0] * rot[2]),
				2.0 * (rot[2] * rot[3] - rot[0] * rot[1]),
				1.0 - 2.0 * (rot[1] * rot[1] + rot[2] * rot[2]),
			];

			// Compute the matrix product of S and R (M = S * R)
			const M = [
				scale[0] * R[0],
				scale[0] * R[1],
				scale[0] * R[2],
				scale[1] * R[3],
				scale[1] * R[4],
				scale[1] * R[5],
				scale[2] * R[6],
				scale[2] * R[7],
				scale[2] * R[8],
			];

			covA[3 * j + 0] = M[0] * M[0] + M[3] * M[3] + M[6] * M[6];
			covA[3 * j + 1] = M[0] * M[1] + M[3] * M[4] + M[6] * M[7];
			covA[3 * j + 2] = M[0] * M[2] + M[3] * M[5] + M[6] * M[8];
			covB[3 * j + 0] = M[1] * M[1] + M[4] * M[4] + M[7] * M[7];
			covB[3 * j + 1] = M[1] * M[2] + M[4] * M[5] + M[7] * M[8];
			covB[3 * j + 2] = M[2] * M[2] + M[5] * M[5] + M[8] * M[8];
		}

		self.postMessage({ covA, center, color, covB, viewProj }, [
			covA.buffer,
			center.buffer,
			color.buffer,
			covB.buffer,
		]);

		// console.timeEnd("sort");
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
		/*if (e.data.ply) {
			vertexCount = 0;
			runSort(viewProj);
			buffer = processPlyBuffer(e.data.ply);
			vertexCount = Math.floor(buffer.byteLength / rowLength);
			postMessage({ buffer: buffer });
		} else*/

        if (e.data.buffer) {
			buffer = e.data.buffer;
			vertexCount = e.data.vertexCount;
		} else if (e.data.vertexCount) {
			vertexCount = e.data.vertexCount;
		} else if (e.data.view) {
			viewProj = e.data.view;
			throttledSort();
		}

	};
}

export class Viewer {

    constructor(rootElement = null, controls = null, selfDrivenMode = true) {
        this.rootElement = rootElement;
        this.controls = controls;
        this.selfDrivenMode = selfDrivenMode;
        this.scene = null;
        this.camera = null;
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

    onResize = function() {

        const renderDimensions = new THREE.Vector2();

        return function () {
            this.renderer.setSize(1, 1);
            this.getRenderDimensions(renderDimensions);
            this.camera.aspect = renderDimensions.x / renderDimensions.y;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(renderDimensions.x, renderDimensions.y);
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
        this.camera.up.set(0, -1, -0.6).normalize();
    
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

                let { covA, covB, center, color, viewProj } = e.data;
                lastData = e.data;
    
                lastProj = viewProj;
                const vertexCount = center.length / 3;

                const geometry  = this.splatMesh.geometry;

                geometry.attributes.splatCenter.set(center);
                geometry.attributes.splatCenter.needsUpdate = true;

                geometry.attributes.splatColor.set(color);
                geometry.attributes.splatColor.needsUpdate = true;

                geometry.attributes.splatCovarianceX.set(covA);
                geometry.attributes.splatCovarianceX.needsUpdate = true;

                geometry.attributes.splatCovarianceY.set(covB);
                geometry.attributes.splatCovarianceY.needsUpdate = true;

                this.splatMesh.material.uniforms.focal.value.set(renderDimensions.x, renderDimensions.y);
                this.splatMesh.material.uniforms.viewport.value.set(renderDimensions.x, renderDimensions.y);
                this.splatMesh.material.uniformsNeedUpdate = true;

                /*
                fy: 1164.6601287484507,
                fx: 1159.5880733038064,
                */

                /*// viewport
                const u_viewport = gl.getUniformLocation(program, "viewport");
                gl.uniform2fv(u_viewport, new Float32Array([canvas.width, canvas.height]));

                // focal
                const u_focal = gl.getUniformLocation(program, "focal");
                gl.uniform2fv(
                    u_focal,
                    new Float32Array([camera.fx / downsample, camera.fy / downsample]),
                );*/

    
    /*            gl.bindBuffer(gl.ARRAY_BUFFER, centerBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, center, gl.DYNAMIC_DRAW);
    
                gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, color, gl.DYNAMIC_DRAW);
    
                gl.bindBuffer(gl.ARRAY_BUFFER, covABuffer);
                gl.bufferData(gl.ARRAY_BUFFER, covA, gl.DYNAMIC_DRAW);
    
                gl.bindBuffer(gl.ARRAY_BUFFER, covBBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, covB, gl.DYNAMIC_DRAW);*/

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
            .catch(() => {
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
        const tempProjectionMatrix = new THREE.Matrix4();
        const tempVector2 = new THREE.Vector2();

        return function () {
            this.getRenderDimensions(tempVector2);
            const zFar = 500.0;
            const zNear = 0.1;

            /*tempProjectionMatrix.elements = [
                [(2 * 1164.6601287484507) / tempVector2.x, 0, 0, 0],
                [0, -(2 * 1159.5880733038064) / tempVector2.y, 0, 0],
                [0, 0, zFar / (zFar - zNear), 1],
                [0, 0, -(zFar * zNear) / (zFar - zNear), 0],
            ].flat();*/

           /* tempProjectionMatrix.elements = [
                [(2 * 1164.6601287484507) / tempVector2.x, 0, 0, 0],
                [0, -(2 * 1159.5880733038064) / tempVector2.y, 0, 0],
                [0, 0, zFar / (zFar - zNear), -1],
                [0, 0, -(zFar * zNear) / (zFar - zNear), 0],
            ].flat();*/


            tempProjectionMatrix.elements = [
                [(2 * 1159.5880733038064) / tempVector2.x, 0, 0, 0],
                [0, (2 * 1164.6601287484507) / tempVector2.y, 0, 0],
                [0, 0, -zFar / (zFar - zNear), -1],
                [0, 0, -(2.0 * zFar * zNear) / (zFar - zNear), 0],
            ].flat();
           
            //tempProjectionMatrix.copy(this.camera.projectionMatrix);

            tempMatrix.copy(this.camera.matrixWorld).invert();
            tempMatrix.premultiply(tempProjectionMatrix);
            this.worker.postMessage({view: tempMatrix.elements});
        };

    }();

    updateWorkerBuffer = function () {

        return function () {
            this.worker.postMessage({
                buffer: this.splatBuffer.getBufferData(),
                vertexCount: this.splatBuffer.getVertexCount()
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
            attribute vec3 splatCenter;
            attribute vec3 splatCovarianceX;
            attribute vec3 splatCovarianceY;
        
            uniform vec2 focal;
            uniform vec2 viewport;
        
            varying vec4 vColor;
            varying vec2 vPosition;
        
            void main () {

            vec2 localViewport = viewport;
            vec2 localFocal = vec2(1159.5880733038064, 1164.6601287484507);

            float zFar = 500.0;
            float zNear = 0.1; 
            mat4 projMat;
            
            projMat = mat4(
                (2.0 * localFocal.x) / localViewport.x, 0, 0, 0,
                0, (2.0 * localFocal.y) / localViewport.y, 0, 0,
                0, 0, -(zFar + zNear) / (zFar - zNear), -1,
                0, 0, -(2.0 * zFar * zNear) / (zFar - zNear), 0
            );

            vec4 camspace = viewMatrix * vec4(splatCenter, 1);
            vec4 pos2d = projMat * camspace;

        
            float bounds = 1.2 * pos2d.w;
            if (pos2d.z < -pos2d.w || pos2d.x < -bounds || pos2d.x > bounds
                || pos2d.y < -bounds || pos2d.y > bounds) {
                gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                return;
            }
        
            vec3 covA = splatCovarianceX;
            vec3 covB = splatCovarianceY;
            mat3 Vrk = mat3(
                covA.x, covA.y, covA.z, 
                covA.y, covB.x, covB.y,
                covA.z, covB.y, covB.z
            );
            
            mat3 J = mat3(
                localFocal.x / camspace.z, 0., -(localFocal.x * camspace.x) / (camspace.z * camspace.z), 
                0., localFocal.y / camspace.z, -(localFocal.y * camspace.y) / (camspace.z * camspace.z), 
                0., 0., 0.
            );
        
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
                     + position.x * v1 / localViewport * 2.0
                     + position.y * v2 / localViewport * 2.0, 0.0, 1.0);
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

        const splatCentersArray = new Float32Array(splatBuffer.getVertexCount() * 3);
        const splatCenters = new THREE.InstancedBufferAttribute(splatCentersArray, 3, false);
        splatCenters.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('splatCenter', splatCenters);

        const splatColorsArray = new Float32Array(splatBuffer.getVertexCount() * 4);
        const splatColors = new THREE.InstancedBufferAttribute(splatColorsArray, 4, false);
        splatColors.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('splatColor', splatColors);

        const splatCovariancesXArray = new Float32Array(splatBuffer.getVertexCount() * 3);
        const splatCovariancesX = new THREE.InstancedBufferAttribute(splatCovariancesXArray, 3, false);
        splatCovariancesX.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('splatCovarianceX', splatCovariancesX);

        const splatCovariancesYArray = new Float32Array(splatBuffer.getVertexCount() * 3);
        const splatCovariancesY = new THREE.InstancedBufferAttribute(splatCovariancesYArray, 3, false);
        splatCovariancesY.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('splatCovarianceY', splatCovariancesY);

        return geometry;
    }

    buildMesh(splatBuffer) {
        const geometry = this.buildGeomtery(splatBuffer);
        const material = this.buildMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        return mesh;
    }
}