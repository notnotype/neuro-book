import {z} from "zod";
import {createError} from "h3";
import {ProjectRootDtoSchema} from "nbook/shared/dto/project.dto";
import {withProjectHandlesOperation} from "nbook/server/workspace-files/project-open-guard";
import {LOCAL_USER_ID} from "nbook/server/workspace-history/project-history";
import {HistoryInboxMutationError} from "@notnotype/nb-history";

const AcceptAllBodySchema = z.object({
    projectRoot: ProjectRootDtoSchema,
    revision: z.number().int().nonnegative("revision 不能为负数"),
});

/**
 * 接受当前用户收件箱中的全部文件变更。
 * 服务端重新读取 inbox，避免客户端列表过期时遗漏文件。
 */
export default defineEventHandler(async (event) => {
    const body = AcceptAllBodySchema.parse(await readBody(event));
    return withProjectHandlesOperation(body.projectRoot, async (projectHandles) => {
        await projectHandles.history.waitForWarmup();
        const history = await projectHandles.history.history;
        if (!history) {
            throw createError({statusCode: 400, message: "文件历史未启用"});
        }
        try {
            const accepted = await history.acceptAllAtRevision(LOCAL_USER_ID, body.revision);
            return {success: true, accepted};
        } catch (error) {
            if (error instanceof HistoryInboxMutationError) {
                throw createError({statusCode: 412, message: "收件箱已发生新变化，请刷新后重新审查"});
            }
            throw error;
        }
    });
});
