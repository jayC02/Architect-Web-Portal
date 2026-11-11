import * as THREE from "three";

/**
 * Flat ribbons on the ground that "draw" themselves in order.
 * segments: [[x0, z0, x1, z1], ...] in drawing order. Each vertex carries its
 * normalised distance along the drawing, so a single uniform reveals the line.
 */
export function ribbon(segments, width, y = 0.02) {
  const pos = [],
    dist = [],
    index = [];
  const lengths = segments.map(([a, b, c, d]) => Math.hypot(c - a, d - b));
  const total = lengths.reduce((s, l) => s + l, 0) || 1;
  let run = 0;
  segments.forEach(([x0, z0, x1, z1], i) => {
    const len = lengths[i] || 1e-6,
      nx = (-(z1 - z0) / len) * (width / 2),
      nz = ((x1 - x0) / len) * (width / 2),
      // extend ends by half a width so corners meet cleanly
      ex = ((x1 - x0) / len) * (width / 2),
      ez = ((z1 - z0) / len) * (width / 2);
    const d0 = run / total,
      d1 = (run + lengths[i]) / total;
    run += lengths[i];
    const base = pos.length / 3;
    pos.push(x0 - ex + nx, y, z0 - ez + nz, x0 - ex - nx, y, z0 - ez - nz, x1 + ex + nx, y, z1 + ez + nz, x1 + ex - nx, y, z1 + ez - nz);
    dist.push(d0, d0, d1, d1);
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aDist", new THREE.Float32BufferAttribute(dist, 1));
  g.setIndex(index);
  return g;
}

export function ribbonMaterial(color, opacity = 1, additive = false) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    uniforms: {
      uReveal: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uGlow: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aDist;
      varying float vDist;
      void main() {
        vDist = aDist;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uReveal;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uGlow;
      varying float vDist;
      void main() {
        if (vDist > uReveal) discard;
        // the drawing tip glows slightly, like a pen nib
        float tip = smoothstep(0.02, 0.0, uReveal - vDist) * step(uReveal, 0.999);
        gl_FragColor = vec4(uColor * (uGlow + tip * 2.5), uOpacity);
        #include <colorspace_fragment>
      }`,
  });
}

export function arcSegments(cx, cz, r, a0, a1, steps = 14) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t0 = a0 + ((a1 - a0) * i) / steps,
      t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
    out.push([cx + Math.cos(t0) * r, cz + Math.sin(t0) * r, cx + Math.cos(t1) * r, cz + Math.sin(t1) * r]);
  }
  return out;
}
