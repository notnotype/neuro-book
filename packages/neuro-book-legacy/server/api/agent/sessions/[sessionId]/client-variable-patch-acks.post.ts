import {readBody} from "h3";
import {acknowledgeClientVariablePatch, requireAgentSessionId} from "nbook/server/agent/http";
import {ClientVariablePatchAckDtoSchema} from "nbook/shared/dto/agent-session.dto";

export default defineEventHandler(async (event) => {
    const sessionId = requireAgentSessionId(event);
    const body = ClientVariablePatchAckDtoSchema.parse(await readBody(event));
    return acknowledgeClientVariablePatch(sessionId, body);
});
