import {createServer} from "node:net";
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Database} from "bun:sqlite";
import {afterEach, describe, expect, it} from "vitest";
import {assertNativeProductStopped, backupApplicationDatabase} from "#manager/health";

let root: string | null = null;

afterEach(async () => {
    if (root) {
        await rm(root, {recursive: true, force: true});
        root = null;
    }
});

describe("App SQLite备份", () => {
    it("以read-write且禁止create的模式checkpoint并复制已有数据库", async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-manager-health-"));
        const stateRoot = join(root, "state");
        const databasePath = join(stateRoot, "workspace", ".nbook", "neuro-book.sqlite");
        await mkdir(join(stateRoot, "workspace", ".nbook"), {recursive: true});
        const database = new Database(databasePath);
        database.exec("CREATE TABLE marker (value TEXT NOT NULL); INSERT INTO marker VALUES ('preserved');");
        database.close();

        const result = await backupApplicationDatabase(stateRoot, join(root, "backup"));

        expect(result).toMatchObject({
            configuredUrl: "file:./workspace/.nbook/neuro-book.sqlite",
            databasePath,
            backupPath: join(root, "backup", "database", "app.sqlite"),
            checkpoint: {busy: 0, log: -1, checkpointed: -1},
        });
        expect(await readFile(result!.backupPath)).toEqual(await readFile(databasePath));
    });

    it("按State Root配置备份自定义SQLite位置", async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-manager-health-"));
        const stateRoot = join(root, "state");
        const databasePath = join(stateRoot, "custom", "app.sqlite");
        await mkdir(join(stateRoot, "custom"), {recursive: true});
        await writeFile(join(stateRoot, ".env"), "DATABASE_URL=file:./custom/app.sqlite\n", "utf8");
        const database = new Database(databasePath);
        database.exec("CREATE TABLE marker (value TEXT NOT NULL);");
        database.close();

        const result = await backupApplicationDatabase(stateRoot, join(root, "backup"));

        expect(result?.databasePath).toBe(databasePath);
        expect(await readFile(result!.backupPath)).toEqual(await readFile(databasePath));
    });

    it("数据库不存在时返回null且不创建文件", async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-manager-health-"));
        const databasePath = join(root, "state", "workspace", ".nbook", "neuro-book.sqlite");

        await expect(backupApplicationDatabase(join(root, "state"), join(root, "backup"))).resolves.toBeNull();
        await expect(stat(databasePath)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("打开或checkpoint失败时报告备份阶段和数据库路径", async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-manager-health-"));
        const databasePath = join(root, "state", "workspace", ".nbook", "neuro-book.sqlite");
        await mkdir(databasePath, {recursive: true});

        await expect(backupApplicationDatabase(join(root, "state"), join(root, "backup")))
            .rejects.toThrow(`App SQLite备份失败：${databasePath}`);
    });
});

describe("native Product 端口保护", () => {
    it("空 State Root 不把默认 3000 当作本安装的运行实例", async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-manager-health-port-"));
        await expect(assertNativeProductStopped(join(root, "state"))).resolves.toBeUndefined();
    });

    it("已有 State Root 会检查显式配置的端口", async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-manager-health-port-"));
        const stateRoot = join(root, "state");
        const server = createServer();
        await new Promise<void>((resolvePromise, rejectPromise) => {
            server.once("error", rejectPromise);
            server.listen(0, "127.0.0.1", resolvePromise);
        });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("测试服务器没有动态端口。");
        await mkdir(stateRoot, {recursive: true});
        await writeFile(join(stateRoot, ".env"), `NUXT_PORT=${address.port}\n`, "utf8");
        try {
            await expect(assertNativeProductStopped(stateRoot)).rejects.toThrow(`127.0.0.1:${address.port}`);
        } finally {
            await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
        }
    });
});
