// createRequire selects the package's CommonJS export condition. Consume that
// same interface; importing its resolved CJS filename need not expose named ESM exports.
export function loadChromium(require){
 const {chromium}=require('@playwright/test')
 if(typeof chromium?.launch!=='function')throw Error('Installed Playwright chromium.launch required')
 return chromium
}
