import type {PassportLinkPollDto} from "nbook/shared/dto/passport.dto";
import {PassportLinkPollRequestSchema, type PassportLinkPollRequestDto} from "nbook/shared/dto/passport.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {usePassportClient} from "nbook/server/passport/passport-client-service";

/**
 * 关联轮询：前端按 interval 定时调用，服务端每次只向官方站转发一次 device_code grant。
 */
export default defineEventHandler(async (event): Promise<PassportLinkPollDto> => {
    const body = await validateBody<PassportLinkPollRequestDto>(event, PassportLinkPollRequestSchema);
    return await usePassportClient().pollLink(body.linkSessionId);
});
