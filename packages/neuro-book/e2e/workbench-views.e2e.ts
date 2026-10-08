/**
 * 外壳二在真实 Chrome 中的验收（docs/specs/ui/workbench-shell.md 外壳二验收 14–18、26–31，docs/specs/workbench/views.md
 * 验收 1–5）：生产构建的 e2e 测试外壳与宿主测试入口，测试插件 `test.sample-views`（src/web/testing/sample-views.ts）
 * 贡献五个视图。等页面上可观察的变化，不按时长等待。
 *
 * 不在这里的：落位与意图合成的逐条规则（`views/model.test.ts`）、两个窗口与保存失败（`state/layout-store.test.ts`）、
 * 注册表与内核撤回的串行窗口（`views/registry.test.ts`）、命令的参数与过期（`commands/view-commands.test.ts`）。
 */

import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

const A = "test.sample-views.alpha";
const B = "test.sample-views.beta";
const C = "test.sample-views.gamma";
const D = "test.sample-views.delta";
const E = "test.sample-views.omega";

const sample = (page: Page, viewId: string) => page.locator(`[data-sample-view="${viewId}"]`);

async function instanceOf(page: Page, viewId: string): Promise<{instance: string | null; generation: string | null; location: string | null}> {
    return sample(page, viewId).evaluate((element) => ({instance: element.getAttribute("data-instance"), generation: element.getAttribute("data-generation"), location: element.getAttribute("data-location")}));
}

test.describe("产品页：测试插件贡献的视图", () => {
    let tmp = "";
    let server: ProbeServer;

    test.beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-views");
        await mkdir(join(tmp, "state"), {recursive: true});
        server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.sample-views"}});
    });

    test.afterAll(async () => {
        expect(await server.stop()).toBe(0);
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    test.use({viewport: {width: 1440, height: 900}});

    async function open(page: Page): Promise<void> {
        await page.goto(server.url);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-shell-focus-target=\"panel-toggle\"]")).toBeEnabled();
    }

    test("全链路：视图按声明出现在默认位置，第一次有效可见才加载，代际为 1", async ({page}) => {
        await open(page);
        await expect(sample(page, A)).toBeVisible();
        expect(await instanceOf(page, A)).toMatchObject({generation: "1", location: "sidebar"});
        await expect(sample(page, D)).toBeVisible();
        await expect(sample(page, E)).toBeVisible();
        // 侧栏的乙、丙在没选中的容器里：还没加载。
        await expect(page.locator(`[data-view-frame="${B}"]`)).toHaveCount(0);
        await expect(page.locator("[data-activity-container]")).toHaveCount(3);
    });
});
