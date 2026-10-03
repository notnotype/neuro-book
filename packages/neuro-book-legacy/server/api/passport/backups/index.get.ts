import type {PassportBackupListDto} from "nbook/shared/dto/passport.dto";
import {usePassportClient} from "nbook/server/passport/passport-client-service";
import {wrapPassportErrors} from "nbook/server/passport/passport-errors";
import {officialSiteFetch} from "nbook/server/passport/official-site-transport";

/**
 * 云备份列表（代理官方站 GET /api/v1/backups，含配额用量）。
 */
export default defineEventHandler(async (): Promise<PassportBackupListDto> => {
    return await wrapPassportErrors(async () => {
        const token = await usePassportClient().getAccessToken();
        return await officialSiteFetch<PassportBackupListDto>("backup.list", "/api/v1/backups", {
            headers: {authorization: `Bearer ${token}`},
        });
    });
});
