import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {usePassportJobManager} from "nbook/server/backup/backup-job-manager";

/**
 * 发起恢复（后台任务）：下载归档 → 校验 sha256 → 解包到 State Root 同级 restore-<ts>/。
 * 返回 jobId 供前端轮询；完成后 UI 展示停机替换指引（spec §9.5 staging 方案）。
 */
export default defineEventHandler(async (event): Promise<{jobId: string}> => {
    const backupId = Number.parseInt(getRouterParam(event, "id") ?? "", 10);
    if (!Number.isSafeInteger(backupId) || backupId <= 0) {
        throw createError({statusCode: 400, message: "备份 id 无效"});
    }
    const jobId = usePassportJobManager().startRestore(runtimePathsFromEnv(), backupId);
    return {jobId};
});
