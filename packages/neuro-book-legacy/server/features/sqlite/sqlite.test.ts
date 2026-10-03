/**
 * platform.sqlite 的行为验证：真实 SQLite 文件、真实插件宿主与作用域树。
 *
 * 覆盖 Spec 验收场景 1–11。持久性证据一律取真实文件与重开后的读回；故障注入只用受控驱动包装
 * 真实驱动，验证错误路径（提交应答丢失、驱动失效）。测试只断言调用方可观察的合同：错误 code、
 * 提交结果、关闭结果与读回数据，不 pin 文案。
 */

import {existsSync} from "node:fs";
import {mkdir, rm, symlink, writeFile} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createRuntimeInstance} from "nbook/runtime/lifecycle/lifecycle";
import type {ReleaseDependency, Scope} from "nbook/runtime/lifecycle/lifecycle";
import {createPluginHost} from "nbook/runtime/plugins/plugins";
import type {PluginDefinition} from "nbook/runtime/plugins/plugins";
import {createServiceAssembly} from "nbook/runtime/services/services";

import {SqliteError, createNodeSqliteDriver, createSqlitePlugin, sqliteKey} from "./sqlite";
import type {
    DatabaseBorrow,
    DatabaseResourceDeclaration,
    SqliteConnection,
    SqliteDriver,
    SqliteErrorCode,
    SqliteService,
} from "./sqlite";

const ROOTS: string[] = [];

afterEach(async () => {
    for (const root of ROOTS.splice(0)) {
        await rm(root, {recursive: true, force: true});
    }
});

async function tempRoot(): Promise<string> {
    const root = await createTestTmpRoot("nbook-sqlite", "platform-sqlite");
    ROOTS.push(root);
    return root;
}

function expectCode(run: () => unknown, code: SqliteErrorCode): void {
    let thrown: unknown = null;
    try {
        run();
    } catch (error) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(SqliteError);
    if (thrown instanceof SqliteError) {
        expect(thrown.code).toBe(code);
    }
}

async function expectAsyncCode(run: () => Promise<unknown>, code: SqliteErrorCode): Promise<void> {
    let thrown: unknown = null;
    try {
        await run();
    } catch (error) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(SqliteError);
    if (thrown instanceof SqliteError) {
        expect(thrown.code).toBe(code);
    }
}

interface Harness {
    readonly sqlite: SqliteService;
    /** 数据 owner 作用域：消费者激活作用域；资源登记在这里，依赖服务绑定。 */
    readonly owner: Scope;
    readonly binding: ReleaseDependency;
    readonly root: Scope;
    declare(declaration: DatabaseResourceDeclaration): ReturnType<SqliteService["register"]>;
    close(): ReturnType<Scope["close"]>;
}

/** 真实装配：sqlite 插件 + 声明依赖 sqliteKey 的消费者插件；消费者激活作用域即数据 owner。 */
async function startHarness(driver?: SqliteDriver): Promise<Harness> {
    const instance = createRuntimeInstance({location: "server", instanceId: `sqlite-${randomUUID()}`});
    const assembly = createServiceAssembly(instance, {keys: [sqliteKey]});
    const host = createPluginHost(instance, assembly, {});
    const box: {sqlite: SqliteService | null; owner: Scope | null; binding: ReleaseDependency | null} = {sqlite: null, owner: null, binding: null};
    const consumer: PluginDefinition = {
        id: "owner",
        entries: [{
            id: "main",
            location: "server",
            dependencies: [{key: sqliteKey}],
            activate: async (context) => {
                const resolved = await context.services.resolve(sqliteKey);
                if (resolved.status !== "resolved") {
                    throw new Error("sqlite 未解析");
                }
                box.sqlite = resolved.instance;
                box.binding = resolved.binding.dependency;
                box.owner = context.scope;
                return {services: []};
            },
        }],
    };
    expect(host.register(createSqlitePlugin({driver}), {scope: instance.root}).status).toBe("accepted");
    expect(host.register(consumer, {scope: instance.root}).status).toBe("accepted");
    instance.root.open();
    expect((await host.activate({plugin: "owner", entry: "main"})).status).toBe("activated");
    const {sqlite, owner, binding} = box;
    if (sqlite === null || owner === null || binding === null) {
        throw new Error("消费者未取得 sqlite");
    }
    return {
        sqlite,
        owner,
        binding,
        root: instance.root,
        declare: (declaration) => sqlite.register(declaration, {scope: owner, dependsOn: [binding]}),
        close: () => instance.root.close(),
    };
}

function readWrite(name: string, file: string, create = true): DatabaseResourceDeclaration {
    return {name, location: {path: file}, access: "read-write", create, schemaOwner: "test"};
}

async function withBorrow<T>(harness: Harness, name: string, mode: "read" | "write", use: (borrow: DatabaseBorrow) => T): Promise<T> {
    const scope = harness.owner.createChild(`borrow:${name}`);
    const borrow = await harness.sqlite.resource(name, {scope}).borrow({mode, scope});
    try {
        return use(borrow);
    } finally {
        borrow.release();
        expect((await scope.close()).status).toBe("closed");
    }
}

describe("参数绑定与事务（验收 1–3、7）", () => {
    it("注入样式文本按值绑定、回滚不可见、提交后新实例读回，打开不建表", async () => {
        const root = await tempRoot();
        const file = path.join(root, "app.sqlite");
        const first = await startHarness();
        await first.declare(readWrite("app", file));
        // 验收 7：打开只做探测，不产生任何业务表。
        await withBorrow(first, "app", "read", (borrow) => {
            expect(borrow.query("select name from sqlite_master where type = 'table'")).toEqual([]);
            expectCode(() => borrow.query("select * from notes"), "driver-failed");
        });
        const tricky = "x'); DROP TABLE notes; --\n\"引号\"";
        await withBorrow(first, "app", "write", (borrow) => {
            borrow.execute("create table notes (id integer primary key, body text not null)");
            borrow.execute("insert into notes (body) values (?)", [tricky]);
            borrow.begin();
            borrow.execute("insert into notes (body) values (:body)", {body: "rolled back"});
            borrow.rollback();
            borrow.begin("immediate");
            borrow.execute("insert into notes (body) values (?)", ["committed"]);
            expect(borrow.commit()).toEqual({status: "committed"});
        });
        expect((await first.close()).status).toBe("closed");
        expect(existsSync(file)).toBe(true);

        const second = await startHarness();
        const resource = await second.declare(readWrite("app", file, false));
        expect(resource.generation).toBe(1);
        const rows = await withBorrow(second, "app", "read", (borrow) => borrow.query("select body from notes order by id"));
        expect(rows).toEqual([{body: tricky}, {body: "committed"}]);
        expect((await second.close()).status).toBe("closed");
    });
});

describe("权限与定位（验收 4、10）", () => {
    it("只读拒绝写且数据不变，缺失文件与非法定位不创建文件，同一文件的第二 owner 被拒绝", async () => {
        const root = await tempRoot();
        const file = path.join(root, "data.sqlite");
        const harness = await startHarness();
        await harness.declare(readWrite("data", file));
        await withBorrow(harness, "data", "write", (borrow) => {
            borrow.execute("create table t (v text)");
            borrow.execute("insert into t values (?)", ["one"]);
        });
        await withBorrow(harness, "data", "read", (borrow) => {
            expectCode(() => borrow.execute("insert into t values (?)", ["two"]), "read-only");
            expect(borrow.query("select v from t")).toEqual([{v: "one"}]);
        });

        // 同一物理文件：等价拼写与大小写别名都落到同一身份。
        await expectAsyncCode(() => harness.declare(readWrite("alias", path.join(root, ".", "data.sqlite"))), "file-owned");
        if (process.platform === "win32") {
            await expectAsyncCode(() => harness.declare(readWrite("upper", path.join(root, "DATA.SQLITE"))), "file-owned");
        }
        await expectAsyncCode(() => harness.declare(readWrite("data", path.join(root, "other.sqlite"))), "duplicate-resource");

        const missing = path.join(root, "missing.sqlite");
        await expectAsyncCode(() => harness.declare({...readWrite("ro", missing), access: "read-only"}), "not-found");
        await expectAsyncCode(() => harness.declare(readWrite("nocreate", missing, false)), "not-found");
        await expectAsyncCode(() => harness.declare(readWrite("deep", path.join(root, "absent", "x.sqlite"))), "not-found");
        expect(existsSync(missing)).toBe(false);
        expect(existsSync(path.join(root, "absent"))).toBe(false);

        await expectAsyncCode(() => harness.declare(readWrite("unc", "\\\\server\\share\\x.sqlite")), "invalid-location");
        await expectAsyncCode(() => harness.declare({...readWrite("escape", ""), location: {url: "file:../escape.sqlite", stateRoot: root}}), "invalid-location");
        await expectAsyncCode(() => harness.declare({...readWrite("mem", ""), location: {url: ":memory:", stateRoot: root}}), "invalid-location");
        expect(existsSync(path.join(path.dirname(root), "escape.sqlite"))).toBe(false);
        expectCode(() => harness.sqlite.resource("unregistered", {scope: harness.owner}), "unknown-resource");

        // 两个不同真实文件独立登记与关闭。
        await harness.declare(readWrite("second", path.join(root, "second.sqlite")));
        expect((await harness.close()).status).toBe("closed");
    });

    it("经目录链接别名定位同一文件被拒绝为第二 owner", async (context) => {
        const root = await tempRoot();
        await mkdir(path.join(root, "real"));
        const alias = path.join(root, "alias");
        try {
            await symlink(path.join(root, "real"), alias, process.platform === "win32" ? "junction" : "dir");
        } catch (error) {
            context.skip(`当前环境无法创建目录链接：${String(error)}`);
            return;
        }
        const harness = await startHarness();
        await harness.declare(readWrite("real", path.join(root, "real", "data.sqlite")));
        await expectAsyncCode(() => harness.declare(readWrite("via-link", path.join(alias, "data.sqlite"))), "file-owned");
        expect((await harness.close()).status).toBe("closed");
    });

    it("只读资源拒绝写借用；已登记文件被外部删除后借用明确失败且不建出空库", async () => {
        const root = await tempRoot();
        const file = path.join(root, "gone.sqlite");
        const harness = await startHarness();
        const resource = await harness.declare(readWrite("gone", file));
        const scope = harness.owner.createChild("late");
        await rm(file);
        await expectAsyncCode(() => resource.borrow({mode: "write", scope}), "not-found");
        expect(existsSync(file)).toBe(false);
        await writeFile(path.join(root, "ro.sqlite"), "");
        const readOnly = await harness.declare({...readWrite("ro", path.join(root, "ro.sqlite")), access: "read-only"});
        await expectAsyncCode(() => readOnly.borrow({mode: "write", scope}), "permission-denied");
        expect((await harness.close()).status).toBe("closed");
    });
});

describe("并发与关闭（验收 5、11）", () => {
    it("并发写事务得到明确忙碌，读借用不受影响；未归还借用阻塞关闭，归还后恢复成功", async () => {
        const root = await tempRoot();
        const file = path.join(root, "busy.sqlite");
        const harness = await startHarness();
        const resource = await harness.declare(readWrite("busy", file));
        const scope = harness.owner.createChild("writers");
        const left = await resource.borrow({mode: "write", scope});
        const right = await resource.borrow({mode: "write", scope});
        const reader = await resource.borrow({mode: "read", scope});
        left.execute("create table t (v integer)");
        left.begin("immediate");
        left.execute("insert into t values (1)");
        expectCode(() => right.begin("immediate"), "busy");
        expect(reader.query("select count(*) as n from t")).toEqual([{n: 0}]);
        expect(left.commit()).toEqual({status: "committed"});
        right.begin("immediate");
        right.execute("insert into t values (2)");
        expect(right.commit()).toEqual({status: "committed"});
        right.release();
        right.release();
        expectCode(() => right.query("select 1"), "borrow-released");
        // 另一个借用不因它归还而失效。
        expect(reader.query("select count(*) as n from t")).toEqual([{n: 2}]);

        // 验收 5：未归还借用时 owner 关闭可见失败，不静默强关正在使用的连接。
        const first = await resource.close();
        expect(first).toMatchObject({status: "incomplete", reason: "borrows-outstanding"});
        expect(await resource.close()).toBe(first);
        await expectAsyncCode(() => resource.borrow({mode: "read", scope}), "stopping");
        left.release();
        reader.release();
        expect(await resource.recover()).toMatchObject({status: "closed"});
        expect((await harness.close()).status).toBe("closed");
    });

    it("服务关闭：资源依赖服务绑定时 owner 先收口；更长寿的资源让服务关闭未完成，收口后显式恢复成功", async () => {
        const root = await tempRoot();
        const harness = await startHarness();
        // 登记在根作用域上（比服务更长寿）：服务收口时仍存活，报告关闭未完成。
        const longLived = await harness.sqlite.register(readWrite("root-db", path.join(root, "root.sqlite")), {scope: harness.root});
        const first = await harness.close();
        expect(first.status).toBe("incomplete");
        expect(longLived.state).toBe("closed");
        expect((await harness.root.recover()).status).toBe("closed");
        await expectAsyncCode(() => harness.sqlite.register(readWrite("late", path.join(root, "late.sqlite")), {scope: harness.root}), "closed");
    });
});

describe("代次与跨库（验收 8、9）", () => {
    it("关闭重开产生新代次，旧借用失效且不路由到新连接；ATTACH 被拒绝", async () => {
        const root = await tempRoot();
        const file = path.join(root, "gen.sqlite");
        const other = path.join(root, "other.sqlite");
        const harness = await startHarness();
        const scope = harness.owner.createChild("user");
        const first = await harness.declare(readWrite("gen", file));
        const old = await first.borrow({mode: "write", scope});
        old.execute("create table t (v text)");
        expectCode(() => old.execute(`attach database '${other.replaceAll("'", "''")}' as other`), "cross-database");
        expect(existsSync(other)).toBe(false);
        old.release();
        expect(await first.close()).toMatchObject({status: "closed", generation: 1});

        const second = await harness.declare(readWrite("gen", file));
        expect(second.generation).toBe(2);
        expectCode(() => old.query("select 1"), "stale-generation");
        await expectAsyncCode(() => first.borrow({mode: "read", scope}), "stale-generation");
        expect(harness.sqlite.resource("gen", {scope})).toBe(second);
        expect((await harness.close()).status).toBe("closed");
    });
});

describe("已知失败与结果未知（验收 6、11）", () => {
    it("约束失败按已知失败返回且未提交；提交期间连接失效才是结果未知，借用随即停止使用", async () => {
        const root = await tempRoot();
        const file = path.join(root, "unknown.sqlite");
        const real = createNodeSqliteDriver();
        // 受控驱动：包装真实连接；打开标记后，下一次提交在送达驱动后断开连接再报错（应答丢失）。
        const opened: SqliteConnection[] = [];
        let failNextCommit = false;
        const injecting: SqliteDriver = {
            name: "fault-injection",
            open: (target, options) => {
                const connection = real.open(target, options);
                const wrapped: SqliteConnection = {
                    get path() {
                        return connection.path;
                    },
                    get readOnly() {
                        return connection.readOnly;
                    },
                    get usable() {
                        return connection.usable;
                    },
                    execute: (sql, parameters) => connection.execute(sql, parameters),
                    query: (sql, parameters) => connection.query(sql, parameters),
                    begin: (mode) => connection.begin(mode),
                    commit: () => {
                        connection.commit();
                        if (failNextCommit) {
                            failNextCommit = false;
                            connection.close();
                            throw new Error("connection reset during commit");
                        }
                    },
                    rollback: () => connection.rollback(),
                    denyCrossDatabase: () => connection.denyCrossDatabase(),
                    close: () => connection.close(),
                };
                opened.push(wrapped);
                return wrapped;
            },
        };
        const harness = await startHarness(injecting);
        const resource = await harness.declare(readWrite("u", file));
        const scope = harness.owner.createChild("user");
        const borrow = await resource.borrow({mode: "write", scope});
        borrow.execute("create table t (id integer primary key, v text not null)");
        borrow.begin();
        borrow.execute("insert into t (id, v) values (1, 'a')");
        expect(borrow.commit()).toEqual({status: "committed"});

        // 已知失败：deferred 约束在提交时报告，事务未提交、数据不可见。
        borrow.execute("create table child (pid integer references t(id) deferrable initially deferred)");
        borrow.execute("pragma foreign_keys = on");
        borrow.begin();
        borrow.execute("insert into child (pid) values (99)");
        const known = borrow.commit();
        expect(known.status).toBe("failed");
        if (known.status === "failed") {
            expect(known.error.code).toBe("constraint");
        }
        borrow.rollback();
        expect(borrow.query("select count(*) as n from child")).toEqual([{n: 0}]);

        // 结果未知：提交期间连接失效。
        failNextCommit = true;
        borrow.begin();
        borrow.execute("insert into t (id, v) values (2, 'b')");
        const unknown = borrow.commit();
        expect(unknown.status).toBe("outcome-unknown");
        expectCode(() => borrow.query("select 1"), "driver-failed");
        // 由重新读取判定实际状态（此处提交已落盘）。
        const verify = await resource.borrow({mode: "read", scope});
        expect(verify.query("select v from t order by id")).toEqual([{v: "a"}, {v: "b"}]);
        verify.release();
        borrow.release();
        expect((await harness.close()).status).toBe("closed");
        expect(opened.every((connection) => !connection.usable)).toBe(true);
    });
});

describe("作用域寿命", () => {
    it("资源只对 owner 作用域及其后代可见；owner 作用域不能借用自有资源", async () => {
        const root = await tempRoot();
        await mkdir(path.join(root, "nested"));
        const harness = await startHarness();
        const resource = await harness.declare(readWrite("scoped", path.join(root, "nested", "s.sqlite")));
        expectCode(() => harness.sqlite.resource("scoped", {scope: harness.root}), "unknown-resource");
        await expectAsyncCode(() => resource.borrow({mode: "read", scope: harness.owner}), "permission-denied");
        expect((await harness.close()).status).toBe("closed");
    });
});
