import type {PassportLinkSessionDto} from "nbook/shared/dto/passport.dto";
import {usePassportClient} from "nbook/server/passport/passport-client-service";

/**
 * 发起设备码关联：向官方站申请设备码，返回 userCode 与批准页链接。
 * deviceCode 留在服务端内存会话，不下发前端（spec §6.2）。
 */
export default defineEventHandler(async (): Promise<PassportLinkSessionDto> => {
    return await usePassportClient().startLink();
});
