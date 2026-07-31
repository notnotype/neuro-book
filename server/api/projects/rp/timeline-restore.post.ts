import {validateBody} from "nbook/server/utils/novel-chapter";
import {withRpApiProject} from "nbook/server/rp/api-project";
import {restoreRpTimelineNode} from "nbook/server/rp/timeline-store";
import {RpTimelineRestoreRequestDtoSchema, type RpTimelineRestoreRequestDto} from "nbook/shared/dto/rp-runtime.dto";

/** 经玩家显式确认恢复世界切片；可在恢复前自动建立安全切片。 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<RpTimelineRestoreRequestDto>(event, RpTimelineRestoreRequestDtoSchema);
    return withRpApiProject(event, (projectRoot) => restoreRpTimelineNode(projectRoot, body));
});
