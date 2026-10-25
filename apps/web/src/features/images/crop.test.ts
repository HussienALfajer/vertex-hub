import { describe, expect, it } from 'vitest';
import {
  clampCrop,
  cropOutput,
  fillScale,
  fitScale,
  initialCrop,
  moveCrop,
  scaleRange,
  zoomCrop,
} from './crop';

const portrait = { width: 3000, height: 4000 };
const logo = { width: 1600, height: 400 };

describe('crop maths (F01C rule 8)', () => {
  it('starts filling the square, centred on the long side', () => {
    const crop = initialCrop(portrait);
    expect(crop.scale).toBe(1 / 3000);
    expect(crop.x).toBe(0);
    expect(crop.y).toBeCloseTo(-1 / 6);
  });

  it('zooms from fill up to 4×, and down to fit only when allowed', () => {
    expect(scaleRange(portrait, false)).toEqual({ min: fillScale(portrait), max: 4 / 3000 });
    expect(scaleRange(logo, true).min).toBe(fitScale(logo));
    const crop = initialCrop(logo);
    expect(zoomCrop(crop, logo, 0, false).scale).toBe(fillScale(logo));
    expect(zoomCrop(crop, logo, 0, true).scale).toBe(1 / 1600);
    expect(zoomCrop(crop, logo, 1, true).scale).toBe(4 / 400);
  });

  it('keeps a filling image over the whole frame while dragging', () => {
    const crop = initialCrop(portrait);
    expect(moveCrop(crop, portrait, 0.3, 5)).toEqual({ scale: crop.scale, x: 0, y: 0 });
    expect(moveCrop(crop, portrait, -0.3, -5).y).toBeCloseTo(1 - 4000 / 3000);
  });

  it('keeps a zoomed-out logo whole inside the frame', () => {
    const fitted = zoomCrop(initialCrop(logo), logo, 0, true);
    expect(fitted.x).toBeCloseTo(0);
    expect(fitted.y).toBeCloseTo(0.375);
    expect(clampCrop({ ...fitted, y: -1 }, logo).y).toBe(0);
    expect(clampCrop({ ...fitted, y: 2 }, logo).y).toBeCloseTo(0.75);
  });

  it('zooms around the frame centre', () => {
    const crop = initialCrop(portrait);
    const zoomed = zoomCrop(crop, portrait, crop.scale * 2, false);
    // The image point at the centre stays at the centre.
    expect((0.5 - zoomed.x) / zoomed.scale).toBeCloseTo((0.5 - crop.x) / crop.scale);
    expect((0.5 - zoomed.y) / zoomed.scale).toBeCloseTo((0.5 - crop.y) / crop.scale);
  });

  it('uploads 1024 px, or the crop’s own size when smaller', () => {
    expect(cropOutput(initialCrop(portrait), portrait).side).toBe(1024);
    const small = { width: 300, height: 200 };
    const output = cropOutput(initialCrop(small), small);
    expect(output).toEqual({ side: 200, dx: -50, dy: 0, dw: 300, dh: 200 });
  });

  it('pads a fitted logo with transparency around it', () => {
    const fitted = zoomCrop(initialCrop(logo), logo, 0, true);
    const output = cropOutput(fitted, logo);
    expect(output.side).toBe(1024);
    expect(output.dx).toBeCloseTo(0);
    expect(output.dw).toBeCloseTo(1024);
    expect(output.dh).toBeCloseTo(256);
    expect(output.dy).toBeCloseTo(384);
  });
});
