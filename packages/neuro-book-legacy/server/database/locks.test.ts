import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const originalDatabaseKind = process.env.DATABASE_KIND;
const originalDatabaseUrl = process.env.DATABASE_URL;

describe("database locks", () => {
    beforeEach(() => {
        delete process.env.DATABASE_KIND;
        delete process.env.DATABASE_URL;
    });

    afterEach(() => {
        restoreEnv("DATABASE_KIND", originalDatabaseKind);
        restoreEnv("DATABASE_URL", originalDatabaseUrl);
    });

    it("SQLite 通过 DatabaseLock 写入拿到事务写锁", async () => {
        process.env.DATABASE_KIND = "sqlite";
        process.env.DATABASE_URL = "file:./workspace/.nbook/test-lock.sqlite";
        const executor = {$executeRawUnsafe: vi.fn(async () => 1)};
        const {lockDatabaseKey} = await import("nbook/server/database/locks");

        await lockDatabaseKey(executor, 456.2);

        expect(executor.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining(`INSERT INTO "DatabaseLock"`));
        expect(executor.$executeRawUnsafe.mock.calls[0]?.[0]).toContain("456");
    });
});

function restoreEnv(name: "DATABASE_KIND" | "DATABASE_URL", value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}
