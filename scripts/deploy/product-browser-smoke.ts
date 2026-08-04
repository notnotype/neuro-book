import {mkdir} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {pathToFileURL} from "node:url";

import {chromium, type Browser, type ConsoleMessage, type Page, type Request, type Response} from "playwright-core";

type SmokeOptions = {
    url: string;
    expectedVersion: string;
    browserExecutable: string;
    screenshot: string;
};

type BrowserFailure = {
    kind: "console" | "page" | "request" | "response";
    message: string;
};

const BROWSER_LAUNCH_TIMEOUT_MS = 60_000;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await runProductBrowserSmoke(parseOptions(process.argv.slice(2)));
}

/**
 * 启动CI明确指定的Chromium系浏览器，验证Product首页已完成Vue挂载。
 */
export async function runProductBrowserSmoke(input: SmokeOptions): Promise<void> {
    if (process.platform === "win32" && typeof Bun !== "undefined") {
        throw new Error("Windows Playwright smoke必须由Node运行；Bun 1.3.14无法可靠连接Chromium调试pipe。");
    }
    const failures: BrowserFailure[] = [];
    let browser: Browser | null = null;
    try {
        browser = await chromium.launch({
            executablePath: input.browserExecutable,
            headless: true,
            timeout: BROWSER_LAUNCH_TIMEOUT_MS,
        });
        const page = await browser.newPage();
        observePage(page, input.url, failures);
        await page.goto(input.url, {waitUntil: "domcontentloaded", timeout: 30_000});
        await page.locator(".novel-ide-page").waitFor({state: "visible", timeout: 30_000});
        await page.waitForTimeout(1_000);

        const versionResponse = await page.request.get(new URL("/api/app/version", input.url).href);
        if (!versionResponse.ok()) {
            failures.push({kind: "response", message: `版本接口返回 HTTP ${versionResponse.status()}`});
        } else {
            const version = await readVersion(versionResponse);
            if (version !== input.expectedVersion) {
                failures.push({kind: "response", message: `版本不匹配：期望 ${input.expectedVersion}，实际 ${version || "<empty>"}`});
            }
        }

        if (failures.length > 0) {
            await mkdir(dirname(input.screenshot), {recursive: true});
            await page.screenshot({path: input.screenshot, fullPage: true});
            throw new Error(formatFailures(failures, input.screenshot));
        }
        console.log(`Product browser smoke passed: ${input.url} (${input.expectedVersion})`);
    } finally {
        await browser?.close();
    }
}

/** 收集会阻止首页正常使用的浏览器级错误。 */
function observePage(page: Page, baseUrl: string, failures: BrowserFailure[]): void {
    const origin = new URL(baseUrl).origin;
    page.on("console", (message: ConsoleMessage) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
            failures.push({kind: "console", message: message.text()});
        }
    });
    page.on("pageerror", (error: Error) => failures.push({kind: "page", message: error.stack ?? error.message}));
    page.on("requestfailed", (request: Request) => {
        const url = request.url();
        if (url.startsWith(origin) && isCriticalResource(request)) {
            failures.push({kind: "request", message: `${request.method()} ${url}: ${request.failure()?.errorText ?? "failed"}`});
        }
    });
    page.on("response", (response: Response) => {
        if (response.url().startsWith(origin) && response.status() >= 400 && isCriticalResource(response.request())) {
            failures.push({kind: "response", message: `${response.status()} ${response.request().method()} ${response.url()}`});
        }
    });
}

/** HTML、JavaScript和CSS失败会直接阻止应用挂载，其他业务请求由各自界面和专项测试负责。 */
function isCriticalResource(request: Request): boolean {
    return ["document", "script", "stylesheet"].includes(request.resourceType());
}

/** 兼容版本接口的字符串与对象JSON返回。 */
async function readVersion(response: {json(): Promise<string | {version?: string; versionLabel?: string}>}): Promise<string> {
    const payload = await response.json();
    const version = typeof payload === "string" ? payload : payload.version ?? payload.versionLabel ?? "";
    return version.startsWith("v") ? version.slice(1) : version;
}

/** 解析发布流水线传入的明确参数。 */
function parseOptions(args: string[]): SmokeOptions {
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (!key?.startsWith("--") || !value) throw new Error(`无效参数：${args.slice(index).join(" ")}`);
        values.set(key, value);
    }
    const url = values.get("--url");
    const expectedVersion = values.get("--expected-version");
    const browserExecutable = values.get("--browser-executable");
    if (!url || !expectedVersion || !browserExecutable) {
        throw new Error("用法：node --import tsx scripts/deploy/product-browser-smoke.ts --url <url> --expected-version <version> --browser-executable <path> [--screenshot <path>]");
    }
    return {
        url: new URL(url).href,
        expectedVersion,
        browserExecutable: resolve(browserExecutable),
        screenshot: resolve(values.get("--screenshot") ?? ".agent/product-browser-smoke-failure.png"),
    };
}

/** 输出稳定、可读的发布门禁失败信息。 */
function formatFailures(failures: BrowserFailure[], screenshot: string): string {
    const details = failures.map((failure) => `- [${failure.kind}] ${failure.message}`).join("\n");
    return `Product browser smoke failed:\n${details}\nScreenshot: ${screenshot}`;
}
