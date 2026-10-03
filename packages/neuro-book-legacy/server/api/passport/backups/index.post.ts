import {PassportBackupStartRequestSchema, type PassportBackupStartRequestDto} from "nbook/shared/dto/passport.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {usePassportJobManager} from "nbook/server/backup/backup-job-manager";

/**
 * 发起云备份（后台任务）：打包 State Root → 上传官方站。返回 jobId 供前端轮询。
 * 已有任务在跑时 409。
 */
export default defineEventHandler(async (event): Promise<{jobId: string}> => {
    const body = await validateBody<PassportBackupStartRequestDto>(event, PassportBackupStartRequestSchema);
    const jobId = usePassportJobManager().startBackup(runtimePathsFromEnv(), body.comment);
    return {jobId};
});
