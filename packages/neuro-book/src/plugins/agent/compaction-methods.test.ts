/**
 * 贡献点的方法表（docs/specs/agent/compaction.md 输出 12）：激活、撤回与在途的方法。方法本身的纯逻辑在宿主套件
 * （`@notnotype/nb-harness/kit/compaction` 的测试），端到端的行为在 `compaction.test.ts`。
 */

import {describe, expect, test} from "bun:test";

import type {ContributionDeclarations, ContributionHandle} from "@notnotype/nb-runtime/plugins";

import type {CompactionJob, CompactionMethodImpl, ModelResponse} from "@notnotype/nb-harness/kernel/contracts";

import {CompactionMethods} from "./backend/compaction";

describe("贡献点的方法表（输出 12）", () => {
    const declarations = {get: () => null, list: () => [{id: "x.third"}]} as unknown as ContributionDeclarations;
    const handleOf = (implementation: CompactionMethodImpl) => ({id: "x.third", implementation: () => implementation}) as unknown as ContributionHandle<never, CompactionMethodImpl>;
    const jobOf = (signal: AbortSignal, model: CompactionJob["model"]) => ({signal, model}) as unknown as CompactionJob;

    test("等激活的时候运行被中止：激活完成后不再启动方法", async () => {
        let gate!: () => void;
        const activated = new Promise<boolean>((resolve) => { gate = () => resolve(true); });
        let started = false;
        const methods = new CompactionMethods({declarations, activate: async () => { await activated; methods.receiver.published!(handleOf(async () => { started = true; return {failed: "x"}; }), undefined); return true; }});
        const abort = new AbortController();
        const call = methods.table["x.third"]!(jobOf(abort.signal, async () => { throw new Error("不该调用"); }));
        abort.abort();
        gate();
        expect(await call).toEqual({failed: "aborted"});
        expect(started).toBe(false);
    });

    test("提供方撤回：在途的方法算失败，它之后再调 job.model 被拒绝，不发请求", async () => {
        let release!: () => void;
        const parked = new Promise<void>((resolve) => { release = resolve; });
        let modelCalls = 0;
        let late: unknown = null;
        const handle = handleOf(async (job) => {
            await parked;
            late = await job.model({} as never, {purpose: "compaction"}).catch((error: unknown) => error);
            return {failed: "late"};
        });
        const methods = new CompactionMethods({declarations, activate: async () => true});
        methods.receiver.published!(handle, undefined);
        const call = methods.table["x.third"]!(jobOf(new AbortController().signal, async () => { modelCalls += 1; return {} as ModelResponse; }));
        await Promise.resolve();
        methods.receiver.revoke!(handle, undefined, "scope-closed");
        expect(await call).toEqual({failed: "method-revoked"});
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(modelCalls).toBe(0);
        expect(late).toBeInstanceOf(Error);
    });
});
