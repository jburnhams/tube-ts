import { describe, test, expect, vi } from 'vitest';
import { Platform } from 'youtubei.js/web';
import '../../src/TubePlayer';

describe('Platform.shim.eval', () => {
  test('should throw on missing nFunction', async () => {
    const data = {
      output: `
        var exportedVars = {
          // nFunction is missing
        };
      `,
      exported: [] as string[]
    };
    const env = { n: 'some-n-value' };

    await expect(Platform.shim.eval(data, env)).rejects.toThrow(/nFunction not exported/);
  });

  test('should handle missing sigFunction gracefully', async () => {
    const data = {
      output: `
        var exportedVars = {
          // sigFunction is missing
        };
      `,
      exported: [] as string[]
    };
    const env = { sig: 'some-sig-value' };

    const result = await Platform.shim.eval(data, env);
    expect(result.sig).toBeUndefined();
  });

  test('should work when functions are present', async () => {
    const data = {
      output: `
        var exportedVars = {
          nFunction: function(n) { return 'deciphered-' + n; },
          sigFunction: function(s) { return 'deciphered-' + s; }
        };
      `,
      exported: ['nFunction', 'sigFunction']
    };
    const env = { n: 'n-val', sig: 'sig-val' };

    const result = await Platform.shim.eval(data, env);
    expect(result).toEqual({
      n: 'deciphered-n-val',
      sig: 'deciphered-sig-val'
    });
  });
});
