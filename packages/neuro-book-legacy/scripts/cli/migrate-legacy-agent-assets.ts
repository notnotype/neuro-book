#!/usr/bin/env bun
import {resolve} from "node:path";
import {
    applyLegacyAgentAssetMigration,
    planLegacyAgentAssetMigration,
} from "nbook/server/workspace-files/system-asset-installation";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

const packageRoot = resolve(import.meta.dirname, "../..");
process.env.NEURO_BOOK_RUNTIME_ASSET_MODE = process.env.NEURO_BOOK_RUNTIME_ASSET_MODE ?? "install";

const runtimePaths = runtimePathsFromEnv(packageRoot);
const options = {applicationRoot: runtimePaths.applicationRoot, stateRoot: runtimePaths.stateRoot};
const preflight = process.argv.includes("--preflight");
const apply = process.argv.includes("--apply");

if (preflight === apply) {
    console.error("用法：bun scripts/cli/migrate-legacy-agent-assets.ts --preflight|--apply（二选一）");
    process.exit(2);
}

if (preflight) {
    const plan = await planLegacyAgentAssetMigration(options);
    if (!plan) {
        console.log("未发现待迁移的 legacy Install Root（账本有效且无需清理），无需执行迁移。");
        process.exit(0);
    }
    console.log(`legacy Install Root 待迁移：${plan.installRoot}`);
    console.log(`触发原因：${plan.ledgerReason}`);
    for (const assetPath of plan.orphanRemovals) console.log(`将删除旧投影孤儿：${assetPath}`);
    for (const assetPath of plan.preservedOrphans) console.warn(`保留无法证明未手改的孤儿（对应包将标 dirty）：${assetPath}`);
    if (plan.syncStateCleanupPending) console.log("旧投影 sync state 中仍存在三类 Agent 包条目，apply 时将剥离。");
    console.log(`按当前磁盘状态预估：bundled=${plan.bundled.length}, dirty=[${plan.dirty.join(", ")}], local=[${plan.local.join(", ")}]`);
    process.exit(0);
}

const result = await applyLegacyAgentAssetMigration(options);
if (!result) {
    console.log("未发现待迁移的 legacy Install Root，未做任何修改。");
    process.exit(0);
}
for (const assetPath of result.removedOrphans) console.log(`已删除旧投影孤儿：${assetPath}`);
for (const assetPath of result.preservedOrphans) console.warn(`保留无法证明未手改的孤儿：${assetPath}`);
console.log(`账本重建完成 bundled=${result.report.bundled}, dirty=[${result.report.dirty.join(", ")}], local=[${result.report.local.join(", ")}]`);
if (result.syncStateCleaned) console.log("旧投影 sync state 中的三类 Agent 包条目已剥离，templates/variables 条目保留。");
console.log("注意：removed 墓碑信息无法从重建中恢复，此前删除过的内置包会重新出现。");
