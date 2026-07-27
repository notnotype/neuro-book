import path from "node:path";
import {promises as fs} from "node:fs";
import {randomUUID} from "node:crypto";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {
    BUILTIN_WORKFLOW_ID,
    BUILTIN_TXT2IMG_MAPPING,
    detectInjectionPoints,
} from "nbook/server/comfyui/workflow-template";
import type {
    ComfyUiImportWorkflowRequestDto,
    ComfyUiUpdateWorkflowRequestDto,
    ComfyUiWorkflowMappingDto,
    ComfyUiWorkflowSummaryDto,
} from "nbook/shared/dto/comfyui.dto";

/**
 * 用户自定义 ComfyUI 工作流存储。
 *
 * 唯一真相源：Workspace Root `.nbook/comfyui/workflows/<id>.json`（全局，不属于任何 Project）。
 * 文件为 envelope：{id, name, createdAt, updatedAt, mapping, issues, workflow}；
 * workflow 是 ComfyUI「导出 API」的原始 JSON，导入后原样保存不改写。
 */

/** 存储 envelope。issues 是导入时自动识别的告警快照，mapping 手改后仍保留供参考。 */
type StoredComfyUiWorkflow = {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    mapping: ComfyUiWorkflowMappingDto;
    issues: string[];
    workflow: Record<string, unknown>;
};

export class ComfyUiWorkflowNotFoundError extends Error {
    constructor(readonly workflowId: string) {
        super(`工作流不存在：${workflowId}`);
        this.name = "ComfyUiWorkflowNotFoundError";
    }
}

function workflowsDir(): string {
    return path.join(runtimePathsFromEnv().userNbookRoot, "comfyui", "workflows");
}

/** 工作流 id 只允许 uuid 形态文件名，防路径注入。 */
const WORKFLOW_ID_PATTERN = /^[a-z0-9-]{8,64}$/u;

function workflowFilePath(id: string): string {
    if (!WORKFLOW_ID_PATTERN.test(id)) {
        throw new ComfyUiWorkflowNotFoundError(id);
    }
    return path.join(workflowsDir(), `${id}.json`);
}

async function readStoredWorkflow(id: string): Promise<StoredComfyUiWorkflow> {
    let text: string;
    try {
        text = await fs.readFile(workflowFilePath(id), "utf8");
    } catch {
        throw new ComfyUiWorkflowNotFoundError(id);
    }
    try {
        return JSON.parse(text) as StoredComfyUiWorkflow;
    } catch {
        throw new ComfyUiWorkflowNotFoundError(id);
    }
}

async function writeStoredWorkflow(stored: StoredComfyUiWorkflow): Promise<void> {
    await fs.mkdir(workflowsDir(), {recursive: true});
    await fs.writeFile(workflowFilePath(stored.id), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
}

function toSummary(stored: StoredComfyUiWorkflow): ComfyUiWorkflowSummaryDto {
    return {
        id: stored.id,
        name: stored.name,
        builtin: false,
        mapping: stored.mapping,
        issues: stored.issues,
        updatedAt: stored.updatedAt,
    };
}

/** 内置模板的列表条目。 */
function builtinSummary(): ComfyUiWorkflowSummaryDto {
    return {
        id: BUILTIN_WORKFLOW_ID,
        name: "内置通用 txt2img",
        builtin: true,
        mapping: BUILTIN_TXT2IMG_MAPPING,
        issues: [],
        updatedAt: null,
    };
}

/**
 * 列出全部工作流：内置模板在前，用户工作流按更新时间倒序。
 * 单个损坏文件跳过，不阻塞列表。
 */
export async function listWorkflows(): Promise<ComfyUiWorkflowSummaryDto[]> {
    const result: ComfyUiWorkflowSummaryDto[] = [builtinSummary()];
    let entries: string[];
    try {
        entries = await fs.readdir(workflowsDir());
    } catch {
        return result;
    }
    const items: StoredComfyUiWorkflow[] = [];
    for (const entry of entries) {
        if (!entry.endsWith(".json")) {
            continue;
        }
        try {
            items.push(await readStoredWorkflow(entry.slice(0, -".json".length)));
        } catch {
            // 损坏或命名不合规的文件跳过。
        }
    }
    items.sort((left, right) => right.updatedAt - left.updatedAt);
    result.push(...items.map(toSummary));
    return result;
}

/**
 * 导入工作流：自动识别注入点后落盘，返回 summary（含识别 issues）。
 */
export async function importWorkflow(input: ComfyUiImportWorkflowRequestDto): Promise<ComfyUiWorkflowSummaryDto> {
    const {mapping, issues} = detectInjectionPoints(input.workflow);
    const now = Date.now();
    const stored: StoredComfyUiWorkflow = {
        id: randomUUID(),
        name: input.name,
        createdAt: now,
        updatedAt: now,
        mapping,
        issues,
        workflow: input.workflow,
    };
    await writeStoredWorkflow(stored);
    return toSummary(stored);
}

/**
 * 更新工作流名称或注入点 mapping。
 */
export async function updateWorkflow(id: string, patch: ComfyUiUpdateWorkflowRequestDto): Promise<ComfyUiWorkflowSummaryDto> {
    const stored = await readStoredWorkflow(id);
    const next: StoredComfyUiWorkflow = {
        ...stored,
        ...(patch.name !== undefined ? {name: patch.name} : {}),
        ...(patch.mapping !== undefined ? {mapping: patch.mapping} : {}),
        updatedAt: Date.now(),
    };
    await writeStoredWorkflow(next);
    return toSummary(next);
}

/**
 * 删除工作流。不存在时静默成功（幂等）。
 */
export async function deleteWorkflow(id: string): Promise<void> {
    try {
        await fs.unlink(workflowFilePath(id));
    } catch (error) {
        if (error instanceof ComfyUiWorkflowNotFoundError) {
            return;
        }
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return;
        }
        throw error;
    }
}

/**
 * 解析生图任务使用的工作流：workflowId 为 null 或内置 id 时返回 null（由调用方走内置模板）；
 * 否则返回用户工作流的 JSON 与 mapping。
 */
export async function resolveWorkflowForJob(workflowId: string | null): Promise<{workflow: Record<string, unknown>; mapping: ComfyUiWorkflowMappingDto} | null> {
    if (!workflowId || workflowId === BUILTIN_WORKFLOW_ID) {
        return null;
    }
    const stored = await readStoredWorkflow(workflowId);
    return {workflow: stored.workflow, mapping: stored.mapping};
}
