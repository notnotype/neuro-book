import type {PassportBackupKeyPrepareDto} from "nbook/shared/dto/passport.dto";
import {useBackupKeyringService} from "nbook/server/backup/backup-keyring-service";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

/**
 * 准备首次或轮换用的 pending key；重复调用返回同一恢复码。
 */
export default defineEventHandler(async (event): Promise<PassportBackupKeyPrepareDto> => {
    setResponseHeader(event, "cache-control", "no-store");
    return useBackupKeyringService().prepare(runtimePathsFromEnv());
});
