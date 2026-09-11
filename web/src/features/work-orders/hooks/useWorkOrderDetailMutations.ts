import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../api/client'
import type { WorkOrderLinesMutationResult, WorkOrderPatchResult } from '../../../api/types'
import { queryKeys } from '../../../lib/queryKeys'
import { emitWorkOrderChanged } from '../../../services/workOrderEvents'
import type { WorkOrderPaymentRow } from '../services/workOrdersListApi'

/**
 * Mutaciones de OT en detalle: invalida líneas/pagos/lista y emite el evento global.
 */
export function useWorkOrderDetailMutations(workOrderId: string | undefined) {
  const queryClient = useQueryClient()

  const invalidateWorkOrderCaches = useCallback(async () => {
    if (!workOrderId) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.workOrders.detail(workOrderId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.workOrders.payments(workOrderId) }),
      queryClient.invalidateQueries({ queryKey: [...queryKeys.workOrders.root, 'list'] }),
    ])
    emitWorkOrderChanged(workOrderId)
  }, [queryClient, workOrderId])

  const notify = useCallback(() => {
    void invalidateWorkOrderCaches()
  }, [invalidateWorkOrderCaches])

  /**
   * Mutaciones de líneas: el snapshot viene en la propia respuesta, así que solo se refresca la
   * lista y se avisa al resto de ventanas (sin GET extra del detalle).
   */
  const notifyLines = useCallback(() => {
    if (!workOrderId) return
    void queryClient.invalidateQueries({ queryKey: [...queryKeys.workOrders.root, 'list'] })
    emitWorkOrderChanged(workOrderId)
  }, [queryClient, workOrderId])

  const patchWorkOrder = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      if (!workOrderId) throw new Error('Falta id de orden')
      return api<WorkOrderPatchResult>(`/work-orders/${workOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    },
    onSuccess: notify,
  })

  /** PATCH sin tipar resultado (guardado masivo del formulario principal). */
  const patchWorkOrderPlain = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      if (!workOrderId) throw new Error('Falta id de orden')
      return api(`/work-orders/${workOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    },
    onSuccess: notify,
  })

  const postLine = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
      if (!workOrderId) throw new Error('Falta id de orden')
      return api<WorkOrderLinesMutationResult>(`/work-orders/${workOrderId}/lines`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: notifyLines,
  })

  const deleteLine = useMutation({
    mutationFn: ({ lineId }: { lineId: string }) => {
      if (!workOrderId) throw new Error('Falta id de orden')
      return api<WorkOrderLinesMutationResult>(`/work-orders/${workOrderId}/lines/${lineId}`, {
        method: 'DELETE',
      })
    },
    onSuccess: notifyLines,
  })

  const patchLine = useMutation({
    mutationFn: ({ lineId, body }: { lineId: string; body: Record<string, unknown> }) => {
      if (!workOrderId) throw new Error('Falta id de orden')
      return api<WorkOrderLinesMutationResult>(`/work-orders/${workOrderId}/lines/${lineId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    },
    onSuccess: notifyLines,
  })

  const reopenDelivered = useMutation({
    mutationFn: (body: { justification: string; note: string }) => {
      if (!workOrderId) throw new Error('Falta id de orden')
      return api(`/work-orders/${workOrderId}/reopen-delivered`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },
    onSuccess: notify,
  })

  const recordPayment = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      if (!workOrderId) throw new Error('Falta id de orden')
      return api<{ id: string }>(`/work-orders/${workOrderId}/payments`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },
    onSuccess: notify,
  })

  const deletePayment = useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string }) => {
      if (!workOrderId) throw new Error('Falta id de orden')
      return api<WorkOrderPaymentRow[]>(`/work-orders/${workOrderId}/payments/${paymentId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      })
    },
    onSuccess: notify,
  })

  return {
    patchWorkOrder,
    patchWorkOrderPlain,
    postLine,
    deleteLine,
    patchLine,
    reopenDelivered,
    recordPayment,
    deletePayment,
  }
}
