import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { WorkOrderDetail, WorkOrderLinesMutationResult } from '../../../api/types'
import { queryKeys } from '../../../lib/queryKeys'
import { applyLinesSnapshotToDetail } from '../services/workOrderLinesPresentation'

/**
 * Aplica en el detalle (estado local + caché) el snapshot devuelto por una mutación de líneas,
 * sin disparar un GET de refresco. Mantiene `workOrderId`/`setWo` en undefined/sin orden.
 */
export function useApplyLinesSnapshot(
  workOrderId: string | undefined,
  setWo: React.Dispatch<React.SetStateAction<WorkOrderDetail | null>>,
) {
  const queryClient = useQueryClient()
  return useCallback(
    (snap: WorkOrderLinesMutationResult) => {
      if (!workOrderId) return
      setWo((prev) => {
        if (!prev) return prev
        return applyLinesSnapshotToDetail(prev, snap)
      })
      queryClient.setQueryData<WorkOrderDetail>(queryKeys.workOrders.detail(workOrderId), (prev) =>
        prev ? applyLinesSnapshotToDetail(prev, snap) : prev,
      )
    },
    [queryClient, setWo, workOrderId],
  )
}