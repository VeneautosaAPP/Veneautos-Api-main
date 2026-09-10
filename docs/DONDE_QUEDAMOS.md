# DONDE QUEDAMOS — Sesión de trabajo (actualizada: 2026-09-09)

> Fichero de continuidad. Cuando el usuario diga **"revisa DOCS para ver por donde quedamos"**,
> leer este archivo y retomar desde "Siguiente paso".

## Foco actual (pendiente en curso)

### Sección «Nómina» (pendiente — plan aprobado, a implementar)

Nueva sección de menú **Nómina**, semana **lunes–sábado**, para mecánicos:

- **Decisiones acordadas:**
  1. Visibilidad: el **mecánico ve solo su nómina**; **administrador/dueno ven todas**. Permisos nuevos `payroll:read` (sección + propia) y `payroll:read_all` (todas); el servidor filtra por rol.
  2. Qué cuenta: OTs `DELIVERED` con `deliveredAt` ∈ [lunes 00:00, sábado 23:59:59.999] y `cancelledAt: null`.
  3. Base de comisión: líneas `LABOR` **sin IVA** (`taxableBase = ceil(cantidad×valor) − descuento`, `computeLineTotals`). Comisión fija **50%** por ahora.
  4. Calculadora de porcentajes **por mecánico (total de la semana) y por OT**: valor COP → % (valor ÷ mano de obra) y % → valor. Ej. base 2.800.000, pagar 1.300.000 → **46,43%**.
- **Pasos planeados:** API `GET /payroll/weekly-summary?from&to` (≤2 queries, índice `[assignedToId, deliveredAt]`, sin tablas nuevas), permisos en `seed.ts` (quitar `'payroll'` de `REMOVED_PERMISSION_RESOURCES`, agregar a `PERMISSIONS` + `BACKEND_REQUIRED_PERMISSION_CODES` + `mecanicoCodes`), frontend `pages/NominaPage.tsx` + `features/payroll/` con caché local (patrón `dashboardCache`), ruta `nomina` + ítem de menú `can('payroll:read')`. Reutilizar `weekCycle.currentWeekDeliveredRange()` (ya es lun–sáb).
- **Estado:** plan aprobado por el usuario (2026-09-09); commit de este pendiente = `docs: pendiente sección Nómina (payroll)`.

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

0. **Implementar la sección «Nómina»** (ver "Foco actual"): backend `payroll` + permisos seed + frontend `NominaPage`/`features/payroll` + ruta `nomina` + menú. Verificar seed/tsc/eslint/curl/Playwright. Luego commit y push.
1. **Volver a preguntar** al usuario la decisión WhatsApp Desktop vs Web (ver "Pendiente de decisión"); no asumir.
2. Según la elección:
   - **Deep link desktop:** modificar `modal`/`background` para abrir `whatsapp://send?phone=<dígitos>&text=<msg codificado>` (sin PDF automático; instrucción de adjuntar manual y dar Enter). Quitar/adaptar el flujo CDP para ese caso. Validar ventana de confirmación de Chrome ("Abrir esta aplicación externa"). Agregar aviso en el modal.
   - **Puente nativo:** crear native messaging host en Windows (registry + script Node/PowerShell) que lance Desktop y simule adjuntar/pegar/enviar; actualizar `whatsappBridge` + modal; script de instalación. Mayor fragilidad.
   - **Mantener web:** sin cambios (ya funciona y está pusheado).
3. Aplicar cambios, correr `tsc`/eslint/tests/build, **commit y push** solo si el usuario lo pide.
4. Nunca tocar BD ni pedir nuevas migraciones para esto.

## Archivos clave

- `browser-extension/manifest.json`, `browser-extension/src/background.js`, `browser-extension/src/content-app.js`
- `web/src/lib/whatsappPhone.ts` (+`.test.ts`), `web/src/lib/whatsappMessage.ts` (+`.test.ts`), `web/src/lib/whatsappPdf.ts`
- `web/src/services/whatsappBridge.ts`
- `web/src/api/client.ts` (`fetchAuthenticatedHtml`)
- `web/src/features/work-orders/components/WhatsAppSendModal.tsx`
- `web/src/pages/WorkOrderDetailPage.tsx` (botón + `woWaPhone` + render modal)
- `DOCS/` (docs manuales existentes: `MANUAL_APP_VENE_AUTOS.md`, `MANUAL_PRODUCCION_PASO_A_PASO.md`, `AUDITORIA_VENE_AUTOS.md`)