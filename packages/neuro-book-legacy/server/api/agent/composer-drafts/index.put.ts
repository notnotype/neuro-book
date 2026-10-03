import {readBody} from "h3";
import {AgentComposerDraftStore} from "nbook/server/agent/drafts/agent-composer-draft-store";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {AgentComposerDraftSaveRequestSchema} from "nbook/shared/dto/agent-composer-draft.dto";

/** 保存一个 Session Composer 草稿；空正文和非法正文都会删除旧记录。 */
export default defineEventHandler(async (event) => {
    const body = AgentComposerDraftSaveRequestSchema.parse(await readBody(event));
    return await new AgentComposerDraftStore(runtimePathsFromEnv().userNbookRoot).save(body, body.text);
});
