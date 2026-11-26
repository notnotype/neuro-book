/** 打进夹具页的引擎：测试在页面里经 `window.nbPageAgent` 建引擎、截图。 */

import {capturePage} from "../src/capture";
import {createPageAgent} from "../src/index";

Object.assign(globalThis, {nbPageAgent: {createPageAgent, capturePage}});
