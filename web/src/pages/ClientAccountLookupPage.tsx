import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Car, History, Loader2, Phone, ShieldCheck } from "lucide-react";
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

  async function onDownload(_vehicle: PortalVehicle, order: PortalOrder) {
    setDownloadingKey(order.publicCode);
    try {
      await downloadPortalPdf(plate.trim(), phone.trim(), order);
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

            <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
              <div className="grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_70px_-28px_rgba(13,27,62,0.35)] dark:border-zinc-800 dark:bg-zinc-900 lg:grid-cols-[1.05fr_1fr]">
                {/* Panel de marca */}
                <div className="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-[#1c2f66] via-[#141f4a] to-[#0c1436] p-7 text-white dark:from-[#121c40] dark:via-[#0e1736] dark:to-[#0a102b] sm:p-9">
                  {/* Textura sutil de taller */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 opacity-[0.05]"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(45deg, #ffffff 0, #ffffff 1px, transparent 1px, transparent 16px)",
                    }}
                  />
                  <div className="relative">
                    <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-red-200 ring-1 ring-white/20">
                      <Car className="h-3.5 w-3.5" aria-hidden />
                      Portal del cliente · Vene Autos
                    </p>
                    <h1 className="mt-6 font-black leading-tight tracking-tight">
                      <span className="block text-3xl sm:text-4xl">La placa es</span>
                      <span className="block text-3xl italic text-red-400 sm:text-4xl">tu llave.</span>
                    </h1>
                    <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-200 dark:text-slate-300">
                      Ingresá la placa de tu vehículo y el celular con el que lo registraste en el taller: vas a ver el
                      estado de cada orden de trabajo al instante, con sus valores y pagos. Consulta de solo lectura, sin
                      crear cuenta.
                    </p>
                    <ul className="mt-7 space-y-3 text-sm">
                      {[
                        { Icon: Car, text: "Vehículos y el estado de cada orden." },
                        { Icon: History, text: "Historial de trabajos y pagos de tu cuenta." },
                        { Icon: ShieldCheck, text: "Solo lectura: nadie puede modificar tus datos." },
                      ].map(({ Icon, text }) => (
                        <li key={text} className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-red-500 text-white shadow-sm">
                            <Icon className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <span className="text-slate-100">{text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="relative mt-10">
                    <div className="h-px w-full bg-white/15" aria-hidden />
                    <p className="mt-4 text-xs leading-relaxed text-slate-300">
                      ¿Necesitás ayuda? Escribinos por{" "}
                      <span className="font-semibold text-white">WhatsApp</span>: te respondemos en el horario del taller.
                    </p>
                  </div>
                </div>

                {/* Formulario */}
                <div className="bg-white p-7 sm:p-9 dark:bg-[#161a26]">
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-400">
                    Consulta de cuenta
                  </p>
                  <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                    Identificá tu vehículo
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    Placa y celular: los mismos datos con los que atendés tu vehículo en el taller.
                  </p>

                  <form onSubmit={(e) => void onSubmit(e)} className="mt-7 space-y-5">
                    <div>
                      <label htmlFor="cc-plate" className="va-label text-xs">
                        Placa del vehículo
                      </label>
                      <div className="relative mt-2">
                        <input
                          id="cc-plate"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="ABC 123"
                          value={plate}
                          onChange={(e) => setPlate(e.target.value.toUpperCase())}
                          className="w-full rounded-xl border-[3px] border-brand-900 bg-white px-4 py-3 text-center font-mono text-lg font-bold uppercase tracking-[0.32em] text-brand-950 shadow-[0_3px_0_rgba(20,31,74,0.14)] transition placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-300 focus:border-red-500 focus:outline-none focus:ring-4 focus:ring-red-500/20 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-none dark:placeholder:text-slate-500 dark:focus:border-red-400 dark:focus:ring-red-500/25"
                        />
                        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-sans text-[10px] font-bold uppercase tracking-widest text-slate-300 dark:text-slate-500">
                          Colombia
                        </span>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="cc-phone" className="va-label text-xs">
                        Celular / WhatsApp
                      </label>
                      <div className="relative mt-2">
                        <Phone
                          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                          aria-hidden
                        />
                        <input
                          id="cc-phone"
                          type="tel"
                          autoComplete="off"
                          inputMode="tel"
                          spellCheck={false}
                          placeholder="300 555 0199"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="w-full rounded-xl border-[3px] border-brand-900 bg-white py-3 pl-10 pr-4 text-center font-mono text-lg font-bold uppercase tracking-[0.32em] text-brand-950 shadow-[0_3px_0_rgba(20,31,74,0.14)] transition placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-300 focus:border-red-500 focus:outline-none focus:ring-4 focus:ring-red-500/20 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-none dark:placeholder:text-slate-500 dark:focus:border-red-400 dark:focus:ring-red-500/25"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-6 py-3.5 text-base font-semibold text-white shadow-[0_8px_20px_-8px_rgba(185,28,28,0.7)] transition hover:bg-brand-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-red-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:shadow-none dark:focus-visible:ring-offset-[#161a26]"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          Buscando…
                        </>
                      ) : (
                        <>
                          Consultar mi cuenta
                          <ArrowRight
                            className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                            aria-hidden
                          />
                        </>
                      )}
                    </button>
                  </form>

                  {err ? (
                    <p className="mt-6 va-alert-error" role="alert">
                      {err}
                    </p>
                  ) : null}
                </div>
              </div>

              <p className="mt-5 text-center text-xs text-slate-400 dark:text-slate-500">
                Tu consulta es privada: identifica la cuenta solo con la placa y el celular registrados en el taller.
              </p>
            </main>
          </>
        )}
      </div>
    </div>
  );
}