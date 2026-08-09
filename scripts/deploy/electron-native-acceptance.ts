import {readFile, mkdir, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

import {_electron as electron, type ElectronApplication, type Page} from "playwright-core";

type Options = {
    productRoot: string;
    applicationRoot: string;
    stateRoot: string;
    cacheRoot: string;
    desktopRoot: string;
    manager: string;
    bun: string;
    evidenceDir: string;
    openFileDialog: boolean;
    holdMs: number;
};

type WindowSnapshot = {
    bounds: {x: number; y: number; width: number; height: number} | null;
    maximized: boolean;
    fullScreen: boolean;
    resizable: boolean;
    maximizable: boolean;
};

type NativeAcceptanceEvidence = {
    schema: "nbook.electron-native-acceptance/v1";
    window: {
        before: WindowSnapshot;
        maximized: WindowSnapshot;
        restored: WindowSnapshot;
    };
    tray: {
        installed: boolean;
        iconEmpty: boolean | null;
        iconPath: string | null;
    };
    fileDialog: {
        inputCount: number;
        accept: string | null;
        visibleButtonFound: boolean;
        fileChooserEvent: "observed" | "not-observable-over-cdp" | "not-requested";
        nativeUiRequired: boolean;
    };
    notes: string[];
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await run(parseOptions(process.argv.slice(2)));
}

export async function run(options: Options): Promise<NativeAcceptanceEvidence> {
    await mkdir(options.evidenceDir, {recursive: true});
    const electronExecutable = resolve("desktop", "electron", "node_modules", "electron", "dist", "electron.exe");
    const mainEntry = resolve("desktop", "electron", "dist", "main.mjs");
    const environment: NodeJS.ProcessEnv = {
        ...process.env,
        NBOOK_DESKTOP_DEVELOPMENT: "1",
        NBOOK_DESKTOP_DEV_PRODUCT_IMAGE_ROOT: options.productRoot,
        NBOOK_DESKTOP_DEV_APPLICATION_ROOT: options.applicationRoot,
        NBOOK_DESKTOP_DEV_STATE_ROOT: options.stateRoot,
        NBOOK_DESKTOP_DEV_CACHE_ROOT: options.cacheRoot,
        NBOOK_DESKTOP_DEV_DESKTOP_ROOT: options.desktopRoot,
        NBOOK_DESKTOP_DEV_MANAGER: options.manager,
        NBOOK_DESKTOP_DEV_BUN_EXECUTABLE: options.bun,
        NBOOK_DESKTOP_DEV_PORT: "0",
    };
    const app = await electron.launch({
        executablePath: electronExecutable,
        args: [mainEntry],
        env: environment,
        timeout: 60_000,
    });

    try {
        const page = await app.firstWindow();
        await waitForReady(page);
        await ensureProjectForFileDialog(page);
        const before = await windowSnapshot(app);
        const input = await inspectFileInput(page, options.openFileDialog, options.holdMs);
        const maximized = await runWindowTransition(app, "maximize");
        const restored = await runWindowTransition(app, "unmaximize");
        const tray = await readTrayEvidence(options.stateRoot);
        const evidence: NativeAcceptanceEvidence = {
            schema: "nbook.electron-native-acceptance/v1",
            window: {
                before,
                maximized,
                restored,
            },
            tray,
            fileDialog: input,
            notes: [
                "Window maximize/unmaximize is exercised through the real Electron BrowserWindow.",
                "Windows Snap Layout flyout and native file chooser are OS-owned surfaces; verify them with Windows UI automation.",
            ],
        };
        await writeFile(
            resolve(options.evidenceDir, "electron-native-acceptance.json"),
            `${JSON.stringify(evidence, null, 4)}\n`,
            "utf8",
        );
        return evidence;
    } finally {
        await app.close();
    }
}

async function waitForReady(page: Page): Promise<void> {
    await page.waitForURL(/127\.0\.0\.1/u, {timeout: 60_000});
    await page.locator(".novel-ide-page").waitFor({state: "visible", timeout: 60_000});
}

async function windowSnapshot(app: ElectronApplication): Promise<WindowSnapshot> {
    return await app.evaluate(({BrowserWindow}) => {
        const current = BrowserWindow.getAllWindows()[0];
        return {
            bounds: current?.getBounds() ?? null,
            maximized: current?.isMaximized() ?? false,
            fullScreen: current?.isFullScreen() ?? false,
            resizable: current?.isResizable() ?? false,
            maximizable: current?.isMaximizable() ?? false,
        };
    });
}

async function runWindowTransition(app: ElectronApplication, action: "maximize" | "unmaximize"): Promise<WindowSnapshot> {
    await app.evaluate(({BrowserWindow}, target) => {
        const current = BrowserWindow.getAllWindows()[0];
        if (!current) throw new Error("Electron 主窗口不存在。");
        if (target === "maximize") current.maximize();
        else current.unmaximize();
    }, action);
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 250));
    return await windowSnapshot(app);
}

async function inspectFileInput(
    page: Page,
    openFileDialog: boolean,
    holdMs: number,
): Promise<NativeAcceptanceEvidence["fileDialog"]> {
    const coverButton = page.locator('button[aria-label*="设置封面"], button[aria-label*="cover" i]').first();
    const visibleButtonFound = await coverButton.count() > 0;
    const inputs = page.locator('input[type="file"]');
    let inputCount = await inputs.count();
    let fileChooserEvent: NativeAcceptanceEvidence["fileDialog"]["fileChooserEvent"] = openFileDialog
        ? "not-observable-over-cdp"
        : "not-requested";

    if (openFileDialog && visibleButtonFound) {
        await coverButton.click();
        const chooseButton = page.getByRole("button", {name: /选择封面|替换封面|选择图片|替换图片|Choose cover|Replace cover|Choose Image|Replace Image/u}).first();
        await chooseButton.waitFor({state: "visible", timeout: 5_000});
        inputCount = await inputs.count();
        const chooserPromise = page.waitForEvent("filechooser", {timeout: 2_000});
        await chooseButton.click();
        try {
            await chooserPromise;
            fileChooserEvent = "observed";
        } catch {
            // Chromium's native chooser is outside the CDP target in some Electron builds.
            fileChooserEvent = "not-observable-over-cdp";
        }
        if (holdMs > 0) await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, holdMs));
    } else if (visibleButtonFound) {
        await coverButton.click();
        await page.getByRole("button", {name: /选择封面|替换封面|选择图片|替换图片|Choose cover|Replace cover|Choose Image|Replace Image/u}).first().waitFor({state: "visible", timeout: 5_000});
        inputCount = await inputs.count();
        await page.keyboard.press("Escape");
    }

    return {
        inputCount,
        accept: inputCount > 0 ? await inputs.first().getAttribute("accept") : null,
        visibleButtonFound,
        fileChooserEvent,
        nativeUiRequired: true,
    };
}

async function ensureProjectForFileDialog(page: Page): Promise<void> {
    const coverButton = page.locator('button[aria-label*="设置封面"], button[aria-label*="cover" i]').first();
    if (await coverButton.count() > 0) return;
    const title = `Native UI ${Date.now()}`;
    const response = await page.evaluate(async (projectTitle) => {
        const result = await fetch("/api/projects", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({title: projectTitle, summary: "native acceptance"}),
        });
        return {status: result.status, body: await result.json() as unknown};
    }, title);
    if (response.status !== 200) throw new Error(`创建原生验收 Project 失败：HTTP ${response.status}`);
    await page.reload({waitUntil: "domcontentloaded"});
    await page.locator(".novel-ide-page").waitFor({state: "visible", timeout: 60_000});
}

async function readTrayEvidence(stateRoot: string): Promise<NativeAcceptanceEvidence["tray"]> {
    const logPath = resolve(stateRoot, "logs", "desktop-envelope-current.jsonl");
    try {
        const lines = (await readFile(logPath, "utf8")).trim().split(/\r?\n/u).reverse();
        const event = lines
            .map((line) => JSON.parse(line) as Record<string, unknown>)
            .find((item) => item.kind === "electron-tray-installed");
        return {
            installed: Boolean(event),
            iconEmpty: typeof event?.iconEmpty === "boolean" ? event.iconEmpty : null,
            iconPath: typeof event?.iconPath === "string" ? event.iconPath : null,
        };
    } catch {
        return {installed: false, iconEmpty: null, iconPath: null};
    }
}

function parseOptions(argv: string[]): Options {
    const values = new Map<string, string>();
    for (let index = 0; index < argv.length; index += 1) {
        const key = argv[index];
        if (!key?.startsWith("--")) continue;
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) throw new Error(`缺少参数值：${key}`);
        values.set(key, value);
        index += 1;
    }
    const required = (key: string): string => {
        const value = values.get(key);
        if (!value) throw new Error(`缺少参数：${key}`);
        return resolve(value);
    };
    const holdMs = Number(values.get("--hold-ms") ?? "0");
    if (!Number.isInteger(holdMs) || holdMs < 0 || holdMs > 60_000) throw new Error("--hold-ms 必须是 0-60000 的整数。");
    return {
        productRoot: required("--product-root"),
        applicationRoot: required("--application-root"),
        stateRoot: required("--state-root"),
        cacheRoot: required("--cache-root"),
        desktopRoot: required("--desktop-root"),
        manager: required("--manager"),
        bun: required("--bun"),
        evidenceDir: required("--evidence-dir"),
        openFileDialog: values.get("--open-file-dialog") === "true",
        holdMs,
    };
}
