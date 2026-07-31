import {validateBody} from "nbook/server/utils/novel-chapter";
import {withRpApiProject} from "nbook/server/rp/api-project";
import {
    archiveRpTimelineBranch,
    createRpTimelineCheckpoint,
    initializeRpTimeline,
    setRpTimelineNodeLock,
} from "nbook/server/rp/timeline-store";
import {RpTimelineActionRequestDtoSchema, type RpTimelineActionRequestDto} from "nbook/shared/dto/rp-runtime.dto";

/** 初始化、创建检查点、锁定或归档一条可替换分支。 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<RpTimelineActionRequestDto>(event, RpTimelineActionRequestDtoSchema);
    return withRpApiProject(event, (projectRoot) => {
        switch (body.op) {
            case "initialize": return initializeRpTimeline(projectRoot, body.label);
            case "checkpoint": return createRpTimelineCheckpoint(projectRoot, body);
            case "lock": return setRpTimelineNodeLock(projectRoot, body.nodeId, body.locked);
            case "archive_branch": return archiveRpTimelineBranch(projectRoot, body.nodeId);
        }
    });
});
