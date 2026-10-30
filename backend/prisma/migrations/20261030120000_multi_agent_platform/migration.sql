-- Multi-agent platform: credentials, agent config, audit, subtask workspace fields
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "geminiApiKeyEnc" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "githubTokenEnc" TEXT;

ALTER TABLE "FeatureRun" ADD COLUMN IF NOT EXISTS "verifyReport" JSONB;

ALTER TABLE "SubTask" ADD COLUMN IF NOT EXISTS "workspacePath" TEXT;
ALTER TABLE "SubTask" ADD COLUMN IF NOT EXISTS "jobId" TEXT;

CREATE TABLE IF NOT EXISTS "AgentConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'auto',
    "configJson" JSONB NOT NULL DEFAULT '{}',
    "lastStatus" TEXT NOT NULL DEFAULT 'unknown',
    "lastChecked" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentConfig_userId_provider_key" ON "AgentConfig"("userId", "provider");
CREATE INDEX IF NOT EXISTS "AgentConfig_userId_idx" ON "AgentConfig"("userId");

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "featureRunId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_featureRunId_createdAt_idx" ON "AuditLog"("featureRunId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "SubTask_jobId_idx" ON "SubTask"("jobId");

DO $$ BEGIN
  ALTER TABLE "AgentConfig" ADD CONSTRAINT "AgentConfig_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_featureRunId_fkey"
    FOREIGN KEY ("featureRunId") REFERENCES "FeatureRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
