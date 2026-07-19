import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createAimShadow } from '../src/render/aim-shadow.js';

test('aim shadow is clipped to its receiver and disposes without owning geometry', () => {
  const group = new THREE.Group();
  const receiverGeometry = new THREE.BoxGeometry(1.6, 0.5, 0.8);
  const casterGeometry = new THREE.CapsuleGeometry(0.3, 0.9, 4, 12);
  const receiver = new THREE.Mesh(receiverGeometry, new THREE.MeshBasicMaterial());
  const caster = new THREE.Mesh(casterGeometry, new THREE.MeshBasicMaterial());
  group.add(receiver);

  const shadow = createAimShadow({ receiver, caster });
  const overlay = group.getObjectByName('glass-aim-shadow');

  assert.ok(overlay?.isMesh);
  assert.equal(overlay.geometry, receiverGeometry);
  assert.equal(overlay.material.transparent, true);
  assert.equal(overlay.material.depthWrite, false);
  assert.ok(overlay.material.opacityNode?.isNode);
  assert.doesNotThrow(() => shadow.update(0.4, -0.2));

  shadow.dispose();
  assert.equal(group.getObjectByName('glass-aim-shadow'), undefined);
  assert.equal(receiver.geometry, receiverGeometry);

  receiverGeometry.dispose();
  casterGeometry.dispose();
  receiver.material.dispose();
  caster.material.dispose();
});

test('aim shadow rejects objects that cannot define a receiving surface', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  assert.throws(() => createAimShadow({ receiver: new THREE.Group(), caster: mesh }), TypeError);
  mesh.geometry.dispose();
  mesh.material.dispose();
});
