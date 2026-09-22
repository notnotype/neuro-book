/**
 * 探针 3（Q5）——试图证伪的声明：
 * "每个目标确认写入后登记进度；失败保留源与已完成进度，下次启动续跑未完成项，不重复导入、不回滚已有目标；
 *  完成标记独立保留、多标签读取同一份；目标删除/分区回收后不重新导入。"
 *
 * 这一组全部走**真实重启路径**：每次"重启"都是一个新建的迁移控制器（新的内存进度表、新的 HTTP 访问），
 * 而不是同一个控制器上 retry。写入失败经 HTTP 请求层注入，等同后端在写动作处返回错误。
 */
import {describe, expect, it} from "vitest";
import {
    WORKBENCH_MIGRATION_COMPLETION_KEY,
    WORKBENCH_MIGRATION_OWNER,
    WORKBENCH_MIGRATION_PROGRESS_KEY,
    type WorkbenchMigrationProgressRecord,
} from "nbook/shared/storage/workbench-migration";
import {WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY, WORKBENCH_SURFACE_SIZES_KEY} from "nbook/shared/storage/workbench-state";
import {createMigrationHarness, type MigrationHarness} from "./probe-harness";

const BUCKET = JSON.stringify({
    leftPanelWidth: 427,
    agentPanelWidth: 488,
    projectPickerLayoutMode: "compact",
    activeLeftTab: "outline",
});

async function dropRecord(harness: MigrationHarness, owner: string, key: string, resource: string | undefined, schemaVersion: number): Promise<void> {
    const read = await harness.read(owner, key, resource);
    await harness.act({
        kind: "remove",
        owner,
        key,
        ...(resource === undefined ? {} : {resource}),
        schemaVersion,
        expected: read.credential,
    });
    await harness.act({
        kind: "reclaim",
        owner,
        key,
        ...(resource === undefined ? {} : {resource}),
        schemaVersion,
        targets: [resource === undefined ? {} : {resource}],
    });
}

async function progressEntries(harness: MigrationHarness): Promise<readonly {target: string; field: string; outcome: string}[]> {
    const read = await harness.read(WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_PROGRESS_KEY);
    if (read.kind !== "value") return [];
    return (read.value as WorkbenchMigrationProgressRecord).entries;
}

describe("探针 3：完成标记与续跑幂等（Q5）", () => {
    it("同一控制器上完成后 retry() 不发任何动作（对照产品用例的等价类）", async () => {
        const harness = await createMigrationHarness();
        try {
            const migration = harness.controller(BUCKET);
            await migration.start();
            expect(migration.snapshot()).toMatchObject({phase: "complete"});

            const mark = harness.mark();
            await migration.retry();
            // retry() 在 phase === "complete" 时直接返回快照：没有读、没有写。
            expect(harness.actions.slice(mark)).toEqual([]);
            expect(migration.snapshot()).toMatchObject({phase: "complete"});
        } finally {
            await harness.close();
        }
    });

    it("目标写入中断后重启：已完成目标不重复写，进度只补未完成项（含已回收目标）", async () => {
        const harness = await createMigrationHarness();
        try {
            // 第一次运行：书架目标写入失败 ⇒ 两个工作面已写并登记，书架未登记。
            harness.failNextSave({owner: WORKBENCH_LAYOUT_OWNER, key: WORKBENCH_SHELF_MODE_KEY, times: 1});
            const first = harness.controller(BUCKET);
            await first.start();

            expect(first.snapshot()).toMatchObject({phase: "blocked", blocked: "import-failed", retryable: true});
            expect(harness.count("save", WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle")).toBe(1);
            expect(harness.count("save", WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "user-assets")).toBe(1);
            expect(harness.count("save", WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY)).toBe(1);
            const entriesAfterFirst = await progressEntries(harness);
            expect(entriesAfterFirst).toHaveLength(4);
            expect(entriesAfterFirst.every((item) => item.outcome === "imported")).toBe(true);
            expect(await harness.recordText(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY)).toBeNull();

            // 重启前：用户把 user-assets 工作面重置，owner 回收墓碑（记录回到从未创建）。
            await dropRecord(harness, WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "user-assets", 1);
            expect(await harness.recordText(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "user-assets")).toBeNull();

            const resumeMark = harness.mark();
            const second = harness.controller(BUCKET);
            await second.start();

            expect(second.snapshot()).toMatchObject({phase: "complete", blocked: null});
            // 续跑只写未完成的书架目标；两个工作面一次都没再被写。
            expect(harness.writesSince(resumeMark).filter((item) => item.key === WORKBENCH_SURFACE_SIZES_KEY)).toHaveLength(0);
            expect(harness.count("save", WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY)).toBe(2);
            expect(await harness.recordText(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY)).toContain("compact");
            expect((await progressEntries(harness)).length).toBe(5);
            // 已回收的目标没有复活。
            expect(await harness.recordText(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "user-assets")).toBeNull();
            // 完成标记只在这一次（第一次运行没写到）写了一次。
            expect(harness.count("save", WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_COMPLETION_KEY)).toBe(1);
        } finally {
            await harness.close();
        }
    });

    it("已有目标与完成后的重置都不被旧值覆盖（另一客户端先写 / 用户重置并回收）", async () => {
        const harness = await createMigrationHarness();
        try {
            // 另一个标签页/客户端先写入目标：idle 尺寸与书架模式已存在，值必须保持权威。
            await harness.act({
                kind: "save",
                owner: WORKBENCH_LAYOUT_OWNER,
                key: WORKBENCH_SURFACE_SIZES_KEY,
                resource: "idle",
                schemaVersion: 1,
                expected: {revision: null, partitionGeneration: 1},
                value: {leftPanelWidth: 300, agentPanelWidth: 320},
            });
            await harness.act({
                kind: "save",
                owner: WORKBENCH_LAYOUT_OWNER,
                key: WORKBENCH_SHELF_MODE_KEY,
                schemaVersion: 1,
                expected: {revision: null, partitionGeneration: 1},
                value: "editorial",
            });

            const mark = harness.mark();
            const first = harness.controller(BUCKET);
            await first.start();

            expect(first.snapshot()).toMatchObject({phase: "complete", blocked: null});
            expect(await harness.recordText(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle")).toContain("300");
            expect(await harness.recordText(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY)).toContain("editorial");
            expect(harness.writesSince(mark).filter((item) => item.resource === "idle")).toHaveLength(0);
            // 迁移没有覆写任何已有目标（书架模式与 idle 工作面都没有被写）。
            expect(harness.count("save", WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY)).toBe(0);
            expect(harness.count("save", WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle")).toBe(0);
            // 只有本来不存在的 user-assets 被条件初始化。
            expect(harness.count("save", WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "user-assets")).toBe(1);
            // 逐目标的事实写在进度记录里：idle 与书架都按目标权威值判定，没有被覆写。
            const perTarget = await progressEntries(harness);
            expect(perTarget).toContainEqual(expect.objectContaining({target: "surface:idle", field: "leftPanelWidth", outcome: "already-present"}));
            expect(perTarget).toContainEqual(expect.objectContaining({target: "shelf-mode", field: "projectPickerLayoutMode", outcome: "already-present"}));
            // 快照里的逐字段结论是**跨目标折叠**的：同一字段在 user-assets 上是 imported，
            // 因此 leftPanelWidth 在快照里报 imported（优先级表把"写入过"排在 already-present 前面）。
            const outcomes = new Map(first.snapshot().fields.map((item) => [item.field, item.outcome]));
            expect(outcomes.get("leftPanelWidth")).toBe("imported");
            expect(outcomes.get("projectPickerLayoutMode")).toBe("already-present");

            // 完成后用户重置并回收目标：完成标记在，重启不得把旧值重新迁入。
            await dropRecord(harness, WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle", 1);
            await dropRecord(harness, WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY, undefined, 1);

            const afterResetMark = harness.mark();
            const second = harness.controller(BUCKET);
            await second.start();

            expect(second.snapshot()).toMatchObject({phase: "complete", blocked: null});
            expect(harness.writesSince(afterResetMark).filter((item) => item.owner === WORKBENCH_LAYOUT_OWNER)).toHaveLength(0);
            expect(await harness.recordText(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle")).toBeNull();
            expect(await harness.recordText(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY)).toBeNull();
            // 完成标记本身也没被改写（读取完成即返回，不再写）。
            expect(harness.count("save", WORKBENCH_MIGRATION_OWNER, WORKBENCH_MIGRATION_COMPLETION_KEY)).toBe(1);
        } finally {
            await harness.close();
        }
    });
});
