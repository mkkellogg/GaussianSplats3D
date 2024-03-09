import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';
import { PlyLoader } from './loaders/PlyLoader.js';
import { SplatLoader } from './loaders/SplatLoader.js';
import { KSplatLoader } from './loaders/KSplatLoader.js';
import { sceneFormatFromPath } from './loaders/Utils.js';
import { LoadingSpinner } from './ui/LoadingSpinner.js';
import { LoadingProgressBar } from './ui/LoadingProgressBar.js';
import { InfoPanel } from './ui/InfoPanel.js';
import { SceneHelper } from './SceneHelper.js';
import { Raycaster } from './raycaster/Raycaster.js';
import { SplatMesh } from './SplatMesh.js';
import { createSortWorker } from './worker/SortWorker.js';
import { Constants } from './Constants.js';
import { getCurrentTime } from './Util.js';
import { AbortablePromise, AbortedPromiseError } from './AbortablePromise.js';
import { SceneFormat } from './loaders/SceneFormat.js';
import { WebXRMode } from './webxr/WebXRMode.js';
import { VRButton } from './webxr/VRButton.js';
import { ARButton } from './webxr/ARButton.js';
import { delayedExecute } from './Util.js';
import { LoaderStatus } from './loaders/LoaderStatus.js';


const THREE_CAMERA_FOV = 50;
const MINIMUM_DISTANCE_TO_NEW_FOCAL_POINT = .75;
const MIN_SPLAT_COUNT_TO_SHOW_SPLAT_TREE_LOADING_SPINNER = 1500000;
const FOCUS_MARKER_FADE_IN_SPEED = 10.0;
const FOCUS_MARKER_FADE_OUT_SPEED = 2.5;

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


        this.webXRMode = options.webXRMode || WebXRMode.None;

        if (this.webXRMode !== WebXRMode.None) {
            this.gpuAcceleratedSort = false;
        }

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
        this.runAfterFirstSort = [];

        this.selfDrivenModeRunning = false;
        this.splatRenderingInitialized = false;

        this.raycaster = new Raycaster();

        this.infoPanel = null;

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
        this.downloadPromisesToAbort = {};
        this.splatSceneLoadPromise = null;

        this.loadingSpinner = new LoadingSpinner(null, this.rootElement || document.body);
        this.loadingSpinner.hide();
        this.loadingProgressBar = new LoadingProgressBar(this.rootElement || document.body);
        this.loadingProgressBar.hide();
        this.infoPanel = new InfoPanel(this.rootElement || document.body);
        this.infoPanel.hide();

        this.usingExternalCamera = (this.dropInMode || this.camera) ? true : false;
        this.usingExternalRenderer = (this.dropInMode || this.renderer) ? true : false;

        this.initialized = false;
        this.disposing = false;
        this.disposed = false;
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
            this.camera.up.copy(this.cameraUp).normalize();
            this.camera.lookAt(this.initialCameraLookAt);
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

        if (this.webXRMode) {
            if (this.webXRMode === WebXRMode.VR) {
                this.rootElement.appendChild(VRButton.createButton(this.renderer));
            } else if (this.webXRMode === WebXRMode.AR) {
                this.rootElement.appendChild(ARButton.createButton(this.renderer));
            }
            this.renderer.xr.enabled = true;
            this.camera.position.copy(this.initialCameraPosition);
            this.camera.up.copy(this.cameraUp).normalize();
            this.camera.lookAt(this.initialCameraLookAt);
        }

        this.threeScene = this.threeScene || new THREE.Scene();
        this.sceneHelper = new SceneHelper(this.threeScene);
        this.sceneHelper.setupMeshCursor();
        this.sceneHelper.setupFocusMarker();
        this.sceneHelper.setupControlPlane();

        if (this.useBuiltInControls && this.webXRMode === WebXRMode.None) {
            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.listenToKeyEvents(window);
            this.controls.rotateSpeed = 0.5;
            this.controls.maxPolarAngle = Math.PI * .75;
            this.controls.minPolarAngle = 0.1;
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.target.copy(this.initialCameraLookAt);
            this.mouseMoveListener = this.onMouseMove.bind(this);
            this.renderer.domElement.addEventListener('pointermove', this.mouseMoveListener, false);
            this.mouseDownListener = this.onMouseDown.bind(this);
            this.renderer.domElement.addEventListener('pointerdown', this.mouseDownListener, false);
            this.mouseUpListener = this.onMouseUp.bind(this);
            this.renderer.domElement.addEventListener('pointerup', this.mouseUpListener, false);
            this.keyDownListener = this.onKeyDown.bind(this);
            window.addEventListener('keydown', this.keyDownListener, false);
        }

        this.loadingProgressBar.setContainer(this.rootElement);
        this.loadingSpinner.setContainer(this.rootElement);
        this.infoPanel.setContainer(this.rootElement);

        this.initialized = true;
    }

    removeEventHandlers() {
        if (this.useBuiltInControls) {
            this.renderer.domElement.removeEventListener('pointermove', this.mouseMoveListener);
            this.mouseMoveListener = null;
            this.renderer.domElement.removeEventListener('pointerdown', this.mouseDownListener);
            this.mouseDownListener = null;
            this.renderer.domElement.removeEventListener('pointerup', this.mouseUpListener);
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
                        this.infoPanel.show();
                    } else {
                        this.infoPanel.hide();
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

    isLoading() {
        return Object.keys(this.downloadPromisesToAbort) > 0 || this.splatSceneLoadPromise !== null;
    }

    isDisposingOrDisposed() {
        return this.disposing || this.disposed;
    }


    clearSplatSceneLoadPromise() {
        this.splatSceneLoadPromise = null;
    }

    setSplatSceneLoadPromise(promise) {
        this.splatSceneLoadPromise = promise;
    }

    /**
     * Add a splat scene to the viewer and display any loading UI if appropriate.
     * @param {string} path Path to splat scene to be loaded
     * @param {object} options {
     *
     *         splatAlphaRemovalThreshold: Ignore any splats with an alpha less than the specified
     *                                     value (valid range: 0 - 255), defaults to 1
     *
     *         showLoadingUI:         Display a loading spinner while the scene is loading, defaults to true
     *
     *         position (Array<number>):   Position of the scene, acts as an offset from its default position, defaults to [0, 0, 0]
     *
     *         rotation (Array<number>):   Rotation of the scene represented as a quaternion, defaults to [0, 0, 0, 1]
     *
     *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
     *
     *         onProgress:                 Function to be called as file data are received, or other processing occurs
     *
     * }
     * @return {AbortablePromise}
     */
    addSplatScene(path, options = {}) {

        if (this.isLoading()) {
            throw new Error('Cannot add splat scene while another load is already in progress.');
        }

        if (this.isDisposingOrDisposed()) {
            throw new Error('Cannot add splat scene after dispose() is called.');
        }

        let format = options.format;
        if (format === undefined || format === null) {
            format = sceneFormatFromPath(path);
        }
        const streamBuildSections = Viewer.isStreamable(format) && options.streamView;

        const splatBufferOptions = {
            'rotation': options.rotation || options.orientation,
            'position': options.position,
            'scale': options.scale,
            'splatAlphaRemovalThreshold': options.splatAlphaRemovalThreshold,
        };

        let showLoadingUI = options.showLoadingUI;
        if (showLoadingUI !== false) showLoadingUI = true;

        let loadingTaskId = null;
        if (showLoadingUI) loadingTaskId = this.loadingSpinner.addTask('Downloading...');

        let downloadDone = false;

        let downloadedPercentage = 0;
        const onProgress = (percent, percentLabel, loaderStatus) => {
            if (showLoadingUI) {
                if (loaderStatus === LoaderStatus.Downloading) {
                    downloadedPercentage = percent;
                    if (percent == 100) {
                        this.loadingSpinner.setMessageForTask(loadingTaskId, 'Download complete!');
                    } else {
                        if (streamBuildSections) {
                            this.loadingSpinner.setMessageForTask(loadingTaskId, 'Downloading splats...');
                        } else {
                            const suffix = percentLabel ? `: ${percentLabel}` : `...`;
                            this.loadingSpinner.setMessageForTask(loadingTaskId, `Downloading${suffix}`);
                        }
                    }
                } else if (loaderStatus === LoaderStatus.Processing) {
                    this.loadingSpinner.setMessageForTask(loadingTaskId, 'Processing splats...');
                } else {
                    this.loadingSpinner.setMessageForTask(loadingTaskId, 'Ready!');
                }
            }
            if (options.onProgress) options.onProgress(percent, percentLabel, loaderStatus);
        };

        const buildSection = (splatBuffer, firstBuild, finalBuild) => {
            if (!streamBuildSections && options.onProgress) options.onProgress(0, '0%', LoaderStatus.Processing);
            return this.addSplatBuffers([splatBuffer], [splatBufferOptions],
                                         finalBuild, firstBuild && showLoadingUI, showLoadingUI).then(() => {
                if (!streamBuildSections && options.onProgress) options.onProgress(100, '100%', LoaderStatus.Processing);
                if (showLoadingUI) {
                    if (firstBuild && streamBuildSections || finalBuild && !streamBuildSections) {
                        this.runAfterFirstSort.push(() => {
                            this.loadingSpinner.removeTask(loadingTaskId);
                            if (!finalBuild && !downloadDone) this.loadingProgressBar.show();
                        });
                    }
                    if (streamBuildSections) {
                        if (finalBuild) {
                            downloadDone = true;
                            this.loadingProgressBar.hide();
                        } else {
                            this.loadingProgressBar.setProgress(downloadedPercentage);
                        }
                    }
                }
            });
        };

        const hideLoadingUI = () => {
            this.loadingProgressBar.hide();
            this.loadingSpinner.removeAllTasks();
        };

        const loadFunc = streamBuildSections ? this.loadSplatSceneToSplatBufferStreaming.bind(this) :
                                               this.loadSplatSceneToSplatBufferNonStreaming.bind(this);
        return loadFunc(path, format, options.splatAlphaRemovalThreshold, buildSection.bind(this), onProgress, hideLoadingUI.bind(this));
    }

    /**
     * Add multiple splat scenes to the viewer and display any loading UI if appropriate.
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
     * @param {boolean} showLoadingUI Display a loading spinner while the scene is loading, defaults to true
     * @param {function} onProgress Function to be called as file data are received
     * @return {AbortablePromise}
     */
    addSplatScenes(sceneOptions, showLoadingUI = true, onProgress = undefined) {

        if (this.isLoading()) {
            throw new Error('Cannot add splat scene while another load is already in progress.');
        }

        if (this.isDisposingOrDisposed()) {
            throw new Error('Cannot add splat scene after dispose() is called.');
        }

        const fileCount = sceneOptions.length;
        const percentComplete = [];
        if (showLoadingUI) this.loadingSpinner.show();
        const onLoadProgress = (fileIndex, percent, percentLabel) => {
            percentComplete[fileIndex] = percent;
            let totalPercent = 0;
            for (let i = 0; i < fileCount; i++) totalPercent += percentComplete[i] || 0;
            totalPercent = totalPercent / fileCount;
            percentLabel = `${totalPercent.toFixed(2)}%`;
            if (showLoadingUI) {
                if (totalPercent == 100) {
                    this.loadingSpinner.setMessage(`Download complete!`);
                } else {
                    this.loadingSpinner.setMessage(`Downloading: ${percentLabel}`);
                }
            }
            if (onProgress) onProgress(totalPercent, percentLabel, LoaderStatus.Downloading);
        };

        const loadPromises = [];
        const nativeLoadPromises = [];
        const abortHandlers = [];
        for (let i = 0; i < sceneOptions.length; i++) {

            let format = sceneOptions[i].format;
            if (format === undefined || format === null) {
                format = sceneFormatFromPath(sceneOptions[i].path);
            }

            const downloadPromise = this.loadSplatSceneToSplatBuffer(sceneOptions[i].path, sceneOptions[i].splatAlphaRemovalThreshold,
                                                                     onLoadProgress.bind(this, i), false, undefined, format);
            abortHandlers.push(downloadPromise.abortHandler);
            loadPromises.push(downloadPromise);
            nativeLoadPromises.push(downloadPromise.promise);
            this.downloadPromisesToAbort[downloadPromise.id] = downloadPromise;
        }
        const abortHandler = () => {
            for (let abortHandler of abortHandlers) {
                abortHandler();
            }
        };
        const loadingPromise = new AbortablePromise((resolve, reject) => {
            Promise.all(nativeLoadPromises)
            .then((splatBuffers) => {
                if (showLoadingUI) this.loadingSpinner.hide();
                if (onProgress) options.onProgress(0, '0%', LoaderStatus.Processing);
                this.addSplatBuffers(splatBuffers, sceneOptions, true, showLoadingUI, showLoadingUI).then(() => {
                    if (onProgress) onProgress(100, '100%', LoaderStatus.Processing);
                    resolve();
                    this.clearSplatSceneLoadPromise();
                });
            })
            .catch((e) => {
                if (showLoadingUI) this.loadingSpinner.hide();
                if (!(e instanceof AbortedPromiseError)) {
                    reject(new Error(`Viewer::addSplatScenes -> Could not load one or more splat scenes.`));
                } else {
                    resolve();
                }
                this.clearSplatSceneLoadPromise();
            })
            .finally(() => {
                for (let loadPromise of loadPromises) {
                    delete this.downloadPromisesToAbort[loadPromise.id];
                }
            });
        }, abortHandler);
        this.setSplatSceneLoadPromise(loadingPromise);
        return loadingPromise;
    }

    /**
     * Download a single non-streamed splat scene and convert to splat buffer. Also sets/clears relevant instance
     * synchronization objects, and calls appropriate functions on success or failure.
     * @param {string} path Path to splat scene to be loaded
     * @param {SceneFormat} format Format of the splat scene file
     * @param {number} splatAlphaRemovalThreshold Ignore any splats with an alpha less than the specified value (valid range: 0 - 255)
     * @param {function} onDownloadComplete Function to be called when download is complete
     * @param {function} onProgress Function to be called as file data are received, or other processing occurs
     * @param {function} onException Function to be called when exception occurs
     * @return {AbortablePromise}
     */
    loadSplatSceneToSplatBufferNonStreaming(path, format, splatAlphaRemovalThreshold, onDownloadComplete, onProgress, onException) {
        const clearDownloadPromise = () => {
            delete this.downloadPromisesToAbort[loadPromise.id];
        };

        const loadPromise = this.loadSplatSceneToSplatBuffer(path, splatAlphaRemovalThreshold, onProgress, false, undefined, format)
        .then((splatBuffer) => {
            clearDownloadPromise();
            return onDownloadComplete(splatBuffer, true, true).then(() => {
                this.clearSplatSceneLoadPromise();
            });
        })
        .catch((e) => {
            if (onException) onException();
            this.clearSplatSceneLoadPromise();
            clearDownloadPromise();
            if (!(e instanceof AbortedPromiseError)) {
                throw (new Error(`Viewer::addSplatScene -> Could not load file ${path}`));
            }
        });

        this.downloadPromisesToAbort[loadPromise.id] = loadPromise;
        this.setSplatSceneLoadPromise(loadPromise);

        return loadPromise;
    }

    /**
     * Download a single splat scene and convert to splat buffer in a streamed manner, allowing rendering as the file downloads.
     * Also sets/clears relevant instance synchronization objects, and calls appropriate functions on success or failure.
     * @param {string} path Path to splat scene to be loaded
     * @param {SceneFormat} format Format of the splat scene file
     * @param {number} splatAlphaRemovalThreshold Ignore any splats with an alpha less than the specified value (valid range: 0 - 255)
     * @param {function} onSectionDownloaded Function to be called as each streamed section is downloaded
     * @param {function} onProgress Function to be called as file data are received, or other processing occurs
     * @param {function} onException Function to be called when exception occurs
     * @return {AbortablePromise}
     */
    loadSplatSceneToSplatBufferStreaming(path, format, splatAlphaRemovalThreshold, onSectionDownloaded, onProgress, onException) {
        let firstStreamedSectionBuildResolver;
        let firstStreamedSectionBuildRejecter;
        let fullBuildResolver;
        let fullBuildRejecter;
        let steamedSectionBuildCount = 0;
        let streamedSectionBuilding = false;
        const queuedStreamedSectionBuilds = [];

        const checkAndBuildStreamedSections = () => {
            if (queuedStreamedSectionBuilds.length > 0 && !streamedSectionBuilding && !this.isDisposingOrDisposed()) {
                streamedSectionBuilding = true;
                const queuedBuild = queuedStreamedSectionBuilds.shift();
                onSectionDownloaded(queuedBuild.splatBuffer, queuedBuild.firstBuild, queuedBuild.finalBuild)
                .then(() => {
                    streamedSectionBuilding = false;
                    if (queuedBuild.firstBuild) {
                        firstStreamedSectionBuildResolver();
                    } else if (queuedBuild.finalBuild) {
                        fullBuildResolver();
                        this.clearSplatSceneLoadPromise();
                    }
                    window.setTimeout(() => {
                        checkAndBuildStreamedSections();
                    }, 1);
                });
            }
        };

        const onStreamedSectionProgress = (splatBuffer, finalBuild) => {
            if (!this.isDisposingOrDisposed()) {
                queuedStreamedSectionBuilds.push({
                    splatBuffer,
                    firstBuild: steamedSectionBuildCount === 0,
                    finalBuild
                });
                steamedSectionBuildCount++;
                checkAndBuildStreamedSections();
            }
        };

        let fullDownloadPromise = this.loadSplatSceneToSplatBuffer(path, splatAlphaRemovalThreshold,
                                                                   onProgress, true, onStreamedSectionProgress, format);

        const firstStreamedSectionBuildPromise = new AbortablePromise((resolver, rejecter) => {
            firstStreamedSectionBuildResolver = resolver;
            firstStreamedSectionBuildRejecter = rejecter;
            const clearDownloadPromise = () => {
                delete this.downloadPromisesToAbort[fullDownloadPromise.id];
            };
            fullDownloadPromise.then(() => {
                clearDownloadPromise();
            })
            .catch((e) => {
                if (!(e instanceof AbortedPromiseError)) {
                    fullBuildRejecter(e);
                    firstStreamedSectionBuildRejecter(e);
                }
                if (onException) onException();
                this.clearSplatSceneLoadPromise();
                clearDownloadPromise();
            });
        }, fullDownloadPromise.abortHandler);
        this.downloadPromisesToAbort[fullDownloadPromise.id] = fullDownloadPromise;

        this.setSplatSceneLoadPromise(new AbortablePromise((resolver, rejecter) => {
            fullBuildResolver = resolver;
            fullBuildRejecter = rejecter;
        }));

        return firstStreamedSectionBuildPromise;
    }

    /**
     * Download a splat scene and convert to SplatBuffer instance.
     * @param {string} path Path to splat scene to be loaded
     * @param {number} splatAlphaRemovalThreshold Ignore any splats with an alpha less than the specified
     *                                            value (valid range: 0 - 255), defaults to 1
     *
     * @param {function} onProgress Function to be called as file data are received
     * @param {boolean} streamBuiltSections Construct file sections into splat buffers as they are downloaded
     * @param {function} onSectionBuilt Function to be called when new section is added to the file
     * @param {string} format File format of the scene
     * @return {AbortablePromise}
     */
    loadSplatSceneToSplatBuffer(path, splatAlphaRemovalThreshold = 1, onProgress = undefined,
                                streamBuiltSections = false, onSectionBuilt = undefined, format) {
        if (format === SceneFormat.Splat) {
            return new SplatLoader().loadFromURL(path, onProgress, streamBuiltSections, onSectionBuilt,
                                                 0, splatAlphaRemovalThreshold, false);
        } else if (format === SceneFormat.KSplat) {
            return new KSplatLoader().loadFromURL(path, onProgress, streamBuiltSections,
                                                  onSectionBuilt, 0, splatAlphaRemovalThreshold);
        } else if (format === SceneFormat.Ply) {
            return new PlyLoader().loadFromURL(path, onProgress, 0, splatAlphaRemovalThreshold);
        }

        return AbortablePromise.reject(new Error(`Viewer::loadSplatSceneToSplatBuffer -> File format not supported: ${path}`));
    }

    static isStreamable(format) {
        return format === SceneFormat.Splat || format === SceneFormat.KSplat;
    }

    /**
     * Add one or more instances of SplatBuffer to the SplatMesh instance managed by the viewer and set up the sorting web worker.
     * This function will terminate the existing sort worker (if there is one).
     */
    addSplatBuffers = function() {

        let loadCount = 0;
        let splatProcessingTaskId = null;

        return function(splatBuffers, splatBufferOptions = [], finalBuild = true,
                        showLoadingUI = true, showLoadingSpinnerForSplatTreeBuild = true) {

            if (this.isDisposingOrDisposed()) return Promise.resolve();

            this.splatRenderingInitialized = false;
            loadCount++;

            const finish = (resolver) => {
                if (this.isDisposingOrDisposed()) return;

                loadCount--;
                if (loadCount === 0) {
                    if (splatProcessingTaskId !== null) {
                        this.loadingSpinner.removeTask(splatProcessingTaskId);
                        splatProcessingTaskId = null;
                    }
                    this.splatRenderingInitialized = true;
                }

                // If we aren't calculating the splat distances from the center on the GPU, the sorting worker needs splat centers and
                // transform indexes so that it can calculate those distance values.
                if (!this.gpuAcceleratedSort) {
                    const centers = this.integerBasedSort ? this.splatMesh.getIntegerCenters(true) : this.splatMesh.getFloatCenters(true);
                    const transformIndexes = this.splatMesh.getTransformIndexes();
                    this.sortWorker.postMessage({
                        'centers': centers.buffer,
                        'transformIndexes': transformIndexes.buffer
                    });
                }
                this.forceSort = true;
                resolver();
            };

            const performLoad = () => {
                return new Promise((resolve) => {
                    if (showLoadingUI) {
                        splatProcessingTaskId = this.loadingSpinner.addTask('Processing splats...');
                    }
                    delayedExecute(() => {
                        if (this.isDisposingOrDisposed()) {
                            resolve();
                        } else {
                            this.addSplatBuffersToMesh(splatBuffers, splatBufferOptions, finalBuild, showLoadingSpinnerForSplatTreeBuild);
                            const maxSplatCount = this.splatMesh.getMaxSplatCount();
                            if (this.sortWorker && this.sortWorker.maxSplatCount !== maxSplatCount) {
                                this.disposeSortWorker();
                            }
                            if (!this.sortWorker) {
                                this.setupSortWorker(this.splatMesh).then(() => {
                                    finish(resolve);
                                });
                            } else {
                                finish(resolve);
                            }
                        }
                    });
                });
            };

            return performLoad();
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
     * @param {boolean} finalBuild Will the splat mesh be in its final state after this build?
     * @param {boolean} showLoadingSpinnerForSplatTreeBuild Whether or not to show the loading spinner during
     *                                                      construction of the splat tree.
     */
    addSplatBuffersToMesh(splatBuffers, splatBufferOptions, finalBuild = true, showLoadingSpinnerForSplatTreeBuild = false) {
        if (this.isDisposingOrDisposed()) return;
        const allSplatBuffers = this.splatMesh.splatBuffers || [];
        const allSplatBufferOptions = this.splatMesh.splatBufferOptions || [];
        allSplatBuffers.push(...splatBuffers);
        allSplatBufferOptions.push(...splatBufferOptions);
        if (this.renderer) this.splatMesh.setRenderer(this.renderer);
        let splatOptimizingTaskId;
        const onSplatTreeIndexesUpload = (finished) => {
            if (this.isDisposingOrDisposed()) return;
            const splatCount = this.splatMesh.getSplatCount();
            if (showLoadingSpinnerForSplatTreeBuild && splatCount >= MIN_SPLAT_COUNT_TO_SHOW_SPLAT_TREE_LOADING_SPINNER) {
                if (!finished && !splatOptimizingTaskId) {
                    this.loadingSpinner.setMinimized(true, true);
                    splatOptimizingTaskId = this.loadingSpinner.addTask('Optimizing splats...');
                }
            }
        };
        const onSplatTreeConstructed = (finished) => {
            if (this.isDisposingOrDisposed()) return;
            if (finished && splatOptimizingTaskId) {
                this.loadingSpinner.removeTask(splatOptimizingTaskId);
            }
        };
        this.splatMesh.build(allSplatBuffers, allSplatBufferOptions, true, finalBuild,
                             onSplatTreeIndexesUpload, onSplatTreeConstructed);
        this.splatMesh.frustumCulled = false;
    }

    /**
     * Set up the splat sorting web worker.
     * @param {SplatMesh} splatMesh SplatMesh instance that contains the splats to be sorted
     * @return {Promise}
     */
    setupSortWorker(splatMesh) {
        if (this.isDisposingOrDisposed()) return;
        return new Promise((resolve) => {
            const DistancesArrayType = this.integerBasedSort ? Int32Array : Float32Array;
            const splatCount = splatMesh.getSplatCount();
            const maxSplatCount = splatMesh.getMaxSplatCount();
            this.sortWorker = createSortWorker(maxSplatCount, this.sharedMemoryForWorkers,
                                               this.integerBasedSort, this.splatMesh.dynamicMode);
            let sortCount = 0;
            this.sortWorker.onmessage = (e) => {
                if (e.data.sortDone) {
                    this.sortRunning = false;
                    if (this.sharedMemoryForWorkers) {
                        this.splatMesh.updateRenderIndexes(this.sortWorkerSortedIndexes, e.data.splatRenderCount);
                    } else {
                        const sortedIndexes = new Uint32Array(e.data.sortedIndexes.buffer, 0, e.data.splatRenderCount);
                        this.splatMesh.updateRenderIndexes(sortedIndexes, e.data.splatRenderCount);
                    }
                    this.lastSortTime = e.data.sortTime;
                    this.sortPromiseResolver();
                    this.sortPromise = null;
                    this.sortPromiseResolver = null;
                    if (sortCount === 0) {
                        this.runAfterFirstSort.forEach((func) => {
                            func();
                        });
                        this.runAfterFirstSort.length = 0;
                    }
                    sortCount++;
                } else if (e.data.sortCanceled) {
                    this.sortRunning = false;
                } else if (e.data.sortSetupPhase1Complete) {
                    console.log('Sorting web worker WASM setup complete.');
                    if (this.sharedMemoryForWorkers) {
                        this.sortWorkerSortedIndexes = new Uint32Array(e.data.sortedIndexesBuffer,
                                                                       e.data.sortedIndexesOffset, maxSplatCount);
                        this.sortWorkerIndexesToSort = new Uint32Array(e.data.indexesToSortBuffer,
                                                                       e.data.indexesToSortOffset, maxSplatCount);
                        this.sortWorkerPrecomputedDistances = new DistancesArrayType(e.data.precomputedDistancesBuffer,
                                                                                     e.data.precomputedDistancesOffset,
                                                                                     maxSplatCount);
                         this.sortWorkerTransforms = new Float32Array(e.data.transformsBuffer,
                                                                      e.data.transformsOffset, Constants.MaxScenes * 16);
                    } else {
                        this.sortWorkerIndexesToSort = new Uint32Array(maxSplatCount);
                        this.sortWorkerPrecomputedDistances = new DistancesArrayType(maxSplatCount);
                        this.sortWorkerTransforms = new Float32Array(Constants.MaxScenes * 16);
                    }
                    for (let i = 0; i < splatCount; i++) this.sortWorkerIndexesToSort[i] = i;
                    this.sortWorker.maxSplatCount = maxSplatCount;
                    resolve();
                } else if (e.data.sortSetupComplete) {
                    console.log('Sorting web worker ready.');
                    const splatDataTextures = this.splatMesh.getSplatDataTextures();
                    const covariancesTextureSize = splatDataTextures.covariances.size;
                    const centersColorsTextureSize = splatDataTextures.centerColors.size;
                    console.log('Covariances texture size: ' + covariancesTextureSize.x + ' x ' + covariancesTextureSize.y);
                    console.log('Centers/colors texture size: ' + centersColorsTextureSize.x + ' x ' + centersColorsTextureSize.y);
                }
            };
        });
    }

    /**
     * Start self-driven mode
     */
    start() {
        if (this.selfDrivenMode) {
            if (this.webXRMode) {
                this.renderer.setAnimationLoop(this.selfDrivenUpdateFunc);
            } else {
                this.requestFrameId = requestAnimationFrame(this.selfDrivenUpdateFunc);
            }
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
            if (!this.webXRMode) {
                cancelAnimationFrame(this.requestFrameId);
            }
            this.selfDrivenModeRunning = false;
        }
    }

    /**
     * Dispose of all resources held directly and indirectly by this viewer.
     */
    async dispose() {
        this.disposing = true;
        let waitPromises = [];
        let promisesToAbort = [];
        for (let promiseKey in this.downloadPromisesToAbort) {
            if (this.downloadPromisesToAbort.hasOwnProperty(promiseKey)) {
                const downloadPromiseToAbort = this.downloadPromisesToAbort[promiseKey];
                promisesToAbort.push(downloadPromiseToAbort);
                waitPromises.push(downloadPromiseToAbort.promise);
            }
        }
        if (this.sortPromise) {
            waitPromises.push(this.sortPromise);
        }
        const disposePromise = Promise.all(waitPromises).finally(() => {
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
            this.disposeSortWorker();
            this.removeEventHandlers();

            this.loadingSpinner.removeAllTasks();
            this.loadingSpinner.setContainer(null);
            this.loadingProgressBar.hide();
            this.loadingProgressBar.setContainer(null);
            this.infoPanel.setContainer(null);

            this.camera = null;
            this.threeScene = null;
            this.splatRenderingInitialized = false;
            this.initialized = false;
            if (this.renderer) {
                if (!this.usingExternalRenderer) {
                    this.rootElement.removeChild(this.renderer.domElement);
                    this.renderer.dispose();
                }
                this.renderer = null;
            }

            if (!this.usingExternalRenderer) {
                document.body.removeChild(this.rootElement);
            }

            this.sortWorkerSortedIndexes = null;
            this.sortWorkerIndexesToSort = null;
            this.sortWorkerPrecomputedDistances = null;
            this.sortWorkerTransforms = null;
            this.disposed = true;
            this.disposing = false;
        });
        promisesToAbort.forEach((toAbort) => {
            toAbort.abort();
        });
        return disposePromise;
    }

    selfDrivenUpdate() {
        if (this.selfDrivenMode && !this.webXRMode) {
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
        this.splatMesh.updateVisibleRegionFadeDistance();
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
            if (this.transitioningCameraTarget) {
                this.sceneHelper.setFocusMarkerVisibility(true);
                const currentFocusMarkerOpacity = Math.max(this.sceneHelper.getFocusMarkerOpacity(), 0.0);
                let newFocusMarkerOpacity = Math.min(currentFocusMarkerOpacity + FOCUS_MARKER_FADE_IN_SPEED * timeDelta, 1.0);
                this.sceneHelper.setFocusMarkerOpacity(newFocusMarkerOpacity);
                this.sceneHelper.updateFocusMarker(this.nextCameraTarget, this.camera, renderDimensions);
                wasTransitioning = true;
            } else {
                let currentFocusMarkerOpacity;
                if (wasTransitioning) currentFocusMarkerOpacity = 1.0;
                else currentFocusMarkerOpacity = Math.min(this.sceneHelper.getFocusMarkerOpacity(), 1.0);
                if (currentFocusMarkerOpacity > 0) {
                    this.sceneHelper.updateFocusMarker(this.nextCameraTarget, this.camera, renderDimensions);
                    let newFocusMarkerOpacity = Math.max(currentFocusMarkerOpacity - FOCUS_MARKER_FADE_OUT_SPEED * timeDelta, 0.0);
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
            const cameraLookAtPosition = this.controls ? this.controls.target : null;
            const meshCursorPosition = this.showMeshCursor ? this.sceneHelper.meshCursor.position : null;
            const splatRenderCountPct = this.splatRenderCount / splatCount * 100;
            this.infoPanel.update(renderDimensions, this.camera.position, cameraLookAtPosition,
                                  this.camera.up, meshCursorPosition, this.currentFPS, splatCount,
                                  this.splatRenderCount, splatRenderCountPct, this.lastSortTime);
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

        return async function() {
            if (this.sortRunning) return;
            if (!this.initialized || !this.splatRenderingInitialized) return;

            let angleDiff = 0;
            let positionDiff = 0;
            let needsRefreshForRotation = false;
            let needsRefreshForPosition = false;

            sortViewDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
            angleDiff = sortViewDir.dot(lastSortViewDir);
            positionDiff = sortViewOffset.copy(this.camera.position).sub(lastSortViewPos).length();

            if (!this.forceSort && !this.splatMesh.dynamicMode && queuedSorts.length === 0) {
                if (angleDiff <= 0.95) needsRefreshForRotation = true;
                if (positionDiff >= 1.0) needsRefreshForPosition = true;
                if (!needsRefreshForRotation && !needsRefreshForPosition) return;
            }

            this.sortRunning = true;
            const { splatRenderCount, shouldSortAll } = this.gatherSceneNodesForSort();
            this.splatRenderCount = splatRenderCount;
            this.sortPromise = new Promise((resolve) => {
                this.sortPromiseResolver = resolve;
            });

            mvpMatrix.copy(this.camera.matrixWorld).invert();
            mvpMatrix.premultiply(this.camera.projectionMatrix);
            mvpMatrix.multiply(this.splatMesh.matrixWorld);

            if (this.gpuAcceleratedSort && (queuedSorts.length <= 1 || queuedSorts.length % 2 === 0)) {
                await this.splatMesh.computeDistancesOnGPU(mvpMatrix, this.sortWorkerPrecomputedDistances);
            }

            if (this.splatMesh.dynamicMode || shouldSortAll) {
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
            let sortCount = Math.min(queuedSorts.shift(), this.splatRenderCount);

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

            this.forceSort = false;
        };

    }();

    /**
     * Determine which splats to render by checking which are inside or close to the view frustum
     */
    gatherSceneNodesForSort = function() {

        const nodeRenderList = [];
        let allSplatsSortBuffer = null;
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

        return function(gatherAllNodes = false) {

            this.getRenderDimensions(renderDimensions);
            const cameraFocalLength = (renderDimensions.y / 2.0) / Math.tan(this.camera.fov / 2.0 * THREE.MathUtils.DEG2RAD);
            const fovXOver2 = Math.atan(renderDimensions.x / 2.0 / cameraFocalLength);
            const fovYOver2 = Math.atan(renderDimensions.y / 2.0 / cameraFocalLength);
            const cosFovXOver2 = Math.cos(fovXOver2);
            const cosFovYOver2 = Math.cos(fovYOver2);

            const splatTree = this.splatMesh.getSplatTree();

            if (splatTree) {
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
                        if (!node.data || !node.data.indexes || node.data.indexes.length === 0) continue;
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
                        if (!gatherAllNodes && ((outOfFovX || outOfFovY ||
                             distanceToNode > MaximumDistanceToRender) && distanceToNode > ns)) {
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
                    let destView = new Uint32Array(this.sortWorkerIndexesToSort.buffer,
                                                   currentByteOffset - windowSizeBytes, windowSizeInts);
                    destView.set(node.data.indexes);
                    currentByteOffset -= windowSizeBytes;
                }

                return {
                    'splatRenderCount': splatRenderCount,
                    'shouldSortAll': false
                };
            } else {
                const totalSplatCount = this.splatMesh.getSplatCount();
                if (!allSplatsSortBuffer || allSplatsSortBuffer.length !== totalSplatCount) {
                    allSplatsSortBuffer = new Uint32Array(totalSplatCount);
                    for (let i = 0; i < totalSplatCount; i++) {
                        allSplatsSortBuffer[i] = i;
                    }
                }
                this.sortWorkerIndexesToSort.set(allSplatsSortBuffer);
                return {
                    'splatRenderCount': totalSplatCount,
                    'shouldSortAll': true
                };
            }
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
