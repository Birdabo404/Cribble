// Shared between the server root layout (boot script) and the client
// NavPrefs provider — deliberately not a client module so the script
// string can be inlined during SSR.

export const NAV_POSITION_KEY = 'cribble.nav.pos'
export const NAV_EXPANDED_KEY = 'cribble.nav.exp'

/** Reduce-motion preference ('reduced' | 'auto'), set from
 *  /settings/appearance and mirrored onto <html data-motion>. */
export const MOTION_KEY = 'cribble.motion'

/**
 * Inlined at the top of <body> in the root layout. Runs before first paint
 * so the CSS-driven content inset (padding for the rail / top bar) is
 * correct on load — no layout flash while React boots. Also seeds the
 * reduce-motion attribute so the global animation kill-switch applies
 * before anything animates.
 */
export const NAV_BOOT_SCRIPT = `(function(){var d=document.documentElement,p=null,e=null,m=null;try{p=localStorage.getItem('${NAV_POSITION_KEY}');e=localStorage.getItem('${NAV_EXPANDED_KEY}');m=localStorage.getItem('${MOTION_KEY}')}catch(_){}d.dataset.navPos=p==='left'?'left':'top';d.dataset.navExp=e==='1'?'1':'0';if(m==='reduced')d.dataset.motion='reduced'})()`
