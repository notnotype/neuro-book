import {randomUUID} from "node:crypto";
import type {Client, InValue, Transaction} from "@libsql/client";
import type {EmbeddingColumns, PatchInput, SliceInput, WorldEmbeddingRow, WorldPatchRow, WorldSliceSubjectFilterMode} from "nbook/server/world-engine/types";

/** 待写入的 patch：带应用顺序 seq 与可选 embedding 列。 */
type WritePatch = PatchInput & {seq: number; embed?: EmbeddingColumns};

type WorldSubjectRow = {
    id: string;
    type: string;
    name: string;
    createdAt: Date;
};

type WorldSliceRow = {
    id: string;
    instant: bigint;
    title: string;
    summary: string;
    kind: string;
    createdAt: Date;
};

type WorldPatchSqlRow = WorldPatchRow & {
    id: string;
};

type WorldSliceWithPatches = WorldSliceRow & {
    patches: WorldPatchSqlRow[];
};

type SqlRow = Record<string, unknown>;
type SqlArgs = InValue[];

/** 世界引擎 SQLite 仓储。 */
export class WorldEngineRepository {
    constructor(private readonly client: Client | Transaction) {}

    /** 创建 subject 身份记录。 */
    async createSubject(input: {id: string; type: string; name: string}): Promise<WorldSubjectRow> {
        await this.execute(
            `INSERT INTO "WorldSubject" ("id", "type", "name") VALUES (?, ?, ?)`,
            [input.id, input.type, input.name],
        );
        const subject = await this.findSubject(input.id);
        if (!subject) {
            throw new Error(`WorldSubject 写入后读取失败：${input.id}`);
        }
        return subject;
    }

    /** 按 id 查询 subject。 */
    async findSubject(subjectId: string): Promise<WorldSubjectRow | null> {
        const row = await this.queryOne(`SELECT * FROM "WorldSubject" WHERE "id" = ?`, [subjectId]);
        return row ? toSubject(row) : null;
    }

    /** 按查询条件列出 subject。 */
    async listSubjects(query: {ids?: string[]; type?: string} = {}): Promise<WorldSubjectRow[]> {
        const where: string[] = [];
        const args: SqlArgs = [];
        if (query.ids?.length) {
            where.push(`"id" IN (${placeholders(query.ids.length)})`);
            args.push(...query.ids);
        }
        if (query.type !== undefined) {
            where.push(`"type" = ?`);
            args.push(query.type);
        }
        const rows = await this.queryRows(
            `SELECT * FROM "WorldSubject"${renderWhere(where)} ORDER BY "type" ASC, "id" ASC`,
            args,
        );
        return rows.map(toSubject);
    }

    /** 查询某 instant 上的切面。 */
    async findSliceByInstant(instant: bigint): Promise<WorldSliceRow | null> {
        const row = await this.queryOne(`SELECT * FROM "WorldSlice" WHERE "instant" = ?`, [instant]);
        return row ? toSlice(row) : null;
    }

    /** 查询切面及其 patch 行。 */
    async findSliceWithPatches(sliceId: string): Promise<WorldSliceWithPatches | null> {
        const slice = await this.queryOne(`SELECT * FROM "WorldSlice" WHERE "id" = ?`, [sliceId]);
        if (!slice) {
            return null;
        }
        return {
            ...toSlice(slice),
            patches: await this.listPatchesBySlice(sliceId),
        };
    }

    /** 查询指定 instant 之前最近的切面。 */
    async findPreviousSlice(instant: bigint): Promise<WorldSliceRow | null> {
        const row = await this.queryOne(
            `SELECT * FROM "WorldSlice" WHERE "instant" < ? ORDER BY "instant" DESC LIMIT 1`,
            [instant],
        );
        return row ? toSlice(row) : null;
    }

    /** 创建一个新切面与 patch 行。 */
    async createSlice(input: SliceInput, patches: WritePatch[]): Promise<WorldSliceRow> {
        const id = randomUUID();
        await this.execute(
            `INSERT INTO "WorldSlice" ("id", "instant", "title", "summary", "kind") VALUES (?, ?, ?, ?, ?)`,
            [id, input.instant, input.title ?? "", input.summary ?? "", input.kind ?? "event"],
        );
        await this.appendPatches(id, input.instant, patches);
        const slice = await this.findSliceWithPatches(id);
        if (!slice) {
            throw new Error(`WorldSlice 写入后读取失败：${id}`);
        }
        return slice;
    }

    /** 把 init patches 追加进已有切面。 */
    async appendPatches(sliceId: string, instant: bigint, patches: WritePatch[]): Promise<void> {
        for (const patch of patches) {
            const embed = patch.embed;
            await this.execute(
                `INSERT INTO "WorldPatch" ("id", "sliceId", "subjectId", "instant", "seq", "path", "op", "value", "summary", "text", "vector", "model") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    randomUUID(), sliceId, patch.subjectId, instant, patch.seq, patch.path, patch.op,
                    encodePatchValue(patch), patch.summary ?? null,
                    embed?.text ?? null, embed?.vector ?? null, embed?.model ?? null,
                ],
            );
        }
    }

    /** 返回某切面当前最大 seq；无 patch 时返回 -1。 */
    async maxSeq(sliceId: string): Promise<number> {
        const row = await this.queryOne(`SELECT MAX("seq") AS "maxSeq" FROM "WorldPatch" WHERE "sliceId" = ?`, [sliceId]);
        const value = row?.maxSeq;
        return typeof value === "number" ? value : -1;
    }

    /** 整块替换切面与 patch 行。 */
    async replaceSlice(sliceId: string, input: SliceInput, patches: WritePatch[]): Promise<WorldSliceRow> {
        await this.execute(`DELETE FROM "WorldPatch" WHERE "sliceId" = ?`, [sliceId]);
        await this.execute(
            `UPDATE "WorldSlice" SET "instant" = ?, "title" = ?, "summary" = ?, "kind" = ? WHERE "id" = ?`,
            [input.instant, input.title ?? "", input.summary ?? "", input.kind ?? "event", sliceId],
        );
        await this.appendPatches(sliceId, input.instant, patches);
        const slice = await this.findSliceWithPatches(sliceId);
        if (!slice) {
            throw new Error(`WorldSlice 替换后读取失败：${sliceId}`);
        }
        return slice;
    }

    /** 物理删除切面（其 patch 行随 onDelete: Cascade 一并删除）。 */
    async deleteSlice(sliceId: string): Promise<void> {
        await this.execute(`DELETE FROM "WorldSlice" WHERE "id" = ?`, [sliceId]);
    }

    /** 查询某 subject 在 at 之前或之前含 at 的 patch。 */
    async findPatchesForSubject(input: {subjectId: string; at?: bigint; beforeInstant?: bigint; from?: bigint; excludeSliceId?: string}): Promise<WorldPatchRow[]> {
        const where = [`"subjectId" = ?`];
        const args: SqlArgs = [input.subjectId];
        if (input.excludeSliceId) {
            where.push(`"sliceId" <> ?`);
            args.push(input.excludeSliceId);
        }
        if (input.at !== undefined) {
            where.push(`"instant" <= ?`);
            args.push(input.at);
        }
        if (input.beforeInstant !== undefined) {
            where.push(`"instant" < ?`);
            args.push(input.beforeInstant);
        }
        if (input.from !== undefined) {
            where.push(`"instant" >= ?`);
            args.push(input.from);
        }
        const rows = await this.queryRows(
            `SELECT * FROM "WorldPatch"${renderWhere(where)} ORDER BY "instant" ASC, "seq" ASC`,
            args,
        );
        return rows.map(toPatch);
    }

    /** 查询最新 instant。 */
    async latestInstant(): Promise<bigint | null> {
        const row = await this.queryOne(`SELECT "instant" FROM "WorldSlice" ORDER BY "instant" DESC LIMIT 1`, []);
        return row ? toBigInt(row.instant) : null;
    }

    /**
     * 检索 embedding 行（text 非空），供 searchText / vectorize。
     *
     * 只做行级过滤（type / attr 前缀 / instant），存活集去重（memory 取最新、
     * events 全保留）由调用方按 schema 在内存计算。按 instant,seq 升序返回。
     *
     * @param filter.types - 限定 subject type
     * @param filter.attrs - 限定属性（"memory" 命中 /memory 与 /memory/...；"events" 命中 /events 与 /events/...）
     * @param filter.at - time-travel：只取 instant <= at 的行
     */
    async findEmbeddingRows(filter: {types?: string[]; attrs?: string[]; at?: bigint} = {}): Promise<WorldEmbeddingRow[]> {
        const where: string[] = [`m."text" IS NOT NULL`];
        const args: SqlArgs = [];
        if (filter.types?.length) {
            where.push(`s."type" IN (${placeholders(filter.types.length)})`);
            args.push(...filter.types);
        }
        if (filter.attrs?.length) {
            const attrClauses: string[] = [];
            for (const attr of filter.attrs) {
                const path = attr.startsWith("/") ? attr : `/${attr.replace(/\./g, "/")}`;
                attrClauses.push(`m."path" = ?`, `m."path" LIKE ?`);
                args.push(path, `${path}/%`);
            }
            where.push(`(${attrClauses.join(" OR ")})`);
        }
        if (filter.at !== undefined) {
            where.push(`m."instant" <= ?`);
            args.push(filter.at);
        }
        const rows = await this.queryRows(
            `SELECT m.*, s."type" AS "subjectType" FROM "WorldPatch" m JOIN "WorldSubject" s ON s."id" = m."subjectId"${renderWhere(where)} ORDER BY m."instant" ASC, m."seq" ASC`,
            args,
        );
        return rows.map(toEmbeddingRow);
    }

    /** 按行回填向量列（vectorize / searchText 即时兜底持久化时用）。 */
    async updatePatchVector(id: string, vector: Uint8Array, model: string): Promise<void> {
        await this.execute(`UPDATE "WorldPatch" SET "vector" = ?, "model" = ? WHERE "id" = ?`, [vector, model, id]);
    }

    /** 列切面。 */
    async listSlices(query: {from?: bigint; to?: bigint; limit?: number; withPatches?: boolean; subjectIds?: string[]; subjectMode?: WorldSliceSubjectFilterMode}): Promise<Array<WorldSliceRow & {patches?: WorldPatchSqlRow[]}>> {
        const where: string[] = [];
        const args: SqlArgs = [];
        if (query.from !== undefined) {
            where.push(`"instant" >= ?`);
            args.push(query.from);
        }
        if (query.to !== undefined) {
            where.push(`"instant" <= ?`);
            args.push(query.to);
        }
        appendSubjectFilters(where, args, query.subjectIds, query.subjectMode);
        const order = query.limit && query.from === undefined && query.to === undefined ? "DESC" : "ASC";
        const limit = query.limit ? ` LIMIT ${query.limit}` : "";
        const rows = await this.queryRows(
            `SELECT * FROM "WorldSlice"${renderWhere(where)} ORDER BY "instant" ${order}${limit}`,
            args,
        );
        const slices = rows.map(toSlice);
        const ordered = order === "DESC" ? slices.reverse() : slices;
        if (!query.withPatches) {
            return ordered;
        }
        return Promise.all(ordered.map(async (slice) => ({
            ...slice,
            patches: await this.listPatchesBySlice(slice.id),
        })));
    }

    private async listPatchesBySlice(sliceId: string): Promise<WorldPatchSqlRow[]> {
        const rows = await this.queryRows(
            `SELECT * FROM "WorldPatch" WHERE "sliceId" = ? ORDER BY "seq" ASC`,
            [sliceId],
        );
        return rows.map(toPatch);
    }

    private async execute(sql: string, args: SqlArgs): Promise<void> {
        await this.client.execute({sql, args});
    }

    private async queryRows(sql: string, args: SqlArgs): Promise<SqlRow[]> {
        const result = await this.client.execute({sql, args});
        return result.rows as SqlRow[];
    }

    private async queryOne(sql: string, args: SqlArgs): Promise<SqlRow | null> {
        return (await this.queryRows(sql, args))[0] ?? null;
    }
}

function appendSubjectFilters(where: string[], args: SqlArgs, subjectIds: string[] | undefined, mode: WorldSliceSubjectFilterMode | undefined): void {
    if (!subjectIds?.length) {
        return;
    }
    if (mode === "all") {
        for (const subjectId of subjectIds) {
            where.push(`EXISTS (SELECT 1 FROM "WorldPatch" m WHERE m."sliceId" = "WorldSlice"."id" AND m."subjectId" = ?)`);
            args.push(subjectId);
        }
        return;
    }
    where.push(`EXISTS (SELECT 1 FROM "WorldPatch" m WHERE m."sliceId" = "WorldSlice"."id" AND m."subjectId" IN (${placeholders(subjectIds.length)}))`);
    args.push(...subjectIds);
}

function renderWhere(where: string[]): string {
    return where.length ? ` WHERE ${where.join(" AND ")}` : "";
}

function placeholders(count: number): string {
    return Array.from({length: count}, () => "?").join(", ");
}

function toSubject(row: SqlRow): WorldSubjectRow {
    return {
        id: toText(row.id),
        type: toText(row.type),
        name: toText(row.name),
        createdAt: toDate(row.createdAt),
    };
}

function toSlice(row: SqlRow): WorldSliceRow {
    return {
        id: toText(row.id),
        instant: toBigInt(row.instant),
        title: toText(row.title),
        summary: toText(row.summary),
        kind: toText(row.kind),
        createdAt: toDate(row.createdAt),
    };
}

function toPatch(row: SqlRow): WorldPatchSqlRow {
    return {
        id: toText(row.id),
        sliceId: toText(row.sliceId),
        subjectId: toText(row.subjectId),
        instant: toBigInt(row.instant),
        seq: Number(row.seq ?? 0),
        path: toText(row.path),
        op: toText(row.op),
        value: row.value === null || row.value === undefined ? null : toText(row.value),
        summary: row.summary === null || row.summary === undefined ? null : toText(row.summary),
    };
}

function toText(value: unknown): string {
    return typeof value === "string" ? value : String(value ?? "");
}

/** SQLite BLOB -> Uint8Array；NULL 返回 null。 */
function toBytes(value: unknown): Uint8Array | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (value instanceof Uint8Array) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    // libsql 某些驱动以带 buffer 的视图返回
    if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView;
        return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    return null;
}

function toEmbeddingRow(row: SqlRow): WorldEmbeddingRow {
    return {
        id: toText(row.id),
        subjectId: toText(row.subjectId),
        subjectType: toText(row.subjectType),
        sliceId: toText(row.sliceId),
        instant: toBigInt(row.instant),
        seq: Number(row.seq ?? 0),
        path: toText(row.path),
        op: toText(row.op),
        text: toText(row.text),
        vector: toBytes(row.vector),
        model: row.model === null || row.model === undefined ? null : toText(row.model),
    };
}

function toBigInt(value: unknown): bigint {
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" || typeof value === "string") {
        return BigInt(value);
    }
    return BigInt(0);
}

function toDate(value: unknown): Date {
    const text = toText(value);
    return new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
}

function encodePatchValue(patch: PatchInput): string | null {
    return patch.value === undefined ? null : JSON.stringify(patch.value);
}
