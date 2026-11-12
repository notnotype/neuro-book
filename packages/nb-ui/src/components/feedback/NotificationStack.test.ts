/**
 * NotificationStack（同名 .md）：点动作执行并移除通知，动作抛错时同样移除；视口上限与折叠小条；“详情”打开对话框、
 * 快照与标题、打开期间视口 inert、关闭后的焦点去向。
 *
 * 详情对话框的内部结构（原文怎么排、复制按钮在哪）归 DetailDialog 自己的测试；这里只按角色与文字找它。
 */
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {ref} from "vue";

import {createNotificationQueue} from "../../composables/useNotification";
import {NB_UI_CATALOGS, NB_UI_NAMESPACE} from "../../locales";
import {TEXT_PORT_KEY} from "../../text-port";
import type {TextPort} from "../../text-port";
import {createMinimalTranslator} from "../../text/minimal";
import {captureDialogOrigin} from "./dialog-origin";
import NotificationStack from "./NotificationStack.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    captureDialogOrigin();
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const button = (label: string): HTMLButtonElement | undefined => [...document.body.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
const stack = (): HTMLElement => document.body.querySelector<HTMLElement>("[data-notification-stack]")!;
const shownMessages = (): string[] => [...stack().querySelectorAll(".nb-notification")].map((node) => node.textContent?.replace(/\s+/gu, " ").trim() ?? "");
const fold = (): HTMLButtonElement | null => document.body.querySelector<HTMLButtonElement>("[data-notification-fold]");
const dialog = (): HTMLElement | null => document.body.querySelector<HTMLElement>("[role=dialog]");

function mountStack(props: Record<string, unknown> = {}, port?: TextPort) {
    const queue = createNotificationQueue();
    const wrapper = mount(NotificationStack, {props: {queue, ...props}, attachTo: document.body, global: port === undefined ? {} : {provide: {[TEXT_PORT_KEY as symbol]: port}}});
    mounted.push(wrapper);
    return {queue, wrapper};
}

function pressEscape(): void {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
}

describe("NotificationStack", () => {
    it("动作抛错时通知仍移除，错误交给 Vue 的错误处理", async () => {
        const queue = createNotificationQueue();
        const errors: unknown[] = [];
        const wrapper = mount(NotificationStack, {props: {queue}, attachTo: document.body, global: {config: {errorHandler: (error) => {
            errors.push(error);
        }}}});
        mounted.push(wrapper);
        queue.notify({message: "连接已断开", duration: 0, action: {label: "重试", run: () => {
            throw new Error("重连失败");
        }}});
        await flushPromises();
        button("重试")?.click();
        await flushPromises();
        expect(queue.notifications.value).toEqual([]);
        expect(errors).toMatchObject([{message: "重连失败"}]);
        queue.clearAll();
    });

    it("视口是有名字的区域；六条常驻只显示最新 4 条，列顶的小条展开全部、再收起；回到上限以内自动收起", async () => {
        const {queue} = mountStack();
        expect(stack().getAttribute("role")).toBe("region");
        expect(stack().getAttribute("aria-label")).toBe("通知");
        const ids = Array.from({length: 6}, (_, index) => queue.notify({message: `第 ${String(index + 1)} 条`, duration: 0}));
        await flushPromises();
        expect(shownMessages()).toEqual(["第 3 条", "第 4 条", "第 5 条", "第 6 条"]);
        expect(fold()?.textContent?.trim()).toBe("还有 2 条较早的通知");
        expect(fold()?.getAttribute("aria-expanded")).toBe("false");
        expect(document.getElementById(fold()!.getAttribute("aria-controls")!)).not.toBeNull();
        // 小条在整列最上面（所有位置都是最早的在上）：文档顺序排在第一条通知之前。
        const firstNotice = stack().querySelector(".nb-notification")!;
        expect(fold()!.compareDocumentPosition(firstNotice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        fold()!.click();
        await flushPromises();
        expect(shownMessages()).toHaveLength(6);
        expect(fold()?.textContent?.trim()).toBe("收起");
        expect(fold()?.getAttribute("aria-expanded")).toBe("true");
        fold()!.click();
        await flushPromises();
        expect(shownMessages()).toHaveLength(4);

        // 展开后删到 4 条以内：小条消失；再多出来时是收起态。
        fold()!.click();
        await flushPromises();
        queue.remove(ids[0]!);
        queue.remove(ids[1]!);
        await flushPromises();
        expect(fold()).toBeNull();
        queue.notify({message: "第 7 条", duration: 0});
        await flushPromises();
        expect(fold()?.getAttribute("aria-expanded")).toBe("false");
        expect(shownMessages()).toEqual(["第 4 条", "第 5 条", "第 6 条", "第 7 条"]);
        queue.clearAll();
    });

    it("maxVisible 的边界：0、负数、小数取到至少 1，NaN 取缺省 4", async () => {
        for (const [maxVisible, expected] of [[0, 1], [-2, 1], [1.5, 1], [2.9, 2], [Number.NaN, 4]] as const) {
            const {queue, wrapper} = mountStack({maxVisible});
            for (let index = 0; index < 6; index += 1) queue.notify({message: String(index), duration: 0});
            await flushPromises();
            expect(shownMessages()).toHaveLength(expected);
            queue.clearAll();
            wrapper.unmount();
            mounted.pop();
        }
    });

    it("折起来的限时通知照常到时消失", async () => {
        const {queue} = mountStack({maxVisible: 1});
        // 时长留足：机器忙时 30ms 这类短时长可能在断言“它被折起来”之前就到了。
        const timed = queue.notify({message: "一闪而过", duration: 1500});
        queue.notify({message: "常驻", duration: 0});
        await flushPromises();
        expect(shownMessages()).toEqual(["常驻"]);
        await vi.waitFor(() => expect(queue.notifications.value.some((item) => item.id === timed)).toBe(false), {timeout: 6000});
        await flushPromises();
        expect(fold()).toBeNull();
        queue.clearAll();
    });

    it("只有带详情的通知有“详情”；空白原文不算", async () => {
        const {queue} = mountStack();
        queue.notify({message: "无详情", duration: 0});
        queue.notify({message: "空白", detail: "  ", duration: 0});
        queue.notify({message: "有详情", detail: "Error: EACCES", duration: 0});
        await flushPromises();
        expect([...stack().querySelectorAll(".nb-notification")].map((node) => node.querySelector("[data-notification-detail]") !== null)).toEqual([false, false, true]);
        queue.clearAll();
    });

    it("点“详情”打开对话框：标题“标题：详情”、原文；打开期间视口 inert；关闭后焦点回到“详情”按钮", async () => {
        const {queue} = mountStack();
        queue.notify({tone: "danger", title: "文件没有保存", message: "没有写入权限", detail: "EditorSaveError: EACCES\r\n    trace: 4f2a9c1e", duration: 0, action: {label: "重试", run: () => {}}});
        await flushPromises();
        const opener = stack().querySelector<HTMLButtonElement>("[data-notification-detail]")!;
        // happy-dom 的 click() 不聚焦按钮；真实浏览器里点按钮会聚焦（Safari 除外，视口不依赖它）。
        opener.focus();
        opener.click();
        await flushPromises();
        expect(dialog()?.textContent).toContain("文件没有保存：详情");
        expect(dialog()?.textContent).toContain("EditorSaveError: EACCES");
        expect(dialog()?.textContent).toContain("trace: 4f2a9c1e");
        expect(stack().hasAttribute("inert")).toBe(true);
        // 层级降到模态之下：遮罩盖住通知，而不是通知画在对话框上面。
        expect(Number(stack().style.zIndex)).toBeLessThan(Number(dialog()!.style.zIndex));

        pressEscape();
        await flushPromises();
        await vi.waitFor(() => expect(dialog()).toBeNull());
        expect(stack().hasAttribute("inert")).toBe(false);
        expect(Number(stack().style.zIndex)).toBeGreaterThan(9000);
        await vi.waitFor(() => expect(document.activeElement).toBe(opener));
        queue.clearAll();
    });

    it("打开期间通知被移除：对话框照常显示快照；关闭后焦点落到视口根，不落到 body", async () => {
        const {queue} = mountStack();
        const id = queue.notify({message: "没有标题", detail: "原文快照", detailTruncated: true, duration: 0});
        await flushPromises();
        stack().querySelector<HTMLButtonElement>("[data-notification-detail]")!.click();
        await flushPromises();
        queue.remove(id);
        await flushPromises();
        // 通知没有标题时，对话框标题只写“详情”。
        expect(dialog()?.textContent).toContain("详情");
        expect(dialog()?.textContent).not.toContain("：详情");
        expect(dialog()?.textContent).toContain("原文快照");
        expect(dialog()?.textContent).toContain("原文过长，已截断");

        pressEscape();
        // closed 在对话框卸载、焦点栈释放之后的下一个宏任务才发（close-handoff.ts），所以等焦点这个可观察状态。
        await vi.waitFor(() => expect(document.activeElement).toBe(stack()));
    });

    it("对话框打开后切换语言，标题原位更新", async () => {
        const translator = createMinimalTranslator({catalogs: {[NB_UI_NAMESPACE]: NB_UI_CATALOGS}, strict: true});
        const locale = ref("zh-CN");
        const port: TextPort = {locale, t: (text) => translator.translate(text, locale.value), variants: (text) => translator.variants(text)};
        const {queue} = mountStack({}, port);
        queue.notify({title: {"zh-CN": "文件没有保存", "en-US": "File not saved"}, message: "m", detail: "x", duration: 0});
        await flushPromises();
        stack().querySelector<HTMLButtonElement>("[data-notification-detail]")!.click();
        await flushPromises();
        expect(dialog()?.textContent).toContain("文件没有保存：详情");
        locale.value = "en-US";
        await flushPromises();
        expect(dialog()?.textContent).toContain("File not saved: details");
        queue.clearAll();
    });
});
