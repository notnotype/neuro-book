import {validateBody} from "nbook/server/utils/novel-chapter";
import {withRpApiProject} from "nbook/server/rp/api-project";
import {runRpConsistencyCheck} from "nbook/server/rp/consistency-store";
import {RpConsistencyRequestDtoSchema, type RpConsistencyRequestDto} from "nbook/shared/dto/rp-runtime.dto";

/** 按玩家选择运行 RP 一致性审计；只允许自动修复可重建索引。 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<RpConsistencyRequestDto>(event, RpConsistencyRequestDtoSchema);
    return withRpApiProject(event, (projectRoot) => runRpConsistencyCheck(projectRoot, body.level, body.repairSafe));
});
