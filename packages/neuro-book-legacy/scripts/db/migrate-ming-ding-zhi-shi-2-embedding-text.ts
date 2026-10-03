import path from "node:path";
import fs from "node:fs/promises";
import {constants as fsConstants} from "node:fs";
import {createClient, type Client, type Transaction} from "@libsql/client";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";

const PROJECT_NAME = "ming-ding-zhi-shi-2";

type PatchRow = {
    id: string;
    sliceId: string;
    subjectId: string;
    instant: bigint;
    seq: number;
    path: string;
    op: string;
    value: string | null;
    summary: string | null;
    text: string | null;
    vector: Uint8Array | null;
    model: string | null;
};

type MigrationPlan = {
    original: PatchRow[];
    migrated: PatchRow[];
    affectedSliceIds: string[];
    sourceTextCount: number;
};

/**
 * 将命定之诗项目的旧 string events/memory 受控迁移为 EmbeddingText。
 * 默认只预演；仅显式传 `--apply` 时备份并在单事务中写入。
 */
async function main(): Promise<void> {
    const apply = process.argv.slice(2).includes("--apply");
    const databasePath = path.join(resolveRuntimeWorkspaceRoot(), PROJECT_NAME, ".nbook", "project.sqlite");
    const original = await readPatches(databasePath);
    const plan = buildPlan(original);
    if (plan.affectedSliceIds.length === 0) {
        assertAlreadyMigrated(original);
        console.log(`EmbeddingText 迁移无需执行：${databasePath} 已是当前格式。`);
        return;
    }
    assertPlan(plan);
    printPlan(databasePath, plan, apply);

    if (!apply) {
        console.log("dry-run 完成：未修改 schema 文件或 SQLite。确认结果后使用 --apply。");
        return;
    }

    const backupPath = `${databasePath}.before-embedding-text-${timestamp()}.bak`;
    await checkpoint(databasePath);
    await fs.copyFile(databasePath, backupPath, fsConstants.COPYFILE_EXCL);

    const client = createClient({url: toSqliteFileUrl(databasePath)});
    const transaction = await client.transaction("write");
    try {
        const current = await readPatchRows(transaction);
        const mismatch = firstRowMismatch(plan.original, current);
        if (mismatch) {
            throw new Error(`数据库在 dry-run/备份后发生变化，已停止迁移；${mismatch}`);
        }
        await rewriteAffectedSlices(transaction, plan);
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    } finally {
        await client.close();
    }

    const actual = await readPatches(databasePath);
    assertApplied(plan, actual);
    console.log(`迁移完成；备份：${backupPath}`);
}

/** 读取完整 patch 序列，迁移与验证都以同一排序真相源为准。 */
async function readPatches(databasePath: string): Promise<PatchRow[]> {
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        return await readPatchRows(client);
    } finally {
        await client.close();
    }
}

/** 从 client 或已取得写锁的 transaction 读取 patch。 */
async function readPatchRows(executor: Client | Transaction): Promise<PatchRow[]> {
    const result = await executor.execute(`
        SELECT "id", "sliceId", "subjectId", "instant", "seq", "path", "op", "value", "summary", "text", "vector", "model"
        FROM "WorldPatch"
        ORDER BY "instant" ASC, "seq" ASC, "id" ASC
    `);
    return result.rows.map((row) => ({
        id: String(row.id),
        sliceId: String(row.sliceId),
        subjectId: String(row.subjectId),
        instant: BigInt(String(row.instant)),
        seq: Number(row.seq),
        path: String(row.path),
        op: String(row.op),
        value: row.value === null ? null : String(row.value),
        summary: row.summary === null ? null : String(row.summary),
        text: row.text === null ? null : String(row.text),
        vector: row.vector instanceof Uint8Array ? row.vector : null,
        model: row.model === null ? null : String(row.model),
    }));
}

/** 逐 slice 展开旧数组 replace，保证同 slice 内相对顺序不变。 */
function buildPlan(original: PatchRow[]): MigrationPlan {
    const bySlice = new Map<string, PatchRow[]>();
    for (const row of original) {
        const rows = bySlice.get(row.sliceId) ?? [];
        rows.push(row);
        bySlice.set(row.sliceId, rows);
    }

    const migrated: PatchRow[] = [];
    const affectedSliceIds: string[] = [];
    let sourceTextCount = 0;
    for (const rows of bySlice.values()) {
        const expanded: PatchRow[] = [];
        let affected = false;
        for (const row of rows.sort((left, right) => left.seq - right.seq)) {
            const result = migrateRow(row);
            expanded.push(...result.rows);
            sourceTextCount += result.textCount;
            affected ||= result.changed;
        }
        if (affected) {
            affectedSliceIds.push(rows[0]!.sliceId);
            migrated.push(...expanded.map((row, seq) => ({...row, seq})));
        } else {
            migrated.push(...expanded);
        }
    }
    migrated.sort(compareRows);
    return {original, migrated, affectedSliceIds: affectedSliceIds.sort(), sourceTextCount};
}

/** 将单条旧 patch 转成当前 EmbeddingText 存储形态。 */
function migrateRow(row: PatchRow): {rows: PatchRow[]; textCount: number; changed: boolean} {
    if (row.path === "/events" && row.op === "replace") {
        const value = parseJson(row);
        if (!Array.isArray(value)) {
            throw new Error(`${row.id} /events replace 必须是数组`);
        }
        if (value.every((item) => isEmbeddingText(item))) {
            if (value.length > 0) {
                throw new Error(`${row.id} 已含非空 EmbeddingText 整块 replace，违反一条文本一行 patch 约束`);
            }
            return {rows: [row], textCount: 0, changed: false};
        }
        if (!value.every((item) => typeof item === "string" && item.trim() !== "")) {
            throw new Error(`${row.id} /events 旧数组包含非空字符串以外的值`);
        }
        const base = {...row, value: "[]", text: null, vector: null, model: null};
        const appends = value.map((text, index): PatchRow => ({
            ...row,
            id: `${row.id}-embedding-${index + 1}`,
            op: "append",
            value: JSON.stringify({text}),
            text,
            vector: null,
            model: null,
        }));
        return {rows: [base, ...appends], textCount: value.length, changed: value.length > 0 || row.value !== "[]"};
    }

    if (row.path === "/events" && row.op === "append") {
        const value = parseJson(row);
        if (isEmbeddingText(value)) {
            return {rows: [row], textCount: 1, changed: false};
        }
        if (typeof value !== "string" || value.trim() === "") {
            throw new Error(`${row.id} /events append 必须是非空字符串或 EmbeddingText`);
        }
        return {rows: [{...row, value: JSON.stringify({text: value}), text: value, vector: null, model: null}], textCount: 1, changed: true};
    }

    if (row.path.startsWith("/memory/") && row.op === "replace") {
        const value = parseJson(row);
        if (isEmbeddingText(value)) {
            return {rows: [row], textCount: 1, changed: false};
        }
        if (typeof value !== "string" || value.trim() === "") {
            throw new Error(`${row.id} memory replace 必须是非空字符串或 EmbeddingText`);
        }
        return {rows: [{...row, value: JSON.stringify({text: value}), text: value, vector: null, model: null}], textCount: 1, changed: true};
    }
    return {rows: [row], textCount: 0, changed: false};
}

/** 验证迁移只改变目标行，并保持每个 slice 结束时的文本 reduce 语义。 */
function assertPlan(plan: MigrationPlan): void {
    if (plan.affectedSliceIds.length === 0) {
        throw new Error("没有发现需要迁移的旧 events/memory patch；数据库可能已经迁移");
    }
    const originalUntouched = plan.original.filter((row) => !isTargetRow(row)).map(stableRowWithoutSeq);
    const migratedUntouched = plan.migrated.filter((row) => !isTargetRow(row)).map(stableRowWithoutSeq);
    if (JSON.stringify(originalUntouched) !== JSON.stringify(migratedUntouched)) {
        throw new Error("迁移计划改变了 events/memory 之外的 patch");
    }
    if (JSON.stringify(textSnapshots(plan.original)) !== JSON.stringify(textSnapshots(plan.migrated))) {
        throw new Error("迁移前后 slice 级 events/memory 文本 reduce 结果不等价");
    }
    const embeddingRows = plan.migrated.filter((row) => row.text !== null);
    if (embeddingRows.length !== plan.sourceTextCount) {
        throw new Error(`embedding 行计数不一致：expected=${plan.sourceTextCount} actual=${embeddingRows.length}`);
    }
}

/** 幂等重跑时确认目标字段没有遗留旧 string payload。 */
function assertAlreadyMigrated(rows: PatchRow[]): void {
    for (const row of rows) {
        if (row.path === "/events" && row.op === "append") {
            const value = parseJson(row);
            if (!isEmbeddingText(value)) {
                throw new Error(`${row.id} 仍是旧 /events string payload，不能跳过迁移`);
            }
        }
        if (row.path.startsWith("/memory/") && row.op === "replace") {
            const value = parseJson(row);
            if (!isEmbeddingText(value)) {
                throw new Error(`${row.id} 仍是旧 memory string payload，不能跳过迁移`);
            }
        }
    }
}

/** 在事务中只重写受影响 slice 的 patch 行。 */
async function rewriteAffectedSlices(transaction: Transaction, plan: MigrationPlan): Promise<void> {
    for (const sliceId of plan.affectedSliceIds) {
        await transaction.execute({sql: `DELETE FROM "WorldPatch" WHERE "sliceId" = ?`, args: [sliceId]});
        for (const row of plan.migrated.filter((item) => item.sliceId === sliceId)) {
            await transaction.execute({
                sql: `INSERT INTO "WorldPatch" ("id", "sliceId", "subjectId", "instant", "seq", "path", "op", "value", "summary", "text", "vector", "model") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [row.id, row.sliceId, row.subjectId, row.instant, row.seq, row.path, row.op, row.value, row.summary, row.text, row.vector, row.model],
            });
        }
    }
}

/** 写后重新读取并做精确计划比对。 */
function assertApplied(plan: MigrationPlan, actual: PatchRow[]): void {
    const expected = plan.migrated.map(stableRow);
    const received = actual.map(stableRow);
    if (JSON.stringify(expected) !== JSON.stringify(received)) {
        throw new Error("写后数据库与 dry-run 迁移计划不一致；请保留备份并停止使用该库");
    }
    assertPlan({...plan, original: actual, migrated: actual, affectedSliceIds: plan.affectedSliceIds});
}

/** 计算每个 slice 结束时 events/memory 的纯文本视图。 */
function textSnapshots(rows: PatchRow[]): string[] {
    const state = new Map<string, string[] | string>();
    const snapshots: string[] = [];
    let currentSlice = "";
    for (const row of [...rows].sort(compareRows)) {
        if (currentSlice && row.sliceId !== currentSlice) {
            snapshots.push(serializeState(state));
        }
        currentSlice = row.sliceId;
        if (row.path === "/events") {
            const key = `${row.subjectId}:events`;
            if (row.op === "replace") {
                state.set(key, (parseJson(row) as unknown[]).map(textValue));
            } else if (row.op === "append") {
                const events = state.get(key);
                if (!Array.isArray(events)) {
                    throw new Error(`${row.id} append /events 缺少数组基准`);
                }
                events.push(textValue(parseJson(row)));
            }
        } else if (row.path.startsWith("/memory/")) {
            const key = `${row.subjectId}:${row.path}`;
            if (row.op === "remove") {
                state.delete(key);
            } else if (row.op === "replace") {
                state.set(key, textValue(parseJson(row)));
            }
        }
    }
    if (currentSlice) {
        snapshots.push(serializeState(state));
    }
    return snapshots;
}

function parseJson(row: PatchRow): unknown {
    if (row.value === null) {
        return null;
    }
    try {
        return JSON.parse(row.value);
    } catch {
        throw new Error(`${row.id} value 不是合法 JSON`);
    }
}

function textValue(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    if (isEmbeddingText(value)) {
        return value.text;
    }
    throw new Error(`无法转换为文本：${JSON.stringify(value)}`);
}

function isEmbeddingText(value: unknown): value is {text: string} {
    return typeof value === "object" && value !== null && Object.keys(value).length === 1 && "text" in value && typeof value.text === "string" && value.text.trim() !== "";
}

function isTargetRow(row: PatchRow): boolean {
    return row.path === "/events" || row.path.startsWith("/memory/");
}

function compareRows(left: PatchRow, right: PatchRow): number {
    return left.instant < right.instant ? -1 : left.instant > right.instant ? 1 : left.seq - right.seq || left.id.localeCompare(right.id);
}

function stableRow(row: PatchRow): string {
    return JSON.stringify({...row, instant: row.instant.toString(), vector: row.vector ? Array.from(row.vector) : null});
}

function stableRowWithoutSeq(row: PatchRow): string {
    const {seq: _seq, ...rest} = row;
    return JSON.stringify({...rest, instant: row.instant.toString(), vector: row.vector ? Array.from(row.vector) : null});
}

function firstRowMismatch(expected: PatchRow[], actual: PatchRow[]): string | undefined {
    if (expected.length !== actual.length) {
        return `patch 数量 ${expected.length} -> ${actual.length}`;
    }
    for (let index = 0; index < expected.length; index += 1) {
        const expectedRow = stableRow(expected[index]!);
        const actualRow = stableRow(actual[index]!);
        if (expectedRow !== actualRow) {
            return `首个差异位于第 ${index + 1} 行：expected=${expectedRow}, actual=${actualRow}`;
        }
    }
    return undefined;
}

function serializeState(state: Map<string, string[] | string>): string {
    return JSON.stringify([...state.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

async function checkpoint(databasePath: string): Promise<void> {
    const client: Client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        await client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
        await client.close();
    }
}

function printPlan(databasePath: string, plan: MigrationPlan, apply: boolean): void {
    console.log(`${apply ? "执行" : "预演"} EmbeddingText 迁移：${databasePath}`);
    console.log(`  patch: ${plan.original.length} -> ${plan.migrated.length}`);
    console.log(`  affected slices: ${plan.affectedSliceIds.length}`);
    console.log(`  embedding text rows: ${plan.sourceTextCount}`);
}

function timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

await main();
