import { prisma } from "../db.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

export async function getUserLlmKeys(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { openaiApiKeyEnc: true, anthropicApiKeyEnc: true, geminiApiKeyEnc: true },
  });
  return {
    openaiApiKey: decryptSecret(user?.openaiApiKeyEnc) || null,
    anthropicApiKey: decryptSecret(user?.anthropicApiKeyEnc) || null,
    geminiApiKey: decryptSecret(user?.geminiApiKeyEnc) || null,
  };
}

export async function persistGithubToken(userId: string, token: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { githubTokenEnc: encryptSecret(token) },
  });
}

export async function getPersistedGithubToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubTokenEnc: true },
  });
  return decryptSecret(user?.githubTokenEnc) || null;
}
