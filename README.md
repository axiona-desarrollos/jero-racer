# JERO RACER · Autopista infinita

**Juega gratis:** https://jeroracer.axionasoft.com — en el navegador del PC, iPhone y Android.

![JERO RACER](public/compartir.jpg)

Juego de carreras en 3D: manejas un deportivo por una autopista antioqueña que no se acaba y esquivas carros, taxis, buses intermunicipales, camiones y tractomulas. Sumas puntos por distancia y velocidad, y bonos por **rozón** cuando pasas a menos de un metro de un vehículo.

Hecho por [Axiona Desarrollos Inteligentes S.A.S.](https://axionasoft.com) (Sabaneta, Colombia).

## Controles

| | PC | Celular |
|---|---|---|
| Acelerar | `W` / `↑` | botón **GAS** |
| Frenar / reversa | `S` / `↓` | botón **FRENO** |
| Girar | `A` `D` / `←` `→` | inclinar el teléfono (o botones ◀ ▶) |
| Freno de mano (derrape) | `Espacio` | botón **F. MANO** |
| Cámara · pausa · sonido | `C` · `Esc` · `M` | botones de arriba |

También funciona con un control de consola (gatillos y palanca izquierda).

## Qué tiene por dentro

- **Física real del vehículo** con [Rapier](https://rapier.rs): suspensión por rayos, tren motriz con caja automática, freno con ABS, control de estabilidad y freno de mano que deja derrapar.
- **Tráfico con conductores**: cada vehículo sigue al de delante con el Modelo del Conductor Inteligente (IDM), frena con luz de freno y pone la direccional antes de cambiar de carril.
- **Diez vehículos modelados en código** (`src/traffic/flota.js`): sedán, hatchback, taxi, SUV, pickup, van, bus, camión y dos tractomulas, con versión ligera para la distancia.
- **Persecución**: por encima de 170 km/h llega la Policía Nacional; si se alarga, el Ejército y un helicóptero con reflector. Embisten y disparan, el carro se daña y al 100 % te detienen. Bajar de 170 km/h es rendirse: te dejan. Las patrullas también chocan con el tráfico: llevarlas contra una tractomula las deja fuera de combate y da puntos.
- **Fotomultas**: cámaras de fotodetección como las de Medellín, a 50 y 70 km/h. Unas tienen aviso y otras no. Pasar por encima del límite dispara el flash, y cada multa tiene su chiste.
- **Publicidad en la vía**: camiones, tractomulas, buses, vallas, puentes y paneles LED con axionasoft.com y las cuentas de TikTok @jerofernandez222, @esteban.takamura y @axiona.softwareia (los botones del menú, la pausa y el final abren cada perfil).
- **Narrador con voces paisas**: el narrador de fútbol, la doña chismosa de las fotomultas, el tombo del megáfono y la ardilla comentan la partida y nombran las cuentas de TikTok cuando pasas junto a sus camiones. Se apaga en el menú (VOZ).
- **Inclinación del teléfono** como timón (`src/core/tactil.js`), calidad gráfica adaptable y resolución dinámica.
- **App instalable** (PWA) que funciona sin conexión después de la primera carga.

## Desarrollo

```bash
npm install
npm run models     # descarga el deportivo de Khronos y lo optimiza
npm run carros     # baja y prepara los carros de Sketchfab (ver abajo)
npm run dev        # http://localhost:8150
```

- `npm test` — pruebas (dirección, tren motriz, cámara, tráfico, fotomultas).
- `npm run voces` — genera las voces del narrador (`scripts/guion-voz.mjs`) con Azure Speech; la clave va en `.env.voz`, que no se sube. `npm run voces:borrador` hace unas de prueba con edge-tts.
- `npm run build:web` — compilación pública en `dist/`.
- `/taller.html` (solo en desarrollo) — sala para revisar los modelos de la flota.

La escena fotorrealista de la Glorieta Pilsen (`?escena=pilsen`) necesita una clave propia de Google Map Tiles en `.env.local` (ver `.env.example`). La compilación pública la deja vacía a propósito.

## Licencias y créditos

- Código: [MIT](LICENSE) © Axiona Desarrollos Inteligentes S.A.S.
- Deportivo: «Car Concept», Khronos Group, [CC BY 4.0](https://github.com/KhronosGroup/glTF-Sample-Assets). No se incluye en el repositorio: lo descarga `npm run models`.
- Carros de Sketchfab, todos [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), simplificados y comprimidos para la web. No se incluyen en el repositorio: los prepara `npm run carros`.
  - «Ford Mustang Shelby GT500» de [Jiaxing](https://sketchfab.com/saitoyang) — [modelo](https://sketchfab.com/3d-models/ford-mustang-shelby-gt500-0eaa7a16796540f29461ddae05ecdeb3)
  - «Lamborghini Centenario LP-770 Interior SDC» de [SDC PERFORMANCE](https://sketchfab.com/3DRaptor) — [modelo](https://sketchfab.com/3d-models/lamborghini-centenario-lp-770-interior-sdc-d679af35b5694301a185c7454a700c73)
  - «BMW M4 CSL 2023» de [Black Snow](https://sketchfab.com/BlackSnow02) — [modelo](https://sketchfab.com/3d-models/bmw-m4-csl-2023-26d05968e63b4fc28205cbb9abb0ea41)

  Las marcas y diseños de los vehículos son de sus dueños, que no patrocinan ni avalan este juego.

### Carros de Sketchfab

Sketchfab no deja descargar sin cuenta. Dos formas:

1. **Con token** (lo baja todo solo): copia tu API Token de [sketchfab.com/settings/password](https://sketchfab.com/settings/password) a un archivo `.env.modelos` con `SKETCHFAB_TOKEN=...` y corre `npm run carros`.
2. **A mano**: en cada enlace de arriba, *Download 3D Model → glTF*, deja los `.zip` en `modelos/` sin descomprimir y corre `npm run carros`.

El juego solo ofrece en el menú los carros que estén preparados en `public/models` al compilar (`models/carros.json`).
- Trazado de la glorieta: © colaboradores de OpenStreetMap ([ODbL](https://www.openstreetmap.org/copyright)).
- Motor 3D: [three.js](https://threejs.org) (MIT). Física: [Rapier](https://rapier.rs) (Apache 2.0).
