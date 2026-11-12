import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RgbaImage,
  hasTransparency,
  removeEdgeBackground,
  alphaBounds,
  cropImage,
  computeOrigin,
  defaultDisplayWidth,
  pickMipLevel,
  mipLevelCount,
} from './illustrationAsset';

function makeImage(w: number, h: number, bg: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = bg[3];
  }
  return { data, width: w, height: h };
}

function setPx(img: RgbaImage, x: number, y: number, c: [number, number, number, number]) {
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0];
  img.data[i + 1] = c[1];
  img.data[i + 2] = c[2];
  img.data[i + 3] = c[3];
}

function alphaAt(img: RgbaImage, x: number, y: number) {
  return img.data[(y * img.width + x) * 4 + 3];
}

/** A 40x40 white image with a dark ring (ink outline) enclosing a cream "snow" fill. */
function ringWithSnow(): RgbaImage {
  const img = makeImage(40, 40, [255, 255, 255, 255]);
  for (let y = 10; y < 30; y++) {
    for (let x = 10; x < 30; x++) {
      const edge = x === 10 || x === 29 || y === 10 || y === 29;
      setPx(img, x, y, edge ? [30, 25, 20, 255] : [250, 248, 240, 255]);
    }
  }
  return img;
}

test('removeEdgeBackground clears the outer white but keeps enclosed near-white snow', () => {
  const img = ringWithSnow();
  const removed = removeEdgeBackground(img, 14);
  assert.ok(removed > 1000);
  assert.equal(alphaAt(img, 2, 2), 0, 'outer background is transparent');
  assert.equal(alphaAt(img, 20, 20), 255, 'enclosed snow stays opaque');
  assert.equal(alphaAt(img, 10, 20), 255, 'ink outline stays opaque');
});

test('removeEdgeBackground adapts to non-white backgrounds', () => {
  const img = makeImage(20, 20, [240, 232, 210, 255]);
  setPx(img, 10, 10, [20, 60, 30, 255]);
  removeEdgeBackground(img, 14);
  assert.equal(alphaAt(img, 0, 0), 0);
  assert.equal(alphaAt(img, 10, 10), 255);
});

test('removeEdgeBackground softens light fringe and un-mattes it', () => {
  const img = makeImage(30, 30, [255, 255, 255, 255]);
  // dark core with a light antialiased halo pixel next to the background
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) setPx(img, x, y, [20, 50, 30, 255]);
  setPx(img, 9, 15, [232, 242, 236, 255]); // faint halo: mostly white with a touch of green
  removeEdgeBackground(img, 14);
  const a = alphaAt(img, 9, 15);
  assert.ok(a > 0 && a < 255, `halo alpha should be partial, got ${a}`);
  const i = (15 * img.width + 9) * 4;
  assert.ok(img.data[i] < 232, 'colour is pulled away from white');
  // a darker antialiased pixel is real foreground and stays fully opaque
  const img2 = makeImage(30, 30, [255, 255, 255, 255]);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) setPx(img2, x, y, [20, 50, 30, 255]);
  setPx(img2, 9, 15, [150, 170, 155, 255]);
  removeEdgeBackground(img2, 14);
  assert.equal(alphaAt(img2, 9, 15), 255);
});

test('hasTransparency distinguishes opaque and cut-out images', () => {
  assert.equal(hasTransparency(makeImage(50, 50, [255, 255, 255, 255])), false);
  assert.equal(hasTransparency(makeImage(50, 50, [0, 0, 0, 0])), true);
});

test('alphaBounds and cropImage trim margins with padding', () => {
  const img = makeImage(20, 20, [0, 0, 0, 0]);
  for (let y = 5; y < 12; y++) for (let x = 8; x < 14; x++) setPx(img, x, y, [10, 10, 10, 255]);
  const box = alphaBounds(img)!;
  assert.deepEqual(box, { x0: 8, y0: 5, x1: 14, y1: 12 });
  const cropped = cropImage(img, box, 2);
  assert.equal(cropped.width, 10);
  assert.equal(cropped.height, 11);
  assert.equal(alphaAt(cropped, 0, 0), 0);
  assert.equal(alphaAt(cropped, 2, 2), 255);
  assert.equal(alphaBounds(makeImage(5, 5, [0, 0, 0, 0])), null);
});

test('computeOrigin finds the bottom-centre of a trunk, not the canopy centre', () => {
  const img = makeImage(40, 50, [0, 0, 0, 0]);
  // wide canopy centred at x=20 ... but trunk sits at x=28..31
  for (let y = 0; y < 30; y++) for (let x = 5; x < 35; x++) setPx(img, x, y, [30, 80, 40, 255]);
  for (let y = 30; y < 48; y++) for (let x = 28; x < 32; x++) setPx(img, x, y, [80, 50, 30, 255]);
  const o = computeOrigin(img);
  assert.ok(Math.abs(o.originX - 30 / 40) < 0.02, `originX ${o.originX}`);
  assert.ok(Math.abs(o.originY - 48 / 50) < 1e-9, `originY ${o.originY}`);
});

test('defaultDisplayWidth keeps tall trees narrow and wide volcanoes wide, with comparable footprint', () => {
  const tree = defaultDisplayWidth('tree', 70, 100);
  const volcano = defaultDisplayWidth('mountain', 190, 100);
  const peak = defaultDisplayWidth('mountain', 100, 100);
  assert.ok(tree < 24, `tree ${tree}`);
  assert.ok(volcano > peak, 'wider artwork gets a wider footprint');
  assert.equal(peak, 58);
  // area stays roughly constant: width * height = visual^2
  const treeH = tree / 0.7;
  assert.ok(Math.abs(Math.sqrt(tree * treeH) - 24) < 0.5);
});

test('pickMipLevel picks the smallest level that is still sharp enough', () => {
  const levels = mipLevelCount(256);
  assert.equal(levels, 5); // 256,128,64,32,16
  assert.equal(pickMipLevel(256, 256, levels), 0);
  assert.equal(pickMipLevel(256, 100, levels), 1); // 128 >= 100
  assert.equal(pickMipLevel(256, 30, levels), 3); // 32 >= 30
  assert.equal(pickMipLevel(256, 5, levels), 4); // clamp to smallest
  assert.equal(pickMipLevel(256, 1000, levels), 0); // never upscale-select a bigger level than exists
  assert.equal(pickMipLevel(256, 100, 1), 0);
});
