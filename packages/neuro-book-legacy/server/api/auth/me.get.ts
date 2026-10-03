import {getCurrentUser, toAuthUser} from "nbook/server/utils/auth";
import {isAuthEnabled} from "nbook/server/utils/auth";
import {createServerTiming} from "nbook/server/utils/server-timing";
import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";

/**
 * 返回当前 session 对应的有效用户。
 */
export default defineEventHandler(async (event): Promise<AuthSessionDto> => {
    const timing = createServerTiming(event);
    const authEnabled = isAuthEnabled();
    if (!authEnabled) {
        return {
            authEnabled: false,
            user: null,
        };
    }

    const user = await timing.measure("auth.user", () => getCurrentUser(event));
    return {
        authEnabled: true,
        user: user ? toAuthUser(user) : null,
    };
});
