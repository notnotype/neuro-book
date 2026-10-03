-- Task 112：Passport 凭据表（账号槽位持有官方站授权；v1 只有 default 槽位）
-- CreateTable
CREATE TABLE "PassportCredential" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slotId" TEXT NOT NULL DEFAULT 'default',
    "siteBaseUrl" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "accountUsername" TEXT NOT NULL,
    "accountDisplayName" TEXT NOT NULL,
    "scopesJson" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "PassportCredential_slotId_key" ON "PassportCredential"("slotId");
