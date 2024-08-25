import * as THREE from 'three';
import { SplatMaterial } from './SplatMaterial.js';

export class SplatMaterial2D {

    /**
     * Build the Three.js material that is used to render the splats.
     * @param {number} dynamicMode If true, it means the scene geometry represented by this splat mesh is not stationary or
     *                             that the splat count might change
     * @param {boolean} enableOptionalEffects When true, allows for usage of extra properties and attributes in the shader for effects
     *                                        such as opacity adjustment. Default is false for performance reasons.
     * @param {number} splatScale Value by which all splats are scaled in screen-space (default is 1.0)
     * @param {number} pointCloudModeEnabled Render all splats as screen-space circles
     * @param {number} maxSphericalHarmonicsDegree Degree of spherical harmonics to utilize in rendering splats
     * @return {THREE.ShaderMaterial}
     */
    static build(dynamicMode = false, enableOptionalEffects = false, splatScale = 1.0,
                 pointCloudModeEnabled = false, maxSphericalHarmonicsDegree = 0) {

        const customVertexVars = `
            uniform vec2 scaleRotationsTextureSize;
            uniform highp sampler2D scaleRotationsTexture;
            varying mat3 vT;
            varying vec2 vQuadCenter;
            varying vec2 vFragCoord;
        `;

        let vertexShaderSource = SplatMaterial.buildVertexShaderBase(dynamicMode, enableOptionalEffects,
                                                                     maxSphericalHarmonicsDegree, customVertexVars);
        vertexShaderSource += SplatMaterial2D.buildVertexShaderProjection();
        const fragmentShaderSource = SplatMaterial2D.buildFragmentShader();

        const uniforms = SplatMaterial.getUniforms(dynamicMode, enableOptionalEffects,
                                                   maxSphericalHarmonicsDegree, splatScale, pointCloudModeEnabled);

        uniforms['scaleRotationsTexture'] = {
            'type': 't',
            'value': null
        };
        uniforms['scaleRotationsTextureSize'] = {
            'type': 'v2',
            'value': new THREE.Vector2(1024, 1024)
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

    static buildVertexShaderProjection() {

        // Original CUDA code for calculating splat-to-screen transformation, for reference
        /*
            glm::mat3 R = quat_to_rotmat(rot);
            glm::mat3 S = scale_to_mat(scale, mod);
            glm::mat3 L = R * S;

            // center of Gaussians in the camera coordinate
            glm::mat3x4 splat2world = glm::mat3x4(
                glm::vec4(L[0], 0.0),
                glm::vec4(L[1], 0.0),
                glm::vec4(p_orig.x, p_orig.y, p_orig.z, 1)
            );

            glm::mat4 world2ndc = glm::mat4(
                projmatrix[0], projmatrix[4], projmatrix[8], projmatrix[12],
                projmatrix[1], projmatrix[5], projmatrix[9], projmatrix[13],
                projmatrix[2], projmatrix[6], projmatrix[10], projmatrix[14],
                projmatrix[3], projmatrix[7], projmatrix[11], projmatrix[15]
            );

            glm::mat3x4 ndc2pix = glm::mat3x4(
                glm::vec4(float(W) / 2.0, 0.0, 0.0, float(W-1) / 2.0),
                glm::vec4(0.0, float(H) / 2.0, 0.0, float(H-1) / 2.0),
                glm::vec4(0.0, 0.0, 0.0, 1.0)
            );

            T = glm::transpose(splat2world) * world2ndc * ndc2pix;
            normal = transformVec4x3({L[2].x, L[2].y, L[2].z}, viewmatrix);
        */

        // Compute a 2D-to-2D mapping matrix from a tangent plane into a image plane
        // given a 2D gaussian parameters. T = WH (from the paper: https://arxiv.org/pdf/2403.17888)
        let vertexShaderSource = `

            vec4 scaleRotationA = texture(scaleRotationsTexture, getDataUVF(nearestEvenIndex, 1.5,
                                                                            oddOffset, scaleRotationsTextureSize));
            vec4 scaleRotationB = texture(scaleRotationsTexture, getDataUVF(nearestEvenIndex, 1.5,
                                                                            oddOffset + uint(1), scaleRotationsTextureSize));

            vec3 scaleRotation123 = vec3(scaleRotationA.rgb) * (1.0 - fOddOffset) +
                                    vec3(scaleRotationA.ba, scaleRotationB.r) * fOddOffset;
            vec3 scaleRotation456 = vec3(scaleRotationA.a, scaleRotationB.rg) * (1.0 - fOddOffset) +
                                    vec3(scaleRotationB.gba) * fOddOffset;

            float missingW = sqrt(1.0 - scaleRotation456.x * scaleRotation456.x - scaleRotation456.y *
                                    scaleRotation456.y - scaleRotation456.z * scaleRotation456.z);
            mat3 R = quaternionToRotationMatrix(scaleRotation456.r, scaleRotation456.g, scaleRotation456.b, missingW);
            mat3 S = mat3(scaleRotation123.r, 0.0, 0.0,
                            0.0, scaleRotation123.g, 0.0,
                            0.0, 0.0, scaleRotation123.b);
            
            mat3 L = R * S;

            mat3x4 splat2World = mat3x4(vec4(L[0], 0.0),
                                        vec4(L[1], 0.0),
                                        vec4(splatCenter.x, splatCenter.y, splatCenter.z, 1.0));

            mat4 world2ndc = transpose(projectionMatrix * transformModelViewMatrix);

            mat3x4 ndc2pix = mat3x4(vec4(viewport.x / 2.0, 0.0, 0.0, (viewport.x - 1.0) / 2.0),
                                    vec4(0.0, viewport.y / 2.0, 0.0, (viewport.y - 1.0) / 2.0),
                                    vec4(0.0, 0.0, 0.0, 1.0));

            mat3 T = transpose(splat2World) * world2ndc * ndc2pix;
            vec3 normal = vec3(viewMatrix * vec4(L[0][2], L[1][2], L[2][2], 0.0));
        `;

        // Original CUDA code for projection to 2D, for reference
        /*
            float3 T0 = {T[0][0], T[0][1], T[0][2]};
            float3 T1 = {T[1][0], T[1][1], T[1][2]};
            float3 T3 = {T[2][0], T[2][1], T[2][2]};

            // Compute AABB
            float3 temp_point = {1.0f, 1.0f, -1.0f};
            float distance = sumf3(T3 * T3 * temp_point);
            float3 f = (1 / distance) * temp_point;
            if (distance == 0.0) return false;

            point_image = {
                sumf3(f * T0 * T3),
                sumf3(f * T1 * T3)
            };

            float2 temp = {
                sumf3(f * T0 * T0),
                sumf3(f * T1 * T1)
            };
            float2 half_extend = point_image * point_image - temp;
            extent = sqrtf2(maxf2(1e-4, half_extend));
            return true;
        */

        // Computing the bounding box of the 2D Gaussian and its center
        // The center of the bounding box is used to create a low pass filter.
        // This code is based off the reference implementation and creates an AABB aligned
        // with the screen for the quad to be rendered.
        const referenceQuadGeneration = `
            vec3 T0 = vec3(T[0][0], T[0][1], T[0][2]);
            vec3 T1 = vec3(T[1][0], T[1][1], T[1][2]);
            vec3 T3 = vec3(T[2][0], T[2][1], T[2][2]);

            vec3 tempPoint = vec3(1.0, 1.0, -1.0);
            float distance = (T3.x * T3.x * tempPoint.x) + (T3.y * T3.y * tempPoint.y) + (T3.z * T3.z * tempPoint.z);
            vec3 f = (1.0 / distance) * tempPoint;
            if (abs(distance) < 0.00001) return;

            float pointImageX = (T0.x * T3.x * f.x) + (T0.y * T3.y * f.y) + (T0.z * T3.z * f.z);
            float pointImageY = (T1.x * T3.x * f.x) + (T1.y * T3.y * f.y) + (T1.z * T3.z * f.z);
            vec2 pointImage = vec2(pointImageX, pointImageY);

            float tempX = (T0.x * T0.x * f.x) + (T0.y * T0.y * f.y) + (T0.z * T0.z * f.z);
            float tempY = (T1.x * T1.x * f.x) + (T1.y * T1.y * f.y) + (T1.z * T1.z * f.z);
            vec2 temp = vec2(tempX, tempY);

            vec2 halfExtend = pointImage * pointImage - temp;
            vec2 extent = sqrt(max(vec2(0.0001), halfExtend));
            float radius = max(extent.x, extent.y);

            vec2 ndcOffset = ((position.xy * radius * 3.0) * basisViewport * 2.0);

            vec4 quadPos = vec4(ndcCenter.xy + ndcOffset, ndcCenter.z, 1.0);
            gl_Position = quadPos;

            vT = T;
            vQuadCenter = pointImage;
            vFragCoord = (quadPos.xy * 0.5 + 0.5) * viewport;
        `;

        const useRefImplementation = false;
        if (useRefImplementation) {
            vertexShaderSource += referenceQuadGeneration;
        } else {
            // Create a quad that is aligned with the eigen vectors of the projected gaussian for rendering.
            // This is a different approach than the reference implementation, similar to how the rendering of
            // 3D gaussians in this viewer differs from the reference implementation. If the quad is too small
            // (smaller than a pixel), then revert to the reference implementation.
            vertexShaderSource += `

                mat4 splat2World4 = mat4(vec4(L[0], 0.0),
                                        vec4(L[1], 0.0),
                                        vec4(L[2], 0.0),
                                        vec4(splatCenter.x, splatCenter.y, splatCenter.z, 1.0));

                mat4 Tt = transpose(transpose(splat2World4) * world2ndc);

                vec4 tempPoint1 = Tt * vec4(1.0, 0.0, 0.0, 1.0);
                tempPoint1 /= tempPoint1.w;

                vec4 tempPoint2 = Tt * vec4(0.0, 1.0, 0.0, 1.0);
                tempPoint2 /= tempPoint2.w;

                vec4 center = Tt * vec4(0.0, 0.0, 0.0, 1.0);
                center /= center.w;

                vec2 basisVector1 = tempPoint1.xy - center.xy;
                vec2 basisVector2 = tempPoint2.xy - center.xy;

                vec2 basisVector1Screen = basisVector1 * 0.5 * viewport;
                vec2 basisVector2Screen = basisVector2 * 0.5 * viewport;

                const float minPix = 1.;
                if (length(basisVector1Screen) < minPix || length(basisVector2Screen) < minPix) {
                    ${referenceQuadGeneration}
                } else {
                    vec2 ndcOffset = vec2(position.x * basisVector1 + position.y * basisVector2) * 3.0 * inverseFocalAdjustment;
                    vec4 quadPos = vec4(ndcCenter.xy + ndcOffset, ndcCenter.z, 1.0);
                    gl_Position = quadPos;

                    vT = T;
                    vQuadCenter = center.xy;
                    vFragCoord = (quadPos.xy * 0.5 + 0.5) * viewport;
                }
            `;
        }

        vertexShaderSource += SplatMaterial.getVertexShaderFadeIn();
        vertexShaderSource += `}`;

        return vertexShaderSource;
    }

    static buildFragmentShader() {

        // Original CUDA code for splat intersection, for reference
        /*
            const float2 xy = collected_xy[j];
            const float3 Tu = collected_Tu[j];
            const float3 Tv = collected_Tv[j];
            const float3 Tw = collected_Tw[j];
            float3 k = pix.x * Tw - Tu;
            float3 l = pix.y * Tw - Tv;
            float3 p = cross(k, l);
            if (p.z == 0.0) continue;
            float2 s = {p.x / p.z, p.y / p.z};
            float rho3d = (s.x * s.x + s.y * s.y);
            float2 d = {xy.x - pixf.x, xy.y - pixf.y};
            float rho2d = FilterInvSquare * (d.x * d.x + d.y * d.y);

            // compute intersection and depth
            float rho = min(rho3d, rho2d);
            float depth = (rho3d <= rho2d) ? (s.x * Tw.x + s.y * Tw.y) + Tw.z : Tw.z;
            if (depth < near_n) continue;
            float4 nor_o = collected_normal_opacity[j];
            float normal[3] = {nor_o.x, nor_o.y, nor_o.z};
            float opa = nor_o.w;

            float power = -0.5f * rho;
            if (power > 0.0f)
                continue;

            // Eq. (2) from 3D Gaussian splatting paper.
            // Obtain alpha by multiplying with Gaussian opacity
            // and its exponential falloff from mean.
            // Avoid numerical instabilities (see paper appendix).
            float alpha = min(0.99f, opa * exp(power));
            if (alpha < 1.0f / 255.0f)
                continue;
            float test_T = T * (1 - alpha);
            if (test_T < 0.0001f)
            {
                done = true;
                continue;
            }

            float w = alpha * T;
        */
        let fragmentShaderSource = `
            precision highp float;
            #include <common>

            uniform vec3 debugColor;

            varying vec4 vColor;
            varying vec2 vUv;
            varying vec2 vPosition;
            varying mat3 vT;
            varying vec2 vQuadCenter;
            varying vec2 vFragCoord;

            void main () {

                const float FilterInvSquare = 2.0;
                const float near_n = 0.2;
                const float T = 1.0;

                vec2 xy = vQuadCenter;
                vec3 Tu = vT[0];
                vec3 Tv = vT[1];
                vec3 Tw = vT[2];
                vec3 k = vFragCoord.x * Tw - Tu;
                vec3 l = vFragCoord.y * Tw - Tv;
                vec3 p = cross(k, l);
                if (p.z == 0.0) discard;
                vec2 s = vec2(p.x / p.z, p.y / p.z);
                float rho3d = (s.x * s.x + s.y * s.y); 
                vec2 d = vec2(xy.x - vFragCoord.x, xy.y - vFragCoord.y);
                float rho2d = FilterInvSquare * (d.x * d.x + d.y * d.y); 

                // compute intersection and depth
                float rho = min(rho3d, rho2d);
                float depth = (rho3d <= rho2d) ? (s.x * Tw.x + s.y * Tw.y) + Tw.z : Tw.z; 
                if (depth < near_n) discard;
                //  vec4 nor_o = collected_normal_opacity[j];
                //  float normal[3] = {nor_o.x, nor_o.y, nor_o.z};
                float opa = vColor.a;

                float power = -0.5f * rho;
                if (power > 0.0f) discard;

                // Eq. (2) from 3D Gaussian splatting paper.
                // Obtain alpha by multiplying with Gaussian opacity
                // and its exponential falloff from mean.
                // Avoid numerical instabilities (see paper appendix). 
                float alpha = min(0.99f, opa * exp(power));
                if (alpha < 1.0f / 255.0f) discard;
                float test_T = T * (1.0 - alpha);
                if (test_T < 0.0001)discard;

                float w = alpha * T;
                gl_FragColor = vec4(vColor.rgb, w);
            }
        `;

        return fragmentShaderSource;
    }
}
