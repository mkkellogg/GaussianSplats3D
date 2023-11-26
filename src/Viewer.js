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

    constructor(options = {}) {

        if (!options.cameraUp) options.cameraUp = [0, 1, 0];
        if (!options.initialCameraPosition) options.initialCameraPosition = [0, 10, 15];
        if (!options.initialCameraLookAt) options.initialCameraLookAt = [0, 0, 0];

        if (options.selfDrivenMode === undefined) options.selfDrivenMode = true;
        if (options.useBuiltInControls === undefined) options.useBuiltInControls = true;
        this.rootElement = options.rootElement;

        this.ignoreDevicePixelRatio = options.ignoreDevicePixelRatio || false;
        this.devicePixelRatio = this.ignoreDevicePixelRatio ? 1 : window.devicePixelRatio;

        this.cameraUp = new THREE.Vector3().fromArray(options.cameraUp);
        this.initialCameraPosition = new THREE.Vector3().fromArray(options.initialCameraPosition);
        this.initialCameraLookAt = new THREE.Vector3().fromArray(options.initialCameraLookAt);

        this.scene = options.scene;
        this.renderer = options.renderer;
        this.camera = options.camera;
        this.useBuiltInControls = options.useBuiltInControls;
        this.controls = null;

        this.selfDrivenMode = options.selfDrivenMode;
        this.selfDrivenUpdateFunc = this.selfDrivenUpdate.bind(this);

        this.gpuAcceleratedSort = options.gpuAcceleratedSort;
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

        this.loadingSpinner = new LoadingSpinner(null, this.rootElement || document.body);
        this.loadingSpinner.hide();

        this.usingExternalCamera = undefined;
        this.usingExternalRenderer = undefined;
        this.initializeFromExternalUpdate = options.initializeFromExternalUpdate || false;
        this.initialized = false;
        if (!this.initializeFromExternalUpdate) this.init();
    }

    init() {

        if (this.initialized) return;

        if (!this.initializeFromExternalUpdate) {
            this.usingExternalCamera = this.camera ? true : false;
            this.usingExternalRenderer = this.renderer ? true : false;
        } else {
            this.usingExternalCamera = true;
            this.usingExternalRenderer = true;
        }

        if (!this.rootElement) {
            if (!this.usingExternalRenderer) {
                this.rootElement = document.createElement('div');
                this.rootElement.style.width = '100%';
                this.rootElement.style.height = '100%';
                this.rootElement.style.position = 'absolute';
                document.body.appendChild(this.rootElement);
            } else {
                this.rootElement = this.renderer.domElement.parentElement || document.body;
            }
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

        if (this.splatMesh) this.splatMesh.setRenderer(this.renderer);

        this.setupInfoPanel();
        this.loadingSpinner.setContainer(this.rootElement);

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
            if (!this.splatMesh) return;
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
        if (options.showLoadingSpinner !== false) options.showLoadingSpinner = true;
        return new Promise((resolve, reject) => {
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
            this.loadFileToSplatBuffer(fileURL, options.splatAlphaRemovalThreshold, downloadProgress)
            .then((splatBuffer) => {
                if (options.showLoadingSpinner) this.loadingSpinner.hide();
                if (options.onProgress) options.onProgress(0, '0%', 'processing');
                const splatBufferOptions = {
                    'orientation': options.orientation,
                    'position': options.position,
                    'scale': options.scale
                };
                const meshOptions = {
                    'splatAlphaRemovalThreshold': options.splatAlphaRemovalThreshold,
                    'halfPrecisionCovariancesOnGPU': options.halfPrecisionCovariancesOnGPU
                };
                this.loadSplatBuffers([splatBuffer], [splatBufferOptions], meshOptions, options.showLoadingSpinner).then(() => {
                    if (options.onProgress) options.onProgress(100, '100%', 'processing');
                    resolve();
                });
            })
            .catch(() => {
                reject(new Error(`Viewer::loadFile -> Could not load file ${fileURL}`));
            });
        });
    }

    loadFiles(fileURLs, splatBufferOptions = undefined, meshOptions = undefined, showLoadingSpinner = true, onProgress = undefined) {
        return new Promise((resolve, reject) => {
            const fileCount = fileURLs.length;
            const percentComplete = [];
            if (showLoadingSpinner) this.loadingSpinner.show();
            const downloadProgress = (fileIndex, percent, percentLabel) => {
                percentComplete[fileIndex] = percent;
                let totalPercent = 0;
                for (let i = 0; i < fileCount; i++) totalPercent += percentComplete[i];
                totalPercent = totalPercent / fileCount;
                percentLabel = `${totalPercent.toFixed(2)}%`;
                if (showLoadingSpinner) {
                    if (totalPercent == 100) {
                        this.loadingSpinner.setMessage(`Download complete!`);
                    } else {
                        this.loadingSpinner.setMessage(`Downloading: ${percentLabel}`);
                    }
                }
                if (onProgress) onProgress(totalPercent, percentLabel, 'downloading');
            };

            const downLoadPromises = [];
            for (let i = 0; i < fileURLs.length; i++) {
                const meshOptionsForFile = meshOptions[i] || {};
                const downloadPromise = this.loadFileToSplatBuffer(fileURLs[i], meshOptionsForFile.splatAlphaRemovalThreshold,
                                                                   downloadProgress.bind(this, i));
                downLoadPromises.push(downloadPromise);
            }

            Promise.all(downLoadPromises)
            .then((splatBuffers) => {
                if (showLoadingSpinner) this.loadingSpinner.hide();
                if (onProgress) options.onProgress(0, '0%', 'processing');
                this.loadSplatBuffers(splatBuffers, splatBufferOptions, meshOptions, showLoadingSpinner).then(() => {
                    if (onProgress) onProgress(100, '100%', 'processing');
                    resolve();
                });
            })
            .catch((e) => {
                reject(new Error(`Viewer::loadFiles -> Could not load one or more files.`));
            });
        });
    }

    loadFileToSplatBuffer(fileURL, plySplatAlphaRemovalThreshold = 1, onProgress = undefined) {
        const downloadProgress = (percent, percentLabel) => {
            if (onProgress) onProgress(percent, percentLabel, 'downloading');
        };
        return new Promise((resolve, reject) => {
            let fileLoadPromise;
            if (fileURL.endsWith('.splat')) {
                fileLoadPromise = new SplatLoader().loadFromURL(fileURL, downloadProgress);
            } else if (fileURL.endsWith('.ply')) {
                fileLoadPromise = new PlyLoader().loadFromURL(fileURL, downloadProgress, 0, plySplatAlphaRemovalThreshold);
            } else {
                reject(new Error(`Viewer::loadFileData -> File format not supported: ${fileURL}`));
            }
            fileLoadPromise
            .then((splatBuffer) => {
                resolve(splatBuffer);
            })
            .catch(() => {
                reject(new Error(`Viewer::loadFileData -> Could not load file ${fileURL}`));
            });
        });
    }

    loadSplatBuffers(splatBuffers, splatBufferOptions = [], meshOptions = {}, showLoadingSpinner = true) {
        return new Promise((resolve) => {
            if (showLoadingSpinner) {
                this.loadingSpinner.show();
                this.loadingSpinner.setMessage(`Processing splats...`);
            }
            window.setTimeout(() => {
                this.updateSplatMesh(splatBuffers, splatBufferOptions, meshOptions);
                this.setupSortWorker(this.splatMesh).then(() => {
                    if (showLoadingSpinner) this.loadingSpinner.hide();
                    resolve();
                });
            }, 1);
        });
    }

    updateSplatMesh(splatBuffers, splatBufferOptions, meshOptions) {
        if (!this.splatMesh) {
            this.splatMesh = new SplatMesh(meshOptions.splatAlphaRemovalThreshold,
                                           meshOptions.halfPrecisionCovariancesOnGPU, this.devicePixelRatio, this.gpuAcceleratedSort);
        }
        const allSplatBuffers = this.splatMesh.splatBuffers || [];
        const allSplatBufferOptions = this.splatMesh.splatBufferOptions || [];
        allSplatBuffers.push(...splatBuffers);
        allSplatBufferOptions.push(...splatBufferOptions);
        this.splatMesh.build(allSplatBuffers, allSplatBufferOptions);
        if (this.renderer) this.splatMesh.setRenderer(this.renderer);
        const splatCount = this.splatMesh.getSplatCount();
        console.log(`Splat count: ${splatCount}`);
        this.splatMesh.frustumCulled = false;
        this.splatRenderCount = splatCount;
    }

    setupSortWorker(splatMesh) {
        return new Promise((resolve) => {
            const splatCount = splatMesh.getSplatCount();
            if (this.sortWorker) this.sortWorker.terminate();
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
                                                                   e.data.sortedIndexesOffset, splatCount);
                    this.sortWorkerIndexesToSort = new Uint32Array(e.data.indexesToSortBuffer,
                                                                   e.data.indexesToSortOffset, splatCount);
                    this.sortWorkerPrecomputedDistances = new Int32Array(e.data.precomputedDistancesBuffer,
                                                                         e.data.precomputedDistancesOffset, splatCount);
                    for (let i = 0; i < splatCount; i++) this.sortWorkerIndexesToSort[i] = i;
                } else if (e.data.sortSetupComplete) {
                    console.log('Sorting web worker ready.');
                    this.splatMesh.updateIndexes(this.sortWorkerSortedIndexes, splatCount);
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

    selfDrivenUpdate() {
        if (this.selfDrivenMode) {
            requestAnimationFrame(this.selfDrivenUpdateFunc);
        }
        this.update();
        this.render();
    }

    update(renderer, scene, camera) {
        if (this.initializeFromExternalUpdate) {
            this.renderer = renderer;
            this.camera = camera;
            this.init();
        }
        if (!this.initialized || !this.splatRenderingInitialized) return;
        if (this.controls) this.controls.update();
        this.updateView();
        this.updateForRendererSizeChanges();
        this.updateSplatMeshUniforms();
        this.updateMeshCursor();
        this.updateFPS();
        this.timingSensitiveUpdates();
        this.updateInfo();
        this.updateControlPlane();
    }

    render = function() {

        return function() {
            if (!this.initialized || !this.splatRenderingInitialized) return;
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
                lastRendererSize.copy(currentRendererSize);
            }
        };

    }();

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
            if (!this.showInfo) return;
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
