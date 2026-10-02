import {defineEventHandler} from "h3";
import {
    BROWSER_PLUGIN_SET_REVISION,
    BROWSER_PROTOCOL_VERSION,
    BUILTIN_BROWSER_PLUGINS,
    type BrowserBootstrap,
} from "nbook/shared/browser-bootstrap";

export default defineEventHandler((): BrowserBootstrap => ({
    protocolVersion: BROWSER_PROTOCOL_VERSION,
    revision: BROWSER_PLUGIN_SET_REVISION,
    plugins: [...BUILTIN_BROWSER_PLUGINS],
}));
