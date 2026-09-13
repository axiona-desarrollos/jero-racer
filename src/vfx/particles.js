/* ==========================================================================
   HIGHWAY RACER · Particulas
   --------------------------------------------------------------------------
   Un solo BufferGeometry por sistema y un pool de indices. No se crea ni se
   destruye NADA en caliente: emitir es escribir en un hueco libre del array.
   Con 900 particulas eso son 3 atributos que se suben a GPU por frame, contra
   900 objetos y 900 llamadas de dibujo si se hiciera con mallas.

   La textura tambien se genera por codigo: un degradado radial en un canvas.
   Cero descargas.
   ========================================================================== */

import * as THREE from 'three';

function discTexture(suave = 0.45) {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, s * 0.02, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(suave, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Sistema de particulas con pool fijo. */
export class ParticleSystem {
  /**
   * @param {number} max      tamaño del pool
   * @param {object} o        size, sizeGrow, drag, gravity, blending, opacity
   */
  constructor(max, o = {}) {
    this.max = max;
    this.o = Object.assign({
      size: 1.0, sizeGrow: 1.8, drag: 0.94, gravity: 0.0,
      blending: THREE.NormalBlending, opacity: 1.0, depthWrite: false,
      soft: 0.45,
    }, o);

    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);      // 0 = libre
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.cursor = 0;
    this.vivas = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setDrawRange(0, max);
    this.geometry = g;

    const mat = new THREE.ShaderMaterial({
      uniforms: { mapa: { value: discTexture(this.o.soft) } },
      transparent: true,
      depthWrite: this.o.depthWrite,
      blending: this.o.blending,
      // Los #include de profundidad logaritmica NO son decoracion: la escena
      // fotorrealista de Medellin necesita 20 km de alcance y ahi el buffer de
      // profundidad pasa a ser logaritmico. Un ShaderMaterial crudo no se entera
      // y escribe la profundidad lineal: el humo y las llamas se colarian por
      // delante de los edificios. Cuando el buffer es normal, los chunks se
      // compilan a nada.
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying float vA; varying vec3 vC;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){
          vA = alpha; vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D mapa; varying float vA; varying vec3 vC;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main(){
          vec4 t = texture2D(mapa, gl_PointCoord);
          if (t.a * vA < 0.004) discard;
          #include <logdepthbuf_fragment>
          gl_FragColor = vec4(vC, t.a * vA);
        }`,
    });

    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Emite una particula. Si el pool esta lleno reutiliza la mas antigua. */
  emit(x, y, z, vx, vy, vz, vida, tam, r, g, b) {
    let i = -1;
    for (let n = 0; n < this.max; n++) {
      const c = (this.cursor + n) % this.max;
      if (this.life[c] <= 0) { i = c; break; }
    }
    if (i < 0) i = this.cursor % this.max;
    this.cursor = (i + 1) % this.max;

    const p = i * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
    this.life[i] = vida; this.maxLife[i] = vida;
    this.size[i] = tam;
    this.col[p] = r; this.col[p + 1] = g; this.col[p + 2] = b;
    this.alpha[i] = 0;
  }

  update(dt) {
    const { drag, gravity, sizeGrow } = this.o;
    const d = Math.pow(drag, dt * 60);
    let vivas = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      vivas++;
      const p = i * 3;
      this.vel[p] *= d; this.vel[p + 1] = this.vel[p + 1] * d + gravity * dt; this.vel[p + 2] *= d;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;

      const t = this.life[i] / this.maxLife[i];       // 1 -> 0
      this.size[i] += sizeGrow * dt;
      // entra deprisa, se va despacio
      this.alpha[i] = this.o.opacity * Math.min(1, (1 - t) * 8) * t * t;
    }
    this.vivas = vivas;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
    this.geometry.attributes.alpha.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  clear() { this.life.fill(0); this.alpha.fill(0); }
}
