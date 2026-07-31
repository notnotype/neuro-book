import {z} from "zod";
import {withRpApiProject} from "nbook/server/rp/api-project";
import {readRpUpdateDetail} from "nbook/server/rp/runtime-view-store";

const QuerySchema = z.object({turnId: z.string().regex(/^turn-\d{6}-[a-f0-9]{8}$/u)});

/** 按 turnId 读取单次正式更新详情，不读取聊天上下文。 */
export default defineEventHandler(async (event) => {
    const query = QuerySchema.parse(getQuery(event));
    return withRpApiProject(event, (projectRoot) => readRpUpdateDetail(projectRoot, query.turnId));
});
