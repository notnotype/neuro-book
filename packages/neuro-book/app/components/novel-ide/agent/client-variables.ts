import type {ClientStateSnapshotDto} from "nbook/shared/dto/agent-session.dto";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {VariablePatchRequest} from "nbook/server/agent/variables/types";
import type {NovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import {isNovelIdeTab, NOVEL_IDE_TABS} from "nbook/app/components/novel-ide/mock-data";
import {revealWorkbenchToolPanel, workbenchToolRevealPort} from "nbook/app/utils/workbench/tool-reveal-port";
import {productThemeIds} from "nbook/shared/theme/theme-axes";

type RuntimeI18n = {
    t: (key: string, params?: {[key: string]: string | number}) => string;
};

type ClientVariableSetterResult = void | boolean | Promise<void | boolean>;
type ClientVariablePatchOptions = {
    setActivePanel?: (value: NovelIdeTab | null) => ClientVariableSetterResult;
    setTheme?: (value: string) => ClientVariableSetterResult;
};

/**
 * 非组件工具层不能使用 useI18n；这里复用 Nuxt 注入的运行时 i18n，失败时回退中文源语言。
 */
function translate(key: string, fallback: string, params?: {[key: string]: string | number}): string {
    try {
        const nuxtApp = useNuxtApp() as {$i18n?: RuntimeI18n};
        return nuxtApp.$i18n?.t(key, params) ?? fallback;
    } catch {
        return fallback;
    }
}

/**
 * Novel IDE 发给 Agent 的客户端变量输入。
 */
export type NovelIdeClientVariablesInput = {
    activePanel: string | null;
    theme: string;
    novelId: string;
    workspace: string | null;
    workspaceKind: "novel" | "user-assets";
    selectedFilePath: string | null;
    selectedStoryThreadId: string | null;
    selectedStorySceneId: string | null;
    previousSelectedFilePath: string | null;
    fileChangedSinceLastSend: boolean;
    selectionVersion: number;
};

/**
 * 组装 Novel IDE 的客户端变量快照。
 */
export function buildAgentClientState(input: NovelIdeClientVariablesInput): ClientStateSnapshotDto {
    return {
        ide: {
            panel: null,
            activePanel: input.activePanel,
            theme: input.theme,
            extra: "{}",
        },
        studio: {
            novelId: input.novelId,
            selectedFilePath: input.selectedFilePath,
            selectedStoryThreadId: input.selectedStoryThreadId,
            selectedStorySceneId: input.selectedStorySceneId,
            previousSelectedFilePath: input.previousSelectedFilePath,
            previousChapterTitle: null,
            currentChapterLabel: null,
            previousChapterLabel: null,
            workspace: input.workspace,
            workspaceKind: input.workspaceKind,
            didSwitchFile: input.fileChangedSinceLastSend,
            selectionVersion: input.selectionVersion,
            extra: "{}",
        },
    };
}

/**
 * 兼容旧调用点的命名。新代码应使用 buildAgentClientState。
 */
export const buildNovelIdeClientVariables = buildAgentClientState;

/**
 * `client.ide.activePanel` 的真实写入：交给页面登记的揭示端口。
 *
 * 未登记、工具未接入、首读未就绪、来源代次过期都以**抛出带原因**的 Error 结束（ack 里读到的是
 * 具体原因，而不是"应用失败"）；落盘为 pending 时端口回执里带 `persisted: "pending"`——
 * UI 状态确实应用了、保存还没确认，因此这里按既有 patch ack 协议确认已应用的值，但不谎报 saved。
 */
export async function applyActivePanelPatch(value: NovelIdeTab | null): Promise<boolean> {
    const outcome = await revealWorkbenchToolPanel(value);
    if (outcome.status === "unregistered") {
        throw new Error(translate(
            "agent.clientVariables.activePanelUnavailable",
            "client.ide.activePanel 写入失败：当前页面没有登记工具揭示端口。",
        ));
    }
    if (outcome.status === "rejected") {
        throw new Error(outcome.diagnosis);
    }
    return true;
}

/**
 * 应用 Agent 请求的 client.* patch。返回应用后的变量值；调用方可传入安全 setter
 * 把允许写的 browser state 同步到实际 UI store。
 */
export async function applyClientVariablePatch(request: VariablePatchRequest, currentState: ClientStateSnapshotDto, options: ClientVariablePatchOptions = {}): Promise<JsonValue> {
    const nextState = JSON.parse(JSON.stringify(currentState)) as Record<string, JsonValue>;
    const currentValue = readDotPath(nextState, request.path);
    const nextValue = applyJsonPatch(currentValue, request.operations);
    writeDotPath(nextState, request.path, nextValue);
    await applyKnownClientState(request.path, nextValue, options);
    return readDotPath(nextState, request.path) ?? null;
}

async function applyKnownClientState(path: string, value: JsonValue, options: ClientVariablePatchOptions): Promise<void> {
    if (path === "ide.activePanel") {
        if (value !== null && (typeof value !== "string" || !isNovelIdeTab(value))) {
            const values = NOVEL_IDE_TABS.join("/");
            throw new Error(translate("agent.clientVariables.activePanelInvalid", `client.ide.activePanel 只能写入 ${values} 或 null。`, {values}));
        }
        // 词表只表达**传输口径**（服务端 schema 是 string|null）；"这个工具真的能揭示"由页面登记的
        // 揭示端口回答：静态词表不替工作台承诺能力，没接入的页签与没有宿主的窗口都显式失败。
        const port = workbenchToolRevealPort();
        if (port === null) {
            throw new Error(translate(
                "agent.clientVariables.activePanelUnavailable",
                "client.ide.activePanel 写入失败：当前页面没有登记工具揭示端口。",
            ));
        }
        if (value !== null && !port.capability().includes(value)) {
            throw new Error(translate(
                "agent.clientVariables.activePanelNotWired",
                `client.ide.activePanel 写入 ${value} 被拒绝：当前工作台未接入该工具视图。`,
                {panel: value},
            ));
        }
        await assertClientSetterApplied(options.setActivePanel?.(value), "client.ide.activePanel");
        return;
    }
    if (path === "ide.theme") {
        const allowedThemeIds = productThemeIds as readonly string[];
        if (typeof value !== "string" || !allowedThemeIds.includes(value)) {
            const values = allowedThemeIds.join("/");
            throw new Error(translate("agent.clientVariables.themeInvalid", `client.ide.theme 只能写入 ${values}。`, {values}));
        }
        await assertClientSetterApplied(options.setTheme?.(value), "client.ide.theme");
    }
}

async function assertClientSetterApplied(result: ClientVariableSetterResult | undefined, path: string): Promise<void> {
    if (await result === false) {
        throw new Error(translate("agent.clientVariables.applyFailed", `${path} 应用失败。`, {path}));
    }
}

function applyJsonPatch(value: JsonValue | undefined, operations: VariablePatchRequest["operations"]): JsonValue {
    let current = value === undefined ? null : JSON.parse(JSON.stringify(value)) as JsonValue;
    for (const operation of operations) {
        if (operation.path === "") {
            if (operation.op === "remove") {
                current = null;
                continue;
            }
            if (operation.op === "test") {
                assertEqual(current, operation.value, operation.path);
                continue;
            }
            current = JSON.parse(JSON.stringify(operation.value)) as JsonValue;
            continue;
        }
        const segments = parsePointer(operation.path);
        const parent = resolveParent(current, segments);
        const key = segments.at(-1);
        if (key === undefined) {
            throw new Error(translate("agent.clientVariables.emptyJsonPatchPath", "JSON Patch path 不能为空。"));
        }
        if (operation.op === "remove") {
            removeValue(parent, key);
            continue;
        }
        if (operation.op === "test") {
            assertEqual(readValue(parent, key), operation.value, operation.path);
            continue;
        }
        writeValue(parent, key, JSON.parse(JSON.stringify(operation.value)) as JsonValue, operation.op);
    }
    return current;
}

function readDotPath(value: Record<string, JsonValue>, path: string): JsonValue | undefined {
    const segments = path.split(".").filter(Boolean);
    let current: JsonValue | Record<string, JsonValue> | undefined = value;
    for (const segment of segments) {
        if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
            return undefined;
        }
        current = current[segment];
    }
    return current as JsonValue;
}

function writeDotPath(value: Record<string, JsonValue>, path: string, nextValue: JsonValue): void {
    const segments = path.split(".").filter(Boolean);
    let current = value;
    for (const segment of segments.slice(0, -1)) {
        const child = current[segment];
        if (!child || typeof child !== "object" || Array.isArray(child)) {
            current[segment] = {};
        }
        current = current[segment] as Record<string, JsonValue>;
    }
    const leaf = segments.at(-1);
    if (!leaf) {
        throw new Error(translate("agent.clientVariables.emptyClientVariablePath", "client variable path 不能为空。"));
    }
    current[leaf] = nextValue;
}

function parsePointer(path: string): string[] {
    if (!path.startsWith("/")) {
        throw new Error(translate("agent.clientVariables.invalidPointer", `JSON Patch path 必须是 JSON Pointer 或空字符串：${path}`, {path}));
    }
    return path.slice(1).split("/").map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function resolveParent(value: JsonValue, segments: string[]): JsonValue {
    let current = value;
    for (const segment of segments.slice(0, -1)) {
        if (Array.isArray(current)) {
            current = current[readArrayIndex(segment, current.length)] ?? null;
            continue;
        }
        if (!current || typeof current !== "object") {
            throw new Error(translate("agent.clientVariables.cannotDescend", `JSON Patch 无法下钻到 ${segment}。`, {segment}));
        }
        current = current[segment] ?? null;
    }
    return current;
}

function readValue(parent: JsonValue, key: string): JsonValue {
    if (Array.isArray(parent)) {
        return parent[readArrayIndex(key, parent.length)] ?? null;
    }
    if (!parent || typeof parent !== "object") {
        throw new Error(translate("agent.clientVariables.targetNotContainer", `JSON Patch target 不是 object/array：${key}`, {key}));
    }
    return parent[key] ?? null;
}

function writeValue(parent: JsonValue, key: string, value: JsonValue, op: "add" | "replace"): void {
    if (Array.isArray(parent)) {
        const index = key === "-" ? parent.length : readArrayIndex(key, op === "add" ? parent.length + 1 : parent.length);
        if (op === "add") {
            parent.splice(index, 0, value);
        } else {
            parent[index] = value;
        }
        return;
    }
    if (!parent || typeof parent !== "object") {
        throw new Error(translate("agent.clientVariables.targetNotContainer", `JSON Patch target 不是 object/array：${key}`, {key}));
    }
    parent[key] = value;
}

function removeValue(parent: JsonValue, key: string): void {
    if (Array.isArray(parent)) {
        parent.splice(readArrayIndex(key, parent.length), 1);
        return;
    }
    if (!parent || typeof parent !== "object") {
        throw new Error(translate("agent.clientVariables.targetNotContainer", `JSON Patch target 不是 object/array：${key}`, {key}));
    }
    delete parent[key];
}

function readArrayIndex(segment: string, length: number): number {
    if (!/^\d+$/.test(segment)) {
        throw new Error(translate("agent.clientVariables.invalidArrayIndex", `JSON Patch 数组下标非法：${segment}`, {segment}));
    }
    const index = Number(segment);
    if (index < 0 || index >= length) {
        throw new Error(translate("agent.clientVariables.arrayIndexOutOfRange", `JSON Patch 数组下标越界：${segment}`, {segment}));
    }
    return index;
}

function assertEqual(left: JsonValue, right: JsonValue, path: string): void {
    if (JSON.stringify(left) !== JSON.stringify(right)) {
        throw new Error(translate("agent.clientVariables.testFailed", `JSON Patch test 失败：${path}`, {path}));
    }
}
