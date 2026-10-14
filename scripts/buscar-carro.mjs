/* Busca en Sketchfab carros DESCARGABLES con licencia que se pueda publicar.
   Solo lee la API publica de busqueda (no hace falta cuenta para esto).
     node scripts/buscar-carro.mjs                  -> el barrido completo
     node scripts/buscar-carro.mjs "mustang 1969"   -> una busqueda suelta  */
const TERMINOS = process.argv[2] ? [process.argv[2]] : [
  'muscle car', 'sports car', 'supercar', 'coupe car', 'race car',
  'sedan car', 'hypercar', 'gt car', 'tuner car', 'drift car',
];
// Licencias que permiten publicar el juego. SA obliga a compartir igual la
// MALLA modificada, no el codigo: se puede, pero se prefiere CC0 y CC-BY.
const OK = {
  '7c23a1ba438d4306920229c12afcb5f9': 'CC0',
  '322a749bcfa841b29dff1e8a1bb74b0b': 'CC-BY',
  'b9ddc40b93e34cdca1fc152f39b9f375': 'CC-BY-SA',
};
const vistos = new Map();
for (const q of TERMINOS) {
  for (const orden of ['-likeCount', '-viewCount', '-publishedAt']) {
    const url = `https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(q)}`
      + `&downloadable=true&sort_by=${orden}&count=24`;
    const r = await fetch(url);
    if (!r.ok) { console.error(q, r.status); continue; }
    for (const m of (await r.json()).results ?? []) {
      const lic = OK[m.license?.uid];
      if (!lic) continue;
      const caras = m.faceCount ?? 0;
      if (caras < 15000 || caras > 1200000) continue;   // ni cartón ni inmanejable
      vistos.set(m.uid, {
        lic, caras, likes: m.likeCount ?? 0, vistas: m.viewCount ?? 0,
        nombre: m.name, autor: m.user?.displayName, uid: m.uid, url: m.viewerUrl,
        pbr: (m.tags ?? []).map(t => t.name).join(','),
      });
    }
  }
}
const lista = [...vistos.values()].sort((a, b) => b.likes - a.likes);
console.log(`${lista.length} candidatos\n`);
for (const m of lista.slice(0, 45)) {
  console.log(`${m.lic.padEnd(9)} ${String(m.caras).padStart(8)} caras  ♥${String(m.likes).padStart(5)}  ${m.nombre.slice(0, 48).padEnd(48)} ${m.autor ?? ''}`);
  console.log(`          ${m.url}`);
}
