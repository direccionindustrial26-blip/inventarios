/**
 * Prueba rápida del motor de corte contra datos reales de la base de datos
 * (no es un test framework formal — solo una verificación manual antes de
 * conectar la UI). Uso: npx tsx scripts/test-engine.ts
 */
import "./env";
import { db } from "../lib/db";
import { rollos, cortes, retales } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { sugerirCorte, construirSkyline } from "../lib/cutting-engine";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FALLÓ: " + msg);
  console.log("OK: " + msg);
}

async function main() {
  // Caso 1: pieza que cabe en un rollo activo real (2PURX20/CW - AZUL, ancho 2000).
  const rollosActivos = (await db.select().from(rollos)).map((r) => ({
    id: r.id,
    lote: r.lote,
    linea: r.linea,
    referencia: r.referencia,
    anchoMm: r.anchoMm,
    largoMm: r.largoMm,
    largoUsadoMm: r.largoUsadoMm,
  }));

  const todosCortes = await db.select().from(cortes);
  const cortesPorRollo = new Map<string, typeof todosCortes>();
  for (const c of todosCortes) {
    const arr = cortesPorRollo.get(c.lote) ?? [];
    arr.push(c);
    cortesPorRollo.set(c.lote, arr);
  }

  const rollo = rollosActivos.find((r) => r.referencia === "2PURX20/CW - AZUL" && r.lote.endsWith("R2"));
  assert(!!rollo, "existe el rollo 2PURX20 - R2 en la base de datos");

  const sugerencia = sugerirCorte(
    { linea: "PU", referencia: "2PURX20/CW - AZUL", anchoMm: 500, largoMm: 1000 },
    [],
    rollosActivos,
    cortesPorRollo as unknown as Map<string, { xInicial: number; yInicial: number; anchoMm: number; largoMm: number }[]>
  );
  console.log("Sugerencia caso 1:", sugerencia);
  assert(sugerencia.tipo === "rollo", "el motor sugiere cortar de un rollo cuando no hay retales");
  if (sugerencia.tipo === "rollo") {
    assert(sugerencia.anchoMm === 500 && sugerencia.largoMm === 1000, "respeta las medidas pedidas");
  }

  // Caso 2: pieza más ancha que cualquier rollo disponible de esa referencia -> sin_material
  const sugerencia2 = sugerirCorte(
    { linea: "PU", referencia: "2PURX20/CW - AZUL", anchoMm: 99999, largoMm: 10 },
    [],
    rollosActivos,
    cortesPorRollo as unknown as Map<string, { xInicial: number; yInicial: number; anchoMm: number; largoMm: number }[]>
  );
  assert(sugerencia2.tipo === "sin_material", "no ofrece un ancho imposible");

  // Caso 3: un retal disponible que cubre la pieza debe preferirse sobre abrir rollo.
  const sugerencia3 = sugerirCorte(
    { linea: "PU", referencia: "2PURX20/CW - AZUL", anchoMm: 100, largoMm: 100 },
    [{ id: 1, loteOrigen: "TEST-RETAL", linea: "PU", referencia: "2PURX20/CW - AZUL", anchoMm: 150, largoMm: 150 }],
    rollosActivos,
    cortesPorRollo as unknown as Map<string, { xInicial: number; yInicial: number; anchoMm: number; largoMm: number }[]>
  );
  assert(sugerencia3.tipo === "retal", "prioriza el retal disponible sobre abrir un rollo nuevo");

  // Caso 4: el perfil de alturas (skyline) no debe salirse del ancho del rollo.
  const cortesRollo = cortesPorRollo.get(rollo!.lote) ?? [];
  const skyline = construirSkyline(cortesRollo, rollo!.anchoMm);
  for (const s of skyline) {
    assert(s.xFin <= rollo!.anchoMm + 1e-6, `tramo [${s.xIni}, ${s.xFin}] no excede el ancho del rollo`);
    assert(s.xIni >= -1e-6, `tramo [${s.xIni}, ${s.xFin}] no empieza antes de X=0`);
  }

  // Caso 5: un rollo con historial real "en 2D" (huecos no contiguos, como
  // los importados de Planos Rollos.xlsx) debe seguir ofreciendo el espacio
  // libre real, no solo lo que queda después de la frontera Y más lejana.
  const cortesConHueco = [
    { xInicial: 0, yInicial: 0, anchoMm: 140, largoMm: 20000 },
    { xInicial: 300, yInicial: 0, anchoMm: 1700, largoMm: 2000 },
  ];
  const rolloConHueco = { id: 999, lote: "TEST-HUECO", linea: "PU", referencia: "TEST", anchoMm: 2000, largoMm: 20000, largoUsadoMm: 20000 };
  const sugerenciaHueco = sugerirCorte(
    { linea: "PU", referencia: "TEST", anchoMm: 100, largoMm: 500 },
    [],
    [rolloConHueco],
    new Map([["TEST-HUECO", cortesConHueco]])
  );
  assert(
    sugerenciaHueco.tipo === "rollo",
    "encuentra el hueco lateral (x:140-300) aunque la frontera Y global ya esté al tope"
  );

  console.log("\nTodas las pruebas pasaron.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
