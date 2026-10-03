import type {PassportBackupKeyringDto} from "nbook/shared/dto/passport.dto";
import {useBackupKeyringService} from "nbook/server/backup/backup-keyring-service";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

/**
 * 返回本地备份密钥元数据，不返回任何恢复码或密钥材料。
 */
export default defineEventHandler(async (event): Promise<PassportBackupKeyringDto> => {
    setResponseHeader(event, "cache-control", "no-store");
    return useBackupKeyringService().status(runtimePathsFromEnv());
});
