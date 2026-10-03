import type {
    SubjectStateDto,
    WorkbenchJsonValue,
    WorldSlicePatchDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {WorldPreviewSchemaAttr} from "nbook/app/utils/world-engine-preview";
import type {
    WorldWorkbenchPreviewMutationListPatch,
    WorldWorkbenchPreviewMutationValuePatch,
    WorldWorkbenchPreviewSchema,
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSnapshot,
    WorldWorkbenchPreviewSubject,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

type JsonObjectValue = Record<string, WorkbenchJsonValue>;

export type ApplyWorkbenchPreviewMutationPatchInput = {
    patch: WorldWorkbenchPreviewMutationValuePatch;
    schema: WorldWorkbenchPreviewSchema;
    slices: WorldWorkbenchPreviewSlice[];
    subjects: WorldWorkbenchPreviewSubject[];
};

export type ApplyWorkbenchPreviewMutationPatchResult = {
    label: string;
    slices: WorldWorkbenchPreviewSlice[];
    snapshots: WorldWorkbenchPreviewSnapshot[];
};

export type ApplyWorkbenchPreviewMutationListPatchInput = {
    patch: WorldWorkbenchPreviewMutationListPatch;
    schema: WorldWorkbenchPreviewSchema;
    slices: WorldWorkbenchPreviewSlice[];
    subjects: WorldWorkbenchPreviewSubject[];
};

/** 更新 mock patch value，并从 schema default 重新 reduce 出全部 snapshots。 */
export function applyWorkbenchPreviewMutationPatch(input: ApplyWorkbenchPreviewMutationPatchInput): ApplyWorkbenchPreviewMutationPatchResult | null {
    const targetSlice = input.slices.find((slice) => slice.id === input.patch.sliceId);
    const mutation = targetSlice?.mutations[input.patch.mutationIndex];
    if (!targetSlice || !mutation) {
        return null;
    }
    const nextSlices = input.slices.map((slice) => slice.id === input.patch.sliceId ? {
        ...slice,
        mutations: slice.mutations.map((item, index) => index === input.patch.mutationIndex ? {...item, value: input.patch.value} : item),
    } : slice);
    return {
        label: `${mutation.subjectId}${mutation.path}`,
        slices: nextSlices,
        snapshots: reduceWorkbenchPreviewSnapshots(nextSlices, input.subjects, input.schema),
    };
}

/** 整块替换 mock slice patches，并从 schema default 重新 reduce 出全部 snapshots。 */
export function applyWorkbenchPreviewMutationListPatch(input: ApplyWorkbenchPreviewMutationListPatchInput): ApplyWorkbenchPreviewMutationPatchResult | null {
    const targetSlice = input.slices.find((slice) => slice.id === input.patch.sliceId);
    if (!targetSlice) {
        return null;
    }
    const nextSlices = input.slices.map((slice) => slice.id === input.patch.sliceId ? {
        ...slice,
        mutations: input.patch.patches.map((patch) => ({...patch})),
    } : slice);
    return {
        label: `${targetSlice.id}:${input.patch.patches.length}`,
        slices: nextSlices,
        snapshots: reduceWorkbenchPreviewSnapshots(nextSlices, input.subjects, input.schema),
    };
}

/** 从 subject 身份、schema default 和 slice patches 构造每个 slice 时刻的 mock snapshot。 */
export function reduceWorkbenchPreviewSnapshots(slices: WorldWorkbenchPreviewSlice[], subjects: WorldWorkbenchPreviewSubject[], schema: WorldWorkbenchPreviewSchema): WorldWorkbenchPreviewSnapshot[] {
    const schemaTypeMap = new Map(schema.subjectTypes.map((subjectType) => [subjectType.type, subjectType]));
    const subjectStates = subjects.map<SubjectStateDto>((subject) => {
        const subjectType = schemaTypeMap.get(subject.type);
        const attrs: JsonObjectValue = {};
        for (const attr of subjectType?.attrs ?? []) {
            if (attr.default !== undefined) {
                attrs[attr.name] = cloneJsonValue(attr.default);
            }
        }
        return {
            subjectId: subject.id,
            type: subject.type,
            attrs,
        };
    });
    const subjectMap = new Map(subjectStates.map((subject) => [subject.subjectId, subject]));
    return slices.map((slice) => {
        for (const mutation of slice.mutations) {
            const subject = subjectMap.get(mutation.subjectId);
            if (subject) {
                applyMutationToSubject(subject, mutation, schema);
            }
        }
        return {
            sliceId: slice.id,
            subjects: cloneSnapshotSubjects(subjectStates),
        };
    });
}

/** 深拷贝 snapshot subjects，避免重算时污染旧状态。 */
function cloneSnapshotSubjects(subjects: SubjectStateDto[]): SubjectStateDto[] {
    return JSON.parse(JSON.stringify(subjects)) as SubjectStateDto[];
}

/** 深拷贝 JSON 值，避免 schema default 的数组 / 对象被后续 patch 共享污染。 */
function cloneJsonValue(value: WorkbenchJsonValue): WorkbenchJsonValue {
    return JSON.parse(JSON.stringify(value)) as WorkbenchJsonValue;
}

/** 在 mock snapshot subject 上应用一条 4-op patch。 */
function applyMutationToSubject(subject: SubjectStateDto, mutation: WorldSlicePatchDto, schema: WorldWorkbenchPreviewSchema): void {
    const value = mutation.value ?? null;
    const current = readPointerPath(subject.attrs, mutation.path);
    if (mutation.op === "replace") {
        writePointerPath(subject.attrs, mutation.path, value);
        return;
    }
    if (mutation.op === "remove") {
        deletePointerPath(subject.attrs, mutation.path);
        return;
    }
    if (mutation.op === "increment") {
        if (typeof current === "number" && typeof value === "number") {
            writePointerPath(subject.attrs, mutation.path, current + value);
        }
        return;
    }
    if (mutation.op === "append" && Array.isArray(current)) {
        if (isCollectionPatch(subject, mutation, schema)) {
            if (!current.some((item) => stableValueKey(item) === stableValueKey(value))) {
                current.push(value);
            }
            return;
        }
        current.push(value);
    }
}

/** 只有 collection / unique 数组使用幂等追加；普通 list 允许重复记录。 */
function isCollectionPatch(subject: SubjectStateDto, mutation: WorldSlicePatchDto, schema: WorldWorkbenchPreviewSchema): boolean {
    const parts = parseJsonPointer(mutation.path);
    const firstPart = parts[0];
    if (!firstPart) {
        return false;
    }
    const subjectType = schema.subjectTypes.find((item) => item.type === subject.type);
    let attr: WorldPreviewSchemaAttr | undefined = subjectType?.attrs.find((item) => item.name === firstPart);
    for (const part of parts.slice(1)) {
        if (attr?.kind !== "object") {
            return false;
        }
        attr = attr.fields?.[part];
    }
    return attr?.kind === "collection";
}

/** 读取 JSON Pointer 路径。 */
function readPointerPath(attrs: JsonObjectValue, path: string): WorkbenchJsonValue | undefined {
    const parts = parseJsonPointer(path);
    let cursor: WorkbenchJsonValue | undefined = attrs;
    for (const part of parts) {
        if (!isJsonObject(cursor)) {
            return undefined;
        }
        cursor = cursor[part];
    }
    return cursor;
}

/** 写入 JSON Pointer 路径，replace 语义允许创建中间对象。 */
function writePointerPath(attrs: JsonObjectValue, path: string, value: WorkbenchJsonValue): void {
    const parts = parseJsonPointer(path);
    if (!parts.length) {
        return;
    }
    let cursor: JsonObjectValue = attrs;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        if (!part) {
            continue;
        }
        const next = cursor[part];
        if (!isJsonObject(next)) {
            cursor[part] = {};
        }
        cursor = cursor[part] as JsonObjectValue;
    }
    const last = parts[parts.length - 1];
    if (last) {
        cursor[last] = value;
    }
}

/** 删除 JSON Pointer 路径；路径不存在时保持幂等。 */
function deletePointerPath(attrs: JsonObjectValue, path: string): void {
    const parts = parseJsonPointer(path);
    if (!parts.length) {
        return;
    }
    let cursor: WorkbenchJsonValue = attrs;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        const next = readContainerChild(cursor, part);
        if (!isJsonObject(next) && !Array.isArray(next)) {
            return;
        }
        cursor = next;
    }
    const last = parts[parts.length - 1];
    if (isJsonObject(cursor) && last) {
        delete cursor[last];
        return;
    }
    if (Array.isArray(cursor) && last) {
        const index = Number.parseInt(last, 10);
        if (Number.isInteger(index) && index >= 0 && index < cursor.length) {
            cursor.splice(index, 1);
        }
    }
}

/** 从对象或数组容器读取子值。 */
function readContainerChild(container: WorkbenchJsonValue, key: string | undefined): WorkbenchJsonValue | undefined {
    if (!key) {
        return undefined;
    }
    if (isJsonObject(container)) {
        return container[key];
    }
    if (Array.isArray(container)) {
        const index = Number.parseInt(key, 10);
        return Number.isInteger(index) && index >= 0 && index < container.length ? container[index] : undefined;
    }
    return undefined;
}

/** 解析 JSON Pointer，并拒绝非法或空段路径。 */
function parseJsonPointer(path: string): string[] {
    if (!path.startsWith("/") || path === "/") {
        return [];
    }
    const parts = path.slice(1).split("/");
    if (parts.some((part) => part === "")) {
        return [];
    }
    return parts.map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** 判断 JSON 值是否为可写入属性的对象。 */
function isJsonObject(value: WorkbenchJsonValue | undefined): value is JsonObjectValue {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** collection 去重使用稳定 JSON 文本。 */
function stableValueKey(value: WorkbenchJsonValue): string {
    return JSON.stringify(value);
}
