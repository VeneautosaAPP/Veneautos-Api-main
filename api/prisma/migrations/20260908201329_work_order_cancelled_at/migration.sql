-- AlterTable
ALTER TABLE "repuestos" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "cancelled_at" TIMESTAMP(3);
