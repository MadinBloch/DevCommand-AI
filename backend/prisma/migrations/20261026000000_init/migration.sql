CREATE TABLE "Task" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "repoFullName" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "planJson" JSONB NOT NULL,
  "assignedAgent" TEXT NOT NULL DEFAULT 'unassigned',
  "approvalStatus" TEXT NOT NULL DEFAULT 'not_required',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Task_userId_createdAt_idx" ON "Task"("userId", "createdAt");
CREATE INDEX "Task_repoFullName_idx" ON "Task"("repoFullName");
