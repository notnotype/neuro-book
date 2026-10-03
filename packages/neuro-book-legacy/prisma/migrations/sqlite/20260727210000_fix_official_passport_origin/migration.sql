-- Passport 上游固定为 NeuroBook 官网：保留官网凭据，丢弃旧自定义站点凭据，并删除可变地址列。
CREATE TABLE "new_PassportCredential" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slotId" TEXT NOT NULL DEFAULT 'default',
    "accountId" INTEGER NOT NULL,
    "accountUsername" TEXT NOT NULL,
    "accountDisplayName" TEXT NOT NULL,
    "scopesJson" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_PassportCredential" (
    "id",
    "slotId",
    "accountId",
    "accountUsername",
    "accountDisplayName",
    "scopesJson",
    "refreshToken",
    "linkedAt",
    "updatedAt"
)
SELECT
    "id",
    "slotId",
    "accountId",
    "accountUsername",
    "accountDisplayName",
    "scopesJson",
    "refreshToken",
    "linkedAt",
    "updatedAt"
FROM "PassportCredential"
WHERE "siteBaseUrl" = 'https://nbook.notnotype.com';

DROP TABLE "PassportCredential";
ALTER TABLE "new_PassportCredential" RENAME TO "PassportCredential";
CREATE UNIQUE INDEX "PassportCredential_slotId_key" ON "PassportCredential"("slotId");
