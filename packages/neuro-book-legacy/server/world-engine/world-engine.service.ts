import {createError} from "h3";
import {collectDefaultAttrs, findAttrSchema, flattenAttrs, normalizeAttrKind} from "nbook/server/world-engine/schema-loader";
import {WorldEngineRepository} from "nbook/server/world-engine/world-engine.repository";
import {cosineSimilarity, decodeVector, encodeVector} from "nbook/server/world-engine/embedding-vector";
import {
    embedTexts,
    resolveWorldEmbedding,
    type WorldEmbeddingModel,
    type WorldEmbeddingTarget,
} from "nbook/server/world-engine/world-embedding";
import {applyPatch} from "nbook/server/world-engine/patch-operations";
import {worldIssueCatalogItem} from "nbook/server/world-engine/world-issue-catalog";
import {buildWorldIssue, dedupeWorldIssues} from "nbook/server/world-engine/world-issue-builder";
import type {WorldCalendar} from "nbook/server/world-engine/calendar";
import type {
    CreateWorldSubjectInput,
    JsonValue,
    CreateWorldSubjectResult,
    DeleteSliceResult,
    EmbeddingColumns,
    PatchInput,
    QueryStateResult,
    SliceInput,
    SliceListItem,
    SliceWriteResult,
    WorldAttrSchema,
    WorldEmbeddingRow,
    WorldIssue,
    WorldIssueCode,
    WorldPatchOp,
    WorldPatchRow,
    WorldSchema,
    WorldSchemaProjection,
    WorldSliceSubjectFilterMode,
    WorldSubjectListItem,
} from "nbook/server/world-engine/types";

const OPS: WorldPatchOp[] = ["replace", "increment", "remove", "append"];
const ABSOLUTE_OPS = new Set<string>(["replace", "remove"]);
const RELATIVE_OPS = new Set<string>(["increment", "append"]);
const MAX_SLICE_PATCHES = 100;
const SQLITE_INT64_MIN = BigInt("-9223372036854775808");
const SQLITE_INT64_MAX = BigInt("9223372036854775807");
const MISSING = Symbol("missing");

/** apply 阶段检测到的属性级问题（subjectId / sliceId / patchId 由调用方补上）。 */
type AttrIssue = {code: WorldIssueCode; attr: string; path: string; op: WorldPatchOp; message: string};

/** 世界引擎核心服务。 */
export class WorldEngineService {
    constructor(
        private readonly repository: WorldEngineRepository,
        private readonly schema: WorldSchema,
        private readonly calendar: WorldCalendar,
        private readonly embeddingTarget: WorldEmbeddingTarget,
    ) {}

    /** 创建 subject；只有 schema default 或初始化 attrs 非空时才写入 init slice。 */
    async createSubject(input: CreateWorldSubjectInput): Promise<CreateWorldSubjectResult> {
        assertSubjectId(input.id, "id");
        this.assertSubjectType(input.type);
        this.assertWritableInstant(input.at, "at");
        const existing = await this.repository.findSubject(input.id);
        if (existing) {
            throw createError({statusCode: 409, message: `subject 已存在：${input.id}（当前 type=${existing.type}${existing.name ? `, name=${existing.name}` : ""}）`});
        }

        const initPatchByPath = new Map<string, PatchInput>();
        for (const item of collectDefaultAttrs(this.schema, input.type)) {
            const path = attrToPath(item.attr);
            initPatchByPath.set(path, {
                subjectId: input.id,
                path,
                op: "replace",
                value: item.value,
            });
        }
        for (const [attr, value] of Object.entries(input.attrs ?? {})) {
            const path = attrToPath(attr);
            initPatchByPath.set(path, {
                subjectId: input.id,
                path,
                op: "replace",
                value,
            });
        }
        const initPatches = [...initPatchByPath.values()];
        await this.validateInitialPatches(input.type, initPatches);
        const slice = initPatches.length > 0 ? await this.repository.findSliceByInstant(input.at) : null;
        if (slice && slice.kind !== "init") {
            throw createError({statusCode: 409, message: this.renderInstantConflict(slice, "目标时间已有非 init 切面，不能把 subject 初始化自动追加进去。请读取 existingSliceId 并显式合并初始化 patches，或选择其他初始化时间。")});
        }
        await this.repository.createSubject({id: input.id, type: input.type, name: input.name ?? ""});

        if (initPatches.length === 0) {
            return {subjectId: input.id, issues: []};
        }

        if (slice) {
            const startSeq = await this.repository.maxSeq(slice.id) + 1;
            assertPatchCapacity(startSeq + initPatches.length);
            await this.repository.appendPatches(slice.id, input.at, withSeq(initPatches, startSeq));
        } else {
            assertPatchCapacity(initPatches.length);
            await this.repository.createSlice({
                instant: input.at,
                title: input.name ? `创建 ${input.name}` : `创建 ${input.id}`,
                summary: "",
                kind: "init",
                patches: initPatches,
            }, withSeq(initPatches, 0));
        }
        // 新建 subject 只写自身初始化 replace，不会与既有链条产生 E/A，issues 恒为空。
        return {subjectId: input.id, issues: []};
    }

    /** 写入一个新的切面；同 instant 已存在时直接报错。 */
    async writeSlice(input: SliceInput): Promise<SliceWriteResult> {
        this.assertWritableInstant(input.instant, "instant");
        assertSliceKind(input.kind);

        const existing = await this.repository.findSliceByInstant(input.instant);
        if (existing) {
            throw createError({statusCode: 409, message: this.renderInstantConflict(existing, "该时间已有切面。请读取 existingSliceId 并合并 patches；只有整条切面作废时才删除重写。")});
        }
        // C1：首写自动注册 subject。把新 subject 的 WorldSubject 行登记掉，并把其 schema default
        // 作为本切面的前置 replace patch 写入（不另开 init 切面，保持单切面语义；用户 patch 在后覆盖默认值）。
        const initPatches = await this.ensureNewSubjects(input.patches);
        const patches = await this.withAppendInitializers([...initPatches, ...input.patches], {instant: input.instant});
        await this.validatePatches(patches);
        const slice = await this.repository.createSlice(input, await this.attachEmbedding(patches, 0));
        return {sliceId: slice.id, issues: await this.collectWriteIssues(input.instant, patches, affectedSubjectIds(patches))};
    }

    /**
     * C1：为 patches 中尚未登记的 subject 创建 WorldSubject 行，返回需前置写入本切面的 schema default patch。
     * - 每个新 subject 必须在其某条 patch 上声明 `type`（首写契约），否则报错引导。
     * - subject 已存在时忽略 patch 上的 type/name。
     */
    private async ensureNewSubjects(patches: PatchInput[]): Promise<PatchInput[]> {
        // 收集每个 subject 首次出现的 type/name 声明。
        const declBySubject = new Map<string, {type: string; name?: string}>();
        for (const patch of patches) {
            if (patch.type !== undefined && !declBySubject.has(patch.subjectId)) {
                declBySubject.set(patch.subjectId, {type: patch.type, name: patch.name});
            }
        }
        const initPatches: PatchInput[] = [];
        const handled = new Set<string>();
        for (const patch of patches) {
            const id = patch.subjectId;
            if (handled.has(id)) {
                continue;
            }
            handled.add(id);
            const found = await this.repository.findSubject(id);
            if (found) {
                continue;
            }
            const decl = declBySubject.get(id);
            if (!decl) {
                throw createError({statusCode: 400, message: `subject 尚未登记：${id}。首次写入时必须在其某条 patch 上声明 type（例如 { subjectId: "${id}", type: "character", path: "/name", op: "replace", value: "..." }）。`});
            }
            this.assertSubjectType(decl.type);
            await this.repository.createSubject({id, type: decl.type, name: decl.name ?? ""});
            for (const item of collectDefaultAttrs(this.schema, decl.type)) {
                initPatches.push({subjectId: id, path: attrToPath(item.attr), op: "replace", value: item.value});
            }
        }
        return initPatches;
    }

    /**
     * 写入层 append 便利：对 schema 明确声明的数组字段，如果当前时间线缺少数组基准，
     * 在 append 前插入真实 `replace []` patch。reduce 层仍保持严格，不做隐式兜底。
     */
    private async withAppendInitializers(patches: PatchInput[], options: {instant: bigint; excludeSliceId?: string}): Promise<PatchInput[]> {
        const result: PatchInput[] = [];
        const replayBySubject = new Map<string, {subjectType: string; state: Record<string, JsonValue>} | null>();

        for (const patch of patches) {
            let replay = replayBySubject.get(patch.subjectId);
            if (replay === undefined) {
                replay = await this.replaySubjectBefore(patch.subjectId, options);
                replayBySubject.set(patch.subjectId, replay);
            }

            if (replay && this.shouldInsertAppendInitializer(replay.subjectType, replay.state, patch)) {
                const initializer: PatchInput = {subjectId: patch.subjectId, path: patch.path, op: "replace", value: []};
                result.push(initializer);
                this.applyPatchToReplayState(replay.subjectType, replay.state, initializer);
            }

            result.push(patch);
            if (replay) {
                this.applyPatchToReplayState(replay.subjectType, replay.state, patch);
            }
        }

        return result;
    }

    /** 重放目标切面之前的 subject 状态；编辑当前切面时排除原切面自身。 */
    private async replaySubjectBefore(subjectId: string, options: {instant: bigint; excludeSliceId?: string}): Promise<{subjectType: string; state: Record<string, JsonValue>} | null> {
        const subject = await this.repository.findSubject(subjectId);
        if (!subject) {
            return null;
        }

        const state: Record<string, JsonValue> = {};
        const rows = await this.repository.findPatchesForSubject({
            subjectId,
            beforeInstant: options.instant,
            excludeSliceId: options.excludeSliceId,
        });
        for (const row of rows) {
            this.applyPatchToReplayState(subject.type, state, decodeRowPatch(row));
        }
        return {subjectType: subject.type, state};
    }

    private shouldInsertAppendInitializer(subjectType: string, state: Record<string, JsonValue>, patch: PatchInput): boolean {
        if (patch.op !== "append" || !patch.path.startsWith("/")) {
            return false;
        }
        const attrSchema = findAttrSchema(this.schema, subjectType, patch.path);
        const kind = normalizeAttrKind(attrSchema);
        if (!attrSchema || (kind !== "list" && kind !== "collection")) {
            return false;
        }
        return getPath(state, patch.path) === MISSING;
    }

    private applyPatchToReplayState(subjectType: string, state: Record<string, JsonValue>, patch: PatchInput): void {
        const attrSchema = findAttrSchema(this.schema, subjectType, patch.path);
        const replayPatch = patch.value === undefined || !isJsonValue(patch.value) ? patch : {...patch, value: cloneJson(patch.value)};
        applyAndDetect(state, replayPatch, attrSchema);
    }

    /** 整块替换已有切面。 */
    async editSlice(sliceId: string, input: SliceInput): Promise<SliceWriteResult> {
        assertSliceId(sliceId);
        this.assertWritableInstant(input.instant, "instant");
        assertSliceKind(input.kind);
        const existing = await this.repository.findSliceWithPatches(sliceId);
        if (!existing) {
            throw createError({statusCode: 404, message: "切面不存在"});
        }
        const sliceAtNewInstant = await this.repository.findSliceByInstant(input.instant);
        if (sliceAtNewInstant && sliceAtNewInstant.id !== sliceId) {
            throw createError({statusCode: 409, message: this.renderInstantConflict(sliceAtNewInstant, "目标时间已有其他切面，不能把两个切面改到同一 instant。请读取 existingSliceId 并合并 patches；只有整条切面作废时才删除重写。")});
        }

        const previousPatches = existing.patches.map(decodeRowPatch);
        const patches = await this.withAppendInitializers(input.patches, {instant: input.instant, excludeSliceId: sliceId});
        await this.validatePatches(patches);
        const sameSemanticSlice = existing.instant === input.instant && samePatchSequence(existing.patches, patches);
        await this.repository.replaceSlice(sliceId, input, await this.attachEmbedding(patches, 0));
        const affected = unique([...existing.patches.map((patch) => patch.subjectId), ...affectedSubjectIds(patches)]);
        return {sliceId, issues: await this.collectEditIssues({
            previousInstant: existing.instant,
            nextInstant: input.instant,
            previousPatches,
            patches,
            affectedSubjectIds: affected,
            excludeSliceId: sliceId,
            skipAdvisories: sameSemanticSlice,
        })};
    }

    /** 物理删除一个切面；删后对受影响 subject 重算持久问题（E）返回。 */
    async deleteSlice(sliceId: string): Promise<DeleteSliceResult> {
        assertSliceId(sliceId);
        const existing = await this.repository.findSliceWithPatches(sliceId);
        if (!existing) {
            throw createError({statusCode: 404, message: "切面不存在"});
        }
        const affected = unique(existing.patches.map((patch) => patch.subjectId));
        await this.repository.deleteSlice(sliceId);
        return {issues: await this.collectSubjectIssues(affected)};
    }

    /** 读取单个 timeline 切面，附 patch 与读时现算 issue。 */
    async getSlice(sliceId: string): Promise<SliceListItem> {
        assertSliceId(sliceId);
        const row = await this.repository.findSliceWithPatches(sliceId);
        if (!row) {
            throw createError({statusCode: 404, message: "切面不存在"});
        }
        const previousSlice = await this.repository.findPreviousSlice(row.instant);
        const issues = (await this.collectIssuesBySlice()).get(row.id);
        return {
            id: row.id,
            instant: row.instant,
            previousInstant: previousSlice?.instant,
            title: row.title,
            summary: row.summary,
            kind: row.kind,
            patches: row.patches.map((patch) => ({
                patchId: patch.id,
                subjectId: patch.subjectId,
                path: patch.path,
                op: patch.op as WorldPatchOp,
                ...(patch.value === null ? {} : {value: decodeJson(patch.value)}),
                ...(patch.summary ? {summary: patch.summary} : {}),
            })),
            ...(issues && issues.length ? {issues} : {}),
        };
    }

    /** 查询世界状态；无 subjectIds/type 时只供内部 UI/debug 全量路径使用，公开查询入口需自行收窄。 */
    async queryState(query: {subjectIds?: string[]; type?: string; attrs?: string[]; at?: bigint; listLimit?: number}): Promise<QueryStateResult> {
        assertSqliteInstant(query.at, "at");
        assertNonEmptyArray(query.subjectIds, "subjectIds");
        assertNonEmptyArray(query.attrs, "attrs");
        for (const attr of query.attrs ?? []) {
            assertAttrPath(attr);
        }
        for (const subjectId of query.subjectIds ?? []) {
            assertSubjectId(subjectId, "subjectId");
        }
        assertUniqueStrings(query.subjectIds, "subjectIds");
        assertUniqueStrings(query.attrs, "attrs");
        if (query.type !== undefined) {
            this.assertSubjectType(query.type);
        }
        assertListLimit(query.listLimit);
        const instant = query.at ?? await this.repository.latestInstant() ?? BigInt(0);
        const subjects = await this.repository.listSubjects({ids: query.subjectIds, type: query.type});
        assertRequestedSubjectsFound(query.subjectIds, subjects);
        const orderedSubjects = orderSubjects(subjects, query.subjectIds);
        const reduced = await Promise.all(orderedSubjects.map(async (subject) => {
            const {attrs, issues} = await this.reduceWithIssues(subject.id, instant);
            const projected = query.attrs?.length ? projectAttrs(attrs, query.attrs) : attrs;
            const limited = query.listLimit === undefined ? projected : limitAttrRecord(projected, query.listLimit, this.schema, subject.type);
            const visibleIssues = query.attrs?.length ? filterIssuesForAttrs(issues, query.attrs) : issues;
            return {state: {subjectId: subject.id, type: subject.type, attrs: limited}, issues: visibleIssues};
        }));
        return {instant, subjects: reduced.map((item) => item.state), issues: dedupeWorldIssues(reduced.flatMap((item) => item.issues))};
    }

    /** 列出 timeline 切面，附读时现算、归属到该切面的持久问题（E）。 */
    async listSlices(query: {from?: bigint; to?: bigint; limit?: number; withPatches?: boolean; subjectIds?: string[]; subjectMode?: WorldSliceSubjectFilterMode} = {}): Promise<SliceListItem[]> {
        assertSqliteInstant(query.from, "from");
        assertSqliteInstant(query.to, "to");
        assertPositiveInteger(query.limit, "limit");
        assertInstantRange(query.from, query.to);
        assertNonEmptyArray(query.subjectIds, "subjectIds");
        for (const subjectId of query.subjectIds ?? []) {
            assertSubjectId(subjectId, "subjectId");
        }
        assertUniqueStrings(query.subjectIds, "subjectIds");
        assertSliceSubjectMode(query.subjectMode, query.subjectIds);
        if (query.subjectIds?.length) {
            assertRequestedSubjectsFound(query.subjectIds, await this.repository.listSubjects({ids: query.subjectIds}));
        }
        const rows = await this.repository.listSlices(query);
        const issuesBySlice = await this.collectIssuesBySlice();
        return rows.map((row) => {
            const issues = issuesBySlice.get(row.id);
            return {
                id: row.id,
                instant: row.instant,
                title: row.title,
                summary: row.summary,
                kind: row.kind,
                patches: row.patches?.map((patch) => ({
                    patchId: patch.id,
                    subjectId: patch.subjectId,
                    path: patch.path,
                    op: patch.op as WorldPatchOp,
                    ...(patch.value === null ? {} : {value: decodeJson(patch.value)}),
                    ...(patch.summary ? {summary: patch.summary} : {}),
                })),
                ...(issues && issues.length ? {issues} : {}),
            };
        });
    }

    /** 列出 subject 身份，不返回状态。 */
    async listSubjects(query: {type?: string} = {}): Promise<WorldSubjectListItem[]> {
        if (query.type !== undefined) {
            this.assertSubjectType(query.type);
        }
        const subjects = await this.repository.listSubjects({type: query.type});
        return subjects.map((subject) => ({id: subject.id, type: subject.type, name: subject.name}));
    }

    /** 获取当前时间（latest instant，用于 CodeAct 查询）。 */
    async getCurrentInstant(): Promise<bigint> {
        return await this.repository.latestInstant() ?? BigInt(0);
    }

    /**
     * 向量搜索（Decision #8/#19/#20/#21）。
     *
     * 流程：存活集去重（memory 取最新、events 全保留）→ 同 model 过滤 → 余弦 top-k；
     * 未向量化 / 异 model 的命中即时 embed（内存，不落库，保持读侧只读）→ 保证“写了未 vectorize 也能搜到”。
     *
     * @param options.at - time-travel：只搜 instant <= at 的世界
     * @returns 相似度降序的 [{ subjectId, attr, text, score }]，不含 vector
     */
    async searchText(query: string, options: {k?: number; threshold?: number; types?: string[]; attrs?: string[]; at?: bigint} = {}): Promise<Array<{subjectId: string; attr: string; text: string; score: number}>> {
        assertPositiveInteger(options.k, "k");
        assertSearchThreshold(options.threshold);
        this.assertTextSearchScope(options);
        const trimmed = query.trim();
        if (!trimmed) {
            return [];
        }
        const model = await resolveWorldEmbedding(this.embeddingTarget);
        const at = options.at ?? await this.repository.latestInstant() ?? undefined;
        const rows = await this.repository.findEmbeddingRows({types: options.types, attrs: options.attrs, at});
        const live = this.liveEmbeddingRows(rows);
        if (live.length === 0) {
            return [];
        }
        const queryVector = (await embedTexts(model, [trimmed]))[0];
        if (!queryVector) {
            return [];
        }
        const usable = await this.resolveSearchVectors(live, model);
        const scored = usable.map((row) => ({subjectId: row.subjectId, attr: row.attr, text: row.text, score: cosineSimilarity(queryVector, row.vector)}));
        const filtered = options.threshold !== undefined ? scored.filter((item) => item.score >= options.threshold!) : scored;
        filtered.sort((left, right) => right.score - left.score);
        return filtered.slice(0, options.k ?? 10);
    }

    /**
     * 显式向量化（Decision #8/#22）：把 subject 某 embedding 字段下未向量化（或异 model）的
     * 存活条目 embed 后按行 UPDATE vector 列。写/服务侧能力，不进只读沙箱。
     */
    async vectorize(subjectId: string, attr: string): Promise<void> {
        assertSubjectId(subjectId, "subjectId");
        const subject = await this.repository.findSubject(subjectId);
        if (!subject) {
            throw createError({statusCode: 404, message: `subject 不存在：${subjectId}`});
        }
        const model = await resolveWorldEmbedding(this.embeddingTarget);
        const at = await this.repository.latestInstant() ?? undefined;
        const rows = await this.repository.findEmbeddingRows({types: [subject.type], attrs: [attr], at});
        const live = this.liveEmbeddingRows(rows).filter((row) => row.subjectId === subjectId);
        const pending = live.filter((row) => !row.vector || row.model !== model.modelId);
        if (pending.length === 0) {
            return;
        }
        const vectors = await embedTexts(model, pending.map((row) => row.text));
        for (const [index, row] of pending.entries()) {
            const vector = vectors[index];
            if (vector) {
                await this.repository.updatePatchVector(row.id, encodeVector(vector), model.modelId);
            }
        }
    }

    /** 写入时间必须既能落 SQLite，也能被当前项目 calendar 格式化展示。 */
    private assertWritableInstant(value: bigint, label: string): void {
        assertSqliteInstant(value, label);
        try {
            this.calendar.format(value);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw createError({statusCode: 400, message: `${label} 不能被当前项目 calendar 格式化：${message}`});
        }
    }

    /** 给 patch 附加 seq 与 embedding 列（写 embedding 字段的条目时拆 text/vector/model 进列）。 */
    private async attachEmbedding(patches: PatchInput[], startSeq: number): Promise<Array<PatchInput & {seq: number; embed?: EmbeddingColumns}>> {
        const typeBySubject = new Map<string, string>();
        const result: Array<PatchInput & {seq: number; embed?: EmbeddingColumns}> = [];
        for (const [index, patch] of patches.entries()) {
            let subjectType = typeBySubject.get(patch.subjectId);
            if (subjectType === undefined) {
                const subject = await this.repository.findSubject(patch.subjectId);
                subjectType = subject?.type ?? "";
                typeBySubject.set(patch.subjectId, subjectType);
            }
            const embed = subjectType ? embeddingColumnsFor(this.schema, subjectType, patch) : undefined;
            result.push({...patch, seq: startSeq + index, embed});
        }
        return result;
    }

    /** 计算 embedding 行存活集：record（memory）按 (subject,attr) 取最新且非删除，array（events）全保留。 */
    private liveEmbeddingRows(rows: WorldEmbeddingRow[]): WorldEmbeddingRow[] {
        const live: WorldEmbeddingRow[] = [];
        const latestRecordByKey = new Map<string, WorldEmbeddingRow>();
        // rows 已按 instant,seq 升序：record 后写覆盖先写。
        for (const row of rows) {
            const kind = this.embeddingAttrKind(row.subjectType, row.path);
            if (kind === "array") {
                live.push(row);
            } else if (kind === "record") {
                latestRecordByKey.set(`${row.subjectId}\u0000${row.path}`, row);
            }
        }
        for (const row of latestRecordByKey.values()) {
            if (row.op === "remove") {
                continue;
            }
            live.push(row);
        }
        return live;
    }

    /** 判断某 path 属于哪种 embedding 容器：array（字段本身）/ record（其 key 条目）/ null。 */
    private embeddingAttrKind(subjectType: string, path: string): "record" | "array" | null {
        const direct = findAttrSchema(this.schema, subjectType, path);
        if (direct?.embedding === "array") {
            return "array";
        }
        if (direct?.embedding === "record") {
            return "record";
        }
        const parts = pointerParts(path);
        if (parts.length > 1) {
            const parent = findAttrSchema(this.schema, subjectType, pointerFromParts(parts.slice(0, -1)));
            if (parent?.embedding === "record") {
                return "record";
            }
        }
        return null;
    }

    /** 把存活行解析成可比向量：同 model 用已存向量，否则即时 embed（内存，不落库）。 */
    private async resolveSearchVectors(rows: WorldEmbeddingRow[], model: WorldEmbeddingModel): Promise<Array<{subjectId: string; attr: string; text: string; vector: number[]}>> {
        const ready: Array<{subjectId: string; attr: string; text: string; vector: number[]}> = [];
        const pending: WorldEmbeddingRow[] = [];
        for (const row of rows) {
            if (row.vector && row.model === model.modelId) {
                const decoded = decodeVector(row.vector);
                if (decoded.length === model.dimensions) {
                    ready.push({subjectId: row.subjectId, attr: pathToAttr(row.path), text: row.text, vector: decoded});
                    continue;
                }
            }
            pending.push(row);
        }
        if (pending.length > 0) {
            const vectors = await embedTexts(model, pending.map((row) => row.text));
            pending.forEach((row, index) => {
                const vector = vectors[index];
                if (vector) {
                    ready.push({subjectId: row.subjectId, attr: pathToAttr(row.path), text: row.text, vector});
                }
            });
        }
        return ready;
    }

    /** 返回 Agent 友好的 schema 与 calendar 投影。 */
    getWorldSchema(): WorldSchemaProjection {
        return {
            subjectTypes: Object.entries(this.schema.subjectTypes).map(([type, subjectType]) => ({
                type,
                desc: subjectType.desc,
                attrs: flattenAttrs(subjectType.attrs),
            })),
            calendar: this.calendar.projection(),
        };
    }

    /** 写 / 编辑后的问题汇总：A（本次编辑一次性提醒）+ E（受影响 subject 的持久问题）。 */
    private async collectWriteIssues(instant: bigint, patches: PatchInput[], affectedSubjectIds: string[]): Promise<WorldIssue[]> {
        const advisories = await this.collectAdvisories(instant, patches);
        const errors = await this.collectSubjectIssues(affectedSubjectIds);
        return dedupeWorldIssues([...advisories, ...errors]);
    }

    /** editSlice 会移动或替换既有切面；A issue 需要同时观察旧位置和新位置，且排除当前切面自身。 */
    private async collectEditIssues(input: {
        previousInstant: bigint;
        nextInstant: bigint;
        previousPatches: PatchInput[];
        patches: PatchInput[];
        affectedSubjectIds: string[];
        excludeSliceId: string;
        skipAdvisories: boolean;
    }): Promise<WorldIssue[]> {
        const reordered = input.previousInstant === input.nextInstant ? reorderedOverlapCandidates(input.previousPatches, input.patches) : {previous: [], next: []};
        const previousCandidates = input.previousInstant === input.nextInstant ? uniquePatches([...diffPatches(input.previousPatches, input.patches), ...reordered.previous]) : input.previousPatches;
        const nextCandidates = input.previousInstant === input.nextInstant ? uniquePatches([...diffPatches(input.patches, input.previousPatches), ...reordered.next]) : input.patches;
        const advisories = input.skipAdvisories ? [] : dedupeWorldIssues((await Promise.all([
            this.collectAdvisories(input.previousInstant, previousCandidates, input.excludeSliceId),
            this.collectAdvisories(input.nextInstant, nextCandidates, input.excludeSliceId),
        ])).flat());
        const errors = await this.collectSubjectIssues(input.affectedSubjectIds);
        return dedupeWorldIssues([...advisories, ...errors]);
    }

    /** A 通道：本次写入的绝对 op 是否改了下游相对 op 的基（base-shifted），或被下游绝对 op 覆盖（masked）。每个 (subject,path) 只提醒一次。 */
    private async collectAdvisories(instant: bigint, patches: PatchInput[], excludeSliceId?: string): Promise<WorldIssue[]> {
        if (instant >= SQLITE_INT64_MAX) {
            return [];
        }
        const issues: WorldIssue[] = [];
        const seen = new Set<string>();
        for (const patch of patches) {
            if (!ABSOLUTE_OPS.has(patch.op)) {
                continue;
            }
            const key = `${patch.subjectId}|${patch.path}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            const downstream = await this.repository.findPatchesForSubject({subjectId: patch.subjectId, from: instant + BigInt(1), excludeSliceId});
            const coveredPaths: string[] = [];
            for (const nearest of downstream) {
                if (!attrPathsOverlap(patch.path, nearest.path) || isCoveredByPath(nearest.path, coveredPaths)) {
                    continue;
                }
                if (RELATIVE_OPS.has(nearest.op)) {
                    issues.push(buildWorldIssue({
                        code: "base-shifted",
                        sliceId: nearest.sliceId,
                        patchId: nearest.id,
                        subjectId: patch.subjectId,
                        attr: pathToAttr(nearest.path),
                        path: nearest.path,
                        op: nearest.op as WorldPatchOp,
                        message: `插入/编辑的 ${patch.op} ${patch.path} 改变了后续 ${nearest.op} ${nearest.path} 的累加基准，请确认语义是否符合预期`,
                    }));
                    coveredPaths.push(nearest.path);
                    continue;
                }
                issues.push(buildWorldIssue({
                    code: "masked",
                    sliceId: nearest.sliceId,
                    patchId: nearest.id,
                    subjectId: patch.subjectId,
                    attr: pathToAttr(nearest.path),
                    path: nearest.path,
                    op: nearest.op as WorldPatchOp,
                    message: `本次对 ${patch.path} 的修改会被后续 ${nearest.op} ${nearest.path} 覆盖，不会完整传播到最新状态`,
                }));
                if (attrPathContains(nearest.path, patch.path)) {
                    break;
                }
                coveredPaths.push(nearest.path);
            }
        }
        return issues;
    }

    /** E 通道：对一组 subject reduce 到最新，收集持久数据问题。 */
    private async collectSubjectIssues(subjectIds: string[]): Promise<WorldIssue[]> {
        const latest = await this.repository.latestInstant() ?? BigInt(0);
        const issues: WorldIssue[] = [];
        for (const subjectId of unique(subjectIds)) {
            const {issues: subIssues} = await this.reduceWithIssues(subjectId, latest);
            issues.push(...subIssues);
        }
        return dedupeWorldIssues(issues);
    }

    /** 把所有 subject 的持久问题按显形切面 sliceId 归并，供 listSlices 读时投影。 */
    private async collectIssuesBySlice(): Promise<Map<string, WorldIssue[]>> {
        const latest = await this.repository.latestInstant() ?? BigInt(0);
        const subjects = await this.repository.listSubjects();
        const bySlice = new Map<string, WorldIssue[]>();
        for (const subject of subjects) {
            const {issues} = await this.reduceWithIssues(subject.id, latest);
            for (const issue of issues) {
                if (!issue.sliceId) {
                    continue;
                }
                const list = bySlice.get(issue.sliceId) ?? [];
                list.push(issue);
                bySlice.set(issue.sliceId, list);
            }
        }
        for (const [sliceId, issues] of bySlice) {
            bySlice.set(sliceId, dedupeWorldIssues(issues));
        }
        return bySlice;
    }

    /** reduce 单个 subject 截至 instant 的状态，并收集 reduce 时显形的持久问题（E）。 */
    private async reduceWithIssues(subjectId: string, instant: bigint): Promise<{attrs: Record<string, JsonValue>; issues: WorldIssue[]}> {
        const subject = await this.repository.findSubject(subjectId);
        const rows = await this.repository.findPatchesForSubject({subjectId, at: instant});
        const state: Record<string, JsonValue> = {};
        const issues: WorldIssue[] = [];
        const originByAttr = new Map<string, string>();
        for (const row of rows) {
            const patch = decodeRowPatch(row);
            const previousValue = getPath(state, patch.path);
            const attrSchema = subject ? findAttrSchema(this.schema, subject.type, patch.path) : null;
            const issue = applyAndDetect(state, patch, attrSchema);
            if (issue) {
                issues.push(buildWorldIssue({
                    ...issue,
                    sliceId: row.sliceId,
                    patchId: row.id,
                    subjectId,
                }));
                continue;
            }
            recordOriginAfterPatch(originByAttr, patch, row.sliceId, previousValue, getPath(state, patch.path));
        }
        if (!subject) {
            return {attrs: state, issues: dedupeWorldIssues(issues)};
        }
        const danglingRefIssues = await this.collectDanglingRefIssues(subject.id, subject.type, state, originByAttr);
        return {attrs: state, issues: dedupeWorldIssues([...issues, ...danglingRefIssues])};
    }

    /** 按 schema 扫描最终状态中的 ref 值，把旧数据/手工损坏造成的悬空引用转成持久 E issue。 */
    private async collectDanglingRefIssues(subjectId: string, subjectType: string, attrs: Record<string, JsonValue>, originByAttr: Map<string, string>): Promise<WorldIssue[]> {
        const subjectSchema = this.schema.subjectTypes[subjectType];
        if (!subjectSchema) {
            return [];
        }
        const issues: WorldIssue[] = [];
        for (const [attr, attrSchema] of Object.entries(subjectSchema.attrs)) {
            const value = getPath(attrs, attr);
            if (value === MISSING) {
                continue;
            }
            await this.collectDanglingRefIssuesFromValue({subjectId, attr, value, attrSchema, originByAttr, issues});
        }
        return issues;
    }

    private async collectDanglingRefIssuesFromValue(input: {
        subjectId: string;
        attr: string;
        value: JsonValue;
        attrSchema: WorldAttrSchema;
        originByAttr: Map<string, string>;
        issues: WorldIssue[];
    }): Promise<void> {
        const kind = normalizeAttrKind(input.attrSchema);
        if (kind === "object") {
            if (!isObject(input.value)) {
                return;
            }
            if (input.attrSchema.fields) {
                for (const [field, fieldSchema] of Object.entries(input.attrSchema.fields)) {
                    if (!(field in input.value)) {
                        continue;
                    }
                    await this.collectDanglingRefIssuesFromValue({
                        ...input,
                        attr: `${input.attr}.${field}`,
                        value: input.value[field] ?? null,
                        attrSchema: fieldSchema,
                    });
                }
                return;
            }
            const refType = parseRefType(input.attrSchema.itemType ?? "");
            if (!refType) {
                return;
            }
            for (const [key, item] of Object.entries(input.value)) {
                await this.collectDanglingRefIssue(input.subjectId, `${input.attr}.${key}`, item, refType, input.originByAttr, input.issues);
            }
            return;
        }
        if (kind === "list" || kind === "collection") {
            if (!Array.isArray(input.value)) {
                return;
            }
            const refType = parseRefType(input.attrSchema.itemType ?? input.attrSchema.type ?? "");
            if (!refType) {
                return;
            }
            for (const [index, item] of input.value.entries()) {
                await this.collectDanglingRefIssue(input.subjectId, `${input.attr}[${index}]`, item, refType, input.originByAttr, input.issues);
            }
            return;
        }
        const refType = parseRefType(input.attrSchema.type ?? input.attrSchema.itemType ?? "");
        if (refType) {
            await this.collectDanglingRefIssue(input.subjectId, input.attr, input.value, refType, input.originByAttr, input.issues);
        }
    }

    private async collectDanglingRefIssue(
        subjectId: string,
        attr: string,
        value: JsonValue,
        refType: string,
        originByAttr: Map<string, string>,
        issues: WorldIssue[],
    ): Promise<void> {
        const sliceId = findOriginSlice(originByAttr, attr);
        if (typeof value !== "string" || !value.startsWith("subject://")) {
            issues.push(buildWorldIssue({
                code: "dangling-ref",
                sliceId,
                subjectId,
                attr,
                path: attrToPath(attr.replace(/\[\d+\]/g, "")),
                message: `${attr} 引用值不是 subject://<id>`,
            }));
            return;
        }
        const target = await this.repository.findSubject(value.slice("subject://".length));
        if (!target) {
            issues.push(buildWorldIssue({
                code: "dangling-ref",
                sliceId,
                subjectId,
                attr,
                path: attrToPath(attr.replace(/\[\d+\]/g, "")),
                message: `引用目标不存在：${value}`,
            }));
            return;
        }
        if (target.type !== refType) {
            issues.push(buildWorldIssue({
                code: "dangling-ref",
                sliceId,
                subjectId,
                attr,
                path: attrToPath(attr.replace(/\[\d+\]/g, "")),
                message: `引用目标类型不匹配：${value} 需要 ${refType}，实际 ${target.type}`,
            }));
        }
    }

    private renderInstantConflict(slice: {id: string; instant: bigint; title: string}, prefix: string): string {
        return `${prefix} existingSliceId=${slice.id}, time=${this.calendar.format(slice.instant)}, title=${slice.title || "(无标题)"}`;
    }

    private async validatePatches(patches: PatchInput[]): Promise<void> {
        if (patches.length === 0) {
            throw createError({statusCode: 400, message: "patches 不能为空"});
        }
        assertPatchCapacity(patches.length);
        for (const patch of patches) {
            assertSubjectId(patch.subjectId, "subjectId");
            assertJsonPointerPath(patch.path);
            if (!OPS.includes(patch.op)) {
                throw createError({statusCode: 400, message: `不支持的 patch op：${patch.op}`});
            }
            const subject = await this.repository.findSubject(patch.subjectId);
            if (!subject) {
                throw createError({statusCode: 404, message: `subject 不存在：${patch.subjectId}`});
            }
            const attrSchema = findAttrSchema(this.schema, subject.type, patch.path);
            this.validateOp(patch, attrSchema);
            await this.validateValue(patch, attrSchema, subject.type);
        }
    }

    private async validateInitialPatches(subjectType: string, patches: PatchInput[]): Promise<void> {
        assertPatchCapacity(patches.length);
        for (const patch of patches) {
            assertJsonPointerPath(patch.path);
            const attrSchema = findAttrSchema(this.schema, subjectType, patch.path);
            if (!attrSchema) {
                throw createError({statusCode: 400, message: `初始化属性不存在：${patch.path}`});
            }
            this.validateOp(patch, attrSchema);
            await this.validateValue(patch, attrSchema, subjectType);
        }
    }

    private validateOp(patch: PatchInput, attrSchema: WorldAttrSchema | null): void {
        const kind = normalizeAttrKind(attrSchema);
        const allowed: Record<ReturnType<typeof normalizeAttrKind>, WorldPatchOp[]> = {
            scalar: scalarOps(attrSchema),
            list: ["replace", "append", "remove"],
            collection: ["replace", "append", "remove"],
            object: ["replace", "remove"],
        };
        const allowedOps = allowed[kind];
        if (!allowedOps.includes(patch.op)) {
            throw createError({statusCode: 400, message: `${patch.path}(${kind}) 不支持 ${patch.op}`});
        }
    }

    private async validateValue(patch: PatchInput, attrSchema: WorldAttrSchema | null, subjectType: string): Promise<void> {
        this.validateEmbeddingWriteBoundary(subjectType, patch);
        if (patch.op === "remove") {
            if (patch.value === undefined) {
                return;
            }
            if (!isJsonValue(patch.value)) {
                throw createError({statusCode: 400, message: `${patch.path} value 必须是 JSON 值`});
            }
            const kind = normalizeAttrKind(attrSchema);
            if (kind !== "collection") {
                throw createError({statusCode: 400, message: `${patch.path} 只有 collection 支持按值 remove`});
            }
            const itemType = attrSchema?.itemType ?? attrSchema?.type;
            if (itemType) {
                await this.validateTypedValue(`${patch.path}/-`, patch.value, itemType, attrSchema ?? {}, "patch");
            }
            return;
        }
        if (patch.value === undefined) {
            throw createError({statusCode: 400, message: `${patch.path} 使用 ${patch.op} 时必须提供 value`});
        }
        if (patch.op === "increment" && (typeof patch.value !== "number" || !Number.isFinite(patch.value))) {
            throw createError({statusCode: 400, message: `${patch.path} 使用 increment 时 value 必须是 finite number`});
        }
        if (!isJsonValue(patch.value)) {
            throw createError({statusCode: 400, message: `${patch.path} value 必须是 JSON 值`});
        }
        this.validateEmbeddingTextPayload(subjectType, patch);

        if (patch.op === "replace" && attrSchema?.embedding && !isEmptyEmbeddingContainer(patch.value, attrSchema.embedding)) {
            const hint = attrSchema.embedding === "record" ? `replace ${patch.path}/<key>` : `append ${patch.path}`;
            const item = worldIssueCatalogItem("embedding-whole-replace");
            throw createError({
                statusCode: 400,
                message: `embedding 字段 ${patch.path} 禁止整块 replace 写入非空内容；空容器 replace（[] / {}）仅可用于初始化。真实文本请按 key/元素单条写入（如 ${hint}，value: {text:"..."}），vector 由系统维护。`,
                data: {
                    code: item.code,
                    label: item.label,
                    severity: item.severity,
                    title: item.title,
                    explanation: item.explanation,
                },
            });
        }

        const kind = normalizeAttrKind(attrSchema);
        if (patch.op === "append") {
            if (kind !== "list" && kind !== "collection") {
                throw createError({statusCode: 400, message: `${patch.path} 只有数组属性支持 append`});
            }
            const itemType = attrSchema?.itemType ?? attrSchema?.type;
            if (itemType) {
                await this.validateTypedValue(`${patch.path}/-`, patch.value, itemType, attrSchema ?? {}, "patch");
            }
            return;
        }

        if (attrSchema && (kind === "list" || kind === "collection") && patch.op === "replace") {
            if (!Array.isArray(patch.value)) {
                throw createError({statusCode: 400, message: `${patch.path}${valueErrorSuffix("array", "patch")}`});
            }
            const itemType = attrSchema.itemType ?? attrSchema.type;
            if (itemType) {
                for (const [index, item] of patch.value.entries()) {
                    await this.validateTypedValue(`${patch.path}/${index}`, item, itemType, attrSchema, "patch");
                }
            }
            return;
        }

        const type = attrSchema?.type ?? attrSchema?.itemType;
        if (attrSchema && normalizeAttrKind(attrSchema) === "object") {
            await this.validateObjectValue(pathToAttr(patch.path), patch.value ?? null, attrSchema, "patch");
            return;
        }
        if (!attrSchema || !type) {
            return;
        }
        if (type === "object") {
            if (!isObject(patch.value)) {
                throw createError({statusCode: 400, message: `${patch.path}${valueErrorSuffix("object", "patch")}`});
            }
            return;
        }
        await this.validateTypedValue(patch.path, patch.value, type, attrSchema, "patch");
    }

    private validateEmbeddingWriteBoundary(subjectType: string, patch: PatchInput): void {
        const container = this.findEmbeddingContainer(subjectType, patch.path);
        if (!container) {
            return;
        }

        const pathParts = pointerParts(patch.path);
        const containerParts = pointerParts(container.path);
        const relativeDepth = pathParts.length - containerParts.length;

        if (container.attr.embedding === "array") {
            if (relativeDepth === 0) {
                if (patch.op === "append") {
                    return;
                }
                if (patch.op === "replace") {
                    return;
                }
            }
            throw createError({
                statusCode: 400,
                message: `EmbeddingText array 字段 ${container.path} 只支持 replace 空数组初始化或 append 单条 {text:"..."}；不要直接写 ${patch.path}，如需修正历史文本请用 world.slice.editPatches 修改原 patch。`,
            });
        }

        if (relativeDepth === 0) {
            if (patch.op === "replace") {
                return;
            }
            throw createError({
                statusCode: 400,
                message: `EmbeddingText record 字段 ${container.path} 只支持 replace 空对象初始化，真实文本请写到 ${container.path}/<key>。`,
            });
        }

        if (relativeDepth === 1 && (patch.op === "replace" || patch.op === "remove")) {
            return;
        }

        throw createError({
            statusCode: 400,
            message: `EmbeddingText record 字段 ${container.path} 的真实文本必须按 key 整条 replace/remove；不要直接写 ${patch.path}，vector/model 由系统维护。`,
        });
    }

    private findEmbeddingContainer(subjectType: string, path: string): {path: string; attr: WorldAttrSchema} | null {
        const parts = pointerParts(path);
        for (let end = parts.length; end >= 1; end--) {
            const candidatePath = pointerFromParts(parts.slice(0, end));
            const attr = findAttrSchema(this.schema, subjectType, candidatePath);
            if (attr?.embedding) {
                return {path: candidatePath, attr};
            }
        }
        return null;
    }

    private validateEmbeddingTextPayload(subjectType: string, patch: PatchInput): void {
        if (!this.isEmbeddingTextItemWrite(subjectType, patch)) {
            return;
        }

        const value = patch.value;
        if (!isObject(value) || !hasOwn(value, "text") || Object.keys(value).length !== 1 || typeof value.text !== "string" || value.text.trim() === "") {
            throw createError({
                statusCode: 400,
                message: `EmbeddingText 字段 ${patch.path} 的公共写入只接受 {text:"非空文本"}；vector/model 由系统维护，额外 metadata 需要另行设计。`,
            });
        }
    }

    private isEmbeddingTextItemWrite(subjectType: string, patch: PatchInput): boolean {
        const direct = findAttrSchema(this.schema, subjectType, patch.path);
        if (patch.op === "append" && direct?.embedding === "array") {
            return true;
        }

        const parts = pointerParts(patch.path);
        const parent = parts.length > 1 ? findAttrSchema(this.schema, subjectType, pointerFromParts(parts.slice(0, -1))) : null;
        return patch.op === "replace" && parent?.embedding === "record";
    }

    private async validateObjectValue(attr: string, value: JsonValue, attrSchema: WorldAttrSchema, mode: "patch" | "default"): Promise<void> {
        if (!isObject(value)) {
            throw createError({statusCode: 400, message: `${attr}${valueErrorSuffix("object", mode)}`});
        }
        if (attrSchema.fields) {
            for (const key of Object.keys(value)) {
                const fieldSchema = attrSchema.fields[key];
                if (!fieldSchema) {
                    throw createError({statusCode: 400, message: `${attr}.${key} 未在 object.fields 声明`});
                }
                await this.validateValueBySchema(`${attr}.${key}`, value[key] ?? null, fieldSchema, mode);
            }
            return;
        }
        if (attrSchema.itemType) {
            for (const [key, item] of Object.entries(value)) {
                await this.validateTypedValue(`${attr}.${key}`, item, attrSchema.itemType, attrSchema, mode);
            }
        }
    }

    private async validateValueBySchema(attr: string, value: JsonValue, attrSchema: WorldAttrSchema, mode: "patch" | "default"): Promise<void> {
        if (normalizeAttrKind(attrSchema) === "object") {
            await this.validateObjectValue(attr, value, attrSchema, mode);
            return;
        }
        const type = attrSchema.type ?? attrSchema.itemType;
        if (type) {
            await this.validateTypedValue(attr, value, type, attrSchema, mode);
        }
    }

    private async validateTypedValue(attr: string, value: JsonValue | undefined, type: string, attrSchema: WorldAttrSchema, mode: "patch" | "default"): Promise<void> {
        if (type === "int" && (!Number.isInteger(value) || typeof value !== "number")) {
            throw createError({statusCode: 400, message: `${attr}${valueErrorSuffix("int", mode)}`});
        }
        if (type === "int" && !Number.isSafeInteger(value)) {
            throw createError({statusCode: 400, message: `${attr}${safeIntegerErrorSuffix(mode)}`});
        }
        if (type === "float" && (typeof value !== "number" || !Number.isFinite(value))) {
            throw createError({statusCode: 400, message: `${attr}${valueErrorSuffix("float", mode)}`});
        }
        if (type === "text" && typeof value !== "string") {
            throw createError({statusCode: 400, message: `${attr}${valueErrorSuffix("text", mode)}`});
        }
        if (type === "bool" && typeof value !== "boolean") {
            throw createError({statusCode: 400, message: `${attr}${valueErrorSuffix("bool", mode)}`});
        }
        if (type === "enum" && attrSchema.enum && !attrSchema.enum.some((item) => stableJson(item) === stableJson(toJsonValue(value)))) {
            throw createError({statusCode: 400, message: `${attr}${enumErrorSuffix(mode)}`});
        }
        if (type === "object" && !isObject(value)) {
            throw createError({statusCode: 400, message: `${attr}${valueErrorSuffix("object", mode)}`});
        }
        const refType = parseRefType(type);
        if (refType) {
            await this.validateRef(value, refType, attr);
        }
    }

    private async validateRef(value: JsonValue | undefined, refType: string, attr: string): Promise<void> {
        if (typeof value !== "string" || !value.startsWith("subject://")) {
            throw createError({statusCode: 400, message: `${attr} 必须是 subject://<id> 引用`});
        }
        const targetId = value.slice("subject://".length);
        assertSubjectId(targetId, `${attr} 引用 id`);
        const target = await this.repository.findSubject(targetId);
        if (!target) {
            throw createError({statusCode: 400, message: `引用目标不存在：${value}`});
        }
        if (target.type !== refType) {
            throw createError({statusCode: 400, message: `引用目标类型不匹配：${value} 需要 ${refType}，实际 ${target.type}`});
        }
    }

    private assertSubjectType(type: string): void {
        assertSubjectTypeKey(type);
        if (Object.keys(this.schema.subjectTypes).length > 0 && !this.schema.subjectTypes[type]) {
            throw createError({statusCode: 400, message: `schema 未声明 subject type：${type}`});
        }
    }

    /**
     * 在发起 embedding 请求前校验语义搜索范围。
     *
     * “schema 没有可检索字段”与“有能力但当前没有文本”是不同状态：前者属于配置错误，
     * 后者才应返回空结果。显式 type / attr 拼错也必须就地拒绝，避免把调用错误伪装成零命中。
     */
    private assertTextSearchScope(options: {types?: string[]; attrs?: string[]}): void {
        assertNonEmptyArray(options.types, "types");
        assertNonEmptyArray(options.attrs, "attrs");
        assertUniqueStrings(options.types, "types");
        assertUniqueStrings(options.attrs, "attrs");

        const schemaTypes = Object.keys(this.schema.subjectTypes);
        const types = options.types ?? schemaTypes;
        for (const type of types) {
            this.assertSubjectType(type);
        }

        const embeddingAttrsByType = new Map<string, Set<string>>();
        for (const type of types) {
            const subjectType = this.schema.subjectTypes[type];
            if (subjectType) {
                embeddingAttrsByType.set(type, collectEmbeddingAttrs(subjectType.attrs));
            }
        }
        const availableAttrs = unique([...embeddingAttrsByType.values()].flatMap((attrs) => [...attrs]));
        if (availableAttrs.length === 0) {
            const scope = options.types?.length ? `subject type ${options.types.join(", ")}` : "当前 schema";
            throw createError({statusCode: 400, message: `${scope} 没有声明 EmbeddingText 字段，world.search.text 无可检索范围`});
        }

        for (const attr of options.attrs ?? []) {
            const normalizedAttr = attr.startsWith("/") ? pointerParts(attr).join(".") : attr;
            assertAttrPath(normalizedAttr);
            if (!availableAttrs.includes(normalizedAttr)) {
                throw createError({
                    statusCode: 400,
                    message: `attr 不是当前搜索范围内的 EmbeddingText 字段：${attr}（可用：${availableAttrs.join(", ")}）`,
                });
            }
        }
    }
}

/** 收集 schema 中承载 EmbeddingText 的属性路径。 */
function collectEmbeddingAttrs(attrs: Record<string, WorldAttrSchema>, prefix = ""): Set<string> {
    const result = new Set<string>();
    for (const [name, attr] of Object.entries(attrs)) {
        const path = prefix ? `${prefix}.${name}` : name;
        if (attr.embedding) {
            result.add(path);
        }
        if (attr.fields) {
            for (const nested of collectEmbeddingAttrs(attr.fields, path)) {
                result.add(nested);
            }
        }
    }
    return result;
}

/** 给一组 patch 补上从 startSeq 起的应用顺序。 */
function withSeq(patches: PatchInput[], startSeq: number): Array<PatchInput & {seq: number}> {
    return patches.map((patch, offset) => ({...patch, seq: startSeq + offset}));
}

function decodeRowPatch(row: WorldPatchRow): PatchInput {
    return {
        subjectId: row.subjectId,
        path: row.path,
        op: row.op as WorldPatchOp,
        ...(row.value === null ? {} : {value: decodeJson(row.value)}),
        ...(row.summary ? {summary: row.summary} : {}),
    };
}

function samePatchSequence(rows: WorldPatchRow[], patches: PatchInput[]): boolean {
    if (rows.length !== patches.length) {
        return false;
    }
    return rows.every((row, index) => patchSignature(decodeRowPatch(row)) === patchSignature(patches[index]));
}

function diffPatches(left: PatchInput[], right: PatchInput[]): PatchInput[] {
    const rightCounts = new Map<string, number>();
    for (const patch of right) {
        const signature = patchSignature(patch);
        rightCounts.set(signature, (rightCounts.get(signature) ?? 0) + 1);
    }
    const diff: PatchInput[] = [];
    for (const patch of left) {
        const signature = patchSignature(patch);
        const count = rightCounts.get(signature) ?? 0;
        if (count > 0) {
            rightCounts.set(signature, count - 1);
            continue;
        }
        diff.push(patch);
    }
    return diff;
}

function reorderedOverlapCandidates(previous: PatchInput[], next: PatchInput[]): {previous: PatchInput[]; next: PatchInput[]} {
    if (samePatchInputSequence(previous, next)) {
        return {previous: [], next: []};
    }
    const previousIndexes = new Map<string, number[]>();
    for (const [index, patch] of previous.entries()) {
        const signature = patchSignature(patch);
        previousIndexes.set(signature, [...(previousIndexes.get(signature) ?? []), index]);
    }
    const matched = next.map((patch, nextIndex) => {
        const indexes = previousIndexes.get(patchSignature(patch)) ?? [];
        const previousIndex = indexes.shift();
        return previousIndex === undefined ? null : {previousIndex, nextIndex, previous: previous[previousIndex], next: patch};
    }).filter((item): item is {previousIndex: number; nextIndex: number; previous: PatchInput; next: PatchInput} => item !== null);
    const previousCandidates: PatchInput[] = [];
    const nextCandidates: PatchInput[] = [];
    for (let left = 0; left < matched.length; left += 1) {
        const leftItem = matched[left];
        if (!leftItem) {
            continue;
        }
        for (let right = left + 1; right < matched.length; right += 1) {
            const rightItem = matched[right];
            if (!rightItem) {
                continue;
            }
            if (leftItem.previousIndex < rightItem.previousIndex || !patchesOverlap(leftItem.next, rightItem.next)) {
                continue;
            }
            previousCandidates.push(leftItem.previous, rightItem.previous);
            nextCandidates.push(leftItem.next, rightItem.next);
        }
    }
    return {previous: uniquePatches(previousCandidates), next: uniquePatches(nextCandidates)};
}

function samePatchInputSequence(left: PatchInput[], right: PatchInput[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((patch, index) => patchSignature(patch) === patchSignature(right[index]));
}

function patchesOverlap(left: PatchInput, right: PatchInput): boolean {
    return left.subjectId === right.subjectId && attrPathsOverlap(left.path, right.path);
}

function uniquePatches(patches: PatchInput[]): PatchInput[] {
    const seen = new Set<string>();
    const uniqueItems: PatchInput[] = [];
    for (const patch of patches) {
        const signature = patchSignature(patch);
        if (seen.has(signature)) {
            continue;
        }
        seen.add(signature);
        uniqueItems.push(patch);
    }
    return uniqueItems;
}

function patchSignature(patch: PatchInput | undefined): string {
    if (!patch) {
        return "";
    }
    const value = patch.value === undefined ? "u" : `v:${stableJson(toJsonValue(patch.value))}`;
    return `${patch.subjectId}\u0000${patch.path}\u0000${patch.op}\u0000${value}\u0000${patch.summary ?? ""}`;
}

function scalarOps(attrSchema: WorldAttrSchema | null): WorldPatchOp[] {
    const type = attrSchema?.type;
    if (!type || type === "int" || type === "float") {
        return ["replace", "increment", "remove"];
    }
    return ["replace", "remove"];
}

/**
 * 应用一条 patch 到 reduce 状态；遇到无法应用的 patch 时**不兜底**，
 * 返回属性级问题，由调用方补 subjectId / sliceId / patchId。
 */
function applyAndDetect(state: Record<string, JsonValue>, patch: PatchInput, attrSchema: WorldAttrSchema | null = null): AttrIssue | null {
    const uniqueArrays = normalizeAttrKind(attrSchema) === "collection" ? new Set([pathToAttr(patch.path)]) : new Set<string>();
    const issue = applyPatch(state, patch, attrSchema, uniqueArrays);
    if (!issue) {
        return null;
    }
    return {code: issue.code, attr: pathToAttr(issue.path), path: issue.path, op: patch.op, message: issue.message};
}

function pathParts(pathOrAttr: string): string[] {
    return pathOrAttr.startsWith("/") ? pointerParts(pathOrAttr) : pathOrAttr.split(".").filter(Boolean);
}

function pointerParts(path: string): string[] {
    return path.slice(1).split("/").filter(Boolean).map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function pointerFromParts(parts: string[]): string {
    return `/${parts.map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function attrToPath(attr: string): string {
    return attr.startsWith("/") ? attr : pointerFromParts(attr.split(".").filter(Boolean));
}

function pathToAttr(path: string): string {
    return path.startsWith("/") ? pointerParts(path).join(".") : path;
}

function getPath(state: Record<string, JsonValue>, attr: string): JsonValue | typeof MISSING {
    let current: JsonValue | undefined = state;
    for (const part of pathParts(attr)) {
        if (!isObject(current) || !(part in current)) {
            return MISSING;
        }
        current = current[part] ?? null;
    }
    return current ?? null;
}

function setPath(state: Record<string, JsonValue>, attr: string, value: JsonValue): void {
    const parts = pathParts(attr);
    const leaf = parts.at(-1);
    if (!leaf) {
        throw createError({statusCode: 400, message: "attr 不能为空"});
    }
    let current: Record<string, JsonValue> = state;
    for (const part of parts.slice(0, -1)) {
        const next = current[part];
        if (!isObject(next)) {
            current[part] = {};
        }
        current = current[part] as Record<string, JsonValue>;
    }
    current[leaf] = value;
}

function unsetPath(state: Record<string, JsonValue>, attr: string): void {
    const parts = pathParts(attr);
    const leaf = parts.at(-1);
    if (!leaf) {
        throw createError({statusCode: 400, message: "attr 不能为空"});
    }
    let current: JsonValue = state;
    for (const part of parts.slice(0, -1)) {
        if (!isObject(current)) {
            return;
        }
        current = current[part] ?? null;
    }
    if (isObject(current)) {
        delete current[leaf];
    }
}

function decodeJson(input: string): JsonValue {
    return JSON.parse(input) as JsonValue;
}

function toJsonValue(input: JsonValue | undefined): JsonValue {
    if (input === undefined) {
        return null;
    }
    return JSON.parse(JSON.stringify(input)) as JsonValue;
}

function cloneJson<T extends JsonValue>(input: T): T {
    return JSON.parse(JSON.stringify(input)) as T;
}

function projectAttrs(attrs: Record<string, JsonValue>, paths: string[]): Record<string, JsonValue> {
    const projected: Record<string, JsonValue> = {};
    for (const path of paths) {
        const value = getPath(attrs, path);
        if (value !== MISSING) {
            setPath(projected, path, cloneJson(value));
        }
    }
    return projected;
}

function filterIssuesForAttrs(issues: WorldIssue[], attrs: string[]): WorldIssue[] {
    return issues.filter((issue) => attrs.some((attr) => attrPathsOverlap(attr, issue.attr)));
}

function attrPathsOverlap(left: string, right: string): boolean {
    return attrPathContains(left, right) || attrPathContains(right, left);
}

function attrPathContains(parent: string, child: string): boolean {
    const normalizedParent = pathToAttr(parent);
    const normalizedChild = pathToAttr(child);
    return normalizedParent === normalizedChild || normalizedChild.startsWith(`${normalizedParent}.`) || normalizedChild.startsWith(`${normalizedParent}[`);
}

function isCoveredByPath(attr: string, paths: string[]): boolean {
    return paths.some((path) => attrPathContains(path, attr));
}

function limitBySchema(value: JsonValue, attrSchema: WorldAttrSchema | null, limit: number): JsonValue {
    const kind = normalizeAttrKind(attrSchema);
    if ((kind === "list" || kind === "collection") && Array.isArray(value)) {
        return value.slice(-limit).map((item) => cloneJson(item));
    }
    if (kind === "object" && attrSchema?.fields && isObject(value)) {
        const limited: Record<string, JsonValue> = {};
        for (const [key, item] of Object.entries(value)) {
            limited[key] = limitBySchema(item, attrSchema.fields[key] ?? null, limit);
        }
        return limited;
    }
    return cloneJson(value);
}

function limitAttrRecord(value: Record<string, JsonValue>, limit: number, schema: WorldSchema, subjectType: string): Record<string, JsonValue> {
    const limited: Record<string, JsonValue> = {};
    for (const [attr, item] of Object.entries(value)) {
        limited[attr] = limitBySchema(item, findAttrSchema(schema, subjectType, attr), limit);
    }
    return limited;
}

function isObject(input: JsonValue | undefined): input is Record<string, JsonValue> {
    return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasOwn(input: Record<string, JsonValue>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

/** 空 EmbeddingText 容器 replace 只用于建立相对 op 基准。 */
function isEmptyEmbeddingContainer(value: JsonValue, embedding: "record" | "array"): boolean {
    if (embedding === "array") {
        return Array.isArray(value) && value.length === 0;
    }
    return isObject(value) && Object.keys(value).length === 0;
}

function isJsonValue(input: unknown): input is JsonValue {
    if (input === null || typeof input === "string" || typeof input === "boolean") {
        return true;
    }
    if (typeof input === "number") {
        return Number.isFinite(input);
    }
    if (Array.isArray(input)) {
        return input.every(isJsonValue);
    }
    if (isObjectLike(input)) {
        return Object.values(input).every(isJsonValue);
    }
    return false;
}

function isObjectLike(input: unknown): input is Record<string, unknown> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(input);
    return prototype === Object.prototype || prototype === null;
}

function parseRefType(type: string): string | null {
    const match = /^ref\(([^)]+)\)$/.exec(type);
    return match?.[1] ?? null;
}

/** EmbeddingText 值判定：对象且 text 为字符串。 */
function isEmbeddingValue(value: JsonValue | undefined): value is Record<string, JsonValue> {
    return isObject(value) && typeof value.text === "string";
}

/**
 * 若 patch 写的是 embedding 字段的单条内容，拆出 text/vector/model 列；否则 undefined。
 * - array（events）：append 到容器 path，value 是一条 EmbeddingText
 * - record（memory）：replace 到 `/memory/<key>`，value 是一条 EmbeddingText
 */
function embeddingColumnsFor(schema: WorldSchema, subjectType: string, patch: PatchInput): EmbeddingColumns | undefined {
    const value = patch.value;
    if (!isEmbeddingValue(value)) {
        return undefined;
    }
    const direct = findAttrSchema(schema, subjectType, patch.path);
    if (direct?.embedding === "array" && patch.op === "append") {
        return extractEmbeddingColumns(value);
    }
    if (patch.op === "replace") {
        const parts = pointerParts(patch.path);
        if (parts.length > 1) {
            const parent = findAttrSchema(schema, subjectType, pointerFromParts(parts.slice(0, -1)));
            if (parent?.embedding === "record") {
                return extractEmbeddingColumns(value);
            }
        }
    }
    return undefined;
}

function extractEmbeddingColumns(value: Record<string, JsonValue>): EmbeddingColumns {
    const rawVector = value.vector;
    const vector = Array.isArray(rawVector) && rawVector.every((item) => typeof item === "number") ? encodeVector(rawVector as number[]) : null;
    const model = typeof value.model === "string" ? value.model : null;
    return {text: value.text as string, vector, model};
}

function recordOriginAfterPatch(
    originByAttr: Map<string, string>,
    patch: PatchInput,
    sliceId: string,
    previousValue: JsonValue | typeof MISSING,
    currentValue: JsonValue | typeof MISSING,
): void {
    const attr = pathToAttr(patch.path);
    if (patch.op === "remove") {
        clearOrigin(originByAttr, attr);
        return;
    }
    if (patch.op === "append") {
        if (!Array.isArray(currentValue)) {
            return;
        }
        if (Array.isArray(previousValue) && currentValue.length <= previousValue.length) {
            return;
        }
        originByAttr.set(`${attr}[${currentValue.length - 1}]`, sliceId);
        return;
    }
    originByAttr.set(attr, sliceId);
}

function clearOrigin(originByAttr: Map<string, string>, attr: string): void {
    for (const key of [...originByAttr.keys()]) {
        if (key === attr || key.startsWith(`${attr}.`) || key.startsWith(`${attr}[`)) {
            originByAttr.delete(key);
        }
    }
}

function remapCollectionOrigins(
    originByAttr: Map<string, string>,
    attr: string,
    previousValue: JsonValue | typeof MISSING,
    currentValue: JsonValue | typeof MISSING,
): void {
    if (!Array.isArray(previousValue) || !Array.isArray(currentValue)) {
        return;
    }
    const originByValue = new Map<string, string>();
    previousValue.forEach((item, index) => {
        const origin = originByAttr.get(`${attr}[${index}]`) ?? originByAttr.get(attr);
        if (origin) {
            originByValue.set(stableJson(item), origin);
        }
    });
    clearOrigin(originByAttr, attr);
    currentValue.forEach((item, index) => {
        const origin = originByValue.get(stableJson(item));
        if (origin) {
            originByAttr.set(`${attr}[${index}]`, origin);
        }
    });
}

function findOriginSlice(originByAttr: Map<string, string>, attr: string): string | undefined {
    const exact = originByAttr.get(attr);
    if (exact) {
        return exact;
    }
    const normalized = attr.replace(/\[\d+\]/g, "");
    const parts = normalized.split(".");
    while (parts.length > 0) {
        const sliceId = originByAttr.get(parts.join("."));
        if (sliceId) {
            return sliceId;
        }
        parts.pop();
    }
    return undefined;
}

function valueErrorSuffix(type: string, mode: "patch" | "default"): string {
    return mode === "default" ? ` default 必须是 ${type}` : ` 必须是 ${type}`;
}

function safeIntegerErrorSuffix(mode: "patch" | "default"): string {
    return mode === "default" ? " default 必须是安全整数" : " 必须是安全整数";
}

function enumErrorSuffix(mode: "patch" | "default"): string {
    return mode === "default" ? " default 不在 enum 取值内" : " 不在 enum 取值内";
}

function affectedSubjectIds(patches: PatchInput[]): string[] {
    return unique(patches.map((patch) => patch.subjectId));
}

function assertRequestedSubjectsFound<TSubject extends {id: string}>(requestedIds: string[] | undefined, subjects: TSubject[]): void {
    if (!requestedIds?.length) {
        return;
    }
    const foundIds = new Set(subjects.map((subject) => subject.id));
    const missing = unique(requestedIds.filter((id) => !foundIds.has(id)));
    if (missing.length) {
        throw createError({statusCode: 404, message: `subject 不存在或不匹配查询条件：${missing.join(", ")}`});
    }
}

function assertUniqueStrings(values: string[] | undefined, label: string): void {
    if (!values?.length) {
        return;
    }
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const value of values) {
        if (seen.has(value) && !duplicates.includes(value)) {
            duplicates.push(value);
        }
        seen.add(value);
    }
    if (duplicates.length) {
        throw createError({statusCode: 400, message: `${label} 不能重复：${duplicates.join(", ")}`});
    }
}

function assertNonEmptyArray(values: string[] | undefined, label: string): void {
    if (values !== undefined && values.length === 0) {
        throw createError({statusCode: 400, message: `${label} 不能为空`});
    }
}

function assertAttrPath(attr: string): void {
    const parts = attr.split(".");
    if (parts.some((part) => part.trim() === "")) {
        throw createError({statusCode: 400, message: `attr 路径不能包含空段：${attr}`});
    }
    if (parts.some((part) => part !== part.trim())) {
        throw createError({statusCode: 400, message: `attr 路径段不能包含前后空白：${attr}`});
    }
}

function assertJsonPointerPath(path: string): void {
    if (path.trim() === "") {
        throw createError({statusCode: 400, message: "path 不能为空"});
    }
    if (path !== path.trim()) {
        throw createError({statusCode: 400, message: `path 不能包含前后空白：${path}`});
    }
    if (!path.startsWith("/")) {
        throw createError({statusCode: 400, message: `path 必须是 JSON Pointer（以 / 开头）：${path}`});
    }
    const parts = path.slice(1).split("/");
    if (parts.length === 0 || parts.some((part) => part === "")) {
        throw createError({statusCode: 400, message: `path 不能包含空段：${path}`});
    }
    if (parts.some((part) => /~(?![01])/.test(part))) {
        throw createError({statusCode: 400, message: `path 只能使用 JSON Pointer 转义 ~0 / ~1：${path}`});
    }
}

function assertSubjectId(subjectId: string, label: string): void {
    if (subjectId.trim() === "") {
        throw createError({statusCode: 400, message: `${label} 不能为空`});
    }
    if (subjectId !== subjectId.trim()) {
        throw createError({statusCode: 400, message: `${label} 不能包含前后空白：${subjectId}`});
    }
}

function assertSliceId(sliceId: string): void {
    if (sliceId.trim() === "") {
        throw createError({statusCode: 400, message: "sliceId 不能为空"});
    }
    if (sliceId !== sliceId.trim()) {
        throw createError({statusCode: 400, message: `sliceId 不能包含前后空白：${sliceId}`});
    }
}

function assertSubjectTypeKey(type: string): void {
    if (type.trim() === "") {
        throw createError({statusCode: 400, message: "subject type 不能为空"});
    }
    if (/\s/.test(type)) {
        throw createError({statusCode: 400, message: `subject type 不能包含空白：${type}`});
    }
    if (type.includes("(") || type.includes(")")) {
        throw createError({statusCode: 400, message: `subject type 不能包含括号：${type}`});
    }
}

function assertSliceKind(kind: string | undefined): void {
    if (kind === undefined) {
        return;
    }
    if (kind.trim() === "") {
        throw createError({statusCode: 400, message: "kind 不能为空"});
    }
    if (kind !== kind.trim()) {
        throw createError({statusCode: 400, message: `kind 不能包含前后空白：${kind}`});
    }
}

function assertSliceSubjectMode(mode: WorldSliceSubjectFilterMode | undefined, subjectIds: string[] | undefined): void {
    if (mode === undefined) {
        return;
    }
    if (mode !== "any" && mode !== "all") {
        throw createError({statusCode: 400, message: "subjectMode 必须是 any 或 all"});
    }
    if (!subjectIds?.length) {
        throw createError({statusCode: 400, message: "subjectMode 需要同时提供 subjectIds"});
    }
}

function assertListLimit(listLimit: number | undefined): void {
    if (listLimit === undefined) {
        return;
    }
    if (!Number.isInteger(listLimit) || listLimit < 1 || listLimit > 100) {
        throw createError({statusCode: 400, message: "listLimit 必须是 1..100 的整数"});
    }
}

function assertSqliteInstant(value: bigint | undefined, label: string): void {
    if (value === undefined) {
        return;
    }
    if (value < SQLITE_INT64_MIN || value > SQLITE_INT64_MAX) {
        throw createError({statusCode: 400, message: `${label} 超出 SQLite INTEGER 64 位范围：${value}`});
    }
}

function assertPatchCapacity(count: number): void {
    if (count > MAX_SLICE_PATCHES) {
        throw createError({statusCode: 400, message: `patches 不能超过 ${MAX_SLICE_PATCHES} 条`});
    }
}

function assertPositiveInteger(value: number | undefined, label: string): void {
    if (value === undefined) {
        return;
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw createError({statusCode: 400, message: `${label} 必须是安全正整数`});
    }
}

function assertSearchThreshold(value: number | undefined): void {
    if (value === undefined) {
        return;
    }
    if (!Number.isFinite(value) || value < -1 || value > 1) {
        throw createError({statusCode: 400, message: "threshold 必须是 -1..1 范围内的有限数字"});
    }
}

function assertInstantRange(from: bigint | undefined, to: bigint | undefined): void {
    if (from !== undefined && to !== undefined && from > to) {
        throw createError({statusCode: 400, message: "from 不能晚于 to"});
    }
}

function unique(input: string[]): string[] {
    return [...new Set(input)].sort((left, right) => left.localeCompare(right));
}

function uniqueInstants(input: bigint[]): bigint[] {
    return [...new Set(input.map((item) => item.toString()))].map((item) => BigInt(item)).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function orderSubjects<TSubject extends {id: string}>(subjects: TSubject[], ids: string[] | undefined): TSubject[] {
    if (!ids?.length) {
        return subjects;
    }
    const order = new Map(ids.map((id, index) => [id, index]));
    return [...subjects].sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}

function stableJson(input: JsonValue): string {
    if (Array.isArray(input)) {
        return `[${input.map((item) => stableJson(item)).join(",")}]`;
    }
    if (isObject(input)) {
        return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${stableJson(input[key] ?? null)}`).join(",")}}`;
    }
    return JSON.stringify(input);
}
