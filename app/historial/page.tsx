export const dynamic = "force-dynamic";

import { getHistorialCortes, getOperariosActivos } from "@/lib/db/queries";
import { requireUsuario } from "@/lib/auth";
import { HistorialTabla } from "@/components/historial-tabla";

export default async function HistorialPage() {
  await requireUsuario("historial");
  const [data, operarios] = await Promise.all([getHistorialCortes(200), getOperariosActivos()]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Historial de cortes</h1>
        <p className="text-sm text-neutral-600">
          {data.length} registros más recientes — reemplaza la hoja Historico_Cortes. Si un corte quedó mal
          registrado, puedes editarlo o eliminarlo: el área que ocupaba vuelve a quedar disponible.
        </p>
      </div>

      <HistorialTabla cortes={data} operarios={operarios.map((o) => o.nombre)} />
    </div>
  );
}
