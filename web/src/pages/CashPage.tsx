import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, openAuthenticatedHtml } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useCashSessionOpen } from '../context/CashSessionOpenContext'
import { useConfirm } from '../components/confirm/ConfirmProvider'
import { CashCloseSessionModal } from '../components/CashCloseSessionModal'
import { CashOpenSessionModal } from '../components/CashOpenSessionModal'
import { CashSessionMovementsPanel } from '../components/CashSessionMovementsPanel'
import { CashMovementFormPanel } from '../features/cash/CashMovementFormPanel'
import { expenseRequestStatusLabel, sessionStatusEs } from '../features/cash/cashLabels'
import {
  invalidateCashDelegates,
  invalidateCashExpenseRequestLists,
  invalidateCashOperationalState,
} from '../features/cash/invalidateCashQueries'
import { useCashCategories } from '../features/cash/hooks/useCashCategories'
import { useCashCoreData } from '../features/cash/hooks/useCashCoreData'
import { useCashSessionModalDraft } from '../features/cash/hooks/useCashSessionModalDraft'
import type { CashMovementDraftValues, CashTab, ExpenseReq, UserBrief } from '../features/cash/types'
import { ExpenseRequestReviewModal } from '../components/ExpenseRequestReviewModal'
import { TabRow } from '../components/layout/TabRow'
import { usePanelTheme, useUiSettings } from '../theme/PanelThemeProvider'
import { NotesMinCharCounter } from '../components/NotesMinCharCounter'
import {
  notesMinHint,
  panelUsesModernShell,
  parseNotesUiContext,
  SETTINGS_UI_CONTEXT_PATH,
  type SettingsUiContextResponse,
} from '../config/operationalNotes'
import { STALE_OPERATIONAL_MS } from '../constants/queryStaleTime'
import {
  printTicketFromApi,
  successMessageWithDrawerPulse,
  successMessageWithTicketAndPulse,
  triggerCashDrawerPulse,
} from '../services/cashDrawerBridge'
import { cashIncomeCategoryOpensPhysicalDrawer } from '../services/cashIncomePhysicalDrawer'
import {
  API_MONEY_DECIMAL_REGEX,
  formatCopFromString,
  formatMoneyInputDisplayFromNormalized,
  normalizeMoneyDecimalStringForApi,
} from '../utils/copFormat'
import { queryKeys } from '../lib/queryKeys'

export function CashPage() {
  const panelTheme = usePanelTheme()
  const { arqueoAutoprintEnabled } = useUiSettings()
  const isSaasPanel = panelUsesModernShell(panelTheme)
  const pageStackClass = isSaasPanel ? 'space-y-6 sm:space-y-7' : 'space-y-5 sm:space-y-6'
  const surfaceCardClass = isSaasPanel ? 'va-saas-page-section' : 'va-card'
  const narrowFormClass = isSaasPanel ? 'va-saas-page-section space-y-3 sm:max-w-md' : 'va-card space-y-3 sm:max-w-md'
  const { can, user } = useAuth()
  const { open: cashOpen, loadStatus: cashOpenLoadStatus } = useCashSessionOpen()
  const queryClient = useQueryClient()
  /** Operaciones de ingreso/egreso/listados de movimiento solo con sesión abierta (capa global). */
  const isCashOperable = cashOpen === true
  const confirm = useConfirm()
  const [tab, setTab] = useState<CashTab>('sesion')
  const [msg, setMsg] = useState<string | null>(null)
  const [reviewRequestId, setReviewRequestId] = useState<string | null>(null)
  const [notesMin, setNotesMin] = useState(25)

  const canReadSessions = can('cash_sessions:read')
  const { current, sessions } = useCashCoreData(canReadSessions)
  const categories = useCashCategories(canReadSessions)
  const {
    closeSessionModalOpen,
    setCloseSessionModalOpen,
    openSessionModalOpen,
    setOpenSessionModalOpen,
    openAmt,
    setOpenAmt,
    openNote,
    setOpenNote,
    closeCounted,
    setCloseCounted,
    closeDiff,
    setCloseDiff,
  } = useCashSessionModalDraft(tab)
  /** Debajo de `current`: antes estaba arriba y lanzaba TDZ → pantalla Caja en blanco. */
  const showOpenSessionButton =
    can('cash_sessions:open') &&
    current?.status !== 'OPEN' &&
    !(current === undefined && cashOpen === true)

  const [delSel, setDelSel] = useState<Set<string>>(() => new Set())

  const [reqStatus, setReqStatus] = useState<string>('')
  const [reqCat, setReqCat] = useState('')
  const [reqAmt, setReqAmt] = useState('')
  const [reqNote, setReqNote] = useState('')

  const delegatesQuery = useQuery({
    queryKey: queryKeys.cash.delegatesBundle(),
    queryFn: async () => {
      const [u, d] = await Promise.all([
        api<UserBrief[]>('/users'),
        api<{ delegates: { user: { id: string } }[] }>('/cash/delegates').catch(() => ({
          delegates: [] as { user: { id: string } }[],
        })),
      ])
      return { users: u, delegateIds: d.delegates.map((x) => x.user.id) }
    },
    enabled: tab === 'delegados' && can('cash_delegates:manage'),
    staleTime: STALE_OPERATIONAL_MS,
  })

  const expenseRequestsQuery = useQuery({
    queryKey: queryKeys.cash.expenseRequestsList(reqStatus),
    queryFn: async () => {
      const q = reqStatus ? `?status=${encodeURIComponent(reqStatus)}` : ''
      try {
        return await api<ExpenseReq[]>(`/cash/expense-requests${q}`)
      } catch {
        return []
      }
    },
    enabled: tab === 'solicitudes' && can('cash_expense_requests:read'),
    staleTime: STALE_OPERATIONAL_MS,
  })
  const reqList = expenseRequestsQuery.data ?? []

  const openSessionMutation = useMutation({
    mutationFn: (body: { openingAmount: string; note: string }) =>
      api('/cash/sessions/open', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateCashOperationalState(queryClient),
  })

  const closeSessionMutation = useMutation({
    mutationFn: (args: {
      sessionId: string
      closingCounted: string
      differenceNote?: string
    }) =>
      api(`/cash/sessions/${args.sessionId}/close`, {
        method: 'POST',
        body: JSON.stringify({
          closingCounted: args.closingCounted,
          ...(args.differenceNote ? { differenceNote: args.differenceNote } : {}),
        }),
      }),
    onSuccess: () => invalidateCashOperationalState(queryClient),
  })

  const cashMovementMutation = useMutation({
    mutationFn: (args: {
      dir: 'income' | 'expense'
      body: Record<string, unknown>
    }) =>
      api<{ id: string; sessionId: string }>(`/cash/movements/${args.dir}`, {
        method: 'POST',
        body: JSON.stringify(args.body),
      }),
    onSuccess: () => invalidateCashOperationalState(queryClient),
  })

  const saveDelegatesMutation = useMutation({
    mutationFn: (userIds: string[]) =>
      api('/cash/delegates', {
        method: 'PUT',
        body: JSON.stringify({ userIds }),
      }),
    onSuccess: () => invalidateCashDelegates(queryClient),
  })

  const createExpenseRequestMutation = useMutation({
    mutationFn: (body: { categorySlug: string; amount: string; note: string }) =>
      api('/cash/expense-requests', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateCashExpenseRequestLists(queryClient),
  })

  // Inicializar delSel con los delegates del query
  useEffect(() => {
    const d = delegatesQuery.data
    if (!d) return
    setDelSel(new Set(d.delegateIds))
  }, [delegatesQuery.data?.delegateIds])

  // Resetear tab si no es operable y está en una pestaña restringida
  const effectiveTab = useMemo(() => {
    const restricted: CashTab[] = ['ingreso', 'egreso', 'delegados', 'movimientos', 'solicitudes']
    return !isCashOperable && restricted.includes(tab) ? 'sesion' : tab
  }, [tab, isCashOperable])

  // Sincronizar con el tab derivado si cambia
  useEffect(() => {
    if (effectiveTab !== tab) {
      setTab(effectiveTab)
    }
  }, [effectiveTab, tab])

  useEffect(() => {
    void api<SettingsUiContextResponse>(SETTINGS_UI_CONTEXT_PATH)
      .then((r) => setNotesMin(parseNotesUiContext(r).notesMinLengthChars))
      .catch(() => undefined)
  }, [])

  const assertOperationalNote = useCallback((label: string, raw: string): boolean => {
    const t = raw.trim()
    if (t.length < notesMin) {
      setMsg(`${label}: necesitás al menos ${notesMin} caracteres (política del taller en Configuración).`)
      return false
    }
    return true
  }, [notesMin])

  async function openSession(e: React.FormEvent): Promise<boolean> {
    e.preventDefault()
    setMsg(null)
    if (!assertOperationalNote('Nota de apertura de caja', openNote)) return false
    const amtNorm = normalizeMoneyDecimalStringForApi(openAmt)
    if (!amtNorm || !API_MONEY_DECIMAL_REGEX.test(amtNorm)) {
      setMsg(
        'Monto inicial: usá solo números (ej. 500000 o 500000.50). Si pegaste un valor con puntos de miles tipo 1.500.000, se normaliza al guardar; si falla, escribí el número sin separadores de miles.',
      )
      return false
    }
    const amt = amtNorm
    const noteLine = `\nNota: ${openNote.trim()}`
    const msgOpen = `¿Abrir sesión de caja con monto inicial $${formatCopFromString(amt)}?${noteLine}\n\nSolo podrás registrar movimientos con la sesión abierta. Revisá el monto antes de confirmar.`
    const ok = await confirm({
      title: 'Abrir sesión de caja',
      message: msgOpen,
      confirmLabel: 'Abrir sesión',
    })
    if (!ok) return false
    try {
      await openSessionMutation.mutateAsync({
        openingAmount: amtNorm,
        note: openNote.trim(),
      })
      setOpenAmt('0')
      setOpenNote('')
      /**
       * Fase 7.6 · Pulso al cajón físico al abrir la sesión: el cajero necesita depositar
       * el fondo inicial. Si el bridge no está corriendo el helper agrega un hint al mensaje.
       */
      setMsg(await successMessageWithDrawerPulse('Sesión de caja abierta'))
      return true
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
      return false
    }
  }

  /**
   * Fase 7.6 · Abre el modal de cierre y dispara el pulso al cajón físico para que el cajero
   * cuente el efectivo antes de tipear el arqueo. Si el bridge no responde, igual se abre el
   * modal (no queremos bloquear el flujo si la integración local está caída).
   */
  async function onOpenCloseSessionModal() {
    setCloseSessionModalOpen(true)
    try {
      await triggerCashDrawerPulse()
    } catch {
      /* pulso best-effort: el modal ya está abierto y el cajero puede contar igualmente */
    }
  }

  async function closeSession(e: React.FormEvent): Promise<boolean> {
    e.preventDefault()
    if (!current?.id) return false
    setMsg(null)
    const counted = normalizeMoneyDecimalStringForApi(closeCounted)
    if (!counted || !API_MONEY_DECIMAL_REGEX.test(counted)) {
      setMsg(
        'Conteo físico: usá solo números (ej. 1500000 o 1500000.50). Si copiaste del resumen con puntos de miles (1.500.000), se convierten al enviar; si sigue fallando, escribí el valor sin puntos ni comas de miles.',
      )
      return false
    }
    const expectedBal = current.balanceSummary?.expectedBalance
    if (expectedBal != null) {
      const expN = Number(expectedBal)
      const cntN = Number(counted)
      if (Number.isFinite(expN) && Number.isFinite(cntN) && Math.round(expN * 100) !== Math.round(cntN * 100)) {
        if (!assertOperationalNote('Nota de diferencia en arqueo', closeDiff)) return false
      }
    }
    const diffNote = closeDiff.trim()
    const summary = [
      '¿Cerrar la sesión de caja?',
      '',
      `Monto apertura: $${formatCopFromString(current.openingAmount)}`,
      `Conteo físico (arqueo): $${formatCopFromString(counted)}`,
      diffNote ? `Nota de diferencia: ${diffNote}` : '',
      '',
      'El cierre queda registrado. Si el conteo no coincide, aclarálo en la nota antes de confirmar.',
    ]
      .filter(Boolean)
      .join('\n')
    const okClose = await confirm({
      title: 'Cerrar sesión de caja',
      message: summary,
      confirmLabel: 'Cerrar sesión',
    })
    if (!okClose) return false
    const closedSessionId = current.id
    try {
      await closeSessionMutation.mutateAsync({
        sessionId: closedSessionId,
        closingCounted: counted,
        differenceNote: closeDiff.trim() || undefined,
      })
      setMsg(null)
      setCloseCounted('')
      setCloseDiff('')
      /**
       * Fase 7.6 · Si el taller activó `cash.arqueo_autoprint_enabled`, abrimos solito el
       * ticket de arqueo. Si falla (popup bloqueado, bridge caído, etc.), avisamos al cajero
       * y dejamos que use el botón manual "Imprimir arqueo".
       */
      if (arqueoAutoprintEnabled) {
        try {
          await openAuthenticatedHtml(
            `/cash/sessions/${closedSessionId}/receipt?autoprint=1`,
            'Arqueo de caja',
          )
        } catch (printErr) {
          setMsg(
            printErr instanceof Error
              ? `Sesión cerrada, pero falló la impresión automática del arqueo: ${printErr.message}`
              : 'Sesión cerrada, pero falló la impresión automática del arqueo.',
          )
        }
      }
      return true
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
      return false
    }
  }

  /**
   * Fase 7.6 · Botón manual "Imprimir arqueo" del banner de sesión. Abre el ticket en una
   * pestaña nueva; los errores de popup/bridge se reportan en el banner `msg`.
   */
  async function printCashSessionReceipt(sessionId: string) {
    try {
      await openAuthenticatedHtml(
        `/cash/sessions/${sessionId}/receipt?autoprint=1`,
        'Arqueo de caja',
      )
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'No se pudo abrir el arqueo.')
    }
  }

  const submitCashMovement = useCallback(
    async (dir: 'income' | 'expense', draft: CashMovementDraftValues): Promise<boolean> => {
    const { movAck, movNote, movAmt, movTender, movCat, movTwoCopies } = draft
    setMsg(null)
    if (!movAck) {
      setMsg('Marcá la casilla de confirmación abajo: revisaste categoría, importe, efectivo (si aplica) y nota.')
      return false
    }
    if (!assertOperationalNote(dir === 'income' ? 'Nota del ingreso' : 'Nota del egreso', movNote)) return false
    const amt = normalizeMoneyDecimalStringForApi(movAmt)
    if (!amt || !API_MONEY_DECIMAL_REGEX.test(amt)) {
      setMsg(
        'Importe del movimiento: usá solo números (ej. 50000 o 50000.50). Podés quitar puntos de miles si los pegaste del resumen.',
      )
      return false
    }
    const tenRaw = movTender.trim()
    const ten = tenRaw ? normalizeMoneyDecimalStringForApi(movTender) : ''
    if (tenRaw && (!ten || !API_MONEY_DECIMAL_REGEX.test(ten))) {
      setMsg(
        'Efectivo en mano: usá solo números en el mismo formato que el importe (sin puntos de miles o normalizados).',
      )
      return false
    }
    const wantDir = dir === 'income' ? 'INCOME' : 'EXPENSE'
    const catList = categories.filter((c) => c.direction === wantDir)
    const categorySlug = catList.find((c) => c.slug === movCat)?.slug ?? catList[0]?.slug
    if (!categorySlug) {
      setMsg(`No hay categoría de ${dir === 'income' ? 'ingreso' : 'egreso'} disponible. Recargá la página.`)
      return false
    }
    const cat = categories.find((c) => c.slug === categorySlug)
    const catName = cat?.name ?? categorySlug
    const aNum = Number(amt)
    const tNum = Number(ten)
    const vueltoStr =
      ten && !Number.isNaN(aNum) && !Number.isNaN(tNum) && tNum >= aNum ? formatCopFromString(String(tNum - aNum)) : null

    const importeClass =
      dir === 'income'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-rose-600 dark:text-rose-400'

    const okMov = await confirm({
      title: dir === 'income' ? 'Registrar ingreso' : 'Registrar egreso',
      message: (
        <div className="space-y-3 text-left">
          <p className="font-medium text-slate-800 dark:text-slate-100">
            {dir === 'income' ? '¿Registrar INGRESO en caja?' : '¿Registrar EGRESO de caja?'}
          </p>
          <dl className="space-y-2.5 rounded-xl border border-slate-200/90 bg-slate-50/90 p-3.5 dark:border-slate-600 dark:bg-slate-800/60">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">
                Importe en caja
              </dt>
              <dd className={`text-lg font-bold tabular-nums ${importeClass}`}>${formatCopFromString(amt)}</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-slate-200/80 pt-2.5 dark:border-slate-600/80">
              <dt className="text-xs text-slate-500 dark:text-slate-300">Categoría</dt>
              <dd className="text-sm font-medium text-slate-800 dark:text-slate-100">{catName}</dd>
            </div>
            {ten ? (
              <Fragment>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-slate-200/80 pt-2.5 dark:border-slate-600/80">
                  <dt className="text-xs font-medium uppercase tracking-wide text-sky-700/90 dark:text-sky-300/90">
                    Efectivo en mano
                  </dt>
                  <dd className="text-lg font-bold tabular-nums text-sky-600 dark:text-sky-400">${formatCopFromString(ten)}</dd>
                </div>
                {vueltoStr != null && (
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-amber-200/80 pt-2.5 dark:border-amber-900/50">
                    <dt className="text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-100">
                      {dir === 'income' ? 'Vuelto a entregar' : 'Vuelto a caja'}
                    </dt>
                    <dd className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">${vueltoStr}</dd>
                  </div>
                )}
              </Fragment>
            ) : null}
          </dl>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium text-slate-500 dark:text-slate-300">Nota: </span>
            {movNote.trim()}
          </p>
          {dir === 'expense' && (
            <p className="rounded-lg border border-rose-200/80 bg-rose-50/90 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
              El egreso sale del efectivo de la sesión abierta.
            </p>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-300">Quedará registrado en el movimiento de la sesión.</p>
        </div>
      ),
      confirmLabel: dir === 'income' ? 'Registrar ingreso' : 'Registrar egreso',
      variant: dir === 'expense' ? 'danger' : 'default',
    })
    if (!okMov) return false
    try {
      /**
       * Fase 7.7 · Ticket térmico vía puente. Egreso: siempre puede implicar efectivo físico.
       * Ingreso: solo pulsamos cajón si la categoría es efectivo en mostrador (`ingreso_cobro`).
       */
      const created = await cashMovementMutation.mutateAsync({
        dir,
        body: {
          categorySlug,
          amount: amt,
          ...(ten ? { tenderAmount: ten } : {}),
          note: movNote.trim(),
        },
      })
      const successLabel = dir === 'income' ? 'Ingreso registrado' : 'Egreso registrado'
      const ticketPath = `/cash/sessions/${created.sessionId}/movements/${created.id}/receipt-ticket.json`
      const openDrawer =
        dir === 'expense' || cashIncomeCategoryOpensPhysicalDrawer(categorySlug)
      setMsg(
        await successMessageWithTicketAndPulse(ticketPath, successLabel, {
          copies: movTwoCopies ? 2 : 1,
          openDrawer,
        }),
      )
      return true
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
      return false
    }
    },
    [assertOperationalNote, categories, confirm, cashMovementMutation],
  )

  const submitIncomeMovement = useCallback(
    (draft: CashMovementDraftValues) => submitCashMovement('income', draft),
    [submitCashMovement],
  )

  const submitExpenseMovement = useCallback(
    (draft: CashMovementDraftValues) => submitCashMovement('expense', draft),
    [submitCashMovement],
  )

  /**
   * Fase 7.7 · Reimprime el ticket térmico de un movimiento existente (sin abrir cajón).
   * Usado desde el panel de movimientos para repetir un comprobante sin alterar saldos.
   */
  async function reprintMovementTicket(sessionId: string, movementId: string) {
    const res = await printTicketFromApi(
      `/cash/sessions/${sessionId}/movements/${movementId}/receipt-ticket.json`,
      { copies: 1, openDrawer: false },
    )
    setMsg(res.ok ? 'Ticket reimpreso' : `No se pudo imprimir: ${res.hint}`)
  }

  /**
   * Fase 7.7 · Imprime un resumen térmico (58 mm) del arqueo. Es la versión condensada
   * para grapar al efectivo; la versión completa sigue disponible vía PDF Carta.
   */
  async function printCashSessionThermal(sessionId: string) {
    const res = await printTicketFromApi(
      `/cash/sessions/${sessionId}/receipt-ticket.json`,
      { copies: 1, openDrawer: false },
    )
    setMsg(res.ok ? 'Arqueo térmico impreso' : `No se pudo imprimir: ${res.hint}`)
  }

  async function saveDelegates(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    const picked = (delegatesQuery.data?.users ?? []).filter((u) => delSel.has(u.id))
    const names = picked.map((u) => u.fullName).join(', ') || '(ninguno)'
    const okDel = await confirm({
      title: 'Guardar delegados de egreso',
      message: `¿Guardar delegados de egreso?\n\nPersonas seleccionadas (${picked.length}/3): ${names}\n\nSolo ellas podrán registrar egresos directos según la política del taller.`,
      confirmLabel: 'Guardar lista',
    })
    if (!okDel) return
    try {
      await saveDelegatesMutation.mutateAsync([...delSel])
      setMsg('Delegados actualizados')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
    }
  }

  async function createRequest(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    const cat = expenseCats.find((c) => c.slug === reqCat)
    const catName = cat?.name ?? reqCat
    const reqNorm = normalizeMoneyDecimalStringForApi(reqAmt)
    if (!reqNorm || !API_MONEY_DECIMAL_REGEX.test(reqNorm)) {
      setMsg(
        'Monto: solo pesos enteros; podés separar miles con punto (ej. 2.550.356). Si pegás decimales con coma, se sube al entero.',
      )
      return
    }
    const okReq = await confirm({
      title: 'Solicitud de egreso',
      message: `¿Enviar solicitud de egreso?\n\nMonto: $${formatCopFromString(reqNorm || '0')}\nCategoría: ${catName}${reqNote.trim() ? `\nNota: ${reqNote.trim()}` : ''}\n\nUn aprobador deberá revisarla antes de que salga efectivo.`,
      confirmLabel: 'Enviar solicitud',
    })
    if (!okReq) return
    if (!assertOperationalNote('Nota de la solicitud de egreso', reqNote)) return
    try {
      await createExpenseRequestMutation.mutateAsync({
        categorySlug: reqCat,
        amount: reqNorm,
        note: reqNote.trim(),
      })
      setReqAmt('')
      setReqNote('')
      setMsg('Solicitud creada')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error')
    }
  }

  const refreshRequests = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.cash.expenseRequestsRoot() })
  }, [queryClient])

  const allTabs = useMemo(() => [
    { id: 'sesion', label: 'Sesión', show: can('cash_sessions:read') },
    { id: 'ingreso', label: 'Ingreso', show: can('cash_movements:create_income') && isCashOperable },
    { id: 'egreso', label: 'Egreso', show: can('cash_movements:create_expense') && isCashOperable },
    { id: 'delegados', label: 'Delegados', show: can('cash_delegates:manage') && isCashOperable },
    { id: 'movimientos', label: 'Movimientos', show: can('cash_sessions:read') && isCashOperable },
    { id: 'solicitudes', label: 'Solicitudes', show: can('cash_expense_requests:read') && isCashOperable },
  ] as const, [can, isCashOperable])
  
  const tabs = useMemo(() => allTabs.filter((t) => t.show), [allTabs])

  const incomeCats = useMemo(
    () => categories.filter((c) => c.direction === 'INCOME'),
    [categories],
  )
  const expenseCats = useMemo(
    () => categories.filter((c) => c.direction === 'EXPENSE'),
    [categories],
  ) // ✅ React Compiler puede optimizar esto

  const btnPrimary = 'va-btn-primary'
  /** Fondo oscuro: fuerza texto blanco (el texto del padre .va-card en oscuro no debe heredarse). */
  const btnDark = useMemo(() =>
    'va-btn-primary !bg-slate-800 text-white hover:!bg-slate-900 dark:!bg-slate-700 dark:text-white dark:hover:!bg-slate-600',
    [],
  )
  const btnSecondary = 'va-btn-secondary'
  const openSessionBtnClassicClass = useMemo(() =>
    'va-tab-row-stretch-btn bg-gradient-to-b from-emerald-600 to-emerald-700 text-sm font-semibold text-white shadow-md shadow-emerald-900/25 ring-1 ring-emerald-800/30 transition hover:from-emerald-500 hover:to-emerald-600 hover:shadow-lg active:translate-y-px dark:from-emerald-600 dark:to-emerald-800 dark:shadow-emerald-950/40 dark:ring-emerald-500/25 dark:hover:from-emerald-500 dark:hover:to-emerald-700',
    [],
  )

  return (
    <div className={pageStackClass}>
      {cashOpenLoadStatus === 'ready' && cashOpen === false && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          Caja cerrada: no hay ingresos, egresos, movimientos detallados, delegados ni solicitudes hasta que alguien con
          permiso abra sesión.
        </p>
      )}
      {msg && <p className="va-card-muted">{msg}</p>}

      {tabs.length === 0 && cashOpenLoadStatus === 'ready' && (
        <div
          className={`border-amber-200 bg-amber-50/90 dark:border-amber-900/45 dark:bg-amber-950/35 ${surfaceCardClass}`}
        >
          <p className="text-sm text-amber-950 dark:text-amber-100">
            Con la caja cerrada no hay pestañas disponibles para tu perfil aquí. Cuando abran sesión de caja, se
            habilitarán las operaciones que te correspondan.
          </p>
        </div>
      )}

      {can('cash_sessions:read') && (
        <div
          className="va-cash-status-strip"
          data-led={
            current === undefined && cashOpen !== false
              ? 'pending'
              : current != null && current.status === 'OPEN'
                ? 'open'
                : 'closed'
          }
        >
          <span className="relative flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden>
            {current === undefined && cashOpen !== false ? (
              <span className="block h-2.5 w-2.5 animate-pulse rounded-full bg-slate-400/60 ring-1 ring-slate-400/40 dark:bg-slate-600 dark:ring-slate-500/40" />
            ) : current != null && current.status === 'OPEN' ? (
              <>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/40 motion-reduce:animate-none" />
                <span className="relative block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_10px_3px_rgba(34,197,94,0.55)] ring-2 ring-emerald-400/80 motion-reduce:animate-none dark:bg-emerald-400 dark:shadow-[0_0_12px_4px_rgba(74,222,128,0.5)] dark:ring-emerald-300/65" />
              </>
            ) : (
              <span className="block h-2.5 w-2.5 rounded-full bg-slate-400/40 ring-1 ring-inset ring-slate-500/20 dark:bg-slate-700/90 dark:ring-slate-600/50" />
            )}
          </span>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {current === undefined && cashOpen !== false && 'Consultando estado de caja…'}
            {current === undefined && cashOpen === false && 'Sesión cerrada'}
            {current === null && 'Sesión cerrada'}
            {current != null && current.status === 'OPEN' && (
              <>
                Sesión abierta por{' '}
                <span className="font-semibold">
                  {current.openedBy?.fullName?.trim() ||
                    current.openedBy?.email?.trim() ||
                    user?.fullName?.trim() ||
                    user?.email ||
                    '—'}
                </span>
              </>
            )}
            {current != null && current.status !== 'OPEN' && 'Sesión cerrada'}
          </p>
          {current != null && can('cash_sessions:read') && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void printCashSessionThermal(current.id)}
                className="va-btn-secondary text-xs"
                title="Imprime un resumen del arqueo (58 mm) en la térmica para grapar al efectivo."
              >
                Ticket arqueo
              </button>
              <button
                type="button"
                onClick={() => void printCashSessionReceipt(current.id)}
                className="va-btn-secondary text-xs"
                title="Abre el arqueo completo en una pestaña nueva (Carta) para imprimirlo o guardarlo como PDF."
              >
                Arqueo PDF
              </button>
            </div>
          )}
        </div>
      )}

      {tabs.length > 0 && (
        <TabRow
          tablistLabel="Secciones de caja"
          endAction={
            can('cash_sessions:close') && current ? (
              <button
                type="button"
                onClick={() => void onOpenCloseSessionModal()}
                className="va-btn-danger va-tab-row-stretch-btn"
              >
                Cerrar sesión
              </button>
            ) : showOpenSessionButton ? (
              <button
                type="button"
                onClick={() => setOpenSessionModalOpen(true)}
                className={isSaasPanel ? 'va-saas-tab-success-btn' : openSessionBtnClassicClass}
              >
                Abrir sesión
              </button>
            ) : null
          }
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`va-tab ${tab === t.id ? 'va-tab-active' : 'va-tab-inactive'}`}
            >
              {t.label}
            </button>
          ))}
        </TabRow>
      )}

      {tab === 'sesion' && can('cash_sessions:read') && (
        <div className={surfaceCardClass}>
            <h2 className="va-section-title">Estado actual</h2>
            {current === undefined && (cashOpen === null || cashOpen === true) ? (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Cargando…</p>
            ) : null}
            {current === undefined && cashOpen === false ? (
              <p className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-100">
                No hay sesión abierta (estado de caja: cerrada).
              </p>
            ) : null}
            {current === null && (
              <p className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-100">No hay sesión abierta.</p>
            )}
            {current && (
              <>
                {current.balanceSummary && (
                  <div className="va-cash-balance-panel">
                    <p className="va-cash-balance-kicker">
                      Saldo teórico en caja (según registros del sistema)
                    </p>
                    <p className="va-cash-balance-amount">
                      ${formatCopFromString(current.balanceSummary.expectedBalance)}
                    </p>
                    <p className="va-cash-balance-note">
                      Es lo que <strong>debería</strong> haber en efectivo: apertura más todos los ingresos y menos todos
                      los egresos ya cargados en esta sesión. Si al contar billetes no coincide, en el cierre de sesión
                      se registra la diferencia y una nota (arqueo).
                    </p>
                    <dl className="va-cash-balance-stat-grid">
                      <div>
                        <dt>Apertura</dt>
                        <dd>${formatCopFromString(current.openingAmount)}</dd>
                      </div>
                      <div>
                        <dt>Ingresos registrados</dt>
                        <dd>+ ${formatCopFromString(current.balanceSummary.totalIncome)}</dd>
                      </div>
                      <div>
                        <dt>Egresos registrados</dt>
                        <dd>− ${formatCopFromString(current.balanceSummary.totalExpense)}</dd>
                      </div>
                    </dl>
                    <p className="va-cash-balance-foot">
                      Movimientos en esta sesión: {current.balanceSummary.movementCount}
                    </p>
                  </div>
                )}
                <dl className="va-cash-dl-grid">
                  <div className="va-cash-dl-tile">
                    <dt>Estado</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-50">{sessionStatusEs(current.status)}</dd>
                  </div>
                  <div className="va-cash-dl-tile">
                    <dt>Abierta por</dt>
                    <dd>
                      {current.openedBy ? (
                        <>
                          <span className="font-medium">{current.openedBy.fullName}</span>
                          <span className="text-slate-600 dark:text-slate-300"> · {current.openedBy.email}</span>
                        </>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-300">—</span>
                      )}
                    </dd>
                  </div>
                  <div className="va-cash-dl-tile">
                    <dt>Identificador interno</dt>
                    <dd className="break-all font-mono text-[11px] leading-snug sm:text-xs">
                      {current.id}
                    </dd>
                  </div>
                  <div className="va-cash-dl-tile">
                    <dt>Monto de apertura</dt>
                    <dd className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                      ${formatCopFromString(current.openingAmount)}
                    </dd>
                  </div>
                </dl>
              </>
            )}

            <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
              <h3 className="font-semibold text-slate-900 dark:text-slate-50">Últimas sesiones</h3>
              <ul className="mt-1.5 max-h-60 divide-y divide-slate-100 overflow-y-auto text-xs dark:divide-slate-800">
                {sessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex min-h-0 flex-row items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0"
                  >
                    <span className="shrink-0 font-medium text-slate-900 dark:text-slate-100">{sessionStatusEs(s.status)}</span>
                    <span className="min-w-0 flex-1 truncate text-right font-medium tabular-nums text-slate-600 dark:text-slate-300">
                      {new Date(s.openedAt).toLocaleString()}
                    </span>
                    <span className="shrink-0 inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void printCashSessionThermal(s.id)}
                        className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                        title="Imprimir ticket térmico de arqueo (58 mm)"
                      >
                        Ticket
                      </button>
                      <button
                        type="button"
                        onClick={() => void printCashSessionReceipt(s.id)}
                        className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                        title="Abrir arqueo completo (Carta) en pestaña nueva"
                      >
                        PDF
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
        </div>
      )}

      <CashCloseSessionModal
        open={closeSessionModalOpen}
        onClose={() => setCloseSessionModalOpen(false)}
        notesMin={notesMin}
        closeCounted={closeCounted}
        setCloseCounted={setCloseCounted}
        closeDiff={closeDiff}
        setCloseDiff={setCloseDiff}
        onSubmit={async (e) => {
          const ok = await closeSession(e)
          if (ok) setCloseSessionModalOpen(false)
        }}
      />

      <CashOpenSessionModal
        open={openSessionModalOpen}
        onClose={() => setOpenSessionModalOpen(false)}
        notesMin={notesMin}
        openAmt={openAmt}
        setOpenAmt={setOpenAmt}
        openNote={openNote}
        setOpenNote={setOpenNote}
        onSubmit={async (e) => {
          const ok = await openSession(e)
          if (ok) setOpenSessionModalOpen(false)
        }}
      />

      {tab === 'movimientos' && can('cash_sessions:read') && isCashOperable && (
        <CashSessionMovementsPanel
          current={current}
          onReprintMovement={
            current?.id
              ? (movementId) => void reprintMovementTicket(current.id, movementId)
              : undefined
          }
        />
      )}

      {tab === 'ingreso' && can('cash_movements:create_income') && isCashOperable && (
        <CashMovementFormPanel
          direction="income"
          categories={incomeCats}
          notesMin={notesMin}
          narrowFormClass={narrowFormClass}
          submitButtonClass={btnPrimary}
          onSubmit={submitIncomeMovement}
        />
      )}

      {tab === 'egreso' && can('cash_movements:create_expense') && isCashOperable && (
        <CashMovementFormPanel
          direction="expense"
          categories={expenseCats}
          notesMin={notesMin}
          narrowFormClass={narrowFormClass}
          submitButtonClass={btnDark}
          onSubmit={submitExpenseMovement}
        />
      )}

      {tab === 'delegados' && can('cash_delegates:manage') && isCashOperable && (
        <form onSubmit={saveDelegates} className={surfaceCardClass}>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">Delegados de egreso (máx. 3)</h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            Solo estas personas pueden registrar egresos directos, según la política del taller.
          </p>
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-xl border border-slate-100 p-2 dark:border-slate-800">
            {(delegatesQuery.data?.users ?? []).map((u) => (
              <label
                key={u.id}
                className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/80"
              >
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-slate-300 text-brand-600 dark:border-slate-500"
                  checked={delSel.has(u.id)}
                  onChange={() => {
                    setDelSel((prev) => {
                      const n = new Set(prev)
                      if (n.has(u.id)) n.delete(u.id)
                      else if (n.size < 3) n.add(u.id)
                      return n
                    })
                  }}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{u.fullName}</span>
                  <span className="truncate text-xs text-slate-500 dark:text-slate-300">{u.email}</span>
                </span>
              </label>
            ))}
          </div>
          <button type="submit" className={`${btnPrimary} mt-4`}>
            Guardar lista
          </button>
        </form>
      )}

      {tab === 'solicitudes' && can('cash_expense_requests:read') && isCashOperable && (
        <div className="space-y-5">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            Para aprobar o rechazar una solicitud pendiente, usá <strong>Ver detalle</strong>. Aprobar solo
            autoriza el egreso; el cajero registra el efectivo en el mismo detalle cuando tenga sesión abierta.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="block min-w-0 flex-1 sm:max-w-xs">
              <span className="va-label">Filtrar por estado</span>
              <select value={reqStatus} onChange={(e) => setReqStatus(e.target.value)} className="va-field">
                <option value="">Todos</option>
                <option value="PENDING">Pendiente</option>
                <option value="APPROVED">Aprobada</option>
                <option value="REJECTED">Rechazada</option>
                <option value="CANCELLED">Cancelada</option>
                <option value="EXPIRED">Expirada</option>
              </select>
            </label>
            <button type="button" onClick={() => void refreshRequests()} className={btnSecondary}>
              Refrescar lista
            </button>
          </div>

          {can('cash_expense_requests:create') && (
            <form
              onSubmit={createRequest}
              className={isSaasPanel ? 'va-saas-page-section sm:max-w-md' : 'va-card space-y-3 sm:max-w-md'}
            >
              <h2 className="font-semibold text-slate-900 dark:text-slate-50">Nueva solicitud de egreso</h2>
              <select value={reqCat} onChange={(e) => setReqCat(e.target.value)} className="va-field" required>
                <option value="">Elegí categoría…</option>
                {expenseCats.map((c) => (
                  <option key={c.id} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                required
                inputMode="decimal"
                autoComplete="off"
                placeholder="Monto"
                value={formatMoneyInputDisplayFromNormalized(normalizeMoneyDecimalStringForApi(reqAmt))}
                onChange={(e) => setReqAmt(normalizeMoneyDecimalStringForApi(e.target.value))}
                className="va-field mt-0"
              />
              <textarea
                required
                rows={2}
                placeholder="Motivo y detalle del egreso solicitado"
                value={reqNote}
                onChange={(e) => setReqNote(e.target.value)}
                className="va-field mt-0 resize-y"
              />
              <p className="text-xs text-slate-500 dark:text-slate-300">{notesMinHint(notesMin)}</p>
              <NotesMinCharCounter value={reqNote} minLength={notesMin} />
              <button type="submit" className={btnPrimary}>
                Enviar solicitud
              </button>
            </form>
          )}

          {reqList.length === 0 ? (
            <p
              className={
                isSaasPanel
                  ? 'rounded-xl border border-dashed border-slate-200/90 bg-[var(--va-surface-elevated)] px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300'
                  : 'rounded-xl border border-dashed border-slate-200 bg-slate-50/90 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300'
              }
            >
              No hay solicitudes para mostrar con el filtro actual. Si acabás de abrir esta pestaña, probá{' '}
              <strong>Refrescar lista</strong>.
            </p>
          ) : (
            <>
              <div className="grid gap-3 md:hidden">
                {reqList.map((r) => (
                  <div
                    key={r.id}
                    className={isSaasPanel ? 'va-saas-page-section !space-y-0' : 'va-card !p-4'}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-300">
                          {new Date(r.createdAt).toLocaleString()}
                        </p>
                        <p className="mt-1 font-semibold text-slate-900 dark:text-slate-50">{r.category.name}</p>
                        <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">
                          ${formatCopFromString(r.amount)}
                        </p>
                        {r.requestedBy && (
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                            Solicita:{' '}
                            <span className="font-medium text-slate-800 dark:text-slate-200">{r.requestedBy.fullName}</span>
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                        {expenseRequestStatusLabel(r)}
                        {r.status === 'PENDING' && r.isExpired && ' · vencida'}
                      </span>
                    </div>
                    {r.note && (
                      <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{r.note}</p>
                    )}
                    <button
                      type="button"
                      className={`${btnSecondary} mt-3 w-full border-brand-200 text-brand-800 dark:border-brand-700 dark:text-brand-100`}
                      onClick={() => setReviewRequestId(r.id)}
                    >
                      Ver detalle
                    </button>
                  </div>
                ))}
              </div>

              <div
                className={
                  isSaasPanel
                    ? 'va-saas-page-section va-saas-page-section--flush hidden md:block'
                    : 'va-card-flush hidden md:block'
                }
              >
                <div className="va-table-scroll">
                  <table className="va-table min-w-[520px]">
                    <thead>
                      <tr className="va-table-head-row">
                        <th className="va-table-th">Fecha</th>
                        <th className="va-table-th">Solicita</th>
                        <th className="va-table-th">Estado</th>
                        <th className="va-table-th">Monto</th>
                        <th className="va-table-th"> </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reqList.map((r) => (
                        <tr key={r.id} className="va-table-body-row">
                          <td className="va-table-td whitespace-nowrap font-mono text-xs text-slate-600 dark:text-slate-300">
                            {new Date(r.createdAt).toLocaleString()}
                          </td>
                          <td className="va-table-td max-w-[10rem] truncate text-sm text-slate-800 dark:text-slate-200">
                            {r.requestedBy?.fullName ?? '—'}
                          </td>
                          <td className="va-table-td font-medium text-slate-900 dark:text-slate-100">
                            {expenseRequestStatusLabel(r)}
                            {r.status === 'PENDING' && r.isExpired && (
                              <span className="ml-1 text-xs font-normal text-amber-700 dark:text-amber-300">(vencida)</span>
                            )}
                          </td>
                          <td className="va-table-td tabular-nums text-slate-900 dark:text-slate-50">
                            ${formatCopFromString(r.amount)}
                          </td>
                          <td className="va-table-td">
                            <button
                              type="button"
                              className="text-xs font-semibold text-brand-700 underline dark:text-brand-300"
                              onClick={() => setReviewRequestId(r.id)}
                            >
                              Ver detalle
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <ExpenseRequestReviewModal
        requestId={reviewRequestId}
        open={reviewRequestId !== null}
        notesMinLength={notesMin}
        currentUserId={user?.id}
        canApprove={can('cash_expense_requests:approve')}
        canReject={can('cash_expense_requests:reject')}
        canCancel={can('cash_expense_requests:cancel')}
        canPayOut={can('cash_movements:create_expense')}
        onClose={() => setReviewRequestId(null)}
        onDone={() => {
          void invalidateCashExpenseRequestLists(queryClient)
          void invalidateCashOperationalState(queryClient)
        }}
        setBanner={setMsg}
      />
    </div>
  )
}
