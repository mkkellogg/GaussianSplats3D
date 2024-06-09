import * as THREE from 'three';
import { Constants } from '../Constants.js';

export class SplatMaterial {

    /**
     * Build the Three.js material that is used to render the splats.
     * @param {number} dynamicMode If true, it means the scene geometry represented by this splat mesh is not stationary or
     *                             that the splat count might change
     * @param {boolean} enableOptionalEffects When true, allows for usage of extra properties and attributes in the shader for effects
     *                                        such as opacity adjustment. Default is false for performance reasons.
     * @param {boolean} antialiased If true, calculate compensation factor to deal with gaussians being rendered at a significantly
     *                              different resolution than that of their training
     * @param {number} maxScreenSpaceSplatSize The maximum clip space splat size
     * @param {number} splatScale Value by which all splats are scaled in screen-space (default is 1.0)
     * @param {number} pointCloudModeEnabled Render all splats as screen-space circles
     * @param {number} maxSphericalHarmonicsDegree Degree of spherical harmonics to utilize in rendering splats
     * @return {THREE.ShaderMaterial}
     */
    static build(dynamicMode = false, enableOptionalEffects = false, antialiased = false, maxScreenSpaceSplatSize = 2048,
                 splatScale = 1.0, pointCloudModeEnabled = false, maxSphericalHarmonicsDegree = 0) {
        // Contains the code to project 3D covariance to 2D and from there calculate the quad (using the eigen vectors of the
        // 2D covariance) that is ultimately rasterized
        let vertexShaderSource = `
            precision highp float;
            #include <common>

            attribute uint splatIndex;

            uniform highp sampler2D covariancesTexture;
            uniform highp usampler2D centersColorsTexture;
            uniform highp sampler2D sphericalHarmonicsTexture;
            uniform highp sampler2D sphericalHarmonicsTextureR;
            uniform highp sampler2D sphericalHarmonicsTextureG;
            uniform highp sampler2D sphericalHarmonicsTextureB;`;

        if (enableOptionalEffects || dynamicMode) {
            vertexShaderSource += `
                uniform highp usampler2D sceneIndexesTexture;
                uniform vec2 sceneIndexesTextureSize;
            `;
        }

        if (enableOptionalEffects) {
            vertexShaderSource += `
                uniform float sceneOpacity[${Constants.MaxScenes}];
                uniform int sceneVisibility[${Constants.MaxScenes}];
            `;
        }

        if (dynamicMode) {
            vertexShaderSource += `
                uniform highp mat4 transforms[${Constants.MaxScenes}];
            `;
        }

        vertexShaderSource += `
            uniform vec2 focal;
            uniform float orthoZoom;
            uniform int orthographicMode;
            uniform int pointCloudModeEnabled;
            uniform float inverseFocalAdjustment;
            uniform vec2 viewport;
            uniform vec2 basisViewport;
            uniform vec2 covariancesTextureSize;
            uniform vec2 centersColorsTextureSize;
            uniform int sphericalHarmonicsDegree;
            uniform vec2 sphericalHarmonicsTextureSize;
            uniform int sphericalHarmonics8BitMode;
            uniform int sphericalHarmonicsMultiTextureMode;
            uniform float visibleRegionRadius;
            uniform float visibleRegionFadeStartRadius;
            uniform float firstRenderTime;
            uniform float currentTime;
            uniform int fadeInComplete;
            uniform vec3 sceneCenter;
            uniform float splatScale;

            varying vec4 vColor;
            varying vec2 vUv;

            varying vec2 vPosition;

            const float sqrt8 = sqrt(8.0);
            const float minAlpha = 1.0 / 255.0;

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

            vec2 getDataUVF(in uint sIndex, in float stride, in uint offset, in vec2 dimensions) {
                vec2 samplerUV = vec2(0.0, 0.0);
                float d = float(uint(float(sIndex) * stride) + offset) / dimensions.x;
                samplerUV.y = float(floor(d)) / dimensions.y;
                samplerUV.x = fract(d);
                return samplerUV;
            }

            const float SH_C1 = 0.4886025119029199f;
            const float[5] SH_C2 = float[](1.0925484, -1.0925484, 0.3153916, -1.0925484, 0.5462742);

            const float SphericalHarmonics8BitCompressionRange = ${Constants.SphericalHarmonics8BitCompressionRange.toFixed(1)};
            const float SphericalHarmonics8BitCompressionHalfRange = SphericalHarmonics8BitCompressionRange / 2.0;
            const vec3 vec8BitSHShift = vec3(SphericalHarmonics8BitCompressionHalfRange);

            void main () {

                uint oddOffset = splatIndex & uint(0x00000001);
                uint doubleOddOffset = oddOffset * uint(2);
                bool isEven = oddOffset == uint(0);
                uint nearestEvenIndex = splatIndex - oddOffset;
                float fOddOffset = float(oddOffset);

                uvec4 sampledCenterColor = texture(centersColorsTexture, getDataUV(1, 0, centersColorsTextureSize));
                vec3 splatCenter = uintBitsToFloat(uvec3(sampledCenterColor.gba));`;

            if (dynamicMode || enableOptionalEffects) {
                vertexShaderSource += `
                    uint sceneIndex = texture(sceneIndexesTexture, getDataUV(1, 0, sceneIndexesTextureSize)).r;
                `;
            }

            if (enableOptionalEffects) {
                vertexShaderSource += `
                    float splatOpacityFromScene = sceneOpacity[sceneIndex];
                    int sceneVisible = sceneVisibility[sceneIndex];
                    if (splatOpacityFromScene <= 0.01 || sceneVisible == 0) {
                        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                        return;
                    }
                `;
            }

            if (dynamicMode) {
                vertexShaderSource += `
                    mat4 transform = transforms[sceneIndex];
                    mat4 transformModelViewMatrix = modelViewMatrix * transform;
                `;
            } else {
                vertexShaderSource += `mat4 transformModelViewMatrix = modelViewMatrix;`;
            }

            vertexShaderSource += `
                vec4 viewCenter = transformModelViewMatrix * vec4(splatCenter, 1.0);

                vec4 clipCenter = projectionMatrix * viewCenter;

                float clip = 1.2 * clipCenter.w;
                if (clipCenter.z < -clip || clipCenter.x < -clip || clipCenter.x > clip || clipCenter.y < -clip || clipCenter.y > clip) {
                    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                    return;
                }

                vPosition = position.xy;
                vColor = uintToRGBAVec(sampledCenterColor.r);
            `;

            if (maxSphericalHarmonicsDegree >= 1) {

                vertexShaderSource += `   
                if (sphericalHarmonicsDegree >= 1) {
                `;

                if (dynamicMode) {
                    vertexShaderSource += `
                        mat4 mTransform = modelMatrix * transform;
                        vec3 worldViewDir = normalize(splatCenter - vec3(inverse(mTransform) * vec4(cameraPosition, 1.0)));
                    `;
                } else {
                    vertexShaderSource += `
                        vec3 worldViewDir = normalize(splatCenter - cameraPosition);
                    `;
                }

                vertexShaderSource += `
                    vec3 sh1;
                    vec3 sh2;
                    vec3 sh3;
                `;

                if (maxSphericalHarmonicsDegree >= 2) {
                    vertexShaderSource += `
                        vec4 sampledSH0123;
                        vec4 sampledSH4567;
                        vec4 sampledSH891011;

                        vec4 sampledSH0123R;
                        vec4 sampledSH0123G;
                        vec4 sampledSH0123B;
                        
                        if (sphericalHarmonicsMultiTextureMode == 0) {
                            sampledSH0123 = texture(sphericalHarmonicsTexture, getDataUV(6, 0, sphericalHarmonicsTextureSize));
                            sampledSH4567 = texture(sphericalHarmonicsTexture, getDataUV(6, 1, sphericalHarmonicsTextureSize));
                            sampledSH891011 = texture(sphericalHarmonicsTexture, getDataUV(6, 2, sphericalHarmonicsTextureSize));
                            sh1 = sampledSH0123.rgb;
                            sh2 = vec3(sampledSH0123.a, sampledSH4567.rg);
                            sh3 = vec3(sampledSH4567.ba, sampledSH891011.r);
                        } else {
                            sampledSH0123R = texture(sphericalHarmonicsTextureR, getDataUV(2, 0, sphericalHarmonicsTextureSize));
                            sampledSH0123G = texture(sphericalHarmonicsTextureG, getDataUV(2, 0, sphericalHarmonicsTextureSize));
                            sampledSH0123B = texture(sphericalHarmonicsTextureB, getDataUV(2, 0, sphericalHarmonicsTextureSize));
                            sh1 = vec3(sampledSH0123R.rgb);
                            sh2 = vec3(sampledSH0123G.rgb);
                            sh3 = vec3(sampledSH0123B.rgb);
                        }
                    `;
                } else {
                    vertexShaderSource += `
                        if (sphericalHarmonicsMultiTextureMode == 0) {
                            vec2 shUV = getDataUVF(nearestEvenIndex, 2.5, doubleOddOffset, sphericalHarmonicsTextureSize);
                            vec4 sampledSH0123 = texture(sphericalHarmonicsTexture, shUV);
                            shUV = getDataUVF(nearestEvenIndex, 2.5, doubleOddOffset + uint(1), sphericalHarmonicsTextureSize);
                            vec4 sampledSH4567 = texture(sphericalHarmonicsTexture, shUV);
                            shUV = getDataUVF(nearestEvenIndex, 2.5, doubleOddOffset + uint(2), sphericalHarmonicsTextureSize);
                            vec4 sampledSH891011 = texture(sphericalHarmonicsTexture, shUV);
                            sh1 = vec3(sampledSH0123.rgb) * (1.0 - fOddOffset) + vec3(sampledSH0123.ba, sampledSH4567.r) * fOddOffset;
                            sh2 = vec3(sampledSH0123.a, sampledSH4567.rg) * (1.0 - fOddOffset) + vec3(sampledSH4567.gba) * fOddOffset;
                            sh3 = vec3(sampledSH4567.ba, sampledSH891011.r) * (1.0 - fOddOffset) + vec3(sampledSH891011.rgb) * fOddOffset;
                        } else {
                            vec2 sampledSH01R = texture(sphericalHarmonicsTextureR, getDataUV(2, 0, sphericalHarmonicsTextureSize)).rg;
                            vec2 sampledSH23R = texture(sphericalHarmonicsTextureR, getDataUV(2, 1, sphericalHarmonicsTextureSize)).rg;
                            vec2 sampledSH01G = texture(sphericalHarmonicsTextureG, getDataUV(2, 0, sphericalHarmonicsTextureSize)).rg;
                            vec2 sampledSH23G = texture(sphericalHarmonicsTextureG, getDataUV(2, 1, sphericalHarmonicsTextureSize)).rg;
                            vec2 sampledSH01B = texture(sphericalHarmonicsTextureB, getDataUV(2, 0, sphericalHarmonicsTextureSize)).rg;
                            vec2 sampledSH23B = texture(sphericalHarmonicsTextureB, getDataUV(2, 1, sphericalHarmonicsTextureSize)).rg;
                            sh1 = vec3(sampledSH01R.rg, sampledSH23R.r);
                            sh2 = vec3(sampledSH01G.rg, sampledSH23G.r);
                            sh3 = vec3(sampledSH01B.rg, sampledSH23B.r);
                        }
                    `;
                }

                vertexShaderSource += `
                        if (sphericalHarmonics8BitMode == 1) {
                            sh1 = sh1 * SphericalHarmonics8BitCompressionRange - vec8BitSHShift;
                            sh2 = sh2 * SphericalHarmonics8BitCompressionRange - vec8BitSHShift;
                            sh3 = sh3 * SphericalHarmonics8BitCompressionRange - vec8BitSHShift;
                        }
                        float x = worldViewDir.x;
                        float y = worldViewDir.y;
                        float z = worldViewDir.z;
                        vColor.rgb += SH_C1 * (-sh1 * y + sh2 * z - sh3 * x);
                `;

                if (maxSphericalHarmonicsDegree >= 2) {

                    vertexShaderSource += `
                        if (sphericalHarmonicsDegree >= 2) {
                            float xx = x * x;
                            float yy = y * y;
                            float zz = z * z;
                            float xy = x * y;
                            float yz = y * z;
                            float xz = x * z;

                            vec3 sh4;
                            vec3 sh5;
                            vec3 sh6;
                            vec3 sh7;
                            vec3 sh8;

                            if (sphericalHarmonicsMultiTextureMode == 0) {
                                vec4 sampledSH12131415 = texture(sphericalHarmonicsTexture, getDataUV(6, 3, sphericalHarmonicsTextureSize));
                                vec4 sampledSH16171819 = texture(sphericalHarmonicsTexture, getDataUV(6, 4, sphericalHarmonicsTextureSize));
                                vec4 sampledSH20212223 = texture(sphericalHarmonicsTexture, getDataUV(6, 5, sphericalHarmonicsTextureSize));
                                sh4 = sampledSH891011.gba;
                                sh5 = sampledSH12131415.rgb;
                                sh6 = vec3(sampledSH12131415.a, sampledSH16171819.rg);
                                sh7 = vec3(sampledSH16171819.ba, sampledSH20212223.r);
                                sh8 = sampledSH20212223.gba;
                            } else {
                                vec4 sampledSH4567R = texture(sphericalHarmonicsTextureR, getDataUV(2, 1, sphericalHarmonicsTextureSize));
                                vec4 sampledSH4567G = texture(sphericalHarmonicsTextureG, getDataUV(2, 1, sphericalHarmonicsTextureSize));
                                vec4 sampledSH4567B = texture(sphericalHarmonicsTextureB, getDataUV(2, 1, sphericalHarmonicsTextureSize));
                                sh4 = vec3(sampledSH0123R.a, sampledSH4567R.rg);
                                sh5 = vec3(sampledSH4567R.ba, sampledSH0123G.a);
                                sh6 = vec3(sampledSH4567G.rgb);
                                sh7 = vec3(sampledSH4567G.a, sampledSH0123B.a, sampledSH4567B.r);
                                sh8 = vec3(sampledSH4567B.gba);
                            }

                            if (sphericalHarmonics8BitMode == 1) {
                                sh4 = sh4 * SphericalHarmonics8BitCompressionRange - vec8BitSHShift;
                                sh5 = sh5 * SphericalHarmonics8BitCompressionRange - vec8BitSHShift;
                                sh6 = sh6 * SphericalHarmonics8BitCompressionRange - vec8BitSHShift;
                                sh7 = sh7 * SphericalHarmonics8BitCompressionRange - vec8BitSHShift;
                                sh8 = sh8 * SphericalHarmonics8BitCompressionRange - vec8BitSHShift;
                            }

                            vColor.rgb +=
                                (SH_C2[0] * xy) * sh4 +
                                (SH_C2[1] * yz) * sh5 +
                                (SH_C2[2] * (2.0 * zz - xx - yy)) * sh6 +
                                (SH_C2[3] * xz) * sh7 +
                                (SH_C2[4] * (xx - yy)) * sh8;
                        }
                    `;
                }

                vertexShaderSource += `
               
                    vColor.rgb = clamp(vColor.rgb, vec3(0.), vec3(1.));

                }

                `;
            }

            vertexShaderSource += `

                vec4 sampledCovarianceA = texture(covariancesTexture,
                                                  getDataUVF(nearestEvenIndex, 1.5, oddOffset, covariancesTextureSize));
                vec4 sampledCovarianceB = texture(covariancesTexture,
                                                  getDataUVF(nearestEvenIndex, 1.5, oddOffset + uint(1), covariancesTextureSize));

                vec3 cov3D_M11_M12_M13 = vec3(sampledCovarianceA.rgb) * (1.0 - fOddOffset) +
                                         vec3(sampledCovarianceA.ba, sampledCovarianceB.r) * fOddOffset;
                vec3 cov3D_M22_M23_M33 = vec3(sampledCovarianceA.a, sampledCovarianceB.rg) * (1.0 - fOddOffset) +
                                         vec3(sampledCovarianceB.gba) * fOddOffset;

                // Construct the 3D covariance matrix
                mat3 Vrk = mat3(
                    cov3D_M11_M12_M13.x, cov3D_M11_M12_M13.y, cov3D_M11_M12_M13.z,
                    cov3D_M11_M12_M13.y, cov3D_M22_M23_M33.x, cov3D_M22_M23_M33.y,
                    cov3D_M11_M12_M13.z, cov3D_M22_M23_M33.y, cov3D_M22_M23_M33.z
                );

                mat3 J;
                if (orthographicMode == 1) {
                    // Since the projection is linear, we don't need an approximation
                    J = transpose(mat3(orthoZoom, 0.0, 0.0,
                                       0.0, orthoZoom, 0.0,
                                       0.0, 0.0, 0.0));
                } else {
                    // Construct the Jacobian of the affine approximation of the projection matrix. It will be used to transform the
                    // 3D covariance matrix instead of using the actual projection matrix because that transformation would
                    // require a non-linear component (perspective division) which would yield a non-gaussian result.
                    float s = 1.0 / (viewCenter.z * viewCenter.z);
                    J = mat3(
                        focal.x / viewCenter.z, 0., -(focal.x * viewCenter.x) * s,
                        0., focal.y / viewCenter.z, -(focal.y * viewCenter.y) * s,
                        0., 0., 0.
                    );
                }

                // Concatenate the projection approximation with the model-view transformation
                mat3 W = transpose(mat3(transformModelViewMatrix));
                mat3 T = W * J;

                // Transform the 3D covariance matrix (Vrk) to compute the 2D covariance matrix
                mat3 cov2Dm = transpose(T) * Vrk * T;
                `;

            if (antialiased) {
                vertexShaderSource += `
                    float detOrig = cov2Dm[0][0] * cov2Dm[1][1] - cov2Dm[0][1] * cov2Dm[0][1];
                    cov2Dm[0][0] += 0.3;
                    cov2Dm[1][1] += 0.3;
                    float detBlur = cov2Dm[0][0] * cov2Dm[1][1] - cov2Dm[0][1] * cov2Dm[0][1];
                    vColor.a *= sqrt(max(detOrig / detBlur, 0.0));
                    if (vColor.a < minAlpha) return;
                `;
            } else {
                vertexShaderSource += `
                    cov2Dm[0][0] += 0.3;
                    cov2Dm[1][1] += 0.3;
                `;
            }

            vertexShaderSource += `

                // We are interested in the upper-left 2x2 portion of the projected 3D covariance matrix because
                // we only care about the X and Y values. We want the X-diagonal, cov2Dm[0][0],
                // the Y-diagonal, cov2Dm[1][1], and the correlation between the two cov2Dm[0][1]. We don't
                // need cov2Dm[1][0] because it is a symetric matrix.
                vec3 cov2Dv = vec3(cov2Dm[0][0], cov2Dm[0][1], cov2Dm[1][1]);

                vec3 ndcCenter = clipCenter.xyz / clipCenter.w;

                // We now need to solve for the eigen-values and eigen vectors of the 2D covariance matrix
                // so that we can determine the 2D basis for the splat. This is done using the method described
                // here: https://people.math.harvard.edu/~knill/teaching/math21b2004/exhibits/2dmatrices/index.html
                // After calculating the eigen-values and eigen-vectors, we calculate the basis for rendering the splat
                // by normalizing the eigen-vectors and then multiplying them by (sqrt(8) * sqrt(eigen-value)), which is
                // equal to scaling them by sqrt(8) standard deviations.
                //
                // This is a different approach than in the original work at INRIA. In that work they compute the
                // max extents of the projected splat in screen space to form a screen-space aligned bounding rectangle
                // which forms the geometry that is actually rasterized. The dimensions of that bounding box are 3.0
                // times the square root of the maximum eigen-value, or 3 standard deviations. They then use the inverse
                // 2D covariance matrix (called 'conic') in the CUDA rendering thread to determine fragment opacity by
                // calculating the full gaussian: exp(-0.5 * (X - mean) * conic * (X - mean)) * splat opacity
                float a = cov2Dv.x;
                float d = cov2Dv.z;
                float b = cov2Dv.y;
                float D = a * d - b * b;
                float trace = a + d;
                float traceOver2 = 0.5 * trace;
                float term2 = sqrt(max(0.1f, traceOver2 * traceOver2 - D));
                float eigenValue1 = traceOver2 + term2;
                float eigenValue2 = traceOver2 - term2;

                if (pointCloudModeEnabled == 1) {
                    eigenValue1 = eigenValue2 = 0.2;
                }

                if (eigenValue2 <= 0.0) return;

                vec2 eigenVector1 = normalize(vec2(b, eigenValue1 - a));
                // since the eigen vectors are orthogonal, we derive the second one from the first
                vec2 eigenVector2 = vec2(eigenVector1.y, -eigenVector1.x);

                // We use sqrt(8) standard deviations instead of 3 to eliminate more of the splat with a very low opacity.
                vec2 basisVector1 = eigenVector1 * splatScale * min(sqrt8 * sqrt(eigenValue1), ${parseInt(maxScreenSpaceSplatSize)}.0);
                vec2 basisVector2 = eigenVector2 * splatScale * min(sqrt8 * sqrt(eigenValue2), ${parseInt(maxScreenSpaceSplatSize)}.0);

                if (fadeInComplete == 0) {
                    float opacityAdjust = 1.0;
                    float centerDist = length(splatCenter - sceneCenter);
                    float renderTime = max(currentTime - firstRenderTime, 0.0);

                    float fadeDistance = 0.75;
                    float distanceLoadFadeInFactor = step(visibleRegionFadeStartRadius, centerDist);
                    distanceLoadFadeInFactor = (1.0 - distanceLoadFadeInFactor) +
                                               (1.0 - clamp((centerDist - visibleRegionFadeStartRadius) / fadeDistance, 0.0, 1.0)) *
                                               distanceLoadFadeInFactor;
                    opacityAdjust *= distanceLoadFadeInFactor;
                    vColor.a *= opacityAdjust;
                }
                `;

            if (enableOptionalEffects) {
                vertexShaderSource += `
                     vColor.a *= splatOpacityFromScene;
                `;
            }

            vertexShaderSource += `
                vec2 ndcOffset = vec2(vPosition.x * basisVector1 + vPosition.y * basisVector2) *
                                 basisViewport * 2.0 * inverseFocalAdjustment;

                vec4 quadPos = vec4(ndcCenter.xy + ndcOffset, ndcCenter.z, 1.0);
                gl_Position = quadPos;

                // Scale the position data we send to the fragment shader
                vPosition *= sqrt8;
            }`;

        const fragmentShaderSource = `
            precision highp float;
            #include <common>
 
            uniform vec3 debugColor;

            varying vec4 vColor;
            varying vec2 vUv;

            varying vec2 vPosition;

            void main () {
                // Compute the positional squared distance from the center of the splat to the current fragment.
                float A = dot(vPosition, vPosition);
                // Since the positional data in vPosition has been scaled by sqrt(8), the squared result will be
                // scaled by a factor of 8. If the squared result is larger than 8, it means it is outside the ellipse
                // defined by the rectangle formed by vPosition. It also means it's farther
                // away than sqrt(8) standard deviations from the mean.
                if (A > 8.0) discard;
                vec3 color = vColor.rgb;

                // Since the rendered splat is scaled by sqrt(8), the inverse covariance matrix that is part of
                // the gaussian formula becomes the identity matrix. We're then left with (X - mean) * (X - mean),
                // and since 'mean' is zero, we have X * X, which is the same as A:
                float opacity = exp(-0.5 * A) * vColor.a;

                gl_FragColor = vec4(color.rgb, opacity);
            }`;

        const uniforms = {
            'sceneCenter': {
                'type': 'v3',
                'value': new THREE.Vector3()
            },
            'fadeInComplete': {
                'type': 'i',
                'value': 0
            },
            'orthographicMode': {
                'type': 'i',
                'value': 0
            },
            'visibleRegionFadeStartRadius': {
                'type': 'f',
                'value': 0.0
            },
            'visibleRegionRadius': {
                'type': 'f',
                'value': 0.0
            },
            'currentTime': {
                'type': 'f',
                'value': 0.0
            },
            'firstRenderTime': {
                'type': 'f',
                'value': 0.0
            },
            'covariancesTexture': {
                'type': 't',
                'value': null
            },
            'centersColorsTexture': {
                'type': 't',
                'value': null
            },
            'sphericalHarmonicsTexture': {
                'type': 't',
                'value': null
            },
            'sphericalHarmonicsTextureR': {
                'type': 't',
                'value': null
            },
            'sphericalHarmonicsTextureG': {
                'type': 't',
                'value': null
            },
            'sphericalHarmonicsTextureB': {
                'type': 't',
                'value': null
            },
            'focal': {
                'type': 'v2',
                'value': new THREE.Vector2()
            },
            'orthoZoom': {
                'type': 'f',
                'value': 1.0
            },
            'inverseFocalAdjustment': {
                'type': 'f',
                'value': 1.0
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
            },
            'sphericalHarmonicsDegree': {
                'type': 'i',
                'value': maxSphericalHarmonicsDegree
            },
            'sphericalHarmonicsTextureSize': {
                'type': 'v2',
                'value': new THREE.Vector2(1024, 1024)
            },
            'sphericalHarmonics8BitMode': {
                'type': 'i',
                'value': 0
            },
            'sphericalHarmonicsMultiTextureMode': {
                'type': 'i',
                'value': 0
            },
            'splatScale': {
                'type': 'f',
                'value': splatScale
            },
            'pointCloudModeEnabled': {
                'type': 'i',
                'value': pointCloudModeEnabled ? 1 : 0
            }
        };

        if (dynamicMode || enableOptionalEffects) {
            uniforms['sceneIndexesTexture'] = {
                'type': 't',
                'value': null
            };
            uniforms['sceneIndexesTextureSize'] = {
                'type': 'v2',
                'value': new THREE.Vector2(1024, 1024)
            };
        }

        if (enableOptionalEffects) {
            const sceneOpacity = [];
            for (let i = 0; i < Constants.MaxScenes; i++) {
                sceneOpacity.push(1.0);
            }
            uniforms['sceneOpacity'] ={
                'type': 'f',
                'value': sceneOpacity
            };

            const sceneVisibility = [];
            for (let i = 0; i < Constants.MaxScenes; i++) {
                sceneVisibility.push(1);
            }
            uniforms['sceneVisibility'] ={
                'type': 'i',
                'value': sceneVisibility
            };
        }

        if (dynamicMode) {
            const transformMatrices = [];
            for (let i = 0; i < Constants.MaxScenes; i++) {
                transformMatrices.push(new THREE.Matrix4());
            }
            uniforms['transforms'] = {
                'type': 'mat4',
                'value': transformMatrices
            };
        }

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

}
