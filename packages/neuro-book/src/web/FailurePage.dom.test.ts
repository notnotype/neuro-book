/**
 * 宿主页（runtime.browser-host 的失败页）：按窗口状态给出能恢复的动作。连接失败只能原地重试，版本不一致与启动
 * 失败只能刷新；启动中没有动作，读屏按状态播报而不是告警。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import FailurePage from "./FailurePage.vue";

describe("宿主页", () => {
    it("连接失败：显示原因，只给重试", async () => {
        const page = mount(FailurePage, {props: {state: {status: "connection-failed", reason: "HTTP 503 stopping"}}});
        expect(page.get("[data-browser-host-status]").attributes()).toMatchObject({"data-browser-host-status": "connection-failed", "role": "alert"});
        expect(page.text()).toContain("HTTP 503 stopping");
        expect(page.findAll("button").map((button) => button.text())).toEqual(["重试"]);
        await page.get("button").trigger("click");
        expect(page.emitted()).toHaveProperty("retry");
        expect(page.emitted()).not.toHaveProperty("reload");
    });

    it("版本不一致与启动失败：只给刷新页面", async () => {
        for (const status of ["incompatible", "startup-failed"] as const) {
            const page = mount(FailurePage, {props: {state: {status, reason: "原因"}}});
            expect(page.findAll("button").map((button) => button.text())).toEqual(["刷新页面"]);
            await page.get("button").trigger("click");
            expect(page.emitted()).toHaveProperty("reload");
        }
    });

    it("启动中：没有动作，按状态播报", () => {
        const page = mount(FailurePage, {props: {state: {status: "starting"}}});
        expect(page.get("[data-browser-host-status]").attributes("role")).toBe("status");
        expect(page.findAll("button")).toEqual([]);
    });
});
