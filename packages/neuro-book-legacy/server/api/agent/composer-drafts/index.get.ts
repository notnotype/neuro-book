import {getQuery} from "h3";
import {AgentComposerDraftStore} from "nbook/server/agent/drafts/agent-composer-draft-store";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {AgentComposerDraftQuerySchema} from "nbook/shared/dto/agent-composer-draft.dto";

/** 从 Workspace Root `.nbook` 读取一个 Session Composer 草稿。 */
export default defineEventHandler(async (event) => {
    const identity = AgentComposerDraftQuerySchema.parse(getQuery(event));
    return await new AgentComposerDraftStore(runtimePathsFromEnv().userNbookRoot).load(identity);
});
