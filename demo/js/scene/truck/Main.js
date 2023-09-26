import { OrbitControls } from '../../OrbitControls.js';
import { Scene } from './Scene.js';
import * as THREE from 'three';

const rootElement = document.querySelector('#root');

let camera;
let controls;
let scene;
let renderer;
let demoScene;

const onResize = () => {
    renderer.setSize(1, 1);
    const renderWidth = window.innerWidth;
    const renderHeight =  window.innerHeight;
    camera.aspect = renderWidth / renderHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(renderWidth, renderHeight);
};

function init() {
    const renderWidth = window.innerWidth;
    const renderHeight =  window.innerHeight;

    camera = new THREE.PerspectiveCamera(70, renderWidth / renderHeight, 0.1, 100);
    camera.position.set(0, 6, 0);

    scene = new THREE.Scene();

    renderer = new THREE.WebGLRenderer({
        antialias: true
    });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(renderWidth, renderHeight);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = (0.9 * Math.PI) / 2;
    controls.enableDamping = true;
    controls.dampingFactor = 0.15;

    window.addEventListener('resize', onResize, false);

    rootElement.appendChild(renderer.domElement);

    demoScene = new Scene(scene, camera, renderer);
    demoScene.load();
}

const animate = () => {
    requestAnimationFrame(animate);
};

init();