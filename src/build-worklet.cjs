const esbuild = require('esbuild');
const fs = require('node:fs/promises');

esbuild.build({
  entryPoints: ['src/rnnoise-worklet-entry.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'esnext',
  supported: { 'import-meta': true },
  banner: { js: 'globalThis.window = globalThis; globalThis.WorkerGlobalScope = globalThis.WorkerGlobalScope || class WorkerGlobalScope {};' },
  plugins: [{
    name: 'rnnoise-worklet-url-compatibility',
    setup(build) {
      build.onLoad({ filter: /@shiguredo[\\/]rnnoise-wasm[\\/]dist[\\/]rnnoise\.js$/ }, async args => {
        const contents = await fs.readFile(args.path, 'utf8');
        return {
          contents: contents.replace(
            'QA = (A) => A.startsWith("file://")',
            'QA = (A) => String(A?.href ?? A).startsWith("file://")'
          ),
          loader: 'js'
        };
      });
    }
  }],
  outfile: 'src/rnnoise-worklet.mjs'
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
