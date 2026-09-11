import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Car,
  ChevronDown,
  ClipboardList,
  Download,
  FileText,
  LayoutDashboard,
  Search,
  type LucideIcon,
} from "lucide-react";
import { formatCopFromString } from "../../utils/copFormat";
import { portalPath } from "../../constants/portalPath";
import type {
  ClientPortalAccount,
  PortalInvoice,
  PortalOrder,
  PortalVehicle,
  WorkOrderStatus,
} from "../../api/types";

const STATUS: Record<WorkOrderStatus, { label: string; tone: string }> = {
  UNASSIGNED: { label: "Sin asignar", tone: "bg-slate-200 text-slate-900 dark:bg-slate-600 dark:text-white" },
  RECEIVED: { label: "Recibida", tone: "bg-slate-300 text-slate-900 dark:bg-slate-500 dark:text-white" },
  IN_WORKSHOP: { label: "En taller", tone: "bg-brand-700 text-white" },
  WAITING_PARTS: { label: "Esperando repuestos", tone: "bg-amber-500 text-amber-950" },
  READY: { label: "Lista para retiro", tone: "bg-emerald-700 text-white" },
  DELIVERED: { label: "Entregada", tone: "bg-slate-600 text-white" },
  CANCELLED: { label: "Cancelada", tone: "bg-red-700 text-white" },
};

const INVOICE_STATUS: Record<PortalInvoice["status"], { label: string; tone: string }> = {
  DRAFT: { label: "Borrador", tone: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" },
  ISSUED: { label: "Aceptada", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" },
  VOIDED: { label: "Anulada", tone: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200" },
};

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function money(s: string | null | undefined): string {
  if (!s) return "$0";
  return `$${formatCopFromString(s)}`;
}

const TOTAL_LABEL: Record<string, string> = {
  subtotal: "Subtotal",
  totalDiscount: "Descuentos",
  totalTax: "Impuestos",
  grandTotal: "Total",
  amountPaid: "Pagado",
  amountDue: "Saldo",
};

type OrderRef = { vehicle: PortalVehicle; order: PortalOrder };
type InvoiceRef = { vehicle: PortalVehicle; order: PortalOrder; invoice: PortalInvoice };

function allOrders(account: ClientPortalAccount): OrderRef[] {
  return account.vehicles
    .flatMap((v) => v.orders.map((order) => ({ vehicle: v, order })))
    .sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt));
}

function allInvoices(account: ClientPortalAccount): InvoiceRef[] {
  return account.vehicles
    .flatMap((v) => v.orders.flatMap((o) => o.invoices.map((invoice) => ({ vehicle: v, order: o, invoice }))))
    .sort((a, b) => (b.invoice.issuedAt ?? b.invoice.createdAt).localeCompare(a.invoice.issuedAt ?? a.invoice.createdAt));
}

function TotalsList({ order }: { order: PortalOrder }) {
  const items: Array<{ label: string; value: string; strong?: boolean }> = [
    { label: TOTAL_LABEL.subtotal, value: money(order.subtotal) },
  ];
  if (Number(order.totalDiscount) > 0) {
    items.push({ label: TOTAL_LABEL.totalDiscount, value: `−${money(order.totalDiscount)}` });
  }
  if (Number(order.totalTax) > 0) {
    items.push({ label: TOTAL_LABEL.totalTax, value: money(order.totalTax) });
  }
  items.push({ label: TOTAL_LABEL.grandTotal, value: money(order.grandTotal), strong: true });
  if (Number(order.amountPaid) > 0) {
    items.push({ label: TOTAL_LABEL.amountPaid, value: `−${money(order.amountPaid)}` });
  }
  items.push({ label: TOTAL_LABEL.amountDue, value: money(order.amountDue), strong: true });

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-slate-500 dark:text-slate-300">{it.label}</dt>
          <dd
            className={`tabular-nums text-sm ${it.strong ? "font-semibold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-200"}`}
          >
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function LinesTable({ lines }: { lines: PortalOrder["lines"] }) {
  if (lines.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-slate-300">Sin líneas registradas.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-zinc-800">
      <table className="va-table min-w-[560px]">
        <thead>
          <tr>
            <th className="va-table-th">Detalle</th>
            <th className="va-table-th text-right">Cant.</th>
            <th className="va-table-th text-right">Unitario</th>
            <th className="va-table-th text-right">IVA</th>
            <th className="va-table-th text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((ln, i) => (
            <tr key={i}>
              <td className="va-table-td">
                <span className="text-xs text-slate-500 dark:text-slate-300">
                  {ln.lineType === "LABOR" ? "Mano de obra" : "Repuesto"}
                </span>
                <div className="text-sm text-slate-800 dark:text-slate-100">{ln.description || "—"}</div>
              </td>
              <td className="va-table-td text-right tabular-nums">{ln.quantity}</td>
              <td className="va-table-td text-right tabular-nums">{money(ln.unitPrice)}</td>
              <td className="va-table-td text-right tabular-nums">{Number(ln.taxPercent) > 0 ? `${Number(ln.taxPercent)}%` : "—"}</td>
              <td className="va-table-td text-right font-medium tabular-nums">{money(ln.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceBlock({ invoice }: { invoice: PortalInvoice }) {
  const st = INVOICE_STATUS[invoice.status];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white">{invoice.documentNumber}</span>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span>
        <span className="text-xs text-slate-500 dark:text-slate-300">{formatWhen(invoice.issuedAt ?? invoice.createdAt)}</span>
      </div>
      {invoice.status === "ISSUED" && invoice.cufe ? (
        <p className="mt-2 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">CUFE: {invoice.cufe}</p>
      ) : null}
      <div className="mt-3">
        <LinesTable lines={invoice.lines} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-slate-500 dark:text-slate-300">Subtotal</dt>
          <dd className="text-sm tabular-nums text-slate-700 dark:text-slate-200">{money(invoice.subtotal)}</dd>
        </div>
        {Number(invoice.totalDiscount) > 0 ? (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-slate-500 dark:text-slate-300">Descuentos</dt>
            <dd className="text-sm tabular-nums text-slate-700 dark:text-slate-200">−{money(invoice.totalDiscount)}</dd>
          </div>
        ) : null}
        {Number(invoice.totalTax) > 0 ? (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-slate-500 dark:text-slate-300">Impuestos</dt>
            <dd className="text-sm tabular-nums text-slate-700 dark:text-slate-200">{money(invoice.totalTax)}</dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs font-medium text-slate-500 dark:text-slate-300">Total</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{money(invoice.grandTotal)}</dd>
        </div>
        {invoice.creditNotes.length > 0 ? (
          <div className="col-span-2">
            <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-400">Notas crédito emitidas</p>
            <ul className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
              {invoice.creditNotes.map((cn) => (
                <li key={cn.documentNumber} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {cn.documentNumber} — {cn.reason || "sin motivo"}
                  </span>
                  <span className="tabular-nums">−{money(cn.grandTotal)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-slate-500 dark:text-slate-300">Pagado</dt>
          <dd className="text-sm tabular-nums text-slate-700 dark:text-slate-200">−{money(invoice.amountPaid)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs font-medium text-slate-500 dark:text-slate-300">Saldo</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{money(invoice.amountDue)}</dd>
        </div>
      </dl>
    </div>
  );
}

function DownloadBtn({
  busy,
  disabled,
  onClick,
  label = "Descargar PDF",
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="va-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
    >
      {busy ? "Generando PDF…" : (
        <>
          <Download className="h-3.5 w-3.5" />
          {label}
        </>
      )}
    </button>
  );
}

function OrderRow({
  vehicle,
  order,
  downloading,
  onDownload,
}: {
  vehicle: PortalVehicle;
  order: PortalOrder;
  downloading: boolean;
  onDownload: (v: PortalVehicle, o: PortalOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  const st = STATUS[order.status];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold tracking-tight ${st.tone}`}>{st.label}</span>
            <span className="font-mono text-sm text-slate-700 dark:text-slate-200">{order.publicCode}</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600 dark:bg-zinc-800 dark:text-slate-300">
              {vehicle.plate}
            </span>
          </div>
          {order.description ? (
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">{order.description}</p>
          ) : null}
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{formatWhen(order.createdAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <DownloadBtn busy={downloading} onClick={() => onDownload(vehicle, order)} />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="va-btn-secondary rounded-lg px-3 py-1.5 text-xs font-semibold"
            aria-expanded={open}
          >
            {open ? "Ocultar detalle" : "Ver detalle"}
            <ChevronDown className={`ml-1 inline h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-slate-200 pt-4 dark:border-zinc-800">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-500">
                Detalle del servicio
              </p>
              <LinesTable lines={order.lines} />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-500">
                Totales
              </p>
              <TotalsList order={order} />
            </div>
          </div>
          {order.invoices.length > 0 ? (
            <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-zinc-800">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-500">Facturas</p>
              {order.invoices.map((inv) => (
                <InvoiceBlock key={inv.documentNumber} invoice={inv} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function VehicleCard({
  vehicle,
  downloadingKey,
  onDownload,
}: {
  vehicle: PortalVehicle;
  downloadingKey: string | null;
  onDownload: (v: PortalVehicle, o: PortalOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl border border-slate-200/85 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{vehicle.plate}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {[vehicle.brand, vehicle.model, vehicle.year ? String(vehicle.year) : null, vehicle.color]
            .filter(Boolean)
            .join(" · ") || "Vehículo"}
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto va-btn-secondary rounded-lg px-3 py-1.5 text-xs font-semibold"
          aria-expanded={open}
        >
          {open ? "Ocultar órdenes" : `Ver órdenes (${vehicle.orders.length})`}
          <ChevronDown className={`ml-1 inline h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && vehicle.orders.length > 0 ? (
        <div className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-zinc-800">
          {vehicle.orders.map((order) => (
            <OrderRow
              key={order.publicCode}
              vehicle={vehicle}
              order={order}
              downloading={downloadingKey === order.publicCode}
              onDownload={onDownload}
            />
          ))}
        </div>
      ) : open ? (
        <p className="mt-4 border-t border-slate-200 pt-4 text-sm text-slate-500 dark:border-zinc-800 dark:text-slate-400">
          Este vehículo no tiene órdenes registradas en la consulta.
        </p>
      ) : null}
    </section>
  );
}

function InvoiceRow({
  item,
  downloading,
  onDownload,
}: {
  item: InvoiceRef;
  downloading: boolean;
  onDownload: (v: PortalVehicle, o: PortalOrder) => void;
}) {
  const { vehicle, order, invoice } = item;
  const [open, setOpen] = useState(false);
  const st = INVOICE_STATUS[invoice.status];
  const downloadable = invoice.status !== "VOIDED";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold tracking-tight ${st.tone}`}>{st.label}</span>
            <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white">{invoice.documentNumber}</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600 dark:bg-zinc-800 dark:text-slate-300">
              {vehicle.plate}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{formatWhen(invoice.issuedAt ?? invoice.createdAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <DownloadBtn busy={downloading} disabled={!downloadable} onClick={() => onDownload(vehicle, order)} />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="va-btn-secondary rounded-lg px-3 py-1.5 text-xs font-semibold"
            aria-expanded={open}
          >
            {open ? "Ocultar detalle" : "Ver detalle"}
            <ChevronDown className={`ml-1 inline h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-slate-200 pt-4 dark:border-zinc-800">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Orden {order.publicCode} · {order.description || "Sin descripción"}
          </p>
          <LinesTable lines={invoice.lines} />
          <InvoiceBlock invoice={invoice} />
        </div>
      ) : null}
    </div>
  );
}

function ResumenView({
  account,
  downloadingKey,
  onDownload,
}: {
  account: ClientPortalAccount;
  downloadingKey: string | null;
  onDownload: (v: PortalVehicle, o: PortalOrder) => void;
}) {
  const latest = allOrders(account).slice(0, 3);
  const name = account.cliente.displayName || "cliente";
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-900 dark:bg-brand-950/30 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-500">Bienvenido</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Hola, {name}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Esto es todo lo que tienes en el taller: tus vehículos, órdenes de trabajo y facturas. Usá el menú para
          consultar cada sección.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {account.cliente.documentId ? (
            <span className="text-slate-600 dark:text-slate-300">
              <span className="text-xs text-slate-500 dark:text-slate-400">Documento: </span>
              {account.cliente.documentId}
            </span>
          ) : null}
          {account.cliente.maskedPhone ? (
            <span className="text-slate-600 dark:text-slate-300">
              <span className="text-xs text-slate-500 dark:text-slate-400">Celular verificado: </span>
              {account.cliente.maskedPhone}
            </span>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Vehículos", value: String(account.resumen.vehiclesCount) },
          { label: "Órdenes activas", value: String(account.resumen.openOrders) },
          { label: "Facturas", value: String(account.resumen.invoicesCount) },
          { label: "Saldo pendiente", value: money(account.resumen.openBalance) },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-200/85 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <dt className="text-xs text-slate-500 dark:text-slate-300">{item.label}</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-white">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {latest.length > 0 ? (
        <section>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Órdenes recientes
          </h3>
          <div className="space-y-3">
            {latest.map(({ vehicle, order }) => (
              <OrderRow
                key={order.publicCode}
                vehicle={vehicle}
                order={order}
                downloading={downloadingKey === order.publicCode}
                onDownload={onDownload}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

type ViewId = "resumen" | "vehiculos" | "ordenes" | "facturas";

export function ClientPortalWindow({
  account,
  downloadingKey,
  onDownload,
  onNewSearch,
}: {
  account: ClientPortalAccount;
  downloadingKey: string | null;
  onDownload: (v: PortalVehicle, o: PortalOrder) => void;
  onNewSearch: () => void;
}) {
  const [view, setView] = useState<ViewId>("resumen");
  const orders = allOrders(account);
  const menu: Array<{ id: ViewId; label: string; Icon: LucideIcon; badge: number | null }> = [
    { id: "resumen", label: "Resumen", Icon: LayoutDashboard, badge: null },
    { id: "vehiculos", label: "Mis vehículos", Icon: Car, badge: account.resumen.vehiclesCount },
    { id: "ordenes", label: "Órdenes", Icon: ClipboardList, badge: orders.length },
    { id: "facturas", label: "Facturas", Icon: FileText, badge: account.resumen.invoicesCount },
  ];

  const navBtn = (id: ViewId) =>
    `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
      view === id
        ? "bg-brand-700 text-white shadow-sm"
        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-zinc-800"
    }`;

  const tabBtn = (id: ViewId) =>
    `inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
      view === id ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-slate-300"
    }`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        {/* Cabecera del portal */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <img src="/logo_landing.png" alt="Vene Autos" className="h-8 w-auto select-none sm:h-9" draggable={false} />
            <span className="text-sm font-bold tracking-tight text-brand-700 dark:text-brand-500">Mi cuenta</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-zinc-800 dark:text-slate-200">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-700 text-[10px] font-bold text-white">
                {(account.cliente.displayName || "C")[0]}
              </span>
              {account.cliente.displayName || "Cliente"}
              {account.cliente.maskedPhone ? <span className="ml-1.5 tabular-nums text-slate-400">{account.cliente.maskedPhone}</span> : null}
            </span>
            <button
              type="button"
              onClick={onNewSearch}
              className="va-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
            >
              <Search className="h-3.5 w-3.5" />
              Nueva consulta
            </button>
            <Link
              to={portalPath("/")}
              className="va-btn-secondary inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold"
            >
              Sitio
            </Link>
          </div>
        </div>

        <div className="lg:grid lg:grid-cols-[16rem_1fr]">
          {/* Menú lateral (escritorio) */}
          <aside className="hidden border-r border-slate-200 p-3 lg:block dark:border-zinc-800">
            <nav className="space-y-1">
              {menu.map(({ id, label, Icon, badge }) => (
                <button key={id} type="button" onClick={() => setView(id)} className={navBtn(id)}>
                  <Icon className="h-4 w-4" />
                  {label}
                  {badge !== null && badge > 0 ? (
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                        view === id ? "bg-white/20 text-white" : "bg-brand-700 text-white"
                      }`}
                    >
                      {badge}
                    </span>
                  ) : null}
                </button>
              ))}
            </nav>
            <p className="mt-6 border-t border-slate-200 px-3 pt-4 text-[11px] leading-relaxed text-slate-400 dark:border-zinc-800 dark:text-slate-500">
              Consulta de solo lectura. Para abonos, facturación o dudas, contactá al taller por WhatsApp o en persona.
            </p>
          </aside>

          {/* Pestañas (móvil) */}
          <div className="flex gap-2 overflow-x-auto border-b border-slate-200 p-2 lg:hidden dark:border-zinc-800">
            {menu.map(({ id, label, Icon, badge }) => (
              <button key={id} type="button" onClick={() => setView(id)} className={tabBtn(id)}>
                <Icon className="h-3.5 w-3.5" />
                {label}
                {badge !== null && badge > 0 ? <span className="tabular-nums">({badge})</span> : null}
              </button>
            ))}
          </div>

          {/* Contenido */}
          <main className="p-5 sm:p-7">
            {view === "resumen" ? (
              <ResumenView account={account} downloadingKey={downloadingKey} onDownload={onDownload} />
            ) : view === "vehiculos" ? (
              <div className="space-y-4">
                {account.vehicles.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No hay vehículos para mostrar.</p>
                ) : (
                  account.vehicles.map((vehicle) => (
                    <VehicleCard
                      key={vehicle.plate}
                      vehicle={vehicle}
                      downloadingKey={downloadingKey}
                      onDownload={onDownload}
                    />
                  ))
                )}
              </div>
            ) : view === "ordenes" ? (
              <div className="space-y-3">
                {orders.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No hay órdenes de trabajo para mostrar.</p>
                ) : (
                  orders.map(({ vehicle, order }) => (
                    <OrderRow
                      key={order.publicCode}
                      vehicle={vehicle}
                      order={order}
                      downloading={downloadingKey === order.publicCode}
                      onDownload={onDownload}
                    />
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {account.resumen.invoicesCount === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Aún no se emitieron facturas para esta cuenta.</p>
                ) : (
                  allInvoices(account).map((ref) => (
                    <InvoiceRow
                      key={ref.invoice.documentNumber + ref.order.publicCode}
                      item={ref}
                      downloading={downloadingKey === ref.order.publicCode}
                      onDownload={onDownload}
                    />
                  ))
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400 dark:text-slate-500">
        Consulta de solo lectura · Para abonos, facturación o dudas, contactá al taller.
      </p>
    </div>
  );
}