import { base64 } from "./util/import-base-64.js";
import terser from '@rollup/plugin-terser';
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from '@rollup/plugin-json';

const globals = {
    'three': 'THREE',
    '@aws-sdk/client-s3': 'AWS_SDK_S3'
};

export default [{
        input: './src/index.js',
        treeshake: false,
        external: [
            'three',
            '@aws-sdk/client-s3'
        ],
        output: [{
                name: 'Gaussian Splats 3D',
                extend: true,
                format: 'umd',
                file: './build/gaussian-splats-3d.umd.cjs',
                globals: globals,
                sourcemap: true,
                target: 'es2017'
            },
            {
                name: 'Gaussian Splats 3D',
                extend: true,
                format: 'umd',
                file: './build/gaussian-splats-3d.umd.min.cjs',
                globals: globals,
                sourcemap: true,
                target: 'es2017',
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
        external: [
            'three'
        ],
        output: [{
                name: 'Gaussian Splats 3D',
                format: 'esm',
                file: './build/gaussian-splats-3d.module.js',
                sourcemap: true
            },
            {
                name: 'Gaussian Splats 3D',
                format: 'esm',
                file: './build/gaussian-splats-3d.module.min.js',
                sourcemap: true,
                plugins: [terser()]
            }
        ],
        plugins: [
            resolve({ browser: true, preferBuiltins: false }),
            commonjs(),
            json(),
            base64({
                include: "**/*.wasm",
                sourceMap: false
            })
        ]
    }
];