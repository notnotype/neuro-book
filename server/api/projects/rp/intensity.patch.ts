import {validateBody} from "nbook/server/utils/novel-chapter";
import {withRpApiProject} from "nbook/server/rp/api-project";
import {setRpRunIntensity} from "nbook/server/rp/focus-store";
import {RpIntensityRequestDtoSchema, type RpIntensityRequestDto} from "nbook/shared/dto/rp-runtime.dto";

/** UI 直接修改持久运行强度；不调用 Agent，下一回合由 Agent 读取该变量。 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<RpIntensityRequestDto>(event, RpIntensityRequestDtoSchema);
    return withRpApiProject(event, async (projectRoot) => {
        const state = await setRpRunIntensity(projectRoot, body.intensity);
        return {intensity: state.intensity};
    });
});
