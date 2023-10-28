# 3D Gaussian splatting for Three.js

This repository contains a Three.js-based implementation of [3D Gaussian Splatting for Real-Time Radiance Field Rendering](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/), a technique for the real-time visualization of real-world 3D scenes. Their project was CUDA-based and I wanted to build a viewer that was accessible via the web.

When I started, web-based viewers were already available -- A WebGL-based viewer from [antimatter15](https://github.com/antimatter15/splat) and a WebGPU viewer from [cvlab-epfl](https://github.com/cvlab-epfl/gaussian-splatting-web) -- However no Three.js version existed. I used those versions as a starting point for my initial implementation, but as of now this project contains all my own code.
<br>
<br>
## Highlights
 - Organized into ES modules
 - Rendering is done entirely through Three.js
 - The sorting algorithm is a C++ counting sort contained in a WASM module.
 - Rasterization code is documented to describe 2D covariance computations as well as computations of corresponding eigen-values and eigen-vectors
 - Scene is partitioned via octree that is used to cull non-visible splats prior to sorting
 - Splat data (position, covariance, color) is stored via textures so that only splat indexes are transferred between host and GPU
 - Allows a Three.js scene or object group to be rendered along with the splats
## Future work
This is still very much a work in progress! There are several things that still need to be done:
  - Improve the method by which splat data is stored in textures
  - Properly incorporate spherical harmonics data to achieve view dependent lighting effects
  - Continue improving compression for splat files
  - Improve splat sorting -- maybe an incremental sort of some kind?
  - Implement double buffering so that the next splat index array in the main thread can be filled while the current one is sorted in the worker thread
  - Add editing mode, allowing users to modify scene and export changes
  - Add WebXR compatibility
  - Support very large scenes and/or multiple splat files

## Online demo
[https://projects.markkellogg.org/threejs/demo_gaussian_splats_3d.php](https://projects.markkellogg.org/threejs/demo_gaussian_splats_3d.php)

<br>

## Building and running locally
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
## Usage

To run the built-in viewer:

```javascript
const viewer = new GaussianSplat3D.Viewer({
  'cameraUp': [0, -1, -0.6],
  'initialCameraPosition': [-1, -4, 6],
  'initialCameraLookAt': [0, 4, 0]
});
viewer.init();
viewer.loadFile('<path to .ply or .splat file>', {
    'splatAlphaRemovalThreshold': 5, // out of 255
    'halfPrecisionCovariancesOnGPU': true
})
.then(() => {
    viewer.start();
});
```
As an alternative to using `cameraUp` to adjust to the scene's natural orientation, you can pass an orientation (and/or position) to the `loadFile()` method to transform the entire scene:
```javascript
const viewer = new GaussianSplat3D.Viewer({
    'initialCameraPosition': [-1, -4, 6],
    'initialCameraLookAt': [0, 4, 0]
});
const orientation = new THREE.Quaternion();
orientation.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0.6).normalize());
viewer.init();
viewer.loadFile('<path to .ply or .splat file>', {
    'splatAlphaRemovalThreshold': 5, // out of 255
    'halfPrecisionCovariancesOnGPU': true,
    'position': [0, 0, 0],
    'orientation': orientation.toArray(),
})
.then(() => {
    viewer.start();
});
```

The `loadFile()` method will accept the original `.ply` files as well as my custom `.splat` files.
<br>
<br>
### Creating SPLAT files
To convert a `.ply` file into the stripped-down `.splat` format (currently only compatible with this viewer), run the following in a browser:

```javascript
const compressionLevel = 1;
const splatAlphaRemovalThreshold = 5;
const plyLoader = new GaussianSplat3D.PlyLoader();
plyLoader.loadFromURL('<URL for .ply file>', compressionLevel, splatAlphaRemovalThreshold)
.then((splatBuffer) => {
    new GaussianSplat3D.SplatLoader(splatBuffer).saveToFile('converted_file.splat');
});
```
This code will prompt your browser to automatically start downloading the converted `.splat` file.

To convert a .PLY file on your machine, run the included nodejs script:

```
node util/create-splat.js [path to .PLY] [output file] [compression level = 0] [alpha removal threshold = 1]
```

Currently supported values for `compressionLevel` are `0` or `1`. `0` means no compression, `1` means compression of scale, rotation, and position values from 32-bit to 16-bit.
<br>
<br>
### Integrating THREE.js scenes
It is now possible to integrate your own Three.js scene into the viewer (still somewhat experimental). The `Viewer` class now accepts two parameters by which you can pass in any 'normal' Three.js objects you want to be rendered along with the splats: `scene` and/or `simpleScene`. Rendering the splats correctly with external objects requires a special sequence of steps so the viewer needs to be aware of them:
```javascript
const scene = new THREE.Scene();

const boxColor = 0xBBBBBB;
const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
const boxMesh = new THREE.Mesh(boxGeometry, new THREE.MeshBasicMaterial({'color': boxColor}));
scene.add(boxMesh);
boxMesh.position.set(3, 2, 2);

const viewer = new GaussianSplat3D.Viewer({
  'scene': scene,
  'cameraUp': [0, -1, -0.6],
  'initialCameraPosition': [-1, -4, 6],
  'initialCameraLookAt': [0, 4, -0]
});
viewer.init();
viewer.loadFile('<path to .ply or .splat file>')
.then(() => {
    viewer.start();
});
```
The difference between the `scene` and `simpleScene` parameters is a matter of optimization. Objects contained in `scene` will have their depths rendered using their standard shader, but objects contained in `simpleScene` will have their depths rendered using a very simple override shader.

The viewer allows for various levels of customization via constructor parameters. You can control when its `update()` and `render()` methods are called by passing `false` for the `selfDrivenMode` parameter and then calling those methods whenever/wherever you decide is appropriate. You can tell the viewer to not use its built-in camera controls by passing `false` for the `useBuiltInControls` parameter. You can also use your own Three.js renderer and camera by passing those values to the viewer's constructor. The sample below shows all of these options:

```javascript
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
camera.lookAt(new THREE.Vector3().fromArray([0, 4, -0]));
camera.up = new THREE.Vector3().fromArray([0, -1, -0.6]).normalize();

const viewer = new GaussianSplat3D.Viewer({
    'selfDrivenMode': false,
    'renderer': renderer,
    'camera': camera,
    'useBuiltInControls': false
});
viewer.init();
viewer.loadFile('<path to .ply or .splat file>')
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
## Controls
Mouse
- Left click and drag to orbit around the focal point
- Right click and drag to pan the camera and focal point
  
Keyboard
- `C` Toggles the mesh cursor, which shows where a ray projected from the mouse cursor intersects the splat mesh

- `I` Toggles an info panel that displays the mesh cursor position, current FPS, and current window size
