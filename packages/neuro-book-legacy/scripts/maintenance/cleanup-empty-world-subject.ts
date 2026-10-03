import process from "node:process";
import {createClient, type Client} from "@libsql/client";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {resolveProjectDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";

type SubjectRow = {id: string; type: string; name: string};
type PatchRow = {id: string; value: string | null};
type SceneRow = {id: string; subjectIdsJson: string; locationSubjectId: string | null};

const args = parseArgs(process.argv.slice(2));
const client = createClient({
    url: toSqliteFileUrl(resolveProjectDatabasePath(
        resolveRuntimeWorkspaceRoot(),
        projectWorkspaceRef(args.projectRoot),
    )),
});

try {
    const subject = await queryOne<SubjectRow>(client, `SELECT "id", "type", "name" FROM "WorldSubject" WHERE "id" = ?`, [args.id]);
    assert(subject, `找不到 WorldSubject：${args.id}`);
    assert(subject.type === args.type && subject.name === args.name,
        `身份不匹配；实际 type=${subject.type}, name=${JSON.stringify(subject.name)}`);

    const patches = await queryAll<PatchRow>(client, `SELECT "id", "value" FROM "WorldPatch"`);
    const ownedPatchIds = (await queryAll<{id: string}>(client,
        `SELECT "id" FROM "WorldPatch" WHERE "subjectId" = ?`, [args.id])).map((row) => row.id);
    assert(ownedPatchIds.length === 0, `拒绝删除：subject 仍有 ${ownedPatchIds.length} 条 WorldPatch`);

    const targetRef = `subject://${args.id}`;
    const referringPatchIds = patches.filter((patch) => containsRef(patch.value, targetRef)).map((patch) => patch.id);
    assert(referringPatchIds.length === 0,
        `拒绝删除：WorldPatch.value 仍有引用（${referringPatchIds.join(", ")}）`);

    const scenes = await queryAll<SceneRow>(client,
        `SELECT "id", "subjectIdsJson", "locationSubjectId" FROM "StoryScene"`);
    const referringSceneIds = scenes.filter((scene) => scene.locationSubjectId === args.id
        || parseSubjectIds(scene.subjectIdsJson, scene.id).includes(args.id)).map((scene) => scene.id);
    assert(referringSceneIds.length === 0,
        `拒绝删除：StoryScene world anchor 仍有引用（${referringSceneIds.join(", ")}）`);

    console.log(JSON.stringify({
        mode: args.apply ? "apply" : "dry-run",
        projectRoot: args.projectRoot,
        subject,
        checks: {ownedPatches: 0, worldPatchRefs: 0, plotAnchors: 0},
    }, null, 2));

    if (args.apply) {
        const transaction = await client.transaction("write");
        try {
            const transactionPatches = (await transaction.execute(
                `SELECT "id", "value" FROM "WorldPatch"`,
            )).rows as unknown as PatchRow[];
            const transactionReferringPatchIds = transactionPatches
                .filter((patch) => containsRef(patch.value, targetRef))
                .map((patch) => patch.id);
            assert(transactionReferringPatchIds.length === 0,
                `事务内拒绝删除：WorldPatch.value 新增了引用（${transactionReferringPatchIds.join(", ")}）`);

            const transactionScenes = (await transaction.execute(
                `SELECT "id", "subjectIdsJson", "locationSubjectId" FROM "StoryScene"`,
            )).rows as unknown as SceneRow[];
            const transactionReferringSceneIds = transactionScenes.filter((scene) => scene.locationSubjectId === args.id
                || parseSubjectIds(scene.subjectIdsJson, scene.id).includes(args.id)).map((scene) => scene.id);
            assert(transactionReferringSceneIds.length === 0,
                `事务内拒绝删除：StoryScene world anchor 新增了引用（${transactionReferringSceneIds.join(", ")}）`);

            const result = await transaction.execute({
                sql: `DELETE FROM "WorldSubject" WHERE "id" = ? AND "type" = ? AND "name" = ?
                    AND NOT EXISTS (SELECT 1 FROM "WorldPatch" WHERE "subjectId" = ?)`,
                args: [args.id, args.type, args.name, args.id],
            });
            assert(result.rowsAffected === 1, "事务内精确删除未命中；数据可能已变化");
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
        assert(!(await queryOne<SubjectRow>(client, `SELECT "id", "type", "name" FROM "WorldSubject" WHERE "id" = ?`, [args.id])),
            "删除后校验失败：WorldSubject 仍存在");
        console.log("已删除空 WorldSubject；未修改任何 WorldSlice/WorldPatch/StoryScene。");
    }
} finally {
    client.close();
}

function parseArgs(argv: string[]): {projectRoot: string; id: string; type: string; name: string; apply: boolean} {
    const read = (flag: string): string => {
        const index = argv.indexOf(flag);
        const value = index < 0 ? undefined : argv[index + 1];
        if (!value) throw new Error(`缺少参数 ${flag}`);
        return value;
    };
    return {
        projectRoot: projectWorkspaceRef(read("--project")).projectRoot,
        id: read("--id"),
        type: read("--type"),
        name: read("--name"),
        apply: argv.includes("--apply"),
    };
}

async function queryAll<T>(db: Client, sql: string, args: Array<string> = []): Promise<T[]> {
    const result = await db.execute({sql, args});
    return result.rows as unknown as T[];
}

async function queryOne<T>(db: Client, sql: string, args: Array<string>): Promise<T | null> {
    return (await queryAll<T>(db, sql, args))[0] ?? null;
}

function containsRef(raw: string | null, target: string): boolean {
    if (raw === null) return false;
    try {
        return walk(JSON.parse(raw), target);
    } catch {
        return raw === target;
    }
}

function walk(value: unknown, target: string): boolean {
    if (value === target) return true;
    if (Array.isArray(value)) return value.some((item) => walk(item, target));
    return typeof value === "object" && value !== null && Object.values(value).some((item) => walk(item, target));
}

function parseSubjectIds(raw: string, sceneId: string): string[] {
    const value: unknown = JSON.parse(raw);
    assert(Array.isArray(value) && value.every((item) => typeof item === "string"),
        `StoryScene ${sceneId} 的 subjectIdsJson 损坏，拒绝清理`);
    return value;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}
