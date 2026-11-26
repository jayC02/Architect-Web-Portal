import * as THREE from "three";
import { clamp, lin, mix, smooth } from "../story.js";
import { inkMaterial, inkEdges, inkLines, mergedBoxes, withBoxInk } from "./ink.js";
import { PLOT } from "./site.js";

// Construction: the approved design hangs over the house as a dashed outline while the real
// studio goes up inside it. Hoarding closes the site, scaffold climbs the house, a tower crane
// swings timber panels in and a mobile crane in the street sets the roof.

const YELLOW = "#e3a11f";

export function createConstruction(scene, building, { mobile }) {
  const owned = [];
  const own = (o) => (owned.push(o), o);
  const root = new THREE.Group();
  scene.add(root);
  const { A, B, H, ridge, eave } = building.dims;
  const pen = own(inkMaterial(1.4, 1));
  const unitBox = own(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const inkColor = { value: new THREE.Color("#3d2a1a") };
  const inkAmount = { value: 1 };
  const lambert = (color, extra) => own(new THREE.MeshLambertMaterial({ color, ...extra }));
  const withInk = (m) => withBoxInk(m, inkColor, inkAmount);

  // --- The approved design, as a dashed outline of the studio and its roof
  const g = [];
  const y0 = H * 2,
    y1 = H * 3,
    { x0, x1, z0, z1 } = B;
  const e = (a, b) => g.push(...a, ...b);
  [y0, y1].forEach((y) => {
    e([x0, y, z0], [x1, y, z0]);
    e([x1, y, z0], [x1, y, z1]);
    e([x1, y, z1], [x0, y, z1]);
    e([x0, y, z1], [x0, y, z0]);
  });
  [x0, x1].forEach((x) => [z0, z1].forEach((z) => e([x, y0, z], [x, y1, z])));
  [x0 - 0.25, x1 + 0.25].forEach((x) => {
    e([x, y1, -eave], [x, y1 + ridge, 0]);
    e([x, y1 + ridge, 0], [x, y1, eave]);
  });
  e([x0 - 0.25, y1 + ridge, 0], [x1 + 0.25, y1 + ridge, 0]);
  const ghostPen = own(inkMaterial(1.6, 1));
  ghostPen.dashed = true;
  ghostPen.dashSize = 0.35;
  ghostPen.gapSize = 0.22;
  const ghost = inkLines(g, ghostPen);
  ghost.computeLineDistances();
  owned.push(ghost.geometry);
  root.add(ghost);

  // --- Site hoarding around the plot
  const boardMat = withInk(lambert("#f4efe6"));
  const hoarding = new THREE.Group();
  const H_H = 1.8;
  [
    [(PLOT.x0 + PLOT.x1) / 2, PLOT.z1, PLOT.x1 - PLOT.x0, 0.08],
    [(PLOT.x0 + PLOT.x1) / 2, PLOT.z0, PLOT.x1 - PLOT.x0, 0.08],
    [PLOT.x0, (PLOT.z0 + PLOT.z1) / 2, 0.08, PLOT.z1 - PLOT.z0],
    [PLOT.x1, (PLOT.z0 + PLOT.z1) / 2, 0.08, PLOT.z1 - PLOT.z0],
  ].forEach(([x, z, sx, sz]) => {
    const m = new THREE.Mesh(unitBox, boardMat);
    m.position.set(x, 0, z);
    m.scale.set(sx, H_H, sz);
    m.castShadow = m.receiveShadow = !mobile;
    hoarding.add(m);
  });
  root.add(hoarding);

  // --- Scaffold: standards, ledgers and boards round the house, one lift at a time
  const LIFT = 2,
    LIFTS = 5,
    OFF = 0.9;
  const sx0 = A.x0 - OFF,
    sx1 = A.x1 + OFF,
    sz0 = A.z0 - OFF,
    sz1 = A.z1 + OFF;
  const tubes = [],
    boards = [];
  const along = (a, b, step) => {
    const n = Math.max(1, Math.round((b - a) / step));
    return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  };
  const sides = [
    { xs: along(sx0, sx1, 2), z: sz1 },
    { xs: along(sx0, sx1, 2), z: sz0 },
  ];
  for (let l = 0; l < LIFTS; l++) {
    const y = l * LIFT;
    // standards on the long sides
    sides.forEach(({ xs, z }) => xs.forEach((x) => tubes.push({ l, x, y, z, sx: 0.07, sy: LIFT, sz: 0.07 })));
    along(sz0, sz1, 2).forEach((z) => [sx0, sx1].forEach((x) => tubes.push({ l, x, y, z, sx: 0.07, sy: LIFT, sz: 0.07 })));
    // ledgers and boards at the top of each lift
    const top = y + LIFT;
    [sz0, sz1].forEach((z) => {
      tubes.push({ l, x: (sx0 + sx1) / 2, y: top, z, sx: sx1 - sx0, sy: 0.07, sz: 0.07 });
      boards.push({ l, x: (sx0 + sx1) / 2, y: top, z: z + (z > 0 ? -0.35 : 0.35), sx: sx1 - sx0, sy: 0.06, sz: 0.6 });
    });
    [sx0, sx1].forEach((x) => {
      tubes.push({ l, x, y: top, z: (sz0 + sz1) / 2, sx: 0.07, sy: 0.07, sz: sz1 - sz0 });
      boards.push({ l, x: x + (x > 0 ? -0.35 : 0.35), y: top, z: (sz0 + sz1) / 2, sx: 0.6, sy: 0.06, sz: sz1 - sz0 });
    });
  }
  const tubeMesh = new THREE.InstancedMesh(unitBox, lambert("#5d6675"), tubes.length);
  const boardMesh = new THREE.InstancedMesh(unitBox, withInk(lambert("#d9b98c")), boards.length);
  tubeMesh.castShadow = boardMesh.castShadow = !mobile;
  root.add(tubeMesh, boardMesh);
  const dummy = new THREE.Object3D();
  function placeScaffold(amount) {
    // lifts appear from the bottom up and come down from the top
    const shown = amount * LIFTS;
    const put = (mesh, list) =>
      list.forEach((t, i) => {
        const s = clamp(shown - t.l);
        dummy.position.set(t.x, t.y, t.z);
        dummy.scale.set(t.sx, Math.max(0.0001, t.sy * s), t.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
    put(tubeMesh, tubes);
    put(boardMesh, boards);
    tubeMesh.instanceMatrix.needsUpdate = boardMesh.instanceMatrix.needsUpdate = true;
  }

  // --- Tower crane behind the house
  const yellow = lambert(YELLOW);
  const MAST = 17,
    JIB = 15,
    COUNTER = 5;
  const towerAt = new THREE.Vector3(-7.4, 0, -5.4);
  const mastBoxes = [];
  for (const [dx, dz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) mastBoxes.push({ x: dx, y: MAST / 2, z: dz, sx: 0.12, sy: MAST, sz: 0.12 });
  for (let y = 1; y < MAST; y += 1.3) {
    mastBoxes.push({ x: 0, y, z: -0.4, sx: 0.8, sy: 0.08, sz: 0.08 }, { x: 0, y, z: 0.4, sx: 0.8, sy: 0.08, sz: 0.08 });
    mastBoxes.push({ x: -0.4, y: y + 0.65, z: 0, sx: 0.08, sy: 0.08, sz: 0.8 }, { x: 0.4, y: y + 0.65, z: 0, sx: 0.08, sy: 0.08, sz: 0.8 });
  }
  mastBoxes.push({ x: 0, y: 0.25, z: 0, sx: 2.2, sy: 0.5, sz: 2.2 }); // base
  const mastGeo = own(mergedBoxes(mastBoxes));
  const mast = new THREE.Mesh(mastGeo, yellow);
  mast.castShadow = !mobile;
  const mastInk = inkEdges(mastGeo, pen, 30);
  owned.push(mastInk.geometry);
  mast.add(mastInk);
  const slew = new THREE.Group();
  slew.position.y = MAST;
  const jibBoxes = [
    { x: JIB / 2, y: 0.5, z: -0.3, sx: JIB, sy: 0.1, sz: 0.1 },
    { x: JIB / 2, y: 0.5, z: 0.3, sx: JIB, sy: 0.1, sz: 0.1 },
    { x: JIB / 2, y: 1.2, z: 0, sx: JIB, sy: 0.1, sz: 0.1 },
    { x: -COUNTER / 2, y: 0.5, z: 0, sx: COUNTER, sy: 0.16, sz: 0.7 },
    { x: -COUNTER + 0.7, y: 0.95, z: 0, sx: 1.3, sy: 0.9, sz: 0.9 }, // counterweight
    { x: 0, y: 1.4, z: 0, sx: 0.5, sy: 2.6, sz: 0.5 }, // tower head
    { x: 0.9, y: 0.0, z: 0.55, sx: 1.1, sy: 0.9, sz: 0.8 }, // cab
  ];
  for (let x = 1; x < JIB; x += 1.2) jibBoxes.push({ x, y: 0.85, z: 0, sx: 0.08, sy: 0.7, sz: 0.08 });
  const jibGeo = own(mergedBoxes(jibBoxes));
  const jib = new THREE.Mesh(jibGeo, yellow);
  jib.castShadow = !mobile;
  const jibInk = inkEdges(jibGeo, pen, 30);
  owned.push(jibInk.geometry);
  jib.add(jibInk);
  slew.add(jib);
  // trolley, cable and the load: a storey-high timber wall panel
  const cable = new THREE.Mesh(unitBox, lambert("#3a3f48"));
  cable.scale.set(0.04, 1, 0.04);
  const panelMat = withInk(lambert("#c99d6f"));
  const load = new THREE.Mesh(unitBox, panelMat);
  load.scale.set(2.6, 2.6, 0.16);
  load.castShadow = !mobile;
  slew.add(cable, load);
  const tower = new THREE.Group();
  tower.position.copy(towerAt);
  tower.add(mast, slew);
  root.add(tower);

  // --- Mobile crane in the street, setting the roof
  const truckBoxes = [
    { x: 0, y: 0.9, z: 0, sx: 7, sy: 1.1, sz: 2.4 },
    { x: 3.9, y: 1.1, z: 0, sx: 1.6, sy: 1.8, sz: 2.4 }, // cab
    { x: -1.2, y: 1.7, z: 0, sx: 2.2, sy: 0.6, sz: 2 }, // turntable
    { x: -2.8, y: 0.5, z: 1.9, sx: 0.3, sy: 0.3, sz: 1.6 }, // outriggers
    { x: -2.8, y: 0.5, z: -1.9, sx: 0.3, sy: 0.3, sz: 1.6 },
    { x: 2.6, y: 0.5, z: 1.9, sx: 0.3, sy: 0.3, sz: 1.6 },
    { x: 2.6, y: 0.5, z: -1.9, sx: 0.3, sy: 0.3, sz: 1.6 },
  ];
  for (const x of [-2.4, -0.6, 2.4, 3.9]) for (const z of [-1.1, 1.1]) truckBoxes.push({ x, y: 0.4, z, sx: 0.8, sy: 0.8, sz: 0.3 });
  const truckGeo = own(mergedBoxes(truckBoxes));
  const truck = new THREE.Mesh(truckGeo, yellow);
  truck.castShadow = !mobile;
  const truckInk = inkEdges(truckGeo, pen, 30);
  owned.push(truckInk.geometry);
  truck.add(truckInk);
  const boomGeo = own(mergedBoxes([{ x: 5.5, y: 0, z: 0, sx: 11, sy: 0.45, sz: 0.45 }]));
  const boom = new THREE.Mesh(boomGeo, yellow);
  const boomInk = inkEdges(boomGeo, pen, 30);
  owned.push(boomInk.geometry);
  boom.add(boomInk);
  boom.position.set(-1.2, 2.1, 0);
  const mobileCrane = new THREE.Group();
  mobileCrane.add(truck, boom);
  // the roof cassette it lifts, hanging from the boom tip
  const roofLoad = new THREE.Mesh(unitBox, withInk(lambert("#8f9aa8")));
  roofLoad.scale.set(3, 0.25, 2.2);
  const roofCable = new THREE.Mesh(unitBox, lambert("#3a3f48"));
  roofCable.scale.set(0.04, 1, 0.04);
  root.add(mobileCrane, roofLoad, roofCable);
  const PARK = new THREE.Vector3(9.5, 0, 12);

  const tip = new THREE.Vector3();

  function update(pose, colors) {
    const c = pose.construction;
    inkColor.value.copy(colors.ink);
    pen.color.copy(colors.ink);
    ghostPen.color.copy(colors.ink);

    ghostPen.opacity = c.ghost;
    ghost.visible = c.ghost > 0.01;

    hoarding.visible = c.hoarding > 0.01;
    hoarding.children.forEach((m) => (m.scale.y = Math.max(0.0001, H_H * c.hoarding)));

    const scaf = c.scaffold;
    tubeMesh.visible = boardMesh.visible = scaf > 0.001;
    if (tubeMesh.visible) placeScaffold(scaf);

    // the tower crane grows up from its base, works, then is taken down
    const cr = c.cranes;
    tower.visible = cr > 0.001;
    mast.scale.y = Math.max(0.0001, smooth(cr));
    slew.position.y = MAST * smooth(cr);
    slew.visible = cr > 0.6;
    // slew between the panel stack behind the house and the studio
    slew.rotation.y = -0.35 + c.swing * 0.55;
    // the hook rises and falls once per swing; a panel hangs from it while it works
    const lift = c.lift;
    const cycle = Math.abs(Math.sin(lift * Math.PI * 4));
    const reach = mix(6.5, 11.5, (c.swing + 1.1) / 2.2);
    const drop = mix(MAST - 2.5, MAST - 10.5, 1 - cycle);
    cable.position.set(reach, -drop, 0);
    cable.scale.y = Math.max(0.0001, drop - 1.3);
    load.position.set(reach, -drop - 2.6, -0.08);
    load.visible = cable.visible = lift > 0 && lift < 1 && cr > 0.6;

    // the mobile crane drives in, raises its boom and sets the roof cassette
    mobileCrane.visible = cr > 0.001;
    mobileCrane.position.set(PARK.x + (1 - smooth(cr)) * 40, 0, PARK.z);
    mobileCrane.rotation.y = Math.PI;
    boom.rotation.z = mix(0.05, 0.85, smooth(clamp(cr * 1.4 - 0.4)));
    tip.set(11, 0, 0).applyEuler(boom.rotation).add(boom.position);
    mobileCrane.updateMatrixWorld(true);
    mobileCrane.localToWorld(tip);
    const set = smooth(lin(c.roof, 0, 0.9));
    const roofTarget = H * 3 + 0.6;
    const hang = mix(tip.y - 3, roofTarget, set);
    roofLoad.position.set(mix(tip.x, (B.x0 + B.x1) / 2, set), hang, mix(tip.z, 0, set));
    roofLoad.visible = cr > 0.8 && c.roof < 0.95 && lin(pose.p, 0.6, 0.61) > 0;
    roofCable.position.set(roofLoad.position.x, roofLoad.position.y + 0.25, roofLoad.position.z);
    roofCable.scale.y = Math.max(0.0001, tip.y - roofLoad.position.y - 0.25);
    roofCable.visible = roofLoad.visible;
    root.visible = c.ghost > 0.01 || c.hoarding > 0.01 || scaf > 0.001 || cr > 0.001;
  }

  return {
    update,
    dispose() {
      owned.forEach((o) => o.dispose());
      scene.remove(root);
    },
  };
}
