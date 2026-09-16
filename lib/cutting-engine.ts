/**
 * Motor de sugerencia de corte.
 *
 * Es un algoritmo determinista (no un modelo de lenguaje) — decidir en qué
 * coordenadas exactas cortar una pieza es un problema de optimización
 * combinatoria (2D cutting-stock / skyline packing), no una tarea de lenguaje.
 * Un LLM puede fallar la aritmética de coordenadas; este algoritmo es
 * 100% verificable y reproducible, igual a como Diego ya lo hace a mano en
 * su "Plano de corte" — solo que aquí queda automatizado y con trazabilidad.
 *
 * Supuesto de diseño (pendiente de confirmar con Diego, ver acta Sesión 2):
 * las piezas NO se rotan — el ancho de la pieza siempre corre paralelo al
 * ancho del rollo. Si se confirma que sí se pueden rotar, `allowRotation`
 * habilita esa rama sin tocar el resto del motor.
 *
 * Estrategia — "skyline" (perfil de alturas), igual a como Diego arma el
 * "Plano de corte" a mano: cada corte ya hecho "levanta" el perfil del rollo
 * en el tramo de ancho (X) que ocupa, hasta la altura (Y) donde termina. El
 * hueco libre para una pieza nueva es, en cualquier tramo de ancho, todo lo
 * que queda por encima de ese perfil.
 *
 * Esto reemplaza una versión anterior que solo reconocía "franjas" agrupando
 * cortes por su Y exacto y asumía que dentro de una franja las piezas se
 * acomodan siempre contiguas desde X=0 — válido únicamente para cortes hechos
 * por el propio motor, pero no para el historial real (importado de "Planos
 * Rollos.xlsx"), donde Diego corta en cualquier X/Y libre, dejando huecos que
 * esa versión no era capaz de reconocer como disponibles (reportaba "sin
 * material" con el rollo lleno de huecos aprovechables). El perfil de alturas
 * (skyline) sí reconstruye correctamente el espacio libre real sin importar
 * el orden o la forma en que se hayan hecho los cortes.
 *
 * Prioridad de búsqueda (igual a como ya trabaja Diego: "primero validar
 * existencia de tramo"):
 *   1. Retales disponibles que alcancen la medida (best-fit: el que deja
 *      menor desperdicio).
 *   2. Si no hay retal, un rollo activo de la misma línea/referencia con
 *      espacio libre suficiente en su perfil de alturas — se prefiere la
 *      posición más baja (menos avance de Y) y, entre varias a la misma
 *      altura, la que deje menos ancho sobrante.
 */

export type PiezaRequerida = {
  linea: string;
  referencia: string;
  anchoMm: number;
  largoMm: number;
};

export type RetalDisponible = {
  id: number;
  loteOrigen: string;
  linea: string;
  referencia: string;
  anchoMm: number;
  largoMm: number;
};

export type RolloActivo = {
  id: number;
  lote: string;
  linea: string;
  referencia: string;
  anchoMm: number;
  largoMm: number;
  largoUsadoMm: number;
};

/**
 * Un tramo del perfil de alturas (skyline) del rollo: en el rango de ancho
 * [xIni, xFin) ya hay material cortado (o reservado) hasta la altura yTope;
 * por encima de yTope, ese tramo de ancho está libre.
 */
export type SegmentoSkyline = {
  xIni: number;
  xFin: number;
  yTope: number;
};

const EPS = 1e-6;

/**
 * Reconstruye el perfil de alturas (skyline) de un rollo a partir de TODOS
 * sus cortes ya registrados (vendidos, retal útil o eliminados — cualquiera
 * que físicamente ya haya consumido ese espacio). No asume ningún orden ni
 * alineación entre cortes: funciona igual con datos históricos importados
 * (2D libre) que con cortes hechos por este motor (franjas prolijas).
 */
export function construirSkyline(
  cortesDelRollo: { xInicial: number; yInicial: number; anchoMm: number; largoMm: number }[],
  anchoRollo: number
): SegmentoSkyline[] {
  if (anchoRollo <= 0) return [];
  if (cortesDelRollo.length === 0) return [{ xIni: 0, xFin: anchoRollo, yTope: 0 }];

  const bordes = new Set<number>([0, anchoRollo]);
  for (const c of cortesDelRollo) {
    const xIni = Math.max(0, Math.min(anchoRollo, c.xInicial));
    const xFin = Math.max(0, Math.min(anchoRollo, c.xInicial + c.anchoMm));
    bordes.add(xIni);
    bordes.add(xFin);
  }
  const puntos = [...bordes].sort((a, b) => a - b);

  const segmentos: SegmentoSkyline[] = [];
  for (let i = 0; i < puntos.length - 1; i++) {
    const xIni = puntos[i];
    const xFin = puntos[i + 1];
    if (xFin - xIni <= EPS) continue;
    const xMedio = (xIni + xFin) / 2;
    let yTope = 0;
    for (const c of cortesDelRollo) {
      if (c.xInicial - EPS <= xMedio && xMedio <= c.xInicial + c.anchoMm + EPS) {
        yTope = Math.max(yTope, c.yInicial + c.largoMm);
      }
    }
    segmentos.push({ xIni, xFin, yTope });
  }
  return segmentos;
}

/** Altura máxima ya ocupada dentro de un rango de ancho [xIni, xFin). */
export function alturaEnRango(skyline: SegmentoSkyline[], xIni: number, xFin: number): number {
  let maxY = 0;
  for (const s of skyline) {
    if (s.xFin > xIni + EPS && s.xIni < xFin - EPS) {
      maxY = Math.max(maxY, s.yTope);
    }
  }
  return maxY;
}

/**
 * Ancho del tramo libre contiguo que empieza en `xIni` a la altura `yTope`
 * (hasta dónde se puede correr hacia la derecha sin toparse con un tramo más
 * alto) — se usa para calcular cuánto sobrante lateral queda tras un corte.
 */
export function anchoLibreContiguo(skyline: SegmentoSkyline[], xIni: number, yTope: number, anchoRollo: number): number {
  let xFinLibre = xIni;
  for (const s of [...skyline].sort((a, b) => a.xIni - b.xIni)) {
    if (s.xFin <= xFinLibre + EPS) continue;
    if (s.xIni > xFinLibre + EPS) break; // hueco no contiguo
    if (s.yTope > yTope + EPS) break; // tramo más alto: no se puede seguir de largo
    xFinLibre = s.xFin;
  }
  return Math.min(xFinLibre, anchoRollo) - xIni;
}

/**
 * Ubica una pieza dentro de un rollo usando su perfil de alturas (skyline).
 * Busca, entre todos los tramos de ancho posibles, la posición X donde la
 * pieza cabe a la menor altura Y (menos avance de rollo = menos desperdicio),
 * y entre varias a la misma altura, la que deja menos ancho sobrante.
 */
export function ubicarEnRollo(
  pieza: PiezaRequerida,
  rollo: RolloActivo,
  skyline: SegmentoSkyline[]
): { xInicial: number; yInicial: number; abreFranjaNueva: boolean; anchoLibreEnPosicion: number } | null {
  if (pieza.anchoMm > rollo.anchoMm + EPS) return null;

  const candidatosX = [...new Set(skyline.map((s) => s.xIni))].sort((a, b) => a - b);

  let mejor: { xInicial: number; yInicial: number; anchoLibreEnPosicion: number } | null = null;
  for (const xInicial of candidatosX) {
    if (xInicial + pieza.anchoMm > rollo.anchoMm + EPS) continue;
    const yInicial = alturaEnRango(skyline, xInicial, xInicial + pieza.anchoMm);
    if (yInicial + pieza.largoMm > rollo.largoMm + EPS) continue;

    const anchoLibreEnPosicion = anchoLibreContiguo(skyline, xInicial, yInicial, rollo.anchoMm);

    if (
      !mejor ||
      yInicial < mejor.yInicial - EPS ||
      (Math.abs(yInicial - mejor.yInicial) <= EPS && anchoLibreEnPosicion < mejor.anchoLibreEnPosicion)
    ) {
      mejor = { xInicial, yInicial, anchoLibreEnPosicion };
    }
  }

  if (!mejor) return null;
  return {
    xInicial: mejor.xInicial,
    yInicial: mejor.yInicial,
    abreFranjaNueva: mejor.yInicial >= rollo.largoUsadoMm - EPS,
    anchoLibreEnPosicion: mejor.anchoLibreEnPosicion,
  };
}

/** Elige, entre los retales candidatos, el de menor desperdicio (best-fit). */
export function elegirMejorRetal(
  pieza: PiezaRequerida,
  retales: RetalDisponible[]
): RetalDisponible | null {
  const candidatos = retales.filter(
    (r) =>
      r.linea === pieza.linea &&
      r.referencia === pieza.referencia &&
      r.anchoMm + EPS >= pieza.anchoMm &&
      r.largoMm + EPS >= pieza.largoMm
  );
  if (candidatos.length === 0) return null;

  candidatos.sort((a, b) => {
    const desperdicioA = a.anchoMm * a.largoMm - pieza.anchoMm * pieza.largoMm;
    const desperdicioB = b.anchoMm * b.largoMm - pieza.anchoMm * pieza.largoMm;
    return desperdicioA - desperdicioB;
  });
  return candidatos[0];
}

/** Una opción de corte candidata, para mostrar al usuario junto a las demás. */
export type CandidatoCorte =
  | {
      tipo: "retal";
      retalId: number;
      loteOrigen: string;
      linea: string;
      referencia: string;
      anchoDisponible: number;
      largoDisponible: number;
      xSugerido: 0;
      ySugerido: 0;
      desperdicioMm2: number;
      sugerido: boolean;
    }
  | {
      tipo: "rollo";
      rolloId: number;
      lote: string;
      linea: string;
      referencia: string;
      anchoRollo: number;
      largoDisponible: number;
      xSugerido: number;
      ySugerido: number;
      abreFranjaNueva: boolean;
      desperdicioMm2: number;
      sugerido: boolean;
    };

/**
 * Lista TODAS las opciones donde cabría la pieza (retales primero, luego
 * rollos), cada una con su propia posición sugerida — para que el usuario
 * elija la pieza, no solo confirme la que el motor prefiere. La primera
 * opción de la lista es la de menor desperdicio (`sugerido: true`).
 */
export function listarCandidatos(
  pieza: PiezaRequerida,
  retalesDisponibles: RetalDisponible[],
  rollosActivos: RolloActivo[],
  cortesPorRollo: Map<string, { xInicial: number; yInicial: number; anchoMm: number; largoMm: number }[]>
): CandidatoCorte[] {
  const candidatosRetal: CandidatoCorte[] = retalesDisponibles
    .filter(
      (r) =>
        r.linea === pieza.linea &&
        r.referencia === pieza.referencia &&
        r.anchoMm + EPS >= pieza.anchoMm &&
        r.largoMm + EPS >= pieza.largoMm
    )
    .map((r) => ({
      tipo: "retal" as const,
      retalId: r.id,
      loteOrigen: r.loteOrigen,
      linea: r.linea,
      referencia: r.referencia,
      anchoDisponible: r.anchoMm,
      largoDisponible: r.largoMm,
      xSugerido: 0 as const,
      ySugerido: 0 as const,
      desperdicioMm2: r.anchoMm * r.largoMm - pieza.anchoMm * pieza.largoMm,
      sugerido: false,
    }))
    .sort((a, b) => a.desperdicioMm2 - b.desperdicioMm2);

  const candidatosRollo: CandidatoCorte[] = [];
  const rollosAptos = rollosActivos.filter(
    (r) => r.linea === pieza.linea && r.referencia === pieza.referencia && r.anchoMm + EPS >= pieza.anchoMm
  );

  for (const rollo of rollosAptos) {
    const skyline = construirSkyline(cortesPorRollo.get(rollo.lote) ?? [], rollo.anchoMm);
    const ubicacion = ubicarEnRollo(pieza, rollo, skyline);
    if (ubicacion) {
      const largoDisponible = rollo.largoMm - ubicacion.yInicial;
      candidatosRollo.push({
        tipo: "rollo",
        rolloId: rollo.id,
        lote: rollo.lote,
        linea: rollo.linea,
        referencia: rollo.referencia,
        anchoRollo: rollo.anchoMm,
        largoDisponible,
        xSugerido: ubicacion.xInicial,
        ySugerido: ubicacion.yInicial,
        abreFranjaNueva: ubicacion.abreFranjaNueva,
        desperdicioMm2: ubicacion.anchoLibreEnPosicion * largoDisponible - pieza.anchoMm * pieza.largoMm,
        sugerido: false,
      });
    }
  }
  candidatosRollo.sort((a, b) => a.desperdicioMm2 - b.desperdicioMm2);

  // Retales primero (aprovechar sobrantes antes que abrir/avanzar un rollo),
  // y dentro de cada grupo, menor desperdicio primero.
  const todos = [...candidatosRetal, ...candidatosRollo];
  if (todos.length > 0) todos[0] = { ...todos[0], sugerido: true };
  return todos;
}

/**
 * Punto de entrada: dada una pieza requerida y el inventario disponible,
 * devuelve dónde cortarla. Prioriza retales sobre rollos nuevos.
 *
 * @deprecated preferir `listarCandidatos` para dejar elegir al usuario;
 * se conserva por si algún llamador solo necesita la mejor sugerencia.
 */
export function sugerirCorte(
  pieza: PiezaRequerida,
  retalesDisponibles: RetalDisponible[],
  rollosActivos: RolloActivo[],
  cortesPorRollo: Map<string, { xInicial: number; yInicial: number; anchoMm: number; largoMm: number }[]>
):
  | {
      tipo: "retal";
      retalId: number;
      loteOrigen: string;
      xInicial: 0;
      yInicial: 0;
      anchoMm: number;
      largoMm: number;
      sobranteAnchoMm: number;
      sobranteLargoMm: number;
    }
  | {
      tipo: "rollo";
      rolloId: number;
      lote: string;
      xInicial: number;
      yInicial: number;
      anchoMm: number;
      largoMm: number;
      abreFranjaNueva: boolean;
    }
  | { tipo: "sin_material" } {
  const retal = elegirMejorRetal(pieza, retalesDisponibles);
  if (retal) {
    return {
      tipo: "retal",
      retalId: retal.id,
      loteOrigen: retal.loteOrigen,
      xInicial: 0,
      yInicial: 0,
      anchoMm: pieza.anchoMm,
      largoMm: pieza.largoMm,
      sobranteAnchoMm: retal.anchoMm - pieza.anchoMm,
      sobranteLargoMm: retal.largoMm - pieza.largoMm,
    };
  }

  const rollosAptos = rollosActivos.filter(
    (r) => r.linea === pieza.linea && r.referencia === pieza.referencia && r.anchoMm + EPS >= pieza.anchoMm
  );

  for (const rollo of rollosAptos) {
    const skyline = construirSkyline(cortesPorRollo.get(rollo.lote) ?? [], rollo.anchoMm);
    const ubicacion = ubicarEnRollo(pieza, rollo, skyline);
    if (ubicacion) {
      return {
        tipo: "rollo",
        rolloId: rollo.id,
        lote: rollo.lote,
        xInicial: ubicacion.xInicial,
        yInicial: ubicacion.yInicial,
        anchoMm: pieza.anchoMm,
        largoMm: pieza.largoMm,
        abreFranjaNueva: ubicacion.abreFranjaNueva,
      };
    }
  }

  return { tipo: "sin_material" };
}
