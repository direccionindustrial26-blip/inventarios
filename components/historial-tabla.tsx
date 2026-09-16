"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { editarCorte, eliminarCorte } from "@/app/historial/actions";
import type { EstadoHistorico } from "@/app/pedidos/nuevo/actions";

export type CorteFila = {
  id: number;
  fecha: Date | string | null;
  lote: string;
  pedidoTaller: string | null;
  cliente: string | null;
  anchoMm: number;
  largoMm: number;
  xInicial: number;
  yInicial: number;
  estado: string;
  operario: string | null;
  nota: string | null;
  generadoPorCorteId: number | null;
};

const ESTADO_STYLE: Record<string, string> = {
  VENDIDO: "bg-brand-100 text-brand-800",
  RETAL_UTIL: "bg-amber-100 text-amber-800",
  ELIMINADO: "bg-neutral-200 text-neutral-600",
};

/**
 * Tabla de cortes con edición/eliminación en línea — usada tanto en
 * /historial (todas las líneas, con columna Lote) como en /rollos/[lote]
 * (un solo rollo, sin columna Lote). Editar internamente revierte el corte
 * (libera el área en el rollo/retal de origen) y vuelve a confirmarlo con
 * los valores nuevos, todo en una transacción — ver app/historial/actions.ts.
 */
export function HistorialTabla({
  cortes,
  operarios,
  mostrarLote = true,
}: {
  cortes: CorteFila[];
  operarios: string[];
  mostrarLote?: boolean;
}) {
  const colSpan = mostrarLote ? 9 : 8;
  return (
    <div className="overflow-x-auto card">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-neutral-50 text-left text-neutral-500">
          <tr>
            <th className="px-4 py-2 font-medium">Fecha</th>
            {mostrarLote && <th className="px-4 py-2 font-medium">Lote</th>}
            <th className="px-4 py-2 font-medium">Pedido taller</th>
            <th className="px-4 py-2 font-medium">Cliente</th>
            <th className="px-4 py-2 font-medium">Ancho x Largo (mm)</th>
            <th className="px-4 py-2 font-medium">X, Y</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium">Operario</th>
            <th className="px-4 py-2 font-medium">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {cortes.map((c) => (
            <FilaCorte key={c.id} corte={c} operarios={operarios} mostrarLote={mostrarLote} colSpan={colSpan} />
          ))}
          {cortes.length === 0 && (
            <tr>
              <td className="px-4 py-6 text-center text-neutral-400" colSpan={colSpan}>
                No hay cortes registrados todavía.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function FilaCorte({
  corte,
  operarios,
  mostrarLote,
  colSpan,
}: {
  corte: CorteFila;
  operarios: string[];
  mostrarLote: boolean;
  colSpan: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [anchoMm, setAnchoMm] = useState(String(corte.anchoMm));
  const [largoMm, setLargoMm] = useState(String(corte.largoMm));
  const [xInicial, setXInicial] = useState(String(corte.xInicial));
  const [yInicial, setYInicial] = useState(String(corte.yInicial));
  const [cliente, setCliente] = useState(corte.cliente ?? "");
  const [pedidoTaller, setPedidoTaller] = useState(corte.pedidoTaller ?? "");
  const [operario, setOperario] = useState(corte.operario ?? "");
  const [estado, setEstado] = useState<EstadoHistorico>((corte.estado as EstadoHistorico) || "VENDIDO");
  const [nota, setNota] = useState(corte.nota ?? "");

  const fechaFmt = corte.fecha ? new Date(corte.fecha).toLocaleDateString("es-CO") : "—";

  function cancelar() {
    setEditando(false);
    setError(null);
    setAnchoMm(String(corte.anchoMm));
    setLargoMm(String(corte.largoMm));
    setXInicial(String(corte.xInicial));
    setYInicial(String(corte.yInicial));
    setCliente(corte.cliente ?? "");
    setPedidoTaller(corte.pedidoTaller ?? "");
    setOperario(corte.operario ?? "");
    setEstado((corte.estado as EstadoHistorico) || "VENDIDO");
    setNota(corte.nota ?? "");
  }

  function guardar() {
    setError(null);
    startTransition(async () => {
      const res = await editarCorte({
        corteId: corte.id,
        anchoMm: Number(anchoMm),
        largoMm: Number(largoMm),
        xInicial: Number(xInicial),
        yInicial: Number(yInicial),
        cliente,
        pedidoTaller,
        operario,
        estado,
        nota,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditando(false);
    });
  }

  function eliminar() {
    if (
      !confirm(
        "¿Eliminar este corte? El área que ocupaba vuelve a quedar disponible en el rollo o retal de origen — esto no se puede deshacer."
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await eliminarCorte(corte.id);
      if (!res.ok) setError(res.error);
    });
  }

  // El sobrante lateral que confirmarCorte genera automáticamente junto a un
  // corte de rollo no se edita/elimina por su cuenta — hacerlo dejaría el
  // retal gemelo huérfano. Se corrige editando o eliminando el corte
  // principal, que arrastra su sobrante consigo (ver revertirCorte).
  if (corte.generadoPorCorteId != null) {
    return (
      <tr className="text-neutral-400">
        <td className="px-4 py-2">{fechaFmt}</td>
        {mostrarLote && (
          <td className="px-4 py-2">
            <Link href={`/rollos/${encodeURIComponent(corte.lote)}`} className="link-brand">
              {corte.lote}
            </Link>
          </td>
        )}
        <td className="px-4 py-2">—</td>
        <td className="px-4 py-2">—</td>
        <td className="px-4 py-2">
          {corte.anchoMm.toLocaleString("es-CO")} x {corte.largoMm.toLocaleString("es-CO")}
        </td>
        <td className="px-4 py-2">
          {corte.xInicial.toLocaleString("es-CO")}, {corte.yInicial.toLocaleString("es-CO")}
        </td>
        <td className="px-4 py-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_STYLE[corte.estado] ?? "bg-neutral-100"}`}>
            {corte.estado}
          </span>
        </td>
        <td className="px-4 py-2">{corte.operario ?? "—"}</td>
        <td className="px-4 py-2 text-xs italic">Sobrante automático — edítalo desde el corte principal</td>
      </tr>
    );
  }

  if (!editando) {
    return (
      <tr className="hover:bg-brand-50/60">
        <td className="px-4 py-2">{fechaFmt}</td>
        {mostrarLote && (
          <td className="px-4 py-2">
            <Link href={`/rollos/${encodeURIComponent(corte.lote)}`} className="link-brand">
              {corte.lote}
            </Link>
          </td>
        )}
        <td className="px-4 py-2">{corte.pedidoTaller ?? "—"}</td>
        <td className="px-4 py-2">{corte.cliente ?? "—"}</td>
        <td className="px-4 py-2">
          {corte.anchoMm.toLocaleString("es-CO")} x {corte.largoMm.toLocaleString("es-CO")}
        </td>
        <td className="px-4 py-2">
          {corte.xInicial.toLocaleString("es-CO")}, {corte.yInicial.toLocaleString("es-CO")}
        </td>
        <td className="px-4 py-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_STYLE[corte.estado] ?? "bg-neutral-100"}`}>
            {corte.estado}
          </span>
        </td>
        <td className="px-4 py-2">{corte.operario ?? "—"}</td>
        <td className="px-4 py-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditando(true)} className="link-brand">
              Editar
            </button>
            <button type="button" onClick={eliminar} disabled={isPending} className="text-red-700 underline">
              Eliminar
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="bg-brand-50/60 align-top">
        <td className="px-4 py-2 text-xs text-neutral-500">{fechaFmt}</td>
        {mostrarLote && <td className="px-4 py-2 text-xs text-neutral-500">{corte.lote}</td>}
        <td className="px-2 py-2">
          <input className="input w-28" value={pedidoTaller} onChange={(e) => setPedidoTaller(e.target.value)} />
        </td>
        <td className="px-2 py-2">
          <input className="input w-32" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        </td>
        <td className="px-2 py-2">
          <div className="flex items-center gap-1">
            <input className="input w-16" type="number" value={anchoMm} onChange={(e) => setAnchoMm(e.target.value)} />
            <span className="text-neutral-400">x</span>
            <input className="input w-20" type="number" value={largoMm} onChange={(e) => setLargoMm(e.target.value)} />
          </div>
        </td>
        <td className="px-2 py-2">
          <div className="flex items-center gap-1">
            <input className="input w-16" type="number" value={xInicial} onChange={(e) => setXInicial(e.target.value)} />
            <input className="input w-16" type="number" value={yInicial} onChange={(e) => setYInicial(e.target.value)} />
          </div>
        </td>
        <td className="px-2 py-2">
          <select className="input" value={estado} onChange={(e) => setEstado(e.target.value as EstadoHistorico)}>
            <option value="VENDIDO">VENDIDO</option>
            <option value="RETAL_UTIL">RETAL ÚTIL</option>
            <option value="ELIMINADO">ELIMINADO</option>
          </select>
        </td>
        <td className="px-2 py-2">
          <select className="input" value={operario} onChange={(e) => setOperario(e.target.value)}>
            <option value="">Selecciona...</option>
            {operarios.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </td>
        <td className="px-2 py-2">
          <div className="flex flex-col gap-1">
            <button type="button" onClick={guardar} disabled={isPending} className="btn-primary px-2 py-1 text-xs">
              {isPending ? "Guardando..." : "Guardar"}
            </button>
            <button type="button" onClick={cancelar} disabled={isPending} className="btn-secondary px-2 py-1 text-xs">
              Cancelar
            </button>
          </div>
        </td>
      </tr>
      <tr className="bg-brand-50/40">
        <td className="px-4 pb-3 pt-0" colSpan={colSpan}>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-neutral-600">
              Nota:
              <input className="input ml-2 w-72" value={nota} onChange={(e) => setNota(e.target.value)} />
            </label>
            {error && <span className="text-xs font-medium text-red-600">{error}</span>}
          </div>
        </td>
      </tr>
    </>
  );
}
