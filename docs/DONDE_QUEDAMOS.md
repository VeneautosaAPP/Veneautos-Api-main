# DONDE QUEDAMOS — Sesión de trabajo (actualizada: 2026-09-11)

> Fichero de continuidad. Cuando el usuario diga **"revisa DOCS para ver por donde quedamos"**,
> leer este archivo y retomar desde "Siguiente paso".

## Foco actual (pendiente en curso)

### Banner del detalle de OT en escritorio — SESIÓN 2026-09-11 (commiteado y pusheado)

Commit **`cfedd2a`** → push `7916c6c..cfedd2a` a `origin/master`. Archivos: `web/src/pages/WorkOrderDetailPage.tsx`, `web/src/index.css`, `web/src/features/work-orders/components/WorkOrderLineAddPanel.tsx`.

- **Píldoras del banner:** una sola fila en escritorio ratón (≥1280 `and (hover:hover)`), orden `OT → técnico → estado → marca → modelo → km ingreso → ingreso → cierre`; más altas (25px), esquinas 9px, gap 9.5px, texto ~9.5px; la columna izquierda se alinea a **la altura de los subtotales** (`align-items: flex-start` → top 16 = top 16).
- **Hueco invisible eliminado:** en desktop el `<h1>` del título se oculta (`display:none; margin:0`) y se anulan los márgenes `mt`/`pt` internos → el input queda pegado justo bajo las píldoras (gap 0).
- **Input + botón "+ Mano de obra":** el ancho del conjunto iguala el **ancho total de todas las píldoras juntas**, medido dinámicamente en JS (`pillsRowRef` + `useEffect with deps [wo, isDesktop]` + `ResizeObserver` + re-medida en `resize` — el `ResizeObserver` solo no alcanza porque la fila no cambia de caja al llegar los chips con `wo`). El botón queda pegado al extremo derecho, **justo bajo la píldora de fecha**. Input = 50% del conjunto; altura −5% (13.3px / padding 7.6px). Corregido dos veces (350px base hardcodeada → medición dinámica; medición pre-`wo` → deps `[wo]`).
- **Botones de acciones:** labels cortos (Comprobante · WhatsApp · Datos de la orden · Cobrar) y ~10% más pequeños en desktop (`0.78rem`/`1.1rem`, padding `.3125/.625`; `btn-sm` `0.72rem`).
- **Financieros:** montos `1.5rem → 1.35rem` y etiquetas `11px → 9.9px` (solo ≥1280).
- **Sin marco:** banner y listado de líneas sin borde/sombra (global); banner pegado al tope (sticky anclado a `--va-app-header-h`); sin línea divisoria bajo el título del panel.
- **Nodo muerto eliminado:** el bloque `va-wo-pills-desktop` (que nunca era visible en ningún ancho) y su helper `vehicleInfoPillsDesktop()` + reglas CSS.
- **Limpieza por dispositivo** (hook `useMediaQuery` nuevo en la página, `isDesktop`/`isLg`): las píldoras `va-wo-desktop-pills` ahora **solo se renderizan en desktop ratón**; `fin-big` y botones de acciones **solo ≥1024**; resumen compacto `fin-compact` y menú "⋯" **solo <1024**. El DOM ya no monta bloques invisibles de otros rangos.
- **Verificado:** `tsc` + `vite build` limpios; probes de Playwright con réplicas estáticas en 1440/1280/1024/<1024 (alineaciones y ausencia de nodos ocultos). Sin acceso al panel real → falta revisión visual con Ctrl+F5.
- `api-dev.log` y `test-results/` ahora en `.gitignore`.

### Sección «Nómina» (implementada localmente — pendiente de push y deploy)

Nueva sección de menú **Nómina**, semana **lunes–sábado**, para mecánicos:

- **Decisiones acordadas:**
  1. Visibilidad: el **mecánico ve solo su nómina**; **administrador/dueno ven todas**. Permisos nuevos `payroll:read` (sección + propia) y `payroll:read_all` (todas); el servidor filtra por rol.
  2. Qué cuenta: OTs `DELIVERED` con `deliveredAt` ∈ [lunes 00:00, sábado 23:59:59.999] y `cancelledAt: null`.
  3. Base de comisión: líneas `LABOR` **sin IVA** (`taxableBase = ceil(cantidad×valor) − descuento`, `computeLineTotals`). El **% de nómina es por OT** (`WorkOrder.laborCommissionPct`, configurable por el dueño/admin en pantalla, persistido en el servidor; **default 50%**). Total por mecánico = **suma del payable de cada OT** (cada una con su propio %). Rango válido %: 0–100, hasta 2 decimales.
  4. **Una sola calculadora libre** en la parte superior (base + % → monto; o base + monto → %). No hay calculadora por tarjeta.
- **Implementado:**
  - API: `GET /payroll/weekly-summary?from&to` + `PUT /payroll/weekly-summary/ratios/:workOrderId` (`api/src/modules/payroll/`, registrado en `app.module.ts`): 2 queries (OTs entregadas con líneas LABOR + lista de mecánicos), filtra por permisos `payroll:read`/`payroll:read_all`, rango ≤31 días, responde `{ week, rate, isOwnOnly, mechanics:[{ mechanicId, fullName, ordersCount, laborTotal, payable, orders:[{..., laborTotal, commissionPct, payable}] }] }`. El PUT persiste el % (requiere `payroll:read_all`; 403 para el mecánico) con validación 0–100.
  - Migración nueva: `20260910022505_work_order_labor_commission_pct` agrega la columna nullable `labor_commission_pct` a `WorkOrder` (null ⇒ 50). **En prod se aplica a mano con `prisma migrate deploy` sobre la BD (como `cancelled_at`); no requiere re-seed.**
  - `seed.ts`: permisos `payroll:read` + `payroll:read_all` en `PERMISSIONS`/`BACKEND_REQUIRED_PERMISSION_CODES`, rol Mecánico con `payroll:read`, `'payroll'` fuera de `REMOVED_PERMISSION_RESOURCES`. Seed local aplicado.
  - Frontend: `web/src/features/payroll/` (api con `updatePayrollCommissionPct`, caché localStorage con alcance `all`/`own`, hook `usePayrollWeekly` con `queryKeys.payroll.weekly(from,to,readAll)`, calculadora libre, tarjeta por mecánico con % editable por fila + totales en vivo + guardado optimista con debounce 600ms y revert en error), `pages/NominaPage.tsx`, ruta `nomina` (lazy) y ítem de menú `Nómina` con `can('payroll:read')`. En pantalla las tarjetas van en **una sola columna** (una por fila) y las OTs de cada nómina se despliegan/ocultan con un clic en la cabecera.
  - Verificado: `tsc` (api+web), `eslint` (web), curl admin (50→147.500, PUT 60→177.000, 150→400, mecánico→403) y Playwright (calculadora única 1.000.000@10%→100.000 y 600.000/millon→60%; editar % por OT → cambia el pago en vivo, persiste tras recarga, y queda de solo lectura en preview mecánico con su única tarjeta).
- **Estado:** implementado y verificado en local (commits `b356d43` + `9b6bca2` pusheados; cambios de % por OT y calculadora única sin commitear). **Commits pendientes: `feat(payroll)` backend (migración + PUT + % por OT) y frontend (calculadora libre + % editable).** Push y deploy (API Railway: `prisma migrate deploy` + re-seed de permisos; web Vercel) según `DEPLOY-CHECKLIST.md`.

## Pendiente de decisión (previo, sin elegir)

- El usuario pidió que al enviar el comprobante **se abra WhatsApp de escritorio (Desktop)** en vez de WhatsApp Web.
- **Incompatibilidad técnica:** la automatización actual usa `chrome.debugger` (CDP), que **solo controla WhatsApp Web dentro de Chrome**. La app de escritorio de Windows no expone ningún canal que una extensión pueda manejar.
- Se le plantearon 3 opciones al usuario (nada decidido aún):
  1. **Deep link al escritorio (semi-auto):** navegar la pestaña a `whatsapp://send?phone=...&text=...` → Chrome pide "Abrir WhatsApp?" una sola vez → se abre el Desktop con chat y mensaje precargados; el **PDF no se adjunta solo** (se adjunta a mano) y el usuario da Enter.
  2. **Puente nativo (auto completo en el escritorio):** instalar un *native messaging host* en Windows que lance WhatsApp Desktop, adjunte el PDF y envíe solo. Mayor trabajo: script de instalación (registry + exe/bat), más frágil.
  3. **Mantener WhatsApp Web (auto completo):** sin cambios; texto + PDF automáticos.
- El usuario **descartó la pregunta sin elegir** → lo primero al retomar es volver a plantear esta decisión.

## Objetivo general

Implementar el envío del **comprobante de cada OT al cliente por WhatsApp** sin API oficial ("a la antigua"), lo más automatizado posible.

- Decisión previa del usuario: **extensión de Chrome (MV3)** + `chrome.debugger` para envío automático de **texto resumen + PDF adjunto** del comprobante de la OT (documento "letter" interno, **NO** factura electrónica DIAN).
- El envío NO toca bases de datos: solo lectura de datos existentes. Sin migraciones ni permisos nuevos.
- País por defecto para teléfonos: **57** (Colombia, régimen DIAN del taller).
- Riesgo ToS aceptado: automatizar WhatsApp Web puede causar bloqueos temporales del número; se mitiga con bajo volumen, ventana visible y sesión propia.

## Contexto del proyecto

- Repo: `C:\Users\Memohamed\Desktop\vene-autos-api-main` · rama **master** · remote `https://github.com/VeneautosaAPP/Veneautos-Api-main.git`.
- Monorepo con `api/` (NestJS + Prisma/Postgres) y `web/` (Vite + React + TS).
- Regla del usuario: **no alterar datos existentes** (ni locla ni nube).
- Deploy (Vercel) **NO** ejecuta `prisma migrate deploy` (build = `prisma generate && nest build`) → empujar API no altera la BD nube, pero **la migración `20260908201329_work_order_cancelled_at` debe aplicarse a mano en la BD nube** antes de desplegar el API (el service de OTs ya lee/escribe `cancelled_at`).
- BD local: `postgresql://vene:vene@localhost:5432/vene_autos`. API Nest en `PORT=3000`, Vite en `5173` con proxy `/api → localhost:3000`.
- **Git/push:** para pushear se usa el PAT que el usuario aporta al momento, sin guardarlo en disco:
  `git -c credential.helper= push https://VeneautosaAPP:<TOKEN>@github.com/VeneautosaAPP/Veneautos-Api-main.git master`
- Cuentas `gh`: `autopiezastegui-arch` activa pero sin acceso al repo; `VeneautosaAPP` con token inválido en el keyring → no usar `gh`, usar el comando de push de arriba.
- **Tests:** no hay Vitest (conflicto de peer con Vite 8); se corre `npx tsx --test src/lib/<file>.test.ts` (node:test). El tsconfig.app excluye `src/**/*.test.ts` para no romper `tsc`.
- Comandos de verificación (web): `npx tsc --noEmit -p tsconfig.app.json` · `npx eslint <archivos>` · `npm run build` (tsc -b && vite build).

## Trabajo completado

### Sesión anterior — tarjetas de panel y refactor OT (pusheado)
- Tarjeta del panel **«Entregadas este mes»** (1° al último día, `GET /work-orders/monthly-delivered-summary`, rango en el cliente, caché local). `52e739a`
- Refactor detalle OT: **panel de alta de repuestos/mano de obra** movido junto al banner principal, separado del listado (conexión vía ref `WorkOrderLinesHandle` en React 19). `f0cdf74`
- Push `88d6c80..f0cdf74`. **Token de push guardado** en la URL del remote origin (solo `.git/config`, no se commitea); el usuario lo revocará luego. `api-dev.log` y `docs/DONDE_QUEDAMOS.md` quedaron sin versionar (hoy se commitea DONDE_QUEDAMOS por pedido explícito).

### Feature anterior (usuario, panel, sesión, OT) — pusheado
- Usuarios desactivar/reactivar (protege auto-desactivación, confirmación, aviso). `6751eb0`
- Panel principal vacío (se quita acceso rápido/contadores). `1fa6507`
- Sesión sin cierre por inactividad (`idle_timeout_minutes = 0`, rango 0–1440; JWT sigue 12h). `ce56de9`; valor local en BD = `0`.
- OTs `cancelledAt` en lista/detalle + columna `cancelled_at` (migración aditiva). `5b29fb5`
- Menú: Órdenes segundo ítem bajo Inicio; landing tras login/restauración → `/ordenes`. `9493e40`
- Todos pusheados (`b513617..9493e40`).

### Feature WhatsApp — completo, verificado y pusheado
Commit **`e559979`** (push `9493e40..e559979`). Incluye:
- **Extensión `browser-extension/`** (MV3, plain JS, sin build):
  - `manifest.json` — permisos `debugger` + `downloads`; host_permissions: web.whatsapp.com, localhost:5173, 127.0.0.1:5173, `*.vercel.app`; background `src/background.js`; content script `src/content-app.js` en el panel (document_idle). **No** inyecta content script en WhatsApp (usa debugger).
  - `src/content-app.js` — puente página↔worker: escucha `vene:wa:hello`/`vene:wa:send` en `window`, reenvía a background (`chrome.runtime.sendMessage {type:'vene:send'}`), responde `vene:wa:ack {requestId, version}` y hace relay `vene:status` → `vene:wa:status`. Guard `window.__veneWaContentApp`.
  - `src/background.js` — flujo con CDP: abre/reutiliza pestaña web.whatsapp.com, verifica login (`#pane-side`), navega a `/send?phone=<dígitos>`, `DOM.enable`+`DOM.getDocument`, descarga el PDF a Descargas (`chrome.downloads.download` + `search` para la ruta), abre menú adjuntar (`div[data-testid="attach-controller"]`/title/aria), elige `input[type=file]` por `accept:pdf` / texto "documento" / último, `DOM.describeNode(objectId)` → `DOM.setFileInputFiles(files:[ruta])`, caption en el último `div[role="textbox"][contenteditable="true"]`, `Input.insertText`, click `span[data-icon="send"]`, detach al final; avances por `vene:status`. Wrappers con `chrome.runtime.lastError`.
- **`web/src/lib/whatsappPhone.ts`** — `normalizeWhatsAppPhone(raw, '57')` (quita símbolos, respeta `+`/`00`, antepone 57 si falta) + `isValidWhatsAppPhone` (7–15 dígitos).
- **`web/src/lib/whatsappMessage.ts`** — `buildWhatsAppMessage(wo, footer)` (header comprobante, fecha local `dd/mm/aaaa hh:mm`, cliente, patente, estado, hasta 8 líneas `qty× desc — $monto`, contador de ocultas, subtotal/descuento/IVA/total, pagado/saldo, footer), `waMeLink`, `formatCop` (normaliza NBSP), `workOrderStatusLabel`, `shortDate`.
- **`web/src/lib/whatsappPdf.ts`** — `receiptHtmlToPdfDataUrl(html)`: lazy import html2canvas+jspdf, iframe oculto mismo origen, scale 2, slicing multipágina letter (215.9×279.4 mm, margen 10), devuelve `data:application/pdf;base64,...`.
- **`web/src/api/client.ts`** — extraído `fetchAuthenticatedHtml(path)` (JWT por header); `openAuthenticatedHtml` lo usa.
- **`web/src/services/whatsappBridge.ts`** — protocolo en la página: `vene:wa:hello/ack/send/status` (CustomEvents bubbles+composed), `detectWhatsAppExtension(timeout 1200ms)`, `sendWhatsAppViaExtension(options)` timeout 90s. Tipos `WaSendRequest`, `WaStatus`, `WaSendResult`.
- **`web/src/features/work-orders/components/WhatsAppSendModal.tsx`** — teléfono editable (del cliente de la OT), mensaje resumen editable con pie del taller (`GET /settings/ui-context` → `workshopLegalName`; fallback "Vene Autos"), checkbox adjuntar PDF, detecta extensión, fallback `wa.me` manual, estados durante envío.
- **`web/src/pages/WorkOrderDetailPage.tsx`** — botón **"Enviar por WhatsApp"** junto a "Imprimir comprobante" (ver sección de totales, antes del bloque `canPatchWo`); render del modal al final. **El botón se oculta si el cliente no tiene teléfono** (`normalizeWhatsAppPhone(wo.customerPhone ?? wo.vehicle?.customer?.primaryPhone ?? null)` → const `woWaPhone` tras el guard `if (!wo)` ~línea 1081).
- **Deps:** `html2canvas`, `jspdf`, `tsx` (dev). `tsconfig.app.json` ganó `exclude: src/**/*.test.ts`.
- Tests `whatsappMessage.test.ts` + `whatsappPhone.test.ts`: **15/15 pass**. `tsc` + eslint (0 errores) + `npm run build` OK (lazy chunks para pdf libs).

### Cómo se prueba el envío (para retomar si se mantiene web)
1. Web en `http://localhost:5173`; extensión cargada (`chrome://extensions` → modo desarrollador → "Cargar descomprimida" → `browser-extension/`).
2. En otra pestaña de Chrome: `https://web.whatsapp.com` con sesión iniciada (la que usa la extensión).
3. Abrir una OT → botón "Enviar por WhatsApp" → Enviar. (Solo lectura; no toca BD.)
4. Si se prueba en dominio de producción distinto a `*.vercel.app`, agregarlo en `manifest.json` (matches y host_permissions).

## Siguiente paso (al retomar)

0. **Banner OT en escritorio — quedó verificado en réplicas locales y pusheado (`cfedd2a`).** Falta: revisar en el **panel real tras Ctrl+F5** (cambió el hash de CSS/JS) la alineación píldoras↔subtotales, ancho input=ancho de píldoras, botón bajo la píldora de fecha y que en tablet/móvil no aparezca nada de lo de escritorio. Si el usuario pide más ajustes, iterar en `web/src/index.css` (media ≥1280) + flags `isDesktop`/`isLg` en `WorkOrderDetailPage.tsx`.
1. **Pendiente de la sesión anterior (sin commitear ni pushear):** sección **Nómina** — % de comisión por OT + calculadora libre (migración `20260910022505_work_order_labor_commission_pct`, `PUT /payroll/weekly-summary/ratios/:id`, calculadora única, % editable por fila). Desplegar API (Railway: `prisma migrate deploy` a mano + re-seed permisos `payroll:*`) y web (Vercel) según `DEPLOY-CHECKLIST.md`.
2. **Volver a preguntar** al usuario la decisión WhatsApp Desktop vs Web (ver "Pendiente de decisión"); no asumir.
3. Aplicar cambios, correr `tsc`/eslint/tests/build, **commit y push** solo si el usuario lo pide.
4. Nunca tocar BD ni pedir nuevas migraciones para ello.

## Archivos clave

- `browser-extension/manifest.json`, `browser-extension/src/background.js`, `browser-extension/src/content-app.js`
- `web/src/lib/whatsappPhone.ts` (+`.test.ts`), `web/src/lib/whatsappMessage.ts` (+`.test.ts`), `web/src/lib/whatsappPdf.ts`
- `web/src/services/whatsappBridge.ts`
- `web/src/api/client.ts` (`fetchAuthenticatedHtml`)
- `web/src/features/work-orders/components/WhatsAppSendModal.tsx`
- `web/src/pages/WorkOrderDetailPage.tsx` (botón + `woWaPhone` + render modal)
- `DOCS/` (docs manuales existentes: `MANUAL_APP_VENE_AUTOS.md`, `MANUAL_PRODUCCION_PASO_A_PASO.md`, `AUDITORIA_VENE_AUTOS.md`)