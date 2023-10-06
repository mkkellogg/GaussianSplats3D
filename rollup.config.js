import { base64 } from "rollup-plugin-base64";

export default [
    {
        input: './src/index.js',
        treeshake: false,
        external: p => /^three/.test( p ),
        output: {
            name: 'Gaussian Splat 3D',
            extend: true,
            format: 'umd',
            file: './build/gaussian-splat-3d.umd.cjs',
            sourcemap: true,
            globals: p => /^three/.test( p ) ? 'THREE' : null,
        },
        plugins: [
            base64({ include: "**/*.wasm" })
        ]
    },
    {
        input: './src/index.js',
        treeshake: false,
        external: p => /^three/.test( p ),
        output: {
            name: 'Gaussian Splat 3D',
            format: 'esm',
            file: './build/gaussian-splat-3d.module.js',
            sourcemap: true,
            globals: p => /^three/.test( p ) ? 'THREE' : null,
        },
        plugins: [
            base64({ include: "**/*.wasm" })
        ]
    }
];