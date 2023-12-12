import * as THREE from 'three';
import { SplatTree } from './splattree/SplatTree.js';
import { uintEncodedFloat, rgbaToInteger } from './Util.js';

const dummyGeometry = new THREE.BufferGeometry();
const dummyMaterial = new THREE.MeshBasicMaterial();

/**
 * SplatMesh: Container for one or more SplatBuffer instances, abstracting them into a single unified container for
 * splat data. Additionally contains data structures and code to make the splat data renderable as a Three.js mesh.
 */
export class SplatMesh extends THREE.Mesh {

    constructor(halfPrecisionCovariancesOnGPU = false, devicePixelRatio = 1, enableDistancesComputationOnGPU = true) {
        super(dummyGeometry, dummyMaterial);
        this.renderer = undefined;
        this.halfPrecisionCovariancesOnGPU = halfPrecisionCovariancesOnGPU;
        this.devicePixelRatio = devicePixelRatio;
        this.enableDistancesComputationOnGPU = enableDistancesComputationOnGPU;
        this.splatBuffers = [];
        this.splatBufferOptions = [];
        this.splatBufferTransforms = [];
        this.splatTree = null;
        this.splatDataTextures = null;
        this.distancesTransformFeedback = {
            'id': null,
            'vertexShader': null,
            'fragmentShader': null,
            'program': null,
            'centersBuffer': null,
            'outDistancesBuffer': null,
            'centersLoc': -1,
            'modelViewProjLoc': -1,
        };
        this.globalSplatIndexToLocalSplatIndexMap = {};
        this.globalSplatIndexToSplatBufferIndexMap = {};
    }

    /**
     * Build the Three.js material that is used to render the splats.
     * @return {THREE.ShaderMaterial}
     */
    static buildMaterial() {

        // Contains the code to project 3D covariance to 2D and from there calculate the quad (using the eigen vectors of the
        // 2D covariance) that is ultimately rasterized
        const vertexShaderSource = `
            precision highp float;
            #include <common>

            attribute uint splatIndex;

            uniform highp sampler2D covariancesTexture;
            uniform highp usampler2D centersColorsTexture;
            uniform vec2 focal;
            uniform vec2 viewport;
            uniform vec2 basisViewport;
            uniform vec2 covariancesTextureSize;
            uniform vec2 centersColorsTextureSize;

            varying vec4 vColor;
            varying vec2 vUv;

            varying vec2 vPosition;

            const vec4 encodeNorm4 = vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0);
            const uvec4 mask4 = uvec4(uint(0x000000FF), uint(0x0000FF00), uint(0x00FF0000), uint(0xFF000000));
            const uvec4 shift4 = uvec4(0, 8, 16, 24);
            vec4 uintToRGBAVec (uint u) {
               uvec4 urgba = mask4 & u;
               urgba = urgba >> shift4;
               vec4 rgba = vec4(urgba) * encodeNorm4;
               return rgba;
            }

            vec2 getDataUV(in int stride, in int offset, in vec2 dimensions) {
                vec2 samplerUV = vec2(0.0, 0.0);
                float d = float(splatIndex * uint(stride) + uint(offset)) / dimensions.x;
                samplerUV.y = float(floor(d)) / dimensions.y;
                samplerUV.x = fract(d);
                return samplerUV;
            }

            void main () {
                uvec4 sampledCenterColor = texture(centersColorsTexture, getDataUV(1, 0, centersColorsTextureSize));
                vec3 splatCenter = uintBitsToFloat(uvec3(sampledCenterColor.gba));
                vColor = uintToRGBAVec(sampledCenterColor.r);

                vPosition = position.xy * 2.0;

                vec4 viewCenter = modelViewMatrix * vec4(splatCenter, 1.0);
                vec4 clipCenter = projectionMatrix * viewCenter;

                vec2 sampledCovarianceA = texture(covariancesTexture, getDataUV(3, 0, covariancesTextureSize)).rg;
                vec2 sampledCovarianceB = texture(covariancesTexture, getDataUV(3, 1, covariancesTextureSize)).rg;
                vec2 sampledCovarianceC = texture(covariancesTexture, getDataUV(3, 2, covariancesTextureSize)).rg;

                vec3 cov3D_M11_M12_M13 = vec3(sampledCovarianceA.rg, sampledCovarianceB.r);
                vec3 cov3D_M22_M23_M33 = vec3(sampledCovarianceB.g, sampledCovarianceC.rg);

                // Compute the 2D covariance matrix from the upper-right portion of the 3D covariance matrix
                mat3 Vrk = mat3(
                    cov3D_M11_M12_M13.x, cov3D_M11_M12_M13.y, cov3D_M11_M12_M13.z,
                    cov3D_M11_M12_M13.y, cov3D_M22_M23_M33.x, cov3D_M22_M23_M33.y,
                    cov3D_M11_M12_M13.z, cov3D_M22_M23_M33.y, cov3D_M22_M23_M33.z
                );
                float s = 1.0 / (viewCenter.z * viewCenter.z);
                mat3 J = mat3(
                    focal.x / viewCenter.z, 0., -(focal.x * viewCenter.x) * s,
                    0., focal.y / viewCenter.z, -(focal.y * viewCenter.y) * s,
                    0., 0., 0.
                );
                mat3 W = transpose(mat3(modelViewMatrix));
                mat3 T = W * J;
                mat3 cov2Dm = transpose(T) * Vrk * T;
                cov2Dm[0][0] += 0.3;
                cov2Dm[1][1] += 0.3;

                // We are interested in the upper-left 2x2 portion of the projected 3D covariance matrix because
                // we only care about the X and Y values. We want the X-diagonal, cov2Dm[0][0],
                // the Y-diagonal, cov2Dm[1][1], and the correlation between the two cov2Dm[0][1]. We don't
                // need cov2Dm[1][0] because it is a symetric matrix.
                vec3 cov2Dv = vec3(cov2Dm[0][0], cov2Dm[0][1], cov2Dm[1][1]);

                vec3 ndcCenter = clipCenter.xyz / clipCenter.w;

                // We now need to solve for the eigen-values and eigen vectors of the 2D covariance matrix
                // so that we can determine the 2D basis for the splat. This is done using the method described
                // here: https://people.math.harvard.edu/~knill/teaching/math21b2004/exhibits/2dmatrices/index.html
                //
                // This is a different approach than in the original work at INRIA. In that work they compute the
                // max extents of the 2D covariance matrix in screen space to form an axis aligned bounding rectangle
                // which forms the geometry that is actually rasterized. They then use the inverse 2D covariance
                // matrix (called 'conic') to determine fragment opacity.
                float a = cov2Dv.x;
                float d = cov2Dv.z;
                float b = cov2Dv.y;
                float D = a * d - b * b;
                float trace = a + d;
                float traceOver2 = 0.5 * trace;
                float term2 = sqrt(trace * trace / 4.0 - D);
                float eigenValue1 = traceOver2 + term2;
                float eigenValue2 = max(traceOver2 - term2, 0.00); // prevent negative eigen value

                const float maxSplatSize = 1024.0;
                vec2 eigenVector1 = normalize(vec2(b, eigenValue1 - a));
                // since the eigen vectors are orthogonal, we derive the second one from the first
                vec2 eigenVector2 = vec2(eigenVector1.y, -eigenVector1.x);
                vec2 basisVector1 = eigenVector1 * min(sqrt(2.0 * eigenValue1), maxSplatSize);
                vec2 basisVector2 = eigenVector2 * min(sqrt(2.0 * eigenValue2), maxSplatSize);

                vec2 ndcOffset = vec2(vPosition.x * basisVector1 + vPosition.y * basisVector2) * basisViewport;

                gl_Position = vec4(ndcCenter.xy + ndcOffset, ndcCenter.z, 1.0);
            }`;

        const fragmentShaderSource = `
            precision highp float;
            #include <common>

            uniform vec3 debugColor;

            varying vec4 vColor;
            varying vec2 vUv;

            varying vec2 vPosition;

            void main () {
                // compute the negative squared distance from the center of the splat to the
                // current fragment in the splat's local space.
                float A = -dot(vPosition, vPosition);
                if (A < -4.0) discard;
                vec3 color = vColor.rgb;
                A = exp(A) * vColor.a;
                gl_FragColor = vec4(color.rgb, A);
            }`;

        const uniforms = {
            'covariancesTexture': {
                'type': 't',
                'value': null
            },
            'centersColorsTexture': {
                'type': 't',
                'value': null
            },
            'focal': {
                'type': 'v2',
                'value': new THREE.Vector2()
            },
            'viewport': {
                'type': 'v2',
                'value': new THREE.Vector2()
            },
            'basisViewport': {
                'type': 'v2',
                'value': new THREE.Vector2()
            },
            'debugColor': {
                'type': 'v3',
                'value': new THREE.Color()
            },
            'covariancesTextureSize': {
                'type': 'v2',
                'value': new THREE.Vector2(1024, 1024)
            },
            'centersColorsTextureSize': {
                'type': 'v2',
                'value': new THREE.Vector2(1024, 1024)
            }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: vertexShaderSource,
            fragmentShader: fragmentShaderSource,
            transparent: true,
            alphaTest: 1.0,
            blending: THREE.NormalBlending,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        return material;
    }

    /**
     * Build the Three.js geometry that will be used to render the splats. The geometry is instanced and is made up of
     * vertices for a single quad as well as an attribute buffer for the splat indexes.
     * @param {number} maxSplatCount The maximum number of splats that the geometry will need to accomodate
     * @return {THREE.InstancedBufferGeometry}
     */
    static buildGeomtery(maxSplatCount) {

        const baseGeometry = new THREE.BufferGeometry();
        baseGeometry.setIndex([0, 1, 2, 0, 2, 3]);

        // Vertices for the instanced quad
        const positionsArray = new Float32Array(4 * 3);
        const positions = new THREE.BufferAttribute(positionsArray, 3);
        baseGeometry.setAttribute('position', positions);
        positions.setXYZ(0, -1.0, -1.0, 0.0);
        positions.setXYZ(1, -1.0, 1.0, 0.0);
        positions.setXYZ(2, 1.0, 1.0, 0.0);
        positions.setXYZ(3, 1.0, -1.0, 0.0);
        positions.needsUpdate = true;

        const geometry = new THREE.InstancedBufferGeometry().copy(baseGeometry);

        // Splat index buffer
        const splatIndexArray = new Uint32Array(maxSplatCount);
        const splatIndexes = new THREE.InstancedBufferAttribute(splatIndexArray, 1, false);
        splatIndexes.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('splatIndex', splatIndexes);

        geometry.instanceCount = maxSplatCount;

        return geometry;
    }

    /**
     * Build a Three.js transformation matrix for each splat buffer based on options (position, scale, rotation)
     * passed to the splat mesh during the build process. These are all optional and allow for the customization of
     * a given splat buffer's position, scale, and orientation relative to the others.
     * @param {Array<object>} splatBufferOptions Array of options objects: {
     *
     *         position (Array<number>):   Position of the scene, acts as an offset from its default position, defaults to [0, 0, 0]
     *
     *         rotation (Array<number>):   Rotation of the scene represented as a quaternion, defaults to [0, 0, 0, 1]
     *
     *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
     * }
     * @param {Array<THREE.Matrix4>} splatBufferTransforms Existing transforms, if there are any
     * @return {Array<THREE.Matrix4>}
     */
    static buildSplatBufferTransforms(splatBufferOptions, splatBufferTransforms = null) {
        splatBufferTransforms = splatBufferTransforms || [];
        splatBufferTransforms.length = splatBufferOptions.length;
        for (let i = 0; i < splatBufferOptions.length; i++) {
            if (!splatBufferTransforms[i]) {
                const options = splatBufferOptions[i];
                if (options) {
                    let positionArray = options['position'] || [0, 0, 0];
                    let rotationArray = options['rotation'] || [0, 0, 0, 1];
                    let scaleArray = options['scale'] || [1, 1, 1];
                    const position = new THREE.Vector3().fromArray(positionArray);
                    const rotation = new THREE.Quaternion().fromArray(rotationArray);
                    const scale = new THREE.Vector3().fromArray(scaleArray);
                    const splatBufferTransform = new THREE.Matrix4();
                    splatBufferTransform.compose(position, rotation, scale);
                    splatBufferTransforms[i] = splatBufferTransform;
                }
            }
        }
        return splatBufferTransforms;
    }

    /**
     * Build data structures that map global splat indexes (based on a unified index across all splat buffers) to
     * local data within a single splat buffer.
     * @param {Array<SplatBuffer>} splatBuffers Instances of SplatBuffer off which to build the maps
     * @return {object}
     */
    static buildSplatIndexMaps(splatBuffers) {
        const localSplatIndexMap = new Map();
        const splatBufferIndexMap = new Map();
        let totalSplatCount = 0;
        for (let s = 0; s < splatBuffers.length; s++) {
            const splatBuffer = splatBuffers[s];
            const splatCount = splatBuffer.getSplatCount();
            for (let i = 0; i < splatCount; i++) {
                localSplatIndexMap[totalSplatCount] = i;
                splatBufferIndexMap[totalSplatCount] = s;
                totalSplatCount++;
            }
        }
        return {
            localSplatIndexMap,
            splatBufferIndexMap
        };
    }

    /**
     * Build an instance of SplatTree (a specialized octree) for the given splat mesh.
     * @param {SplatMesh} splatMesh SplatMesh instance for which the splat tree will be built
     * @return {SplatTree}
     */
    static buildSplatTree(splatMesh) {
        // TODO: expose SplatTree constructor parameters (maximumDepth and maxCentersPerNode) so that they can
        // be configured on a per-scene basis
        const splatTree = new SplatTree(8, 1000);
        console.time('SplatTree build');
        const splatColor = new THREE.Vector4();
        splatTree.processSplatMesh(splatMesh, (splatIndex) => {
            splatMesh.getSplatColor(splatIndex, splatColor);
            const splatBufferIndex = splatMesh.getSplatBufferIndexForSplat(splatIndex);
            const splatBufferOptions = splatMesh.splatBufferOptions[splatBufferIndex];
            return splatColor.w >= (splatBufferOptions.splatAlphaRemovalThreshold || 1);
        });
        console.timeEnd('SplatTree build');

        let leavesWithVertices = 0;
        let avgSplatCount = 0;
        let maxSplatCount = 0;
        let nodeCount = 0;

        splatTree.visitLeaves((node) => {
            const nodeSplatCount = node.data.indexes.length;
            if (nodeSplatCount > 0) {
                avgSplatCount += nodeSplatCount;
                maxSplatCount = Math.max(maxSplatCount, nodeSplatCount);
                nodeCount++;
                leavesWithVertices++;
            }
        });
        console.log(`SplatTree leaves: ${splatTree.countLeaves()}`);
        console.log(`SplatTree leaves with splats:${leavesWithVertices}`);
        avgSplatCount = avgSplatCount / nodeCount;
        console.log(`Avg splat count per node: ${avgSplatCount}`);
        console.log(`Total splat count: ${splatMesh.getSplatCount()}`);
        return splatTree;
    }

    /**
     * Construct this instance of SplatMesh.
     * @param {Array<SplatBuffer>} splatBuffers The base splat data, instances of SplatBuffer
     * @param {Array<object>} splatBufferOptions Dynamic options for each splat buffer {
     *
     *         splatAlphaRemovalThreshold: Ignore any splats with an alpha less than the specified
     *                                     value (valid range: 0 - 255), defaults to 1
     *
     *         position (Array<number>):   Position of the scene, acts as an offset from its default position, defaults to [0, 0, 0]
     *
     *         rotation (Array<number>):   Rotation of the scene represented as a quaternion, defaults to [0, 0, 0, 1]
     *
     *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
     *
     * }
     * @param {Boolean} keepExistingSplatBufferTransforms If the transform for a splat buffer has been changed since a
     *                                                    previous call to build(), this flag says to preserve it. The assumption
     *                                                    is that the current call to build() will be using the same splat buffers
     *                                                    as the previous call.
     */
    build(splatBuffers, splatBufferOptions, keepExistingSplatBufferTransforms = true) {
        this.disposeMeshData();
        const totalSplatCount = SplatMesh.getTotalSplatCountForSplatBuffers(splatBuffers);
        this.splatBufferTransforms = SplatMesh.buildSplatBufferTransforms(splatBufferOptions, keepExistingSplatBufferTransforms ?
                                                                          this.splatBufferTransforms : null);
        this.geometry = SplatMesh.buildGeomtery(totalSplatCount);
        this.material = SplatMesh.buildMaterial();
        const indexMaps = SplatMesh.buildSplatIndexMaps(splatBuffers);
        this.globalSplatIndexToLocalSplatIndexMap = indexMaps.localSplatIndexMap;
        this.globalSplatIndexToSplatBufferIndexMap = indexMaps.splatBufferIndexMap;
        this.splatTree = SplatMesh.buildSplatTree(this);

        this.splatBuffers = splatBuffers;
        this.splatBufferOptions = splatBufferOptions;

        if (this.enableDistancesComputationOnGPU) this.setupDistancesComputationTransformFeedback();
        this.resetDataFromSplatBuffer();
    }

    /**
     * Dispose all resources held by the splat mesh
     */
    dispose() {
        this.disposeMeshData();
        if (this.enableDistancesComputationOnGPU) {
            this.disposeDistancesComputationGPUResources();
        }
    }

    /**
     * Dispose of only the Three.js mesh resources (geometry, material, and texture)
     */
    disposeMeshData() {
        if (this.geometry && this.geometry !== dummyGeometry) {
            this.geometry.dispose();
            this.geometry = null;
        }
        for (let textureKey in this.splatDataTextures) {
            if (this.splatDataTextures.hasOwnProperty(textureKey)) {
                const textureContainer = this.splatDataTextures[textureKey];
                if (textureContainer.texture) {
                    textureContainer.texture.dispose();
                    textureContainer.texture = null;
                }
            }
        }
        this.splatDataTextures = null;
        if (this.material) {
            this.material.dispose();
            this.material = null;
        }
        this.splatTree = null;
    }

    getSplatTree() {
        return this.splatTree;
    }

    /**
     * Refresh data textures and GPU buffers for splat distance pre-computation with data from the splat buffers for this mesh.
     */
    resetDataFromSplatBuffer() {
        this.uploadSplatDataToTextures();
        if (this.enableDistancesComputationOnGPU) {
            this.updateGPUCentersBufferForDistancesComputation();
        }
    }

    /**
     * Refresh data textures with data from the splat buffers for this mesh.
     */
    uploadSplatDataToTextures() {

        const splatCount = this.getSplatCount();

        const covariances = new Float32Array(splatCount * 6);
        const centers = new Float32Array(splatCount * 3);
        const colors = new Uint8Array(splatCount * 4);
        this.fillSplatDataArrays(covariances, centers, colors);

        const COVARIANCES_ELEMENTS_PER_TEXEL = 2;
        const CENTER_COLORS_ELEMENTS_PER_TEXEL = 4;

        const covariancesTextureSize = new THREE.Vector2(4096, 1024);
        while (covariancesTextureSize.x * covariancesTextureSize.y * COVARIANCES_ELEMENTS_PER_TEXEL < splatCount * 6) {
            covariancesTextureSize.y *= 2;
        }

        const centersColorsTextureSize = new THREE.Vector2(4096, 1024);
        while (centersColorsTextureSize.x * centersColorsTextureSize.y * CENTER_COLORS_ELEMENTS_PER_TEXEL < splatCount * 4) {
            centersColorsTextureSize.y *= 2;
        }

        let covariancesTexture;
        let paddedCovariances;
        if (this.halfPrecisionCovariancesOnGPU) {
            paddedCovariances = new Uint16Array(covariancesTextureSize.x * covariancesTextureSize.y * COVARIANCES_ELEMENTS_PER_TEXEL);
            for (let i = 0; i < covariances.length; i++) {
                paddedCovariances[i] = THREE.DataUtils.toHalfFloat(covariances[i]);
            }
            covariancesTexture = new THREE.DataTexture(paddedCovariances, covariancesTextureSize.x,
                                                       covariancesTextureSize.y, THREE.RGFormat, THREE.HalfFloatType);
        } else {
            paddedCovariances = new Float32Array(covariancesTextureSize.x * covariancesTextureSize.y * COVARIANCES_ELEMENTS_PER_TEXEL);
            paddedCovariances.set(covariances);
            covariancesTexture = new THREE.DataTexture(paddedCovariances, covariancesTextureSize.x,
                                                       covariancesTextureSize.y, THREE.RGFormat, THREE.FloatType);
        }
        covariancesTexture.needsUpdate = true;
        this.material.uniforms.covariancesTexture.value = covariancesTexture;
        this.material.uniforms.covariancesTextureSize.value.copy(covariancesTextureSize);

        const paddedCenterColors = new Uint32Array(centersColorsTextureSize.x *
                                                   centersColorsTextureSize.y * CENTER_COLORS_ELEMENTS_PER_TEXEL);
        for (let c = 0; c < splatCount; c++) {
            const colorsBase = c * 4;
            const centersBase = c * 3;
            const centerColorsBase = c * 4;
            paddedCenterColors[centerColorsBase] = rgbaToInteger(colors[colorsBase], colors[colorsBase + 1],
                                                                 colors[colorsBase + 2], colors[colorsBase + 3]);
            paddedCenterColors[centerColorsBase + 1] = uintEncodedFloat(centers[centersBase]);
            paddedCenterColors[centerColorsBase + 2] = uintEncodedFloat(centers[centersBase + 1]);
            paddedCenterColors[centerColorsBase + 3] = uintEncodedFloat(centers[centersBase + 2]);
        }
        const centersColorsTexture = new THREE.DataTexture(paddedCenterColors, centersColorsTextureSize.x,
                                                           centersColorsTextureSize.y, THREE.RGBAIntegerFormat, THREE.UnsignedIntType);
        centersColorsTexture.internalFormat = 'RGBA32UI';
        centersColorsTexture.needsUpdate = true;
        this.material.uniforms.centersColorsTexture.value = centersColorsTexture;
        this.material.uniforms.centersColorsTextureSize.value.copy(centersColorsTextureSize);
        this.material.uniformsNeedUpdate = true;

        this.splatDataTextures = {
            'covariances': {
                'data': paddedCovariances,
                'texture': covariancesTexture,
                'size': covariancesTextureSize
            },
            'centerColors': {
                'data': paddedCenterColors,
                'texture': centersColorsTexture,
                'size': centersColorsTextureSize
            }
        };
    }

    /**
     * Set the indexes of splats that should be rendered; should be sorted in desired render order.
     * @param {Uint32Array} globalIndexes Sorted index list of splats to be rendered
     * @param {number} renderSplatCount Total number of splats to be rendered. Necessary because we may not want to render
     *                                  every splat.
     */
    updateRenderIndexes(globalIndexes, renderSplatCount) {
        const geometry = this.geometry;
        geometry.attributes.splatIndex.set(globalIndexes);
        geometry.attributes.splatIndex.needsUpdate = true;
        geometry.instanceCount = renderSplatCount;
    }

    updateUniforms = function() {

        const viewport = new THREE.Vector2();

        return function(renderDimensions, cameraFocalLengthX, cameraFocalLengthY) {
            const splatCount = this.getSplatCount();
            if (splatCount > 0) {
                viewport.set(renderDimensions.x * this.devicePixelRatio,
                             renderDimensions.y * this.devicePixelRatio);
                this.material.uniforms.viewport.value.copy(viewport);
                this.material.uniforms.basisViewport.value.set(2.0 / viewport.x, 2.0 / viewport.y);
                this.material.uniforms.focal.value.set(cameraFocalLengthX, cameraFocalLengthY);
                this.material.uniformsNeedUpdate = true;
            }
        };

    }();

    getSplatDataTextures() {
        return this.splatDataTextures;
    }

    getSplatCount() {
        return SplatMesh.getTotalSplatCountForSplatBuffers(this.splatBuffers);
    }

    static getTotalSplatCountForSplatBuffers(splatBuffers) {
        let totalSplatCount = 0;
        for (let splatBuffer of splatBuffers) totalSplatCount += splatBuffer.getSplatCount();
        return totalSplatCount;
    }

    disposeDistancesComputationGPUResources() {

        if (!this.renderer) return;

        const gl = this.renderer.getContext();

        if (this.distancesTransformFeedback.vao) {
            gl.deleteVertexArray(this.distancesTransformFeedback.vao);
            this.distancesTransformFeedback.vao = null;
        }
        if (this.distancesTransformFeedback.program) {
            gl.deleteProgram(this.distancesTransformFeedback.program);
            gl.deleteShader(this.distancesTransformFeedback.vertexShader);
            gl.deleteShader(this.distancesTransformFeedback.fragmentShader);
            this.distancesTransformFeedback.program = null;
            this.distancesTransformFeedback.vertexShader = null;
            this.distancesTransformFeedback.fragmentShader = null;
        }
        this.disposeDistancesComputationGPUBufferResources();
        if (this.distancesTransformFeedback.id) {
            gl.deleteTransformFeedback(this.distancesTransformFeedback.id);
            this.distancesTransformFeedback.id = null;
        }
    }

    disposeDistancesComputationGPUBufferResources() {

        if (!this.renderer) return;

        const gl = this.renderer.getContext();

        if (this.distancesTransformFeedback.centersBuffer) {
            this.distancesTransformFeedback.centersBuffer = null;
            gl.deleteBuffer(this.distancesTransformFeedback.centersBuffer);
        }
        if (this.distancesTransformFeedback.outDistancesBuffer) {
            gl.deleteBuffer(this.distancesTransformFeedback.outDistancesBuffer);
            this.distancesTransformFeedback.outDistancesBuffer = null;
        }
    }

    setRenderer(renderer) {
        if (renderer !== this.renderer) {
            this.renderer = renderer;
            if (this.enableDistancesComputationOnGPU && this.getSplatCount() > 0) {
                this.setupDistancesComputationTransformFeedback();
                this.updateGPUCentersBufferForDistancesComputation();
            }
        }
    }

    setupDistancesComputationTransformFeedback = function() {

        let currentRenderer;
        let currentSplatCount;

        return function() {
            const splatCount = this.getSplatCount();

            if (!this.renderer || (currentRenderer === this.renderer && currentSplatCount === splatCount)) return;
            const rebuildGPUObjects = (currentRenderer !== this.renderer);
            const rebuildBuffers = currentSplatCount !== splatCount;
            if (rebuildGPUObjects) {
                this.disposeDistancesComputationGPUResources();
            } else if (rebuildBuffers) {
                this.disposeDistancesComputationGPUBufferResources();
            }

            const gl = this.renderer.getContext();

            const createShader = (gl, type, source) => {
                const shader = gl.createShader(type);
                if (!shader) {
                    console.error('Fatal error: gl could not create a shader object.');
                    return null;
                }

                gl.shaderSource(shader, source);
                gl.compileShader(shader);

                const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
                if (!compiled) {
                    let typeName = 'unknown';
                    if (type === gl.VERTEX_SHADER) typeName = 'vertex shader';
                    else if (type === gl.FRAGMENT_SHADER) typeName = 'fragement shader';
                    const errors = gl.getShaderInfoLog(shader);
                    console.error('Failed to compile ' + typeName + ' with these errors:' + errors);
                    gl.deleteShader(shader);
                    return null;
                }

                return shader;
            };

            const vsSource =
            `#version 300 es
                in ivec3 center;
                uniform ivec3 modelViewProj;
                flat out int distance;
                void main(void) {
                    distance = center.x * modelViewProj.x + center.y * modelViewProj.y + center.z * modelViewProj.z;
                }
            `;

            const fsSource =
            `#version 300 es
                precision lowp float;
                out vec4 fragColor;
                void main(){}
            `;

            const currentVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
            const currentProgram = gl.getParameter(gl.CURRENT_PROGRAM);

            if (rebuildGPUObjects) {
                this.distancesTransformFeedback.vao = gl.createVertexArray();
            }

            gl.bindVertexArray(this.distancesTransformFeedback.vao);

            if (rebuildGPUObjects) {
                const program = gl.createProgram();
                const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
                const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
                if (!vertexShader || !fragmentShader) {
                    throw new Error('Could not compile shaders for distances computation on GPU.');
                }
                gl.attachShader(program, vertexShader);
                gl.attachShader(program, fragmentShader);
                gl.transformFeedbackVaryings(program, ['distance'], gl.SEPARATE_ATTRIBS);
                gl.linkProgram(program);

                const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
                if (!linked) {
                    const error = gl.getProgramInfoLog(program);
                    console.error('Fatal error: Failed to link program: ' + error);
                    gl.deleteProgram(program);
                    gl.deleteShader(fragmentShader);
                    gl.deleteShader(vertexShader);
                    throw new Error('Could not link shaders for distances computation on GPU.');
                }

                this.distancesTransformFeedback.program = program;
                this.distancesTransformFeedback.vertexShader = vertexShader;
                this.distancesTransformFeedback.vertexShader = fragmentShader;
            }

            gl.useProgram(this.distancesTransformFeedback.program);

            this.distancesTransformFeedback.centersLoc =
                gl.getAttribLocation(this.distancesTransformFeedback.program, 'center');
            this.distancesTransformFeedback.modelViewProjLoc =
                gl.getUniformLocation(this.distancesTransformFeedback.program, 'modelViewProj');

            if (rebuildGPUObjects || rebuildBuffers) {
                this.distancesTransformFeedback.centersBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this.distancesTransformFeedback.centersBuffer);
                gl.enableVertexAttribArray(this.distancesTransformFeedback.centersLoc);
                gl.vertexAttribIPointer(this.distancesTransformFeedback.centersLoc, 3, gl.INT, 0, 0);
            }

            if (rebuildGPUObjects || rebuildBuffers) {
                this.distancesTransformFeedback.outDistancesBuffer = gl.createBuffer();
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, this.distancesTransformFeedback.outDistancesBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, splatCount * 4, gl.DYNAMIC_COPY);

            if (rebuildGPUObjects) {
                this.distancesTransformFeedback.id = gl.createTransformFeedback();
            }
            gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.distancesTransformFeedback.id);
            gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.distancesTransformFeedback.outDistancesBuffer);

            if (currentProgram) gl.useProgram(currentProgram);
            if (currentVao) gl.bindVertexArray(currentVao);

            currentRenderer = this.renderer;
            currentSplatCount = splatCount;
        };

    }();

    /**
     * Refresh GPU buffers used for pre-computing splat distances with centers data from the splat buffers for this mesh.
     */
    updateGPUCentersBufferForDistancesComputation() {

        if (!this.renderer) return;

        const gl = this.renderer.getContext();

        const currentVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
        gl.bindVertexArray(this.distancesTransformFeedback.vao);

        const intCenters = this.getIntegerCenters(false);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.distancesTransformFeedback.centersBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, intCenters, gl.STATIC_DRAW);

        if (currentVao) gl.bindVertexArray(currentVao);
    }

    computeDistancesOnGPU(modelViewProjMatrix, outComputedDistances) {

        if (!this.renderer) return;

        const iViewProjMatrix = SplatMesh.getIntegerMatrixArray(modelViewProjMatrix);
        const iViewProj = [iViewProjMatrix[2], iViewProjMatrix[6], iViewProjMatrix[10]];

        // console.time("gpu_compute_distances");
        const gl = this.renderer.getContext();

        const currentVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
        const currentProgram = gl.getParameter(gl.CURRENT_PROGRAM);

        gl.bindVertexArray(this.distancesTransformFeedback.vao);
        gl.useProgram(this.distancesTransformFeedback.program);

        gl.enable(gl.RASTERIZER_DISCARD);

        gl.uniform3i(this.distancesTransformFeedback.modelViewProjLoc, iViewProj[0], iViewProj[1], iViewProj[2]);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.distancesTransformFeedback.centersBuffer);
        gl.enableVertexAttribArray(this.distancesTransformFeedback.centersLoc);
        gl.vertexAttribIPointer(this.distancesTransformFeedback.centersLoc, 3, gl.INT, 0, 0);

        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.distancesTransformFeedback.id);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.distancesTransformFeedback.outDistancesBuffer);

        gl.beginTransformFeedback(gl.POINTS);
        gl.drawArrays(gl.POINTS, 0, this.getSplatCount());
        gl.endTransformFeedback();

        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

        gl.disable(gl.RASTERIZER_DISCARD);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.distancesTransformFeedback.outDistancesBuffer);
        gl.getBufferSubData(gl.ARRAY_BUFFER, 0, outComputedDistances);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        // console.timeEnd("gpu_compute_distances");

        if (currentProgram) gl.useProgram(currentProgram);
        if (currentVao) gl.bindVertexArray(currentVao);

    }

    /**
     * Given a global splat index, return corresponding local data (splat buffer, index of splat in that splat
     * buffer, and the corresponding transform)
     * @param {number} globalIndex Global splat index
     * @param {object} paramsObj Object in which to store local data
     */
    getLocalSplatParameters(globalIndex, paramsObj) {
        paramsObj.splatBuffer = this.getSplatBufferForSplat(globalIndex);
        paramsObj.localIndex = this.getSplatLocalIndex(globalIndex);
        paramsObj.splatBufferTransform = this.getSplatBufferTransformForSplat(globalIndex);
    }

    /**
     * Fill arrays with splat data and apply transforms if appropriate. Each array is optional.
     * @param {Float32Array} covariances Target storage for splat covariances
     * @param {Float32Array} centers Target storage for splat centers
     * @param {Uint8Array} colors Target storage for splat colors
     */
    fillSplatDataArrays(covariances, centers, colors) {
        let offset = 0;
        for (let i = 0; i < this.splatBuffers.length; i++) {
            const splatBuffer = this.splatBuffers[i];
            const splatBufferTransform = this.splatBufferTransforms[i];
            if (covariances) splatBuffer.fillSplatCovarianceArray(covariances, offset, splatBufferTransform);
            if (centers) splatBuffer.fillSplatCenterArray(centers, offset, splatBufferTransform);
            if (colors) splatBuffer.fillSplatColorArray(colors, offset, splatBufferTransform);
            offset += splatBuffer.getSplatCount();
        }
    }

    /**
     * Convert splat centers, which are floating point values, to an array of integers and multiply
     * each by 1000. Centers will get transformed as appropriate before conversion to integer.
     * @param {number} padFour Enforce alignement of 4 by inserting a 1 after every 3 values.
     * @return {Int32Array}
     */
    getIntegerCenters(padFour) {
        const splatCount = this.getSplatCount();
        const floatCenters = new Float32Array(splatCount * 3);
        this.fillSplatDataArrays(null, floatCenters, null);
        let intCenters;
        let componentCount = padFour ? 4 : 3;
        intCenters = new Int32Array(splatCount * componentCount);
        for (let i = 0; i < splatCount; i++) {
            for (let t = 0; t < 3; t++) {
                intCenters[i * componentCount + t] = Math.round(floatCenters[i * 3 + t] * 1000.0);
            }
            if (padFour) intCenters[i * componentCount + 3] = 1;
        }
        return intCenters;
    }

    /**
     * Get the center for a splat, transformed as appropriate.
     * @param {number} globalIndex Global index of splat
     * @param {THREE.Vector3} outCenter THREE.Vector3 instance in which to store splat center
     */
    getSplatCenter = function() {

        const paramsObj = {};

        return function(globalIndex, outCenter) {
            this.getLocalSplatParameters(globalIndex, paramsObj);
            paramsObj.splatBuffer.getSplatCenter(paramsObj.localIndex, outCenter, paramsObj.splatBufferTransform);
        };

    }();

    /**
     * Get the scale and rotation for a splat, transformed as appropriate.
     * @param {number} globalIndex Global index of splat
     * @param {THREE.Vector3} outScale THREE.Vector3 instance in which to store splat scale
     * @param {THREE.Quaternion} outRotation THREE.Quaternion instance in which to store splat rotation
     */
    getSplatScaleAndRotation = function() {

        const paramsObj = {};

        return function(globalIndex, outScale, outRotation) {
            this.getLocalSplatParameters(globalIndex, paramsObj);
            paramsObj.splatBuffer.getSplatScaleAndRotation(paramsObj.localIndex, outScale, outRotation, paramsObj.splatBufferTransform);
        };

    }();

    /**
     * Get the color for a splat
     * @param {number} globalIndex Global index of splat
     * @param {THREE.Vector4} outColor THREE.Vector4 instance in which to store splat color
     */
    getSplatColor = function() {

        const paramsObj = {};

        return function(globalIndex, outColor) {
            this.getLocalSplatParameters(globalIndex, paramsObj);
            paramsObj.splatBuffer.getSplatColor(paramsObj.localIndex, outColor, paramsObj.splatBufferTransform);
        };

    }();

    getSplatBufferForSplat(globalIndex) {
        return this.splatBuffers[this.globalSplatIndexToSplatBufferIndexMap[globalIndex]];
    }

    getSplatBufferIndexForSplat(globalIndex) {
        return this.globalSplatIndexToSplatBufferIndexMap[globalIndex];
    }

    getSplatBufferTransformForSplat(globalIndex) {
        return this.splatBufferTransforms[this.globalSplatIndexToSplatBufferIndexMap[globalIndex]];
    }

    getSplatLocalIndex(globalIndex) {
        return this.globalSplatIndexToLocalSplatIndexMap[globalIndex];
    }

    static getIntegerMatrixArray(matrix) {
        const matrixElements = matrix.elements;
        const intMatrixArray = [];
        for (let i = 0; i < 16; i++) {
            intMatrixArray[i] = Math.round(matrixElements[i] * 1000.0);
        }
        return intMatrixArray;
    }
}
