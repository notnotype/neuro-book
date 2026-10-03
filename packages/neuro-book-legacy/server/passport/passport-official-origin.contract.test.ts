import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const sourcePaths = {
    constants: fileURLToPath(new URL("../../shared/passport/passport-constants.ts", import.meta.url)),
    dto: fileURLToPath(new URL("../../shared/dto/passport.dto.ts", import.meta.url)),
    schema: fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)),
    sqliteSchema: fileURLToPath(new URL("../../prisma/schema.sqlite.prisma", import.meta.url)),
    client: fileURLToPath(new URL("./passport-client-service.ts", import.meta.url)),
    transport: fileURLToPath(new URL("./official-site-transport.ts", import.meta.url)),
    linkStart: fileURLToPath(new URL("../api/passport/link/start.post.ts", import.meta.url)),
    backupList: fileURLToPath(new URL("../api/passport/backups/index.get.ts", import.meta.url)),
    backupDelete: fileURLToPath(new URL("../api/passport/backups/[id].delete.ts", import.meta.url)),
    backupJobs: fileURLToPath(new URL("../backup/backup-job-manager.ts", import.meta.url)),
    backupRestore: fileURLToPath(new URL("../backup/backup-restore-service.ts", import.meta.url)),
};

describe("official Passport origin contract", () => {
    it("常量、DTO、schema 和客户端不再表达可配置上游", async () => {
        const [constants, dto, schema, sqliteSchema, client, linkStart] = await Promise.all([
            readFile(sourcePaths.constants, "utf8"),
            readFile(sourcePaths.dto, "utf8"),
            readFile(sourcePaths.schema, "utf8"),
            readFile(sourcePaths.sqliteSchema, "utf8"),
            readFile(sourcePaths.client, "utf8"),
            readFile(sourcePaths.linkStart, "utf8"),
        ]);

        expect(constants).toContain("OFFICIAL_PASSPORT_SITE_URL = \"https://nbook.notnotype.com\"");
        expect(constants).not.toContain("DEFAULT_PASSPORT_SITE_URL");
        for (const source of [dto, schema, sqliteSchema, client, linkStart]) {
            expect(source).not.toContain("siteBaseUrl");
        }
        expect(client).toContain("async getAccessToken(): Promise<string>");
        expect(linkStart).not.toContain("readBody");
    });

    it("Passport 与备份调用全部经过固定官网 transport", async () => {
        const [transport, client, backupList, backupDelete, backupJobs, backupRestore] = await Promise.all([
            readFile(sourcePaths.transport, "utf8"),
            readFile(sourcePaths.client, "utf8"),
            readFile(sourcePaths.backupList, "utf8"),
            readFile(sourcePaths.backupDelete, "utf8"),
            readFile(sourcePaths.backupJobs, "utf8"),
            readFile(sourcePaths.backupRestore, "utf8"),
        ]);

        expect(transport).toContain("OFFICIAL_PASSPORT_SITE_URL");
        for (const source of [client, backupList, backupDelete, backupJobs, backupRestore]) {
            expect(source).not.toContain("OFFICIAL_PASSPORT_SITE_URL");
            expect(source).not.toContain("siteBaseUrl");
        }
        expect(client).toContain("officialSiteFetch");
        expect(backupList).toContain("officialSiteFetch");
        expect(backupDelete).toContain("officialSiteFetch");
        expect(backupJobs).toContain("officialSiteFetch");
        expect(backupRestore).toContain("officialSiteResponse");
        expect(backupRestore).toContain("fetchImplementation: RestoreFetch = fetch");
    });
});
