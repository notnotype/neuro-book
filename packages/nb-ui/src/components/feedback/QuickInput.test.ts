import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {defineComponent, h, nextTick, ref} from "vue";
import QuickInput, {type QuickInputItem} from "./QuickInput.vue";

const commandItems: readonly QuickInputItem[] = [
    {id: "outline.reorder", label: "重排分卷大纲", category: "大纲"},
    {id: "export.epub", label: "导出 EPUB 电子书", category: "导出"},
    {id: "theme.toggle", label: "切换明暗配色", category: "外观"},
];

type HarnessOptions = Readonly<{
    items?: readonly QuickInputItem[];
    activeId?: string | null;
    loading?: boolean;
    open?: boolean;
}>;

/** 最薄宿主：用例只关心「请求有没有发出」，候选项与活动项仍由测试自己决定 */
function mountHarness(options: HarnessOptions = {}) {
    const open = ref(options.open ?? true);
    const query = ref(">");
    const activeId = ref<string | null>(options.activeId ?? null);
    const accepted = ref<string[]>([]);
    const closes: string[] = [];
    const closed = ref(0);
    const mountedWhenClosed = ref<boolean | null>(null);

    const wrapper = mount(defineComponent({
        setup() {
            return () => h(QuickInput, {
                open: open.value,
                query: query.value,
                items: options.items ?? commandItems,
                activeId: activeId.value,
                title: "写作工作区命令",
                placeholder: "输入命令名称",
                emptyText: "没有匹配的命令",
                loading: options.loading ?? false,
                "onUpdate:open": (value: boolean) => { open.value = value; },
                "onUpdate:query": (value: string) => { query.value = value; },
                "onUpdate:activeId": (value: string | null) => { activeId.value = value; },
                onAccept: (id: string) => { accepted.value.push(id); },
                onClose: (reason: string) => { closes.push(reason); },
                onClosed: () => {
                    closed.value += 1;
                    mountedWhenClosed.value = document.body.querySelector('[role="combobox"]') !== null;
                },
            });
        },
    }), {attachTo: document.body});

    return {wrapper, open, query, activeId, accepted, closes, closed, mountedWhenClosed};
}

async function ticks(count = 2): Promise<void> {
    for (let index = 0; index < count; index += 1) await nextTick();
}

/**
 * 关闭交接是「微任务 → 下一宏任务」。用假时钟按调度顺序推进：
 * 只让到期定时器跑，不引入真实等待，也不靠「等够久」猜交接到没到。
 */
async function settleHandoff(rounds = 4): Promise<void> {
    for (let index = 0; index < rounds; index += 1) {
        await nextTick();
        await vi.advanceTimersByTimeAsync(0);
    }
}

function inputElement(): HTMLInputElement {
    const element = document.body.querySelector<HTMLInputElement>('[role="combobox"]');
    if (element === null) throw new Error("QuickInput 输入框未渲染");
    return element;
}

async function press(key: string, init: KeyboardEventInit = {}): Promise<void> {
    inputElement().dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true, ...init}));
    await nextTick();
}

function cleanup(wrapper: {unmount: () => void}): void {
    wrapper.unmount();
    document.body.replaceChildren();
}

describe("QuickInput 受控合同", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("活动项失效为禁用项时不接受 Enter 与点击", async () => {
        const items: readonly QuickInputItem[] = [
            {id: "export.mobi", label: "导出 MOBI（转换器未安装）", disabled: true},
            ...commandItems,
        ];
        const {wrapper, accepted} = mountHarness({items, activeId: "export.mobi"});
        try {
            await ticks();
            const disabledOption = document.body.querySelector('[role="option"]');
            expect(disabledOption?.getAttribute("aria-disabled")).toBe("true");
            expect(disabledOption?.getAttribute("aria-selected")).toBe("false");

            await press("Enter");
            disabledOption?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
            await nextTick();

            expect(accepted.value).toEqual([]);
        } finally {
            cleanup(wrapper);
        }
    });

    it("全禁用列表里方向键清空失效活动项，且提交始终被抑制", async () => {
        const items: readonly QuickInputItem[] = [
            {id: "export.mobi", label: "导出 MOBI（转换器未安装）", disabled: true},
            {id: "settings.sync", label: "同步设置（离线不可用）", disabled: true},
        ];
        const {wrapper, activeId, accepted} = mountHarness({items, activeId: "export.mobi"});
        try {
            await ticks();

            await press("ArrowDown");
            expect(activeId.value).toBeNull();

            await press("Enter");
            document.body.querySelector('[role="option"]')?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
            await nextTick();
            expect(accepted.value).toEqual([]);
        } finally {
            cleanup(wrapper);
        }
    });

    it("空列表显示真实空态且不提交", async () => {
        const {wrapper, accepted} = mountHarness({items: [], activeId: null});
        try {
            await ticks();

            expect(document.body.textContent).toContain("没有匹配的命令");
            await press("Enter");

            expect(accepted.value).toEqual([]);
        } finally {
            cleanup(wrapper);
        }
    });

    it("组合输入态的 Enter 不提交，普通 Enter 只提交一次", async () => {
        const {wrapper, accepted} = mountHarness({activeId: "outline.reorder"});
        try {
            await ticks();

            await press("Enter", {isComposing: true});
            expect(accepted.value).toEqual([]);

            await press("Enter");
            expect(accepted.value).toEqual(["outline.reorder"]);
        } finally {
            cleanup(wrapper);
        }
    });

    it("Escape 只关本层：发出 close(escape) 且下层 document 监听收不到按键", async () => {
        const {wrapper, open, closes} = mountHarness({activeId: "outline.reorder"});
        const documentKeys: string[] = [];
        const documentListener = (event: KeyboardEvent): void => { documentKeys.push(event.key); };
        document.addEventListener("keydown", documentListener);
        try {
            await ticks();

            await press("Escape");

            expect(closes).toEqual(["escape"]);
            expect(open.value).toBe(false);
            expect(documentKeys).toEqual([]);
        } finally {
            document.removeEventListener("keydown", documentListener);
            cleanup(wrapper);
        }
    });

    it("closed 在内容卸载后只发一次并归还焦点", async () => {
        const {wrapper, open, closed, mountedWhenClosed} = mountHarness({activeId: "outline.reorder", open: false});
        const trigger = document.createElement("button");
        document.body.append(trigger);
        try {
            await ticks();
            trigger.focus();
            expect(document.activeElement).toBe(trigger);

            open.value = true;
            await ticks(3);
            expect(document.activeElement).toBe(inputElement());

            open.value = false;
            await settleHandoff();
            expect(closed.value).toBe(1);
            expect(mountedWhenClosed.value).toBe(false);
            expect(document.activeElement).toBe(trigger);

            open.value = true;
            await ticks(3);
            open.value = false;
            await settleHandoff();
            expect(closed.value).toBe(2);
        } finally {
            cleanup(wrapper);
        }
    });

    it("关闭尚未结算时重开，旧周期的 closed 被作废", async () => {
        const {wrapper, open, closed} = mountHarness({activeId: "outline.reorder"});
        try {
            await ticks(3);

            open.value = false;
            await ticks(5);
            expect(document.body.querySelector('[role="combobox"]')).toBeNull();

            open.value = true;
            await settleHandoff();

            expect(document.body.querySelector('[role="combobox"]')).not.toBeNull();
            expect(closed.value).toBe(0);
        } finally {
            cleanup(wrapper);
        }
    });
});
