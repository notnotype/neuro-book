import {
    PassportBackupKeyConfirmRequestSchema,
    type PassportBackupKeyConfirmRequestDto,
    type PassportBackupKeyringDto,
} from "nbook/shared/dto/passport.dto";
import {useBackupKeyringService} from "nbook/server/backup/backup-keyring-service";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 确认用户已保存 pending 恢复码，随后才允许该 key 用于上传。
 */
export default defineEventHandler(async (event): Promise<PassportBackupKeyringDto> => {
    const body = await validateBody<PassportBackupKeyConfirmRequestDto>(event, PassportBackupKeyConfirmRequestSchema);
    try {
        return await useBackupKeyringService().confirm(runtimePathsFromEnv(), body.keyId);
    } catch (error) {
        throw createError({
            statusCode: 409,
            message: error instanceof Error ? error.message : "备份密钥确认失败",
        });
    }
});
