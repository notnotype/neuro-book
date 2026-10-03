import {usePassportClient} from "nbook/server/passport/passport-client-service";

/**
 * 取消关联：best-effort 通知官方站吊销授权，随后删除本地凭据。幂等。
 */
export default defineEventHandler(async (): Promise<{ok: true}> => {
    await usePassportClient().unlink();
    return {ok: true};
});
