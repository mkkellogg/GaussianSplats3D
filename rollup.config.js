import { base64 } from "./util/import-base-64.js";
import terser from '@rollup/plugin-terser';

export default [
    {
        input: './src/index.js',
        treeshake: false,
        external: p => /^three/.test( p ),
        output: [
            {
                name: 'Gaussian Splats 3D',
                extend: true,
                format: 'umd',
                file: './build/gaussian-splats-3d.umd.cjs',
                sourcemap: true,
                globals: p => /^three/.test( p ) ? 'THREE' : null,
            },
            {
                name: 'Gaussian Splats 3D',
                extend: true,
                format: 'umd',
                file: './build/gaussian-splats-3d.umd.min.cjs',
                sourcemap: true,
                globals: p => /^three/.test( p ) ? 'THREE' : null,
                plugins: [terser()]
            }
        ],
        plugins: [
            base64({ include: "**/*.wasm" })
        ]
    },
    {
        input: './src/index.js',
        treeshake: false,
        external: p => /^three/.test( p ),
        output: [
            {
                name: 'Gaussian Splats 3D',
                format: 'esm',
                file: './build/gaussian-splats-3d.module.js',
                sourcemap: true,
                globals: p => /^three/.test( p ) ? 'THREE' : null,
            },
            {
                name: 'Gaussian Splats 3D',
                format: 'esm',
                file: './build/gaussian-splats-3d.module.min.js',
                sourcemap: true,
                globals: p => /^three/.test( p ) ? 'THREE' : null,
                plugins: [terser()]
            }
        ],
        plugins: [
            base64({ 
                include: "**/*.wasm",
                sourceMap: false
            })
        ]
    }
];