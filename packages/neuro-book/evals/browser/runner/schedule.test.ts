import {describe, expect, test} from "bun:test";

import {TASKS} from "../tasks/index";
import {MODELS} from "./models";
import type {ModelChoice} from "./models";
import {runPool} from "./schedule";
import type {Cell, CellResult, PoolLimits} from "./schedule";

const [luna, hydrogen, neon] = MODELS as [ModelChoice, ModelChoice, ModelChoice];

function cell(model: ModelChoice, attempt: number): Cell {
    return {task: TASKS[0] as Cell["task"], model, arm: "browser-use", attempt};
}

/**
 * 由测试决定每格何时跑完的执行者。池子派格是同步的（派到上限才 await），
 * 所以 `started(n)` 交回时，这一轮该派的都已经派完，可以直接断言没有多派。
 */
function controlledRun() {
    const starts: Cell[] = [];
    const pending = new Map<Cell, {resolve(result: CellResult): void; reject(error: Error): void}>();
    let waiters: Array<() => void> = [];
    let peakTotal = 0;
    const peakByProvider = new Map<string, number>();
    const run = (target: Cell) => new Promise<CellResult>((resolve, reject) => {
        starts.push(target);
        pending.set(target, {resolve, reject});
        peakTotal = Math.max(peakTotal, pending.size);
        const sameProvider = [...pending.keys()].filter((other) => other.model.provider === target.model.provider).length;
        peakByProvider.set(target.model.provider, Math.max(peakByProvider.get(target.model.provider) ?? 0, sameProvider));
        for (const wake of waiters.splice(0)) wake();
    });
    const finish = (target: Cell, result: CellResult = {state: "settled", inputTokens: 0}) => {
        const entry = pending.get(target);
        if (entry === undefined) throw new Error("cell is not running");
        pending.delete(target);
        entry.resolve(result);
    };
    const fail = (target: Cell) => {
        const entry = pending.get(target);
        if (entry === undefined) throw new Error("cell is not running");
        pending.delete(target);
        entry.reject(new Error("record write failed"));
    };
    const started = async (count: number) => {
        while (starts.length < count) await new Promise<void>((wake) => waiters.push(wake));
        waiters = [];
    };
    return {run, finish, fail, started, starts, peaks: () => ({total: peakTotal, byProvider: Object.fromEntries(peakByProvider)})};
}

function limits(overrides: Partial<PoolLimits> = {}): PoolLimits & {logs: string[]} {
    const logs: string[] = [];
    return {concurrency: 3, providerLimits: {extremelycat: 1}, maxTotalInputTokens: null, log: (message) => logs.push(message), logs, ...overrides};
}

describe("派格", () => {
    test("总并发与每个上游的并发都不超上限；Gemini 满了时排在后面的 luna 先走，Gemini 空出来才派下一个 Gemini", async () => {
        const a = cell(hydrogen, 1), b = cell(neon, 1), c = cell(hydrogen, 2), d = cell(luna, 1), e = cell(luna, 2);
        const runner = controlledRun();
        const summary = runPool([a, b, c, d, e], limits(), runner.run);

        await runner.started(3);
        expect(runner.starts).toEqual([a, d, e]);
        runner.finish(a);
        await runner.started(4);
        expect(runner.starts).toEqual([a, d, e, b]);
        runner.finish(d);
        runner.finish(b);
        await runner.started(5);
        expect(runner.starts.at(-1)).toBe(c);
        runner.finish(e);
        runner.finish(c);

        expect(await summary).toMatchObject({settled: 5, exhausted: 0, skipped: 0, failed: 0, notStarted: 0, stoppedBy: null});
        expect(runner.peaks()).toEqual({total: 3, byProvider: {extremelycat: 1, "luna-relay": 2}});
    });

    test("总输入超过止损线后不再派新的格，已在跑的收完；没派出去的记作 notStarted", async () => {
        const cells = [1, 2, 3, 4].map((attempt) => cell(luna, attempt));
        const runner = controlledRun();
        const options = limits({concurrency: 2, maxTotalInputTokens: 100});
        const summary = runPool(cells, options, runner.run);

        await runner.started(2);
        runner.finish(cells[0] as Cell, {state: "settled", inputTokens: 150});
        runner.finish(cells[1] as Cell, {state: "exhausted", inputTokens: 10});

        expect(await summary).toEqual({settled: 1, exhausted: 1, skipped: 0, failed: 0, notStarted: 2, stoppedBy: "budget", totalInputTokens: 160});
        expect(runner.starts).toEqual(cells.slice(0, 2));
        expect(options.logs.some((line) => line.startsWith("stop: 150 input tokens > 100"))).toBe(true);
    });

    test("一格抛错记作 failed 并写日志，不影响后面的格；续跑时早先跑完的格记作 skipped", async () => {
        const cells = [1, 2, 3].map((attempt) => cell(luna, attempt));
        const runner = controlledRun();
        const options = limits({concurrency: 1});
        const summary = runPool(cells, options, runner.run);

        await runner.started(1);
        runner.fail(cells[0] as Cell);
        await runner.started(2);
        runner.finish(cells[1] as Cell, {state: "skipped", inputTokens: 0});
        await runner.started(3);
        runner.finish(cells[2] as Cell, {state: "settled", inputTokens: 5});

        expect(await summary).toEqual({settled: 1, exhausted: 0, skipped: 1, failed: 1, notStarted: 0, stoppedBy: null, totalInputTokens: 5});
        expect(options.logs.some((line) => line.startsWith(`cell ${TASKS[0]?.id} luna a1 failed`) && line.includes("record write failed"))).toBe(true);
    });
    test("连着 3 格跑满还不计分（上游多半整体出了问题）就停派；中间有一格计分了就重新数", async () => {
        const cells = [1, 2, 3, 4, 5, 6, 7].map((attempt) => cell(luna, attempt));
        const runner = controlledRun();
        const options = limits({concurrency: 1});
        const summary = runPool(cells, options, runner.run);
        const exhausted: CellResult = {state: "exhausted", inputTokens: 0};
        for (const [i, result] of [exhausted, exhausted, {state: "settled", inputTokens: 1} as CellResult, exhausted, exhausted, exhausted].entries()) {
            await runner.started(i + 1);
            runner.finish(cells[i] as Cell, result);
        }
        expect(await summary).toEqual({settled: 1, exhausted: 5, skipped: 0, failed: 0, notStarted: 1, stoppedBy: "infra-errors", totalInputTokens: 1});
        expect(options.logs.some((line) => line.startsWith("stop: 3 cells in a row"))).toBe(true);
    });
});
