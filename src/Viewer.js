import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';
import { PlyLoader } from './PlyLoader.js';
import { SplatLoader } from './SplatLoader.js';
import { SplatBuffer } from './SplatBuffer.js';
import { LoadingSpinner } from './LoadingSpinner.js';
import { SceneHelper } from './SceneHelper.js';
import { SplatTree } from './splattree/SplatTree.js';
import { Raycaster } from './raycaster/Raycaster.js';
import { SplatMesh } from './SplatMesh.js';
import { createSortWorker } from './worker/SortWorker.js';
import { Constants } from './Constants.js';

const THREE_CAMERA_FOV = 60;

export class Viewer {

    constructor(params = {}) {

        if (!params.cameraUp) params.cameraUp = [0, 1, 0];
        if (!params.initialCameraPosition) params.initialCameraPosition = [0, 10, 15];
        if (!params.initialCameraLookAt) params.initialCameraLookAt = [0, 0, 0];
        if (params.selfDrivenMode === undefined) params.selfDrivenMode = true;
        if (params.useBuiltInControls === undefined) params.useBuiltInControls = true;
        params.splatAlphaRemovalThreshold = params.splatAlphaRemovalThreshold || 0;

        this.rootElement = params.rootElement;
        this.usingExternalCamera = params.camera ? true : false;
        this.usingExternalRenderer = params.renderer ? true : false;

        this.cameraUp = new THREE.Vector3().fromArray(params.cameraUp);
        this.initialCameraPosition = new THREE.Vector3().fromArray(params.initialCameraPosition);
        this.initialCameraLookAt = new THREE.Vector3().fromArray(params.initialCameraLookAt);

        this.scene = params.scene;
        this.renderer = params.renderer;
        this.camera = params.camera;
        this.useBuiltInControls = params.useBuiltInControls;
        this.controls = null;
        this.selfDrivenMode = params.selfDrivenMode;
        this.splatAlphaRemovalThreshold = params.splatAlphaRemovalThreshold;
        this.selfDrivenUpdateFunc = this.selfDrivenUpdate.bind(this);
        this.showMeshCursor = params.showMeshCursor || true;

        this.sceneHelper = null;

        this.sortWorker = null;
        this.vertexRenderCount = 0;
        this.vertexSortCount = 0;

        this.inIndexArray = null;

        this.splatBuffer = null;
        this.splatMesh = null;

        this.splatTree = null;
        this.splatTreeNodeMap = {};

        this.sortRunning = false;
        this.selfDrivenModeRunning = false;
        this.splatRenderingInitialized = false;

        this.raycaster = new Raycaster();

        this.mousePosition = new THREE.Vector2();
        window.addEventListener('mousemove', this.onMouseMove.bind(this));
    }

    onMouseMove(mouse) {
        this.mousePosition.set(mouse.offsetX, mouse.offsetY);
    }

    getRenderDimensions(outDimensions) {
        if (this.rootElement) {
            outDimensions.x = this.rootElement.offsetWidth;
            outDimensions.y = this.rootElement.offsetHeight;
        } else {
            this.renderer.getSize(outDimensions);
        }
    }

    init() {

        if (!this.rootElement && !this.usingExternalRenderer) {
            this.rootElement = document.createElement('div');
            this.rootElement.style.width = '100%';
            this.rootElement.style.height = '100%';
            document.body.appendChild(this.rootElement);
        }

        const renderDimensions = new THREE.Vector2();
        this.getRenderDimensions(renderDimensions);

        if (!this.usingExternalCamera) {
            this.camera = new THREE.PerspectiveCamera(THREE_CAMERA_FOV, renderDimensions.x / renderDimensions.y, 0.1, 500);
            this.camera.position.copy(this.initialCameraPosition);
            this.camera.lookAt(this.initialCameraLookAt);
            this.camera.up.copy(this.cameraUp).normalize();
        }

        this.scene = this.scene || new THREE.Scene();
        this.sceneHelper = new SceneHelper(this.scene);

        if (!this.usingExternalRenderer) {
            this.renderer = new THREE.WebGLRenderer({
                antialias: false,
                precision: 'highp'
            });
            this.renderer.setSize(renderDimensions.x, renderDimensions.y);
        }
        this.setupRenderTargetCopyObjects();

        if (this.useBuiltInControls) {
            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.rotateSpeed = 0.5;
            this.controls.maxPolarAngle = (0.9 * Math.PI) / 2;
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.15;
            this.controls.target.copy(this.initialCameraLookAt);
        }

        if (!this.usingExternalRenderer) {
            const resizeObserver = new ResizeObserver(() => {
                this.getRenderDimensions(renderDimensions);
                this.renderer.setSize(renderDimensions.x, renderDimensions.y);
            });
            resizeObserver.observe(this.rootElement);
            this.rootElement.appendChild(this.renderer.domElement);
        }

    }

    updateSplatRenderTargetForRenderDimensions(width, height) {
        this.splatRenderTarget = new THREE.WebGLRenderTarget(width, height, {
            format: THREE.RGBAFormat,
            stencilBuffer: false,
            depthBuffer: true,

        });
        this.splatRenderTarget.depthTexture = new THREE.DepthTexture(width, height);
        this.splatRenderTarget.depthTexture.format = THREE.DepthFormat;
        this.splatRenderTarget.depthTexture.type = THREE.UnsignedIntType;
    }

    setupRenderTargetCopyObjects() {
        const uniforms = {
            'sourceColorTexture': {
                'type': 't',
                'value': null
            },
            'sourceDepthTexture': {
                'type': 't',
                'value': null
            },
        };
        this.renderTargetCopyMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4( position.xy, 0.0, 1.0 );    
                }
            `,
            fragmentShader: `
                #include <common>
                #include <packing>
                varying vec2 vUv;
                uniform sampler2D sourceColorTexture;
                uniform sampler2D sourceDepthTexture;
                void main() {
                    vec4 color = texture2D(sourceColorTexture, vUv);
                    float fragDepth = texture2D(sourceDepthTexture, vUv).x;
                    gl_FragDepth = fragDepth;
                    gl_FragColor = color;
              }
            `,
            uniforms: uniforms,
            depthWrite: false,
            depthTest: false,
            transparent: true,
            blending: THREE.NormalBlending
        });
        this.renderTargetCopyMaterial.extensions.fragDepth = true;
        this.renderTargetCopyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.renderTargetCopyMaterial);
        this.renderTargetCopyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }

    updateSplatMeshUniforms = function() {

        const renderDimensions = new THREE.Vector2();

        return function() {
            const vertexCount = this.splatBuffer.getVertexCount();
            if (vertexCount > 0) {
                this.getRenderDimensions(renderDimensions);
                this.cameraFocalLength = (renderDimensions.y / 2.0) / Math.tan(this.camera.fov / 2.0 * THREE.MathUtils.DEG2RAD);
                this.splatMesh.updateUniforms(renderDimensions, this.cameraFocalLength);
            }
        };

    }();

    loadFile(fileName) {
        const loadingSpinner = new LoadingSpinner();
        loadingSpinner.show();
        return new Promise((resolve, reject) => {
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

                this.splatBuffer = splatBuffer;

                this.splatBuffer.optimize(this.splatAlphaRemovalThreshold);
                const vertexCount = this.splatBuffer.getVertexCount();
                console.log(`Splat count: ${vertexCount}`);

                this.splatBuffer.buildPreComputedBuffers();
                this.splatMesh = SplatMesh.buildMesh(this.splatBuffer);
                this.splatMesh.frustumCulled = false;
                this.splatMesh.renderOrder = 10;
                this.updateSplatMeshUniforms();

                this.splatTree = new SplatTree(8, 5000);
                console.time('SplatTree build');
                this.splatTree.processSplatBuffer(splatBuffer);
                console.timeEnd('SplatTree build');

                let leavesWithVertices = 0;
                let avgVertexCount = 0;
                let maxVertexCount = 0;
                let nodeCount = 0;

                this.splatTree.visitLeaves((node) => {
                    const vertexCount = node.data.indexes.length;
                    if (vertexCount > 0) {
                        this.splatTreeNodeMap[node.id] = node;
                        avgVertexCount += vertexCount;
                        maxVertexCount = Math.max(maxVertexCount, vertexCount);
                        nodeCount++;
                        leavesWithVertices++;
                    }
                });
                console.log(`SplatTree leaves: ${this.splatTree.countLeaves()}`);
                console.log(`SplatTree leaves with vertices:${leavesWithVertices}`);
                avgVertexCount /= nodeCount;
                console.log(`Avg vertex count per node: ${avgVertexCount}`);

                this.vertexRenderCount = vertexCount;
                loadingSpinner.hide();

                this.sortWorker = createSortWorker(vertexCount, SplatBuffer.RowSizeBytes);
                this.sortWorker.onmessage = (e) => {
                    if (e.data.sortDone) {
                        this.sortRunning = false;
                        this.splatMesh.updateIndexes(this.outIndexArray, e.data.vertexRenderCount);
                    } else if (e.data.sortCanceled) {
                        this.sortRunning = false;
                    } else if (e.data.sortSetupPhase1Complete) {
                        console.log('Sorting web worker WASM setup complete.');
                        const workerTransferPositionArray = new Float32Array(vertexCount * SplatBuffer.PositionComponentCount);
                        this.splatBuffer.fillPositionArray(workerTransferPositionArray);
                        this.sortWorker.postMessage({
                            'positions': workerTransferPositionArray.buffer
                        });
                        this.outIndexArray = new Uint32Array(e.data.outIndexBuffer,
                                                             e.data.outIndexOffset, this.splatBuffer.getVertexCount());
                        this.inIndexArray = new Uint32Array(e.data.inIndexBuffer,
                                                            e.data.inIndexOffset, this.splatBuffer.getVertexCount());
                        for (let i = 0; i < vertexCount; i++) this.inIndexArray[i] = i;
                    } else if (e.data.sortSetupComplete) {
                        console.log('Sorting web worker ready.');
                        const attributeData = this.getAttributeDataFromSplatBuffer(this.splatBuffer);
                        this.splatMesh.updateIndexes(this.outIndexArray, this.splatBuffer.getVertexCount());
                        const {covariancesTextureSize, centersColorsTextureSize} =
                            this.splatMesh.setAttributes(attributeData.colors, attributeData.centers,
                                                         attributeData.covariances, this.splatBuffer.getVertexCount());
                        console.log('Covariances texture size: ' + covariancesTextureSize.x + ' x ' + covariancesTextureSize.y);
                        console.log('Centers/colors texture size: ' + centersColorsTextureSize.x + ' x ' + centersColorsTextureSize.y);
                        this.updateView(true, true);
                        this.splatRenderingInitialized = true;
                        resolve();
                    }
                };

            })
            .catch((e) => {
                reject(new Error(`Viewer::loadFile -> Could not load file ${fileName}`));
            });
        });
    }

    gatherSceneNodes = function() {

        const nodeRenderList = [];
        const tempVectorYZ = new THREE.Vector3();
        const tempVectorXZ = new THREE.Vector3();
        const tempVector = new THREE.Vector3();
        const tempMatrix4 = new THREE.Matrix4();
        const renderDimensions = new THREE.Vector3();
        const forward = new THREE.Vector3(0, 0, -1);

        const tempMax = new THREE.Vector3();
        const nodeSize = (node) => {
            return tempMax.copy(node.max).sub(node.min).length();
        };

        const MaximumDistanceToSort = 125;

        return function(gatherAllNodes) {

            this.getRenderDimensions(renderDimensions);
            const fovXOver2 = Math.atan(renderDimensions.x / 2.0 / this.cameraFocalLength);
            const fovYOver2 = Math.atan(renderDimensions.y / 2.0 / this.cameraFocalLength);
            const cosFovXOver2 = Math.cos(fovXOver2);
            const cosFovYOver2 = Math.cos(fovYOver2);
            tempMatrix4.copy(this.camera.matrixWorld).invert();

            let nodeRenderCount = 0;
            let verticesToCopy = 0;
            const nodeCount = this.splatTree.nodesWithIndexes.length;
            for (let i = 0; i < nodeCount; i++) {
                const node = this.splatTree.nodesWithIndexes[i];
                tempVector.copy(node.center).sub(this.camera.position);
                const distanceToNode = tempVector.length();
                tempVector.normalize();
                tempVector.transformDirection(tempMatrix4);

                tempVectorYZ.copy(tempVector).setX(0).normalize();
                tempVectorXZ.copy(tempVector).setY(0).normalize();

                const cameraAngleXZDot = forward.dot(tempVectorXZ);
                const cameraAngleYZDot = forward.dot(tempVectorYZ);

                const ns = nodeSize(node);
                const outOfFovY = cameraAngleYZDot < (cosFovYOver2 - .4);
                const outOfFovX = cameraAngleXZDot < (cosFovXOver2 - .4);
                if (!gatherAllNodes && ((outOfFovX || outOfFovY) && distanceToNode > ns)) {
                    continue;
                }
                verticesToCopy += node.data.indexes.length;
                nodeRenderList[nodeRenderCount] = node;
                node.data.distanceToNode = distanceToNode;
                nodeRenderCount++;
            }

            nodeRenderList.length = nodeRenderCount;
            nodeRenderList.sort((a, b) => {
                if (a.data.distanceToNode > b.data.distanceToNode) return 1;
                else return -1;
            });

            this.vertexRenderCount = verticesToCopy;
            this.vertexSortCount = 0;
            let currentByteOffset = 0;
            for (let i = 0; i < nodeRenderCount; i++) {
                const node = nodeRenderList[i];
                const shouldSort = node.data.distanceToNode <= MaximumDistanceToSort;
                if (shouldSort) {
                    this.vertexSortCount += node.data.indexes.length;
                }
                const windowSizeInts = node.data.indexes.length;
                let destView = new Uint32Array(this.inIndexArray.buffer, currentByteOffset, windowSizeInts);
                destView.set(node.data.indexes);
                currentByteOffset += windowSizeInts * Constants.BytesPerInt;
            }

        };

    }();

    start() {
        if (this.selfDrivenMode) {
            requestAnimationFrame(this.selfDrivenUpdateFunc);
            this.selfDrivenModeRunning = true;
        } else {
            throw new Error('Cannot start viewer unless it is in self driven mode.');
        }
    }

    fps = function() {

        let lastCalcTime = performance.now() / 1000;
        let frameCount = 0;

        return function() {
            const currentTime = performance.now() / 1000;
            const calcDelta = currentTime - lastCalcTime;
            if (calcDelta >= 1.0) {
                console.log('FPS: ' + frameCount);
                frameCount = 0;
                lastCalcTime = currentTime;
            } else {
                frameCount++;
            }
        };

    }();

    updateForRendererSizeChanges = function() {

        const lastRendererSize = new THREE.Vector2();
        const currentRendererSize = new THREE.Vector2();

        return function() {
            this.renderer.getSize(currentRendererSize);
            if (currentRendererSize.x !== lastRendererSize.x || currentRendererSize.y !== lastRendererSize.y) {
                if (!this.usingExternalCamera) {
                    this.camera.aspect = currentRendererSize.x / currentRendererSize.y;
                    this.camera.updateProjectionMatrix();
                }
                if (this.splatRenderingInitialized) {
                    this.updateSplatMeshUniforms();
                    this.updateSplatRenderTargetForRenderDimensions(currentRendererSize.x, currentRendererSize.y);
                }
                lastRendererSize.copy(currentRendererSize);
            }
        };

    }();

    selfDrivenUpdate() {
        if (this.selfDrivenMode) {
            requestAnimationFrame(this.selfDrivenUpdateFunc);
        }
        this.update();
        this.render();
    }

    update() {
        if (this.controls) {
            this.controls.update();
        }
        this.updateView();
        this.updateForRendererSizeChanges();

        this.rayCastScene();
        // this.fps();
    }

    rayCastScene = function() {

        const outHits = [];
        const renderDimensions = new THREE.Vector2();

        return function() {
            if (this.showMeshCursor) {
                this.getRenderDimensions(renderDimensions);
                outHits.length = 0;
                this.raycaster.setFromCameraAndScreenPosition(this.camera, this.mousePosition, renderDimensions);
                this.raycaster.intersectSplatTree(this.splatTree, outHits);
                if (outHits.length > 0) {
                    this.sceneHelper.setMeshCursorVisibility(true);
                    this.sceneHelper.setMeshCursorPosition(outHits[0].origin);
                } else {
                    this.sceneHelper.setMeshCursorVisibility(false);
                }
            }
        };

    }();

    render() {
        this.renderer.autoClear = false;
        this.renderer.setClearColor(0.0, 0.0, 0.0, 0.0);

        // A more complex rendering sequence is required if you want to render "normal" Three.js
        // objects along with the splats
        if (this.scene.children.length > 0) {
            this.renderer.setRenderTarget(this.splatRenderTarget);
            this.renderer.clear(true, true, true);
            this.renderer.getContext().colorMask(false, false, false, false);
            this.renderer.render(this.scene, this.camera);
            this.renderer.getContext().colorMask(true, true, true, true);
            this.renderer.render(this.splatMesh, this.camera);

            this.renderer.setRenderTarget(null);
            this.renderer.clear(true, true, true);

            this.renderer.render(this.scene, this.camera);
            this.renderTargetCopyMaterial.uniforms.sourceColorTexture.value = this.splatRenderTarget.texture;
            this.renderTargetCopyMaterial.uniforms.sourceDepthTexture.value = this.splatRenderTarget.depthTexture;
            this.renderer.render(this.renderTargetCopyQuad, this.renderTargetCopyCamera);
        } else {
            this.renderer.clear(true, true, true);
            this.renderer.render(this.splatMesh, this.camera);
        }
    }

    updateView = function() {

        const tempMatrix = new THREE.Matrix4();
        const cameraPositionArray = [];
        const lastSortViewDir = new THREE.Vector3(0, 0, -1);
        const sortViewDir = new THREE.Vector3(0, 0, -1);
        const lastSortViewPos = new THREE.Vector3();
        const sortViewOffset = new THREE.Vector3();

        return function(force = false, gatherAllNodes = false) {
            if (!force) {
                sortViewDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
                let needsRefreshForRotation = false;
                let needsRefreshForPosition = false;
                if (sortViewDir.dot(lastSortViewDir) <= 0.95) needsRefreshForRotation = true;
                if (sortViewOffset.copy(this.camera.position).sub(lastSortViewPos).length() >= 1.0) needsRefreshForPosition = true;
                if (!needsRefreshForRotation && !needsRefreshForPosition) return;
            }

            tempMatrix.copy(this.camera.matrixWorld).invert();
            tempMatrix.premultiply(this.camera.projectionMatrix);
            cameraPositionArray[0] = this.camera.position.x;
            cameraPositionArray[1] = this.camera.position.y;
            cameraPositionArray[2] = this.camera.position.z;

            if (!this.sortRunning) {
                this.gatherSceneNodes(gatherAllNodes);
                this.sortRunning = true;
                this.sortWorker.postMessage({
                    sort: {
                        'view': tempMatrix.elements,
                        'cameraPosition': cameraPositionArray,
                        'vertexRenderCount': this.vertexRenderCount,
                        'vertexSortCount': this.vertexSortCount,
                        'inIndexBuffer': this.inIndexArray.buffer
                    }
                });
                lastSortViewPos.copy(this.camera.position);
                lastSortViewDir.copy(sortViewDir);
            }
        };

    }();

    getAttributeDataFromSplatBuffer(splatBuffer) {

        const vertexCount = splatBuffer.getVertexCount();

        const splatArray = new Float32Array(splatBuffer.getBufferData());
        const pCovarianceArray = new Float32Array(splatBuffer.getPrecomputedCovarianceBufferData());
        const pColorArray = new Uint8Array(splatBuffer.getSeparatedColorBufferData());
        const colors = new Uint8Array(vertexCount * 4);
        const centers = new Float32Array(vertexCount * 3);
        const covariances = new Float32Array(vertexCount * 6);

        covariances.set(pCovarianceArray);
        colors.set(pColorArray);

        for (let i = 0; i < vertexCount; i++) {
            const centersBase = 3 * i;
            const splatArrayBase = SplatBuffer.RowSizeFloats * i;
            centers[centersBase] = splatArray[splatArrayBase];
            centers[centersBase + 1] = splatArray[splatArrayBase + 1];
            centers[centersBase + 2] = splatArray[splatArrayBase + 2];
        }

        return {
            'colors': colors,
            'centers': centers,
            'covariances': covariances
        };

    };
}
