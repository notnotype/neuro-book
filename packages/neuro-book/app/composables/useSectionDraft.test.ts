import {effectScope, nextTick, ref} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {useSectionDraft} from "nbook/app/composables/useSectionDraft";

type Draft = {enabled: boolean; maxRecords: number};
type Payload = {observability: {piTrace: Draft}};

function payloadOf(draft: Draft): Payload {
    return {observability: {piTrace: {...draft}}};
}

function deferred() {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return {promise, resolve, reject};
}

function createHarness(options: {
    write?: (payload: Payload, context: string | undefined) => Promise<unknown>;
    context?: () => string;
} = {}) {
    const source = ref<Draft>({enabled: true, maxRecords: 100});
    const writes: Payload[] = [];
    const scope = effectScope();
    const write = options.write ?? (async (payload: Payload) => {
        writes.push(payload);
    });
    const section = scope.run(() => useSectionDraft<Draft, Payload, string>({
        source: () => source.value,
        create: (value: unknown) => ({...(value as Draft)}),
        toPayload: payloadOf,
        write,
        captureContext: options.context,
        fallbackErrorMessage: "保存设置失败。",
    }))!;
    return {source, writes, scope, section};
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("useSectionDraft", () => {
    it("挂载时草稿等于来源，不产生写回", async () => {
        const {writes} = createHarness();

        await vi.advanceTimersByTimeAsync(1000);

        expect(writes).toHaveLength(0);
    });

    it("连续修改合并成一次写回，写的是最后一次的值", async () => {
        const {section, writes} = createHarness();

        section.draft.value.maxRecords = 200;
        await vi.advanceTimersByTimeAsync(100);
        section.draft.value.maxRecords = 300;
        await vi.advanceTimersByTimeAsync(100);
        section.draft.value.maxRecords = 400;
        await vi.advanceTimersByTimeAsync(600);

        expect(writes).toEqual([payloadOf({enabled: true, maxRecords: 400})]);
    });

    it("改回原值不写盘", async () => {
        const {section, writes} = createHarness();

        section.draft.value.maxRecords = 200;
        await vi.advanceTimersByTimeAsync(100);
        section.draft.value.maxRecords = 100;
        await vi.advanceTimersByTimeAsync(1000);

        expect(writes).toHaveLength(0);
    });

    it("写回失败保留草稿并记录错误，重试成功后清空错误", async () => {
        let attempts = 0;
        const harness = createHarness({
            write: async (payload: Payload) => {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error("network down");
                }
                harness.writes.push(payload);
            },
        });

        harness.section.draft.value.maxRecords = 200;
        await vi.advanceTimersByTimeAsync(600);

        expect(harness.section.saving.value).toBe(false);
        expect(harness.section.saveError.value).not.toBe("");
        expect(harness.section.draft.value.maxRecords).toBe(200);

        await harness.section.flush();

        expect(attempts).toBe(2);
        expect(harness.writes).toEqual([payloadOf({enabled: true, maxRecords: 200})]);
        expect(harness.section.saveError.value).toBe("");
    });

    it("写回后的快照回声不覆盖正在编辑的新草稿", async () => {
        const harness = createHarness();

        harness.section.draft.value.maxRecords = 200;
        await vi.advanceTimersByTimeAsync(600);
        expect(harness.writes).toEqual([payloadOf({enabled: true, maxRecords: 200})]);

        // 用户在回声到达前又改了一笔，然后快照重取返回刚写回的值（新引用、内容相同）。
        harness.section.draft.value.enabled = false;
        harness.source.value = {enabled: true, maxRecords: 200};
        await nextTick();

        expect(harness.section.draft.value.enabled).toBe(false);
        expect(harness.section.draft.value.maxRecords).toBe(200);

        await vi.advanceTimersByTimeAsync(600);

        expect(harness.writes).toEqual([
            payloadOf({enabled: true, maxRecords: 200}),
            payloadOf({enabled: false, maxRecords: 200}),
        ]);
    });

    it("来源真的换了一份配置且草稿干净时（切作用域）草稿重建", async () => {
        const harness = createHarness();

        harness.section.draft.value.maxRecords = 200;
        await harness.section.flush();
        expect(harness.writes).toHaveLength(1);

        harness.source.value = {enabled: false, maxRecords: 50};
        await nextTick();

        expect(harness.section.draft.value).toEqual({enabled: false, maxRecords: 50});
    });

    it("草稿有未保存改动时，来源变化不覆盖它（轮询重取不打断输入）", async () => {
        const harness = createHarness();

        harness.section.draft.value.maxRecords = 200;
        harness.source.value = {enabled: false, maxRecords: 50};
        await nextTick();

        expect(harness.section.draft.value.maxRecords).toBe(200);
        expect(harness.section.draft.value.enabled).toBe(true);
    });

    it("reset 按当前来源重建草稿，丢弃未保存改动", async () => {
        const harness = createHarness();

        harness.section.draft.value.maxRecords = 200;
        harness.source.value = {enabled: false, maxRecords: 50};
        await nextTick();
        harness.section.reset();

        expect(harness.section.draft.value).toEqual({enabled: false, maxRecords: 50});
        await vi.advanceTimersByTimeAsync(1000);
        expect(harness.writes).toHaveLength(0);
    });

    it("写回串行：进行中的写不与新写重叠，最终值仍会落盘", async () => {
        const pending = deferred();
        const writes: Payload[] = [];
        let active = 0;
        let maxActive = 0;
        const harness = createHarness({
            write: async (payload: Payload) => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                if (writes.length === 0) {
                    await pending.promise;
                }
                writes.push(payload);
                active -= 1;
            },
        });

        harness.section.draft.value.maxRecords = 200;
        await vi.advanceTimersByTimeAsync(600);
        expect(writes).toHaveLength(0);

        harness.section.draft.value.maxRecords = 300;
        await vi.advanceTimersByTimeAsync(600);
        expect(maxActive).toBe(1);

        pending.resolve();
        await vi.advanceTimersByTimeAsync(0);

        expect(maxActive).toBe(1);
        expect(writes).toEqual([
            payloadOf({enabled: true, maxRecords: 200}),
            payloadOf({enabled: true, maxRecords: 300}),
        ]);
    });

    it("写回带的是构建草稿时捕获的上下文（切作用域后仍写到原目标）", async () => {
        let scope = "global";
        const seen: Array<string | undefined> = [];
        const harness = createHarness({
            context: () => scope,
            write: async (_payload, context) => {
                seen.push(context);
            },
        });

        harness.section.draft.value.maxRecords = 200;
        // 宿主在防抖窗口内切了作用域：写回体与查询参数必须来自同一份草稿。
        scope = "project";
        await vi.advanceTimersByTimeAsync(600);

        expect(seen).toEqual(["global"]);
    });

    it("flush 跳过防抖立即写回", async () => {
        const harness = createHarness();

        harness.section.draft.value.maxRecords = 200;
        await harness.section.flush();

        expect(harness.writes).toEqual([payloadOf({enabled: true, maxRecords: 200})]);
    });
});
