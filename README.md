# 3D Gaussian splatting for Three.js

Three.js-based implemetation of a renderer for [3D Gaussian Splatting for Real-Time Radiance Field Rendering](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/), a technique for generating 3D scenes from 2D images. Their project is CUDA-based and needs to run natively on your machine, but I wanted to build a viewer that was accessible via the web.

The 3D scenes are stored in a format similar to point clouds and can be viewed, navigated, and interacted with in real-time. This renderer will work with the `.ply` files generated by the INRIA project, standard `.splat` files, or my own custom `.ksplat` files, which are a trimmed-down and compressed version of the original `.ply` files.

When I started, web-based viewers were already available -- A WebGL-based viewer from [antimatter15](https://github.com/antimatter15/splat) and a WebGPU viewer from [cvlab-epfl](https://github.com/cvlab-epfl/gaussian-splatting-web) -- However no Three.js version existed. I used those versions as a starting point for my initial implementation, but as of now this project contains all my own code.
<br>
<br>
## Highlights

- Rendering is done entirely through Three.js
- Code is organized into modern ES modules
- Built-in viewer is self-contained so very little code is necessary to load and view a scene
- Viewer can import `.ply` files, `.splat` files, or my custom compressed `.ksplat` files
- Users can convert `.ply` or `.splat` files to the `.ksplat` file format
- Allows a Three.js scene or object group to be rendered along with the splats
- Built-in WebXR support
- Focus on optimization:
    - Splats culled prior to sorting & rendering using a custom octree
    - WASM splat sort: Implemented in C++ using WASM SIMD instructions
    - Partially GPU accelerated splat sort: Uses transform feedback to pre-calculate splat distances

## Known issues

- Splat sort runs on the CPU – would be great to figure out a GPU-based approach
- Artifacts are visible when you move or rotate too fast (due to CPU-based splat sort)
- Sub-optimal performance on mobile devices
- Custom `.ksplat` file format still needs work, especially around compression
- The default, integer based splat sort does not work well for larger scenes. In that case a value of `false` for the `integerBasedSort` viewer parameter can force a slower, floating-point based sort

## Future work
This is still very much a work in progress! There are several things that still need to be done:
  - Improve the method by which splat data is stored in textures
  - Properly incorporate spherical harmonics data to achieve view dependent lighting effects
  - Continue optimizing CPU-based splat sort - maybe try an incremental sort of some kind?
  - Add editing mode, allowing users to modify scene and export changes
  - Support very large scenes

## Online demo
[https://projects.markkellogg.org/threejs/demo_gaussian_splats_3d.php](https://projects.markkellogg.org/threejs/demo_gaussian_splats_3d.php)

## Controls
Mouse
- Left click to set the focal point
- Left click and drag to orbit around the focal point
- Right click and drag to pan the camera and focal point
  
Keyboard
- `C` Toggles the mesh cursor, showing the intersection point of a mouse-projected ray and the splat mesh

- `I` Toggles an info panel that displays debugging info:
  - Camera position
  - Camera focal point/look-at point
  - Camera up vector
  - Mesh cursor position
  - Current FPS
  - Renderer window size
  - Ratio of rendered splats to total splats
  - Last splat sort duration

- `P` Toggles a debug object that shows the orientation of the camera controls. It includes a green arrow representing the camera's orbital axis and a white square representing the plane at which the camera's elevation angle is 0.

- `Left arrow` Rotate the camera's up vector counter-clockwise

- `Right arrow` Rotate the camera's up vector clockwise

<br>

## Building from source and running locally
Navigate to the code directory and run
```
npm install
```
Next run the build. For Linux & Mac OS systems run:
```
npm run build
```
For Windows I have added a Windows-compatible version of the build command:
```
npm run build-windows
```
To view the demo scenes locally run
```
npm run demo
```
The demo will be accessible locally at [http://127.0.0.1:8080/index.html](http://127.0.0.1:8080/index.html). You will need to download the data for the demo scenes and extract them into 
```
<code directory>/build/demo/assets/data
```
The demo scene data is available here: [https://projects.markkellogg.org/downloads/gaussian_splat_data.zip](https://projects.markkellogg.org/downloads/gaussian_splat_data.zip)
<br>
<br>

## Installing as an NPM package
If you don't want to build the library from source, it is also available as an NPM package. The NPM package does not come with the source code or demos that are available in the source repository. To install, run the following command:
```
npm install @mkkellogg/gaussian-splats-3d
```

<br>

## Basic Usage

To run the built-in viewer:

```javascript
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

const viewer = new GaussianSplats3D.Viewer({
    'cameraUp': [0, -1, -0.6],
    'initialCameraPosition': [-1, -4, 6],
    'initialCameraLookAt': [0, 4, 0]
});
viewer.addSplatScene('<path to .ply, .ksplat, or .splat file>', {
    'splatAlphaRemovalThreshold': 5,
    'showLoadingSpinner': true,
    'position': [0, 1, 0],
    'rotation': [0, 0, 0, 1],
    'scale': [1.5, 1.5, 1.5]
})
.then(() => {
    viewer.start();
});

```
Viewer parameters
<br>

| Parameter | Purpose
| --- | ---
| `cameraUp` | The natural 'up' vector for viewing the scene (only has an effect when used with orbit controls and when the viewer uses its own camera). Serves as the axis around which the camera will orbit, and is used to determine the scene's orientation relative to the camera.
| `initialCameraPosition` | The camera's initial position (only used when the viewer uses its own camera).
| `initialCameraLookAt` | The initial focal point of the camera and center of the camera's orbit (only used when the viewer uses its own camera).
<br>

Parameters for `addSplatScene()`
<br>

| Parameter | Purpose
| --- | ---
| `splatAlphaRemovalThreshold` | Tells `addSplatScene()` to ignore any splats with an alpha less than the specified value (valid range: 0 - 255). Defaults to `1`.
| `showLoadingSpinner` | Displays a loading spinner while the scene is loading.  Defaults to `true`.
| `position` | Position of the scene, acts as an offset from its default position. Defaults to `[0, 0, 0]`.
| `rotation` | Rotation of the scene represented as a quaternion, defaults to `[0, 0, 0, 1]` (identity quaternion).
| `scale` | Scene's scale, defaults to `[1, 1, 1]`.

<br>

`Viewer` can also load multiple scenes simultaneously with the `addSplatScenes()` function:
```javascript
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

viewer.addSplatScenes([{
        'path': '<path to first .ply, .ksplat, or .splat file>',
        'splatAlphaRemovalThreshold': 20
    },
    {
        'path': '<path to second .ply, .ksplat, or .splat file>',
        'rotation': [-0.14724434, -0.0761755, 0.1410657, 0.976020],
        'scale': [1.5, 1.5, 1.5],
        'position': [-3, -2, -3.2]
    }
])
.then(() => {
    viewer.start();
});
```

The `addSplatScene()` and `addSplatScenes()` methods will accept the original `.ply` files, standard `.splat` files, and my custom `.ksplat` files.

<br>

### Integrating THREE.js scenes
You can integrate your own Three.js scene into the viewer if you want rendering to be handled for you. Just pass a Three.js scene object as the `threeScene` parameter to the constructor:
```javascript
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import * as THREE from 'three';

const threeScene = new THREE.Scene();
const boxColor = 0xBBBBBB;
const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
const boxMesh = new THREE.Mesh(boxGeometry, new THREE.MeshBasicMaterial({'color': boxColor}));
boxMesh.position.set(3, 2, 2);
threeScene.add(boxMesh);

const viewer = new GaussianSplats3D.Viewer({
    'threeScene': threeScene,
});
viewer.addSplatScene('<path to .ply, .ksplat, or .splat file>')
.then(() => {
    viewer.start();
});
```

Currently this will only work for objects that write to the depth buffer (e.g. standard opaque objects). Supporting transparent objects will be more challenging :)
<br>

A "drop-in" mode for the viewer is also supported. The `DropInViewer` class encapsulates `Viewer` and can be added to a Three.js scene like any other renderable:
```javascript
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import * as THREE from 'three';

const threeScene = new THREE.Scene();
const viewer = new GaussianSplats3D.DropInViewer({
    'gpuAcceleratedSort': true
});
viewer.addSplatScenes([{
        'path': '<path to .ply, .ksplat, or .splat file>'
        'splatAlphaRemovalThreshold': 5
    },
    {
        'path': '<path to .ply, .ksplat, or .splat file>',
        'rotation': [0, -0.857, -0.514495, 6.123233995736766e-17],
        'scale': [1.5, 1.5, 1.5],
        'position': [0, -2, -1.2]
    }
]);
threeScene.add(viewer);

```
<br>

### Advanced options
The viewer allows for various levels of customization via constructor parameters. You can control when its `update()` and `render()` methods are called by passing `false` for the `selfDrivenMode` parameter and then calling those methods whenever/wherever you decide is appropriate. You can also use your own camera controls, as well as an your own instance of a Three.js `Renderer` or `Camera` The sample below shows all of these options:

```javascript
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import * as THREE from 'three';

const renderWidth = 800;
const renderHeight = 600;

const rootElement = document.createElement('div');
rootElement.style.width = renderWidth + 'px';
rootElement.style.height = renderHeight + 'px';
document.body.appendChild(rootElement);

const renderer = new THREE.WebGLRenderer({
    antialias: false
});
renderer.setSize(renderWidth, renderHeight);
rootElement.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(65, renderWidth / renderHeight, 0.1, 500);
camera.position.copy(new THREE.Vector3().fromArray([-1, -4, 6]));
camera.up = new THREE.Vector3().fromArray([0, -1, -0.6]).normalize();
camera.lookAt(new THREE.Vector3().fromArray([0, 4, -0]));

const viewer = new GaussianSplats3D.Viewer({
    'selfDrivenMode': false,
    'renderer': renderer,
    'camera': camera,
    'useBuiltInControls': false,
    'ignoreDevicePixelRatio': false,
    'gpuAcceleratedSort': true,
    'halfPrecisionCovariancesOnGPU': true,
    'sharedMemoryForWorkers': true,
    'integerBasedSort': true,
    'dynamicScene': false,
    'webXRMode': GaussianSplats3D.WebXRMode.None
});
viewer.addSplatScene('<path to .ply, .ksplat, or .splat file>')
.then(() => {
    requestAnimationFrame(update);
});
```
Since `selfDrivenMode` is false, it is up to the developer to call the `update()` and `render()` methods on the `Viewer` class:
```javascript
function update() {
    requestAnimationFrame(update);
    viewer.update();
    viewer.render();
}
```
Advanced `Viewer` parameters
<br>
| Parameter | Purpose
| --- | ---
| `selfDrivenMode` | If `false`, tells the viewer that you will manually call its `update()` and `render()` methods. Defaults to `true`.
| `useBuiltInControls` | Tells the viewer to use its own camera controls. Defaults to `true`.
| `renderer` | Pass an instance of a Three.js `Renderer` to the viewer, otherwise it will create its own. Defaults to `undefined`.
| `camera` | Pass an instance of a Three.js `Camera` to the viewer, otherwise it will create its own. Defaults to `undefined`.
| `ignoreDevicePixelRatio` | Tells the viewer to pretend the device pixel ratio is 1, which can boost performance on devices where it is larger, at a small cost to visual quality. Defaults to `false`.
| `gpuAcceleratedSort` | Tells the viewer to use a partially GPU-accelerated approach to sorting splats. Currently this means pre-computation of splat distances from the camera is performed on the GPU. It is recommended that this only be set to `true` when `sharedMemoryForWorkers` is also `true`. Defaults to `false` on mobile devices, `true` otherwise.
| `halfPrecisionCovariancesOnGPU` | Tells the viewer to use 16-bit floating point values when storing splat covariance data in textures, instead of 32-bit. Defaults to `true`.
| `sharedMemoryForWorkers` | Tells the viewer to use shared memory via a `SharedArrayBuffer` to transfer data to and from the sorting web worker. If set to `false`, it is recommended that `gpuAcceleratedSort` be set to `false` as well. Defaults to `true`.
| `integerBasedSort` | Tells the sorting web worker to use the integer versions of relevant data to compute the distance of splats from the camera. Since integer arithmetic is faster than floating point, this reduces sort time. However it can result in integer overflows in larger scenes so it should only be used for small scenes. Defaults to `true`.
| `dynamicScene` | Tells the viewer to not make any optimizations that depend on the scene being static. Additionally all splat data retrieved from the viewer's splat mesh will not have their respective scene transform applied to them by default.
| `webXRMode` | Tells the viewer whether or not to enable built-in Web VR or Web AR. Valid values are defined in the `WebXRMode` enum: `None`, `VR`, and `AR`. Defaults to `None`.
<br>

### Creating KSPLAT files
To convert a `.ply` or `.splat` file into the stripped-down and compressed `.ksplat` format, there are several options. The easiest method is to use the UI in the main demo page at [http://127.0.0.1:8080/index.html](http://127.0.0.1:8080/index.html). If you want to run the conversion programatically, run the following in a browser:

```javascript
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

const compressionLevel = 1;
const splatAlphaRemovalThreshold = 5; // out of 255
const plyLoader = new GaussianSplats3D.PlyLoader();
plyLoader.loadFromURL('<path to .ply or .splat file>', compressionLevel, splatAlphaRemovalThreshold)
.then((splatBuffer) => {
    new GaussianSplats3D.SplatLoader(splatBuffer).downloadFile('converted_file.ksplat');
});
```
Both of the above methods will prompt your browser to automatically start downloading the converted `.ksplat` file.

The third option is to use the included nodejs script:

```
node util/create-ksplat.js [path to .PLY or .SPLAT] [output file] [compression level = 0] [alpha removal threshold = 1]
```

Currently supported values for `compressionLevel` are `0` or `1`. `0` means no compression, `1` means compression of scale, rotation, and position values from 32-bit to 16-bit.
<br>

### Loading PLY Compressed By Playcanvas
The `.ply` files generated by Playcanvas are compressed and need to be decompressed before they can be loaded. The `CompressedPlyParser` class has a method for this:

https://playcanvas.com/supersplat/editor use the following to create a compressed ply file

```javascript
const parser = new GaussianSplats3D.CompressedPlyParser();
await parser.readPly(splatBufferData);
const ply = parser.decompress(0, alphaRemovalThreshold, 5.0, 256);
const splatBuffer = fileBufferToSplatBuffer(ply.buffer, false, true, 0, alphaRemovalThreshold);

const splatBufferOptions = {
    'splatAlphaRemovalThreshold': alphaRemovalThreshold
};
const viewerOptions = {
    'cameraUp': cameraUpArray,
    'initialCameraPosition': cameraPositionArray,
    'initialCameraLookAt': cameraLookAtArray,
    'halfPrecisionCovariancesOnGPU': true,
};

document.getElementById("demo-content").style.display = 'none';
document.body.style.backgroundColor = "#000000";
history.pushState("ViewSplat", null);

const viewer = new GaussianSplats3D.Viewer(viewerOptions);
viewer
    .addSplatBuffers([splatBuffer], [splatBufferOptions])
    .then(() => {
        viewer.start();
    });     
```

### CORS issues and SharedArrayBuffer
By default, the `Viewer` class uses shared memory (via a typed array backed by a `SharedArrayBufffer`) to communicate with the web worker that sorts the splats. This mechanism presents a potential security issue that is outlined here: https://web.dev/articles/cross-origin-isolation-guide. Shared memory can be disabled by passing `false` for the `sharedMemoryForWorkers` parameter to the constructor for `Viewer`, but if you want to leave it enabled, a couple of extra CORS HTTP headers need to be present in the response from the server that is sent when loading the application. Without those headers set, you might see an error like the following in the debug console:

```
"DOMException: Failed to execute 'postMessage' on 'DedicatedWorkerGlobalScope': SharedArrayBuffer transfer requires self.crossOriginIsolated."
```

For the local demo I created a simple HTTP server (util/server.js) that sets those headers:

```
response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
```

If you're using Apache, you can edit the `.htaccess` file to do that by adding the lines:

```
Header add Cross-Origin-Opener-Policy "same-origin"
Header add Cross-Origin-Embedder-Policy "require-corp"
```

For other web servers, these headers most likely can be set in a similar fashion.

Additionally you may need to require a secure connection to your server by redirecting all access via `http://` to `https://`. In Apache this can be done by updating the `.htaccess` file with the following lines:

```
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule (.*) https://%{HTTP_HOST}%{REQUEST_URI} [R,L]
```
