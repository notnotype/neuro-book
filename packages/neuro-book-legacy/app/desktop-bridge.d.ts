import type {DesktopBridge} from "@notnotype/neuro-book-contracts/desktop";

declare global {
    interface Window {
        /** Desktop Envelope 注入的受限宿主能力；B/S 页面不存在此字段。 */
        neuroBookDesktop?: DesktopBridge;
    }
}

export {};
