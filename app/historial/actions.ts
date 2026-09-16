"use server";

import { db } from "@/lib/db";
import { cortes, retales, rollos } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSesion } from "@/lib/auth";
import { construirSkyline, alturaEnRango, anchoLibreContiguo } from "@/lib/cutting-engine";
import type { EstadoHistorico } from "@/app/pedidos/nuevo/actions";

type Resultado = { ok: true } | { ok: false; error: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const MIN_UTIL_MM = 50; // mismo umbral que confirmarCorte (app/pedidos/nuevo/actions.ts)

/** Error "normal" de validación (se muestra al usuario) — se lanza dentro de la transacción para forzar rollback y se atrapa afuera como { ok:false, error }. */
class ErrorValidacion extends Error {}

function revalidarTodo() {
  revalidatePath("/historial");
  revalidatePath("/rollos");
  revalidatePath("/retales");
  revalidatePath("/pedidos/nuevo");
}

/**
 * Deshace en la base de datos todo lo que `confirmarCorte` generó junto con
 * este corte: el corte mismo, el retal/corte de sobrante lateral que se
 * haya creado automáticamente a su lado, y — si venía de un retal — vuelve
 * a poner ese retal como disponible. Si venía de un rollo, recalcula
 * `largoUsadoMm` a partir de lo que quede, para dejar el área realmente
 * libre otra vez (no solo restar, porque `largoUsadoMm` es una frontera
 * máxima que pudieron haber avanzado otros cortes posteriores).
 *
 * Usada tanto por `eliminarCorte` como por `editarCorte` (que revierte y
 * vuelve a confirmar con los valores nuevos, todo en una sola transacción,
 * para que un valor nuevo inválido no deje el corte viejo a medio borrar).
 *
 * Lanza ErrorValidacion (sin escribir nada) si el corte no existe, si es en
 * sí mismo el sobrante automático de otro corte (hay que editar/eliminar el
 * corte principal, no su sobrante), o si algún sobrante que generó ya fue
 * consumido por otro pedido.
 */
async function revertirCorte(tx: Tx, corteId: number) {
  const [corte] = await tx.select().from(cortes).where(eq(cortes.id, corteId)).limit(1);
  if (!corte) {
    throw new ErrorValidacion("Ese corte ya no existe (puede que alguien más lo haya editado o eliminado).");
  }
  if (corte.generadoPorCorteId != null) {
    throw new ErrorValidacion(
      "Este registro es el sobrante automático de otro corte — edita o elimina el corte principal, no este."
    );
  }

  const sobrantesRetal = await tx.select().from(retales).where(eq(retales.origenCorteId, corteId));
  for (const r of sobrantesRetal) {
    if (!r.disponible) {
      throw new ErrorValidacion(
        `No se puede editar/eliminar: el sobrante de ${r.anchoMm}x${r.largoMm}mm que dejó este corte ya fue usado en otro pedido.`
      );
    }
  }
  for (const r of sobrantesRetal) {
    await tx.delete(retales).where(eq(retales.id, r.id));
  }
  await tx.delete(cortes).where(eq(cortes.generadoPorCorteId, corteId));

  if (corte.origenTipo === "retal" && corte.origenRetalId != null) {
    await tx.update(retales).set({ disponible: true }).where(eq(retales.id, corte.origenRetalId));
  }

  await tx.delete(cortes).where(eq(cortes.id, corteId));

  if (corte.origenTipo === "rollo") {
    const restantes = await tx.select().from(cortes).where(eq(cortes.lote, corte.lote));
    const nuevaFrontera = restantes.reduce((max, c) => Math.max(max, c.yInicial + c.largoMm), 0);
    const [rollo] = await tx.select().from(rollos).where(eq(rollos.lote, corte.lote)).limit(1);
    if (rollo) {
      const agotado = nuevaFrontera >= rollo.largoMm - 1e-6;
      // Solo se toca el estado si el corte revertido lo había dejado AGOTADO
      // (para no reabrir por accidente un rollo que se marcó COMPLETO a mano
      // por otra razón) o si al revertir vuelve a quedar realmente lleno.
      const nuevoEstado = agotado ? "AGOTADO" : rollo.estado === "AGOTADO" ? "INICIADO" : rollo.estado;
      await tx.update(rollos).set({ largoUsadoMm: nuevaFrontera, estado: nuevoEstado }).where(eq(rollos.id, rollo.id));
    }
  }

  return corte;
}

export async function eliminarCorte(corteId: number): Promise<Resultado> {
  await requireSesion();
  try {
    await db.transaction(async (tx) => {
      await revertirCorte(tx, corteId);
    });
  } catch (e) {
    if (e instanceof ErrorValidacion) return { ok: false, error: e.message };
    throw e;
  }
  revalidarTodo();
  return { ok: true };
}

export async function editarCorte(input: {
  corteId: number;
  anchoMm: number;
  largoMm: number;
  xInicial: number;
  yInicial: number;
  cliente: string;
  pedidoTaller: string;
  operario: string;
  estado: EstadoHistorico;
  nota?: string;
}): Promise<Resultado> {
  await requireSesion();
  const { corteId, anchoMm, largoMm, xInicial, yInicial, operario, estado, nota } = input;
  const cliente = input.cliente.trim() || null;
  const pedidoTaller = input.pedidoTaller.trim() || null;

  if (!(anchoMm > 0) || !(largoMm > 0)) {
    return { ok: false, error: "Ancho y largo deben ser mayores a cero." };
  }
  if (!operario) return { ok: false, error: "Selecciona el operario." };

  try {
    await db.transaction(async (tx) => {
      const original = await revertirCorte(tx, corteId);

      if (original.origenTipo === "retal") {
        if (original.origenRetalId == null) {
          throw new ErrorValidacion("Este corte no tiene retal de origen registrado — no se puede editar así.");
        }
        const [retal] = await tx.select().from(retales).where(eq(retales.id, original.origenRetalId)).limit(1);
        if (!retal || !retal.disponible) {
          throw new ErrorValidacion("El retal de origen de este corte ya no está disponible.");
        }
        if (anchoMm > retal.anchoMm || largoMm > retal.largoMm) {
          throw new ErrorValidacion(`El corte no cabe en el retal (disponible: ${retal.anchoMm} x ${retal.largoMm} mm).`);
        }

        const [{ id: nuevoId }] = await tx
          .insert(cortes)
          .values({
            lote: retal.loteOrigen,
            pedidoTaller,
            cliente,
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

        await tx.update(retales).set({ disponible: false }).where(eq(retales.id, retal.id));

        const sobranteAncho = retal.anchoMm - anchoMm;
        const sobranteLargo = retal.largoMm - largoMm;
        if (sobranteAncho >= MIN_UTIL_MM) {
          await tx.insert(retales).values({
            loteOrigen: retal.loteOrigen,
            linea: retal.linea,
            referencia: retal.referencia,
            anchoMm: sobranteAncho,
            largoMm,
            disponible: true,
            origenCorteId: nuevoId,
          });
        }
        if (sobranteLargo >= MIN_UTIL_MM) {
          await tx.insert(retales).values({
            loteOrigen: retal.loteOrigen,
            linea: retal.linea,
            referencia: retal.referencia,
            anchoMm,
            largoMm: sobranteLargo,
            disponible: true,
            origenCorteId: nuevoId,
          });
        }
        return;
      }

      // origenTipo === "rollo"
      const [rollo] = await tx.select().from(rollos).where(eq(rollos.lote, original.lote)).limit(1);
      if (!rollo) throw new ErrorValidacion("Ese rollo ya no existe.");

      if (xInicial < -1e-6 || xInicial + anchoMm > rollo.anchoMm + 1e-6) {
        throw new ErrorValidacion(
          `El ancho pedido (${anchoMm} mm) no alcanza en X=${xInicial} — el rollo mide ${rollo.anchoMm} mm de ancho, así que ahí solo caben ${Math.max(rollo.anchoMm - xInicial, 0)} mm.`
        );
      }
      if (yInicial + largoMm > rollo.largoMm + 1e-6) {
        throw new ErrorValidacion(
          `El largo pedido (${largoMm} mm) no alcanza desde Y=${yInicial} — el rollo solo mide ${rollo.largoMm} mm de largo.`
        );
      }

      const cortesExistentes = await tx.select().from(cortes).where(eq(cortes.lote, rollo.lote));
      const skylinePrevio = construirSkyline(cortesExistentes, rollo.anchoMm);
      const alturaEnEsePunto = alturaEnRango(skylinePrevio, xInicial, xInicial + anchoMm);
      if (alturaEnEsePunto > yInicial + 1e-6) {
        const anchoLibreAqui = anchoLibreContiguo(skylinePrevio, xInicial, yInicial, rollo.anchoMm);
        throw new ErrorValidacion(
          anchoLibreAqui + 1e-6 < anchoMm
            ? `El ancho pedido (${anchoMm} mm) no alcanza en X=${xInicial} — ahí solo hay ${anchoLibreAqui} mm libres antes de material ya cortado (que llega hasta Y=${alturaEnEsePunto} mm). Ajusta el ancho, la posición X, o revisa si hay otra franja libre.`
            : `Esa posición ya tiene material cortado hasta Y=${alturaEnEsePunto} mm — ajusta las coordenadas.`
        );
      }

      const [{ id: nuevoId }] = await tx
        .insert(cortes)
        .values({
          lote: rollo.lote,
          pedidoTaller,
          cliente,
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

      const anchoLibreEnPosicion = anchoLibreContiguo(skylinePrevio, xInicial, yInicial, rollo.anchoMm);
      const sobranteAncho = anchoLibreEnPosicion - anchoMm;
      if (sobranteAncho >= MIN_UTIL_MM) {
        await tx.insert(retales).values({
          loteOrigen: rollo.lote,
          linea: rollo.linea,
          referencia: rollo.referencia,
          anchoMm: sobranteAncho,
          largoMm,
          disponible: true,
          origenCorteId: nuevoId,
        });
        await tx.insert(cortes).values({
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
          generadoPorCorteId: nuevoId,
        });
      }

      const nuevaFrontera = yInicial + largoMm;
      await tx
        .update(rollos)
        .set({
          largoUsadoMm: Math.max(rollo.largoUsadoMm, nuevaFrontera),
          estado: nuevaFrontera >= rollo.largoMm - 1e-6 ? "AGOTADO" : rollo.estado === "AGOTADO" ? "INICIADO" : rollo.estado,
        })
        .where(eq(rollos.id, rollo.id));
    });
  } catch (e) {
    if (e instanceof ErrorValidacion) return { ok: false, error: e.message };
    throw e;
  }
  revalidarTodo();
  return { ok: true };
}
