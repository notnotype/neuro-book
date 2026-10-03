/**
 * Runtime OpenAPI 3.0 spec endpoint.
 *
 * Generates the full spec from Zod schemas at startup (cached thereafter).
 * Nitro's `/_swagger` and `/_scalar` UIs read from `/_openapi.json`.
 */
import { generateOpenAPISpec } from "../openapi/generate-spec";

export default defineEventHandler(() => {
    return generateOpenAPISpec();
});
