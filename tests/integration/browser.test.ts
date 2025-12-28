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
const libraryName = packageJson.name;
const globalName = toPascalCase(libraryName);

function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

// Path to the generated bundles
const distDir = path.join(projectRoot, 'dist');
const iifeBundlePath = path.join(distDir, 'browser', `${libraryName}.min.js`);
const esmBundlePath = path.join(distDir, 'bundles', `${libraryName}.esm.js`);

describe('Browser Bundle Tests', () => {
  test('IIFE bundle attaches global namespace', () => {
    expect(fs.existsSync(iifeBundlePath), 'Minified bundle should exist. Run `npm run build` first.').toBeTruthy();

    const bundleCode = fs.readFileSync(iifeBundlePath, 'utf8');
    const context: Record<string, any> = { window: {}, globalThis: {} };
    vm.createContext(context);

    expect(() => {
      vm.runInContext(bundleCode, context);
    }).not.toThrow();

    const globalApi = context.window[globalName] ?? context.globalThis[globalName];
    expect(globalApi).toBeTruthy();
    expect(typeof globalApi.hello).toBe('function');
    expect(typeof globalApi.goodbye).toBe('function');
    expect(typeof globalApi.Greeter).toBe('function');
  });

  test('ESM bundle can be imported directly', async () => {
    expect(fs.existsSync(esmBundlePath), 'ESM bundle should exist. Run `npm run build` first.').toBeTruthy();

    const moduleUrl = pathToFileURL(esmBundlePath).href;
    const mod = await import(moduleUrl);

    expect(typeof mod.hello).toBe('function');
    expect(typeof mod.goodbye).toBe('function');
    expect(typeof mod.Greeter).toBe('function');
  });

  test('bundle size is reasonable', () => {
    const stats = fs.statSync(iifeBundlePath);
    const sizeKB = stats.size / 1024;

    // Bundle should be less than 100KB
    expect(sizeKB).toBeLessThan(100);

    // Bundle should be more than 0.1KB (sanity check)
    expect(sizeKB).toBeGreaterThan(0.1);
  });
});

describe('Functional Tests - Verify Bundle Works Correctly', () => {
  // Helper to load the bundle and get its exports exactly as the browser does
  async function loadBundleModule() {
    const moduleUrl = pathToFileURL(esmBundlePath);
    return await import(moduleUrl.href);
  }

  test('hello function works in browser bundle', async () => {
    const bundle = await loadBundleModule();

    expect(bundle.hello()).toBe('Hello, World!');
    expect(bundle.hello('Browser')).toBe('Hello, Browser!');
  });

  test('goodbye function works in browser bundle', async () => {
    const bundle = await loadBundleModule();

    expect(bundle.goodbye()).toBe('Goodbye, World!');
    expect(bundle.goodbye('Browser')).toBe('Goodbye, Browser!');
  });

  test('Greeter class works in browser bundle', async () => {
    const bundle = await loadBundleModule();

    const greeter = new bundle.Greeter('Test');
    expect(greeter.greet()).toBe('Hello, Test!');
    expect(greeter.farewell()).toBe('Goodbye, Test!');
  });

  test('IIFE bundle exports work correctly', () => {
    const bundleCode = fs.readFileSync(iifeBundlePath, 'utf8');
    const context: Record<string, any> = {
      window: {},
      globalThis: {},
      console: console // Allow console for debugging
    };
    vm.createContext(context);
    vm.runInContext(bundleCode, context);

    const api = context.window[globalName] ?? context.globalThis[globalName];

    // Test hello function
    expect(api.hello()).toBe('Hello, World!');
    expect(api.hello('IIFE')).toBe('Hello, IIFE!');

    // Test goodbye function
    expect(api.goodbye()).toBe('Goodbye, World!');
    expect(api.goodbye('IIFE')).toBe('Goodbye, IIFE!');

    // Test Greeter class
    const greeter = new api.Greeter('VM');
    expect(greeter.greet()).toBe('Hello, VM!');
    expect(greeter.farewell()).toBe('Goodbye, VM!');
  });
});
