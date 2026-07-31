import {z} from "zod";
import {withRpApiProject} from "nbook/server/rp/api-project";
import {diagnoseRpTimelineNode} from "nbook/server/rp/timeline-store";

const QuerySchema = z.object({nodeId: z.string().regex(/^slice-\d+-[a-f0-9]{8}$/u)});

/** 切片预览失败后生成恢复问题报告，并寻找最近可验证祖先；绝不自动切换 active 时间线。 */
export default defineEventHandler(async (event) => {
    const query = QuerySchema.parse(getQuery(event));
    return withRpApiProject(event, (projectRoot) => diagnoseRpTimelineNode(projectRoot, query.nodeId));
});
