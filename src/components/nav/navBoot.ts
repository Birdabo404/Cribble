// Shared between the server root layout (boot script) and the client
// NavPrefs provider — deliberately not a client module so the script
// string can be inlined during SSR.

export const NAV_POSITION_KEY = 'cribble.nav.pos'
export const NAV_EXPANDED_KEY = 'cribble.nav.exp'

/**
 * Inlined at the top of <body> in the root layout. Runs before first paint
 * so the CSS-driven content inset (padding for the rail / top bar) is
 * correct on load — no layout flash while React boots.
 */
export const NAV_BOOT_SCRIPT = `(function(){var d=document.documentElement,p=null,e=null;try{p=localStorage.getItem('${NAV_POSITION_KEY}');e=localStorage.getItem('${NAV_EXPANDED_KEY}')}catch(_){}d.dataset.navPos=p==='left'?'left':'top';d.dataset.navExp=e==='1'?'1':'0'})()`
