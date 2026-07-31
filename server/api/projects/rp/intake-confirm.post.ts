import {validateBody} from "nbook/server/utils/novel-chapter";
import {withRpApiProject} from "nbook/server/rp/api-project";
import {confirmRpIntakeFromPlayer, rpIntakeOverview} from "nbook/server/rp/intake-store";
import {RpIntakeConfirmRequestDtoSchema, type RpIntakeConfirmRequestDto} from "nbook/shared/dto/rp-runtime.dto";

/**
 * 由 RP 左侧状态页确认当前开团企划。
 * 请求绑定玩家看到的版本；版本变化、未进入审阅或字段不完整时由 store 拒绝。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<RpIntakeConfirmRequestDto>(event, RpIntakeConfirmRequestDtoSchema);
    return withRpApiProject(event, async (projectRoot) => {
        const state = await confirmRpIntakeFromPlayer(projectRoot, body.version);
        return rpIntakeOverview(state);
    });
});
