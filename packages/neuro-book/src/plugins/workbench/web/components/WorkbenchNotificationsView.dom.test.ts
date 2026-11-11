/**
 * WorkbenchNotificationsView（同名 .md；docs/specs/workbench/notifications.md 输出 14 到 16）：真实的通知服务与中心，视图上下文
 * 用真实的 ref 翻可见性。行的内容、没看过的标记、动作与移除、详情对话框、空状态，以及可见性上报与卸载后照常弹出。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {ref} from "vue";

import {provideText} from "nbook/shared/testing/text-port";

import {workbenchTestText} from "../../testing/text";
import type {ViewContext} from "../contracts";
import {createNotifications} from "../notifications";

import WorkbenchNotificationsView from "./WorkbenchNotificationsView.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function scene(visible = false) {
    const text = workbenchTestText("zh-CN");
    const notifications = createNotifications(() => undefined, text);
    const shown = ref(visible);
    const context: ViewContext = {id: "nbook.workbench.notifications", generation: 1, visible: shown, location: ref("panel")};
    const wrapper = mount(WorkbenchNotificationsView, {attachTo: document.body, props: {context, center: notifications.center}, global: {provide: provideText(text)}});
    mounted.push(wrapper);
    return {notifications, shown, wrapper};
}

describe("WorkbenchNotificationsView", () => {
    it("每条一行：没看过的带标记；点动作执行并从中心与弹出处移除，点移除只动中心", async () => {
        const {notifications, wrapper} = scene();
        const runs: string[] = [];
        notifications.notify({tone: "warning", title: "书架没有更新", message: "连接已断开", action: {label: "重试", run: () => runs.push("retry")}});
        notifications.notify({tone: "success", message: "已导出《雾港》"});
        await flushPromises();
        const rows = wrapper.findAll("[data-notification-entry]");
        expect(rows).toHaveLength(2);
        expect(rows[0]?.attributes("data-unread")).toBeDefined();
        expect(rows[0]?.attributes("data-tone")).toBe("success");
        expect(rows[1]?.text()).toContain("书架没有更新");
        expect(rows[1]?.text()).toContain("连接已断开");
        await rows[1]?.get("[data-notification-action]").trigger("click");
        expect(runs).toEqual(["retry"]);
        expect(notifications.queue.notifications.value.map((item) => item.message)).toEqual(["已导出《雾港》"]);
        await flushPromises();
        await wrapper.get("[data-notification-remove]").trigger("click");
        expect(notifications.center.entries.value).toEqual([]);
        expect(notifications.queue.notifications.value).toHaveLength(1);
        await flushPromises();
        expect(wrapper.get(".notifications-view__empty").text()).toBe("没有通知。");
    });

    it("有详情的带“详情”，打开的对话框标题是“通知标题：详情”，被截断时注明", async () => {
        const {notifications, wrapper} = scene();
        notifications.notify({tone: "error", title: "初始化 Skill pdf-tools", message: "连不上 registry.npmjs.org（超时）", detail: "bun install v1.4\nerror: ETIMEDOUT", detailTruncated: true});
        await flushPromises();
        await wrapper.get("[data-notification-detail]").trigger("click");
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain("初始化 Skill pdf-tools：详情");
        }, {timeout: 5_000});
        expect(document.body.textContent).toContain("ETIMEDOUT");
        expect(document.body.textContent).toContain("原文过长，已截断");
    });

    it("视图可见时中心全部算看过、新通知不弹出；不可见或卸载后照常弹出（输出 15、16）", async () => {
        const {notifications, shown, wrapper} = scene();
        notifications.notify({tone: "info", message: "先到的"});
        expect(notifications.center.unread.value).toBe(1);
        shown.value = true;
        await flushPromises();
        expect(notifications.center.unread.value).toBe(0);
        notifications.notify({tone: "error", message: "开着时到的"});
        expect(notifications.queue.notifications.value.map((item) => item.message)).toEqual(["先到的"]);
        shown.value = false;
        await flushPromises();
        notifications.notify({tone: "info", message: "关了以后到的"});
        expect(notifications.queue.notifications.value.map((item) => item.message)).toContain("关了以后到的");
        shown.value = true;
        await flushPromises();
        wrapper.unmount();
        notifications.notify({tone: "info", message: "卸载以后到的"});
        expect(notifications.queue.notifications.value.map((item) => item.message)).toContain("卸载以后到的");
        expect(notifications.center.unread.value).toBe(1);
    });
});
