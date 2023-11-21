import * as THREE from 'three';
import { getCurrentTime } from './Util.js';

export class Editor {
  constructor(viewer, options = {}) {
    this.viewer = viewer;

    this.editPanel = null;

    this.pointerUpHandlerPlaneFinder = this.onPointerUpPlaneFinder.bind(this);

    this.initialized = false;
    this.init();
  }

  init() {
    if (this.initialized) return;

    this.setupEditPanel();

    this.initialized = true;
  }

  setupEditPanel() {
    this.editPanel = document.createElement('div');
    this.editPanel.style.position = 'absolute';
    this.editPanel.style.padding = '10px';
    this.editPanel.style.backgroundColor = '#cccccc';
    this.editPanel.style.border = '#aaaaaa 1px solid';
    this.editPanel.style.zIndex = 90;
    this.editPanel.style.width = '375px';
    this.editPanel.style.fontFamily = 'arial';
    this.editPanel.style.fontSize = '10pt';
    this.editPanel.style.textAlign = 'left';


    const editTable = document.createElement('div');
    editTable.style.width = '100%';


    // Plane Finder
    const planeFinder = document.createElement('div');
    planeFinder.style.width = '100%';
    planeFinder.style.display = 'flex';
    planeFinder.style.flexDirection = 'row';
    planeFinder.style.justifyContent = 'space-between';

    const planeFinderLabel = document.createElement('p');
    planeFinderLabel.id = 'planeFinderLabel';
    planeFinderLabel.innerHTML =
      `Up: ${this.viewer.camera.up.x.toFixed(3)}, ${this.viewer.camera.up.y.toFixed(3)}, ${this.viewer.camera.up.z.toFixed(3)}`;

    const planeFinderButton = document.createElement('button');
    planeFinderButton.innerHTML = 'Find ground plane';
    planeFinderButton.addEventListener('click', () => {
      this.setupPlaneFinder();
    });

    planeFinder.appendChild(planeFinderLabel);
    planeFinder.appendChild(planeFinderButton);

    editTable.appendChild(planeFinder);

    this.editPanel.appendChild(editTable);
    this.editPanel.style.display = 'block';
    this.viewer.renderer.domElement.parentElement.prepend(this.editPanel);
  }

  setupPlaneFinder() {
    if (this.viewer.useBuiltInControls) {
      this.viewer.rootElement.removeEventListener('pointerup', this.viewer.pointerUpHandler);
      this.viewer.rootElement.addEventListener('pointerup', this.pointerUpHandlerPlaneFinder);
    }
  }

  teardownPlaneFinder() {
    if (this.viewer.useBuiltInControls) {
      this.viewer.rootElement.removeEventListener('pointerup', this.pointerUpHandlerPlaneFinder);
      this.viewer.rootElement.addEventListener('pointerup', this.viewer.pointerUpHandler);
    }
  }

  onPointerUpPlaneFinder = function() {
    const renderDimensions = new THREE.Vector2();
    const clickOffset = new THREE.Vector2();
    // const toNewFocalPoint = new THREE.Vector3();
    const outHits = [];
    let points = [];

    return function(mouse) {
      clickOffset.copy(this.viewer.mousePosition).sub(this.viewer.mouseDownPosition);
      const mouseUpTime = getCurrentTime();
      const wasClick = mouseUpTime - this.viewer.mouseDownTime < 0.5 && clickOffset.length() < 2;

      if (!this.transitioningCameraTarget && wasClick) {
        this.viewer.getRenderDimensions(renderDimensions);
        outHits.length = 0;
        this.viewer.raycaster.setFromCameraAndScreenPosition(this.viewer.camera, this.viewer.mousePosition, renderDimensions);
        this.viewer.mousePosition.set(mouse.offsetX, mouse.offsetY);
        this.viewer.raycaster.intersectSplatMesh(this.viewer.splatMesh, outHits);

        if (outHits.length > 0) {
          const intersectionPoint = outHits[0].origin;

          points.push(intersectionPoint);

          if (points.length === 3) {
            const plane = new THREE.Plane();

            plane.setFromCoplanarPoints(points[0], points[1], points[2]);

            this.viewer.camera.up = plane.normal;
            this.viewer.invalidate();

            // Update label
            const planeFinderLabel = document.getElementById('planeFinderLabel');
            planeFinderLabel.innerHTML =
              `${this.viewer.camera.up.x.toFixed(3)},${this.viewer.camera.up.y.toFixed(3)},${this.viewer.camera.up.z.toFixed(3)}`;

            points = [];
            this.teardownPlaneFinder();
          }
        }
      }
    };
  }();
}
