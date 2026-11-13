/**
 * 工作台通知服务（docs/specs/workbench/notifications.md 输出 2 到 5、9）：发出的通知在视口里出现；error 与带动作的常驻，
 * 其余按色调自动消失；update 推进进度并在任务结束后改成限时；明确给的 sticky 保留；动作点了通知移除，抛错也移除并记诊断；dispose 清空；
 * 文字引用在显示时按窗口的当前语言翻，切换语言后已显示的通知跟着换文字；通知中心（输出 13、15、16，验收 8 到 10 的服务一侧）；
 * 用户关闭的回告（输出 18，验收 11）。
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

    it("通知中心：用户关掉、到时消失的留在中心；发出方撤回的两边都移除；update 同步到中心（输出 13）", async () => {
        const {notifications, texts} = world();
        const closed = notifications.notify({tone: "error", title: "保存失败", message: "磁盘已满"});
        notifications.notify({tone: "info", message: "已切换主题"});
        const recalled = notifications.notify({tone: "warning", message: "书架没有更新"});
        await flushPromises();
        expect(notifications.center.entries.value.map((entry) => entry.message)).toEqual(["书架没有更新", "已切换主题", "磁盘已满"]);
        // 用户点那条通知的关闭按钮（带可访问名称的那个）：只动弹出处。
        const toast = [...document.body.querySelectorAll("[data-notification-stack] [role='status']")].find((node) => node.textContent?.includes("磁盘已满") === true);
        toast?.querySelector<HTMLButtonElement>("button[aria-label]")?.click();
        await flushPromises();
        expect(texts().some((line) => line.includes("磁盘已满"))).toBe(false);
        expect(notifications.center.entries.value.some((entry) => entry.id === closed.id)).toBe(true);
        recalled.dismiss();
        expect(notifications.center.entries.value.some((entry) => entry.id === recalled.id)).toBe(false);
        closed.update({message: "磁盘已满，已腾出空间"});
        expect(notifications.center.entries.value.find((entry) => entry.id === closed.id)?.message).toBe("磁盘已满，已腾出空间");
        expect(notifications.center.unread.value).toBe(2);
        notifications.dispose();
        expect(notifications.center.entries.value).toEqual([]);
    });

    it("输出 18、验收 11：用户关闭回告一次——弹出的关闭、中心移除、全部清除、到时消失后的移除；动作、dismiss、到时消失本身、挤出都不回告", async () => {
        const {notifications, reports} = world();
        const calls: string[] = [];
        const closer = (name: string) => () => void calls.push(name);
        // 视口一次只显示 4 条（再多的折起来），先发两条、关掉，再发其余的。
        const popped = notifications.notify({tone: "info", message: "弹出后关掉", sticky: true, onClose: closer("弹出后关掉")});
        notifications.notify({tone: "info", message: "坏回告", sticky: true, onClose: () => {
            throw new Error("回告失败");
        }});
        await flushPromises();
        const toast = (message: string) => [...document.body.querySelectorAll("[data-notification-stack] [role='status']")].find((node) => node.textContent?.includes(message) === true);
        toast("弹出后关掉")?.querySelector<HTMLButtonElement>("button[aria-label]")?.click();
        toast("坏回告")?.querySelector<HTMLButtonElement>("button[aria-label]")?.click();
        notifications.notify({tone: "info", message: "点了动作", action: {label: "下载", run: () => undefined}, onClose: closer("点了动作")});
        const recalled = notifications.notify({tone: "info", message: "发出方撤回", onClose: closer("发出方撤回")});
        const timed = notifications.notify({tone: "info", message: "到时消失", onClose: closer("到时消失")});
        await flushPromises();
        [...document.body.querySelectorAll("button")].find((node) => node.textContent?.trim() === "下载")?.click();
        recalled.dismiss();
        await flushPromises();
        expect(calls).toEqual(["弹出后关掉"]);
        expect(reports.some((line) => line.includes("回告失败"))).toBe(true);
        expect(toast("坏回告")).toBeUndefined();
        // 关掉的那条还在中心，再移除不重复回告。
        notifications.center.remove(popped.id);
        expect(calls).toEqual(["弹出后关掉"]);
        // 到时消失本身不回告；之后在中心移除算用户关闭。
        await vi.waitFor(() => expect(toast("到时消失")).toBeUndefined(), {timeout: 8000});
        expect(calls).toEqual(["弹出后关掉"]);
        notifications.center.remove(timed.id);
        expect(calls).toEqual(["弹出后关掉", "到时消失"]);
        // 视图开着时只进中心的那条：全部清除回告它。
        notifications.center.setVisible(true);
        notifications.notify({tone: "info", message: "只进中心", onClose: closer("只进中心")});
        notifications.center.clear();
        expect(calls).toEqual(["弹出后关掉", "到时消失", "只进中心"]);
        // 挤出不回告。
        notifications.notify({tone: "info", message: "最早的", onClose: closer("最早的")});
        for (let index = 0; index < 100; index += 1) notifications.notify({tone: "info", message: `第 ${String(index)} 条`});
        notifications.center.clear();
        expect(calls).toEqual(["弹出后关掉", "到时消失", "只进中心"]);
        notifications.dispose();
    }, 15_000);

    it("点动作：在弹出处或在中心里点，执行后两边一起移除（输出 13，验收 9）", async () => {
        const {notifications, texts} = world();
        const runs: string[] = [];
        notifications.notify({tone: "warning", message: "第一条", action: {label: "重试", run: () => runs.push("first")}});
        const second = notifications.notify({tone: "warning", message: "第二条", action: {label: "打开", run: () => runs.push("second")}});
        await flushPromises();
        [...document.body.querySelectorAll("button")].find((node) => node.textContent?.trim() === "重试")?.click();
        await flushPromises();
        expect(runs).toEqual(["first"]);
        expect(notifications.center.entries.value.map((entry) => entry.message)).toEqual(["第二条"]);
        notifications.center.run(second.id);
        await flushPromises();
        expect(runs).toEqual(["first", "second"]);
        expect(notifications.center.entries.value).toEqual([]);
        expect(texts()).toHaveLength(0);
        notifications.dispose();
    });

    it("视图开着时新通知只进中心、算看过、不弹出；看过的不再算未读；视图关了照常弹出（输出 15、16）", async () => {
        const {notifications, texts} = world();
        notifications.notify({tone: "info", message: "先到的"});
        expect(notifications.center.unread.value).toBe(1);
        notifications.center.setVisible(true);
        expect(notifications.center.unread.value).toBe(0);
        const quiet = notifications.notify({tone: "error", message: "开着时到的"});
        await flushPromises();
        expect(texts().some((line) => line.includes("开着时到的"))).toBe(false);
        expect(notifications.center.entries.value[0]).toMatchObject({id: quiet.id, unread: false});
        // 只在中心里的那条照样能更新、撤回。
        quiet.update({message: "开着时到的（已更新）"});
        expect(notifications.center.entries.value[0]?.message).toBe("开着时到的（已更新）");
        quiet.dismiss();
        notifications.center.setVisible(false);
        notifications.notify({tone: "info", message: "关了以后到的"});
        await flushPromises();
        expect(texts().some((line) => line.includes("关了以后到的"))).toBe(true);
        expect(notifications.center.unread.value).toBe(1);
        notifications.dispose();
    });

    it("中心至多 100 条，多了丢最早的；移除、全部清除只动中心；已截断的标记交给弹出处（输出 13，验收 10）", async () => {
        const {notifications, texts} = world();
        for (let index = 0; index < 101; index += 1) notifications.notify({tone: "info", message: `第 ${String(index)} 条`, sticky: true});
        expect(notifications.center.entries.value).toHaveLength(100);
        expect(notifications.center.entries.value.at(-1)?.message).toBe("第 1 条");
        notifications.center.remove(notifications.center.entries.value[0]!.id);
        expect(notifications.center.entries.value).toHaveLength(99);
        notifications.center.clear();
        expect(notifications.center.entries.value).toEqual([]);
        await flushPromises();
        expect(texts().length).toBeGreaterThan(0);
        notifications.dispose();
        notifications.notify({tone: "error", message: "装不上", detail: "x".repeat(10), detailTruncated: true});
        expect(notifications.queue.notifications.value[0]?.detailTruncated).toBe(true);
        expect(notifications.center.entries.value[0]?.detailTruncated).toBe(true);
        notifications.dispose();
    });

    it("中心里的详情与弹出处同一个上限：超过 8000 码元截掉并注明；视图开着时只进中心也一样，update 也一样（输入）", () => {
        const {notifications} = world();
        const popped = notifications.notify({tone: "error", message: "装不上", detail: "x".repeat(9000)});
        expect(notifications.center.entries.value[0]).toMatchObject({detailTruncated: true});
        expect(notifications.center.entries.value[0]?.detail).toHaveLength(8000);
        expect(notifications.queue.notifications.value[0]?.detail).toHaveLength(8000);
        notifications.center.setVisible(true);
        notifications.notify({tone: "error", message: "开着时到的", detail: "y".repeat(9000)});
        expect(notifications.center.entries.value[0]?.detail).toHaveLength(8000);
        expect(notifications.center.entries.value[0]?.detailTruncated).toBe(true);
        popped.update({detail: "z".repeat(8500)});
        const updated = notifications.center.entries.value.find((entry) => entry.id === popped.id);
        expect(updated?.detail).toBe("z".repeat(8000));
        expect(updated?.detailTruncated).toBe(true);
        notifications.dispose();
    });
});
