// @ts-nocheck -- three ships no type declarations in this project
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSection } from '../src/components/home/scroll-story/scene/section.js';
import { poseAt } from '../src/components/home/scroll-story/story.js';

// The warrant section: once the cut has passed through, the slicing blade fades out,
// but the wall layers stepping out of the cut keep their ink outlines.
const scene = new THREE.Scene();
const building = {
  dims: { A: { x0: -5, x1: 5, z0: -3.25, z1: 3.25 }, B: { x0: -1, x1: 5, z0: -3.25, z1: 3.25 }, H: 3, T: 0.3, ridge: 2.3, eave: 3.6 },
  clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.35)],
};
const section = createSection(scene, building, { mobile: true });
const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 900);
camera.position.set(3, 9, 21);
camera.lookAt(2.4, 7.3, 0.6);
const anchor = { center: new THREE.Vector3(6, 9, 12), beside: new THREE.Vector3(4, 9, 12), unit: 6 };
const colors = { ink: new THREE.Color('#16403c') };

section.update(poseAt(0.33), colors, 0, anchor, camera);
const layers: THREE.Mesh[] = [];
scene.traverse(o => { if ((o as THREE.Mesh).isMesh && o.visible && o.scale.y > 2.5) layers.push(o as THREE.Mesh); });
assert.ok(layers.length >= 4, `the wall layers are out of the cut (${layers.length})`);
layers.forEach(layer => {
  const edge = layer.children[0] as THREE.Mesh & { material: { opacity: number } };
  assert.ok(edge.material.opacity > 0.5, `layer outlines stay inked after the blade has passed (${edge.material.opacity})`);
});
section.dispose();
console.log('homepage section tests passed');
