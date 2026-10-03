import {readUserAssetsSyncConflictDetail} from "nbook/server/workspace-files/novel-workspace";
import {UserAssetsSyncConflictKindDtoSchema} from "nbook/shared/dto/user-assets-sync.dto";

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const kind = UserAssetsSyncConflictKindDtoSchema.parse(query.kind);
    const fileName = typeof query.fileName === "string" ? query.fileName : undefined;
    const assetPath = typeof query.assetPath === "string" ? query.assetPath : undefined;
    return readUserAssetsSyncConflictDetail({kind, fileName, assetPath});
});
