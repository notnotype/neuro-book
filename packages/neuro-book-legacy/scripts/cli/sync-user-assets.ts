import {syncSystemAssetsToUserAssets} from "nbook/server/workspace-files/novel-workspace";

const result = await syncSystemAssetsToUserAssets();

console.log(`synced user assets: copied=${result.copied}, skipped=${result.skipped}, updatedProfiles=${result.updatedProfiles ?? 0}, updatedAssets=${result.updatedAssets ?? 0}`);
for (const warning of result.profileWarnings ?? []) {
    console.warn(`profile warning: ${warning.profileKey} (${warning.fileName}) ${warning.message}`);
}
for (const warning of result.assetWarnings ?? []) {
    console.warn(`asset warning: ${warning.assetPath} ${warning.message}`);
}
