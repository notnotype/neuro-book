import type { WorldApi } from "nbook/server/world-engine/codeact-sandbox";
import type { SubjectState, Instant, JsonValue, PatchInput, SliceInput, WorldIssue, WorldPatchOp, WorldSliceSubjectFilterMode } from "nbook/server/world-engine/types";
import type { WorldEngineService } from "nbook/server/world-engine/world-engine.service";
import type { WorldEngineRepository } from "nbook/server/world-engine/world-engine.repository";

/**
 * CodeAct World API 实现。
 *
 * 为 Agent 查询代码提供统一的 world API，封装底层 WorldEngineService。
 *
 * 核心功能：
 * - world.time.*：Calendar parse / format / now
 * - world.subject.*：查询 subject 状态与引用关系
 * - world.search.*：语义搜索
 * - world.slice.*：时间线 slice 读写
 *
 * 解引用：
 * - deref=true 时自动解引用 `subject://id`
 * - derefDepth 控制递归深度（默认 1，最大 5）
 * - 循环引用防护（visited Set）
 */

const MAX_DEREF_DEPTH = 5;

export type WorldApiOptions = {
    /** World Engine Service 实例 */
    service: WorldEngineService;
    /** World Engine Repository 实例 */
    repository: WorldEngineRepository;
    /** 当前时间（用于 now() 和查询默认时间）*/
    currentInstant: Instant;
    /** 沙箱能力模式。readonly 不注入写方法。 */
    mode?: "readonly" | "readwrite";
    /** 写操作产生的 issues 会被统一收集到工具结果。 */
    issueCollector?: WorldIssue[];
    /** 日历字符串解析为 instant。 */
    parseTime?: (input: string) => bigint;
    /** instant 格式化为日历字符串。 */
    formatTime?: (instant: bigint) => string;
};

/**
 * 创建 CodeAct World API 实例。
 */
export function createWorldApi(options: WorldApiOptions): WorldApi {
    const { service, repository, currentInstant } = options;
    const issueCollector = options.issueCollector;
    let defaultQueryInstant = currentInstant;

    /**
     * 按输入顺序批量查询 subject 状态。
     */
    const gets = async (ids: string[]) => {
        if (ids.length === 0) {
            return [];
        }

        const existingSubjects = await repository.listSubjects({ids});
        const existingIds = existingSubjects.map((subject) => subject.id);
        if (existingIds.length === 0) {
            return ids.map(() => null);
        }

        const result = await service.queryState({
            subjectIds: existingIds,
            at: defaultQueryInstant,
        });

        const stateMap = new Map<string, SubjectState>();
        for (const subject of result.subjects) {
            stateMap.set(subject.subjectId, subject);
        }

        return ids.map((id) => {
            const subject = stateMap.get(id);
            return subject ? subject.attrs : null;
        });
    };

    /**
     * 查询单个 subject 的状态。
     *
     * @param id - Subject ID
     * @param options.deref - 是否自动解引用（默认 false）
     * @param options.derefDepth - 解引用深度（默认 1，最大 5）
     * @returns Subject 状态，不存在时返回 null
     */
    async function getSubject(id: string, options?: { deref?: boolean; derefDepth?: number }) {
        const existing = await repository.findSubject(id);
        if (!existing) {
            return null;
        }

        const result = await service.queryState({
            subjectIds: [id],
            at: defaultQueryInstant,
        });

        if (result.subjects.length === 0) {
            return null;
        }

        const subject = result.subjects[0];
        if (!subject) {
            return null;
        }

        if (options?.deref) {
            const depth = options.derefDepth ?? 1;
            return await derefSubject(subject, depth, new Set([id]), service, defaultQueryInstant);
        }

        return subject.attrs;
    }

    const api: WorldApi = {
        /**
         * 时间 API：项目日历字符串与底层 instant 的唯一转换入口。
         */
        time: {
            parse(calendarText: string) {
                if (!options.parseTime) {
                    throw new Error("world.time.parse 当前未接入项目日历。");
                }
                return options.parseTime(calendarText);
            },
            format(instant: bigint) {
                if (!options.formatTime) {
                    throw new Error("world.time.format 当前未接入项目日历。");
                }
                return options.formatTime(instant);
            },
            now() {
                return currentInstant;
            },
        },
        subject: {
            get: getSubject,
            gets,
            async list(type?: string) {
                return await service.listSubjects({type});
            },
            async findRefs(targetId: string, sourceType?: string) {
                // 查询所有 subject（或指定类型）
                const subjects = await repository.listSubjects({
                    type: sourceType,
                });
                const subjectIds = subjects.map((subject) => subject.id);
                if (subjectIds.length === 0) {
                    return [];
                }

                const refs: Array<{ subjectId: string; attr: string }> = [];
                const result = await service.queryState({
                    subjectIds,
                    at: defaultQueryInstant,
                });

                for (const state of result.subjects) {
                    const foundRefs = findRefsInValue(state.attrs, targetId);
                    for (const attr of foundRefs) {
                        refs.push({
                            subjectId: state.subjectId,
                            attr,
                        });
                    }
                }

                return refs;
            },
        },
        search: {
            /**
             * 向量搜索（Decision #8）。只读：在内存对未向量化命中即时 embed，不落库。
             */
            async text(query: string, options?: { k?: number; threshold?: number; types?: string[]; attrs?: string[]; at?: bigint }) {
                const results = await service.searchText(query, options ?? {});
                return results.map((item) => ({...item, attr: attrToPointer(item.attr)}));
            },
        },
        slice: {
            async list(options?: { from?: Instant; to?: Instant; limit?: number; withPatches?: boolean; subjectIds?: string[]; subjectMode?: WorldSliceSubjectFilterMode }) {
                return await service.listSlices({
                    from: options?.from,
                    to: options?.to,
                    limit: options?.limit,
                    withPatches: options?.withPatches,
                    subjectIds: options?.subjectIds,
                    subjectMode: options?.subjectMode,
                });
            },
            async get(id: string) {
                return await service.getSlice(id);
            },
        },
    };

    if ((options.mode ?? "readonly") === "readwrite") {
        api.slice.write = async (input: WorldSliceCodeActInput) => {
            const normalized = normalizeSliceInput(input);
            const result = await service.writeSlice(stripReadOnlyPatchFields(normalized));
            defaultQueryInstant = maxInstant(defaultQueryInstant, normalized.instant);
            issueCollector?.push(...result.issues);
            return result;
        };
        api.slice.editPatches = async (sliceId: string, edits: WorldPatchEdit[], meta?: WorldSliceEditMeta) => {
            const existing = await service.getSlice(sliceId);
            const patches = applyPatchEdits(existing.patches ?? [], edits);
            const result = await service.editSlice(sliceId, {
                instant: meta?.time ?? existing.instant,
                title: meta?.title ?? existing.title,
                summary: meta?.summary ?? existing.summary,
                kind: meta?.kind ?? existing.kind,
                patches,
            });
            defaultQueryInstant = maxInstant(defaultQueryInstant, meta?.time ?? existing.instant);
            issueCollector?.push(...result.issues);
            return result;
        };
        api.slice.delete = async (sliceId: string) => {
            const result = await service.deleteSlice(sliceId);
            issueCollector?.push(...result.issues);
            return result;
        };
    }

    return api;
}

function maxInstant(left: Instant, right: Instant): Instant {
    return left > right ? left : right;
}

type WorldPatchEdit =
    | {patchId: string; set: Partial<Pick<PatchInput, "path" | "op" | "value" | "summary">>}
    | {patchId: string; remove: true}
    | {add: PatchInput};

type WorldSliceEditMeta = {
    time?: Instant;
    title?: string;
    summary?: string;
    kind?: string;
};

type WorldSliceCodeActInput = Omit<SliceInput, "instant"> & {
    /** 沙箱公开字段：用 world.time.parse() 得到的 instant。 */
    time: Instant;
};

function normalizeSliceInput(input: WorldSliceCodeActInput): SliceInput {
    return {
        instant: input.time,
        title: input.title,
        summary: input.summary,
        kind: input.kind,
        patches: input.patches,
    };
}

function stripReadOnlyPatchFields(input: SliceInput): SliceInput {
    return {
        ...input,
        patches: input.patches.map(stripPatchId),
    };
}

function stripPatchId(patch: PatchInput): PatchInput {
    const {patchId: _patchId, ...rest} = patch;
    return rest;
}

function applyPatchEdits(currentPatches: PatchInput[], edits: WorldPatchEdit[]): PatchInput[] {
    const patches = currentPatches.map(stripPatchId);
    const indexByPatchId = new Map<string, number>();
    for (const [index, patch] of currentPatches.entries()) {
        if (patch.patchId) {
            indexByPatchId.set(patch.patchId, index);
        }
    }
    for (const edit of edits) {
        if ("add" in edit) {
            patches.push(stripPatchId(edit.add));
            continue;
        }
        const index = indexByPatchId.get(edit.patchId);
        if (index === undefined) {
            throw new Error(`patchId 不存在或已失效：${edit.patchId}`);
        }
        if ("remove" in edit && edit.remove) {
            patches.splice(index, 1);
            for (const [patchId, oldIndex] of [...indexByPatchId.entries()]) {
                if (oldIndex === index) {
                    indexByPatchId.delete(patchId);
                } else if (oldIndex > index) {
                    indexByPatchId.set(patchId, oldIndex - 1);
                }
            }
            continue;
        }
        if ("set" in edit) {
            const next = {...patches[index], ...normalizePatchSet(edit.set)};
            patches[index] = next as PatchInput;
        }
    }
    return patches;
}

function normalizePatchSet(set: Partial<Pick<PatchInput, "path" | "op" | "value" | "summary">>): Partial<PatchInput> {
    const result: Partial<PatchInput> = {};
    if (set.path !== undefined) {
        result.path = set.path;
    }
    if (set.op !== undefined) {
        result.op = set.op as WorldPatchOp;
    }
    if ("value" in set) {
        result.value = set.value;
    }
    if ("summary" in set) {
        result.summary = set.summary;
    }
    return result;
}

/**
 * 在值中递归查找引用。
 *
 * @param value - 要搜索的值
 * @param targetId - 目标 subject ID
 * @param prefix - 当前路径前缀
 * @returns 找到引用的属性路径列表
 */
function findRefsInValue(value: JsonValue, targetId: string, prefix: string[] = []): string[] {
    const refs: string[] = [];
    const targetRef = `subject://${targetId}`;

    // 字符串：检查是否为目标引用
    if (typeof value === "string" && value === targetRef) {
        refs.push(pointerFromParts(prefix));
        return refs;
    }

    // 数组：递归搜索元素
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const itemRefs = findRefsInValue(value[i] ?? null, targetId, [...prefix, String(i)]);
            refs.push(...itemRefs);
        }
        return refs;
    }

    // 对象：递归搜索属性
    if (typeof value === "object" && value !== null) {
        for (const [key, subValue] of Object.entries(value)) {
            const itemRefs = findRefsInValue(subValue, targetId, [...prefix, key]);
            refs.push(...itemRefs);
        }
        return refs;
    }

    return refs;
}

function pointerFromParts(parts: string[]): string {
    return `/${parts.map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function attrToPointer(attr: string): string {
    if (attr.startsWith("/")) {
        return attr;
    }
    if (!attr || attr === ".") {
        return "/";
    }
    const parts: string[] = [];
    for (const segment of attr.split(".")) {
        const matches = segment.matchAll(/([^[\]]+)|\[(\d+)\]/g);
        for (const match of matches) {
            const value = match[1] ?? match[2];
            if (value !== undefined && value !== "") {
                parts.push(value);
            }
        }
    }
    return pointerFromParts(parts);
}

/**
 * 解引用 subject 的引用字段。
 *
 * @param subject - Subject 状态
 * @param depth - 剩余解引用深度
 * @param visited - 已访问的 subject ID（防循环引用）
 * @param service - World Engine Service
 * @param at - 查询时间
 * @returns 解引用后的 attrs
 */
async function derefSubject(
    subject: SubjectState,
    depth: number,
    visited: Set<string>,
    service: WorldEngineService,
    at: Instant,
): Promise<Record<string, JsonValue>> {
    if (depth > MAX_DEREF_DEPTH) {
        throw new Error(`解引用深度超过限制（最大 ${MAX_DEREF_DEPTH}）`);
    }

    if (depth === 0) {
        return subject.attrs;
    }

    const result: Record<string, JsonValue> = {};

    for (const [key, value] of Object.entries(subject.attrs)) {
        result[key] = await derefValue(value, depth, visited, service, at);
    }

    return result;
}

/**
 * 递归解引用单个值。
 */
async function derefValue(
    value: JsonValue,
    depth: number,
    visited: Set<string>,
    service: WorldEngineService,
    at: Instant,
): Promise<JsonValue> {
    // 字符串：检查是否为引用
    if (typeof value === "string" && value.startsWith("subject://")) {
        const targetId = value.replace("subject://", "");

        // 循环引用防护
        if (visited.has(targetId)) {
            return { __ref: value, __circular: true };
        }

        // 查询目标 subject
        const targetResult = await service.queryState({
            subjectIds: [targetId],
            at,
        });

        if (targetResult.subjects.length === 0) {
            // 引用目标不存在
            return { __ref: value, __missing: true };
        }

        const targetSubject = targetResult.subjects[0];
        if (!targetSubject) {
            return {__ref: value, __missing: true};
        }
        visited.add(targetId);

        // 递归解引用
        const derefed = await derefSubject(targetSubject, depth - 1, visited, service, at);

        // 保留原始引用信息
        return {
            __ref: value,
            ...derefed,
        };
    }

    // 数组：递归解引用元素
    if (Array.isArray(value)) {
        const result: JsonValue[] = [];
        for (const item of value) {
            result.push(await derefValue(item, depth, visited, service, at));
        }
        return result;
    }

    // 对象：递归解引用属性
    if (typeof value === "object" && value !== null) {
        const result: Record<string, JsonValue> = {};
        for (const [key, subValue] of Object.entries(value)) {
            result[key] = await derefValue(subValue, depth, visited, service, at);
        }
        return result;
    }

    // 其他类型：原样返回
    return value;
}
