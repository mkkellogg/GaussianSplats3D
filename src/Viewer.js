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
import { AbortablePromise } from './AbortablePromise.js';
import { SceneFormat } from './SceneFormat.js';

const THREE_CAMERA_FOV = 50;
const MINIMUM_DISTANCE_TO_NEW_FOCAL_POINT = .75;

/**
 * Viewer: Manages the rendering of splat scenes. Manages an instance of SplatMesh as well as a web worker
 * that performs the sort for its splats.
 */
export class Viewer {

    constructor(options = {}) {

        // The natural 'up' vector for viewing the scene (only has an effect when used with orbit controls and
        // when the viewer uses its own camera).
        if (!options.cameraUp) options.cameraUp = [0, 1, 0];
        this.cameraUp = new THREE.Vector3().fromArray(options.cameraUp);

        // The camera's initial position (only used when the viewer uses its own camera).
        if (!options.initialCameraPosition) options.initialCameraPosition = [0, 10, 15];
        this.initialCameraPosition = new THREE.Vector3().fromArray(options.initialCameraPosition);

        // The initial focal point of the camera and center of the camera's orbit (only used when the viewer uses its own camera).
        if (!options.initialCameraLookAt) options.initialCameraLookAt = [0, 0, 0];
        this.initialCameraLookAt = new THREE.Vector3().fromArray(options.initialCameraLookAt);

        // 'dropInMode' is a flag that is used internally to support the usage of the viewer as a Three.js scene object
        this.dropInMode = options.dropInMode || false;

        // If 'selfDrivenMode' is true, the viewer manages its own update/animation loop via requestAnimationFrame()
        if (options.selfDrivenMode === undefined || options.selfDrivenMode === null) options.selfDrivenMode = true;
        this.selfDrivenMode = options.selfDrivenMode && !this.dropInMode;
        this.selfDrivenUpdateFunc = this.selfDrivenUpdate.bind(this);

        // If 'useBuiltInControls' is true, the viewer will create its own instance of OrbitControls and attach to the camera
        if (options.useBuiltInControls === undefined) options.useBuiltInControls = true;
        this.useBuiltInControls = options.useBuiltInControls;

        // parent element of the Three.js renderer canvas
        this.rootElement = options.rootElement;

        // Tells the viewer to pretend the device pixel ratio is 1, which can boost performance on devices where it is larger,
        // at a small cost to visual quality
        this.ignoreDevicePixelRatio = options.ignoreDevicePixelRatio || false;
        this.devicePixelRatio = this.ignoreDevicePixelRatio ? 1 : window.devicePixelRatio;

        // Tells the viewer to use 16-bit floating point values when storing splat covariance data in textures, instead of 32-bit
        if (options.halfPrecisionCovariancesOnGPU === undefined || options.halfPrecisionCovariancesOnGPU === null) {
            options.halfPrecisionCovariancesOnGPU = true;
        }
        this.halfPrecisionCovariancesOnGPU = options.halfPrecisionCovariancesOnGPU;

        // If 'threeScene' is valid, it will be rendered by the viewer along with the splat mesh
        this.threeScene = options.threeScene;
        // Allows for usage of an external Three.js renderer
        this.renderer = options.renderer;
        // Allows for usage of an external Three.js camera
        this.camera = options.camera;

        // If 'gpuAcceleratedSort' is true, a partially GPU-accelerated approach to sorting splats will be used.
        // Currently this means pre-computing splat distances from the camera on the GPU
        this.gpuAcceleratedSort = options.gpuAcceleratedSort;
        if (this.gpuAcceleratedSort !== true && this.gpuAcceleratedSort !== false) {
            if (this.isMobile()) this.gpuAcceleratedSort = false;
            else this.gpuAcceleratedSort = true;
        }

        // if 'integerBasedSort' is true, the integer version of splat centers as well as other values used to calculate
        // splat distances are used instead of the float version. This speeds up computation, but introduces the possibility of
        // overflow in larger scenes.
        if (options.integerBasedSort === undefined || options.integerBasedSort === null) {
            options.integerBasedSort = true;
        }
        this.integerBasedSort = options.integerBasedSort;

        // If 'sharedMemoryForWorkers' is true, a SharedArrayBuffer will be used to communicate with web workers. This method
        // is faster than copying memory to or from web workers, but comes with security implications as outlined here:
        // https://web.dev/articles/cross-origin-isolation-guide
        // If enabled, it requires specific CORS headers to be present in the response from the server that is sent when
        // loading the application. More information is available in the README.
        if (options.sharedMemoryForWorkers === undefined || options.sharedMemoryForWorkers === null) options.sharedMemoryForWorkers = true;
        this.sharedMemoryForWorkers = options.sharedMemoryForWorkers;

        // if 'dynamicScene' is true, it tells the viewer to assume scene elements are not stationary or that the number of splats in the
        // scene may change. This prevents optimizations that depend on a static scene from being made. Additionally, if 'dynamicScene' is
        // true it tells the splat mesh to not apply scene tranforms to splat data that is returned by functions like
        // SplatMesh.getSplatCenter() by default.
        const dynamicScene = !!options.dynamicScene;
        this.splatMesh = new SplatMesh(dynamicScene, this.halfPrecisionCovariancesOnGPU, this.devicePixelRatio,
                                       this.gpuAcceleratedSort, this.integerBasedSort);

        this.controls = null;

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
        this.sortWorkerTransforms = null;

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

        this.resizeObserver = null;
        this.mouseMoveListener = null;
        this.mouseDownListener = null;
        this.mouseUpListener = null;
        this.keyDownListener = null;

        this.sortPromise = null;
        this.sortPromiseResolver = null;

        this.loadingSpinner = new LoadingSpinner(null, this.rootElement || document.body);
        this.loadingSpinner.hide();

        this.usingExternalCamera = (this.dropInMode || this.camera) ? true : false;
        this.usingExternalRenderer = (this.dropInMode || this.renderer) ? true : false;

        this.initialized = false;
        if (!this.dropInMode) this.init();
    }

    init() {

        if (this.initialized) return;

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
            this.renderer.setClearColor(new THREE.Color( 0x000000 ), 0.0);
            this.renderer.setSize(renderDimensions.x, renderDimensions.y);

            this.resizeObserver = new ResizeObserver(() => {
                this.getRenderDimensions(renderDimensions);
                this.renderer.setSize(renderDimensions.x, renderDimensions.y);
            });
            this.resizeObserver.observe(this.rootElement);
            this.rootElement.appendChild(this.renderer.domElement);
        }

        this.threeScene = this.threeScene || new THREE.Scene();
        this.sceneHelper = new SceneHelper(this.threeScene);
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
            this.mouseMoveListener = this.onMouseMove.bind(this);
            this.rootElement.addEventListener('pointermove', this.mouseMoveListener, false);
            this.mouseDownListener = this.onMouseDown.bind(this);
            this.rootElement.addEventListener('pointerdown', this.mouseDownListener, false);
            this.mouseUpListener = this.onMouseUp.bind(this);
            this.rootElement.addEventListener('pointerup', this.mouseUpListener, false);
            this.keyDownListener = this.onKeyDown.bind(this);
            window.addEventListener('keydown', this.keyDownListener, false);
        }

        this.setupInfoPanel();
        this.loadingSpinner.setContainer(this.rootElement);

        this.initialized = true;
    }

    removeEventHandlers() {
        if (this.useBuiltInControls) {
            this.rootElement.removeEventListener('pointermove', this.mouseMoveListener);
            this.mouseMoveListener = null;
            this.rootElement.removeEventListener('pointerdown', this.mouseDownListener);
            this.mouseDownListener = null;
            this.rootElement.removeEventListener('pointerup', this.mouseUpListener);
            this.mouseUpListener = null;
            window.removeEventListener('keydown', this.keyDownListener);
            this.keyDownListener = null;
        }
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

        const clickOffset = new THREE.Vector2();

        return function(mouse) {
            clickOffset.copy(this.mousePosition).sub(this.mouseDownPosition);
            const mouseUpTime = getCurrentTime();
            const wasClick = mouseUpTime - this.mouseDownTime < 0.5 && clickOffset.length() < 2;
            if (wasClick) {
                this.onMouseClick(mouse);
            }
        };

    }();

    onMouseClick(mouse) {
        this.mousePosition.set(mouse.offsetX, mouse.offsetY);
        this.checkForFocalPointChange();
    }

    checkForFocalPointChange = function() {

        const renderDimensions = new THREE.Vector2();
        const toNewFocalPoint = new THREE.Vector3();
        const outHits = [];

        return function() {
            if (!this.transitioningCameraTarget) {
                this.getRenderDimensions(renderDimensions);
                outHits.length = 0;
                this.raycaster.setFromCameraAndScreenPosition(this.camera, this.mousePosition, renderDimensions);
                this.raycaster.intersectSplatMesh(this.splatMesh, outHits);
                if (outHits.length > 0) {
                    const hit = outHits[0];
                    const intersectionPoint = hit.origin;
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

    updateSplatMesh = function() {

        const renderDimensions = new THREE.Vector2();

        return function() {
            if (!this.splatMesh) return;
            const splatCount = this.splatMesh.getSplatCount();
            if (splatCount > 0) {
                this.splatMesh.updateTransforms();
                this.getRenderDimensions(renderDimensions);
                this.cameraFocalLengthX = this.camera.projectionMatrix.elements[0] *
                                          this.devicePixelRatio * renderDimensions.x * 0.45;
                                          this.cameraFocalLengthY = this.camera.projectionMatrix.elements[5] *
                                          this.devicePixelRatio * renderDimensions.y * 0.45;
                this.splatMesh.updateUniforms(renderDimensions, this.cameraFocalLengthX, this.cameraFocalLengthY);
            }
        };

    }();

    /**
     * Add a splat scene to the viewer.
     * @param {string} path Path to splat scene to be loaded
     * @param {object} options {
     *
     *         splatAlphaRemovalThreshold: Ignore any splats with an alpha less than the specified
     *                                     value (valid range: 0 - 255), defaults to 1
     *
     *         showLoadingSpinner:         Display a loading spinner while the scene is loading, defaults to true
     *
     *         position (Array<number>):   Position of the scene, acts as an offset from its default position, defaults to [0, 0, 0]
     *
     *         rotation (Array<number>):   Rotation of the scene represented as a quaternion, defaults to [0, 0, 0, 1]
     *
     *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
     *
     *         onProgress:                 Function to be called as file data are received
     *
     * }
     * @return {AbortablePromise}
     */
    addSplatScene(path, options = {}) {
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
        const loadPromise = this.loadFileToSplatBuffer(path, options.splatAlphaRemovalThreshold, downloadProgress, options.format);
        return new AbortablePromise((resolve, reject) => {
            loadPromise.then((splatBuffer) => {
                if (options.showLoadingSpinner) this.loadingSpinner.hide();
                if (options.onProgress) options.onProgress(0, '0%', 'processing');
                const splatBufferOptions = {
                    'rotation': options.rotation || options.orientation,
                    'position': options.position,
                    'scale': options.scale,
                    'splatAlphaRemovalThreshold': options.splatAlphaRemovalThreshold,
                };
                this.addSplatBuffers([splatBuffer], [splatBufferOptions], options.showLoadingSpinner).then(() => {
                    if (options.onProgress) options.onProgress(100, '100%', 'processing');
                    resolve();
                });
            })
            .catch(() => {
                if (options.showLoadingSpinner) this.loadingSpinner.hide();
                reject(new Error(`Viewer::addSplatScene -> Could not load file ${path}`));
            });
        }, loadPromise.abortHandler);
    }

    /**
     * Add multiple splat scenes to the viewer.
     * @param {Array<object>} sceneOptions Array of per-scene options: {
     *
     *         path: Path to splat scene to be loaded
     *
     *         splatAlphaRemovalThreshold: Ignore any splats with an alpha less than the specified
     *                                     value (valid range: 0 - 255), defaults to 1
     *
     *         position (Array<number>):   Position of the scene, acts as an offset from its default position, defaults to [0, 0, 0]
     *
     *         rotation (Array<number>):   Rotation of the scene represented as a quaternion, defaults to [0, 0, 0, 1]
     *
     *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
     * }
     * @param {boolean} showLoadingSpinner Display a loading spinner while the scene is loading, defaults to true
     * @param {function} onProgress Function to be called as file data are received
     * @return {AbortablePromise}
     */
    addSplatScenes(sceneOptions, showLoadingSpinner = true, onProgress = undefined) {
        const fileCount = sceneOptions.length;
        const percentComplete = [];
        if (showLoadingSpinner) this.loadingSpinner.show();
        const downloadProgress = (fileIndex, percent, percentLabel) => {
            percentComplete[fileIndex] = percent;
            let totalPercent = 0;
            for (let i = 0; i < fileCount; i++) totalPercent += percentComplete[i] || 0;
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

        const loadPromises = [];
        const abortHandlers = [];
        for (let i = 0; i < sceneOptions.length; i++) {
            const loadPromise = this.loadFileToSplatBuffer(sceneOptions[i].path, sceneOptions[i].splatAlphaRemovalThreshold,
                                                           downloadProgress.bind(this, i), sceneOptions.format);
            abortHandlers.push(loadPromise.abortHandler);
            loadPromises.push(loadPromise.promise);
        }
        const abortHandler = () => {
            for (let abortHandler of abortHandlers) {
                abortHandler();
            }
        };
        return new AbortablePromise((resolve, reject) => {
            Promise.all(loadPromises)
            .then((splatBuffers) => {
                if (showLoadingSpinner) this.loadingSpinner.hide();
                if (onProgress) options.onProgress(0, '0%', 'processing');
                this.addSplatBuffers(splatBuffers, sceneOptions, showLoadingSpinner).then(() => {
                    if (onProgress) onProgress(100, '100%', 'processing');
                    resolve();
                });
            })
            .catch(() => {
                if (showLoadingSpinner) this.loadingSpinner.hide();
                reject(new Error(`Viewer::addSplatScenes -> Could not load one or more splat scenes.`));
            });
        }, abortHandler);
    }

    /**
     *
     * @param {string} path Path to splat scene to be loaded
     * @param {number} splatAlphaRemovalThreshold Ignore any splats with an alpha less than the specified
     *                                            value (valid range: 0 - 255), defaults to 1
     *
     * @param {function} onProgress Function to be called as file data are received
     * @param {string} format Optional format specifier, if not specified the format will be inferred from the file extension
     * @return {AbortablePromise}
     */
    loadFileToSplatBuffer(path, splatAlphaRemovalThreshold = 1, onProgress = undefined, format = undefined) {
        const downloadProgress = (percent, percentLabel) => {
            if (onProgress) onProgress(percent, percentLabel, 'downloading');
        };
        if (format) {
            if (format === SceneFormat.Splat || format === SceneFormat.KSplat) {
                return new SplatLoader().loadFromURL(path, downloadProgress, 0, splatAlphaRemovalThreshold, undefined, undefined, format);
            } else if (format === SceneFormat.Ply) {
                return new PlyLoader().loadFromURL(path, downloadProgress, 0, splatAlphaRemovalThreshold);
            }
        } else {
            if (SplatLoader.isFileSplatFormat(path)) {
                return new SplatLoader().loadFromURL(path, downloadProgress, 0, splatAlphaRemovalThreshold);
            } else if (path.endsWith('.ply')) {
                return new PlyLoader().loadFromURL(path, downloadProgress, 0, splatAlphaRemovalThreshold);
            }
        }

        return AbortablePromise.reject(new Error(`Viewer::loadFileToSplatBuffer -> File format not supported: ${path}`));
    }

    /**
     * Add one or more instances of SplatBuffer to the SplatMesh instance managed by the viewer and set up the sorting web worker.
     * This function will terminate the existing sort worker (if there is one).
     */
    addSplatBuffers = function() {

        let loadPromise;
        let loadCount = 0;

        return function(splatBuffers, splatBufferOptions = [], showLoadingSpinner = true) {
            this.splatRenderingInitialized = false;
            loadCount++;
            const performLoad = () => {
                return new Promise((resolve) => {
                    if (showLoadingSpinner) {
                        this.loadingSpinner.show();
                        this.loadingSpinner.setMessage(`Processing splats...`);
                    }
                    window.setTimeout(() => {
                        this.disposeSortWorker();
                        this.addSplatBuffersToMesh(splatBuffers, splatBufferOptions);
                        this.setupSortWorker(this.splatMesh).then(() => {
                            loadCount--;
                            if (loadCount === 0) {
                                if (showLoadingSpinner) this.loadingSpinner.hide();
                                this.splatRenderingInitialized = true;
                            }
                            resolve();
                        });
                    }, 1);
                });
            };
            if (!loadPromise) {
                loadPromise = performLoad();
            } else {
                loadPromise = loadPromise.then(() => {
                    return performLoad();
                });
            }
            return loadPromise;
        };

    }();

    disposeSortWorker() {
        if (this.sortWorker) this.sortWorker.terminate();
        this.sortWorker = null;
        this.sortRunning = false;
    }

    /**
     * Add one or more instances of SplatBuffer to the SplatMesh instance managed by the viewer. This function is additive; all splat
     * buffers contained by the viewer's splat mesh before calling this function will be preserved.
     * @param {Array<SplatBuffer>} splatBuffers SplatBuffer instances
     * @param {Array<object>} splatBufferOptions Array of options objects: {
     *
     *         splatAlphaRemovalThreshold: Ignore any splats with an alpha less than the specified
     *                                     value (valid range: 0 - 255), defaults to 1
     *
     *         position (Array<number>):   Position of the scene, acts as an offset from its default position, defaults to [0, 0, 0]
     *
     *         rotation (Array<number>):   Rotation of the scene represented as a quaternion, defaults to [0, 0, 0, 1]
     *
     *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
     * }
     */
    addSplatBuffersToMesh(splatBuffers, splatBufferOptions) {
        const allSplatBuffers = this.splatMesh.splatBuffers || [];
        const allSplatBufferOptions = this.splatMesh.splatBufferOptions || [];
        allSplatBuffers.push(...splatBuffers);
        allSplatBufferOptions.push(...splatBufferOptions);
        this.splatMesh.build(allSplatBuffers, allSplatBufferOptions, true);
        if (this.renderer) this.splatMesh.setRenderer(this.renderer);
        this.splatMesh.frustumCulled = false;
    }

    /**
     * Set up the splat sorting web worker.
     * @param {SplatMesh} splatMesh SplatMesh instance that contains the splats to be sorted
     * @return {Promise}
     */
    setupSortWorker(splatMesh) {
        return new Promise((resolve) => {
            const DistancesArrayType = this.integerBasedSort ? Int32Array : Float32Array;
            const splatCount = splatMesh.getSplatCount();
            const sortWorker = createSortWorker(splatCount, this.sharedMemoryForWorkers, this.integerBasedSort, this.splatMesh.dynamicMode);
            sortWorker.onmessage = (e) => {
                if (e.data.sortDone) {
                    this.sortRunning = false;
                    if (this.sharedMemoryForWorkers) {
                        this.splatMesh.updateRenderIndexes(this.sortWorkerSortedIndexes, e.data.splatRenderCount);
                    } else {
                        const sortedIndexes = new Uint32Array(e.data.sortedIndexes, 0, e.data.splatRenderCount);
                        this.splatMesh.updateRenderIndexes(sortedIndexes, e.data.splatRenderCount);
                    }
                    this.lastSortTime = e.data.sortTime;
                    this.sortPromiseResolver();
                    this.sortPromise = null;
                    this.sortPromiseResolver = null;
                } else if (e.data.sortCanceled) {
                    this.sortRunning = false;
                } else if (e.data.sortSetupPhase1Complete) {
                    console.log('Sorting web worker WASM setup complete.');
                    const centers = this.integerBasedSort ? this.splatMesh.getIntegerCenters(true) : this.splatMesh.getFloatCenters(true);
                    const transformIndexes = this.splatMesh.getTransformIndexes();
                    sortWorker.postMessage({
                        'centers': centers.buffer,
                        'transformIndexes': transformIndexes.buffer
                    });
                    if (this.sharedMemoryForWorkers) {
                        this.sortWorkerSortedIndexes = new Uint32Array(e.data.sortedIndexesBuffer,
                                                                       e.data.sortedIndexesOffset, splatCount);
                        this.sortWorkerIndexesToSort = new Uint32Array(e.data.indexesToSortBuffer,
                                                                       e.data.indexesToSortOffset, splatCount);
                        this.sortWorkerPrecomputedDistances = new DistancesArrayType(e.data.precomputedDistancesBuffer,
                                                                                     e.data.precomputedDistancesOffset,
                                                                                     splatCount);
                         this.sortWorkerTransforms = new Float32Array(e.data.transformsBuffer,
                                                                      e.data.transformsOffset, Constants.MaxScenes * 16);
                    } else {
                        this.sortWorkerIndexesToSort = new Uint32Array(splatCount);
                        this.sortWorkerPrecomputedDistances = new DistancesArrayType(splatCount);
                        this.sortWorkerTransforms = new Float32Array(Constants.MaxScenes * 16);
                    }
                    for (let i = 0; i < splatCount; i++) this.sortWorkerIndexesToSort[i] = i;
                } else if (e.data.sortSetupComplete) {
                    console.log('Sorting web worker ready.');
                    const splatDataTextures = this.splatMesh.getSplatDataTextures();
                    const covariancesTextureSize = splatDataTextures.covariances.size;
                    const centersColorsTextureSize = splatDataTextures.centerColors.size;
                    console.log('Covariances texture size: ' + covariancesTextureSize.x + ' x ' + covariancesTextureSize.y);
                    console.log('Centers/colors texture size: ' + centersColorsTextureSize.x + ' x ' + centersColorsTextureSize.y);
                    this.sortWorker = sortWorker;
                    resolve();
                }
            };
        });
    }

    /**
     * Start self-driven mode
     */
    start() {
        if (this.selfDrivenMode) {
            this.requestFrameId = requestAnimationFrame(this.selfDrivenUpdateFunc);
            this.selfDrivenModeRunning = true;
        } else {
            throw new Error('Cannot start viewer unless it is in self driven mode.');
        }
    }

    /**
     * Stop self-driven mode
     */
    stop() {
        if (this.selfDrivenMode && this.selfDrivenModeRunning) {
            cancelAnimationFrame(this.requestFrameId);
            this.selfDrivenModeRunning = false;
        }
    }

    /**
     * Dispose of all resources held directly and indirectly by this viewer.
     */
    async dispose() {
        if (this.sortPromise) {
            await this.sortPromise;
        }
        this.stop();
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }
        if (this.splatMesh) {
            this.splatMesh.dispose();
            this.splatMesh = null;
        }
        if (this.sceneHelper) {
            this.sceneHelper.dispose();
            this.sceneHelper = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.unobserve(this.rootElement);
            this.resizeObserver = null;
        }
        if (this.renderer) {
            if (!this.usingExternalRenderer) this.renderer.dispose();
            this.renderer = null;
        }
        this.disposeSortWorker();
        this.removeEventHandlers();
        this.camera = null;
        this.threeScene = null;
        this.splatRenderingInitialized = false;
        this.initialized = false;
    }

    selfDrivenUpdate() {
        if (this.selfDrivenMode) {
            this.requestFrameId = requestAnimationFrame(this.selfDrivenUpdateFunc);
        }
        this.update();
        this.render();
    }

    render = function() {

        return function() {
            if (!this.initialized || !this.splatRenderingInitialized) return;
            const hasRenderables = (threeScene) => {
                for (let child of threeScene.children) {
                    if (child.visible) return true;
                }
                return false;
            };
            const savedAuoClear = this.renderer.autoClear;
            this.renderer.autoClear = false;
            if (hasRenderables(this.threeScene)) this.renderer.render(this.threeScene, this.camera);
            this.renderer.render(this.splatMesh, this.camera);
            if (this.sceneHelper.getFocusMarkerOpacity() > 0.0) this.renderer.render(this.sceneHelper.focusMarker, this.camera);
            if (this.showControlPlane) this.renderer.render(this.sceneHelper.controlPlane, this.camera);
            this.renderer.autoClear = savedAuoClear;
        };

    }();

    update(renderer, camera) {
        if (this.dropInMode) this.updateForDropInMode(renderer, camera);
        if (!this.initialized || !this.splatRenderingInitialized) return;
        if (this.controls) this.controls.update();
        this.updateSplatSort();
        this.updateForRendererSizeChanges();
        this.updateSplatMesh();
        this.updateMeshCursor();
        this.updateFPS();
        this.timingSensitiveUpdates();
        this.updateInfoPanel();
        this.updateControlPlane();
    }

    updateForDropInMode(renderer, camera) {
        this.renderer = renderer;
        if (this.splatMesh) this.splatMesh.setRenderer(this.renderer);
        this.camera = camera;
        if (this.controls) this.controls.object = camera;
        this.init();
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

    updateInfoPanel = function() {

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

    updateSplatSort = function() {

        const mvpMatrix = new THREE.Matrix4();
        const cameraPositionArray = [];
        const lastSortViewDir = new THREE.Vector3(0, 0, -1);
        const sortViewDir = new THREE.Vector3(0, 0, -1);
        const lastSortViewPos = new THREE.Vector3();
        const sortViewOffset = new THREE.Vector3();
        const queuedSorts = [];
        let runCount = 0;

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

        return async function(force = false, gatherAllNodes = false) {
            if (this.sortRunning) return;
            if (!this.initialized || !this.splatRenderingInitialized) return;

            let angleDiff = 0;
            let positionDiff = 0;
            let needsRefreshForRotation = false;
            let needsRefreshForPosition = false;

            sortViewDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
            angleDiff = sortViewDir.dot(lastSortViewDir);
            positionDiff = sortViewOffset.copy(this.camera.position).sub(lastSortViewPos).length();

            if (!force && !this.splatMesh.dynamicMode && queuedSorts.length === 0 && runCount > 0) {
                if (angleDiff <= 0.95) needsRefreshForRotation = true;
                if (positionDiff >= 1.0) needsRefreshForPosition = true;
                if (!needsRefreshForRotation && !needsRefreshForPosition) return;
            }

            this.sortRunning = true;
            this.splatRenderCount = this.gatherSceneNodesForSort(gatherAllNodes);
            this.sortPromise = new Promise((resolve) => {
                this.sortPromiseResolver = resolve;
            });

            mvpMatrix.copy(this.camera.matrixWorld).invert();
            mvpMatrix.premultiply(this.camera.projectionMatrix);
            mvpMatrix.multiply(this.splatMesh.matrixWorld);

            if (this.gpuAcceleratedSort && (queuedSorts.length <= 1 || queuedSorts.length % 2 === 0)) {
                await this.splatMesh.computeDistancesOnGPU(mvpMatrix, this.sortWorkerPrecomputedDistances);
            }

            if (this.splatMesh.dynamicMode) {
                queuedSorts.push(this.splatRenderCount);
            } else {
                if (queuedSorts.length === 0) {
                    for (let partialSort of partialSorts) {
                        if (angleDiff < partialSort.angleThreshold) {
                            for (let sortFraction of partialSort.sortFractions) {
                                queuedSorts.push(Math.floor(this.splatRenderCount * sortFraction));
                            }
                            break;
                        }
                    }
                    queuedSorts.push(this.splatRenderCount);
                }
            }
            const sortCount = Math.min(queuedSorts.shift(), this.splatRenderCount);

            cameraPositionArray[0] = this.camera.position.x;
            cameraPositionArray[1] = this.camera.position.y;
            cameraPositionArray[2] = this.camera.position.z;

            const sortMessage = {
                'modelViewProj': mvpMatrix.elements,
                'cameraPosition': cameraPositionArray,
                'splatRenderCount': this.splatRenderCount,
                'splatSortCount': sortCount,
                'usePrecomputedDistances': this.gpuAcceleratedSort
            };
            if (this.splatMesh.dynamicMode) {
                this.splatMesh.fillTransformsArray(this.sortWorkerTransforms);
            }
            if (!this.sharedMemoryForWorkers) {
                sortMessage.indexesToSort = this.sortWorkerIndexesToSort;
                sortMessage.transforms = this.sortWorkerTransforms;
                if (this.gpuAcceleratedSort) {
                    sortMessage.precomputedDistances = this.sortWorkerPrecomputedDistances;
                }
            }
            this.sortWorker.postMessage({
                'sort': sortMessage
            });

            if (queuedSorts.length === 0) {
                lastSortViewPos.copy(this.camera.position);
                lastSortViewDir.copy(sortViewDir);
            }
            runCount++;
        };

    }();

    /**
     * Determine which splats to render by checking which are inside or close to the view frustum
     */
    gatherSceneNodesForSort = function() {

        const nodeRenderList = [];
        const tempVectorYZ = new THREE.Vector3();
        const tempVectorXZ = new THREE.Vector3();
        const tempVector = new THREE.Vector3();
        const modelView = new THREE.Matrix4();
        const baseModelView = new THREE.Matrix4();
        const sceneTransform = new THREE.Matrix4();
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

            const splatTree = this.splatMesh.getSplatTree();
            baseModelView.copy(this.camera.matrixWorld).invert();
            baseModelView.multiply(this.splatMesh.matrixWorld);

            let nodeRenderCount = 0;
            let splatRenderCount = 0;

            for (let s = 0; s < splatTree.subTrees.length; s++) {
                const subTree = splatTree.subTrees[s];
                modelView.copy(baseModelView);
                if (this.splatMesh.dynamicMode) {
                    this.splatMesh.getSceneTransform(s, sceneTransform);
                    modelView.multiply(sceneTransform);
                }
                const nodeCount = subTree.nodesWithIndexes.length;
                for (let i = 0; i < nodeCount; i++) {
                    const node = subTree.nodesWithIndexes[i];
                    tempVector.copy(node.center).applyMatrix4(modelView);

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
            }

            nodeRenderList.length = nodeRenderCount;
            nodeRenderList.sort((a, b) => {
                if (a.data.distanceToNode < b.data.distanceToNode) return -1;
                else return 1;
            });

            let currentByteOffset = splatRenderCount * Constants.BytesPerInt;
            for (let i = 0; i < nodeRenderCount; i++) {
                const node = nodeRenderList[i];
                const windowSizeInts = node.data.indexes.length;
                const windowSizeBytes = windowSizeInts * Constants.BytesPerInt;
                let destView = new Uint32Array(this.sortWorkerIndexesToSort.buffer, currentByteOffset - windowSizeBytes, windowSizeInts);
                destView.set(node.data.indexes);
                currentByteOffset -= windowSizeBytes;
            }

            return splatRenderCount;
        };

    }();

    getSplatMesh() {
        return this.splatMesh;
    }

    /**
     * Get a reference to a splat scene.
     * @param {number} sceneIndex The index of the scene to which the reference will be returned
     * @return {SplatScene}
     */
    getSplatScene(sceneIndex) {
        return this.splatMesh.getScene(sceneIndex);
    }

    isMobile() {
        return navigator.userAgent.includes('Mobi');
    }
}
