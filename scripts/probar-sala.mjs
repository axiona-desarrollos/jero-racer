/* Dos jugadores en la misma sala, en el mismo navegador. Sin Supabase la sala
   usa BroadcastChannel, que funciona entre pestañas: sirve para probar toda la
   logica de red (presencia, interpolacion, rotulos, rozones) en este PC. */
import { existsSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROMES = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'];
const nav = await puppeteer.launch({
  executablePath: CHROMES.find(p => existsSync(p)), headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--window-size=1440,810'],
});

async function jugador(apodo, carril) {
  const p = await nav.newPage();
  await p.setViewport({ width: 1440, height: 810 });
  p.on('pageerror', e => console.error(`[${apodo}] ✗`, String(e).slice(0, 200)));
  p.on('console', m => { if (m.type() === 'error') console.error(`[${apodo}] ✗`, m.text().slice(0, 200)); });
  await p.goto('http://localhost:8150/?calidad=alta', { waitUntil: 'networkidle2', timeout: 60000 });
  await p.waitForFunction('window.HR !== undefined', { timeout: 60000 });
  await p.evaluate(`(async()=>{
    document.querySelector('#oLinea').click();
    document.querySelector('#sApodo').value = ${JSON.stringify(apodo)};
    document.querySelector('#sCodigo').value = 'PRUEBA';
    document.querySelector('#bEntrarSala').click();
    await new Promise(r=>setTimeout(r,900));
    document.querySelector('#bCerrarLinea').click();
    HR.empezar();
    await new Promise(r=>setTimeout(r,3400));
  })()`);
  // Cada uno en su carril, a velocidades distintas, para verse de verdad.
  await p.evaluate(`(()=>{
    const v = HR.vehicle.body;
    const t = v.translation();
    v.setTranslation({x:${carril}, y:t.y, z:t.z}, true);
  })()`);
  return p;
}

const a = await jugador('JERO', 1.6);
const b = await jugador('ESTEBAN', -1.8);

// Los dos rodando un rato, a velocidades parecidas para quedar lado a lado.
for (let i = 0; i < 16; i++) {
  await a.evaluate('HR.vehicle.body.setLinvel({x:0,y:0,z:52},true)');
  await b.evaluate('HR.vehicle.body.setLinvel({x:0,y:0,z:50},true)');
  await new Promise(r => setTimeout(r, 180));
}

const info = await a.evaluate(`({
  dentro: HR.post ? true : true,
  sala: document.querySelector('#hSalaCod')?.textContent,
  lista: [...document.querySelectorAll('#hSalaJ .j')].map(d=>d.textContent),
})`);
console.log('marcador de sala →', JSON.stringify(info));

writeFileSync(process.argv[2] ?? 'tmp/sala.png', await a.screenshot({ type: 'png' }));
console.log('→', process.argv[2]);
await nav.close();
