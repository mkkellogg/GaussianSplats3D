# 3D Gaussian splat viewer for for Three.js

This repository contains a Three.js-based implementation of [3D Gaussian Splatting for Real-Time Radiance Field Rendering](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/), a technique for the real-time visualization of real-world 3D scenes. For the initial implementation, I used Kevin Kwok's ([https://github.com/antimatter15](https://github.com/antimatter15)) WebGL implementation [https://github.com/antimatter15/splat](https://github.com/antimatter15/splat) as a starting point. As of now, almost all of the code has been rewritten to use ES modules for code organiztion and Three.js for rendering.

Online demo: [https://projects.markkellogg.org/threejs/demo_gaussian_splats_3d.php](https://projects.markkellogg.org/threejs/demo_gaussian_splats_3d.php)

This is still very much a work in progress! There are several things that still need to be done:
  - Improve the method by which splat data (position, covariance, color) is stored in textures (currently much texture space is wasted or packed inefficiently)
  - Properly incorporate spherical harmonics data to achieve view dependent lighting effects
  - Improve the layout of the SplatBuffer object for better efficiency and reduced file size
  - Improve splat sorting -- maybe an incremental sort of some kind?
  - Implement fully shared memory for transferring splat indexes to the WASM worker along with double buffering so that the next splat index array in the main thread can be filled while the current one is sorted in the worker thread

## Building
Navigate to the code directory and run
```
npm install
```
Followed by
```
npm run build
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

## Usage

To run the built-in viewer:

```javascript
const cameraUp =  [0, -1, -1.0];
const initialCameraPos = [-3.3816, 1.96931, -1.71890];
const initialCameraLookAt = [0.60910, 1.42099, 2.02511];
const viewer = new GaussianSplat3D.Viewer(null, cameraUp, initialCameraPos, initialCameraLookAt);
viewer.init();
viewer.loadFile('<path to .ply or .splat file>')
.then(() => {
    viewer.start();
});
```

The `loadFile()` method will accept the original `.ply` files as well as my custom `.splat` files.

To convert a `.ply` file into the stripped-down `.splat` format (currently only compatible with this viewer):

```javascript
const plyLoader = new GaussianSplat3D.PlyLoader();
plyLoader.loadFromFile('<path to .ply file>')
.then((splatBuffer) => {
    new GaussianSplat3D.SplatLoader(splatBuffer).saveToFile('converted_file.splat');
});
```
This code will prompt your browser to automatically start downloading the converted `.splat` file.
