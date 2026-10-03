import {clearAuthSession} from "nbook/server/utils/auth";

/**
 * 清理当前登录 session。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    await clearAuthSession(event);
    return {ok: true};
});
