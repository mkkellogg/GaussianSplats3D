import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';
import { PlyLoader } from './PlyLoader.js';
import { SplatLoader } from './SplatLoader.js';
import { LoadingSpinner } from './LoadingSpinner.js';
import { SceneHelper } from './SceneHelper.js';
import { Raycaster } from './raycaster/Raycaster.js';
import { SplatMesh } from './SplatMesh.js';
import { createSortWorker } from './worker/SortWorker.js';
import { Constants } from './Constants.js';
import { getCurrentTime } from './Util.js';

const THREE_CAMERA_FOV = 50;
const MINIMUM_DISTANCE_TO_NEW_FOCAL_POINT = .75;

export class Viewer {

    constructor(params = {}) {

        if (!params.cameraUp) params.cameraUp = [0, 1, 0];
        if (!params.initialCameraPosition) params.initialCameraPosition = [0, 10, 15];
        if (!params.initialCameraLookAt) params.initialCameraLookAt = [0, 0, 0];
        if (params.selfDrivenMode === undefined) params.selfDrivenMode = true;
        if (params.useBuiltInControls === undefined) params.useBuiltInControls = true;

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

        this.ignoreDevicePixelRatio = params.ignoreDevicePixelRatio || false;
        this.devicePixelRatio = this.ignoreDevicePixelRatio ? 1 : window.devicePixelRatio;

        this.selfDrivenMode = params.selfDrivenMode;
        this.selfDrivenUpdateFunc = this.selfDrivenUpdate.bind(this);

        this.gpuAcceleratedSort = params.gpuAcceleratedSort;
        if (this.gpuAcceleratedSort !== true && this.gpuAcceleratedSort !== false) {
            this.gpuAcceleratedSort = true;
        }

        this.showMeshCursor = false;
        this.showControlPlane = false;
        this.showInfo = false;

        this.sceneHelper = null;

        this.sortWorker = null;
        this.sortRunning = false;
        this.splatRenderCount = 0;
        this.sortWorkerIndexesToSort = null;
        this.sortWorkerSortedIndexes = null;
        this.sortWorkerPrecomputedDistances = null;

        this.splatMesh = null;

        this.selfDrivenModeRunning = false;
        this.splatRenderingInitialized = false;

        this.raycaster = new Raycaster();

        this.infoPanel = null;
        this.infoPanelCells = {};

        this.currentFPS = 0;
        this.lastSortTime = 0;

        this.previousCameraTarget = new THREE.Vector3();
        this.nextCameraTarget = new THREE.Vector3();

        this.mousePosition = new THREE.Vector2();
        this.mouseDownPosition = new THREE.Vector2();
        this.mouseDownTime = null;

        this.initialized = false;
        this.init();
    }

    init() {

        if (this.initialized) return;

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

        if (!this.usingExternalRenderer) {
            this.renderer = new THREE.WebGLRenderer({
                antialias: false,
                precision: 'highp'
            });
            this.renderer.setPixelRatio(this.devicePixelRatio);
            this.renderer.autoClear = true;
            this.renderer.setClearColor(0.0, 0.0, 0.0, 0.0);
            this.renderer.setSize(renderDimensions.x, renderDimensions.y);
        }

        this.scene = this.scene || new THREE.Scene();
        this.sceneHelper = new SceneHelper(this.scene);
        this.sceneHelper.setupMeshCursor();
        this.sceneHelper.setupFocusMarker();
        this.sceneHelper.setupControlPlane();

        if (this.useBuiltInControls) {
            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.listenToKeyEvents(window);
            this.controls.rotateSpeed = 0.5;
            this.controls.maxPolarAngle = Math.PI * .75;
            this.controls.minPolarAngle = 0.1;
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.target.copy(this.initialCameraLookAt);
            this.rootElement.addEventListener('pointermove', this.onMouseMove.bind(this), false);
            this.rootElement.addEventListener('pointerdown', this.onMouseDown.bind(this), false);
            this.rootElement.addEventListener('pointerup', this.onMouseUp.bind(this), false);
            window.addEventListener('keydown', this.onKeyDown.bind(this), false);
        }

        if (!this.usingExternalRenderer) {
            const resizeObserver = new ResizeObserver(() => {
                this.getRenderDimensions(renderDimensions);
                this.renderer.setSize(renderDimensions.x, renderDimensions.y);
            });
            resizeObserver.observe(this.rootElement);
            this.rootElement.appendChild(this.renderer.domElement);
        }

        this.setupInfoPanel();

        this.loadingSpinner = new LoadingSpinner(null, this.rootElement);
        this.loadingSpinner.hide();

        this.initialized = true;
    }

    onKeyDown = function() {

        const forward = new THREE.Vector3();
        const tempMatrixLeft = new THREE.Matrix4();
        const tempMatrixRight = new THREE.Matrix4();

        return function(e) {
            forward.set(0, 0, -1);
            forward.transformDirection(this.camera.matrixWorld);
            tempMatrixLeft.makeRotationAxis(forward, Math.PI / 128);
            tempMatrixRight.makeRotationAxis(forward, -Math.PI / 128);
            switch (e.code) {
                case 'ArrowLeft':
                    this.camera.up.transformDirection(tempMatrixLeft);
                break;
                case 'ArrowRight':
                    this.camera.up.transformDirection(tempMatrixRight);
                break;
                case 'KeyC':
                    this.showMeshCursor = !this.showMeshCursor;
                break;
                case 'KeyP':
                    this.showControlPlane = !this.showControlPlane;
                break;
                case 'KeyI':
                    this.showInfo = !this.showInfo;
                    if (this.showInfo) {
                        this.infoPanel.style.display = 'block';
                    } else {
                        this.infoPanel.style.display = 'none';
                    }
                break;
            }
        };

    }();

    onMouseMove(mouse) {
        this.mousePosition.set(mouse.offsetX, mouse.offsetY);
    }

    onMouseDown() {
        this.mouseDownPosition.copy(this.mousePosition);
        this.mouseDownTime = getCurrentTime();
    }

    onMouseUp = function() {

        const renderDimensions = new THREE.Vector2();
        const clickOffset = new THREE.Vector2();
        const toNewFocalPoint = new THREE.Vector3();
        const outHits = [];

        return function(mouse) {
            clickOffset.copy(this.mousePosition).sub(this.mouseDownPosition);
            const mouseUpTime = getCurrentTime();
            const wasClick = mouseUpTime - this.mouseDownTime < 0.5 && clickOffset.length() < 2;
            if (!this.transitioningCameraTarget && wasClick) {
                this.getRenderDimensions(renderDimensions);
                outHits.length = 0;
                this.raycaster.setFromCameraAndScreenPosition(this.camera, this.mousePosition, renderDimensions);
                this.mousePosition.set(mouse.offsetX, mouse.offsetY);
                this.raycaster.intersectSplatMesh(this.splatMesh, outHits);
                if (outHits.length > 0) {
                    const intersectionPoint = outHits[0].origin;
                    toNewFocalPoint.copy(intersectionPoint).sub(this.camera.position);
                    if (toNewFocalPoint.length() > MINIMUM_DISTANCE_TO_NEW_FOCAL_POINT) {
                        this.previousCameraTarget.copy(this.controls.target);
                        this.nextCameraTarget.copy(intersectionPoint);
                        this.transitioningCameraTarget = true;
                        this.transitioningCameraTargetStartTime = getCurrentTime();
                    }
                }
            }
        };

    }();

    getRenderDimensions(outDimensions) {
        if (this.rootElement) {
            outDimensions.x = this.rootElement.offsetWidth;
            outDimensions.y = this.rootElement.offsetHeight;
        } else {
            this.renderer.getSize(outDimensions);
        }
    }

    setupInfoPanel() {
        this.infoPanel = document.createElement('div');
        this.infoPanel.style.position = 'absolute';
        this.infoPanel.style.padding = '10px';
        this.infoPanel.style.backgroundColor = '#cccccc';
        this.infoPanel.style.border = '#aaaaaa 1px solid';
        this.infoPanel.style.zIndex = 100;
        this.infoPanel.style.width = '375px';
        this.infoPanel.style.fontFamily = 'arial';
        this.infoPanel.style.fontSize = '10pt';
        this.infoPanel.style.textAlign = 'left';

        const layout = [
            ['Camera position', 'cameraPosition'],
            ['Camera look-at', 'cameraLookAt'],
            ['Camera up', 'cameraUp'],
            ['Cursor position', 'cursorPosition'],
            ['FPS', 'fps'],
            ['Render window', 'renderWindow'],
            ['Rendering:', 'renderSplatCount'],
            ['Sort time', 'sortTime']
        ];

        const infoTable = document.createElement('div');
        infoTable.style.display = 'table';

        for (let layoutEntry of layout) {
            const row = document.createElement('div');
            row.style.display = 'table-row';

            const labelCell = document.createElement('div');
            labelCell.style.display = 'table-cell';
            labelCell.style.width = '110px';
            labelCell.innerHTML = `${layoutEntry[0]}: `;

            const spacerCell = document.createElement('div');
            spacerCell.style.display = 'table-cell';
            spacerCell.style.width = '10px';
            spacerCell.innerHTML = ' ';

            const infoCell = document.createElement('div');
            infoCell.style.display = 'table-cell';
            infoCell.innerHTML = '';

            this.infoPanelCells[layoutEntry[1]] = infoCell;

            row.appendChild(labelCell);
            row.appendChild(spacerCell);
            row.appendChild(infoCell);

            infoTable.appendChild(row);
        }

        this.infoPanel.appendChild(infoTable);
        this.infoPanel.style.display = 'none';
        this.renderer.domElement.parentElement.prepend(this.infoPanel);
    }

    updateSplatMeshUniforms = function() {

        const renderDimensions = new THREE.Vector2();

        return function() {
            const splatCount = this.splatMesh.getSplatCount();
            if (splatCount > 0) {
                this.getRenderDimensions(renderDimensions);
                this.cameraFocalLengthX = this.camera.projectionMatrix.elements[0] *
                                          this.devicePixelRatio * renderDimensions.x * 0.45;
                                          this.cameraFocalLengthY = this.camera.projectionMatrix.elements[5] *
                                          this.devicePixelRatio * renderDimensions.y * 0.45;
                this.splatMesh.updateUniforms(renderDimensions, this.cameraFocalLengthX, this.cameraFocalLengthY);
            }
        };

    }();

    loadFile(fileURL, options = {}) {
        if (options.position) options.position = new THREE.Vector3().fromArray(options.position);
        if (options.orientation) options.orientation = new THREE.Quaternion().fromArray(options.orientation);
        options.splatAlphaRemovalThreshold = options.splatAlphaRemovalThreshold || 1;
        options.halfPrecisionCovariancesOnGPU = !!options.halfPrecisionCovariancesOnGPU;
        if (options.showLoadingSpinner !== false) options.showLoadingSpinner = true;

        if (options.showLoadingSpinner) this.loadingSpinner.show();
        const downloadProgress = (percent, percentLabel) => {
            if (options.showLoadingSpinner) {
                if (percent == 100) {
                    this.loadingSpinner.setMessage(`Download complete!`);
                } else {
                    const suffix = percentLabel ? `: ${percentLabel}` : `...`;
                    this.loadingSpinner.setMessage(`Downloading${suffix}`);
                }
            }
            if (options.onProgress) options.onProgress(percent, percentLabel, 'downloading');
        };

        return new Promise((resolve, reject) => {
            let fileLoadPromise;
            if (fileURL.endsWith('.splat')) {
                fileLoadPromise = new SplatLoader().loadFromURL(fileURL, downloadProgress, options.signal);
            } else if (fileURL.endsWith('.ply')) {
                fileLoadPromise = new PlyLoader().loadFromURL(
                    fileURL, downloadProgress, 0, options.splatAlphaRemovalThreshold, options.signal
                );
            } else {
                reject(new Error(`Viewer::loadFile -> File format not supported: ${fileURL}`));
            }
            fileLoadPromise
            .then((splatBuffer) => {
                if (options.showLoadingSpinner) this.loadingSpinner.hide();
                if (options.onProgress) options.onProgress(0, '0%', 'processing');
                this.loadSplatBuffer(splatBuffer, options).then(() => {
                    if (options.onProgress) options.onProgress(100, '100%', 'processing');
                    resolve();
                });
            })
            .catch((e) => {
                reject(new Error(`Viewer::loadFile -> Could not load file ${fileURL}`));
            });
        });
    }

    loadSplatBuffer(splatBuffer, options) {
        if (options.showLoadingSpinner !== false) options.showLoadingSpinner = true;
        return new Promise((resolve) => {
            if (options.showLoadingSpinner) {
                this.loadingSpinner.show();
                this.loadingSpinner.setMessage(`Processing splats...`);
            }
            window.setTimeout(() => {
                this.setupSplatMesh(splatBuffer, options.splatAlphaRemovalThreshold, options.position,
                                    options.orientation, options.halfPrecisionCovariancesOnGPU,
                                    this.devicePixelRatio, this.gpuAcceleratedSort);
                this.setupSortWorker(splatBuffer).then(() => {
                    if (options.showLoadingSpinner) this.loadingSpinner.hide();
                    resolve();
                });
            }, 1);
        });
    }

    setupSplatMesh(splatBuffer, splatAlphaRemovalThreshold = 1, position = new THREE.Vector3(), quaternion = new THREE.Quaternion(),
                   halfPrecisionCovariancesOnGPU = false, devicePixelRatio = 1, gpuAcceleratedSort = true) {
        const splatCount = splatBuffer.getSplatCount();
        console.log(`Splat count: ${splatCount}`);

        this.splatMesh = SplatMesh.buildMesh(splatBuffer, this.renderer, splatAlphaRemovalThreshold,
                                             halfPrecisionCovariancesOnGPU, devicePixelRatio, gpuAcceleratedSort);
        this.splatMesh.position.copy(position);
        this.splatMesh.quaternion.copy(quaternion);
        this.splatMesh.frustumCulled = false;
        this.updateSplatMeshUniforms();

        this.splatRenderCount = splatCount;
    }

    setupSortWorker(splatBuffer) {
        return new Promise((resolve) => {
            const splatCount = splatBuffer.getSplatCount();
            this.sortWorker = createSortWorker(splatCount);
            this.sortWorker.onmessage = (e) => {
                if (e.data.sortDone) {
                    this.sortRunning = false;
                    this.splatMesh.updateIndexes(this.sortWorkerSortedIndexes, e.data.splatRenderCount);
                    this.lastSortTime = e.data.sortTime;
                } else if (e.data.sortCanceled) {
                    this.sortRunning = false;
                } else if (e.data.sortSetupPhase1Complete) {
                    console.log('Sorting web worker WASM setup complete.');
                    this.sortWorker.postMessage({
                        'centers': this.splatMesh.getIntegerCenters(true).buffer
                    });
                    this.sortWorkerSortedIndexes = new Uint32Array(e.data.sortedIndexesBuffer,
                                                                   e.data.sortedIndexesOffset, splatBuffer.getSplatCount());
                    this.sortWorkerIndexesToSort = new Uint32Array(e.data.indexesToSortBuffer,
                                                                   e.data.indexesToSortOffset, splatBuffer.getSplatCount());
                    this.sortWorkerPrecomputedDistances = new Int32Array(e.data.precomputedDistancesBuffer,
                                                                         e.data.precomputedDistancesOffset, splatBuffer.getSplatCount());
                    for (let i = 0; i < splatCount; i++) this.sortWorkerIndexesToSort[i] = i;
                } else if (e.data.sortSetupComplete) {
                    console.log('Sorting web worker ready.');
                    this.splatMesh.updateIndexes(this.sortWorkerSortedIndexes, splatBuffer.getSplatCount());
                    const splatDataTextures = this.splatMesh.getSplatDataTextures();
                    const covariancesTextureSize = splatDataTextures.covariances.size;
                    const centersColorsTextureSize = splatDataTextures.centerColors.size;
                    console.log('Covariances texture size: ' + covariancesTextureSize.x + ' x ' + covariancesTextureSize.y);
                    console.log('Centers/colors texture size: ' + centersColorsTextureSize.x + ' x ' + centersColorsTextureSize.y);
                    this.updateView(true, true);
                    this.splatRenderingInitialized = true;
                    resolve();
                }
            };
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

        const MaximumDistanceToRender = 125;

        return function(gatherAllNodes) {

            this.getRenderDimensions(renderDimensions);
            const cameraFocalLength = (renderDimensions.y / 2.0) / Math.tan(this.camera.fov / 2.0 * THREE.MathUtils.DEG2RAD);
            const fovXOver2 = Math.atan(renderDimensions.x / 2.0 / cameraFocalLength);
            const fovYOver2 = Math.atan(renderDimensions.y / 2.0 / cameraFocalLength);
            const cosFovXOver2 = Math.cos(fovXOver2);
            const cosFovYOver2 = Math.cos(fovYOver2);
            tempMatrix4.copy(this.camera.matrixWorld).invert();
            tempMatrix4.multiply(this.splatMesh.matrixWorld);

            const splatTree = this.splatMesh.getSplatTree();
            let nodeRenderCount = 0;
            let splatRenderCount = 0;
            const nodeCount = splatTree.nodesWithIndexes.length;
            for (let i = 0; i < nodeCount; i++) {
                const node = splatTree.nodesWithIndexes[i];
                tempVector.copy(node.center).applyMatrix4(tempMatrix4);
                const distanceToNode = tempVector.length();
                tempVector.normalize();

                tempVectorYZ.copy(tempVector).setX(0).normalize();
                tempVectorXZ.copy(tempVector).setY(0).normalize();

                const cameraAngleXZDot = forward.dot(tempVectorXZ);
                const cameraAngleYZDot = forward.dot(tempVectorYZ);

                const ns = nodeSize(node);
                const outOfFovY = cameraAngleYZDot < (cosFovYOver2 - .6);
                const outOfFovX = cameraAngleXZDot < (cosFovXOver2 - .6);
                if (!gatherAllNodes && ((outOfFovX || outOfFovY || distanceToNode > MaximumDistanceToRender) && distanceToNode > ns)) {
                    continue;
                }
                splatRenderCount += node.data.indexes.length;
                nodeRenderList[nodeRenderCount] = node;
                node.data.distanceToNode = distanceToNode;
                nodeRenderCount++;
            }

            nodeRenderList.length = nodeRenderCount;
            nodeRenderList.sort((a, b) => {
                if (a.data.distanceToNode < b.data.distanceToNode) return -1;
                else return 1;
            });

            this.splatRenderCount = splatRenderCount;
            let currentByteOffset = splatRenderCount * Constants.BytesPerInt;
            for (let i = 0; i < nodeRenderCount; i++) {
                const node = nodeRenderList[i];
                const windowSizeInts = node.data.indexes.length;
                const windowSizeBytes = windowSizeInts * Constants.BytesPerInt;
                let destView = new Uint32Array(this.sortWorkerIndexesToSort.buffer, currentByteOffset - windowSizeBytes, windowSizeInts);
                destView.set(node.data.indexes);
                currentByteOffset -= windowSizeBytes;
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

    stop() {
        if (this.selfDrivenMode && this.selfDrivenModeRunning) {
            cancelAnimationFrame();
            this.selfDrivenModeRunning = false;
        }
    }

    updateFPS = function() {

        let lastCalcTime = getCurrentTime();
        let frameCount = 0;

        return function() {
            const currentTime = getCurrentTime();
            const calcDelta = currentTime - lastCalcTime;
            if (calcDelta >= 1.0) {
                this.currentFPS = frameCount;
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
        this.updateMeshCursor();
        this.updateFPS();
        this.timingSensitiveUpdates();
        this.updateInfo();
        this.updateControlPlane();
    }

    timingSensitiveUpdates = function() {

        let lastUpdateTime;

        return function() {
            const currentTime = getCurrentTime();
            if (!lastUpdateTime) lastUpdateTime = currentTime;
            const timeDelta = currentTime - lastUpdateTime;

            this.updateCameraTransition(currentTime);
            this.updateFocusMarker(timeDelta);

            lastUpdateTime = currentTime;
        };

    }();

    updateCameraTransition = function() {

        let tempCameraTarget = new THREE.Vector3();
        let toPreviousTarget = new THREE.Vector3();
        let toNextTarget = new THREE.Vector3();

        return function(currentTime) {
            if (this.transitioningCameraTarget) {
                toPreviousTarget.copy(this.previousCameraTarget).sub(this.camera.position).normalize();
                toNextTarget.copy(this.nextCameraTarget).sub(this.camera.position).normalize();
                const rotationAngle = Math.acos(toPreviousTarget.dot(toNextTarget));
                const rotationSpeed = rotationAngle / (Math.PI / 3) * .65 + .3;
                const t = (rotationSpeed / rotationAngle * (currentTime - this.transitioningCameraTargetStartTime));
                tempCameraTarget.copy(this.previousCameraTarget).lerp(this.nextCameraTarget, t);
                this.camera.lookAt(tempCameraTarget);
                this.controls.target.copy(tempCameraTarget);
                if (t >= 1.0) {
                    this.transitioningCameraTarget = false;
                }
            }
        };

    }();

    updateFocusMarker = function() {

        const renderDimensions = new THREE.Vector2();
        let wasTransitioning = false;

        return function(timeDelta) {
            this.getRenderDimensions(renderDimensions);
            const fadeInSpeed = 10.0;
            const fadeOutSpeed = 2.5;
            if (this.transitioningCameraTarget) {
                this.sceneHelper.setFocusMarkerVisibility(true);
                const currentFocusMarkerOpacity = Math.max(this.sceneHelper.getFocusMarkerOpacity(), 0.0);
                let newFocusMarkerOpacity = Math.min(currentFocusMarkerOpacity + fadeInSpeed * timeDelta, 1.0);
                this.sceneHelper.setFocusMarkerOpacity(newFocusMarkerOpacity);
                this.sceneHelper.updateFocusMarker(this.nextCameraTarget, this.camera, renderDimensions);
                wasTransitioning = true;
            } else {
                let currentFocusMarkerOpacity;
                if (wasTransitioning) currentFocusMarkerOpacity = 1.0;
                else currentFocusMarkerOpacity = Math.min(this.sceneHelper.getFocusMarkerOpacity(), 1.0);
                if (currentFocusMarkerOpacity > 0) {
                    this.sceneHelper.updateFocusMarker(this.nextCameraTarget, this.camera, renderDimensions);
                    let newFocusMarkerOpacity = Math.max(currentFocusMarkerOpacity - fadeOutSpeed * timeDelta, 0.0);
                    this.sceneHelper.setFocusMarkerOpacity(newFocusMarkerOpacity);
                    if (newFocusMarkerOpacity === 0.0) this.sceneHelper.setFocusMarkerVisibility(false);
                }
                wasTransitioning = false;
            }
        };

    }();

    updateMeshCursor = function() {

        const outHits = [];
        const renderDimensions = new THREE.Vector2();

        return function() {
            if (this.showMeshCursor) {
                this.getRenderDimensions(renderDimensions);
                outHits.length = 0;
                this.raycaster.setFromCameraAndScreenPosition(this.camera, this.mousePosition, renderDimensions);
                this.raycaster.intersectSplatMesh(this.splatMesh, outHits);
                if (outHits.length > 0) {
                    this.sceneHelper.setMeshCursorVisibility(true);
                    this.sceneHelper.positionAndOrientMeshCursor(outHits[0].origin, this.camera);
                } else {
                    this.sceneHelper.setMeshCursorVisibility(false);
                }
            } else {
                this.sceneHelper.setMeshCursorVisibility(false);
            }
        };

    }();

    updateInfo = function() {

        const renderDimensions = new THREE.Vector2();

        return function() {
            if (this.showInfo) {
                const splatCount = this.splatMesh.getSplatCount();
                this.getRenderDimensions(renderDimensions);

                const cameraPos = this.camera.position;
                const cameraPosString = `[${cameraPos.x.toFixed(5)}, ${cameraPos.y.toFixed(5)}, ${cameraPos.z.toFixed(5)}]`;
                this.infoPanelCells.cameraPosition.innerHTML = cameraPosString;

                const cameraLookAt = this.controls.target;
                const cameraLookAtString = `[${cameraLookAt.x.toFixed(5)}, ${cameraLookAt.y.toFixed(5)}, ${cameraLookAt.z.toFixed(5)}]`;
                this.infoPanelCells.cameraLookAt.innerHTML = cameraLookAtString;

                const cameraUp = this.camera.up;
                const cameraUpString = `[${cameraUp.x.toFixed(5)}, ${cameraUp.y.toFixed(5)}, ${cameraUp.z.toFixed(5)}]`;
                this.infoPanelCells.cameraUp.innerHTML = cameraUpString;

                if (this.showMeshCursor) {
                    const cursorPos = this.sceneHelper.meshCursor.position;
                    const cursorPosString = `[${cursorPos.x.toFixed(5)}, ${cursorPos.y.toFixed(5)}, ${cursorPos.z.toFixed(5)}]`;
                    this.infoPanelCells.cursorPosition.innerHTML = cursorPosString;
                } else {
                    this.infoPanelCells.cursorPosition.innerHTML = 'N/A';
                }

                this.infoPanelCells.fps.innerHTML = this.currentFPS;
                this.infoPanelCells.renderWindow.innerHTML = `${renderDimensions.x} x ${renderDimensions.y}`;

                const renderPct = this.splatRenderCount / splatCount * 100;
                this.infoPanelCells.renderSplatCount.innerHTML =
                    `${this.splatRenderCount} splats out of ${splatCount} (${renderPct.toFixed(2)}%)`;

                this.infoPanelCells.sortTime.innerHTML = `${this.lastSortTime.toFixed(3)} ms`;
            }
        };

    }();

    updateControlPlane() {
        if (this.showControlPlane) {
            this.sceneHelper.setControlPlaneVisibility(true);
            this.sceneHelper.positionAndOrientControlPlane(this.controls.target, this.camera.up);
        } else {
            this.sceneHelper.setControlPlaneVisibility(false);
        }
    }

    render = function() {

        return function() {
            const hasRenderables = (scene) => {
                for (let child of scene.children) {
                    if (child.visible) {
                    return true;
                    }
                }
                return false;
            };

            const savedAuoClear = this.renderer.autoClear;
            this.renderer.autoClear = false;
            if (hasRenderables(this.scene)) this.renderer.render(this.scene, this.camera);
            this.renderer.render(this.splatMesh, this.camera);
            if (this.sceneHelper.getFocusMarkerOpacity() > 0.0) this.renderer.render(this.sceneHelper.focusMarker, this.camera);
            if (this.showControlPlane) this.renderer.render(this.sceneHelper.controlPlane, this.camera);
            this.renderer.autoClear = savedAuoClear;
        };

    }();

    updateView = function() {

        const tempMatrix = new THREE.Matrix4();
        const cameraPositionArray = [];
        const lastSortViewDir = new THREE.Vector3(0, 0, -1);
        const sortViewDir = new THREE.Vector3(0, 0, -1);
        const lastSortViewPos = new THREE.Vector3();
        const sortViewOffset = new THREE.Vector3();
        const queuedTiers = [];

        const partialSorts = [
            {
                'angleThreshold': 0.55,
                'sortFractions': [0.125, 0.33333, 0.75]
            },
            {
                'angleThreshold': 0.65,
                'sortFractions': [0.33333, 0.66667]
            },
            {
                'angleThreshold': 0.8,
                'sortFractions': [0.5]
            }
        ];

        return function(force = false, gatherAllNodes = false) {
            let angleDiff = 0;
            let positionDiff = 0;
            sortViewDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
            let needsRefreshForRotation = false;
            let needsRefreshForPosition = false;
            angleDiff = sortViewDir.dot(lastSortViewDir);
            positionDiff = sortViewOffset.copy(this.camera.position).sub(lastSortViewPos).length();

            if (!force && queuedTiers.length === 0) {
                if (angleDiff <= 0.95) needsRefreshForRotation = true;
                if (positionDiff >= 1.0) needsRefreshForPosition = true;
                if (!needsRefreshForRotation && !needsRefreshForPosition) return;
            }

            tempMatrix.copy(this.camera.matrixWorld).invert();
            tempMatrix.premultiply(this.camera.projectionMatrix);
            tempMatrix.multiply(this.splatMesh.matrixWorld);
            cameraPositionArray[0] = this.camera.position.x;
            cameraPositionArray[1] = this.camera.position.y;
            cameraPositionArray[2] = this.camera.position.z;

            if (!this.sortRunning) {
                let sortCount;
                this.sortRunning = true;
                this.gatherSceneNodes(gatherAllNodes);
                if (this.gpuAcceleratedSort && (queuedTiers.length <= 1 || queuedTiers.length % 2 === 0)) {
                    this.splatMesh.computeDistancesOnGPU(tempMatrix, this.sortWorkerPrecomputedDistances);
                }
                if (queuedTiers.length === 0) {
                    for (let partialSort of partialSorts) {
                        if (angleDiff < partialSort.angleThreshold) {
                            for (let sortFraction of partialSort.sortFractions) {
                                queuedTiers.push(Math.floor(this.splatRenderCount * sortFraction));
                            }
                            break;
                        }
                    }
                    queuedTiers.push(this.splatRenderCount);
                }
                sortCount = Math.min(queuedTiers.shift(), this.splatRenderCount);
                this.sortWorker.postMessage({
                    sort: {
                        'viewProj': this.splatMesh.getIntegerMatrixArray(tempMatrix),
                        'cameraPosition': cameraPositionArray,
                        'splatRenderCount': this.splatRenderCount,
                        'splatSortCount': sortCount,
                        'usePrecomputedDistances': this.gpuAcceleratedSort
                    }
                });
                if (queuedTiers.length === 0) {
                    lastSortViewPos.copy(this.camera.position);
                    lastSortViewDir.copy(sortViewDir);
                }
            }
        };

    }();

    getSplatMesh() {
        return this.splatMesh;
    }
}
