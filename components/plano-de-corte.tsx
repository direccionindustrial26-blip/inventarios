type CortePlano = {
  id: number;
  xInicial: number;
  yInicial: number;
  anchoMm: number;
  largoMm: number;
  estado: string;
  pedidoTaller: string | null;
  cliente: string | null;
};

type PiezaPropuesta = {
  xInicial: number;
  yInicial: number;
  anchoMm: number;
  largoMm: number;
};

const COLOR_POR_ESTADO: Record<string, string> = {
  VENDIDO: "#7ecbf1", // azul marca — pieza vendida
  RETAL_UTIL: "#fde68a", // amarillo — sobrante reutilizable
  ELIMINADO: "#e5e7eb", // gris — desperdicio
};

// Verde — el corte que se acaba de hacer, para que resalte de inmediato y no
// se confunda con el azul de "vendido" de los cortes anteriores.
const COLOR_CORTE_NUEVO = "#22c55e";

/**
 * Dibuja el rollo como un rectángulo (ancho x largo) con cada corte
 * superpuesto en su X/Y real — el mismo dibujo que Diego arma a mano en el
 * Excel "Plano de corte" / "DatosGrafico", pero generado automáticamente.
 *
 * `piezaPropuesta`, si se da, se dibuja encima como un rectángulo punteado
 * en azul marca — la pieza nueva que se está a punto de cortar, para que el
 * usuario vea de un vistazo si de verdad cabe donde el motor la ubicó (o
 * donde la haya movido a mano).
 */
export function PlanoDeCorte({
  anchoRollo,
  largoRollo,
  largoUsado,
  cortes,
  piezaPropuesta,
  corteNuevoId,
}: {
  anchoRollo: number;
  largoRollo: number;
  largoUsado: number;
  cortes: CortePlano[];
  piezaPropuesta?: PiezaPropuesta;
  /** Id del corte recién confirmado — se resalta en verde en vez de su color de estado normal. */
  corteNuevoId?: number;
}) {
  // El rollo se dibuja "acostado": el ancho del rollo en el eje horizontal
  // de la pantalla y el largo en el eje vertical, igual que en el Excel.
  // Usamos un ancho de lienzo fijo y escalamos el alto proporcionalmente al
  // largo, para que rollos muy largos no se vean como una línea.
  const anchoSvg = 480;
  const escalaX = anchoSvg / anchoRollo;
  const altoSvg = Math.min(Math.max(largoRollo * escalaX, 120), 900);
  const escalaY = altoSvg / largoRollo;

  return (
    <div className="overflow-x-auto">
      <svg
        width={anchoSvg}
        height={altoSvg}
        viewBox={`0 0 ${anchoSvg} ${altoSvg}`}
        className="rounded-lg border border-brand-200 bg-brand-50/40"
      >
        {/* frontera de lo ya usado */}
        <rect
          x={0}
          y={0}
          width={anchoRollo * escalaX}
          height={largoUsado * escalaY}
          fill="#ffffff"
          stroke="#bcd8e8"
          strokeDasharray="4 3"
        />
        {cortes.map((c) => {
          const esNuevo = c.id === corteNuevoId;
          const w = Math.max(c.anchoMm * escalaX, 1);
          const h = Math.max(c.largoMm * escalaY, 1);
          const cx = c.xInicial * escalaX + w / 2;
          const cy = c.yInicial * escalaY + h / 2;
          const etiqueta = `${c.anchoMm}×${c.largoMm}`;
          // Texto legible solo si el rectángulo tiene espacio; en piezas
          // angostas pero largas se rota 90° para que quepa a lo largo.
          const vertical = w < h;
          const cabeTexto = vertical ? w > 12 && h > 26 : w > 26 && h > 12;
          const fontSize = Math.max(6, Math.min(vertical ? w * 0.6 : h * 0.45, 12));

          return (
            <g key={c.id}>
              <rect
                x={c.xInicial * escalaX}
                y={c.yInicial * escalaY}
                width={w}
                height={h}
                fill={esNuevo ? COLOR_CORTE_NUEVO : (COLOR_POR_ESTADO[c.estado] ?? "#d1d5db")}
                stroke={esNuevo ? "#15803d" : "#0a4563"}
                strokeWidth={esNuevo ? 2 : 0.5}
              >
                <title>
                  {(c.pedidoTaller ?? "sin pedido") +
                    (c.cliente ? ` · ${c.cliente}` : "") +
                    ` · ${c.anchoMm}x${c.largoMm}mm · (${c.xInicial}, ${c.yInicial})`}
                </title>
              </rect>
              {cabeTexto && (
                <text
                  x={cx}
                  y={cy}
                  fontSize={fontSize}
                  fill="#08344a"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {etiqueta}
                </text>
              )}
            </g>
          );
        })}
        {piezaPropuesta && piezaPropuesta.anchoMm > 0 && piezaPropuesta.largoMm > 0 && (
          <rect
            x={piezaPropuesta.xInicial * escalaX}
            y={piezaPropuesta.yInicial * escalaY}
            width={Math.max(piezaPropuesta.anchoMm * escalaX, 1)}
            height={Math.max(piezaPropuesta.largoMm * escalaY, 1)}
            fill="#1a8fca"
            fillOpacity={0.35}
            stroke="#1171a1"
            strokeWidth={1.5}
            strokeDasharray="5 3"
          >
            <title>
              Pieza nueva propuesta · {piezaPropuesta.anchoMm}x{piezaPropuesta.largoMm}mm · (
              {piezaPropuesta.xInicial}, {piezaPropuesta.yInicial})
            </title>
          </rect>
        )}
        {/* borde del rollo completo */}
        <rect
          x={0}
          y={0}
          width={anchoRollo * escalaX}
          height={largoRollo * escalaY}
          fill="none"
          stroke="#08344a"
          strokeWidth={1.5}
        />
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-neutral-600">
        <Legend color={COLOR_POR_ESTADO.VENDIDO} label="Vendido" />
        <Legend color={COLOR_POR_ESTADO.RETAL_UTIL} label="Retal útil" />
        <Legend color={COLOR_POR_ESTADO.ELIMINADO} label="Eliminado" />
        {corteNuevoId !== undefined && <Legend color={COLOR_CORTE_NUEVO} label="Corte recién hecho" />}
        {piezaPropuesta && <Legend color="#1a8fca" dashed label="Pieza nueva propuesta" />}
      </div>
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-block h-3 w-3 rounded-sm border ${dashed ? "border-dashed border-brand-700" : "border-neutral-400"}`}
        style={{ background: color, opacity: dashed ? 0.5 : 1 }}
      />
      {label}
    </span>
  );
}
