import {withRpApiProject} from "nbook/server/rp/api-project";
import {readRpTimelineTree} from "nbook/server/rp/timeline-store";

/** 读取 RP 世界切片树；未初始化时返回 null。 */
export default defineEventHandler(async (event) => {
    return withRpApiProject(event, (projectRoot) => readRpTimelineTree(projectRoot));
});
