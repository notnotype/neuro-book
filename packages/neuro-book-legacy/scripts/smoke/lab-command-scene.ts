import type {Page, Request} from "playwright-core";
import type {SmokeFailure} from "./agent-profile-nav";
import {assert} from "./agent-profile-nav";

const TREE_ITEM = '.lab-columns > .nb-lab-panel--nav [role="treeitem"]';
/** 打开中的命令面板：QuickInput 把 attrs 落在 portal 出的对话框根上，受检标记只在打开时存在。 */
const OPEN_PALETTE = '[role="dialog"][data-lab-subject]';
const ANY_DIALOG = '[role="dialog"]';
/**
 * 任何页面都会探一次登录会话：`nuxt-auth-utils` 的客户端插件取 `/api/_auth/session`，
 * 鉴权中间件取 `/api/auth/me`。它们是身份探测，不是产品配置 / Project / Storage 请求。
 */
const ALLOWED_LAB_API = new Set(["/api/_auth/session", "/api/auth/me"]);
const STAGING_DATABASE = "nbook.storage-migration";

/**
 * 在导航到 `/lab` 之前调用：记录 Lab 文档启动窗口里的所有 `/api/` 请求。
 * 返回的 `settle` 等到网络空闲后停止记录并给出断言。
 */
export function watchLabBootstrapRequests(page: Page, origin: string): {settle: (failures: SmokeFailure[]) => Promise<void>} {
    const seen: string[] = [];
    const onRequest = (request: Request): void => {
        const url = new URL(request.url());
        if (url.origin === origin && url.pathname.startsWith("/api/")) {
            seen.push(`${request.method()} ${url.pathname}`);
        }
    };
    page.on("request", onRequest);
    return {
        async settle(failures) {
            try {
                await page.waitForLoadState("networkidle", {timeout: 15_000});
            } finally {
                page.off("request", onRequest);
            }
            const product = seen.filter((entry) => !ALLOWED_LAB_API.has(entry.slice(entry.indexOf(" ") + 1)));
            assert(product.length === 0, failures, `Lab 文档启动不应发产品请求：${product.join("、")}`);
            const databases = await page.evaluate(async () => (await indexedDB.databases()).map((entry) => entry.name ?? ""));
            assert(!databases.includes(STAGING_DATABASE), failures, `Lab 文档启动不应建立旧桶迁移暂存（${STAGING_DATABASE}）`);
        },
    };
}

/**
 * 从 Lab 经应用内路由进入产品页必须整页加载：产品启动接线（旧桶迁移、配色配置）只在文档启动时运行，
 * Lab 文档跳过了它们。用页面自己的 router 发起导航（等价于应用内链接），以窗口标记是否消失判断文档是否重建。
 */
export async function leaveLabThroughRouter(page: Page, path: string, failures: SmokeFailure[]): Promise<void> {
    const pushed = await page.evaluate((target) => {
        const marker = window as unknown as Record<string, unknown>;
        marker.__nbLabDocument = true;
        const container = document.querySelector("#__nuxt") as unknown as {
            __vue_app__?: {config: {globalProperties: {$router?: {push: (to: string) => Promise<unknown>}}}};
        } | null;
        const router = container?.__vue_app__?.config.globalProperties.$router;
        if (!router) {
            return false;
        }
        void router.push(target);
        return true;
    }, path);
    assert(pushed, failures, "Lab 页面上找不到应用 router，无法验证跨宿主导航");
    if (!pushed) {
        return;
    }
    const arrived = await page
        .waitForFunction((target) => location.pathname === target && document.readyState === "complete", path, {timeout: 30_000})
        .then(() => true, () => false);
    const state = await page.evaluate(() => ({
        pathname: location.pathname,
        sameDocument: (window as unknown as Record<string, unknown>).__nbLabDocument === true,
    }));
    assert(arrived, failures, `从 Lab 经应用内路由进入 ${path} 未在 30 秒内完成（当前 ${state.pathname}，${state.sameDocument ? "仍是 Lab 文档" : "文档已重建"}）`);
    assert(!state.sameDocument, failures, `从 Lab 经应用内路由进入 ${path} 应整页加载（产品启动接线需要重跑），实际仍停留在 Lab 文档`);
    if (!arrived || state.sameDocument) {
        // 失败已记录；整页打开目标页，让后续步骤在确定状态下继续并一起汇报。
        await page.goto(new URL(path, page.url()).href, {waitUntil: "domcontentloaded", timeout: 30_000});
    }
}

/**
 * 命令场景的宿主边界：面板、键位与执行审计只存在于命令场景自己的局部宿主里。
 *
 * - WorkbenchCommandPalette 场景：真实 Monaco 就绪，Ctrl/Cmd+Shift+P 打开受检面板，Escape 关闭，
 *   执行记录进 Lab 事件 tab，命令检视出现在底部控制抽屉；
 * - 切到非命令组件后同一快捷键不再打开任何面板——上一场景的键位监听已随场景释放。
 */
export async function assertLabCommandSceneSmoke(page: Page, failures: SmokeFailure[]): Promise<void> {
    let stage = "准备";
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    try {
        stage = "选择 WorkbenchCommandPalette 并等真实编辑器就绪";
        await page.locator(TREE_ITEM).filter({hasText: /^WorkbenchCommandPalette$/u}).click();
        await page.locator(".monaco-editor").first().waitFor({state: "visible", timeout: 30_000});
        await page.getByText("内核就绪", {exact: true}).first().waitFor({state: "visible", timeout: 30_000});
        assert(
            await page.locator("[data-lab-command-inspector]").count() === 1,
            failures,
            "命令场景应在底部控制抽屉提供命令检视",
        );

        stage = "快捷键打开本场景面板";
        await page.keyboard.press(`${modifier}+Shift+P`);
        await page.locator(OPEN_PALETTE).first().waitFor({state: "visible", timeout: 10_000});

        stage = "Escape 关闭面板";
        await page.keyboard.press("Escape");
        await page.locator(ANY_DIALOG).first().waitFor({state: "detached", timeout: 10_000});

        stage = "执行记录进入 Lab 事件";
        await page.locator('[role="tab"]').filter({hasText: "事件"}).click();
        await page.locator('[data-lab-panel="events"]').getByText("nbook.quick-open.open-commands").first()
            .waitFor({state: "visible", timeout: 10_000});

        stage = "切到非命令组件后快捷键不再生效";
        await page.locator(TREE_ITEM).filter({hasText: /^JsonViewer$/u}).click();
        await page.getByText("当前内容可以解析", {exact: false}).first().waitFor({state: "visible", timeout: 10_000});
        await page.keyboard.press(`${modifier}+Shift+P`);
        await page.waitForTimeout(400);
        assert(await page.locator(ANY_DIALOG).count() === 0, failures, "非命令场景按 Ctrl/Cmd+Shift+P 不应打开任何面板（上一场景的键位监听应已释放）");
        assert(await page.locator("[data-lab-command-inspector]").count() === 0, failures, "离开命令场景后命令检视应随场景卸载");
    } catch (error) {
        failures.push({
            kind: "assertion",
            message: `Lab 命令场景 smoke 在阶段 [${stage}] 失败：${error instanceof Error ? error.message : String(error)}`,
        });
    }
}
