import * as THREE from "three";
import { APPLICATIONS, clamp, lin, mix, smooth } from "../story.js";

// Each application's drawings and documents peel off the model where they belong
// (elevations from the front, plans from the ground and roof, sections from the side),
// fly like paper to the Architect Pro window, pause beside it to be read, and go in.

const SHEET_W = 1.6,
  SHEET_H = 2.26,
  PER_GROUP = 9;
const FRONT_Z = 3.3,
  SIDE_X = 5.06,
  ROOF_Y = 9.08;

/** Where sheet k of a group starts, lying on the surface it describes. */
function source(from, k, g, pos, quat) {
  const lane = (k % 5) - 2;
  switch (from) {
    case "ground":
      pos.set(lane * 1.9 - 1, 0.05, 5.4 + g * 0.5);
      quat.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0.1 * lane));
      return "flat";
    case "facade":
      pos.set(lane * 1.7, k % 2 ? 7.5 : 4.4, FRONT_Z);
      quat.identity();
      return "upright";
    case "roof":
      pos.set(1.2 + lane * 1.1, ROOF_Y, 0.3 * lane);
      quat.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0.2 * lane));
      return "flat";
    case "side":
      pos.set(SIDE_X, k % 2 ? 7.4 : 4.3, lane * 1.2);
      quat.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
      return "upright";
    default:
      // documents with no drawing on the model rise out of the house itself
      pos.set(0.5 + lane * 0.6, 4.5, 0);
      quat.setFromEuler(new THREE.Euler(-0.3, 0.4 * lane, 0));
      return "inside";
  }
}

export function createDocuments(scene, textures, { mobile }) {
  const owned = [];
  const own = (o) => (owned.push(o), o);
  const root = new THREE.Group();
  scene.add(root);
  const sheetGeo = own(new THREE.PlaneGeometry(SHEET_W, SHEET_H));
  const scanGeo = own(new THREE.PlaneGeometry(SHEET_W * 1.04, 0.05));
  const backMat = own(new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true }));
  const appColours = APPLICATIONS.map((a) => new THREE.Color(a.colour));

  const sheets = textures.docSpecs.map((spec, i) => {
    const g = spec.group,
      k = i % PER_GROUP;
    const front = own(new THREE.MeshBasicMaterial({ map: textures.docs[i], transparent: true, toneMapped: false }));
    const group = new THREE.Group();
    const face = new THREE.Mesh(sheetGeo, front);
    const back = new THREE.Mesh(sheetGeo, backMat);
    back.rotation.y = Math.PI;
    face.castShadow = !mobile;
    const scanMat = own(new THREE.MeshBasicMaterial({ color: appColours[g], transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    const scan = new THREE.Mesh(scanGeo, scanMat);
    scan.position.z = 0.01;
    group.add(face, back, scan);
    group.visible = false;
    root.add(group);
    const startPos = new THREE.Vector3(),
      startQuat = new THREE.Quaternion();
    const kind = source(spec.from, k, g, startPos, startQuat);
    // the way it lifts off its surface
    const normal = kind === "flat" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1).applyQuaternion(startQuat);
    return { group, front, scan, scanMat, face, g, k, kind, startPos, startQuat, normal, seed: (i * 0.618) % 1 };
  });

  // scratch
  const pos = new THREE.Vector3(),
    peeled = new THREE.Vector3(),
    waiting = new THREE.Vector3(),
    ctrl = new THREE.Vector3(),
    camRight = new THREE.Vector3(),
    camUp = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    qFace = new THREE.Quaternion(),
    qCurl = new THREE.Quaternion(),
    curlAxis = new THREE.Vector3(),
    qWobble = new THREE.Quaternion(),
    euler = new THREE.Euler();

  /** Quadratic Bézier: a sheet arcs up and over on its way to the window. */
  const bezier = (a, c, b, t, out) => out.copy(a).multiplyScalar((1 - t) ** 2).addScaledVector(c, 2 * (1 - t) * t).addScaledVector(b, t * t);

  function update(pose, colors, time, dpr, anchor, camera) {
    let any = false;
    camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    // sheets arrive at about a sixth of the screen's height
    const arrive = (anchor.unit * 0.17) / SHEET_H;

    for (const s of sheets) {
      const u = pose.sheets[s.g].t;
      // each sheet's own moment in the collection, one after another
      const start = (s.k / PER_GROUP) * 0.55;
      const lift = lin(u, start, start + 0.08),
        fly = smooth(lin(u, start + 0.05, start + 0.27)),
        read = lin(u, start + 0.27, start + 0.37),
        enter = smooth(lin(u, start + 0.37, start + 0.46));
      const on = u > start && enter < 1;
      s.group.visible = on;
      if (!on) continue;
      any = true;

      // 1. peel off the surface: fade in where it lies, lift, curl up from one edge
      const inside = s.kind === "inside";
      peeled.copy(s.startPos).addScaledVector(s.normal, inside ? 0 : 0.7 * smooth(lift));
      if (inside) peeled.y += 2.2 * smooth(lift);
      curlAxis.set(1, 0, 0).applyQuaternion(s.startQuat);
      qCurl.setFromAxisAngle(curlAxis, (s.kind === "flat" ? -0.9 : 0.5) * smooth(lift) * (1 - fly));
      q.copy(s.startQuat).premultiply(qCurl);

      // 2. a waiting place just beside the window, gently fanned
      const fan = s.k - (PER_GROUP - 1) / 2;
      waiting.copy(anchor.beside).addScaledVector(camUp, fan * 0.04 * anchor.unit).addScaledVector(camRight, -s.k * 0.006 * anchor.unit);
      // 3. fly: arc up and over, turning to face the viewer, fluttering like paper as it goes
      ctrl.copy(peeled).lerp(waiting, 0.45);
      ctrl.y += 6 + s.seed * 3;
      bezier(peeled, ctrl, waiting, fly, pos);
      qFace.copy(camera.quaternion);
      euler.set(Math.sin(fly * Math.PI * 3 + s.seed * 6) * 0.5 * (1 - fly), Math.sin(fly * Math.PI * 2 + s.seed) * 0.6 * (1 - fly), fan * 0.035);
      qFace.multiply(qWobble.setFromEuler(euler));
      q.slerp(qFace, fly);
      // 4. go into the window
      pos.lerp(anchor.center, enter);

      s.group.position.copy(pos);
      s.group.quaternion.copy(q);
      const fadeIn = inside ? smooth(lift) : clamp(lift * 3);
      s.group.scale.setScalar(Math.max(0.0001, mix(1, arrive, fly) * mix(1, 0.4, enter) * (inside ? smooth(lift) : 1)));
      const opacity = fadeIn * (1 - enter);
      s.front.opacity = opacity;
      // near the window the sheets sit over the scene, like the window itself
      const overlay = fly > 0.7;
      s.front.depthTest = !overlay;
      s.group.renderOrder = overlay ? 20 + s.k : 0;
      s.face.castShadow = !mobile && fly < 0.2;
      // the read: a line in the application's colour sweeps down the sheet
      s.scanMat.opacity = read > 0 && read < 1 ? 0.9 * opacity : 0;
      s.scan.position.y = mix(SHEET_H / 2, -SHEET_H / 2, read);
      s.front.color.setScalar(1).lerp(appColours[s.g], 0.12 * Math.sin(read * Math.PI));
    }
    backMat.color.copy(colors.model);
    root.visible = any;
  }

  return {
    update,
    dispose() {
      owned.forEach((o) => o.dispose());
      scene.remove(root);
    },
  };
}
