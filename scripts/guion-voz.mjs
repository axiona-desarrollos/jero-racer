// Guion del narrador de JERO RACER: que dice cada personaje en cada momento
// del juego. Lo lee scripts/generar-voces.mjs para fabricar los audios de
// public/voz/. Para cambiar una frase se cambia aqui y se vuelve a generar.
//
// prioridad: 3 interrumpe lo que suene (fin de partida, fotomultas);
//            2 espera turno; 1 se descarta si hay alguien hablando.
// espera:    segundos minimos entre dos frases del mismo evento.
// prob:      probabilidad de que hable (para lo que pasa muy seguido).
// primera:   la primera vez de cada tirada dice la frase 0 (la del chiste
//            completo); despues rota entre todas.

export const PERSONAJES = {
  // Narrador de partido de futbol: emocionado y rapido.
  narrador: {
    voz: 'es-CO-GonzaloNeural', velocidad: '+18%', tono: '+6Hz',
    filtro: 'acompressor=threshold=-20dB:ratio=3:attack=5:release=80,equalizer=f=3200:t=q:w=1:g=4,'
      + 'aecho=0.8:0.55:45|80:0.12|0.08',
  },
  // La dona chismosa del barrio: las fotomultas son suyas.
  dona: {
    voz: 'es-CO-SalomeNeural', velocidad: '+6%', tono: '+22Hz',
    filtro: 'acompressor=threshold=-20dB:ratio=2.5,equalizer=f=2500:t=q:w=1:g=3',
  },
  // El tombo por megafono: banda estrecha, saturado y con eco de calle.
  tombo: {
    voz: 'es-CO-GonzaloNeural', velocidad: '-4%', tono: '-6Hz',
    filtro: 'highpass=f=520,lowpass=f=3300,volume=6,asoftclip=type=tanh,aecho=0.8:0.6:70|140:0.35|0.2',
  },
  // La ardilla: aguda y acelerada, de caricatura.
  ardilla: {
    voz: 'es-CO-GonzaloNeural', velocidad: '+10%', tono: '+0Hz',
    filtro: 'asetrate=24000*1.42,aresample=24000,atempo=0.88',
  },
};

const N = t => ['narrador', t], D = t => ['dona', t], T = t => ['tombo', t], A = t => ['ardilla', t];

// Las cuentas de TikTok, dichas como se leen en voz alta.
const JERO = 'arroba jero fernández dos dos dos';
const TAKAMURA = 'arroba Esteban punto Takamura';
const AXIONA = 'arroba Axiona punto software I A';

export const EVENTOS = {
  arranque: { prioridad: 2, lineas: [
    N('¡Y arrancaaa Jero Racer! ¡Agárrese, mijo, que esto va a mil!'),
    N('¡Atención, señoras y señores! ¡Arrancó la carrera más peligrosa del Valle de Aburrá!'),
    N('¡Arrancamos, parce! ¡Pilas con las tractomulas!'),
    N('¡Dele, dele, dele! ¡Que la autopista es suya!'),
  ] },
  velocidad150: { prioridad: 1, lineas: [N('¡A toda máquina, señores!')] },
  velocidad200: { prioridad: 1, lineas: [N('¡Doscientos! ¡A mil, parcero!')] },
  velocidad240: { prioridad: 1, lineas: [N('¡Esto vuela, mijo! ¡Doscientos cuarenta!')] },

  rozon: { prioridad: 1, espera: 5, prob: 0.6, lineas: [
    A('¡Uy, por un pelo!'), A('¡Rozón!'), A('¡Casi, mijo!'), A('¡Qué susto, parce!'),
    A('¡Fino, papá!'), A('¡Uy, ese pasó raspando!'), N('¡Por un pelito, señores!'),
  ] },
  combo3: { prioridad: 1, espera: 4, lineas: [
    N('¡Se prendió este parche!'), N('¡Qué chimba de manejo!'), N('¡Está encendido, parce!'),
  ] },
  combo5: { prioridad: 2, espera: 4, lineas: [
    N('¡Combo por cinco! ¡Nivel Dios, parce!'), N('¡Esto es una chimba, señores!'), A('¡Combo por cinco! ¡Qué chimba, parce!'),
  ] },
  // Pasar pegado a un camion con publicidad: el narrador hace la cuña.
  rozonJero: { prioridad: 2, espera: 45, lineas: [
    N(`¡Uy, casi se come la mula de Jero! ¡Síganlo en TikTok: ${JERO}!`),
    N(`¡Le pasó raspando al camión de Jero Fernández! ¡${JERO} en TikTok!`),
  ] },
  rozonTakamura: { prioridad: 2, espera: 45, lineas: [
    N(`¡Por un pelo el camión de Takamura! ¡${TAKAMURA} en TikTok!`),
    N(`¡Uy, casi se lleva la mula roja de Takamura! ¡Síganlo: ${TAKAMURA}!`),
  ] },
  rozonAxiona: { prioridad: 2, espera: 45, lineas: [
    N(`¡Uy, el camión de Axiona! ¡Software con inteligencia artificial! ¡${AXIONA}!`),
    N(`¡Casi se come la mula de axionasoft punto com! ¡Síganlos en TikTok: ${AXIONA}!`),
  ] },

  persecucion: { prioridad: 2, lineas: [
    T('¡Atención, conductor del vehículo rojo! ¡Orílleseee a la derecha! ¡Policía Nacional!'),
    N('¡Llegó la tomba! ¡Corra, corra que lo cogen!'),
    N('¡Se prendió el bololó, señores!'),
    T('¡Policía Nacional! ¡Detenga el vehículo!'),
  ] },
  megafono: { prioridad: 1, lineas: [
    T('¡Orílleseee a la derecha!'), T('¡Detenga el vehículo!'),
    T('¡Apague ese carro, mijo, y bájese con las manos arriba!'),
    T('¡No dé papaya, mijo! ¡Orílleseee!'), T('¡Último aviso! ¡Detenga el vehículo!'),
  ] },
  ejercito: { prioridad: 2, lineas: [
    N('¡Se metió el Ejército, señores! ¡Esto se puso serio!'), T('¡Ejército Nacional! ¡Detenga el vehículo!'),
  ] },
  helicoptero: { prioridad: 2, lineas: [N('¡Llegó el pájaro! ¡Lo están viendo desde arriba, mijo!')] },
  tiroteo: { prioridad: 2, lineas: [N('¡Plomo, parce! ¡Agáchese, mijo!'), N('¡Nos están dando bala, señores!')] },
  golpe: { prioridad: 1, espera: 4, lineas: [
    A('¡Totazo!'), A('¡Ay, mi carrito!'), N('¡Lo bolearon!'), A('¡Pum! ¡Qué golpe!'),
  ] },
  estrellada: { prioridad: 2, espera: 3, lineas: [
    N('¡Se estrelló la tomba! ¡Qué boleta, señores, qué boleta!'), N('¡Patrulla fuera de combate!'),
    N('¡Esa patrulla quedó pa\' chatarra!'), A('¡Se toteó el tombo! ¡Jajajá!'),
  ] },
  estrelladaMula: { prioridad: 2, espera: 3, lineas: [
    N('¡Se la comió la tractomula! ¡Qué boleta!'), N('¡Se estrelló la tomba contra el camión, señores!'),
  ] },
  estrelladaEjercito: { prioridad: 2, espera: 3, lineas: [N('¡Se estrelló el Ejército! ¡Un camión militar menos!')] },
  escape: { prioridad: 2, lineas: [
    N('¡Se les voló! ¡Ni lo huelen!'), N('¡Adiós, tombos! ¡Los dejó con el crespo hecho!'), N('¡Qué verraquera! ¡Se les escapó!'),
  ] },

  fotomulta: { prioridad: 3, lineas: [
    D('¡Ay, Dios mío, mijo! ¡Te cogió la fotomulta!'), D('¡Ay, no, mijo! ¡Flashazo! ¡Te cogió la fotomulta!'),
  ] },
  fotomultaOtra: { prioridad: 3, primera: true, lineas: [
    D('¡Te cogió otra fotomulta! ¡Estás es pero multado, papito! ¡Lo que debes es plata! ¡Jajajá!'),
    D('¡Otra fotomulta! Ese carro ya es más del tránsito que tuyo, ¡jajajá!'),
    D('¡Otra! Con tanta multa te toca vender el carro, papito. ¡Jajajá!'),
    A('¡Otra fotomulta! ¡La cámara ya te saluda por el nombre! ¡Jajajá!'),
    D('¡Otro recibo pa\' la colección, mijo! ¡Jajajá!'),
  ] },
  fotomultaOculta: { prioridad: 3, primera: true, lineas: [
    D('Jummm... te cogió esa fotomulta, esa que ni aviso tiene. ¿Pa\' que monte la queja y reclamo cuando le llegue el recibo... o se va a quedar callado? ¡Jajajá!'),
    D('Jummm... ¿y el aviso? ¡Bien, gracias! Monte la queja, mijo... ¿o se va a quedar callado?'),
    D('¡Esa estaba escondida detrás del poste! ¡Jajajá!'),
  ] },
  salvada: { prioridad: 2, lineas: [
    D('¡Eso, mijo! ¡Juicioso! ¡Se salvó de la fotomulta!'), D('¡Ay, qué juicioso! ¡Esta vez no lo cogieron!'),
  ] },

  record: { prioridad: 2, lineas: [N('¡Nuevo récord, parce! ¡Usted es una chimba!')] },
  danio50: { prioridad: 2, lineas: [N('¡Eso va a salir caro, mijo!')] },
  danio80: { prioridad: 2, lineas: [N('¡El carro ya no da más! ¡Un golpe más y lo detienen!')] },

  choque: { prioridad: 3, lineas: [
    N('¡Ay, nojoda! ¡Qué estrellón, parce!'), N('¡Se lo totió, mijo!'), N('¡Le faltó calle!'),
    N('¡Eso le pasa por dar papaya!'), N('¡Uy, qué boleta! ¡Se estrelló!'),
  ] },
  choqueJero: { prioridad: 3, lineas: [N(`¡Se estrelló contra la mula de Jero! ¡Síganlo en TikTok, ${JERO}!`)] },
  choqueTakamura: { prioridad: 3, lineas: [N(`¡Se estrelló contra el camión de Takamura! ¡Síganlo en TikTok, ${TAKAMURA}!`)] },
  choqueAxiona: { prioridad: 3, lineas: [N(`¡Se estrelló contra el camión de Axiona! ¡Síganlos en TikTok, ${AXIONA}!`)] },
  detenido: { prioridad: 3, lineas: [
    T('¡Pa\' la UPJ, mijo! ¡Se le acabó la fiesta!'), N('¡Lo cogió la tomba, señores!'), T('¡Quieto ahí! ¡Manos arriba!'),
  ] },
  tiktok: { prioridad: 2, lineas: [N(`Síganlos en TikTok: ${JERO}, ${TAKAMURA}, y ${AXIONA}.`)] },
};
