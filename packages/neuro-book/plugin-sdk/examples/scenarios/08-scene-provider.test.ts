/**
 * 场景 8：主题与场景提供者（`plugins/scene-clock`）。
 *
 * 要说明的事：
 * - 主题是顶层声明，没有实现：宿主把它登记进窗口，主题声明里的 `sceneProvider` 只是一个贡献 id。
 * - 场景提供者是浏览器入口的贡献，实现要等入口激活才交到工作台。入口写了 `onStartup`，窗口一启动就激活、实现就位；入口停止时
 *   内核撤回，工作台这时退回主题的后备图（没写后备就没有场景）。
 * - 天空的颜色是纯函数，随钟点、明暗与“工作中”变；`expiresAt` 取下一个整点，宿主到点重新请求。画布部分在 Bun 里没有，
 *   由 `e2e/plugin-code.e2e.ts` 里装进真实浏览器后核对。
 *
 * 阅读顺序：`plugins/scene-clock/shared/contracts.ts` → `plugins/scene-clock/plugin.ts` → `plugins/scene-clock/web/sky.ts` →
 * `plugins/scene-clock/web/plugin.ts` → 这里。
 *
 * 行为合同：docs/specs/theme/skins.md（输出 18）、docs/specs/runtime/plugins.md（贡献的发布与撤回）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {definitionAt} from "nbook/manifest";
import {WORKBENCH_THEME_SCENES_POINT, WORKBENCH_THEMES_POINT} from "nbook/plugins/workbench/shared/theme-points";

import {descriptor, SKY_THEME} from "../plugins/scene-clock/plugin";
import {SKY_PROVIDER} from "../plugins/scene-clock/shared/contracts";
import {sceneClockBrowserPlugin} from "../plugins/scene-clock/web/plugin";
import {nextHour, skyAt} from "../plugins/scene-clock/web/sky";
import {Stage} from "../testing/stage";
import {workbenchStandIn} from "../testing/workbench";

let tmp = "";
let cases = 0;
const stages: Stage[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-examples", "示例场景 8：场景提供者");
});

afterEach(async () => {
    for (const stage of stages.splice(0)) {
        for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
    }
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function world() {
    cases += 1;
    const stage = new Stage(join(tmp, `case-${String(cases)}`));
    stages.push(stage);
    const {router} = await stage.server({plugins: []});
    const workbench = workbenchStandIn();
    const window = await stage.window(router, "w1", {plugins: [workbench.definition, definitionAt("browser", descriptor, sceneClockBrowserPlugin)]});
    return {stage, window, workbench};
}

describe("场景 8：主题与场景提供者", () => {
    it("主题被接受，声明里的 sceneProvider 就是入口贡献的提供者；入口启动即激活，实现交到工作台", async () => {
        const {window, workbench} = await world();
        const theme = window.plugins.contribution(WORKBENCH_THEMES_POINT, SKY_THEME)[0];
        expect(theme?.validation).toEqual({status: "accepted"});
        expect((theme?.declaration as {readonly sceneProvider?: string}).sceneProvider).toBe(SKY_PROVIDER);

        const provider = window.plugins.contribution(WORKBENCH_THEME_SCENES_POINT, SKY_PROVIDER)[0];
        expect(provider?.validation).toEqual({status: "accepted"});
        expect(provider).toMatchObject({status: "available", delivery: {status: "delivered", receiver: {plugin: "nbook.workbench"}}});
        expect(typeof workbench.sceneProvider(SKY_PROVIDER)?.scene).toBe("function");
    });

    it("入口停止后实现被撤回：工作台读不到提供者，主题声明还在", async () => {
        cases += 1;
        const stage = new Stage(join(tmp, `case-${String(cases)}`));
        stages.push(stage);
        const {router} = await stage.server({plugins: []});
        const workbench = workbenchStandIn();
        const window = await stage.window(router, "w1", {plugins: [workbench.definition]});
        // 把天空插件装进可以单独停止的作用域（产品里对应停用插件）。
        const sky = await stage.attach(window, definitionAt("browser", descriptor, sceneClockBrowserPlugin), "browser");
        expect(workbench.sceneProvider(SKY_PROVIDER)).not.toBeNull();

        expect((await sky.stop()).status).toBe("closed");
        // 内核撤回实现（原因 `scope-closed`）；工作台这时退回主题的后备图。
        expect(workbench.sceneProvider(SKY_PROVIDER)).toBeNull();
        expect(window.plugins.contribution(WORKBENCH_THEME_SCENES_POINT, SKY_PROVIDER)[0]).toMatchObject({status: "revoked", reason: "scope-closed"});
    });

    it("天空随钟点、明暗与工作中变；expiresAt 取下一个整点", () => {
        const noon = skyAt(12, "light", false);
        expect(noon).not.toEqual(skyAt(23, "light", false));
        expect(skyAt(12, "dark", false)).not.toEqual(noon);
        expect(skyAt(12, "light", true)).not.toEqual(noon);
        // 钟点按 24 小时取模。
        expect(skyAt(36, "light", false)).toEqual(skyAt(12, "light", false));

        const at = new Date(2026, 10, 6, 14, 37, 12).getTime();
        expect(nextHour(at)).toBe(new Date(2026, 10, 6, 15, 0, 0).getTime());
    });
});
