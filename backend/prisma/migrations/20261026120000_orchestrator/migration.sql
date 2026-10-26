-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "githubId" INTEGER NOT NULL,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "scanJson" JSONB,
    "branchName" TEXT,
    "prUrl" TEXT,
    "prNumber" INTEGER,
    "deployUrl" TEXT,
    "testSummary" TEXT,
    "errorMessage" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubTask" (
    "id" TEXT NOT NULL,
    "featureRunId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "generatedPrompt" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "dependsOn" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "logs" TEXT,
    "followUpPrompt" TEXT,
    "resultJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE INDEX "FeatureRun_userId_createdAt_idx" ON "FeatureRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FeatureRun_status_idx" ON "FeatureRun"("status");

-- CreateIndex
CREATE INDEX "FeatureRun_repoFullName_idx" ON "FeatureRun"("repoFullName");

-- CreateIndex
CREATE INDEX "SubTask_featureRunId_orderIndex_idx" ON "SubTask"("featureRunId", "orderIndex");

-- CreateIndex
CREATE INDEX "SubTask_status_idx" ON "SubTask"("status");

-- AddForeignKey
ALTER TABLE "FeatureRun" ADD CONSTRAINT "FeatureRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubTask" ADD CONSTRAINT "SubTask_featureRunId_fkey" FOREIGN KEY ("featureRunId") REFERENCES "FeatureRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill users from existing Task.userId values (GitHub ids as strings), then add FK
INSERT INTO "User" ("id", "githubId", "login", "createdAt", "updatedAt")
SELECT DISTINCT t."userId", CAST(t."userId" AS INTEGER), 'user-' || t."userId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Task" t
WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = t."userId")
ON CONFLICT DO NOTHING;

ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
