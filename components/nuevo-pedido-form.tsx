"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buscarDisponibilidad, confirmarCorte, type EstadoHistorico, type PlanoRollo } from "@/app/pedidos/nuevo/actions";
import { construirSkyline, anchoLibreContiguo, type CandidatoCorte, type PiezaRequerida } from "@/lib/cutting-engine";
import { PlanoDeCorte } from "@/components/plano-de-corte";

type LineaReferencia = { linea: string; referencia: string };
type Cliente = { id: number; nombre: string; letra: string };

export function NuevoPedidoForm({
  opciones,
  clientes,
  operarios,
}: {
  opciones: LineaReferencia[];
  clientes: Cliente[];
  operarios: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [linea, setLinea] = useState("");
  const [referencia, setReferencia] = useState("");
  const [ancho, setAncho] = useState("");
  const [largo, setLargo] = useState("");

  const [pieza, setPieza] = useState<PiezaRequerida | null>(null);
  const [candidatos, setCandidatos] = useState<CandidatoCorte[] | null>(null);
  const [seleccion, setSeleccion] = useState<CandidatoCorte | null>(null);
  const [planos, setPlanos] = useState<Record<string, PlanoRollo>>({});

  const [anchoFinal, setAnchoFinal] = useState("");
  const [largoFinal, setLargoFinal] = useState("");
  const [xFinal, setXFinal] = useState("");
  const [yFinal, setYFinal] = useState("");

  const [clienteId, setClienteId] = useState("");
  const [numeroPedido, setNumeroPedido] = useState("");
  const [operario, setOperario] = useState("");
  const [estado, setEstado] = useState<EstadoHistorico>("VENDIDO");
  const [nota, setNota] = useState("");

  const [confirmado, setConfirmado] = useState<{ lote: string; pedidoCodigo: string; corteId: number } | null>(null);

  const referenciasDeLinea = [...new Set(opciones.filter((o) => o.linea === linea).map((o) => o.referencia))];
  const clienteElegido = clientes.find((c) => String(c.id) === clienteId) ?? null;
  const codigoPreview = clienteElegido && numeroPedido ? `${clienteElegido.letra}-${numeroPedido}` : null;

  function idCandidato(c: CandidatoCorte) {
    return c.tipo === "retal" ? `retal-${c.retalId}` : `rollo-${c.rolloId}`;
  }

  /** El lote cuyo plano hay que dibujar para un candidato dado. */
  function loteDelPlano(c: CandidatoCorte) {
    return c.tipo === "retal" ? c.loteOrigen : c.lote;
  }

  function elegirCandidato(c: CandidatoCorte, piezaBase: PiezaRequerida) {
    setSeleccion(c);
    setAnchoFinal(String(piezaBase.anchoMm));
    setLargoFinal(String(piezaBase.largoMm));
    setXFinal(String(c.xSugerido));
    setYFinal(String(c.ySugerido));
  }

  function buscar() {
    setError(null);
    setCandidatos(null);
    setSeleccion(null);
    setConfirmado(null);
    startTransition(async () => {
      const res = await buscarDisponibilidad({
        linea,
        referencia,
        anchoMm: Number(ancho),
        largoMm: Number(largo),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPieza(res.pieza);
      setCandidatos(res.candidatos);
      setPlanos(res.planos);
      // Por defecto el sistema se para en el candidato sugerido (⭐), así que
      // de una vez se ve el plano de ese rollo con los cortes que ya tiene.
      elegirCandidato(res.candidatos[0], res.pieza);
    });
  }

  function confirmar() {
    if (!seleccion || !pieza || !clienteElegido) return;
    setError(null);
    startTransition(async () => {
      const res = await confirmarCorte({
        candidato: seleccion,
        linea: pieza.linea,
        referencia: pieza.referencia,
        anchoMm: Number(anchoFinal),
        largoMm: Number(largoFinal),
        xInicial: Number(xFinal),
        yInicial: Number(yFinal),
        clienteNombre: clienteElegido.nombre,
        clienteLetra: clienteElegido.letra,
        numeroPedido,
        operario,
        estado,
        nota,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Se actualiza el plano localmente con lo que acaba de quedar guardado
      // (incluye el corte nuevo) para mostrarlo de inmediato, sin depender
      // de que el usuario recargue o navegue a la sección Rollos.
      setPlanos((prev) => ({ ...prev, [res.lote]: res.plano }));
      setConfirmado({ lote: res.lote, pedidoCodigo: res.pedidoCodigo, corteId: res.corteId });
      router.refresh();
    });
  }

  const camposCompletos = !!clienteElegido && /^\d+$/.test(numeroPedido) && !!operario;

  // Disponibilidad real en la posición X/Y que quedó en los campos editables
  // ahora mismo — se recalcula con el mismo motor que usa el servidor
  // (lib/cutting-engine.ts), a partir del plano ya cargado, para avisar
  // ANTES de confirmar si el ancho/largo pedido no cabe ahí, en vez de que
  // el usuario solo se entere por el mensaje de error del servidor (o, peor,
  // reduzca el ancho a mano para que "pase" sin darse cuenta de que dejó
  // material sin usar).
  let disponibilidadAqui: { anchoLibre: number; largoLibre: number } | null = null;
  if (seleccion?.tipo === "rollo") {
    const plano = planos[loteDelPlano(seleccion)];
    const x = Number(xFinal);
    const y = Number(yFinal);
    if (plano && Number.isFinite(x) && Number.isFinite(y)) {
      const skyline = construirSkyline(plano.cortes, plano.anchoMm);
      disponibilidadAqui = {
        anchoLibre: anchoLibreContiguo(skyline, x, y, plano.anchoMm),
        largoLibre: Math.max(plano.largoMm - y, 0),
      };
    }
  }
  const anchoPedidoNoCabe =
    !!disponibilidadAqui && Number(anchoFinal) > 0 && Number(anchoFinal) > disponibilidadAqui.anchoLibre + 1e-6;
  const largoPedidoNoCabe =
    !!disponibilidadAqui && Number(largoFinal) > 0 && Number(largoFinal) > disponibilidadAqui.largoLibre + 1e-6;

  return (
    <div className="space-y-6">
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Línea">
          <select
            className="input"
            value={linea}
            onChange={(e) => {
              setLinea(e.target.value);
              setReferencia("");
            }}
          >
            <option value="">Selecciona...</option>
            {[...new Set(opciones.map((o) => o.linea))].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Referencia">
          <select
            className="input"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            disabled={!linea}
          >
            <option value="">Selecciona...</option>
            {referenciasDeLinea.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ancho solicitado (mm)">
          <input className="input" type="number" min={0} value={ancho} onChange={(e) => setAncho(e.target.value)} />
        </Field>
        <Field label="Largo solicitado (mm)">
          <input className="input" type="number" min={0} value={largo} onChange={(e) => setLargo(e.target.value)} />
        </Field>
        <div className="flex items-end sm:col-span-2">
          <button
            type="button"
            onClick={buscar}
            disabled={isPending || !linea || !referencia || !ancho || !largo}
            className="btn-primary w-full"
          >
            {isPending ? "Buscando..." : "🔍 Buscar disponibilidad (rollos y retales)"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {candidatos && pieza && !confirmado && (
        <div className="space-y-4">
          <div>
            <h2 className="font-medium">Opciones disponibles (⭐ = sugerida, menor desperdicio)</h2>
            <p className="text-sm text-neutral-600">
              Elige la pieza — puedes cambiar la sugerencia si prefieres otro rollo o retal.
            </p>
          </div>
          <div className="space-y-2">
            {candidatos.map((c) => (
              <CandidatoOption
                key={idCandidato(c)}
                candidato={c}
                seleccionado={seleccion ? idCandidato(seleccion) === idCandidato(c) : false}
                onElegir={() => elegirCandidato(c, pieza)}
              />
            ))}
          </div>

          {seleccion && (
            <div className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/60 p-5">
              <h3 className="font-medium text-brand-900">
                {seleccion.tipo === "retal" ? `Retal del lote ${seleccion.loteOrigen}` : `Rollo ${seleccion.lote}`}
              </h3>

              <div className="grid gap-6 lg:grid-cols-[480px_1fr]">
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-brand-700">
                    Plano de corte — cortes que ya tiene este rollo
                  </p>
                  {planos[loteDelPlano(seleccion)] ? (
                    <PlanoDeCorte
                      anchoRollo={planos[loteDelPlano(seleccion)].anchoMm}
                      largoRollo={planos[loteDelPlano(seleccion)].largoMm}
                      largoUsado={planos[loteDelPlano(seleccion)].largoUsadoMm}
                      cortes={planos[loteDelPlano(seleccion)].cortes}
                      piezaPropuesta={
                        seleccion.tipo === "rollo"
                          ? {
                              xInicial: Number(xFinal) || 0,
                              yInicial: Number(yFinal) || 0,
                              anchoMm: Number(anchoFinal) || 0,
                              largoMm: Number(largoFinal) || 0,
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <div className="card p-4 text-sm text-neutral-500">No hay plano disponible para este lote.</div>
                  )}
                  {seleccion.tipo === "retal" && (
                    <p className="mt-2 text-xs text-neutral-500">
                      Este retal salió del rollo {seleccion.loteOrigen} — se muestra el plano completo de ese
                      rollo como referencia. La posición exacta del retal dentro de él ya no se rastrea
                      individualmente.
                    </p>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-brand-700">
                      Coordenadas de corte (editable)
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Ancho a cortar (mm)">
                        <input className="input" type="number" value={anchoFinal} onChange={(e) => setAnchoFinal(e.target.value)} />
                      </Field>
                      <Field label="Largo a cortar (mm)">
                        <input className="input" type="number" value={largoFinal} onChange={(e) => setLargoFinal(e.target.value)} />
                      </Field>
                      <Field label="X inicial (mm)">
                        <input className="input" type="number" value={xFinal} onChange={(e) => setXFinal(e.target.value)} />
                      </Field>
                      <Field label="Y inicial (mm)">
                        <input className="input" type="number" value={yFinal} onChange={(e) => setYFinal(e.target.value)} />
                      </Field>
                    </div>
                    {disponibilidadAqui && (
                      <p className={`mt-2 text-xs ${anchoPedidoNoCabe || largoPedidoNoCabe ? "font-medium text-red-600" : "text-neutral-500"}`}>
                        Disponible libre en X={xFinal || 0}, Y={yFinal || 0}: {disponibilidadAqui.anchoLibre.toLocaleString("es-CO")} mm de
                        ancho x {disponibilidadAqui.largoLibre.toLocaleString("es-CO")} mm de largo.
                        {anchoPedidoNoCabe && " El ancho pedido no alcanza ahí."}
                        {largoPedidoNoCabe && " El largo pedido no alcanza ahí."}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Cliente">
                      <select className="input" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                        <option value="">Selecciona...</option>
                        {clientes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.letra} — {c.nombre}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Número de pedido (solo números)">
                      <input
                        className="input"
                        inputMode="numeric"
                        value={numeroPedido}
                        onChange={(e) => setNumeroPedido(e.target.value.replace(/\D/g, ""))}
                        placeholder="Ej: 1234"
                      />
                    </Field>
                    <Field label="Operario">
                      <select className="input" value={operario} onChange={(e) => setOperario(e.target.value)}>
                        <option value="">Selecciona...</option>
                        {operarios.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Estado resultante del corte">
                      <select className="input" value={estado} onChange={(e) => setEstado(e.target.value as EstadoHistorico)}>
                        <option value="VENDIDO">VENDIDO</option>
                        <option value="RETAL_UTIL">RETAL ÚTIL</option>
                        <option value="ELIMINADO">ELIMINADO</option>
                      </select>
                    </Field>
                  </div>

                  <Field label="Nota (opcional)">
                    <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} />
                  </Field>

                  {codigoPreview && (
                    <div className="text-sm text-brand-900">
                      Código de pedido: <strong>{codigoPreview}</strong>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={confirmar}
                    disabled={isPending || !camposCompletos}
                    className="btn-primary"
                    title={!camposCompletos ? "Completa cliente, número de pedido y operario" : undefined}
                  >
                    {isPending ? "Confirmando..." : "Confirmar corte"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {confirmado && (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
            Corte del pedido <strong>{confirmado.pedidoCodigo}</strong> registrado sobre el lote{" "}
            <strong>{confirmado.lote}</strong>. Ya quedó en el historial e inventario actualizado.
          </div>
          {planos[confirmado.lote] && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-brand-700">
                Plano de corte actualizado — el corte recién hecho aparece en verde
              </p>
              <PlanoDeCorte
                anchoRollo={planos[confirmado.lote].anchoMm}
                largoRollo={planos[confirmado.lote].largoMm}
                largoUsado={planos[confirmado.lote].largoUsadoMm}
                cortes={planos[confirmado.lote].cortes}
                corteNuevoId={confirmado.corteId}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CandidatoOption({
  candidato,
  seleccionado,
  onElegir,
}: {
  candidato: CandidatoCorte;
  seleccionado: boolean;
  onElegir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onElegir}
      className={`block w-full rounded-lg border p-4 text-left transition ${
        seleccionado ? "border-brand-400 bg-brand-50 ring-1 ring-brand-200" : "border-neutral-200 bg-white hover:border-brand-300"
      }`}
    >
      {candidato.tipo === "retal" ? (
        <>
          <div className="flex items-center justify-between font-medium text-neutral-900">
            <span>✂️ Retal del lote {candidato.loteOrigen}</span>
            {candidato.sugerido && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">⭐ Sugerido</span>}
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            Tamaño disponible: {candidato.anchoDisponible.toLocaleString("es-CO")} x{" "}
            {candidato.largoDisponible.toLocaleString("es-CO")} mm.
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between font-medium text-neutral-900">
            <span>🎞️ Rollo {candidato.lote}</span>
            {candidato.sugerido && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">⭐ Sugerido</span>}
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            Ancho rollo: {candidato.anchoRollo.toLocaleString("es-CO")} mm · Disponible a lo largo:{" "}
            {candidato.largoDisponible.toLocaleString("es-CO")} mm · Posición sugerida X={candidato.xSugerido}, Y=
            {candidato.ySugerido}
            {candidato.abreFranjaNueva ? " (abre franja nueva)" : " (aprovecha franja abierta)"}.
          </p>
        </>
      )}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-neutral-600">{label}</span>
      {children}
    </label>
  );
}
