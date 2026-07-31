import {z} from "zod";
import {withRpApiProject} from "nbook/server/rp/api-project";
import {listRpUpdates} from "nbook/server/rp/runtime-view-store";

const QuerySchema = z.object({
    offset: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** 分页读取 committed 回合更新摘要；详细 settlement 由 update 端点按需读取。 */
export default defineEventHandler(async (event) => {
    const query = QuerySchema.parse(getQuery(event));
    return withRpApiProject(event, (projectRoot) => listRpUpdates(projectRoot, query.offset, query.limit));
});
