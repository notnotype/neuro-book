#!/usr/bin/env bun
import {access, mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Type} from "typebox";
import {
    createModels,
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxToolCall,
    type FauxProviderHandle,
    type Models,
} from "@earendil-works/pi-ai";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {ensureGlobalProfileHome, globalProfileHomeRoot} from "nbook/server/agent/profiles/profile-home";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {readDotPath, VariableFileStorage} from "nbook/server/agent/variables/storage";
import {loadGlobalEffectiveConfigAtWorkspaceRoot, saveGlobalConfig} from "nbook/server/config/config-service";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {closeAllProjects, openProject} from "nbook/server/workspace-files/project-session";

if (!process.env.NEURO_BOOK_APPLICATION_ROOT?.trim() || !process.env.NEURO_BOOK_STATE_ROOT?.trim()) {
    throw new Error("Product Agent smoke必须显式设置NEURO_BOOK_APPLICATION_ROOT与NEURO_BOOK_STATE_ROOT。");
}

const runtimePaths = runtimePathsFromEnv();
const sameRootLayout = process.argv.includes("--same-root");
const rootsMatch = path.resolve(runtimePaths.applicationRoot) === path.resolve(runtimePaths.stateRoot);
if (!sameRootLayout && rootsMatch) {
    throw new Error("Product Agent smoke要求State Root与Application Root分离。");
}
if (sameRootLayout && !rootsMatch) {
    throw new Error("Product Agent --same-root smoke要求State Root与Application Root相同。");
}

const stateProfileKey = "test.product-state-root";
const stateProviderConfigId = "product-state-root-faux";
const stateModelId = "product-state-root-faux";
type SmokeModels = FauxProviderHandle & {
    runtime: Models;
    /** Faux Provider在Session持久化合同中的本地Provider Config身份。 */
    providerConfigId: string;
};
if (process.argv[2] === "resume-moved-state") {
    const movedSessionId = Number(process.argv[3]);
    const movedProjectSlug = process.argv[4]?.trim();
    if (!Number.isInteger(movedSessionId) || movedSessionId <= 0 || !movedProjectSlug) {
        throw new Error("Product Agent moved-state smoke缺少合法sessionId或projectSlug。");
    }
    await runMovedStateRootPhase(runtimePaths, movedProjectSlug, movedSessionId);
    process.exit(0);
}

const projectSlug = `task109-product-smoke-${process.pid}`;
const projectWorkspaceRoot = path.join(runtimePaths.workspaceRoot, projectSlug);
await mkdir(path.join(projectWorkspaceRoot, ".nbook"), {recursive: true});
await writeFile(path.join(projectWorkspaceRoot, "project.yaml"), [
    "kind: novel",
    "title: Task 109 Product Smoke",
    "summary: Product runtime path verification",
    "",
].join("\n"), "utf8");

const faux = createSmokeModels();
const harness = createSmokeHarness(runtimePaths, faux);
let sessionId: number | null = null;

try {
    registerSmokeProfile(harness);
    await writeProductState(harness, runtimePaths, projectSlug, "initial-state-root");
    await assertProductState(runtimePaths, projectSlug, "initial-state-root");
    faux.setResponses([
        fauxAssistantMessage([fauxToolCall("write", {
            path: "lorebook/product-marker.txt",
            content: "write-ok",
        }, {id: "product-write"})], {stopReason: "toolUse"}),
        fauxAssistantMessage([fauxToolCall("read", {
            path: "lorebook/product-marker.txt",
        }, {id: "product-read"})], {stopReason: "toolUse"}),
        fauxAssistantMessage([fauxToolCall("edit", {
            path: "lorebook/product-marker.txt",
            edits: [{oldText: "write-ok", newText: "edit-ok"}],
        }, {id: "product-edit"})], {stopReason: "toolUse"}),
        fauxAssistantMessage([fauxToolCall("apply_patch", {
            patch: [
                "*** Begin Patch",
                "*** Add File: manuscript/patch-marker.txt",
                "+patch-ok",
                "*** End Patch",
            ].join("\n"),
        }, {id: "product-patch"})], {stopReason: "toolUse"}),
        fauxAssistantMessage([fauxToolCall("bash", {
            command: "mkdir -p .agent && printf 'bash-ok' > .agent/bash-marker.txt",
        }, {id: "product-bash"})], {stopReason: "toolUse"}),
        fauxAssistantMessage([fauxText("done"), fauxToolCall("report_result", {result: "ok"}, {id: "product-report"})], {stopReason: "toolUse"}),
    ]);

    const created = await harness.createAgent({
        profileKey: "test.product-state-root",
        initial: {},
        currentProjectRoot: projectSlug,
    });
    sessionId = created.sessionId;
    const result = await harness.invokeAgent({
        sessionId: created.sessionId,
        mode: "prompt",
        message: {text: "run product state root smoke"},
    });
    if (result.status !== "completed") {
        throw new Error(`Product Agent smoke未完成：${result.status} ${result.error ?? ""}`.trim());
    }

    await assertFile(path.join(projectWorkspaceRoot, "lorebook", "product-marker.txt"), "edit-ok");
    await assertFile(path.join(projectWorkspaceRoot, "manuscript", "patch-marker.txt"), "patch-ok\n");
    await assertFile(path.join(projectWorkspaceRoot, ".agent", "bash-marker.txt"), "bash-ok");
    const stored = await harness.repo.readSession(created.sessionId);
    if (stored.metadata.schemaVersion !== 2 || stored.metadata.currentProjectRoot !== projectSlug) {
        throw new Error("Product Agent smoke的session没有写入schema v2 Current Project。");
    }
    if (!sameRootLayout && await pathExists(path.join(runtimePaths.applicationRoot, "workspace"))) {
        throw new Error(`Product Agent smoke在Installation Root产生了错误Workspace Root：${path.join(runtimePaths.applicationRoot, "workspace")}`);
    }
} finally {
    await harness.dispose();
    await closeAllProjects();
}

if (sessionId === null) {
    throw new Error("Product Agent smoke没有创建可移动的session。");
}

if (sameRootLayout) {
    console.log(JSON.stringify({
        ok: true,
        layout: "same-root",
        applicationRoot: runtimePaths.applicationRoot,
        stateRoot: runtimePaths.stateRoot,
        workspaceRoot: runtimePaths.workspaceRoot,
        projectRoot: projectSlug,
        projectWorkspaceRoot,
        sessionId,
    }, null, 2));
    process.exit(0);
}

const movedStateRoot = `${runtimePaths.stateRoot}-moved`;
if (await pathExists(movedStateRoot)) {
    throw new Error(`Product Agent smoke目标State Root已存在：${movedStateRoot}`);
}
await rename(runtimePaths.stateRoot, movedStateRoot);
process.env.NEURO_BOOK_STATE_ROOT = movedStateRoot;
const movedRuntimePaths = runtimePathsFromEnv();
const movedProjectRoot = path.join(movedRuntimePaths.workspaceRoot, projectSlug);
const child = Bun.spawn({
    cmd: [process.execPath, fileURLToPath(import.meta.url), "resume-moved-state", String(sessionId), projectSlug],
    cwd: movedRuntimePaths.applicationRoot,
    env: {
        ...process.env,
        NEURO_BOOK_APPLICATION_ROOT: movedRuntimePaths.applicationRoot,
        NEURO_BOOK_STATE_ROOT: movedRuntimePaths.stateRoot,
    },
    stdout: "inherit",
    stderr: "inherit",
});
const childExitCode = await child.exited;
if (childExitCode !== 0) {
    throw new Error(`Product Agent moved-state子进程失败：${childExitCode}`);
}
if (await pathExists(runtimePaths.stateRoot)) {
    throw new Error(`Product Agent moved-state子进程重新创建了旧State Root：${runtimePaths.stateRoot}`);
}

console.log(JSON.stringify({
    ok: true,
    applicationRoot: movedRuntimePaths.applicationRoot,
    originalStateRoot: runtimePaths.stateRoot,
    movedStateRoot: movedRuntimePaths.stateRoot,
    workspaceRoot: movedRuntimePaths.workspaceRoot,
    projectRoot: projectSlug,
    projectWorkspaceRoot: movedProjectRoot,
    sessionId,
}, null, 2));

/** 在全新Bun进程中从移动后的State Root恢复旧session。 */
async function runMovedStateRootPhase(
    paths: ReturnType<typeof runtimePathsFromEnv>,
    movedProjectSlug: string,
    movedSessionId: number,
): Promise<void> {
    const movedProjectRoot = path.join(paths.workspaceRoot, movedProjectSlug);
    const movedFaux = createSmokeModels();
    const movedHarness = createSmokeHarness(paths, movedFaux);
    try {
        registerSmokeProfile(movedHarness);
        await assertProductState(paths, movedProjectSlug, "initial-state-root");
        await writeProductState(movedHarness, paths, movedProjectSlug, "moved-state-root");
        await assertProductState(paths, movedProjectSlug, "moved-state-root");
        movedFaux.setResponses([
            fauxAssistantMessage([fauxToolCall("read", {
                path: "lorebook/product-marker.txt",
            }, {id: "moved-read"})], {stopReason: "toolUse"}),
            fauxAssistantMessage([fauxToolCall("edit", {
                path: "lorebook/product-marker.txt",
                edits: [{oldText: "edit-ok", newText: "moved-ok"}],
            }, {id: "moved-edit"})], {stopReason: "toolUse"}),
            fauxAssistantMessage([fauxText("moved"), fauxToolCall("report_result", {result: "ok"}, {id: "moved-report"})], {stopReason: "toolUse"}),
        ]);
        const result = await movedHarness.invokeAgent({
            sessionId: movedSessionId,
            mode: "prompt",
            message: {text: "continue after moving the full state root"},
        });
        if (result.status !== "completed") {
            throw new Error(`移动State Root后的Product Agent smoke未完成：${result.status} ${result.error ?? ""}`.trim());
        }
        await assertFile(path.join(movedProjectRoot, "lorebook", "product-marker.txt"), "moved-ok");
        await assertFile(path.join(movedProjectRoot, "manuscript", "patch-marker.txt"), "patch-ok\n");
        await assertFile(path.join(movedProjectRoot, ".agent", "bash-marker.txt"), "bash-ok");
        if (await pathExists(path.join(paths.applicationRoot, "workspace"))) {
            throw new Error(`移动State Root后在Installation Root产生了错误Workspace Root：${path.join(paths.applicationRoot, "workspace")}`);
        }
    } finally {
        await movedHarness.dispose();
        await closeAllProjects();
    }
}

/** 创建Product smoke专用Faux Provider。 */
function createSmokeModels(): SmokeModels {
    const faux = fauxProvider({models: [{id: stateModelId, contextWindow: 32_000, maxTokens: 4_000}]});
    const runtime = createModels();
    runtime.setProvider(faux.provider);
    return {...faux, runtime, providerConfigId: stateProviderConfigId};
}

/** 使用当前Product RuntimePaths建立Harness。 */
function createSmokeHarness(
    paths: ReturnType<typeof runtimePathsFromEnv>,
    smokeFaux: SmokeModels,
): NeuroAgentHarness {
    return new NeuroAgentHarness({
        runtimePaths: paths,
        repo: new JsonlSessionRepository(paths.workspaceRoot),
        modelResolver: () => ({
            ...smokeFaux.getModel(),
            providerConfigId: smokeFaux.providerConfigId,
        }),
        runtimeResolver: () => smokeFaux.runtime,
        enableSessionSummarizer: false,
    });
}

/** 注册Product smoke使用的最小Profile。 */
function registerSmokeProfile(smokeHarness: NeuroAgentHarness): void {
    smokeHarness.profiles.register(defineAgentProfile({
        manifest: {key: stateProfileKey, name: "Product State Root Smoke"},
        initialSchema: Type.Object({}),
        tools: toolset(
            builtin.file.read,
            builtin.file.write,
            builtin.file.edit,
            builtin.file.applyPatch,
            builtin.file.bash,
            builtin.result.main(),
        ),
        prepare() {
            return {};
        },
    }), false);
}

/**
 * 通过正式生产接口写入Global Config、Global Profile Home与Variable Storage。
 * 所有物理根都来自本轮RuntimePaths，不允许从cwd或Installation Root推断。
 */
async function writeProductState(
    smokeHarness: NeuroAgentHarness,
    paths: ReturnType<typeof runtimePathsFromEnv>,
    currentProjectRoot: string,
    marker: string,
): Promise<void> {
    await saveGlobalConfig({
        ...(marker === "initial-state-root" ? {models: {
            default: `${stateProviderConfigId}/${stateModelId}`,
            providers: [{
                id: stateProviderConfigId,
                name: "Product State Root Faux",
                enabled: true,
                modelApi: "openai-completions",
                options: {
                    apiKey: {configured: false, maskedValue: null},
                    baseURL: "http://127.0.0.1:1/v1",
                    proxy: "",
                    timeoutMs: null,
                    requestOptions: {},
                },
                models: [{
                    id: stateModelId,
                    name: "Product State Root Faux",
                    group: null,
                    enabled: true,
                    api: "openai-completions",
                    reasoning: false,
                    input: ["text", "image"],
                    maxTokens: 4_000,
                    contextWindowTokens: 32_000,
                    cost: null,
                    compat: null,
                    headers: null,
                    thinkingLevelMap: null,
                }],
            }],
        }} : {}),
        ui: {
            themeId: "nbook",
            appearance: "light",
            costCurrency: configCurrency(marker),
        },
    }, {workspaceKind: "user-assets"}, smokeHarness.profiles);

    const home = await ensureGlobalProfileHome({
        workspaceRoot: paths.workspaceRoot,
        profileKey: stateProfileKey,
        profileVersion: 1,
    });
    await home.writeText("state-root-marker.txt", marker, {mode: "overwrite"});

    const currentProject = await openProject(projectWorkspaceRef(currentProjectRoot), {
        kind: "job",
        source: "product-state-root-smoke-write",
    }, paths.workspaceRoot);
    const storage = new VariableFileStorage(paths.workspaceRoot, currentProject.workspace);
    await storage.patch("global", "task109.productStateRoot", [{
        op: "replace",
        path: "",
        value: marker,
    }]);
    await storage.patch("project", "task109.productStateRoot", [{
        op: "replace",
        path: "",
        value: marker,
    }]);
}

/** 验证三类状态服务从当前RuntimePaths读取同一份State Root数据。 */
async function assertProductState(
    paths: ReturnType<typeof runtimePathsFromEnv>,
    currentProjectRoot: string,
    expectedMarker: string,
): Promise<void> {
    const config = await loadGlobalEffectiveConfigAtWorkspaceRoot({workspaceRoot: paths.workspaceRoot});
    if (config.ui.costCurrency !== configCurrency(expectedMarker)) {
        throw new Error(`Product Global Config没有命中当前State Root：${config.ui.costCurrency}`);
    }

    const home = await ensureGlobalProfileHome({
        workspaceRoot: paths.workspaceRoot,
        profileKey: stateProfileKey,
        profileVersion: 1,
    });
    const expectedHomeRoot = globalProfileHomeRoot(paths.userNbookRoot, stateProfileKey);
    if (path.resolve(home.root) !== path.resolve(expectedHomeRoot)) {
        throw new Error(`Product Global Profile Home没有位于当前State Root：${home.root}`);
    }
    if (await home.readText("state-root-marker.txt") !== expectedMarker) {
        throw new Error("Product Global Profile Home没有读取到当前State Root标记。");
    }

    const currentProject = await openProject(projectWorkspaceRef(currentProjectRoot), {
        kind: "job",
        source: "product-state-root-smoke-read",
    }, paths.workspaceRoot);
    const storage = new VariableFileStorage(paths.workspaceRoot, currentProject.workspace);
    const [globalVariables, projectVariables] = await Promise.all([
        storage.read("global"),
        storage.read("project"),
    ]);
    if (readDotPath(globalVariables, "task109.productStateRoot") !== expectedMarker) {
        throw new Error("Product Global Variable Storage没有读取到当前State Root标记。");
    }
    if (readDotPath(projectVariables, "task109.productStateRoot") !== expectedMarker) {
        throw new Error("Product Project Variable Storage没有读取到当前State Root标记。");
    }
}

/** 用两个正式Config枚举值区分State Root移动前后的写入。 */
function configCurrency(marker: string): "USD" | "CNY" {
    return marker === "initial-state-root" ? "CNY" : "USD";
}

/** 断言Product Agent工具写入的文件内容。 */
async function assertFile(filePath: string, expected: string): Promise<void> {
    const actual = await readFile(filePath, "utf8");
    if (actual !== expected) {
        throw new Error(`Product Agent smoke文件内容不匹配：${filePath}`);
    }
}

/** 判断路径是否存在。 */
async function pathExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}
