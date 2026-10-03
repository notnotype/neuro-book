import {readFile, mkdtemp, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createClient} from "@libsql/client";
import {afterEach, describe, expect, it} from "vitest";

const migrationPath = fileURLToPath(new URL("../../prisma/migrations/sqlite/20260727210000_fix_official_passport_origin/migration.sql", import.meta.url));
let fixtureRoot = "";

afterEach(async () => {
    if (fixtureRoot) {
        await rm(fixtureRoot, {recursive: true, force: true}).catch(() => undefined);
        fixtureRoot = "";
    }
});

describe("official Passport origin migration", () => {
    it("只保留官网凭据并删除 siteBaseUrl 列", async () => {
        fixtureRoot = await mkdtemp(testHostPath("nbook-passport-migration-"));
        const databasePath = join(fixtureRoot, "app.sqlite").replaceAll("\\", "/");
        const client = createClient({url: `file:${databasePath}`});
        try {
            await client.executeMultiple(`
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
                CREATE UNIQUE INDEX "PassportCredential_slotId_key" ON "PassportCredential"("slotId");
                INSERT INTO "PassportCredential" (
                    "slotId", "siteBaseUrl", "accountId", "accountUsername", "accountDisplayName", "scopesJson", "refreshToken"
                ) VALUES
                    ('default', 'https://nbook.notnotype.com', 7, 'official', '官网用户', '["backup:read"]', 'official-token'),
                    ('custom', 'https://legacy.invalid', 8, 'custom', '自定义用户', '["backup:read"]', 'custom-token');
            `);

            await client.executeMultiple(await readFile(migrationPath, "utf8"));

            const credentials = await client.execute(`
                SELECT "slotId", "accountUsername", "refreshToken"
                FROM "PassportCredential"
                ORDER BY "slotId"
            `);
            expect(credentials.rows).toEqual([expect.objectContaining({
                slotId: "default",
                accountUsername: "official",
                refreshToken: "official-token",
            })]);

            const columns = await client.execute(`PRAGMA table_info("PassportCredential")`);
            expect(columns.rows.map((row) => row.name)).not.toContain("siteBaseUrl");
            expect(columns.rows.map((row) => row.name)).toContain("refreshToken");

            const indexes = await client.execute(`PRAGMA index_list("PassportCredential")`);
            expect(indexes.rows).toContainEqual(expect.objectContaining({name: "PassportCredential_slotId_key", unique: 1}));
        } finally {
            client.close();
        }
    });
});
