-- CreateTable
CREATE TABLE "client_portal_attempts" (
    "id" TEXT NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "window_start_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_portal_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_portal_attempts_fingerprint_key" ON "client_portal_attempts"("fingerprint");

-- CreateIndex
CREATE INDEX "client_portal_attempts_updated_at_idx" ON "client_portal_attempts"("updated_at");
