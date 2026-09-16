import {
  pgTable,
  text,
  integer,
  doublePrecision,
  timestamp,
  boolean,
  serial,
} from "drizzle-orm/pg-core";

/**
 * ROLLOS — inventario maestro de rollos (reemplaza la hoja Inventario_Rollos
 * de Planos Rollos.xlsx).
 *
 * `largo_usado_mm` es la frontera de corte acumulada del rollo: la lógica de
 * corte (ver lib/cutting-engine.ts) va "apilando" piezas en franjas (shelves)
 * a lo largo del eje Y del rollo, y este campo marca hasta dónde se ha
 * avanzado. No se persisten las franjas intermedias — se recalculan a partir
 * del histórico de cortes cuando se necesita el plano visual completo.
 */
export const rollos = pgTable("rollos", {
  id: serial("id").primaryKey(),
  lote: text("lote").notNull().unique(),
  linea: text("linea").notNull(),
  referencia: text("referencia").notNull(),
  anchoMm: doublePrecision("ancho_mm").notNull(),
  largoMm: doublePrecision("largo_mm").notNull(),
  largoUsadoMm: doublePrecision("largo_usado_mm").notNull().default(0),
  estado: text("estado").notNull().default("INICIADO"), // INICIADO | COMPLETO | AGOTADO
  proveedor: text("proveedor"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/**
 * RETALES — piezas sobrantes de un corte previo (RETAL_UTIL) que quedan
 * disponibles como inventario propio, independiente del rollo de origen.
 * Este es el hueco que hoy no existe en el ERP (ver acta Sesión 2): el ERP
 * suma saldos sin saber en cuántos pedazos está repartido un total.
 */
export const retales = pgTable("retales", {
  id: serial("id").primaryKey(),
  loteOrigen: text("lote_origen").notNull(),
  linea: text("linea").notNull(),
  referencia: text("referencia").notNull(),
  anchoMm: doublePrecision("ancho_mm").notNull(),
  largoMm: doublePrecision("largo_mm").notNull(),
  disponible: boolean("disponible").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  // Si este retal salió como sobrante automático de un corte (ver
  // confirmarCorte/insertarSobrante en app/pedidos/nuevo/actions.ts), el id
  // de ese corte — permite revertir el corte (editarCorte/eliminarCorte en
  // app/historial/actions.ts) sin dejar sobrantes huérfanos, y bloquear la
  // reversión si el sobrante ya fue consumido por otro pedido.
  origenCorteId: integer("origen_corte_id"),
});

/**
 * CORTES — bitácora de cada corte realizado (reemplaza Historico_Cortes).
 * Sirve tanto de trazabilidad como de fuente para reconstruir el plano
 * visual de un rollo (X/Y de cada pieza cortada).
 */
export const cortes = pgTable("cortes", {
  id: serial("id").primaryKey(),
  lote: text("lote").notNull(),
  fecha: timestamp("fecha", { withTimezone: true }).defaultNow(),
  pedidoTaller: text("pedido_taller"),
  cliente: text("cliente"),
  anchoMm: doublePrecision("ancho_mm").notNull(),
  largoMm: doublePrecision("largo_mm").notNull(),
  areaMm2: doublePrecision("area_mm2"),
  // VENDIDO | RETAL_UTIL | ELIMINADO
  estado: text("estado").notNull().default("VENDIDO"),
  operario: text("operario"),
  xInicial: doublePrecision("x_inicial").notNull(),
  yInicial: doublePrecision("y_inicial").notNull(),
  // origen del material: "rollo" o "retal", y el id del retal si aplica
  origenTipo: text("origen_tipo").notNull().default("rollo"),
  origenRetalId: integer("origen_retal_id"),
  nota: text("nota"),
  // Denormalizadas igual que cliente/operario — de dónde salió el corte
  // (rollo o retal) siempre sabe su línea/referencia, y guardarlas aquí
  // evita tener que hacer join con rollos/retales para poder agrupar la
  // demanda histórica por referencia (ver lib/inventory-policy.ts). En
  // filas históricas cargadas antes de este campo, quedan null hasta el
  // backfill (scripts/backfill-linea-referencia.ts).
  linea: text("linea"),
  referencia: text("referencia"),
  // Si esta fila es el sobrante lateral RETAL_UTIL que confirmarCorte genera
  // automáticamente junto a un corte sobre rollo, el id de ese corte
  // "padre" — mismo propósito que retales.origenCorteId, ver ahí.
  generadoPorCorteId: integer("generado_por_corte_id"),
});

/**
 * ANCHOS_ANALISIS — snapshot del análisis Pareto de anchos vendidos
 * (Analisis Anchos Malla teflon Cafe.xlsx), usado para recomendaciones de
 * compra. Solo lectura desde la UI por ahora.
 */
export const anchosAnalisis = pgTable("anchos_analisis", {
  id: serial("id").primaryKey(),
  anchoMm: doublePrecision("ancho_mm").notNull(),
  pedidos: integer("pedidos").notNull(),
  unidadesVendidas: integer("unidades_vendidas").notNull(),
  pctTotal: doublePrecision("pct_total").notNull(),
  pctAcumulado: doublePrecision("pct_acumulado").notNull(),
});

/**
 * MAESTROS — Operarios, Líneas, Clientes y Proveedores.
 *
 * Antes de esto "cliente" y "operario" eran texto libre escrito en cada
 * corte (ver `cortes.cliente` / `cortes.operario`, que se conservan como
 * columnas denormalizadas por compatibilidad con el histórico ya cargado).
 * Estas tablas son la fuente de verdad para los desplegables del
 * formulario de pedido — reemplazan la digitación libre por selección de
 * datos ya validados, y evitan errores de tipeo en cliente/operario.
 */
export const operarios = pgTable("operarios", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  estado: text("estado").notNull().default("Activo"), // Activo | Inactivo
});

export const lineas = pgTable("lineas", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
  estado: text("estado").notNull().default("Activo"),
});

/**
 * CLIENTES — cada cliente tiene una letra de referencia única que se
 * antepone al número de pedido (ej. IBELTCO = letra "C" → pedido "C-1234").
 * El número de pedido en sí (`nuevo-pedido-form.tsx`) se valida como
 * solo-numérico; el código completo se arma como `${letra}-${numero}`.
 */
export const clientes = pgTable("clientes", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  letra: text("letra").notNull().unique(), // 1 letra A-Z
  nit: text("nit"),
  contacto: text("contacto"),
  telefono: text("telefono"),
  estado: text("estado").notNull().default("Activo"),
});

export const proveedores = pgTable("proveedores", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  contacto: text("contacto"),
  telefono: text("telefono"),
  estado: text("estado").notNull().default("Activo"),
});

/**
 * USUARIOS — control de acceso a la aplicación. Cada usuario tiene un rol
 * (Administrador | Almacen | Operario) que define un set de páginas por
 * defecto (ver PAGINAS_POR_ROL en lib/auth.ts), pero el administrador puede
 * ajustar exactamente qué páginas ve cada quien en `paginasPermitidas` —
 * un array de claves de página (ver lib/pages.ts), independiente del rol.
 * Un usuario con rol Administrador ve todo siempre, sin importar lo que
 * tenga guardado en `paginasPermitidas` (ver lib/auth.ts).
 */
export const usuarios = pgTable("usuarios", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  rol: text("rol").notNull().default("Operario"), // Administrador | Almacen | Operario
  paginasPermitidas: text("paginas_permitidas").array().notNull().default([]),
  estado: text("estado").notNull().default("Activo"), // Activo | Inactivo
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/**
 * SESIONES — sesiones de login activas, token opaco (no JWT) guardado en
 * una cookie httpOnly y buscado aquí en cada request. Se prefiere sobre un
 * JWT autocontenido porque así desactivar un usuario (o cerrarle sesión a
 * la fuerza) tiene efecto inmediato, sin esperar a que expire un token que
 * ya se emitió.
 */
export const sesiones = pgTable("sesiones", {
  token: text("token").primaryKey(),
  usuarioId: integer("usuario_id").notNull(),
  expiraEn: timestamp("expira_en", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/**
 * POLITICAS_INVENTARIO — un renglón de política de reabastecimiento por
 * línea+referencia (política (s, S): pedir cuando el stock cae por debajo
 * del punto de reorden `s`, hasta un nivel objetivo `S`). Ver
 * lib/inventory-policy.ts para las fórmulas; esta tabla solo guarda los
 * insumos que Diego/Diana deben calibrar a mano porque no hay datos de
 * proveedor (tiempo de reposición) ni de costos en el sistema todavía.
 *
 * Un renglón por (linea, referencia) — sin FK porque, igual que en
 * `rollos`/`retales`, "referencia" es texto libre y no un maestro propio.
 */
export const politicasInventario = pgTable("politicas_inventario", {
  id: serial("id").primaryKey(),
  linea: text("linea").notNull(),
  referencia: text("referencia").notNull(),
  // Tiempo de reposición del proveedor, en días — insumo del punto de reorden.
  leadTimeDias: integer("lead_time_dias").notNull().default(30),
  // Cuántos días de demanda adicionales, más allá del lead time, se quiere
  // cubrir al pedir (define el nivel objetivo S).
  diasCoberturaObjetivo: integer("dias_cobertura_objetivo").notNull().default(30),
  // Colchón manual en m² por si Diego quiere un margen extra sobre el
  // calculado a partir del lead time (variabilidad de demanda/proveedor).
  stockSeguridadM2: doublePrecision("stock_seguridad_m2").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
