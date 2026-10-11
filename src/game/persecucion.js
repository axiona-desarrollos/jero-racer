/* ==========================================================================
   JERO RACER · Persecucion policial y militar
   --------------------------------------------------------------------------
   Pasar de 170 km/h llama a la Policia. Si el jugador sigue por encima, las
   patrullas lo alcanzan, se le ponen al lado y lo embisten; si la cosa se
   alarga entra el Ejercito, y un helicoptero lo sigue desde arriba con el
   reflector. Bajar de 170 km/h unos segundos es rendirse a la ley: lo dejan
   de perseguir. Cada embestida dana el carro; con el dano al 100 % lo
   detienen y la partida se acaba.

   LAS UNIDADES NO TIENEN CUERPO FISICO, A PROPOSITO
   Un cuerpo cinematico de Rapier que avanza contra el coche del jugador lo
   empuja con masa infinita: a 200 km/h eso lo lanzaba por los aires. Aqui el
   choque se DETECTA con la misma prueba SAT que el trafico y su efecto se
   APLICA a mano (un empujon lateral medido y un golpe de dano), y la unidad
   rebota hacia fuera. Asi la embestida se siente fuerte pero nunca rompe la
   fisica.

   TAMPOCO SON FANTASMAS PARA EL TRAFICO... DONDE SE VE
   Conducen por carriles y frenan a tiempo, pero si una unidad se le mete a
   un carro o a un camion, se estrella: sale dando vueltas, se queda parada
   echando humo y ya no persigue. Solo a mas de 25 m por detras del jugador,
   donde la camara no mira, atraviesan el trafico: a 300 km/h entre carros a
   90 ningun conductor que frene a tiempo alcanzaria al jugador, y la
   persecucion se quedaba sin patrullas. Al entrar en la zona que se ve se
   vuelven solidas en cuanto no tienen a nadie encima. Mientras embiste al jugador no mira el trafico, asi que
   llevarla hacia una tractomula es la forma de quitarsela de encima. El
   vehiculo golpeado se sacude, frena y prende las estacionarias, y el
   trafico frena y se cambia de carril ante las unidades (ver
   Trafico.obstaculos).
   ========================================================================== */

import * as THREE from 'three';
import { TIPOS_PERSECUCION, fabricar } from '../traffic/flota.js';
import { geometriaRueda, prepararInstancias } from '../traffic/modelado.js';
import { solapanXZ, texturaSombra } from '../traffic/trafico.js';
import { VIA, anchoCalzada, carrilX } from '../world/autopista.js';

export const PERSECUCION = Object.freeze({
  umbralKmh: 170,
  /** Segundos por encima del umbral antes de que llegue la Policia. */
  entrar: 1.2,
  /** Segundos por debajo del umbral para que lo dejen de perseguir. */
  salir: 2.2,
  /** Segundos de calma tras una persecucion antes de que pueda empezar otra. */
  respiro: 5,
  maxPatrullas: 4,
  maxMilitares: 2,
  refuerzoCada: 7,
  militarDesde: 16,
  helicopteroDesde: 4,
  /** Desde cuando disparan tambien las patrullas (el Ejercito, siempre). */
  disparanPatrullasDesde: 25,
  /** Distancia por detras del jugador entre la que se dispara, en metros. */
  disparoMin: 7, disparoMax: 62,
  /** Dano por impacto de bala. */
  danoBala: 2.4,
  velocidadMax: 84,          // m/s (~300 km/h): tienen que poder alcanzarlo
});

const MARGEN = 0.08;

// Ancho y largo en planta de algo girado: una patrulla estrellada que quedo
// atravesada ocupa casi un carril, y medirla derecha provocaba choques en cadena.
const anchoP = o => Math.abs(Math.sin(o.yaw)) * o.largo + Math.abs(Math.cos(o.yaw)) * o.ancho;
const largoP = o => Math.abs(Math.sin(o.yaw)) * o.ancho + Math.abs(Math.cos(o.yaw)) * o.largo;

/** Carril (0 = el de la derecha) en el que cae la X. */
const carrilDe = x => Math.max(0, Math.min(VIA.carriles - 1, Math.floor((x + anchoCalzada() / 2) / VIA.anchoCarril)));

/** Helicoptero de la Policia: cuerpo, cola, patines, rotores y reflector. */
function construirHelicoptero() {
  const g = new THREE.Group();
  const blanco = new THREE.MeshStandardMaterial({ color: 0xf2f3f1, roughness: 0.4, metalness: 0.2 });
  const verde = new THREE.MeshStandardMaterial({ color: 0x00843d, roughness: 0.5 });
  const vidrio = new THREE.MeshStandardMaterial({ color: 0x0c1520, roughness: 0.05, metalness: 0.6 });
  const negro = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.7 });

  const cuerpo = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), blanco);
  cuerpo.scale.set(1.35, 1.15, 2.6);
  g.add(cuerpo);
  const franja = new THREE.Mesh(new THREE.SphereGeometry(1.01, 20, 6, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.18), verde);
  franja.scale.copy(cuerpo.scale);
  g.add(franja);
  const cabina = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), vidrio);
  cabina.scale.set(1.2, 0.95, 1.4);
  cabina.position.set(0, 0.15, 1.35);
  cabina.rotation.x = 0.35;
  g.add(cabina);
  const cola = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 5.2, 10), blanco);
  cola.rotation.x = Math.PI / 2;
  cola.position.set(0, 0.35, -4.6);
  g.add(cola);
  const aleta = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.9), verde);
  aleta.position.set(0, 1.0, -7.0);
  g.add(aleta);
  for (const s of [1, -1]) {
    const patin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 6), negro);
    patin.rotation.x = Math.PI / 2;
    patin.position.set(s * 1.1, -1.55, 0.2);
    g.add(patin);
    for (const z of [-0.8, 1.0]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 5), negro);
      p.position.set(s * 1.0, -1.2, z);
      p.rotation.z = s * 0.25;
      g.add(p);
    }
  }
  // Rotor principal: dos palas cruzadas y un disco translucido que hace de
  // estela de giro (a 400 rpm las palas solas parpadean feo).
  const rotor = new THREE.Group();
  for (const r of [0, Math.PI / 2]) {
    const pala = new THREE.Mesh(new THREE.BoxGeometry(11, 0.05, 0.35), negro);
    pala.rotation.y = r;
    rotor.add(pala);
  }
  const estela = new THREE.Mesh(new THREE.CircleGeometry(5.5, 32),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  estela.rotation.x = -Math.PI / 2;
  rotor.add(estela);
  rotor.position.y = 1.35;
  g.add(rotor);
  const rotorCola = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.18), negro);
  rotorCola.position.set(0.18, 1.0, -7.1);
  g.add(rotorCola);

  // Reflector: cono de luz aditivo hasta el suelo y la mancha en el asfalto.
  const cono = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.035, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  cono.geometry.translate(0, -0.5, 0);
  g.add(cono);

  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const gc = c.getContext('2d');
  const grd = gc.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,248,220,0.9)'); grd.addColorStop(0.6, 'rgba(255,240,200,0.35)'); grd.addColorStop(1, 'rgba(255,240,200,0)');
  gc.fillStyle = grd; gc.fillRect(0, 0, 128, 128);
  const mancha = new THREE.Mesh(new THREE.CircleGeometry(5, 32),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -3 }));
  mancha.rotation.x = -Math.PI / 2;

  g.traverse(o => { if (o.isMesh && o !== cono && o !== estela) o.castShadow = true; });
  return { grupo: g, rotor, rotorCola, cono, mancha };
}

export class Persecucion {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Material} material el material de la flota (trafico.material)
   */
  constructor(scene, material) {
    this.scene = scene;
    this.cfg = PERSECUCION;
    this.modelos = {};
    for (const clave of ['patrulla', 'militar']) {
      const tipo = TIPOS_PERSECUCION[clave];
      const m = fabricar(tipo, 1);
      const n = clave === 'patrulla' ? PERSECUCION.maxPatrullas : PERSECUCION.maxMilitares;
      const malla = new THREE.InstancedMesh(m.geometria, material, n);
      malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      malla.castShadow = true; malla.receiveShadow = true;
      malla.frustumCulled = false;
      // Los atributos por instancia se dimensionan con malla.count: hay que
      // crearlos ANTES de dejarla en cero, o salen vacios y no se pinta nada.
      const attrs = prepararInstancias(malla);
      malla.count = 0;
      scene.add(malla);
      this.modelos[clave] = { tipo, ...m, malla, attrs, n: 0 };
    }
    const total = PERSECUCION.maxPatrullas + PERSECUCION.maxMilitares;
    this.ruedas = new THREE.InstancedMesh(geometriaRueda(), material, total * 4);
    this.ruedas.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ruedas.frustumCulled = false;
    prepararInstancias(this.ruedas);
    this.ruedas.count = 0;
    scene.add(this.ruedas);

    const geoSombra = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.sombras = new THREE.InstancedMesh(geoSombra, new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: texturaSombra(), transparent: true, opacity: 0.6,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }), total);
    this.sombras.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sombras.frustumCulled = false;
    this.sombras.count = 0;
    scene.add(this.sombras);

    this.unidades = [];
    for (const clave of ['patrulla', 'militar']) {
      const n = clave === 'patrulla' ? PERSECUCION.maxPatrullas : PERSECUCION.maxMilitares;
      const mod = this.modelos[clave];
      for (let i = 0; i < n; i++) {
        this.unidades.push({
          clave, modelo: mod, militar: clave === 'militar',
          largo: mod.largo, ancho: mod.ancho,
          activo: false, retirada: false, chocada: false,
          x: 0, z: 0, xPrev: 0, zPrev: 0, v: 0, vLat: 0, yaw: 0, yawPrev: 0,
          vx: 0, vGiro: 0, tAturdido: 0, acumHumo: 0,
          distancia: 0, distanciaPrev: 0,
          lado: 1, tGolpe: 0, tEmbestida: 2, fase: Math.random(),
          tDisparo: 2, rafaga: 0, tTiro: 0,
        });
      }
    }

    // Trazadoras: un pool de segmentos que viven unas centesimas de segundo.
    this.maxTrazas = 32;
    this.trazas = Array.from({ length: this.maxTrazas }, () => ({ vida: 0, a: new THREE.Vector3(), b: new THREE.Vector3() }));
    const geoTrazas = new THREE.BufferGeometry();
    geoTrazas.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxTrazas * 6), 3));
    geoTrazas.setDrawRange(0, 0);
    this.lineas = new THREE.LineSegments(geoTrazas, new THREE.LineBasicMaterial({
      color: 0xffd36a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.lineas.frustumCulled = false;
    scene.add(this.lineas);
    this.avisoDisparos = false;

    this.heli = construirHelicoptero();
    this.heli.grupo.visible = false;
    this.heli.mancha.visible = false;
    scene.add(this.heli.grupo, this.heli.mancha);
    this.heliPos = new THREE.Vector3();
    this.heliPrev = new THREE.Vector3();
    this.heliActivo = false;

    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._qr = new THREE.Quaternion();
    this._qs = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._eje = new THREE.Vector3(1, 0, 0);
    this._arriba = new THREE.Vector3(0, 1, 0);
    this._col = new THREE.Color();
    this._obstaculos = [];
    this.reiniciar();
  }

  reiniciar() {
    this.activa = false;
    this.tiempo = 0;
    this.tSobre = 0;
    this.tBajo = 0;
    this.respiro = 0;
    this.tRefuerzo = 0;
    this.tMegafono = 4;
    this.militaresAvisados = false;
    this.avisoDisparos = false;
    this.eventos = [];
    this.reloj = 0;
    for (const t of this.trazas ?? []) t.vida = 0;
    for (const u of this.unidades) { u.activo = false; u.retirada = false; u.chocada = false; }
    this._obstaculos.length = 0;
    this.heliActivo = false;
    this.heli.grupo.visible = false;
    this.heli.mancha.visible = false;
  }

  /** Distancia a la unidad activa mas cercana (para la sirena), o Infinity. */
  get cercana() {
    let d = Infinity, lado = 0;
    for (const u of this.unidades) {
      if (!u.activo || u.chocada) continue;
      const dd = Math.hypot(u.x - this._jx, u.z - this._jz);
      if (dd < d) { d = dd; lado = Math.sign(u.x - this._jx); }
    }
    return { distancia: d, lado };
  }

  get unidadesActivas() { return this.unidades.filter(u => u.activo && !u.retirada && !u.chocada).length; }

  #iniciar(j) {
    this.activa = true;
    this.tiempo = 0;
    this.tBajo = 0;
    this.tRefuerzo = 0;
    this.militaresAvisados = false;
    this.eventos.push({ tipo: 'inicio' });
    this.#refuerzo('patrulla', j, 0);
    this.#refuerzo('patrulla', j, 1);
  }

  #terminar() {
    this.activa = false;
    this.respiro = PERSECUCION.respiro;
    for (const u of this.unidades) if (u.activo) u.retirada = true;
    this.eventos.push({ tipo: 'fin', duracion: this.tiempo });
  }

  /** Mete una unidad nueva por detras del jugador. */
  #refuerzo(clave, j, orden = 0) {
    const u = this.unidades.find(u => u.clave === clave && !u.activo);
    if (!u) return false;
    u.activo = true;
    u.retirada = false;
    u.chocada = false;
    u.vx = 0; u.vGiro = 0; u.vLat = 0; u.tAturdido = 0;
    u.z = u.zPrev = j.z - 120 - orden * 28 - Math.random() * 20;
    // En un carril sin nadie cerca: aparecer encima o pegada a un camion era
    // estrellarse antes de arrancar.
    const ocupado = c => (this._trafico?.vehiculos ?? []).some(t => t.vivo
      && Math.abs(t.x - carrilX(c)) < VIA.anchoCarril * 0.8 && t.z > u.z - 25 && t.z < u.z + 60);
    const inicio = Math.floor(Math.random() * VIA.carriles);
    let carril = inicio;
    for (let k = 0; k < VIA.carriles; k++) {
      const c = (inicio + k) % VIA.carriles;
      if (!ocupado(c)) { carril = c; break; }
    }
    u.x = u.xPrev = carrilX(carril);
    u.carril = carril;
    u.tDecision = 0;
    u.solida = false;
    u.v = Math.max(j.velocidad + 8, 40);
    u.yaw = u.yawPrev = 0;
    u.lado = Math.random() < 0.5 ? -1 : 1;
    u.tGolpe = 0;
    u.tEmbestida = 1.5 + Math.random() * 2;
    u.tDisparo = 2 + Math.random() * 3;
    u.rafaga = 0;
    u.distancia = u.distanciaPrev = 0;
    this._col.setHex(u.modelo.tipo.paleta[0]);
    u.tinte1 = this._col.clone();
    this._col.setHex((u.modelo.tipo.paleta2 ?? u.modelo.tipo.paleta)[0]);
    u.tinte2 = this._col.clone();
    return true;
  }

  /**
   * Un paso de simulacion.
   * @param {number} dt
   * @param {{x:number,z:number,velocidad:number,kmh:number,ancho:number,largo:number,yaw:number}} j jugador
   * @param {import('../traffic/trafico.js').Trafico} trafico
   * @param {boolean} enJuego solo se persigue durante la partida
   */
  actualizar(dt, j, trafico, enJuego) {
    this.reloj += dt;
    this._trafico = trafico;
    this._jx = j.x; this._jz = j.z;
    this._jxPrev ??= j.x;
    const cfg = this.cfg;

    // --- empieza y acaba -------------------------------------------------------
    if (!enJuego) {
      if (this.activa) this.#terminar();
    } else if (!this.activa) {
      this.respiro = Math.max(0, this.respiro - dt);
      this.tSobre = j.kmh > cfg.umbralKmh ? this.tSobre + dt : 0;
      if (this.tSobre > cfg.entrar && this.respiro <= 0) this.#iniciar(j);
    } else {
      this.tiempo += dt;
      this.tBajo = j.kmh < cfg.umbralKmh ? this.tBajo + dt : 0;
      if (this.tBajo > cfg.salir) {
        this.#terminar();
      } else {
        this.tRefuerzo += dt;
        if (this.tRefuerzo > cfg.refuerzoCada) {
          this.tRefuerzo = 0;
          const militar = this.tiempo > cfg.militarDesde;
          if (militar && this.#refuerzo('militar', j)) {
            if (!this.militaresAvisados) { this.militaresAvisados = true; this.eventos.push({ tipo: 'ejercito' }); }
          } else {
            this.#refuerzo('patrulla', j);
          }
        }
        this.tMegafono -= dt;
        if (this.tMegafono <= 0) {
          this.tMegafono = 6 + Math.random() * 5;
          if (this.cercana.distancia < 60) this.eventos.push({ tipo: 'megafono' });
        }
      }
    }

    // --- helicoptero -------------------------------------------------------------
    const quiereHeli = this.activa && this.tiempo > cfg.helicopteroDesde;
    this.heliPrev.copy(this.heliPos);
    if (quiereHeli && !this.heliActivo) {
      this.heliActivo = true;
      this.heliPos.set(j.x + 30, 90, j.z + 260);
      this.heliPrev.copy(this.heliPos);
      this.eventos.push({ tipo: 'helicoptero' });
    }
    if (this.heliActivo) {
      const k = 1 - Math.exp(-dt * 1.6);
      if (quiereHeli) {
        // Se queda por delante y a un lado: asi se ve en la camara de persecucion.
        this._v.set(j.x + 9, 30, j.z + 34 + j.velocidad * 0.15);
        this.heliPos.x += (this._v.x - this.heliPos.x) * k;
        this.heliPos.y += (this._v.y - this.heliPos.y) * k;
        this.heliPos.z += j.velocidad * dt + (this._v.z - this.heliPos.z) * k;
      } else {
        // Se va: sube y se queda atras.
        this.heliPos.y += 14 * dt;
        this.heliPos.z += Math.max(0, j.velocidad - 25) * dt;
        if (this.heliPos.y > 160) this.heliActivo = false;
      }
    }

    // --- unidades --------------------------------------------------------------------
    const borde = anchoCalzada() / 2;
    const cajaJ = { x: j.x, z: j.z, yaw: j.yaw, largo: j.largo, ancho: j.ancho };
    // Lo que cada unidad tiene que esquivar: el trafico y las demas unidades
    // (asi no van en fila india detras de la primera: la adelantan).
    const obstaculos = this._obsTmp ??= [];
    obstaculos.length = 0;
    for (const t of trafico.vehiculos) if (t.vivo) obstaculos.push(t);
    for (const o of this.unidades) if (o.activo && (o.solida || o.chocada)) obstaculos.push(o);
    const vel = o => o.velocidad ?? o.v;
    for (const u of this.unidades) {
      if (!u.activo) continue;
      u.xPrev = u.x; u.zPrev = u.z; u.yawPrev = u.yaw; u.distanciaPrev = u.distancia;
      u.tGolpe = Math.max(0, u.tGolpe - dt);
      u.tAturdido = Math.max(0, u.tAturdido - dt);
      const dz = j.z - u.z;                     // > 0: la unidad va por detras

      if (u.chocada) {
        // Fuera de combate: patina dando vueltas hasta quedarse quieta.
        if (dz > 260 || dz < -400) { u.activo = false; continue; }
        u.v = Math.max(0, u.v - 7 * dt);
        u.vx *= Math.exp(-2.4 * dt);
        u.vGiro *= Math.exp(-1.3 * dt);
        u.z += u.v * dt;
        u.distancia += u.v * dt;
        u.x = Math.max(-borde + u.ancho / 2, Math.min(borde - u.ancho / 2, u.x + u.vx * dt));
        u.yaw += u.vGiro * dt;
        u.vLat = u.vx;
        this.#contraTrafico(u, trafico);
        // El jugador tambien se la puede llevar por delante: golpe y frenazo.
        if (enJuego && u.tGolpe <= 0
            && solapanXZ(cajaJ, { x: u.x, z: u.z, yaw: u.yaw, largo: u.largo + MARGEN, ancho: u.ancho + MARGEN })) {
          const relativa = Math.max(0, j.velocidad - u.v);
          const lado = Math.sign(j.x - u.x) || 1;
          this.eventos.push({
            tipo: 'golpe', chatarra: true, fuerza: Math.min(22, 4 + relativa * 0.35), frenazo: relativa * 0.3,
            lado, militar: u.militar, x: (u.x + j.x) / 2, z: (u.z + j.z) / 2,
          });
          u.tGolpe = 0.8;
          u.v = Math.max(u.v, j.velocidad * 0.85);
          u.vx = -lado * (3 + Math.random() * 3);
          u.vGiro += (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 2);
        }
        continue;
      }

      let vObj;
      if (u.retirada || !enJuego) {
        vObj = Math.max(0, j.velocidad - 14);
        if (dz > 260 || dz < -400) { u.activo = false; continue; }
      } else {
        // Acercarse hasta ponerse a su altura, y ahi igualar la velocidad.
        vObj = j.velocidad + Math.max(-14, Math.min(26, (dz + 0.5) * 0.9));
      }
      vObj = Math.min(cfg.velocidadMax, vObj);
      if (u.tAturdido > 0) vObj = Math.min(vObj, u.v);

      // --- conducir entre el trafico ---------------------------------------------
      // Como el trafico: siempre al centro de un carril, solo se cambia si en
      // el otro hay sitio, y nunca va mas rapido de lo que le deja frenar
      // detras del de delante. Antes iba por la raya y decidia esquivar o
      // frenar cada fotograma: dudaba entre las dos cosas y no hacia ninguna a
      // tiempo. Pegada al jugador se le pone al lado; embistiendo deja de
      // mirar, y ahi es donde se estrellan.
      const pegado = !u.retirada && enJuego && dz < 12 && dz > -7;
      if (pegado) u.tEmbestida -= dt;
      const embistiendo = pegado && u.tEmbestida <= 0;
      const enFranja = (o, x) => Math.abs(o.x - x) < (anchoP(o) + u.ancho) / 2 + 0.3;
      // El primero que hay delante en la franja de `x`, y el hueco hasta el.
      const delanteEn = (x) => {
        let o = null, hueco = Infinity;
        for (const t of obstaculos) {
          if (t === u || !enFranja(t, x)) continue;
          const h = (t.z - largoP(t) / 2) - (u.z + u.largo / 2);
          if (h > -1.5 && h < hueco) { hueco = h; o = t; }
        }
        return { o, hueco };
      };
      // La mayor velocidad con la que aun puede frenar hasta su ritmo dejando
      // 4 m (con 14 m/s2: frena a fondo, pero le queda margen hasta los 15).
      const maxPara = ({ o, hueco }) => (o ? Math.sqrt(vel(o) ** 2 + 2 * 14 * Math.max(0, hueco - 4)) : Infinity);
      // Un carril tiene sitio si nadie va a lo largo de la unidad, ni delante
      // a menos de lo que le hace falta para frenar, ni detras viniendo encima.
      const haySitio = (c) => {
        const x = carrilX(c);
        for (const t of obstaculos) {
          if (t === u || !enFranja(t, x)) continue;
          const atras = (u.z - u.largo / 2) - (t.z + largoP(t) / 2);
          if (atras > 3 + Math.max(0, vel(t) - u.v) * 1.5) continue;
          const cierre = Math.max(0, u.v - vel(t));
          if ((t.z - largoP(t) / 2) - (u.z + u.largo / 2) < 6 + cierre * cierre / 28) return false;
        }
        return true;
      };

      // Fuera de la vista, sin cuerpo (ver la cabecera). Se vuelve solida al
      // acercarse cuando puede frenar a tiempo para lo que tiene delante, o
      // ya a la altura del jugador; nunca encima de un carro: eso seria un
      // choque regalado que ademas no se ve venir.
      if (dz > 25) u.solida = false;
      else if (!u.solida && !obstaculos.some(t => t !== u && solapanXZ(u, t))) {
        u.solida = dz <= 12 || maxPara(delanteEn(u.x)) >= u.v - 1;
      }
      const cj = carrilDe(j.x);
      const quiere = cj + u.lado >= 0 && cj + u.lado < VIA.carriles ? cj + u.lado : cj - u.lado;

      let xObj;
      if (!u.solida) {
        u.carril = quiere;
        xObj = carrilX(quiere);
      } else if (pegado) {
        const lateral = (u.ancho + j.ancho) / 2;
        xObj = j.x + u.lado * (embistiendo ? lateral - 0.9 : lateral + 0.25);
        u.carril = carrilDe(xObj);
      } else {
        u.carril ??= carrilDe(u.x);
        u.tDecision = (u.tDecision ?? 0) - dt;
        if (u.tDecision <= 0) {
          u.tDecision = 0.25;
          // Quiere el carril de al lado del jugador.
          const aqui = maxPara(delanteEn(carrilX(u.carril)));
          if (aqui < vObj - 2) {
            // Retenida: al carril de al lado que la deje ir mas rapido.
            const opciones = [u.carril - 1, u.carril + 1].filter(c => c >= 0 && c < VIA.carriles)
              .sort((a, b) => Math.abs(a - quiere) - Math.abs(b - quiere));
            for (const c of opciones) {
              if (haySitio(c) && maxPara(delanteEn(carrilX(c))) > aqui + 4) { u.carril = c; break; }
            }
          } else if (u.carril !== quiere) {
            const c = u.carril + Math.sign(quiere - u.carril);
            if (haySitio(c) && maxPara(delanteEn(carrilX(c))) >= Math.min(vObj, aqui) - 1) u.carril = c;
          }
        }
        xObj = carrilX(u.carril);
      }
      // Frena para lo que tiene delante donde esta y, si se esta cambiando,
      // tambien en el carril al que va.
      if (u.solida && !embistiendo) {
        vObj = Math.min(vObj, maxPara(delanteEn(u.x)));
        if (Math.abs(xObj - u.x) > 0.5) vObj = Math.min(vObj, maxPara(delanteEn(xObj)));
      }
      // Y no se mete en el costado de nadie que tenga al lado.
      const s = Math.sign(xObj - u.x);
      if (s !== 0 && u.solida && !embistiendo) {
        for (const t of obstaculos) {
          if (t === u || (t.x - u.x) * s < 0.3) continue;
          if (t.z + largoP(t) / 2 < u.z - u.largo / 2 - 2 || t.z - largoP(t) / 2 > u.z + u.largo / 2 + 2) continue;
          const tope = t.x - s * ((anchoP(t) + u.ancho) / 2 + 0.3);
          xObj = s > 0 ? Math.min(xObj, tope) : Math.max(xObj, tope);
        }
      }
      xObj = Math.max(-borde + u.ancho / 2 + 0.2, Math.min(borde - u.ancho / 2 - 0.2, xObj));

      // Frena con ABS a fondo si hace falta; acelera mas suave.
      const acel = vObj > u.v ? 9 : 15;
      u.v += Math.max(-acel * dt, Math.min(acel * dt, vObj - u.v));
      u.z += u.v * dt;
      u.distancia += u.v * dt;
      const vLat = pegado ? 6.5 : 5;
      const dx = Math.max(-vLat * dt, Math.min(vLat * dt, xObj - u.x));
      u.x += dx;
      u.vLat = dx / dt;
      u.yaw = Math.atan2(u.vLat, Math.max(4, u.v)) * 0.8;

      if (u.solida) {
        this.#contraTrafico(u, trafico);
        if (!u.chocada) this.#contraChatarra(u);
        if (u.chocada) continue;
      }

      // --- embestida -----------------------------------------------------------------
      if (!u.retirada && enJuego && u.tGolpe <= 0
          && solapanXZ(cajaJ, { x: u.x, z: u.z, yaw: u.yaw, largo: u.largo + MARGEN, ancho: u.ancho + MARGEN })) {
        // Dano medido para que hagan falta varias embestidas: la primera version
        // quitaba ~30 % por golpe porque llegaban lanzadas desde atras.
        const relativa = Math.abs(u.v - j.velocidad) + Math.abs(dx / dt) * 0.8;
        const fuerza = Math.min(22, (u.militar ? 8 : 5.5) + relativa * 0.6);
        const lado = Math.sign(j.x - u.x) || -u.lado;
        this.eventos.push({ tipo: 'golpe', fuerza, lado, militar: u.militar, x: (u.x + j.x) / 2, z: (u.z + j.z) / 2 });
        u.tGolpe = 1.3;
        u.tEmbestida = 2.2 + Math.random() * 2.5;
        u.x -= lado * 0.9;
        u.v -= 5;
        // A veces cambia de lado para la siguiente.
        if (Math.random() < 0.35) u.lado = -u.lado;
      }
    }
    // --- disparos ----------------------------------------------------------------------
    // Rafagas cortas desde atras. La probabilidad de impacto cae con la
    // distancia y con la velocidad lateral del jugador: zigzaguear sirve.
    for (const u of this.unidades) {
      if (!u.activo || u.retirada || u.chocada || !enJuego || !this.activa) continue;
      const puede = u.militar || this.tiempo > cfg.disparanPatrullasDesde;
      if (!puede) continue;
      const dz = j.z - u.z;
      const enRango = dz > cfg.disparoMin && dz < cfg.disparoMax;
      if (u.rafaga <= 0) {
        u.tDisparo -= dt;
        if (u.tDisparo <= 0 && enRango) { u.rafaga = 4 + Math.floor(Math.random() * 4); u.tTiro = 0; }
        continue;
      }
      u.tTiro -= dt;
      if (u.tTiro > 0) continue;
      u.tTiro = 0.11 + Math.random() * 0.05;
      u.rafaga--;
      if (u.rafaga <= 0) u.tDisparo = 2.5 + Math.random() * 3;
      // Boca del arma: copiloto, asomado por la ventanilla del lado del jugador.
      const lado = Math.sign(j.x - u.x) || 1;
      const boca = { x: u.x + lado * (u.ancho / 2 + 0.15), y: 1.45, z: u.z + 0.6 };
      const lateral = Math.abs(j.x - this._jxPrev) / Math.max(dt, 1e-3);
      const prob = Math.max(0.12, 0.62 - dz / 140 - lateral * 0.05);
      const acierta = Math.random() < prob;
      const destino = acierta
        ? { x: j.x + (Math.random() - 0.5) * 1.2, y: 0.6 + Math.random() * 0.6, z: j.z + (Math.random() - 0.5) * 2.5 }
        : { x: j.x + (Math.random() - 0.5) * 7, y: 0.2 + Math.random() * 1.8, z: j.z + 6 + Math.random() * 25 };
      this.#traza(boca, destino);
      this.eventos.push({ tipo: 'disparo', boca, destino, acierta, militar: u.militar, distancia: dz, lado: -lado });
      if (!this.avisoDisparos) { this.avisoDisparos = true; this.eventos.push({ tipo: 'tiroteo' }); }
    }
    this._jxPrev = j.x;

    // Nunca dos unidades montadas una sobre otra (las estrelladas ya chocaron
    // con las demas en #contraChatarra).
    for (let a = 0; a < this.unidades.length; a++) {
      const ua = this.unidades[a];
      if (!ua.activo || ua.chocada) continue;
      for (let b = a + 1; b < this.unidades.length; b++) {
        const ub = this.unidades[b];
        if (!ub.activo || ub.chocada) continue;
        if (Math.abs(ua.z - ub.z) < (ua.largo + ub.largo) / 2 + 1 && Math.abs(ua.x - ub.x) < (ua.ancho + ub.ancho) / 2 + 0.3) {
          if (ua.z < ub.z) ua.v = Math.min(ua.v, ub.v - 2); else ub.v = Math.min(ub.v, ua.v - 2);
        }
      }
    }

    // El trafico tambien las ve: frena detras y no se les cambia de carril encima.
    this._obstaculos.length = 0;
    for (const u of this.unidades) if (u.activo && (u.solida || u.chocada)) this._obstaculos.push(u);
    trafico.obstaculos = this._obstaculos;
  }

  /** Choque de una unidad con el trafico, con la misma prueba SAT que el del jugador. */
  #contraTrafico(u, trafico) {
    for (const t of trafico.vehiculos) {
      if (!t.vivo) continue;
      if (Math.abs(t.z - u.z) > (t.largo + u.largo) / 2 + 1 || Math.abs(t.x - u.x) > (t.ancho + u.ancho) / 2 + 1) continue;
      if (solapanXZ(u, t)) this.#impacto(u, t, trafico);
    }
  }

  /** Una unidad que va persiguiendo se lleva por delante a una ya estrellada. */
  #contraChatarra(u) {
    for (const o of this.unidades) {
      if (o === u || !o.activo || !o.chocada) continue;
      if (Math.abs(o.z - u.z) > (o.largo + u.largo) / 2 + 1 || Math.abs(o.x - u.x) > (o.ancho + u.ancho) / 2 + 1) continue;
      if (!solapanXZ(u, o)) continue;
      const v = u.v;
      this.#impacto(u, o, null);
      if (o.z > u.z) {
        o.v = Math.max(o.v, v * 0.6);
        o.vGiro += (Math.random() < 0.5 ? -1 : 1) * 2;
      }
    }
  }

  /**
   * Resuelve el choque de la unidad `u` con `t` (un vehiculo del trafico o
   * una unidad estrellada). Fuerte, la deja fuera de combate; flojo, rebota.
   * @param {object|null} trafico para avisar al vehiculo golpeado
   */
  #impacto(u, t, trafico) {
    const dz = t.z - u.z;                       // > 0: el otro va delante
    const delante = dz > 0;
    const vOtro = t.velocidad ?? t.v;
    const rel = u.v - vOtro;                    // > 0: la unidad lo alcanza
    const impacto = Math.abs(rel) + Math.abs(u.vLat) * 0.6;
    // Se saca de encima por donde entro: por detras o por delante, o de lado.
    const largos = (t.largo + u.largo) / 2;
    if (Math.abs(dz) > largos * 0.55) u.z = t.z - Math.sign(dz) * (largos + 0.15);
    else u.x = t.x + Math.sign(u.x - t.x || 1) * ((t.ancho + u.ancho) / 2 + 0.12);

    if (u.chocada) {
      // Chatarra: si le llega el trafico por detras, sale empujada.
      if (!delante) {
        u.v = Math.max(u.v, vOtro * 0.9);
        u.vGiro += (Math.random() - 0.5) * 3;
        u.vx += Math.sign(u.x - t.x || 1) * 2;
      } else {
        u.v = Math.min(u.v, vOtro);
      }
      trafico?.golpear(t, delante ? 0 : -vOtro * 0.4, 0.05);
      return;
    }

    // Un camion la para con menos; los del Ejercito aguantan mas.
    const umbral = (u.militar ? 11 : 8) - (t.pesado ? 3 : 0);
    const contra = t.tipo?.nombre ?? t.modelo?.tipo?.nombre ?? 'vehículo';
    if (impacto > umbral) {
      u.chocada = true;
      u.vGiro = (Math.random() < 0.5 ? -1 : 1) * (2.2 + Math.random() * 2.6);
      u.vx = Math.sign(u.x - t.x || u.lado) * (2 + Math.random() * 3);
      u.v = delante ? vOtro * (t.pesado ? 0.35 : 0.65) : Math.max(u.v, vOtro);
      trafico?.golpear(t, delante ? Math.min(7, rel * 0.25) : -Math.min(9, -rel * 0.5), 0.05 + Math.min(0.1, impacto * 0.005));
      this.eventos.push({
        tipo: 'estrellada', militar: u.militar, contra, pesado: !!t.pesado,
        x: (u.x + t.x) / 2, z: (u.z + t.z) / 2, fuerza: impacto,
      });
    } else {
      // Roce: rebota, levanta el pie un momento y sigue.
      if (delante) u.v = Math.min(u.v, vOtro - 1);
      trafico?.golpear(t, delante ? Math.min(2, Math.max(0, rel) * 0.2) : 0, 0.025);
      if (u.tAturdido <= 0) this.eventos.push({ tipo: 'roce', x: (u.x + t.x) / 2, z: (u.z + t.z) / 2, fuerza: impacto });
      u.tAturdido = 0.8;
    }
  }

  #traza(a, b) {
    const t = this.trazas.find(t => t.vida <= 0) ?? this.trazas[0];
    t.vida = 0.07;
    t.a.set(a.x, a.y, a.z);
    // La trazadora es un trozo de la trayectoria, no la linea entera: asi se
    // ve como una bala que viaja y no como un laser.
    t.b.set(b.x, b.y, b.z);
    t.b.sub(t.a).multiplyScalar(0.35 + Math.random() * 0.4).add(t.a);
    t.a.lerp(t.b, 0.25);
  }

  /** @param {number} alpha fraccion del paso @param {number} dt segundos reales */
  presentar(alpha, dt) {
    // Trazadoras
    {
      const pos = this.lineas.geometry.getAttribute('position');
      let n = 0;
      for (const t of this.trazas) {
        if (t.vida <= 0) continue;
        t.vida -= dt;
        pos.setXYZ(n * 2, t.a.x, t.a.y, t.a.z);
        pos.setXYZ(n * 2 + 1, t.b.x, t.b.y, t.b.z);
        n++;
      }
      pos.needsUpdate = true;
      this.lineas.geometry.setDrawRange(0, n * 2);
    }
    // Destello doble rojo / azul, como una barra de verdad.
    const fase = (this.reloj * 3.4) % 1;
    for (const k in this.modelos) this.modelos[k].n = 0;
    let nr = 0, ns = 0;
    for (const u of this.unidades) {
      if (!u.activo) continue;
      const m = u.modelo;
      const x = u.xPrev + (u.x - u.xPrev) * alpha;
      const z = u.zPrev + (u.z - u.zPrev) * alpha;
      const yaw = u.yawPrev + (u.yaw - u.yawPrev) * alpha;
      const dist = u.distanciaPrev + (u.distancia - u.distanciaPrev) * alpha;
      this._q.setFromAxisAngle(this._arriba, yaw);
      this._m4.compose(this._v.set(x, 0, z), this._q, this._s.set(1, 1, 1));
      const slot = m.n++;
      m.malla.setMatrixAt(slot, this._m4);
      m.attrs.tinte1.setXYZ(slot, u.tinte1.r, u.tinte1.g, u.tinte1.b);
      m.attrs.tinte2.setXYZ(slot, u.tinte2.r, u.tinte2.g, u.tinte2.b);
      // Desfase por unidad: que no destellen todas a la vez.
      const desf = (fase + u.fase) % 1;
      const r = (desf < 0.12 || (desf > 0.2 && desf < 0.32)) ? 1 : 0;
      const b = (desf > 0.5 && desf < 0.62) || (desf > 0.7 && desf < 0.82) ? 1 : 0;
      m.attrs.estado.setXYZ(slot, 0, r, b);

      this._m4.compose(this._v.set(x, 0.02, z), this._q, this._s.set(u.ancho * 1.22, 1, u.largo * 1.08));
      this.sombras.setMatrixAt(ns++, this._m4);

      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const w of m.ruedas) {
        const giro = dist / w.r;
        const lado = w.x < 0 ? -1 : 1;
        this._qr.setFromAxisAngle(this._eje, lado > 0 ? giro : -giro);
        this._qs.setFromAxisAngle(this._arriba, yaw + (lado < 0 ? Math.PI : 0)).multiply(this._qr);
        this._v.set(x + w.x * cy + w.z * sy, w.r, z - w.x * sy + w.z * cy);
        this._m4.compose(this._v, this._qs, this._s.set(w.ancho, w.r, w.r));
        this.ruedas.setMatrixAt(nr++, this._m4);
      }
    }
    for (const k in this.modelos) {
      const m = this.modelos[k];
      m.malla.count = m.n;
      m.malla.instanceMatrix.needsUpdate = true;
      m.attrs.tinte1.needsUpdate = true; m.attrs.tinte2.needsUpdate = true; m.attrs.estado.needsUpdate = true;
    }
    this.ruedas.count = nr;
    this.ruedas.instanceMatrix.needsUpdate = true;
    this.sombras.count = ns;
    this.sombras.instanceMatrix.needsUpdate = true;

    // --- helicoptero -----------------------------------------------------------------
    const h = this.heli;
    h.grupo.visible = this.heliActivo;
    h.mancha.visible = this.heliActivo && this.activa;
    if (this.heliActivo) {
      h.grupo.position.lerpVectors(this.heliPrev, this.heliPos, alpha);
      // Morro algo hacia abajo y hacia el jugador, como uno que lo sigue.
      const haciaX = this._jx - h.grupo.position.x, haciaZ = this._jz - h.grupo.position.z;
      h.grupo.rotation.set(0.12, Math.atan2(haciaX, haciaZ) * 0.3, Math.sin(this.reloj * 0.7) * 0.05);
      h.rotor.rotation.y += dt * 38;
      h.rotorCola.rotation.x += dt * 60;
      // Reflector: del helicoptero al jugador.
      const alto = h.grupo.position.y;
      h.mancha.position.set(this._jx + Math.sin(this.reloj * 1.3) * 0.8, 0.04, this._jz + 1.5);
      h.cono.scale.set(1, alto, 1);
      const dirx = h.mancha.position.x - h.grupo.position.x;
      const dirz = h.mancha.position.z - h.grupo.position.z;
      // El cono vive dentro del grupo (que tiene su propio giro): se orienta en
      // espacio de mundo y se pasa a local.
      this._v.set(dirx, -alto, dirz).normalize();
      this._qs.setFromUnitVectors(this._v.set(0, -1, 0), this._v.clone().set(dirx, -alto, dirz).normalize());
      this._qr.copy(h.grupo.quaternion).invert().multiply(this._qs);
      h.cono.quaternion.copy(this._qr);
      h.cono.scale.y = Math.hypot(dirx, alto, dirz);
    }
  }
}
