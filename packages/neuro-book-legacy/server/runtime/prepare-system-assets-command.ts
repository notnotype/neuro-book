import {prepareSystemAssets} from "nbook/server/workspace-files/system-assets-preflight";

/** Product start 内部的 system assets 准备入口。 */
export async function runPrepareSystemAssetsCommand(args = process.argv.slice(2)): Promise<void> {
    const options = new Set(args);
    const result = await prepareSystemAssets({
        syncUserAssets: options.has("--sync-user-assets"),
        force: options.has("--force"),
        forceSyncUserAssets: options.has("--force-sync-user-assets"),
        productBuild: options.has("--product-build"),
    });

    console.log(`prepared system variable definitions: ${result.variableManifest.definitions.length} definition file(s)`);
    console.log(`prepared system profiles: ${result.profileResult.manifest.profiles.length} profile(s), compiled ${result.profileResult.compiled.length} stale profile(s)`);
    if (result.llmlintSkill) {
        console.log(`projected llmlint skill: ${result.llmlintSkill.sourceFiles} file(s), ${result.llmlintSkill.bytes} byte(s), manifest=${result.llmlintSkill.manifestSha256}`);
    }
    if (result.userAssetsSync) {
        console.log(`synced user assets: copied ${result.userAssetsSync.copied}, updated profiles ${result.userAssetsSync.updatedProfiles ?? 0}, updated assets ${result.userAssetsSync.updatedAssets ?? 0}, skipped ${result.userAssetsSync.skipped}`);
        for (const warning of result.userAssetsSync.profileWarnings ?? []) {
            console.warn(`profile sync warning: ${warning.fileName} ${warning.message}`);
        }
        for (const warning of result.userAssetsSync.assetWarnings ?? []) {
            console.warn(`asset sync warning: ${warning.assetPath} ${warning.message}`);
        }
    }
}

if (import.meta.main) await runPrepareSystemAssetsCommand();
