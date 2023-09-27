import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';
import { PlyLoader } from './PlyLoader.js';
import { SplatLoader } from './SplatLoader.js';

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
    }

    onResize() {
        this.renderer.setSize(1, 1);
        const renderWidth = this.rootElement.offsetWidth;
        const renderHeight =  this.rootElement.offsetHeight;
        this.camera.aspect = renderWidth / renderHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(renderWidth, renderHeight);
    }

    init() {

        if (!this.rootElement) {
            this.rootElement = document.createElement('div');
            this.rootElement.style.width = '100%';
            this.rootElement.style.height = '100%';
            document.body.appendChild(this.rootElement);
        }

        const renderWidth = this.rootElement.offsetWidth;
        const renderHeight = this.rootElement.offsetHeight;
    
        this.camera = new THREE.PerspectiveCamera(70, renderWidth / renderHeight, 0.1, 500);
        this.camera.position.set(0, 10, 15);
    
        this.scene = new THREE.Scene();
    
        this.renderer = new THREE.WebGLRenderer({
            antialias: true
        });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setSize(renderWidth, renderHeight);

        if (!this.controls) {
            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.maxPolarAngle = (0.9 * Math.PI) / 2;
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.15;
        }
    
        window.addEventListener('resize', this.resizeFunc, false);
    
        this.rootElement.appendChild(this.renderer.domElement);
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
        this.renderer.render(this.scene, this.camera);
    }

    buildMaterial(useLogarithmicDepth) {

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
            vec4 camspace = viewMatrix * vec4(splatCenter, 1);
            vec4 pos2d = projectionMatrix * camspace;
        
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
                focal.x / camspace.z, 0., -(focal.x * camspace.x) / (camspace.z * camspace.z), 
                0., -focal.y / camspace.z, (focal.y * camspace.y) / (camspace.z * camspace.z), 
                0., 0., 0.
            );
        
            mat3 W = transpose(mat3(viewMatrix));
            mat3 T = W * J;
            mat3 cov = transpose(T) * Vrk * T;
            
            vec2 vCenter = vec2(pos2d) / pos2d.w;
        
            float diagonal1 = cov[0][0] + 0.3;
            float offDiagonal = cov[0][1];
            float diagonal2 = cov[1][1] + 0.3;
        
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
                    + position.y * v2 / viewport * 2.0, 0.0, 1.0);`;

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
            depthWrite: false
        });
    }

    buildGeomtery(splatBuffer) {

        const baseGeometry = new THREE.BufferGeometry();

        const positionsArray = new Float32Array(18);
        const positions = new THREE.BufferAttribute(positionsArray, 3);
        baseGeometry.setAttribute('position', positions);


        const geometry  = new THREE.InstancedBufferGeometry().copy(baseGeometry);

        const splatCentersArray = new Float32Array(splatBuffer.getVertexCount());
        const splatCenters = new THREE.InstancedBufferAttribute(splatCentersArray, 2, false);
        splatCenters.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('splatCenter', splatCenters);

        const splatColorsArray = new Float32Array(splatBuffer.getVertexCount());
        const splatColors = new THREE.InstancedBufferAttribute(splatColorsArray, 4, false);
        splatColors.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('splatColor', splatColors);

        const splatCovariancesXArray = new Float32Array(splatBuffer.getVertexCount());
        const splatCovariancesX = new THREE.InstancedBufferAttribute(splatCovariancesXArray, 1, false);
        splatCovariancesX.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('splatCovarianceX', splatCovariancesX);

        const splatCovariancesYArray = new Float32Array(splatBuffer.getVertexCount());
        const splatCovariancesY = new THREE.InstancedBufferAttribute(splatCovariancesYArray, 1, false);
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