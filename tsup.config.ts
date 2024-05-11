import type { Options } from 'tsup'

export const tsup: Options = {
    splitting: true,
    clean: true, // clean up the dist folder
    dts: true, // generate dts files
    format: ['cjs', 'esm'], // generate cjs and esm files
    skipNodeModulesBundle: true,
    entryPoints: ['src/index.ts'],
    target: 'es2020',
    outDir: 'lib',
    entry: ['index.ts'], //include all files under src
}