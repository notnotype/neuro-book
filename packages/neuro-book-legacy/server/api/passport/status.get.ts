import type {PassportStatusDto} from "nbook/shared/dto/passport.dto";
import {usePassportClient} from "nbook/server/passport/passport-client-service";

/**
 * 当前实例的 Passport 关联状态（默认槽位）。
 */
export default defineEventHandler(async (): Promise<PassportStatusDto> => {
    return await usePassportClient().getStatus();
});
