import {
    PassportBackupKeyImportRequestSchema,
    type PassportBackupKeyImportRequestDto,
    type PassportBackupKeyringDto,
} from "nbook/shared/dto/passport.dto";
import {decodeBackupRecoveryCode, useBackupKeyringService} from "nbook/server/backup/backup-keyring-service";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 校验并导入用户提供的恢复码；完整恢复码只在当前请求内存中使用。
 */
export default defineEventHandler(async (event): Promise<PassportBackupKeyringDto> => {
    const body = await validateBody<PassportBackupKeyImportRequestDto>(event, PassportBackupKeyImportRequestSchema);
    try {
        decodeBackupRecoveryCode(body.recoveryCode);
    } catch (error) {
        throw createError({
            statusCode: 400,
            message: error instanceof Error ? error.message : "恢复码格式无效",
        });
    }
    setResponseHeader(event, "cache-control", "no-store");
    return useBackupKeyringService().import(runtimePathsFromEnv(), body.recoveryCode);
});
