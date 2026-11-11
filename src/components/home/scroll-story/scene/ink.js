import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

// The drawn look: white model surfaces with ink outlines, like an architect's presentation model.

/** A pen. Width is in CSS pixels, so lines stay crisp at any zoom. */
export function inkMaterial(width = 1.6, opacity = 1) {
  return new LineMaterial({ color: 0x1b2a4a, linewidth: width, transparent: true, opacity, depthWrite: false });
}

/** Line segments from a flat [x0,y0,z0, x1,y1,z1, ...] array. */
export function inkLines(positions, material) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions.length ? positions : [0, 0, 0, 0, 0, 0]);
  const lines = new LineSegments2(geometry, material);
  lines.renderOrder = 2;
  return lines;
}

/** Outline of any geometry's hard edges, as ink. */
export function inkEdges(geometry, material, threshold = 20) {
  const edges = new THREE.EdgesGeometry(geometry, threshold);
  const lines = inkLines(Array.from(edges.attributes.position.array), material);
  edges.dispose();
  return lines;
}

/**
 * Draws ink edges on unit boxes inside the surface shader, so thousands of instanced
 * boxes (the neighbouring streets) get outlines for free and can still be resized.
 * `yBase` is 0.5 for boxes whose origin sits on their base, 0 for centred boxes.
 */
export function withBoxInk(material, ink, amount, { px = 1.3, yBase = 0.5 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uInk = ink;
    shader.uniforms.uInkAmount = amount;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBoxPos;\nvarying vec3 vBoxScale;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vBoxPos = position - vec3(0.0, ${yBase.toFixed(2)}, 0.0);
        vBoxScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
        #ifdef USE_INSTANCING
          vBoxScale *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBoxPos;\nvarying vec3 vBoxScale;\nuniform vec3 uInk;\nuniform float uInkAmount;")
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
        vec3 boxD = (0.5 - abs(vBoxPos)) * vBoxScale;
        // distance to the nearest edge of whichever face this is
        float boxEdge = min(max(boxD.x, boxD.y), min(max(boxD.y, boxD.z), max(boxD.x, boxD.z)));
        float boxW = fwidth(boxEdge) * ${px.toFixed(2)};
        float boxLine = 1.0 - smoothstep(boxW * 0.45, boxW * 1.1, boxEdge);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk, boxLine * uInkAmount);`,
      );
  };
  material.customProgramCacheKey = () => `box-ink-${px}-${yBase}`;
  return material;
}

/** Many axis-aligned boxes merged into one geometry. Each box: { x, y, z, sx, sy, sz }. */
export function mergedBoxes(list) {
  const base = new THREE.BoxGeometry(1, 1, 1);
  const bp = base.attributes.position.array,
    bn = base.attributes.normal.array,
    bi = base.index.array;
  const pos = new Float32Array(list.length * bp.length),
    nor = new Float32Array(list.length * bn.length),
    idx = new Uint32Array(list.length * bi.length);
  list.forEach((b, n) => {
    for (let v = 0; v < 24; v++) {
      const o = n * 72 + v * 3;
      pos[o] = bp[v * 3] * b.sx + b.x;
      pos[o + 1] = bp[v * 3 + 1] * b.sy + b.y;
      pos[o + 2] = bp[v * 3 + 2] * b.sz + b.z;
      nor[o] = bn[v * 3];
      nor[o + 1] = bn[v * 3 + 1];
      nor[o + 2] = bn[v * 3 + 2];
    }
    for (let k = 0; k < bi.length; k++) idx[n * bi.length + k] = bi[k] + n * 24;
  });
  base.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
