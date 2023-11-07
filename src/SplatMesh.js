import * as THREE from 'three';
import { SplatTree } from './splattree/SplatTree.js';
import { uintEncodedFloat, rgbaToInteger } from './Util.js';

export class SplatMesh extends THREE.Mesh {

    static buildMesh(splatBuffer, splatAlphaRemovalThreshold = 1, halfPrecisionCovariancesOnGPU = false, devicePixelRatio = 1) {
        const geometry = SplatMesh.buildGeomtery(splatBuffer);
        const material = SplatMesh.buildMaterial();
        return new SplatMesh(splatBuffer, geometry, material, splatAlphaRemovalThreshold, halfPrecisionCovariancesOnGPU, devicePixelRatio);
    }

    constructor(splatBuffer, geometry, material, splatAlphaRemovalThreshold = 1,
                halfPrecisionCovariancesOnGPU = false, devicePixelRatio = 1) {
        super(geometry, material);
        this.splatBuffer = splatBuffer;
        this.geometry = geometry;
        this.material = material;
        this.splatTree = null;
        this.splatDataTextures = null;
        this.splatAlphaRemovalThreshold = splatAlphaRemovalThreshold;
        this.halfPrecisionCovariancesOnGPU = halfPrecisionCovariancesOnGPU;
        this.devicePixelRatio = devicePixelRatio;
        this.buildSplatTree();
        this.resetLocalSplatDataAndTexturesFromSplatBuffer();
    }

    static buildMaterial() {

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

    static buildGeomtery(splatBuffer) {

        const splatCount = splatBuffer.getSplatCount();

        const baseGeometry = new THREE.BufferGeometry();
        baseGeometry.setIndex([0, 1, 2, 0, 2, 3]);

        const positionsArray = new Float32Array(4 * 3);
        const positions = new THREE.BufferAttribute(positionsArray, 3);
        baseGeometry.setAttribute('position', positions);
        positions.setXYZ(0, -1.0, -1.0, 0.0);
        positions.setXYZ(1, -1.0, 1.0, 0.0);
        positions.setXYZ(2, 1.0, 1.0, 0.0);
        positions.setXYZ(3, 1.0, -1.0, 0.0);
        positions.needsUpdate = true;

        const geometry = new THREE.InstancedBufferGeometry().copy(baseGeometry);

        const splatIndexArray = new Uint32Array(splatCount);
        const splatIndexes = new THREE.InstancedBufferAttribute(splatIndexArray, 1, false);
        splatIndexes.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('splatIndex', splatIndexes);

        geometry.instanceCount = splatCount;

        return geometry;
    }

    buildSplatTree() {

        this.splatTree = new SplatTree(10, 500);
        console.time('SplatTree build');
        const splatColor = new THREE.Vector4();
        this.splatTree.processSplatBuffer(this.splatBuffer, (splatIndex) => {
            this.splatBuffer.getColor(splatIndex, splatColor);
            return splatColor.w > this.splatAlphaRemovalThreshold;
        });
        console.timeEnd('SplatTree build');

        let leavesWithVertices = 0;
        let avgSplatCount = 0;
        let maxSplatCount = 0;
        let nodeCount = 0;

        this.splatTree.visitLeaves((node) => {
            const nodeSplatCount = node.data.indexes.length;
            if (nodeSplatCount > 0) {
                avgSplatCount += nodeSplatCount;
                maxSplatCount = Math.max(maxSplatCount, nodeSplatCount);
                nodeCount++;
                leavesWithVertices++;
            }
        });
        console.log(`SplatTree leaves: ${this.splatTree.countLeaves()}`);
        console.log(`SplatTree leaves with splats:${leavesWithVertices}`);
        avgSplatCount = avgSplatCount / nodeCount;
        console.log(`Avg splat count per node: ${avgSplatCount}`);
    }

    getSplatTree() {
        return this.splatTree;
    }

    resetLocalSplatDataAndTexturesFromSplatBuffer() {
        this.updateLocalSplatDataFromSplatBuffer();
        this.allocateAndStoreLocalSplatDataInTextures();
    }

    updateLocalSplatDataFromSplatBuffer() {
        const splatCount = this.splatBuffer.getSplatCount();
        this.covariances = new Float32Array(this.splatBuffer.getPrecomputedCovarianceBufferData());
        this.colors = new Uint8Array(splatCount * 4);
        this.centers = new Float32Array(splatCount * 3);
        this.splatBuffer.fillPositionArray(this.centers);
        this.splatBuffer.fillColorArray(this.colors);
    }

    allocateAndStoreLocalSplatDataInTextures() {
        const COVARIANCES_ELEMENTS_PER_TEXEL = 2;
        const CENTER_COLORS_ELEMENTS_PER_TEXEL = 4;
        const splatCount = this.splatBuffer.getSplatCount();

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
            for (let i = 0; i < this.covariances.length; i++) {
                paddedCovariances[i] = THREE.DataUtils.toHalfFloat(this.covariances[i]);
            }
            covariancesTexture = new THREE.DataTexture(paddedCovariances, covariancesTextureSize.x,
                                                       covariancesTextureSize.y, THREE.RGFormat, THREE.HalfFloatType);
        } else {
            paddedCovariances = new Float32Array(covariancesTextureSize.x * covariancesTextureSize.y * COVARIANCES_ELEMENTS_PER_TEXEL);
            paddedCovariances.set(this.covariances);
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
            paddedCenterColors[centerColorsBase] = rgbaToInteger(this.colors[colorsBase], this.colors[colorsBase + 1],
                                                                 this.colors[colorsBase + 2], this.colors[colorsBase + 3]);
            paddedCenterColors[centerColorsBase + 1] = uintEncodedFloat(this.centers[centersBase]);
            paddedCenterColors[centerColorsBase + 2] = uintEncodedFloat(this.centers[centersBase + 1]);
            paddedCenterColors[centerColorsBase + 3] = uintEncodedFloat(this.centers[centersBase + 2]);
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

    updateSplatDataToDataTextures() {
        this.updateLocalCovarianceDataToDataTexture();
        this.updateLocalCenterColorDataToDataTexture();
    }

    updateLocalCovarianceDataToDataTexture() {
        this.splatDataTextures.covariances.data.set(this.covariances);
        this.splatDataTextures.covariances.texture.needsUpdate = true;
    }

    updateLocalCenterColorDataToDataTexture() {
        this.splatDataTextures.centerColors.data.set(this.centerColors);
        this.splatDataTextures.centerColors.texture.needsUpdate = true;
    }

    updateIndexes(indexes, renderSplatCount) {
        const geometry = this.geometry;

        geometry.attributes.splatIndex.set(indexes);
        geometry.attributes.splatIndex.needsUpdate = true;

        geometry.instanceCount = renderSplatCount;
    }

    updateUniforms = function() {

        const viewport = new THREE.Vector2();

        return function(renderDimensions, cameraFocalLengthX, cameraFocalLengthY) {
            const splatCount = this.splatBuffer.getSplatCount();
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
        return this.splatBuffer.getSplatCount();
    }

    getCenters() {
        return this.centers;
    }

    getColors() {
        return this.colors;
    }

    getCovariances() {
        return this.covariances;
    }
}
