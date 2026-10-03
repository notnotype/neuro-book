import {z} from "zod";
import {createError} from "h3";
import {ProjectRootDtoSchema} from "nbook/shared/dto/project.dto";
import {withProjectHandlesOperation} from "nbook/server/workspace-files/project-open-guard";
import {LOCAL_USER_ID} from "nbook/server/workspace-history/project-history";
import {HistoryInboxMutationError} from "@notnotype/nb-history";

const AcceptBodySchema = z.object({
    projectRoot: ProjectRootDtoSchema,
    path: z.string().trim().min(1, "path 不能为空"),
    revision: z.number().int().positive("revision 必须是正整数"),
});

/**
 * 接受一个文件的收件箱变更：用户位点推进到该文件当前最新条目。
 */
export default defineEventHandler(async (event) => {
    const body = AcceptBodySchema.parse(await readBody(event));
    return withProjectHandlesOperation(body.projectRoot, async (projectHandles) => {
        await projectHandles.history.waitForWarmup();
        const history = await projectHandles.history.history;
        if (!history) {
            throw createError({statusCode: 400, message: "文件历史未启用"});
        }
        try {
            await history.acceptAtRevision(LOCAL_USER_ID, body.path, body.revision);
        } catch (error) {
            if (error instanceof HistoryInboxMutationError) {
                throw createError({
                    statusCode: error.code === "missing" ? 404 : 412,
                    message: error.code === "missing" ? "待审文件不存在或已被接受" : "文件已发生新变化，请刷新后重新审查",
                });
            }
            throw error;
        }
        return {success: true};
    });
});
