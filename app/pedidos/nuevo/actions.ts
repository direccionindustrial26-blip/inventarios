"use server";

import { db } from "@/lib/db";
import { rollos, retales, cortes } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  getRollosActivosPorReferencia,
  getRetalesPorReferencia,
  getCortesPorLote,
  getRolloPorLote,
} from "@/lib/db/queries";
import { listarCandidatos, construirSkyline, alturaEnRango, anchoLibreContiguo, type CandidatoCorte, type PiezaRequerida } from "@/lib/cutting-engine";
import { requireSesion } from "@/lib/auth";

/** Datos para dibujar el plano de corte de un rollo — ver components/plano-de-corte.tsx. */
export type PlanoRollo = {
  anchoMm: number;
  largoMm: number;
  largoUsadoMm: number;
  cortes: {
    id: number;
    xInicial: number;
    yInicial: number;
    anchoMm: number;
    largoMm: number;
    estado: string;
    pedidoTaller: string | null;
    cliente: string | null;
  }[];
};

export type ResultadoBusqueda =
  | { ok: true; candidatos: CandidatoCorte[]; pieza: PiezaRequerida; planos: Record<string, PlanoRollo> }
  | { ok: false; error: string };

/** Arma el plano de corte de un rollo tal como está guardado ahora mismo en la base de datos. */
async function construirPlanoRollo(lote: string): Promise<PlanoRollo | null> {
  const rollo = await getRolloPorLote(lote);
  if (!rollo) return null;
  const cs = await getCortesPorLote(lote);
  return {
    anchoMm: rollo.anchoMm,
    largoMm: rollo.largoMm,
    largoUsadoMm: rollo.largoUsadoMm,
    cortes: cs.map((c) => ({
      id: c.id,
      xInicial: c.xInicial,
      yInicial: c.yInicial,
      anchoMm: c.anchoMm,
      largoMm: c.largoMm,
      estado: c.estado,
      pedidoTaller: c.pedidoTaller,
      cliente: c.cliente,
    })),
  };
}

/** Busca TODAS las opciones disponibles (retales y rollos) para una pieza — no solo la mejor. */
export async function buscarDisponibilidad(input: {
  linea: string;
  referencia: string;
  anchoMm: number;
  largoMm: number;
}): Promise<ResultadoBusqueda> {
  await requireSesion();
  const { linea, referencia, anchoMm, largoMm } = input;
  if (!linea || !referencia) return { ok: false, error: "Selecciona línea y referencia." };
  if (!(anchoMm > 0) || !(largoMm > 0)) {
    return { ok: false, error: "Ancho y largo deben ser mayores a cero." };
  }

  const pieza: PiezaRequerida = { linea, referencia, anchoMm, largoMm };

  const [rollosActivos, retalesDisponibles] = await Promise.all([
    getRollosActivosPorReferencia(linea, referencia),
    getRetalesPorReferencia(linea, referencia),
  ]);

  // Plano de corte de cada rollo involucrado — tanto los rollos activos
  // (candidatos directos) como el rollo de origen de cada retal candidato,
  // para poder mostrar gráficamente "el rollo con los cortes que ya tiene"
  // sin importar si el usuario terminó parado sobre un rollo o un retal.
  const planos: Record<string, PlanoRollo> = {};
  const cortesPorRollo = new Map<
    string,
    { xInicial: number; yInicial: number; anchoMm: number; largoMm: number }[]
  >();

  async function cargarPlano(lote: string) {
    if (planos[lote]) return;
    const plano = await construirPlanoRollo(lote);
    if (!plano) return;
    planos[lote] = plano;
    cortesPorRollo.set(
      lote,
      plano.cortes.map((c) => ({ xInicial: c.xInicial, yInicial: c.yInicial, anchoMm: c.anchoMm, largoMm: c.largoMm }))
    );
  }

  for (const r of rollosActivos) {
    await cargarPlano(r.lote);
  }
  const lotesOrigenRetal = [...new Set(retalesDisponibles.map((r) => r.loteOrigen))];
  for (const lote of lotesOrigenRetal) {
    await cargarPlano(lote);
  }

  const candidatos = listarCandidatos(pieza, retalesDisponibles, rollosActivos, cortesPorRollo);
  if (candidatos.length === 0) {
    return { ok: false, error: "No hay rollo ni retal disponible con ancho/largo suficiente para esta pieza." };
  }
  return { ok: true, candidatos, pieza, planos };
}

export type EstadoHistorico = "VENDIDO" | "RETAL_UTIL" | "ELIMINADO";

const MIN_UTIL_MM = 50; // por debajo de esto, el sobrante se considera desperdicio, no un retal nuevo

/**
 * Confirma el corte sobre la pieza elegida por el usuario (puede no ser la
 * `sugerida`), con ancho/largo/X/Y que el usuario puede haber editado desde
 * lo que el motor propuso.
 */
export async function confirmarCorte(input: {
  candidato: CandidatoCorte;
  linea: string;
  referencia: string;
  anchoMm: number;
  largoMm: number;
  xInicial: number;
  yInicial: number;
  clienteNombre: string;
  clienteLetra: string;
  numeroPedido: string;
  operario: string;
  estado: EstadoHistorico;
  nota?: string;
}): Promise<
  | { ok: true; lote: string; pedidoCodigo: string; corteId: number; plano: PlanoRollo }
  | { ok: false; error: string }
> {
  await requireSesion();
  const { candidato, anchoMm, largoMm, xInicial, yInicial, operario, estado, nota } = input;

  if (!/^\d+$/.test(input.numeroPedido.trim())) {
    return { ok: false, error: "El número de pedido debe contener únicamente dígitos." };
  }
  if (!(anchoMm > 0) || !(largoMm > 0)) {
    return { ok: false, error: "Ancho y largo a cortar deben ser mayores a cero." };
  }
  if (!operario) return { ok: false, error: "Selecciona el operario." };

  const pedidoCodigo = `${input.clienteLetra}-${input.numeroPedido.trim()}`;

  if (candidato.tipo === "retal") {
    const [retal] = await db.select().from(retales).where(eq(retales.id, candidato.retalId)).limit(1);
    if (!retal || !retal.disponible) {
      return { ok: false, error: "Ese retal ya no está disponible (puede que otro pedido lo haya usado)." };
    }
    if (anchoMm > retal.anchoMm || largoMm > retal.largoMm) {
      return { ok: false, error: `El corte no cabe en el retal (disponible: ${retal.anchoMm} x ${retal.largoMm} mm).` };
    }

    const [{ id: corteId }] = await db
      .insert(cortes)
      .values({
        lote: retal.loteOrigen,
        pedidoTaller: pedidoCodigo,
        cliente: input.clienteNombre,
        anchoMm,
        largoMm,
        areaMm2: anchoMm * largoMm,
        estado,
        operario,
        xInicial,
        yInicial,
        origenTipo: "retal",
        origenRetalId: retal.id,
        nota: nota?.trim() || null,
        linea: retal.linea,
        referencia: retal.referencia,
      })
      .returning({ id: cortes.id });

    await db.update(retales).set({ disponible: false }).where(eq(retales.id, retal.id));

    // Guillotina simple: hasta 2 sobrantes nuevos (lateral de ancho, y de largo).
    const sobranteAncho = retal.anchoMm - anchoMm;
    const sobranteLargo = retal.largoMm - largoMm;
    if (sobranteAncho >= MIN_UTIL_MM) {
      await db.insert(retales).values({
        loteOrigen: retal.loteOrigen,
        linea: retal.linea,
        referencia: retal.referencia,
        anchoMm: sobranteAncho,
        largoMm,
        disponible: true,
        origenCorteId: corteId,
      });
    }
    if (sobranteLargo >= MIN_UTIL_MM) {
      await db.insert(retales).values({
        loteOrigen: retal.loteOrigen,
        linea: retal.linea,
        referencia: retal.referencia,
        anchoMm,
        largoMm: sobranteLargo,
        disponible: true,
        origenCorteId: corteId,
      });
    }

    const plano = await construirPlanoRollo(retal.loteOrigen);
    return { ok: true, lote: retal.loteOrigen, pedidoCodigo, corteId, plano: plano! };
  }

  // tipo === "rollo"
  const [rollo] = await db.select().from(rollos).where(eq(rollos.id, candidato.rolloId)).limit(1);
  if (!rollo) return { ok: false, error: "Ese rollo ya no existe." };

  if (xInicial < -1e-6 || xInicial + anchoMm > rollo.anchoMm + 1e-6) {
    return {
      ok: false,
      error: `El ancho pedido (${anchoMm} mm) no alcanza en X=${xInicial} — el rollo mide ${rollo.anchoMm} mm de ancho, así que ahí solo caben ${Math.max(rollo.anchoMm - xInicial, 0)} mm.`,
    };
  }
  if (yInicial + largoMm > rollo.largoMm + 1e-6) {
    return { ok: false, error: `El largo pedido (${largoMm} mm) no alcanza desde Y=${yInicial} — el rollo solo mide ${rollo.largoMm} mm de largo.` };
  }

  // El plano puede haber sido editado a mano (X/Y), así que se valida contra
  // el perfil real de alturas del rollo — no solo contra la sugerencia del
  // motor — para no permitir un corte que se solape con material ya usado.
  const cortesExistentes = await getCortesPorLote(rollo.lote);
  const skylinePrevio = construirSkyline(cortesExistentes, rollo.anchoMm);
  const alturaEnEsePunto = alturaEnRango(skylinePrevio, xInicial, xInicial + anchoMm);
  if (alturaEnEsePunto > yInicial + 1e-6) {
    const anchoLibreAqui = anchoLibreContiguo(skylinePrevio, xInicial, yInicial, rollo.anchoMm);
    return {
      ok: false,
      error:
        anchoLibreAqui + 1e-6 < anchoMm
          ? `El ancho pedido (${anchoMm} mm) no alcanza en X=${xInicial} — ahí solo hay ${anchoLibreAqui} mm libres antes de material ya cortado (que llega hasta Y=${alturaEnEsePunto} mm). Ajusta el ancho, la posición X, o revisa si hay otra franja libre.`
          : `Esa posición ya tiene material cortado hasta Y=${alturaEnEsePunto} mm — ajusta las coordenadas.`,
    };
  }

  const [{ id: corteId }] = await db
    .insert(cortes)
    .values({
      lote: rollo.lote,
      pedidoTaller: pedidoCodigo,
      cliente: input.clienteNombre,
      anchoMm,
      largoMm,
      areaMm2: anchoMm * largoMm,
      estado,
      operario,
      xInicial,
      yInicial,
      origenTipo: "rollo",
      nota: nota?.trim() || null,
      linea: rollo.linea,
      referencia: rollo.referencia,
    })
    .returning({ id: cortes.id });

  // Si el corte no usa todo el ancho libre disponible en esa posición, el
  // sobrante lateral se separa físicamente como retal aprovechable (igual
  // que con un retal usado como origen) — y se registra también como corte
  // (RETAL_UTIL) en el plano del rollo para que quede marcado como ya
  // consumido y no se vuelva a ofrecer como espacio libre del rollo.
  const anchoLibreEnPosicion = anchoLibreContiguo(skylinePrevio, xInicial, yInicial, rollo.anchoMm);
  const sobranteAncho = anchoLibreEnPosicion - anchoMm;
  if (sobranteAncho >= MIN_UTIL_MM) {
    await db.insert(retales).values({
      loteOrigen: rollo.lote,
      linea: rollo.linea,
      referencia: rollo.referencia,
      anchoMm: sobranteAncho,
      largoMm,
      disponible: true,
      origenCorteId: corteId,
    });
    await db.insert(cortes).values({
      lote: rollo.lote,
      pedidoTaller: null,
      cliente: null,
      anchoMm: sobranteAncho,
      largoMm,
      areaMm2: sobranteAncho * largoMm,
      estado: "RETAL_UTIL",
      operario,
      xInicial: xInicial + anchoMm,
      yInicial,
      origenTipo: "rollo",
      nota: "Retal generado automáticamente por el sobrante lateral de este corte.",
      linea: rollo.linea,
      referencia: rollo.referencia,
      generadoPorCorteId: corteId,
    });
  }

  const nuevaFrontera = yInicial + largoMm;
  await db
    .update(rollos)
    .set({
      largoUsadoMm: sql`GREATEST(${rollos.largoUsadoMm}, ${nuevaFrontera})`,
      estado: nuevaFrontera >= rollo.largoMm - 1e-6 ? "AGOTADO" : "INICIADO",
    })
    .where(eq(rollos.id, rollo.id));

  const plano = await construirPlanoRollo(rollo.lote);
  return { ok: true, lote: rollo.lote, pedidoCodigo, corteId, plano: plano! };
}
