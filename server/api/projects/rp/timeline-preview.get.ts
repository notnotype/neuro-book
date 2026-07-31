import {z} from "zod";
import {withRpApiProject} from "nbook/server/rp/api-project";
import {previewRpTimelineNode} from "nbook/server/rp/timeline-store";

const QuerySchema = z.object({nodeId: z.string().regex(/^slice-\d+-[a-f0-9]{8}$/u)});

/** 校验并只读预览一个世界切片，不改变 active 分支。 */
export default defineEventHandler(async (event) => {
    const query = QuerySchema.parse(getQuery(event));
    return withRpApiProject(event, (projectRoot) => previewRpTimelineNode(projectRoot, query.nodeId));
});
