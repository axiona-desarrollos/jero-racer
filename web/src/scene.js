/* ==========================================================================
   HIGHWAY RACER · La glorieta
   --------------------------------------------------------------------------
   Geometria de bloque: asfalto, isleta central con bordillo, lineas pintadas
   y cuatro ramales. Sin texturas finas todavia — esto es para sentir el coche,
   no para lucirlo. El detalle viene despues, y por eso el escenario esta
   acotado: una glorieta de 34 m cabe entera en memoria con calidad de sobra.
   ========================================================================== */

import * as THREE from 'three';

export const GEO = {
  islandR: 8.0,      // isleta central
  curbH:   0.14,     // altura del bordillo
  roadR:   17.0,     // radio exterior de la calzada
  armW:    7.0,      // ancho de cada ramal
  armLen:  46.0,     // largo de cada ramal
};

function asphalt(color = 0x2a2d33, rough = 0.92) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0 });
}

export function buildRoundabout(scene, RAPIER, world) {
  const g = new THREE.Group();
  scene.add(g);

  // --- terreno base -------------------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), asphalt(0x14161b, 0.97));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(200, 0.1, 200).setTranslation(0, -0.1, 0).setFriction(1.0));

  // --- calzada de la glorieta --------------------------------------------
  const road = new THREE.Mesh(
    new THREE.RingGeometry(GEO.islandR, GEO.roadR, 96), asphalt(0x32353c, 0.88));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  road.receiveShadow = true;
  g.add(road);

  // --- cuatro ramales -----------------------------------------------------
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Mesh(
      new THREE.PlaneGeometry(GEO.armW, GEO.armLen), asphalt(0x32353c, 0.88));
    arm.rotation.x = -Math.PI / 2;
    arm.rotation.z = i * Math.PI / 2;
    const d = GEO.roadR + GEO.armLen / 2 - 1;
    arm.position.set(Math.sin(i * Math.PI / 2) * d, 0.008, Math.cos(i * Math.PI / 2) * d);
    arm.receiveShadow = true;
    g.add(arm);
  }

  // --- isleta central y bordillo -----------------------------------------
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

  // --- lineas pintadas ----------------------------------------------------
  const paint = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.7 });
  for (const r of [GEO.islandR + 0.25, GEO.roadR - 0.25]) {
    const line = new THREE.Mesh(new THREE.RingGeometry(r - 0.07, r + 0.07, 96), paint);
    line.rotation.x = -Math.PI / 2; line.position.y = 0.02; g.add(line);
  }
  // carril interior discontinuo
  const mid = (GEO.islandR + GEO.roadR) / 2;
  for (let i = 0; i < 40; i++) {
    const a0 = (i / 40) * Math.PI * 2;
    const dash = new THREE.Mesh(new THREE.RingGeometry(mid - 0.06, mid + 0.06, 6, 1, a0, 0.075), paint);
    dash.rotation.x = -Math.PI / 2; dash.position.y = 0.02; g.add(dash);
  }

  // --- postes de referencia: sin ellos no se percibe la velocidad ---------
  const poleG = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8);
  const poleM = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.6, metalness: 0.3 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const p = new THREE.Mesh(poleG, poleM);
    p.position.set(Math.cos(a) * (GEO.roadR + 1.6), 1.6, Math.sin(a) * (GEO.roadR + 1.6));
    p.castShadow = true;
    g.add(p);
  }

  return g;
}

export function buildLighting(scene, renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene.fog = new THREE.Fog(0x0a0e14, 60, 240);

  const sun = new THREE.DirectionalLight(0xfff0dd, 2.6);
  sun.position.set(28, 38, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 32;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;   sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x2a2318, 0.75));
  return sun;
}
