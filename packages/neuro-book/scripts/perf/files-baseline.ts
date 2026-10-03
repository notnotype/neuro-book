#!/usr/bin/env bun
import {access, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import {hostname, loadavg, cpus, totalmem} from "node:os";
import {basename, dirname, join, resolve} from "node:path";
import {randomBytes} from "node:crypto";
import {spawn, spawnSync} from "node:child_process";
import {chromium, type BrowserContext, type Page} from "playwright-core";
import {z} from "zod";
import {applicationEnvironment, waitForApplicationReady, shutdownNativeProduct} from "@notnotype/neuro-book-manager/product-control";
import {PRODUCT_BUN_RUNTIME_ARGS, PRODUCT_RUNTIME_COMMAND_BOOTSTRAP, PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT, PRODUCT_STARTUP_NONCE_ENVIRONMENT} from "@notnotype/neuro-book-contracts/product-runtime";
import {resolveAgentTempRoot} from "@notnotype/neuro-book-test-support/paths";
import {buildSamplePlan, writeSampleFiles, type SamplePlan, type SamplePlanEntry} from "./files-sample-generator";
import {installObservers, measureClick, verifyInput, type ReadyTarget} from "./files-baseline-browser";
import {composition, profileBrowser, readServerProfile, stats, summarize, type EditorMode, type Environment, type ProfileEvidence, type Sample} from "./files-baseline-observations";
import {markdownReport, timingPoints, type MeasurementReport} from "./files-baseline-report";
import {loadProductionBaseline, type ProductionProvenance} from "./files-baseline-resume";

type Options = {
    reportPath: string; skipBuild: boolean; iterations: number; openIterations: number;
    fileCount: number; seed: number; minBytes: number; maxBytes: number; wideDirectoryChildren: number;
    browserExecutable: string; includeDevelopment: boolean; resumeProduction: string | null;
};
type ProductProcess = {
    url: string; port: number; dispose(): Promise<void>;
};
type Run = {
    options: Options; plan: SamplePlan; stateRoot: string; runRoot: string; evidenceRoot: string; stem: string;
    raw: Sample[]; profiles: ProfileEvidence[]; context: BrowserContext; page: Page; product: ProductProcess;
    environment: Environment; projectRoot: string; startSequence: number;
};

const appRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(appRoot, "../..");
const imageRoot = join(repositoryRoot, ".output");
const defaultEvidenceRoot = join(repositoryRoot, ".agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences");
const adminUsername = "admin";
const adminPassword = "t42-files-baseline-admin-password-42017";

function parseOptions(argv: readonly string[]): Options {
    const options: Options = {
        reportPath: join(defaultEvidenceRoot, "baseline-report.json"), skipBuild: false, iterations: 30, openIterations: 10,
        fileCount: 3_000, seed: 42_017, minBytes: 5 * 1024, maxBytes: 30 * 1024, wideDirectoryChildren: 400,
        browserExecutable: "/usr/bin/google-chrome-stable", includeDevelopment: false, resumeProduction: null,
    };
    const numeric: Record<string, "iterations" | "openIterations" | "fileCount" | "seed" | "minBytes" | "maxBytes" | "wideDirectoryChildren"> = {
        "--iterations": "iterations", "--open-iterations": "openIterations", "--file-count": "fileCount", "--seed": "seed",
        "--min-bytes": "minBytes", "--max-bytes": "maxBytes", "--wide-directory-children": "wideDirectoryChildren",
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index]!;
        if (argument === "--skip-build") options.skipBuild = true;
        else if (argument === "--include-development") options.includeDevelopment = true;
        else if (argument === "--resume-production") {
            const value = argv[++index];
            if (!value) throw new Error("--resume-production 缺少报告路径");
            options.resumeProduction = resolve(repositoryRoot, value);
        }
        else if (argument === "--report" || argument === "--browser-executable") {
            const value = argv[++index];
            if (!value) throw new Error(`${argument} 缺少路径`);
            options[argument === "--report" ? "reportPath" : "browserExecutable"] = resolve(repositoryRoot, value);
        } else if (numeric[argument]) {
            const value = Number(argv[++index]);
            if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${argument} 必须是正整数`);
            options[numeric[argument]!] = value;
        } else throw new Error(`未知参数：${argument}`);
    }
    if (!options.reportPath.endsWith(".json")) throw new Error("--report 必须指定 .json 文件");
    if (options.resumeProduction && (!options.skipBuild || options.resumeProduction === options.reportPath)) throw new Error("续跑必须 --skip-build，并写入不同的报告路径");
    if (options.minBytes > options.maxBytes) throw new Error("--min-bytes 不能大于 --max-bytes");
    if (options.wideDirectoryChildren < 2 * (options.iterations + 2) + 2) throw new Error("宽目录文件数须至少为 2*(iterations+2)+2，供双组冷开、预热与独立采样");
    return options;
}

async function runCaptured(args: string[], stateRoot: string | null, logPath: string, stdin?: string): Promise<void> {
    const env = stateRoot ? await applicationEnvironment(repositoryRoot, stateRoot, false, join(stateRoot, "cache")) : process.env;
    const child = spawn(process.execPath, args, {cwd: stateRoot ? repositoryRoot : appRoot, env, stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"]});
    const chunks: string[] = [];
    child.stdout?.on("data", (chunk) => chunks.push(String(chunk)));
    child.stderr?.on("data", (chunk) => chunks.push(String(chunk)));
    if (stdin !== undefined) child.stdin?.end(stdin);
    const result = await new Promise<{code: number | null; signal: string | null}>((done, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => done({code, signal}));
    });
    await writeFile(logPath, chunks.join(""));
    if (result.code !== 0) throw new Error(`命令 ${args.join(" ")} 失败：${JSON.stringify(result)}；详见 ${logPath}`);
}

async function prepareStateRoot(stateRoot: string, logRoot: string): Promise<void> {
    await mkdir(stateRoot, {recursive: true});
    const bootstrap = join(imageRoot, ...PRODUCT_RUNTIME_COMMAND_BOOTSTRAP.split("/"));
    for (const [name, args, stdin] of [
        ["migrate-database", ["command", "migrate-database"], undefined],
        ["migrate-application-state", ["command", "migrate-application-state", "--apply"], undefined],
        ["create-admin", ["command", "create-admin", adminUsername, "--password-stdin"], adminPassword],
    ] as const) {
        await runCaptured([...PRODUCT_BUN_RUNTIME_ARGS, bootstrap, ...args], stateRoot, join(logRoot, `${name}.log`), stdin);
    }
}

async function startProduct(stateRoot: string, logPath: string, environment: Environment, profileDirectory?: string): Promise<ProductProcess> {
    const info = z.object({version: z.string().min(1)}).parse(JSON.parse(await readFile(join(imageRoot, "server/package.json"), "utf8")));
    const socket = createServer();
    await new Promise<void>((done, reject) => {socket.once("error", reject); socket.listen(0, "127.0.0.1", done);});
    const address = socket.address();
    if (!address || typeof address === "string") throw new Error("未能分配空闲端口");
    const port = address.port;
    await new Promise<void>((done, reject) => socket.close((error) => error ? reject(error) : done()));
    const token = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const env = await applicationEnvironment(repositoryRoot, stateRoot, environment === "development", join(stateRoot, "cache"));
    Object.assign(env, {PORT: String(port), NUXT_PORT: String(port), NITRO_PORT: String(port), HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1",
        [PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]: token, [PRODUCT_STARTUP_NONCE_ENVIRONMENT]: nonce});
    delete env.NODE_PATH;
    let args: string[];
    let cwd = repositoryRoot;
    if (environment === "development") {
        env.NEURO_BOOK_APPLICATION_ROOT = appRoot;
        env.NEURO_BOOK_REPOSITORY_ROOT = repositoryRoot;
        // 与 Manager 相同：脚本持有 shutdown token，直接拥有 dev:runtime。
        args = ["--no-install", "run", "dev:runtime"];
        cwd = appRoot;
    } else if (profileDirectory) {
        // 正常 Product 启动已经准备资产与持久 session password；直接采样真正服务进程，避免只采到 wrapper。
        env.NEURO_BOOK_RUNTIME_ASSET_MODE = "install";
        args = [...PRODUCT_BUN_RUNTIME_ARGS, "--cpu-prof", "--cpu-prof-dir", profileDirectory, "--cpu-prof-name", "server-project-open.cpuprofile", join(imageRoot, "server/index.mjs")];
    } else {
        args = [...PRODUCT_BUN_RUNTIME_ARGS, join(imageRoot, ...PRODUCT_RUNTIME_COMMAND_BOOTSTRAP.split("/")), "command", "start"];
    }
    const child = spawn(process.execPath, args, {cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"]});
    const chunks: string[] = [];
    child.stdout?.on("data", (chunk) => chunks.push(String(chunk)));
    child.stderr?.on("data", (chunk) => chunks.push(String(chunk)));
    const completion = new Promise<{code: number | null; signal: string | null}>((done, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => done({code, signal}));
    });
    const terminate = (signal: NodeJS.Signals): void => {
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
        try {process.kill(-child.pid, signal);} catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
            console.warn(`自有进程组已经退出：${String(child.pid)}`);
        }
    };
    let disposed = false;
    const dispose = async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        const hardStop = setTimeout(() => terminate("SIGKILL"), 30_000);
        try {
            if (child.exitCode === null && child.signalCode === null) await shutdownNativeProduct({port, token, completion, forceTerminate: async () => terminate("SIGTERM")});
            await completion;
        } catch (error) {
            chunks.push(`服务收口失败：${String(error)}\n`);
            terminate("SIGKILL");
            await completion;
            throw error;
        } finally {
            clearTimeout(hardStop);
            await writeFile(logPath, chunks.join(""));
        }
    };
    try {
        await waitForApplicationReady(port, info.version, completion, environment === "development" ? 240_000 : 120_000, nonce);
    } catch (error) {
        terminate("SIGTERM");
        const timer = setTimeout(() => terminate("SIGKILL"), 5_000);
        try {await completion;} finally {clearTimeout(timer); await writeFile(logPath, `${chunks.join("")}\n${String(error)}\n`);}
        throw new Error(`${environment} 启动失败；详见 ${logPath}`, {cause: error});
    }
    return {url: `http://127.0.0.1:${port}`, port, dispose};
}

async function loginAndOpenBase(page: Page, url: string, environment: Environment = "production"): Promise<void> {
    await page.goto(url, {waitUntil: "domcontentloaded", timeout: 120_000});
    // Source Dev 首次编译会重载页面；先等真实界面建立，再提交登录。
    await page.locator('[data-project-picker-view], [data-role="files-explorer-view"], input[autocomplete="current-password"]').first().waitFor({state: "visible", timeout: 120_000});
    if (environment === "development" && await page.locator('input[autocomplete="current-password"]').isVisible()) {
        await page.locator('input[autocomplete="username"]').fill(adminUsername);
        await page.locator('input[autocomplete="current-password"]').fill(adminPassword);
        await page.locator('button[type="submit"]').click();
        await page.locator('[data-project-picker-view]').waitFor({state: "visible", timeout: 120_000});
        return;
    }
    const result = await page.evaluate(async ({username, password}) => {
        const response = await fetch("/api/auth/login", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({username, password})});
        return {status: response.status, body: await response.text()};
    }, {username: adminUsername, password: adminPassword});
    if (result.status !== 200) throw new Error(`登录失败：HTTP ${result.status} ${result.body}`);
    await page.reload({waitUntil: "domcontentloaded", timeout: 120_000});
    await page.locator('[data-project-picker-view], [data-role="files-explorer-view"]').first().waitFor({state: "visible", timeout: 120_000});
}

async function seedProject(run: Run, mode: EditorMode): Promise<string> {
    let root: string;
    if (run.environment === "development") {
        // 开发模块图很大；真实 UI 的 SPA 路由避免反复销毁整页后重新并发加载。
        await run.page.locator('.picker-header-actions button').last().click();
        await run.page.locator('#create-book-title').fill(`T42 ${run.environment} ${mode} ${run.plan.seed}`);
        const responsePromise = run.page.waitForResponse((response) => new URL(response.url()).pathname === "/api/projects" && response.request().method() === "POST", {timeout: 30_000});
        await run.page.locator('button[form="create-project-form"]').click();
        const response = await responsePromise;
        if (!response.ok()) throw new Error(`创建项目失败：HTTP ${response.status()} ${await response.text()}`);
        root = z.object({project: z.object({projectRoot: z.string().min(1)})}).parse(await response.json()).project.projectRoot;
        await run.page.locator('[data-role="files-explorer-view"]').waitFor({state: "visible", timeout: 60_000});
        run.projectRoot = root;
        await closeProject(run);
    } else {
        const result = await run.page.evaluate(async (title) => {
            const response = await fetch("/api/projects", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({title, summary: "T42 synthetic Files baseline"})});
            const body: unknown = await response.json();
            return {status: response.status, body};
        }, `T42 ${run.environment} ${mode} ${run.plan.seed}`);
        if (result.status < 200 || result.status >= 300) throw new Error(`创建项目失败：HTTP ${result.status} ${JSON.stringify(result.body)}`);
        root = z.object({project: z.object({projectRoot: z.string().min(1)})}).parse(result.body).project.projectRoot;
    }
    await writeSampleFiles(join(run.stateRoot, "workspace", root), run.plan);
    run.projectRoot = root;
    if (run.environment === "production") await run.page.goto(`${run.product.url}/`, {waitUntil: "domcontentloaded"});
    const setup = await openAndMeasure(run, "setup", 0);
    if (setup.status !== "pass") throw new Error(`初次打开配置项目失败：${setup.error}`);
    const result = await run.page.evaluate(async ({root, association}) => {
        const query = new URLSearchParams({workspaceKind: "novel", projectRoot: root});
        const response = await fetch(`/api/config/project?${query}`, {method: "PUT", headers: {"content-type": "application/json"}, body: JSON.stringify({editor: {associations: {".md": association}}})});
        return {status: response.status, body: await response.text()};
    }, {root, association: mode === "rich" ? "markdown" : "code"});
    if (result.status < 200 || result.status >= 300) throw new Error(`配置 ${mode} 失败：HTTP ${result.status} ${result.body}`);
    await closeProject(run);
    return root;
}

async function closeProject(run: Run): Promise<void> {
    if (run.environment === "development") {
        await run.page.locator('[data-titlebar-action="bookshelf-direct"]').click();
        await run.page.locator('[data-project-picker-view]').waitFor({state: "visible", timeout: 60_000});
    } else await run.page.close();
    let failure = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await run.context.request.post(`${run.product.url}/api/projects/close`, {data: {projectRoot: run.projectRoot}});
        if (response.ok()) {failure = ""; break;}
        failure = `HTTP ${response.status()} ${await response.text()}`;
        if (response.status() !== 409) break;
        await new Promise<void>((done) => setTimeout(done, 500));
    }
    if (failure) throw new Error(`关闭项目失败：${failure}`);
    if (run.environment === "production") {
        run.page = await run.context.newPage();
        await loginAndOpenBase(run.page, run.product.url);
        await run.page.locator("[data-project-picker-view]").waitFor({state: "visible", timeout: 30_000});
    }
}

async function restart(run: Run, environment: Environment, profileDirectory?: string): Promise<void> {
    await run.page.close();
    await run.product.dispose();
    run.environment = environment;
    run.startSequence += 1;
    run.product = await startProduct(run.stateRoot, join(run.evidenceRoot, `${run.stem}-${environment}-${run.startSequence}.log`), environment, profileDirectory);
    run.page = await run.context.newPage();
    await loginAndOpenBase(run.page, run.product.url, environment);
    await run.page.locator("[data-project-picker-view]").waitFor({state: "visible", timeout: 30_000});
}

async function openAndMeasure(run: Run, variant: string, iteration: number): Promise<Sample> {
    return measureClick(run.page, `[data-project-card][data-project-root="${run.projectRoot}"] button`, {kind: "tree"},
        {id: `${run.environment}-A-${variant}-${iteration}`, environment: run.environment, scenario: "A", variant, iteration});
}

async function runScenarioA(run: Run): Promise<void> {
    for (let iteration = 0; iteration < run.options.openIterations; iteration += 1) {
        await restart(run, "production");
        for (const variant of ["service-cold", "reopen"] as const) {
            const sample = await openAndMeasure(run, variant, iteration);
            run.raw.push(sample);
            console.log(`A ${variant} ${iteration + 1}/${run.options.openIterations}: ${sample.durationMs.toFixed(1)} ms`);
            if (sample.status !== "pass") throw new Error(`场景 A 失败：${sample.error}`);
            if (variant === "service-cold" || iteration + 1 < run.options.openIterations) await closeProject(run);
        }
    }
}

async function ordinaryAndExpand(page: Page, path: string): Promise<void> {
    const ordinary = page.locator('[data-role="files-explorer-mode-switch"] button[data-value="ordinary"]');
    await ordinary.waitFor({state: "visible"});
    if (await ordinary.getAttribute("aria-checked") !== "true") await ordinary.click();
    const row = page.locator(`[data-role="workspace-file-row"][data-path="${path}"]`);
    await row.waitFor({state: "visible", timeout: 30_000});
    if (await row.getAttribute("aria-expanded") !== "true") await row.locator("button").first().click();
    await page.waitForFunction((path) => {
        const row = document.querySelector(`[data-role="workspace-file-row"][data-path="${CSS.escape(path)}"]`);
        const container = row?.parentElement?.querySelector(':scope > .overflow-hidden');
        return row?.getAttribute("aria-expanded") === "true" && container instanceof HTMLElement
            && !container.classList.contains("expand-enter-active") && !container.classList.contains("expand-enter-from")
            && (container.style.height === "auto" || container.style.height === "");
    }, path, {timeout: 30_000});
}

async function runScenarioB(run: Run): Promise<void> {
    await ordinaryAndExpand(run.page, "notes/");
    for (let iteration = 0; iteration < run.options.iterations; iteration += 1) {
        const selector = '[data-role="workspace-file-row"][data-path="notes/wide/"] button';
        if (await run.page.locator('[data-role="workspace-file-row"][data-path="notes/wide/"]').getAttribute("aria-expanded") === "true") await run.page.locator(selector).first().click();
        await run.page.waitForFunction(() => document.querySelectorAll('[data-role="workspace-file-row"][data-path^="notes/wide/"]').length === 1, undefined, {timeout: 30_000});
        const sample = await measureClick(run.page, selector, {kind: "directory", path: "notes/wide/", children: run.plan.wideDirectoryChildren},
            {id: `${run.environment}-B-${iteration}`, environment: run.environment, scenario: "B", variant: "notes-wide", iteration});
        run.raw.push(sample);
        if (sample.status !== "pass") throw new Error(`场景 B 失败：${sample.error}`);
    }
    console.log(`B 完成 ${run.options.iterations} 次目录展开`);
    await run.page.locator('[data-role="workspace-file-row"][data-path="notes/wide/"] button').first().click();
    await run.page.waitForFunction(() => document.querySelectorAll('[data-role="workspace-file-row"][data-path^="notes/wide/"]').length === 1);
    run.profiles.push(await profileBrowser(run.page, run.evidenceRoot, join(run.runRoot, "retained-profiles"), `${run.stem}-directory-expand`, () =>
        measureClick(run.page, '[data-role="workspace-file-row"][data-path="notes/wide/"] button', {kind: "directory", path: "notes/wide/", children: run.plan.wideDirectoryChildren},
            {id: `${run.environment}-B-profile`, environment: run.environment, scenario: "B", variant: "notes-wide", iteration: -1})));
}

async function switchFile(run: Run, entry: SamplePlanEntry, mode: EditorMode, groups: 1 | 2, temperature: "cold" | "hot", input: "tree" | "tab", iteration: number, proveInput = true): Promise<Sample> {
    const group = run.page.locator('section[data-group-id].is-active-group');
    const groupId = await group.getAttribute("data-group-id");
    if (!groupId) throw new Error("没有当前活动编辑组");
    const target: Extract<ReadyTarget, {kind: "editor"}> = {kind: "editor", path: entry.relativePath, marker: entry.uniqueMarker, mode, groups, groupId};
    const selector = input === "tree" ? `[data-role="workspace-file-row"][data-path="${entry.relativePath}"]` : `section[data-group-id="${groupId}"] [id="editor-tab-${encodeURIComponent(entry.relativePath)}"]`;
    const variant = `${temperature}-${mode}-${groups}-group-${input}`;
    const sample = await measureClick(run.page, selector, target, {id: `${run.environment}-C-${variant}-${iteration}`, environment: run.environment, scenario: "C", variant, iteration});
    if (sample.status === "pass" && proveInput) {
        try {
            await verifyInput(run.page, target);
            sample.readiness.inputVerified = true;
        } catch (error) {
            sample.status = "fail";
            sample.error = `真实输入验证失败：${String(error)}`;
        }
    }
    return sample;
}

async function keepCurrentTab(run: Run, entry: SamplePlanEntry): Promise<void> {
    const tab = run.page.locator(`section[data-group-id].is-active-group [id="editor-tab-${encodeURIComponent(entry.relativePath)}"]`);
    await tab.dblclick();
    await run.page.waitForFunction((path) => {
        const group = document.querySelector('section[data-group-id].is-active-group');
        const tab = group?.querySelector(`[data-editor-tab-path="${CSS.escape(path)}"]`);
        return Boolean(tab && !tab.classList.contains("is-preview"));
    }, entry.relativePath, {timeout: 10_000});
    await new Promise<void>((done) => setTimeout(done, 250));
}

async function runScenarioC(run: Run, mode: EditorMode): Promise<void> {
    await ordinaryAndExpand(run.page, "notes/");
    await ordinaryAndExpand(run.page, "notes/wide/");
    if (await run.page.locator('section[data-group-id]').count() !== 1) throw new Error(`${mode} 起始布局不是单组`);
    const entries = run.plan.entries.filter((entry) => entry.relativePath.startsWith("notes/wide/") && entry.kind === "note");
    for (const groups of [1, 2] as const) {
        if (groups === 2) {
            await run.page.getByRole("button", {name: /拆分|split right/iu}).first().click();
            await run.page.waitForFunction(() => document.querySelectorAll('section[data-group-id]').length === 2, undefined, {timeout: 30_000});
            await run.page.locator('section[data-group-id]').last().getByRole("tab", {selected: true}).click();
        }
        const offset = (groups - 1) * (run.options.iterations + 2);
        for (let iteration = 0; iteration < run.options.iterations; iteration += 1) {
            const entry = entries[offset + iteration]!;
            const sample = await switchFile(run, entry, mode, groups, "cold", "tree", iteration);
            run.raw.push(sample);
            if (sample.status !== "pass") throw new Error(`场景 C ${sample.id} 失败：${sample.error}; 就绪=${JSON.stringify(sample.readiness)}`);
        }
        const hot = [entries[offset + run.options.iterations]!, entries[offset + run.options.iterations + 1]!] as const;
        for (const entry of hot) {
            const sample = await switchFile(run, entry, mode, groups, "cold", "tree", -1);
            if (sample.status !== "pass") throw new Error(`热切换预热失败：${sample.error}`);
            await keepCurrentTab(run, entry);
        }
        for (const input of ["tree", "tab"] as const) {
            // 每段先停在 B，保证第一项点击 A 也是实际切换。
            await run.page.locator(`section[data-group-id].is-active-group [id="editor-tab-${encodeURIComponent(hot[1].relativePath)}"]`).click();
            for (let iteration = 0; iteration < run.options.iterations; iteration += 1) {
                const sample = await switchFile(run, hot[iteration % 2]!, mode, groups, "hot", input, iteration);
                run.raw.push(sample);
                if (sample.status !== "pass") throw new Error(`场景 C ${sample.id} 失败：${sample.error}; 就绪=${JSON.stringify(sample.readiness)}`);
                await new Promise<void>((done) => setTimeout(done, 250));
            }
        }
        console.log(`C ${run.environment} ${mode} ${groups} 组：冷开与两种热切换各 ${run.options.iterations} 次完成`);
        await run.page.screenshot({path: join(run.evidenceRoot, `${run.stem}-${run.environment}-${mode}-${groups}-group.png`)});
        const profileEntry = entries[2 * (run.options.iterations + 2) + groups - 1]!;
        const profile = await profileBrowser(run.page, run.evidenceRoot, join(run.runRoot, "retained-profiles"), `${run.stem}-${run.environment}-${mode}-${groups}-group`,
            async () => switchFile(run, profileEntry, mode, groups, "cold", "tree", -2, false));
        run.profiles.push(profile);
        const proofGroupId = profile.sample!.readiness.groupId;
        if (typeof proofGroupId !== "string") throw new Error("独立采样缺少活动编辑组 ID");
        await verifyInput(run.page, {kind: "editor", path: profileEntry.relativePath, marker: profileEntry.uniqueMarker, mode, groups, groupId: proofGroupId});
        profile.sample!.readiness.inputVerified = true;
        await writeFile(join(run.evidenceRoot, `${profile.label}-summary.json`), `${JSON.stringify(profile, null, 2)}\n`);
    }
}

async function runServerProfile(run: Run, projectRoot: string): Promise<void> {
    run.projectRoot = projectRoot;
    const profileDirectory = join(run.runRoot, "server-profile");
    await mkdir(profileDirectory, {recursive: true});
    await restart(run, "production", profileDirectory);
    const browserProfile = await profileBrowser(run.page, run.evidenceRoot, join(run.runRoot, "retained-profiles"), `${run.stem}-project-open`, () => openAndMeasure(run, "profile-service-cold", -1));
    run.profiles.push(browserProfile);
    const sample = browserProfile.sample!;
    if (sample.status !== "pass") throw new Error(`服务 CPU 采样打开失败：${sample.error}`);
    await run.page.close();
    await run.product.dispose();
    const profile = await readServerProfile(join(profileDirectory, "server-project-open.cpuprofile"), join(imageRoot, "server/index.mjs"), run.evidenceRoot, join(run.runRoot, "retained-profiles"), `${run.stem}-server-project-open`, sample);
    run.profiles.push(profile);
}

async function main(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));
    const plan = buildSamplePlan(options);
    const evidenceRoot = dirname(options.reportPath);
    const stem = basename(options.reportPath, ".json").replace(/-report$/u, "");
    const runRoot = await mkdtemp(join(resolveAgentTempRoot(), "t42-files-baseline-"));
    const stateRoot = join(runRoot, "state");
    await mkdir(evidenceRoot, {recursive: true});
    const logRoot = join(evidenceRoot, `${stem}-commands`);
    await mkdir(logRoot, {recursive: true});
    const buildLogPath = join(evidenceRoot, `${stem}-build.log`);
    const raw: Sample[] = [];
    const profiles: ProfileEvidence[] = [];
    const diagnostics: string[] = [];
    const loadAtStart = loadavg();
    let context: BrowserContext | null = null;
    let run: Run | null = null;
    let initialProduct: ProductProcess | null = null;
    let browserVersion = "未启动";
    let image: unknown = null;
    let completed = false;
    let cleaned = false;
    let retainedProfiles: string[] = [];
    let provenance: ProductionProvenance | undefined;
    let inheritedProfiles: string[] = [];
    let developmentRequired = false;
    let developmentCompleted = false;
    try {
        if (!options.skipBuild) {
            console.log("构建生产镜像");
            await runCaptured(["run", "nuxt:build"], null, buildLogPath);
        } else console.log("复用现有生产镜像；不覆盖构建日志");
        await access(join(imageRoot, "server/index.mjs"));
        image = JSON.parse(await readFile(join(imageRoot, "runtime-image.json"), "utf8"));
        if (options.resumeProduction) {
            const production = await loadProductionBaseline(options.resumeProduction, plan, options.iterations, options.openIterations, image, join(imageRoot, "public"));
            raw.push(...production.raw);
            profiles.push(...production.profiles);
            provenance = production.provenance;
            inheritedProfiles = production.retainedProfiles;
            console.log(`续跑生产矩阵已校验：${raw.length} 个成功样本；历史失败保留于 ${options.resumeProduction}`);
        }
        await prepareStateRoot(stateRoot, logRoot);
        initialProduct = await startProduct(stateRoot, join(evidenceRoot, `${stem}-production-0.log`), "production");
        context = await chromium.launchPersistentContext(join(runRoot, "chrome-profile"), {executablePath: options.browserExecutable, headless: true, viewport: {width: 1440, height: 1000}, timeout: 60_000});
        browserVersion = context.browser()?.version() ?? "未知";
        context.on("page", (page) => {
            page.on("pageerror", (error) => console.error(`浏览器异常：${error.stack ?? error.message}`));
            page.on("console", (message) => {if (message.type() === "error") console.error(`浏览器 console.error：${message.text()}`);});
        });
        await installObservers(context);
        const page = await context.newPage();
        await loginAndOpenBase(page, initialProduct.url);
        run = {options, plan, stateRoot, runRoot, evidenceRoot, stem, raw, profiles, context, page, product: initialProduct, environment: "production", projectRoot: "", startSequence: 0};
        const richProject = await seedProject(run, "rich");
        if (!options.resumeProduction) {
            await runScenarioA(run);
            await runScenarioB(run);
            await runScenarioC(run, "rich");
            await closeProject(run);
            await seedProject(run, "source");
            const sourceOpen = await openAndMeasure(run, "source-setup", -1);
            if (sourceOpen.status !== "pass") throw new Error(`源码项目打开失败：${sourceOpen.error}`);
            await runScenarioC(run, "source");
            await closeProject(run);
        }
        const reproduced = raw.some((sample) => sample.environment === "production" && sample.scenario === "C" && sample.status === "pass" && sample.durationMs >= 250 && sample.durationMs <= 400);
        developmentRequired = options.includeDevelopment || !reproduced;
        if (developmentRequired) {
            await restart(run, "development");
            for (const mode of ["rich", "source"] as const) {
                await seedProject(run, mode);
                const open = await openAndMeasure(run, `${mode}-development-setup`, -1);
                if (open.status !== "pass") throw new Error(`开发模式项目打开失败：${open.error}`);
                await runScenarioC(run, mode);
                await closeProject(run);
            }
            developmentCompleted = true;
        }
        await runServerProfile(run, richProject);
        completed = true;
    } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        diagnostics.push(message);
        console.error(message);
        if (run && !run.page.isClosed()) {
            await run.page.screenshot({path: join(evidenceRoot, `${stem}-failure.png`)}).catch((failure: unknown) => diagnostics.push(`失败页面截图失败：${String(failure)}`));
            const text = await run.page.locator("body").innerText().catch((failure: unknown) => `读取失败页面失败：${String(failure)}`);
            await writeFile(join(evidenceRoot, `${stem}-failure-page.txt`), `${run.page.url()}\n${text}\n`);
        }
    } finally {
        await context?.close().catch((error: unknown) => diagnostics.push(`Chrome 收口失败：${String(error)}`));
        await (run?.product ?? initialProduct)?.dispose().catch((error: unknown) => diagnostics.push(`服务收口失败：${String(error)}`));
        for (const logDirectory of [join(stateRoot, "logs"), join(stateRoot, "workspace/.nbook/logs")]) {
            try {
                const destination = join(evidenceRoot, `${stem}-server-logs`, logDirectory === join(stateRoot, "logs") ? "production" : "development");
                await mkdir(destination, {recursive: true});
                for (const file of await readdir(logDirectory, {withFileTypes: true})) {
                    if (file.isFile()) await writeFile(join(destination, file.name), await readFile(join(logDirectory, file.name)));
                }
            } catch (error) {
                if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) diagnostics.push(`服务文件日志归档失败：${String(error)}`);
            }
        }
        const retainedRoot = join(runRoot, "retained-profiles");
        try {retainedProfiles = (await readdir(retainedRoot)).map((file) => join(retainedRoot, file));} catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) diagnostics.push(`读取留存 profile 失败：${String(error)}`);
        }
        try {
            if (retainedProfiles.length) {
                for (const name of await readdir(runRoot)) if (name !== "retained-profiles") await rm(join(runRoot, name), {recursive: true, force: true});
            } else await rm(runRoot, {recursive: true, force: true});
            cleaned = true;
        } catch (error) {diagnostics.push(`系统临时数据清理失败：${String(error)}`);}
        const revision = spawnSync("git", ["rev-parse", "HEAD"], {cwd: repositoryRoot, encoding: "utf8"});
        const categoryCounts: Record<string, number> = {};
        for (const entry of plan.entries) categoryCounts[entry.category] = (categoryCounts[entry.category] ?? 0) + 1;
        const productionReproduction = raw.filter((sample) => sample.environment === "production" && sample.scenario === "C" && sample.status === "pass" && sample.durationMs >= 250 && sample.durationMs <= 400);
        const developmentReproduction = raw.filter((sample) => sample.environment === "development" && sample.scenario === "C" && sample.status === "pass" && sample.durationMs >= 250 && sample.durationMs <= 400);
        const report: MeasurementReport = {
            schema: "nbook.perf/files-baseline/v2", generatedAt: new Date().toISOString(), completed: completed && diagnostics.length === 0,
            sourceRevision: revision.status === 0 ? revision.stdout.trim() : "未取得", build: {requested: !options.skipBuild, logPath: buildLogPath, image},
            environment: {hostname: hostname(), platform: process.platform, arch: process.arch, bun: process.versions.bun, cpuModel: cpus()[0]?.model, cpuCount: cpus().length, memoryBytes: totalmem(), chrome: browserVersion, loadAtStart, loadAtEnd: loadavg(), viewport: {width: 1440, height: 1000}, headless: true},
            sample: {seed: plan.seed, fileCount: plan.fileCount, minBytes: plan.minBytes, maxBytes: plan.maxBytes, totalBytes: plan.entries.reduce((sum, entry) => sum + entry.sizeBytes, 0), categoryCounts, wideDirectoryPath: plan.wideDirectoryPath, wideDirectoryChildren: plan.wideDirectoryChildren, stateRoot, cleanedAfterRun: cleaned, retainedProfiles: [...inheritedProfiles, ...retainedProfiles], options},
            methodology: {percentile: "线性插值，位置 (n-1)*p；仅成功且输入验证通过的样本进入统计", tree: "click 捕获事件至三个根目录已渲染、可命中，连续两个动画帧成立", directory: "直接子行全部渲染、展开动画结束，连续两个动画帧成立", editor: "当前活动组目标标签选中、正确标记出现在可见编辑器、输入可写且不 busy；连续两个动画帧成立；窗口外输入并撤销", cold: "A 每次重启服务；C 每次用该项目中从未打开的文件；不清 OS 页缓存", desktop: "桌面版未测"},
            raw, summaries: summarize(raw), profiles, timingPoints,
            reproduction: {reproducedInProduction: productionReproduction.length > 0, intervalMs: [250, 400], sampleIds: productionReproduction.map((sample) => sample.id), statistics: stats(productionReproduction.map((sample) => sample.durationMs)), representative: productionReproduction.length ? {sampleId: productionReproduction[0]!.id, composition: composition(productionReproduction[0]!)} : null,
                developmentRequired, developmentCompleted, developmentMeasured: raw.some((sample) => sample.environment === "development"), developmentSampleIds: developmentReproduction.map((sample) => sample.id), developmentStatistics: stats(developmentReproduction.map((sample) => sample.durationMs)), developmentRepresentative: developmentReproduction.length ? {sampleId: developmentReproduction[0]!.id, composition: composition(developmentReproduction[0]!)} : null}, diagnostics,
            productionProvenance: provenance,
        };
        await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
        await writeFile(options.reportPath.replace(/\.json$/u, ".md"), markdownReport(report));
        console.log(`报告：${options.reportPath}；有效 ${raw.filter((sample) => sample.status === "pass").length}/${raw.length}；完整完成=${report.completed}`);
        if (!report.completed) process.exitCode = 1;
    }
}

if (import.meta.main) await main();
