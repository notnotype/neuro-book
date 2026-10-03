import {
    PassportBackupKeyExportRequestSchema,
    type PassportBackupKeyExportDto,
    type PassportBackupKeyExportRequestDto,
} from "nbook/shared/dto/passport.dto";
import {useBackupKeyringService} from "nbook/server/backup/backup-keyring-service";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {getCurrentUser, isAuthEnabled} from "nbook/server/utils/auth";
import {verifyUserPassword} from "nbook/server/utils/password";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 经当前本地账号密码复验后重新导出指定恢复码。
 */
export default defineEventHandler(async (event): Promise<PassportBackupKeyExportDto> => {
    if (!isAuthEnabled()) {
        throw createError({statusCode: 409, message: "本地鉴权未启用，不能重新导出恢复码"});
    }
    const user = await getCurrentUser(event);
    if (!user) {
        throw createError({statusCode: 401, message: "请先登录"});
    }
    const body = await validateBody<PassportBackupKeyExportRequestDto>(event, PassportBackupKeyExportRequestSchema);
    if (!await verifyUserPassword(body.password, user.passwordHash)) {
        throw createError({statusCode: 401, message: "当前账号密码不正确"});
    }
    setResponseHeader(event, "cache-control", "no-store");
    try {
        return {
            keyId: body.keyId,
            recoveryCode: await useBackupKeyringService().export(runtimePathsFromEnv(), body.keyId),
        };
    } catch (error) {
        throw createError({
            statusCode: 404,
            message: error instanceof Error ? error.message : "指定的备份密钥不存在",
        });
    }
});
