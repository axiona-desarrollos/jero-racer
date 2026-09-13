/* ==========================================================================
   HIGHWAY RACER · Afinado de texturas
   --------------------------------------------------------------------------
   Una superficie mirada casi de canto — el asfalto por delante del coche, o la
   propia carroceria desde la camara de persecucion — se deshace si la GPU
   muestrea su mipmap por el eje corto: promedia decimetros de textura en un
   solo texel y el resultado es la papilla que se ve.

   El filtrado anisotropico lo arregla, pero NO hace nada sin mipmaps, asi que
   hay que activar los dos o no se nota ninguno.

   POR QUE ESTO VIVE APARTE
   Lo necesitan tres sitios que no se conocen entre si: las teselas de Google
   segun llegan por streaming, el firme de la autopista, y las texturas que trae
   el GLB del coche — que venian todas con anisotropia 1 porque el cargador no
   tiene forma de saber que GPU hay debajo.
   ========================================================================== */

import * as THREE from 'three';

const CANALES = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap',
  'emissiveMap', 'aoMap', 'alphaMap', 'clearcoatNormalMap',
];

/**
 * Aplica mipmaps y anisotropia maxima a todas las texturas de un objeto.
 *
 * Es idempotente: marca lo ya tratado, asi que se puede llamar en un evento de
 * carga que dispara cientos de veces sin pagarlo dos veces.
 *
 * @param {THREE.Object3D} raiz
 * @param {number} anisotropia  normalmente renderer.capabilities.getMaxAnisotropy()
 * @returns {number} cuantas texturas se han tocado
 */
export function afinarTexturas(raiz, anisotropia) {
  if (!raiz || !(anisotropia > 1)) return 0;
  let n = 0;
  raiz.traverse(objeto => {
    const materiales = Array.isArray(objeto.material) ? objeto.material
      : objeto.material ? [objeto.material] : [];
    for (const material of materiales) {
      for (const canal of CANALES) {
        const textura = material[canal];
        if (!textura || textura.__afinada) continue;
        textura.generateMipmaps = true;
        textura.minFilter = THREE.LinearMipmapLinearFilter;
        textura.magFilter = THREE.LinearFilter;
        textura.anisotropy = anisotropia;
        textura.needsUpdate = true;
        textura.__afinada = true;
        n++;
      }
    }
  });
  return n;
}
