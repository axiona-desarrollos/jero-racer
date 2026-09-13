/* ==========================================================================
   HIGHWAY RACER · La glorieta
   --------------------------------------------------------------------------
   Geometria de bloque: asfalto, isleta central con bordillo, lineas pintadas,
   cuatro ramales y postes de referencia. Sin texturas finas todavia — el
   escenario esta acotado a proposito: una glorieta de 34 m cabe entera en
   memoria con calidad de sobra, y ahi es donde luego se concentra el detalle.

   Las geometrias de los postes y de los trazos discontinuos se COMPARTEN entre
   instancias: crear 40 BufferGeometry identicas es memoria y llamadas de
   dibujo tiradas.
   ========================================================================== */

import * as THREE from 'three';

export const GEO = Object.freeze({
  islandR: 8.0,
  curbH: 0.14,
  roadR: 17.0,
  armW: 7.0,
  armLen: 46.0,
  poles: 16,
  dashes: 40,
});

const asphalt = (color, rough) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0 });

export function buildRoundabout(scene, RAPIER, world) {
  const g = new THREE.Group();
  g.name = 'glorieta';
  scene.add(g);

  const matVia = asphalt(0x32353c, 0.88);
  const matBase = asphalt(0x14161b, 0.97);
  const matPintura = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.7 });

  // --- terreno base -------------------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), matBase);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(200, 0.1, 200).setTranslation(0, -0.1, 0).setFriction(1.0));

  // --- calzada ------------------------------------------------------------
  const road = new THREE.Mesh(new THREE.RingGeometry(GEO.islandR, GEO.roadR, 96), matVia);
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  road.receiveShadow = true;
  g.add(road);

  // --- cuatro ramales -----------------------------------------------------
  const armGeo = new THREE.PlaneGeometry(GEO.armW, GEO.armLen);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const arm = new THREE.Mesh(armGeo, matVia);
    arm.rotation.x = -Math.PI / 2;
    arm.rotation.z = a;
    const d = GEO.roadR + GEO.armLen / 2 - 1;
    arm.position.set(Math.sin(a) * d, 0.008, Math.cos(a) * d);
    arm.receiveShadow = true;
    g.add(arm);
  }

  // --- isleta y bordillo --------------------------------------------------
  const curb = new THREE.Mesh(
    new THREE.CylinderGeometry(GEO.islandR, GEO.islandR, GEO.curbH, 96),
    new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.8 }));
  curb.position.y = GEO.curbH / 2;
  curb.castShadow = curb.receiveShadow = true;
  g.add(curb);

  const island = new THREE.Mesh(
    new THREE.CylinderGeometry(GEO.islandR - 0.35, GEO.islandR - 0.35, GEO.curbH + 0.04, 96),
    new THREE.MeshStandardMaterial({ color: 0x2f4030, roughness: 1.0 }));
  island.position.y = GEO.curbH / 2 + 0.03;
  island.receiveShadow = true;
  g.add(island);

  // El bordillo SI colisiona: subirse a la isleta tiene que costar.
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(GEO.curbH / 2, GEO.islandR)
      .setTranslation(0, GEO.curbH / 2, 0).setFriction(0.9));

  // --- lineas continuas ---------------------------------------------------
  for (const r of [GEO.islandR + 0.25, GEO.roadR - 0.25]) {
    const line = new THREE.Mesh(new THREE.RingGeometry(r - 0.07, r + 0.07, 96), matPintura);
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.02;
    g.add(line);
  }

  // --- carril interior discontinuo (geometria compartida) -----------------
  const mid = (GEO.islandR + GEO.roadR) / 2;
  const dashGeo = new THREE.RingGeometry(mid - 0.06, mid + 0.06, 6, 1, 0, 0.075);
  for (let i = 0; i < GEO.dashes; i++) {
    const dash = new THREE.Mesh(dashGeo, matPintura);
    dash.rotation.x = -Math.PI / 2;
    dash.rotation.z = -(i / GEO.dashes) * Math.PI * 2;
    dash.position.y = 0.02;
    g.add(dash);
  }

  // --- postes: sin referencias verticales no se percibe la velocidad ------
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.6, metalness: 0.3 });
  for (let i = 0; i < GEO.poles; i++) {
    const a = (i / GEO.poles) * Math.PI * 2;
    const p = new THREE.Mesh(poleGeo, poleMat);
    p.position.set(Math.cos(a) * (GEO.roadR + 1.6), 1.6, Math.sin(a) * (GEO.roadR + 1.6));
    p.castShadow = true;
    g.add(p);
  }

  return g;
}

export function buildLighting(scene, renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene.fog = new THREE.Fog(0x0a0e14, 60, 240);

  const sun = new THREE.DirectionalLight(0xfff0dd, 2.6);
  sun.position.set(28, 38, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 32;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // Nombrada para que una escena con cielo real pueda bajarla: cuando hay un
  // scene.environment de verdad, esta luz DUPLICA el ambiente y ademas tine de
  // azul todo lo horizontal, que es casi todo el asfalto.
  const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x2a2318, 0.75);
  hemi.name = 'hemisferica';
  scene.add(hemi);
  return sun;
}
