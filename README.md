# 3D Gaussian splat viewer for for Three.js

This repository contains a Three.js-based implementation of [3D Gaussian Splatting for Real-Time Radiance Field Rendering](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/), a technique for the real-time visualization of real-world 3D scenes. I used Kevin Kwok's ([https://github.com/antimatter15](https://github.com/antimatter15)) WebGL implementation [https://github.com/antimatter15/splat](https://github.com/antimatter15/splat) as a starting point and used an ESM module approach to organize the code.

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
The demo scene data is available here: [projects.markkellogg.org/downloads/gaussian_splat_data.zip](projects.markkellogg.org/downloads/gaussian_splat_data.zip)
