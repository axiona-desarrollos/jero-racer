/* Mide los fotogramas por segundo reales jugando, con y sin postproceso. */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROMES = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'];
const nav = await puppeteer.launch({
  executablePath: CHROMES.find(p => existsSync(p)), headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--window-size=1600,900'],
});
for (const url of process.argv.slice(2)) {
  const p = await nav.newPage();
  await p.setViewport({ width: 1600, height: 900 });
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.waitForFunction('window.HR !== undefined', { timeout: 60000 });
  const fps = await p.evaluate(`(async()=>{
    HR.empezar();
    await new Promise(r=>setTimeout(r,3500));
    const v=[];
    for (let i=0;i<14;i++){ HR.vehicle.body.setLinvel({x:0,y:0,z:58},true); await new Promise(r=>setTimeout(r,500)); v.push(HR.loop.fps); }
    v.sort((a,b)=>a-b);
    return { mediana: Math.round(v[7]), minimo: Math.round(v[0]), descartes: HR.loop.dropped };
  })()`);
  console.log(url.replace('http://localhost:8150/', '') || '(normal)', '→', JSON.stringify(fps));
  await p.close();
}
await nav.close();
