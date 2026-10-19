import { describe, expect, it } from 'vitest';
import { screenEdges } from './hardware';

describe('screenEdges', () => {
  it('gives the long and short edge in device pixels, whatever the orientation', () => {
    expect(screenEdges(1536, 864, 1.25)).toEqual({ long: 1920, short: 1080 });
    expect(screenEdges(390, 844, 3)).toEqual({ long: 2532, short: 1170 });
  });

  it('treats a missing pixel ratio as 1 and an empty screen as unknown', () => {
    expect(screenEdges(1920, 1080, 0)).toEqual({ long: 1920, short: 1080 });
    expect(screenEdges(0, 0, 1)).toBeNull();
  });
});
