import assert from 'node:assert/strict';
import test from 'node:test';
import { createGallery } from '../src/render/gallery.js';

const EXPECTED_MAP_SIZE = Object.freeze({ low: 512, medium: 1024, high: 2048 });

for (const quality of Object.keys(EXPECTED_MAP_SIZE)) {
  test(`${quality} gallery keeps a tower-following alignment shadow`, () => {
    const gallery = createGallery({ quality });
    const key = gallery.group.getObjectByName('warm-gallery-key-light');

    assert.equal(key.castShadow, true);
    assert.equal(key.shadow.mapSize.width, EXPECTED_MAP_SIZE[quality]);
    assert.equal(key.shadow.mapSize.height, EXPECTED_MAP_SIZE[quality]);

    gallery.updateLighting({ topY: 6 }, 0);
    assert.equal(key.position.y - key.target.position.y, 13);
    assert.ok(Math.hypot(key.position.x, key.position.z) / 13 < 0.12);

    gallery.dispose();
  });
}
