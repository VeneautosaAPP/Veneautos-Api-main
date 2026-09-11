import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { portalPath } from "../constants/portalPath";
import { downloadPortalPdf } from "../lib/portalPdf";
import { ClientPortalWindow } from "../features/client-portal/ClientPortalWindow";
import type { ClientPortalAccount, PortalOrder, PortalVehicle } from "../api/types";

function usePrefersColorSchemeDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

export function ClientAccountLookupPage() {
  const prefersDark = usePrefersColorSchemeDark();
  const [plate, setPlate] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ClientPortalAccount | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setResult(null);
    setLoading(true);
    try {
      const data = await api<ClientPortalAccount>("/client-portal/account", {
        method: "POST",
        body: JSON.stringify({
          plate: plate.trim(),
          phone: phone.trim(),
        }),
      });
      setResult(data);
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message);
      } else {
        setErr("No se pudo completar la consulta.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function onDownload(vehicle: PortalVehicle, order: PortalOrder) {
    if (!result) return;
    setDownloadingKey(order.publicCode);
    try {
      await downloadPortalPdf(result, vehicle, order);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo generar el PDF.");
    } finally {
      setDownloadingKey(null);
    }
  }

  return (
    <div className={prefersDark ? "dark" : ""} style={{ colorScheme: prefersDark ? "dark" : "light" }}>
      <div className="va-landing-commercial-brand min-h-dvh bg-[#f8f9fc] text-slate-900 dark:bg-zinc-950 dark:text-zinc-100">
        {result ? (
          <ClientPortalWindow
            account={result}
            downloadingKey={downloadingKey}
            onDownload={(v, o) => void onDownload(v, o)}
            onNewSearch={() => setResult(null)}
          />
        ) : (
          <>
            <nav className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/95 backdrop-blur-md dark:border-zinc-800 dark:bg-black">
              <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <Link to={portalPath("/")} className="inline-flex items-center transition hover:opacity-80" aria-label="Inicio Vene Autos">
                  <img
                    src="/logo_landing.png"
                    alt="Vene Autos"
                    className="h-9 w-auto max-w-[200px] select-none sm:h-10 sm:max-w-[220px]"
                    draggable={false}
                  />
                </Link>
                <div className="flex flex-wrap items-center gap-3 text-xs font-medium tracking-tight text-slate-600 dark:text-slate-300">
                  <Link to={portalPath("/login")} className="transition hover:text-brand-700 dark:hover:text-brand-300">
                    Acceso taller
                  </Link>
                  <Link to={portalPath("/#inicio")} className="transition hover:text-brand-700 dark:hover:text-brand-300">
                    Sitio
                  </Link>
                </div>
              </div>
            </nav>

            <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
              <div className="rounded-2xl border border-slate-200/85 bg-white px-5 py-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:px-7">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-500">Cliente</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-brand-700 dark:text-brand-500 sm:text-4xl">
                  Consultar estado de cuenta
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  Ingresá la placa de uno de tus vehículos y el celular con el que lo registraste en el taller. Verás tus
                  órdenes de trabajo y facturas (consulta de solo lectura). No necesitás cuenta.
                </p>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200/85 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
                <form onSubmit={(e) => void onSubmit(e)} className="space-y-5">
                  <div>
                    <label htmlFor="cc-plate" className="va-label text-xs">
                      Placa del vehículo
                    </label>
                    <input
                      id="cc-plate"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Ej. ABC 123"
                      value={plate}
                      onChange={(e) => setPlate(e.target.value.toUpperCase())}
                      className="va-field mt-2 w-full py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="cc-phone" className="va-label text-xs">
                      Celular / WhatsApp
                    </label>
                    <input
                      id="cc-phone"
                      autoComplete="off"
                      inputMode="tel"
                      spellCheck={false}
                      placeholder="Ej. 300 555 0199"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="va-field mt-2 w-full py-2.5 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="va-btn-primary w-full rounded-lg py-3 text-sm font-semibold tracking-tight disabled:opacity-50 sm:w-auto sm:px-10"
                  >
                    {loading ? "Buscando…" : "Consultar mi cuenta"}
                  </button>
                </form>

                {err ? (
                  <p className="mt-6 va-alert-error" role="alert">
                    {err}
                  </p>
                ) : null}
              </div>
            </main>
          </>
        )}
      </div>
    </div>
  );
}