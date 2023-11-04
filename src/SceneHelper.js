import * as THREE from 'three';

export class SceneHelper {

    constructor(scene, simpleScene) {
        this.scene = scene;
        this.simpleScene = simpleScene;
        this.meshCursor = null;
        this.focusMarker = null;
    }

    setupMeshCursor() {
        if (!this.meshCursor) {
            const coneGeometry = new THREE.ConeGeometry(0.5, 1.5, 32);
            const coneMaterial = new THREE.MeshBasicMaterial({color: 0xFFFFFF});

            const downArrow = new THREE.Mesh(coneGeometry, coneMaterial);
            downArrow.rotation.set(0, 0, Math.PI);
            downArrow.position.set(0, 1, 0);
            const upArrow = new THREE.Mesh(coneGeometry, coneMaterial);
            upArrow.position.set(0, -1, 0);
            const leftArrow = new THREE.Mesh(coneGeometry, coneMaterial);
            leftArrow.rotation.set(0, 0, Math.PI / 2.0);
            leftArrow.position.set(1, 0, 0);
            const rightArrow = new THREE.Mesh(coneGeometry, coneMaterial);
            rightArrow.rotation.set(0, 0, -Math.PI / 2.0);
            rightArrow.position.set(-1, 0, 0);

            this.meshCursor = new THREE.Object3D();
            this.meshCursor.add(downArrow);
            this.meshCursor.add(upArrow);
            this.meshCursor.add(leftArrow);
            this.meshCursor.add(rightArrow);
            this.meshCursor.scale.set(0.1, 0.1, 0.1);
            this.simpleScene.add(this.meshCursor);
            this.meshCursor.visible = false;
        }
    }

    destroyMeshCursor() {
        if (this.meshCursor) {
            this.meshCursor.children.forEach((child) => {
                child.geometry.dispose();
                child.material.dispose();
            });
            this.simpleScene.remove(this.meshCursor);
            this.meshCursor = null;
        }
    }

    setMeshCursorVisibility(visible) {
        this.meshCursor.visible = visible;
    }

    setMeshCursorPosition(position) {
        this.meshCursor.position.copy(position);
    }

    positionAndOrientMeshCursor(position, camera) {
        this.meshCursor.position.copy(position);
        this.meshCursor.up.copy(camera.up);
        this.meshCursor.lookAt(camera.position);
    }

    setupFocusMarker() {
        if (!this.focusMarker) {
            const sphereGeometry = new THREE.SphereGeometry(.5, 32, 32);
            const focusMarkerMaterial = SceneHelper.buildFocusMarkerMaterial();
            focusMarkerMaterial.depthTest = false;
            focusMarkerMaterial.depthWrite = false;
            focusMarkerMaterial.transparent = true;
            const sphereMesh = new THREE.Mesh(sphereGeometry, focusMarkerMaterial);
            this.focusMarker = sphereMesh;
        }
    }

    updateFocusMarker = function() {

        const tempPosition = new THREE.Vector3();
        const tempMatrix = new THREE.Matrix4();

        return function(position, camera, viewport) {
            tempMatrix.copy(camera.matrixWorld).invert();
            tempPosition.copy(position).applyMatrix4(tempMatrix);
            tempPosition.normalize().multiplyScalar(10);
            tempPosition.applyMatrix4(camera.matrixWorld);
            this.focusMarker.position.copy(tempPosition);
            this.focusMarker.material.uniforms.viewport.value.copy(viewport);
            this.focusMarker.material.uniformsNeedUpdate = true;
        };

    }();

    setFocusMarkerVisibility(visible) {
        this.focusMarker.visible = visible;
    }


    addDebugMeshes() {
        this.debugRoot = this.createDebugMeshes();
        this.secondaryDebugRoot = this.createSecondaryDebugMeshes();
        this.simpleScene.add(this.debugRoot);
        this.simpleScene.add(this.secondaryDebugRoot);
    }

    createDebugMeshes(renderOrder) {
        const sphereGeometry = new THREE.SphereGeometry(1, 32, 32);
        const debugMeshRoot = new THREE.Object3D();

        const createMesh = (color, position) => {
            let sphereMesh = new THREE.Mesh(sphereGeometry, SceneHelper.buildDebugMaterial(color));
            sphereMesh.renderOrder = renderOrder;
            debugMeshRoot.add(sphereMesh);
            sphereMesh.position.fromArray(position);
        };

        createMesh(0xff0000, [-50, 0, 0]);
        createMesh(0xff0000, [50, 0, 0]);
        createMesh(0x00ff00, [0, 0, -50]);
        createMesh(0x00ff00, [0, 0, 50]);
        createMesh(0xffaa00, [5, 0, 5]);

        return debugMeshRoot;
    }

    createSecondaryDebugMeshes(renderOrder) {
        const boxGeometry = new THREE.BoxGeometry(3, 3, 3);
        const debugMeshRoot = new THREE.Object3D();

        let boxColor = 0xBBBBBB;
        const createMesh = (position) => {
            let boxMesh = new THREE.Mesh(boxGeometry, SceneHelper.buildDebugMaterial(boxColor));
            boxMesh.renderOrder = renderOrder;
            debugMeshRoot.add(boxMesh);
            boxMesh.position.fromArray(position);
        };

        let separation = 10;
        createMesh([-separation, 0, -separation]);
        createMesh([-separation, 0, separation]);
        createMesh([separation, 0, -separation]);
        createMesh([separation, 0, separation]);

        return debugMeshRoot;
    }

    static buildDebugMaterial(color) {
        const vertexShaderSource = `
            #include <common>
            varying float ndcDepth;

            void main() {
                gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position.xyz, 1.0);
                ndcDepth = gl_Position.z / gl_Position.w;
                gl_Position.x = gl_Position.x / gl_Position.w;
                gl_Position.y = gl_Position.y / gl_Position.w;
                gl_Position.z = 0.0;
                gl_Position.w = 1.0;
    
            }
        `;

        const fragmentShaderSource = `
            #include <common>
            uniform vec3 color;
            varying float ndcDepth;
            void main() {
                gl_FragDepth = (ndcDepth + 1.0) / 2.0;
                gl_FragColor = vec4(color.rgb, 0.0);
            }
        `;

        const uniforms = {
            'color': {
                'type': 'v3',
                'value': new THREE.Color(color)
            },
        };

        const material = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: vertexShaderSource,
            fragmentShader: fragmentShaderSource,
            transparent: false,
            depthTest: true,
            depthWrite: true,
            side: THREE.FrontSide
        });
        material.extensions.fragDepth = true;

        return material;
    }

    static buildFocusMarkerMaterial(color) {
        const vertexShaderSource = `
            #include <common>

            uniform vec2 viewport;

            varying vec4 ndcPosition;
            varying vec4 ndcCenter;

            void main() {
                float radius = 0.01;

                vec4 viewPosition = modelViewMatrix * vec4(position.xyz, 1.0);
                vec4 viewCenter = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);

                ndcPosition = projectionMatrix * viewPosition;
                ndcCenter = projectionMatrix * viewCenter;

                gl_Position = projectionMatrix * viewPosition;

            }
        `;

        const fragmentShaderSource = `
            #include <common>
            uniform vec3 color;
            uniform vec2 viewport;

            varying vec4 ndcPosition;
            varying vec4 ndcCenter;

            void main() {
                vec2 screenPosition = vec2(ndcPosition * vec4(1.0 / ndcPosition.w)) * viewport;
                vec2 screenCenter = vec2(ndcCenter * vec4(1.0 / ndcCenter.w)) * viewport;

                vec2 screenVec = screenPosition - screenCenter;

                float projectedRadius = length(screenVec);

                float lineWidth = 2.0;
                float radDiff = abs(projectedRadius - 70.0) - lineWidth;
                float alpha = 1.0 - clamp(radDiff / 10.0, 0.0, 1.0); 

                gl_FragColor = vec4(color.rgb, alpha);
            }
        `;

        const uniforms = {
            'color': {
                'type': 'v3',
                'value': new THREE.Color(color)
            },
            'viewport': {
                'type': 'v2',
                'value': new THREE.Vector2()
            },
        };

        const material = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: vertexShaderSource,
            fragmentShader: fragmentShaderSource,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: THREE.FrontSide
        });

        return material;
    }
}
