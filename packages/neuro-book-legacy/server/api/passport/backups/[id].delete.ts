import {usePassportClient} from "nbook/server/passport/passport-client-service";
import {wrapPassportErrors} from "nbook/server/passport/passport-errors";
import {officialSiteFetch} from "nbook/server/passport/official-site-transport";

/**
 * 删除云端备份（代理官方站 DELETE /api/v1/backups/:id，幂等）。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const backupId = Number.parseInt(getRouterParam(event, "id") ?? "", 10);
    if (!Number.isSafeInteger(backupId) || backupId <= 0) {
        throw createError({statusCode: 400, message: "备份 id 无效"});
    }
    return await wrapPassportErrors(async () => {
        const token = await usePassportClient().getAccessToken();
        await officialSiteFetch("backup.delete", `/api/v1/backups/${backupId}`, {
            method: "DELETE",
            headers: {authorization: `Bearer ${token}`},
        });
        return {ok: true} as const;
    });
});
