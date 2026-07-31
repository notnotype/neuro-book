import {validateBody} from "nbook/server/utils/novel-chapter";
import {withRpApiProject} from "nbook/server/rp/api-project";
import {
    discardRpCandidate,
    randomSelectRpCandidate,
    readRpPlayerEvents,
    saveRpCandidate,
    selectRpCandidate,
} from "nbook/server/rp/event-store";
import {RpEventActionRequestDtoSchema, type RpEventActionRequestDto} from "nbook/shared/dto/rp-runtime.dto";

/** 玩家在侧边栏执行候选保留、放弃、选择或指定范围随机。 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<RpEventActionRequestDto>(event, RpEventActionRequestDtoSchema);
    return withRpApiProject(event, async (projectRoot) => {
        switch (body.op) {
            case "save": await saveRpCandidate(projectRoot, body.eventId); break;
            case "discard": await discardRpCandidate(projectRoot, body.eventId); break;
            case "select": await selectRpCandidate(projectRoot, body.eventId); break;
            case "random_select": await randomSelectRpCandidate(projectRoot, body.eventIds); break;
        }
        return readRpPlayerEvents(projectRoot);
    });
});
