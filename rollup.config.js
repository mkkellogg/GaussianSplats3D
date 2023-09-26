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
    }
];