export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getRolloPorLote, getCortesPorLote, getOperariosActivos } from "@/lib/db/queries";
import { PlanoDeCorte } from "@/components/plano-de-corte";
import { HistorialTabla } from "@/components/historial-tabla";
import { requireUsuario } from "@/lib/auth";

export default async function RolloDetallePage({
  params,
}: PageProps<"/rollos/[lote]">) {
  await requireUsuario("rollos");
  const { lote: loteParam } = await params;
  const lote = decodeURIComponent(loteParam);
  const rollo = await getRolloPorLote(lote);
  if (!rollo) notFound();

  const [cortesDelRollo, operarios] = await Promise.all([getCortesPorLote(lote), getOperariosActivos()]);
  const disponible = rollo.largoMm - rollo.largoUsadoMm;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{rollo.lote}</h1>
        <p className="text-sm text-neutral-600">
          {rollo.linea} · {rollo.referencia}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Ancho" value={`${rollo.anchoMm.toLocaleString("es-CO")} mm`} />
        <Stat label="Largo total" value={`${rollo.largoMm.toLocaleString("es-CO")} mm`} />
        <Stat label="Largo usado" value={`${rollo.largoUsadoMm.toLocaleString("es-CO")} mm`} />
        <Stat label="Disponible" value={`${disponible.toLocaleString("es-CO")} mm`} />
      </div>

      <div className="card p-4">
        <h2 className="mb-3 font-medium">Plano de corte</h2>
        <PlanoDeCorte
          anchoRollo={rollo.anchoMm}
          largoRollo={rollo.largoMm}
          largoUsado={rollo.largoUsadoMm}
          cortes={cortesDelRollo.map((c) => ({
            id: c.id,
            xInicial: c.xInicial,
            yInicial: c.yInicial,
            anchoMm: c.anchoMm,
            largoMm: c.largoMm,
            estado: c.estado,
            pedidoTaller: c.pedidoTaller,
            cliente: c.cliente,
          }))}
        />
      </div>

      <HistorialTabla cortes={cortesDelRollo} operarios={operarios.map((o) => o.nombre)} mostrarLote={false} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-lg font-semibold text-brand-900">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}
