import { prisma } from "../db.js";
import { decryptSecret } from "./secrets.js";

export async function getUserLlmKeys(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { openaiApiKeyEnc: true, anthropicApiKeyEnc: true },
  });
  return {
    openaiApiKey: decryptSecret(user?.openaiApiKeyEnc) || null,
    anthropicApiKey: decryptSecret(user?.anthropicApiKeyEnc) || null,
  };
}
