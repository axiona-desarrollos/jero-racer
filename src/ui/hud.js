/* ==========================================================================
   HIGHWAY RACER · HUD
   --------------------------------------------------------------------------
   El DOM se construye UNA vez y despues solo se escribe textContent sobre
   nodos cacheados. La version anterior reemplazaba innerHTML entero hasta 144
   veces por segundo: el navegador destruia y reparseaba todo el subarbol en
   cada frame, y esa basura alimentaba al recolector — cuyas pausas se
   convertian en deuda del acumulador del bucle.

   Ademas se refresca a 20 Hz: nadie lee un numero que cambia 144 veces
   por segundo.
   ========================================================================== */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const FILAS = [
  ['rpm', 'rpm'],
  ['volante', 'steer'],
  ['autoridad', 'authority'],
  ['ángulo de derrape', 'slip', 'hl'],
  ['desliz. trasero', 'rear', 'bar'],
  ['desliz. delantero', 'front', 'bar'],
  ['acelerador', 'throttle', 'bar'],
  ['freno', 'brake', 'bar'],
];

export class Hud {
  constructor(root, { hz = 20 } = {}) {
    this.root = root;
    this.interval = 1 / hz;
    this.acc = 0;
    this.n = {};

    root.textContent = '';
    root.className = 'hud';

    const big = el('div', 'big');
    this.n.speed = el('span', 'sp'); big.appendChild(this.n.speed);
    const u = el('i'); u.textContent = 'km/h'; big.appendChild(u);
    this.n.gear = el('span', 'g'); big.appendChild(this.n.gear);
    root.appendChild(big);

    for (const [label, key, cls] of FILAS) {
      const r = el('div', 'r' + (cls === 'hl' ? ' hl' : ''));
      const s = el('span'); s.textContent = label; r.appendChild(s);
      const b = el('b', cls === 'bar' ? 'm' : ''); r.appendChild(b);
      this.n[key] = b;
      root.appendChild(r);
    }

    const d = el('div', 'r dim');
    const ds = el('span'); ds.textContent = 'fps · pasos'; d.appendChild(ds);
    this.n.diag = el('b'); d.appendChild(this.n.diag);
    root.appendChild(d);

    this.n.aviso = el('div', 'aviso');
    root.appendChild(this.n.aviso);
  }

  /** @param {object} t telemetria @param {number} dt segundos reales */
  update(t, dt, diag) {
    this.acc += dt;
    if (this.acc < this.interval) return;
    this.acc = 0;

    const n = this.n;
    n.speed.textContent = Math.abs(t.speed).toFixed(0);
    n.gear.textContent = t.gear;
    n.rpm.textContent = t.rpm.toFixed(0);
    n.steer.textContent = (t.steer * 100).toFixed(0) + '%';
    n.authority.textContent = (t.authority * 100).toFixed(0) + '%';
    n.slip.textContent = t.slip.toFixed(1) + '°';
    n.rear.textContent = bar(t.rear);
    n.front.textContent = bar(t.front);
    n.throttle.textContent = bar(t.throttle);
    n.brake.textContent = bar(t.brake) + (t.handbrake ? ' MANO' : '');
    n.diag.textContent = `${diag.fps.toFixed(0)} · ${diag.steps}${diag.dropped ? ' ·' + diag.dropped : ''}`;

    const aviso = t.upsideDown
      ? `VOLCADO — reponiendo en ${(t.recuperandoEn ?? 0).toFixed(1)} s`
      : t.airborne ? 'EN EL AIRE' : '';
    if (n.aviso.textContent !== aviso) n.aviso.textContent = aviso;
  }
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function bar(v, n = 14) {
  const k = Math.round(clamp(v, 0, 1) * n);
  return '█'.repeat(k) + '·'.repeat(n - k);
}
