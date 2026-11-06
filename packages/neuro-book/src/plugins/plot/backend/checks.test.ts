/**
 * 存储队列与检查的时序（docs/specs/plot/checks.md 失败表与输出 7）：真实的世界服务、分区库与存储门面，模型按端口替身答题。
 * 经真实模型通道的取消在 `plot.test.ts`；这里测的是模型都答完以后，排队等存储的那一段。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createPartitionOwner} from "nbook/plugins/storage/backend/owner";
import {createPartition} from "nbook/plugins/storage/backend/partition";
import {createStorageFacade} from "nbook/plugins/storage/shared/facade";

import {CheckRecordSchema, SelfReportSchema, type CheckRecord, type SelfReport} from "../shared/checks";
import {InstructionSnapshotSchema, type InstructionSnapshot} from "../shared/instructions";
import {digest, scripted} from "../testing/checks";
import {PlotService} from "../testing/service";
import {chapter} from "../testing/world";
import {createChecks, writeBackRecord} from "./checks";
import {PlotStore} from "./store";

const consumer = {plugin: "nbook.plot", instanceId: "project-1", entry: "project", client: null, location: "project"} as never;

let root = "";
let closers: (() => void | Promise<void>)[] = [];
let sequence = 0;
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-plot-checks", "unit");
});
afterEach(async () => {
    for (const close of closers.reverse()) await close();
    closers = [];
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

async function scene() {
    const name = `s${String(++sequence)}`;
    const world = await PlotService.open(join(root, name, "world"), ["ch1", "ch2", "ch3", "ch4"]);
    closers.push(() => world.stop());
    const owner = createPartitionOwner(createPartition({path: join(root, name, "store.sqlite")}), "project", () => undefined);
    closers.push(() => owner.close());
    const facade = createStorageFacade(consumer, {user: () => ({ok: false, code: "no-project", detail: "测试不用"}), project: () => owner.route(consumer)});
    closers.push(() => facade.release());
    const store = new PlotStore(facade.service, () => undefined);
    const records = store.table<CheckRecord>({key: "plot-check", shape: 1, schema: CheckRecordSchema, contentOf: ({dependencies: _dependencies, points: _points, concerns: _concerns, ...content}) => content});
    const instructions = store.table<InstructionSnapshot>({key: "plot-instruction", shape: 1, schema: InstructionSnapshotSchema});
    const selfReports = store.table<SelfReport>({key: "plot-self-report", shape: 1, schema: SelfReportSchema});
    expect(await store.load()).toBeNull();
    world.texts.set("ch4", "勇者走进客栈。\n");
    world.service.textChanged("ch4");
    await world.change(chapter("ch4"));

    // 真实的队列；只多记一下“检查排上队了”：模型答完之后没有别的可观察状态。
    let enqueued = Promise.withResolvers<void>();
    const observed = {
        queued: <R>(work: () => Promise<R>) => {
            enqueued.resolve();
            return store.queued(work);
        },
        write: store.write.bind(store),
    };
    const stop = new AbortController();
    const checks = createChecks({
        canon: {snapshot: async () => world.service.snapshot()},
        store: observed,
        instructions,
        selfReports,
        checks: records,
        models: scripted().models,
        digest,
        pluginVersion: "test",
        dependenciesOf: () => "deps",
        changed: () => undefined,
        stop: stop.signal,
        warn: () => undefined,
    });
    closers.push(() => checks.release());
    return {
        store,
        records,
        checks,
        stop,
        /** 占住存储队列，直到 `release`；返回时已经轮到它。 */
        async holdQueue() {
            const entered = Promise.withResolvers<void>();
            const gate = Promise.withResolvers<void>();
            const held = store.queued(async () => {
                entered.resolve();
                await gate.promise;
            });
            await entered.promise;
            enqueued = Promise.withResolvers<void>();
            return {
                /** 下一次检查排上了队。 */
                enqueued: enqueued.promise,
                release: async () => {
                    gate.resolve();
                    await held;
                },
            };
        },
    };
}

describe("排队等存储时", () => {
    for (const [name, interrupt] of [
        ["取消", (s: Awaited<ReturnType<typeof scene>>) => s.checks.cancel("ch4")],
        ["入口停止", (s: Awaited<ReturnType<typeof scene>>) => s.stop.abort()],
    ] as const) {
        test(`${name}：这次不存，回 plot-check-cancelled，表里还是上一条`, async () => {
            const s = await scene();
            const first = await s.checks.run("ch4", undefined);
            if (!first.ok) throw new Error(first.code);

            const held = await s.holdQueue();
            const running = s.checks.run("ch4", undefined);
            await held.enqueued;
            interrupt(s);
            await held.release();

            const result = await running;
            expect(result).toMatchObject({ok: false, code: "plot-check-cancelled", kind: "cancelled"});
            expect((result as {usage: {input: number}}).usage.input).toBeGreaterThan(0);
            expect(s.records.get("ch4")).toBe(first.record);
            expect(s.checks.status("ch4")).toMatchObject({running: false, lastFailure: {code: "plot-check-cancelled"}});
        });
    }

    test("排在新检查后面的回写不把新记录换回去；没有新检查时回写生效", async () => {
        const s = await scene();
        const warnings: string[] = [];
        const writeBack = writeBackRecord(s.store, s.records, (event, detail) => warnings.push(`${event} ${detail}`));
        const first = await s.checks.run("ch4", undefined);
        if (!first.ok) throw new Error(first.code);

        // 新检查已经排队，表里还是第一条：这时诊断验证第一条，排上它的回写。
        const held = await s.holdQueue();
        const running = s.checks.run("ch4", undefined);
        await held.enqueued;
        writeBack(first.record, {...first.record, dependencies: "新摘要"});
        await held.release();
        const second = await running;
        if (!second.ok) throw new Error(second.code);
        await s.store.queued(async () => undefined);
        expect(s.records.get("ch4")).toBe(second.record);

        const updated = {...second.record, dependencies: "新摘要"};
        writeBack(second.record, updated);
        await s.store.queued(async () => undefined);
        expect(s.records.get("ch4")).toEqual(updated);
        expect(warnings).toEqual([]);
    });
});
