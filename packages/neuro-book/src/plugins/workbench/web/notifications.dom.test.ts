/**
 * 工作台通知服务（docs/specs/workbench/notifications.md 输出 2 到 5、9）：发出的通知在视口里出现；error 与带动作的常驻，
 * 其余按色调自动消失；update 推进进度并在任务结束后改成限时；明确给的 sticky 保留；动作点了通知移除，抛错也移除并记诊断；dispose 清空；
 * 文字引用在显示时按窗口的当前语言翻，切换语言后已显示的通知跟着换文字。
 * 真实的 nb-ui 队列与视口、宿主的翻译引擎（像窗口根那样注入），时长用真实的短时长等可观察结果。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {h} from "vue";

import {NotificationStack} from "@notnotype/nb-ui/components";
import {textRef} from "@notnotype/nb-ui/text";

import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {createNotifications} from "./notifications";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

/** 发出方 `test.sender` 的目录：通知文字用它的键。 */
const SENDER = {"zh-CN": {saved: {title: "已保存", message: "共 {{count}} 部"}, retry: "重试"}, "en-US": {saved: {title: "Saved", message: "{{count}} books"}, retry: "Retry"}};

function world() {
    const reports: string[] = [];
    const engine = createHostTextEngine({locale: "zh-CN", strict: true});
    engine.register("test.sender", SENDER, "zh-CN");
    const notifications = createNotifications((message) => reports.push(message), engine.port);
    const wrapper = mount({render: () => h(NotificationStack, {queue: notifications.queue, position: "bottom-right"})}, {attachTo: document.body, global: {provide: provideText(engine.port)}});
    mounted.push(wrapper);
    const texts = (): string[] => [...document.body.querySelectorAll("[data-notification-stack] [role='status']")].map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "");
    return {notifications, texts, reports, engine};
}

describe("工作台通知服务", () => {
    it("通知出现在视口里；error 与带动作的常驻，info 自动消失", async () => {
        const {notifications, texts} = world();
        const failed = notifications.notify({tone: "error", title: "保存失败", message: "磁盘已满"});
        const retry = notifications.notify({tone: "warning", title: "书架没有更新", message: "连接已断开", action: {label: "重试", run: () => {}}});
        notifications.notify({tone: "info", message: "已切换主题"});
        await flushPromises();
        expect(texts()).toHaveLength(3);
        expect(notifications.queue.notifications.value.map((item) => item.duration)).toEqual([0, 0, 3200]);
        failed.dismiss();
        retry.dismiss();
        await flushPromises();
        expect(texts()).toHaveLength(1);
        expect(texts()[0]).toContain("已切换主题");
        notifications.dispose();
    });

    it("输出 3、5：带详情的缺省常驻（警告、无动作的也是）；明确给的 sticky 优先；空白详情等于没有", () => {
        const {notifications} = world();
        const DETAIL = "EditorSaveError: EACCES\n    trace: 4f2a9c1e";
        // sticky 不给、true、false 三种，各配有无详情。
        for (const sticky of [undefined, true, false]) {
            for (const detail of [undefined, DETAIL]) {
                notifications.notify({tone: "warning", message: "m", ...(sticky === undefined ? {} : {sticky}), ...(detail === undefined ? {} : {detail})});
            }
        }
        notifications.notify({tone: "info", message: "空白详情", detail: "  \n "});
        expect(notifications.queue.notifications.value.map((item) => item.duration)).toEqual([4200, 0, 0, 0, 4200, 4200, 3200]);
        expect(notifications.queue.notifications.value[1]?.detail).toBe(DETAIL);
        notifications.dispose();
    });

    it("输出 5：update 的详情——无到有变常驻、换一段原文不动时长、有到无回到按色调限时；明确给的 sticky 仍优先", () => {
        const {notifications} = world();
        const handle = notifications.notify({tone: "info", message: "正在同步"});
        const entry = () => notifications.queue.notifications.value[0]!;
        expect(entry().duration).toBe(3200);
        handle.update({detail: "Error: offline"});
        expect(entry()).toMatchObject({detail: "Error: offline", duration: 0});
        handle.update({detail: "Error: offline (retry 2)"});
        expect(entry()).toMatchObject({detail: "Error: offline (retry 2)", duration: 0});
        handle.update({detail: ""});
        expect(entry()).not.toHaveProperty("detail");
        expect(entry().duration).toBe(3200);
        // 明确给过 sticky: false 的，加上详情仍限时。
        const timed = notifications.notify({tone: "info", message: "限时", sticky: false});
        timed.update({detail: "x"});
        expect(notifications.queue.notifications.value[1]?.duration).toBe(3200);
        notifications.dispose();
    });

    it("动作点了之后执行并移除通知", async () => {
        const {notifications, texts} = world();
        const runs: string[] = [];
        notifications.notify({tone: "warning", title: "书架没有更新", message: "连接已断开", action: {label: "重试", run: () => runs.push("retry")}});
        await flushPromises();
        const button = [...document.body.querySelectorAll("button")].find((node) => node.textContent?.trim() === "重试");
        expect(button).toBeDefined();
        button?.click();
        await flushPromises();
        expect(runs).toEqual(["retry"]);
        expect(texts()).toHaveLength(0);
        notifications.dispose();
    });

    it("动作抛错时通知仍移除，错误记一条诊断", async () => {
        const {notifications, texts, reports} = world();
        notifications.notify({tone: "warning", message: "连接已断开", action: {label: "重试", run: () => {
            throw new Error("重连失败");
        }}});
        await flushPromises();
        [...document.body.querySelectorAll("button")].find((node) => node.textContent?.trim() === "重试")?.click();
        await flushPromises();
        expect(texts()).toHaveLength(0);
        expect(reports).toEqual(["通知动作“重试”失败：重连失败"]);
        notifications.dispose();
    });

    it("update 推进进度；改成 success 后按时长消失；dispose 清空", async () => {
        const {notifications, texts} = world();
        const handle = notifications.notify({tone: "info", title: "正在统计", message: "0 部", progress: 0, sticky: true});
        await flushPromises();
        // 明确给的 sticky 不因别的字段更新而丢：只改色调仍常驻。
        handle.update({tone: "warning"});
        expect(notifications.queue.notifications.value[0]?.duration).toBe(0);
        expect(document.body.querySelector("[data-notification-progress]")).not.toBeNull();
        handle.update({message: "3 部", progress: 50});
        await flushPromises();
        expect(texts()[0]).toContain("3 部");
        expect(notifications.queue.notifications.value[0]?.progress).toBe(50);
        // sticky 改回 false 后按 success 的时长消失；这里把时长压短不靠假计时器：先确认它不再常驻。
        handle.update({tone: "success", title: "统计完成", progress: 100, sticky: false});
        expect(notifications.queue.notifications.value[0]?.duration).toBe(3200);
        notifications.notify({tone: "info", message: "另一条"});
        notifications.dispose();
        await flushPromises();
        expect(texts()).toHaveLength(0);
    });

    it("输出 9：标题、正文与动作名是文字值，显示时按窗口的当前语言翻；切换语言后已显示的通知跟着换，字符串原样", async () => {
        const {notifications, texts, engine} = world();
        notifications.notify({
            tone: "warning",
            title: textRef("saved.title", undefined, "test.sender"),
            message: textRef("saved.message", {count: 3}, "test.sender"),
            action: {label: textRef("retry", undefined, "test.sender"), run: () => {}},
        });
        notifications.notify({tone: "warning", title: {"zh-CN": "书架没有更新", "en-US": "Shelf not updated"}, message: "Book.md"});
        await flushPromises();
        const notice = document.body.querySelector("[data-notification-stack] [role='status']");
        // 视口里一条通知的文字是标题、正文与动作名连在一起。
        expect(texts()).toEqual(["已保存共 3 部重试", "书架没有更新Book.md"]);
        engine.setLocale("en-US");
        await flushPromises();
        expect(texts()).toEqual(["Saved3 booksRetry", "Shelf not updatedBook.md"]);
        // 同一个元素换了文字，不是重新发出。
        expect(document.body.querySelector("[data-notification-stack] [role='status']")).toBe(notice);
        notifications.dispose();
    });

    it("动作名是文字引用时，动作抛错的诊断写此刻语言的动作名", async () => {
        const {notifications, reports, engine} = world();
        engine.setLocale("en-US");
        notifications.notify({tone: "warning", message: "Book.md", action: {label: textRef("retry", undefined, "test.sender"), run: () => {
            throw new Error("offline");
        }}});
        await flushPromises();
        [...document.body.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Retry")?.click();
        await flushPromises();
        expect(reports).toEqual(["通知动作“Retry”失败：offline"]);
        notifications.dispose();
    });

    it("限时通知到点消失", async () => {
        const {notifications, texts} = world();
        // 时长留足：机器忙时 30ms 这类短时长会在“先看到它”的断言之前就到。
        notifications.queue.notify({message: "一闪而过", duration: 1500});
        await flushPromises();
        expect(texts()).toHaveLength(1);
        await vi.waitFor(() => {
            expect(texts()).toHaveLength(0);
        }, {timeout: 6000});
        notifications.dispose();
    });
});
