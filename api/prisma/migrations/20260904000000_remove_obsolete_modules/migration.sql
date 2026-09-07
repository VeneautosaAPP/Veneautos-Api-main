-- DropForeignKey
ALTER TABLE "cash_session_reserve_contributions" DROP CONSTRAINT "cash_session_reserve_contributions_cash_session_id_fkey";

-- DropForeignKey
ALTER TABLE "cash_session_reserve_contributions" DROP CONSTRAINT "cash_session_reserve_contributions_reserve_line_id_fkey";

-- DropForeignKey
ALTER TABLE "credit_note_lines" DROP CONSTRAINT "credit_note_lines_credit_note_id_fkey";

-- DropForeignKey
ALTER TABLE "credit_note_lines" DROP CONSTRAINT "credit_note_lines_source_invoice_line_id_fkey";

-- DropForeignKey
ALTER TABLE "credit_notes" DROP CONSTRAINT "credit_notes_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "credit_notes" DROP CONSTRAINT "credit_notes_fiscal_resolution_id_fkey";

-- DropForeignKey
ALTER TABLE "credit_notes" DROP CONSTRAINT "credit_notes_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "employee_credit_lines" DROP CONSTRAINT "employee_credit_lines_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "employee_credit_lines" DROP CONSTRAINT "employee_credit_lines_debtor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "fiscal_resolutions" DROP CONSTRAINT "fiscal_resolutions_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_measurement_unit_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_inventory_item_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_dispatch_events" DROP CONSTRAINT "invoice_dispatch_events_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_dispatch_events" DROP CONSTRAINT "invoice_dispatch_events_requested_by_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_inventory_item_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_service_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_tax_rate_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_fiscal_resolution_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_sale_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_work_order_id_fkey";

-- DropForeignKey
ALTER TABLE "payroll_adjustments" DROP CONSTRAINT "payroll_adjustments_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "payroll_adjustments" DROP CONSTRAINT "payroll_adjustments_payroll_run_id_fkey";

-- DropForeignKey
ALTER TABLE "payroll_run_entries" DROP CONSTRAINT "payroll_run_entries_payroll_run_id_fkey";

-- DropForeignKey
ALTER TABLE "payroll_run_entries" DROP CONSTRAINT "payroll_run_entries_work_order_id_fkey";

-- DropForeignKey
ALTER TABLE "payroll_runs" DROP CONSTRAINT "payroll_runs_cash_movement_id_fkey";

-- DropForeignKey
ALTER TABLE "payroll_runs" DROP CONSTRAINT "payroll_runs_technician_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_receipt_lines" DROP CONSTRAINT "purchase_receipt_lines_inventory_item_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_receipt_lines" DROP CONSTRAINT "purchase_receipt_lines_purchase_receipt_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_receipts" DROP CONSTRAINT "purchase_receipts_received_by_id_fkey";

-- DropForeignKey
ALTER TABLE "quote_lines" DROP CONSTRAINT "quote_lines_inventory_item_id_fkey";

-- DropForeignKey
ALTER TABLE "quote_lines" DROP CONSTRAINT "quote_lines_quote_id_fkey";

-- DropForeignKey
ALTER TABLE "quote_lines" DROP CONSTRAINT "quote_lines_service_id_fkey";

-- DropForeignKey
ALTER TABLE "quote_lines" DROP CONSTRAINT "quote_lines_tax_rate_id_fkey";

-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_vehicle_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_inventory_item_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_sale_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_service_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_tax_rate_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_payments" DROP CONSTRAINT "sale_payments_cash_movement_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_payments" DROP CONSTRAINT "sale_payments_recorded_by_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_payments" DROP CONSTRAINT "sale_payments_sale_id_fkey";

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_origin_work_order_id_fkey";

-- DropForeignKey
ALTER TABLE "services" DROP CONSTRAINT "services_default_tax_rate_id_fkey";

-- DropForeignKey
ALTER TABLE "technician_payroll_configs" DROP CONSTRAINT "technician_payroll_configs_user_id_fkey";

-- DropForeignKey
ALTER TABLE "work_order_lines" DROP CONSTRAINT "work_order_lines_inventory_item_id_fkey";

-- DropForeignKey
ALTER TABLE "work_order_lines" DROP CONSTRAINT "work_order_lines_service_id_fkey";

-- DropForeignKey
ALTER TABLE "workshop_payable_payments" DROP CONSTRAINT "workshop_payable_payments_cash_movement_id_fkey";

-- DropForeignKey
ALTER TABLE "workshop_payable_payments" DROP CONSTRAINT "workshop_payable_payments_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "workshop_payable_payments" DROP CONSTRAINT "workshop_payable_payments_payable_id_fkey";

-- DropForeignKey
ALTER TABLE "workshop_payables" DROP CONSTRAINT "workshop_payables_created_by_id_fkey";

-- DropIndex
DROP INDEX "invoice_lines_inventory_item_id_idx";

-- DropIndex
DROP INDEX "invoice_lines_service_id_idx";

-- DropIndex
DROP INDEX "work_order_lines_service_id_idx";

-- AlterTable
ALTER TABLE "invoice_lines" DROP COLUMN "inventory_item_id",
DROP COLUMN "service_id";

-- AlterTable
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_source_has_ref_ck";

-- AlterTable
ALTER TABLE "invoices" DROP COLUMN "sale_id";

-- AlterTable
ALTER TABLE "work_order_lines" DROP COLUMN "inventory_item_id",
DROP COLUMN "service_id";

-- DropTable
DROP TABLE "cash_session_reserve_contributions";

-- DropTable
DROP TABLE "employee_credit_lines";

-- DropTable
DROP TABLE "inventory_items";

-- DropTable
DROP TABLE "inventory_movements";

-- DropTable
DROP TABLE "measurement_units";

-- DropTable
DROP TABLE "payroll_adjustments";

-- DropTable
DROP TABLE "payroll_run_entries";

-- DropTable
DROP TABLE "payroll_runs";

-- DropTable
DROP TABLE "purchase_receipt_lines";

-- DropTable
DROP TABLE "purchase_receipts";

-- DropTable
DROP TABLE "quote_lines";

-- DropTable
DROP TABLE "quotes";

-- DropTable
DROP TABLE "sale_lines";

-- DropTable
DROP TABLE "sale_payments";

-- DropTable
DROP TABLE "sales";

-- DropTable
DROP TABLE "services";

-- DropTable
DROP TABLE "technician_payroll_configs";

-- DropTable
DROP TABLE "workshop_payable_payments";

-- DropTable
DROP TABLE "workshop_payables";

-- DropTable
DROP TABLE "workshop_reserve_lines";

-- DropEnum
DROP TYPE "QuoteLineType";

-- DropEnum
DROP TYPE "QuoteStatus";

-- CreateTable
CREATE TABLE "ot_line_catalog" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(2000) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ot_line_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ot_line_catalog_label_key" ON "ot_line_catalog"("label");

-- CreateIndex
CREATE INDEX "ot_line_catalog_last_used_at_idx" ON "ot_line_catalog"("last_used_at");

-- AddForeignKey
ALTER TABLE "fiscal_resolutions" ADD CONSTRAINT "fiscal_resolutions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fiscal_resolution_id_fkey" FOREIGN KEY ("fiscal_resolution_id") REFERENCES "fiscal_resolutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_dispatch_events" ADD CONSTRAINT "invoice_dispatch_events_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_dispatch_events" ADD CONSTRAINT "invoice_dispatch_events_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_fiscal_resolution_id_fkey" FOREIGN KEY ("fiscal_resolution_id") REFERENCES "fiscal_resolutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_source_invoice_line_id_fkey" FOREIGN KEY ("source_invoice_line_id") REFERENCES "invoice_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

