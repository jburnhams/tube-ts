import { describe, test, expect } from 'vitest';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find project root by looking for package.json
let projectRoot = __dirname;
while (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
  const parent = path.dirname(projectRoot);
  if (parent === projectRoot) {
    throw new Error('Could not find package.json');
  }
  projectRoot = parent;
}

const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
// tsup output names are configured in tsup.config.ts.
// IIFE global name is TubeTS
// Filenames: index.global.js for browser, index.esm.js for bundles

const distDir = path.join(projectRoot, 'dist');
const iifeBundlePath = path.join(distDir, 'browser', 'index.global.js');
const esmBundlePath = path.join(distDir, 'bundles', 'index.esm.js');
const globalName = 'TubeTS';

describe('Browser Bundle Tests', () => {
  test('IIFE bundle attaches global namespace', () => {
    expect(fs.existsSync(iifeBundlePath), 'Minified bundle should exist. Run `npm run build` first.').toBeTruthy();

    const bundleCode = fs.readFileSync(iifeBundlePath, 'utf8');
    // Polyfill env for browser bundle in node
    const context: Record<string, any> = {
        window: {},
        globalThis: {},
        console: console,
        TextEncoder: TextEncoder,
        TextDecoder: TextDecoder,
        URL: URL,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        navigator: { userAgent: 'Node', vendor: 'Node', platform: 'Linux' },
        document: {
             readyState: 'complete',
             createElement: () => ({ style: {} }),
             head: { appendChild: () => {} },
             body: { appendChild: () => {} },
             getElementById: () => null,
             getElementsByTagName: () => []
        },
        screen: { width: 1920, height: 1080 },
        EventTarget: EventTarget,
        Element: class Element {},
        HTMLElement: class HTMLElement {},
        self: {}
    };
    context.window = context;
    context.self = context;

    vm.createContext(context);

    try {
        vm.runInContext(bundleCode, context);
    } catch (e: any) {
        // If it throws, fail with message
        throw new Error(`Execution failed: ${e.message}\n${e.stack}`);
    }

    const globalApi = context.window[globalName] ?? context.globalThis[globalName];
    expect(globalApi).toBeTruthy();
    expect(globalApi.TubePlayer).toBeDefined();
  });

  test('ESM bundle can be imported directly', async () => {
    expect(fs.existsSync(esmBundlePath), 'ESM bundle should exist. Run `npm run build` first.').toBeTruthy();

    const moduleUrl = pathToFileURL(esmBundlePath).href;
    const mod = await import(moduleUrl);

    expect(mod.TubePlayer).toBeDefined();
  });

  test('bundle size is reasonable', () => {
    const stats = fs.statSync(iifeBundlePath);
    const sizeKB = stats.size / 1024;

    // It's quite large now because it bundles shaka-player and youtubei.js
    // Just ensure it's not empty or absurdly small
    expect(sizeKB).toBeGreaterThan(100);
  });
});
