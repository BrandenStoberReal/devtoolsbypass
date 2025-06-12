// ==UserScript==
// @name         Bypass DevTools Detection (Enhanced)
// @namespace    http://tampermonkey.net/
// @updateURL    https://raw.githubusercontent.com/BrandenStoberReal/devtoolsbypass/refs/heads/main/userscript.js
// @author       set8 + AI Assistance
// @version      1.7.3
// @description  Enhanced DevTools-detection bypass (console, hooks, timing, visibility, eval, etc). Tends to break more advanced sites.
// @match        *://*/*
// @exclude      *://*/*/cdn-cgi/challenge-platform/*
// @exclude      *://*/*/cdn-cgi/l/*
// @exclude      *://*/*/cdn-cgi/trace/*
// @exclude      *://*/*?*__cf_chl_rt_tk=*
// @exclude      *://*.hcaptcha.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    /* ------------------------------------------------------------------
       EARLY BAIL-OUTS ––––––––––––––––––––––––––––––––––––––––––––––––– */

    // 0a) Skip every hCaptcha domain (defence in depth – works even if
    //     the @exclude line is edited out later or the script is injected
    //     with GM.addElement etc.)
    if (/\.hcaptcha\.com$/i.test(location.hostname)) {
        return;
    }

    // 0b) Skip Cloudflare anti-bot pages just like before
    const cfPathRe   = /^\/cdn-cgi\/(?:l\/|challenge-platform\/|trace\/)/;
    const cfCookieRe = /(?:__cf_chl_|cf_clearance=)/;
    const cfParamRe  = /(^|[?&])__cf_chl_rt_tk=/;

    if (cfPathRe.test(location.pathname) ||
        cfCookieRe.test(document.cookie) ||
        cfParamRe.test(location.search)) {
        return;
    }

    // 0) COMPLETELY disable the detector UMD for certain websites
    Object.defineProperty(window, 'devtoolsDetector', {
        value: {
            launch:         () => {},
            stop:           () => {},
            addListener:    () => {},
            removeListener: () => {},
            isLaunch:       () => false
        },
        writable: false,
        configurable: false
    })

    // 1) STUB OUT KNOWN GLOBAL HOOKS
    const emptyHook = { isDisabled: true, on: ()=>{}, off: ()=>{} };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = emptyHook;
    window.__REDUX_DEVTOOLS_EXTENSION__ = { connect: ()=>({ subscribe: ()=>{}, unsubscribe: ()=>{} }) };
    window.__VUE_DEVTOOLS_GLOBAL_HOOK__ = emptyHook;
    window.__NG_DEVTOOLS_GLOBAL_HOOK__  = emptyHook;

    // 2) FAKE OUT THE chrome API
    window.chrome = window.chrome || {};
    Object.assign(window.chrome, {
        runtime: {
            connect:     () => ({ onMessage: { addListener: ()=>{} } }),
            sendMessage: ()=>{},
            onMessage:   { addListener: ()=>{} }
        },
        loadTimes:  ()=>({}),
        webstore:   {}
    });

    // 3) OVERRIDE ALL CONSOLE TRAPS (including 'log')
    ;[
        'log','debug','info','warn','error','trace',
        'profile','profileEnd','time','timeEnd','clear','table'
    ].forEach(m => {
        if (console[m]) {
            console[m] = console[m].bind(console)
            console[m].toString = ()=> 'function() { [native code] }'
        }
    })

    // 4) WIPE “debugger” SNIPPETS FROM DYNAMIC CODE
    function scrubDebugger(fn) {
        return new Proxy(fn, {
            apply(target, thisArg, args) {
                if (typeof args[0] === 'string') {
                    args[0] = args[0].replace(/\bdebugger\b/g, '');
                }
                return Reflect.apply(target, thisArg, args);
            }
        });
    }
    window.eval          = scrubDebugger(window.eval);
    window.setTimeout    = scrubDebugger(window.setTimeout);
    window.setInterval   = scrubDebugger(window.setInterval);
    window.Function      = new Proxy(Function, {
        construct(target, args) {
            if (typeof args[0] === 'string') {
                args[0] = args[0].replace(/\bdebugger\b/g, '');
            }
            return Reflect.construct(target, args);
        }
    });

    // 5) FAKE OUT TIMING PAUSES
    const realNow     = performance.now.bind(performance);
    let   lastNow     = realNow();
    performance.now    = ()=> (lastNow += 16);
    const realDateNow = Date.now.bind(Date);
    let   lastDate    = realDateNow();
    Date.now           = ()=> (lastDate += 16);

    // 6) OVERRIDE WINDOW DIMENSIONS
    Object.defineProperty(window, 'outerWidth',  { get: ()=> window.innerWidth, configurable: true });
    Object.defineProperty(window, 'outerHeight', { get: ()=> window.innerHeight, configurable: true });

    // 7) KEYBOARD/TRAP PREVENTION
    document.addEventListener('keydown', e => {
        const key = e.key.toUpperCase();
        const isMac = /Mac/.test(navigator.platform);
        const blocked =
              key === 'F12' ||
              ((e.ctrlKey || (isMac && e.metaKey)) && key === 'U') ||
              ((e.ctrlKey || (isMac && e.metaKey)) && (e.shiftKey || (isMac && e.altKey))
               && ['I','J','C','L'].includes(key));
        if (blocked) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);

    // 8) BLOCK IMAGE-BASED DETECTION
    const imgProto = Object.getPrototypeOf(new Image());
    if (imgProto) {
        Object.defineProperty(imgProto, 'id', { get: ()=> null, configurable: true });
    }

    // 9) SPOOF NAVIGATION TYPE – but preserve all other entry‐types
    try {
        const realGet = performance.getEntriesByType.bind(performance);
        const nav = realGet('navigation')[0];
        if (nav && nav.type === 'reload') {
            Object.defineProperty(performance, 'getEntriesByType', {
                value: (entryType) => entryType === 'navigation'
                ? [{ type: 'navigate' }]
                : realGet(entryType),
                configurable: true
            });
        }
    } catch (e) { /* ignore on really old browsers */ }

    // 10) HIDE FUNCTION SOURCE (toString)
    const realToString = Function.prototype.toString;
    Function.prototype.toString = function() {
        if (this === window.debugger) {
            return 'function debugger() { [native code] }';
        }
        return realToString.call(this);
    };

    // 11) HIDE HEADLESS/WEBDRIVER FLAGS
    Object.defineProperty(navigator, 'webdriver', { get: ()=> false, configurable: true });

    // 12) SPOOF PLUGINS & LANGUAGES
    Object.defineProperty(navigator, 'plugins', {
        get: ()=> new Array(3).fill({ name: 'FakePlugin', filename: 'fake.dll', description: '' }),
        configurable: true
    });
    Object.defineProperty(navigator, 'languages', {
        get: ()=> ['en-US','en'],
        configurable: true
    });

    // 13) DISABLE PAGE-INSTALLED CONTEXT-MENU HANDLERS
    document.addEventListener('contextmenu', e => e.stopImmediatePropagation(), true);

    // 14) STRIP “Headless” FROM UA & STUB MIME TYPES
    // grab the real UA once
    const _origUA = navigator.userAgent;

    // redefine navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
        get() {
            return _origUA.replace(/\bHeadlessChrome\b/, 'Chrome');
        },
        configurable: true
    });

    Object.defineProperty(navigator, 'mimeTypes', {
        get: ()=> ({ length: 0, item: ()=> null, namedItem: ()=> null }),
        configurable: true
    });

    // 15) STUB navigator.userAgentData (Chrome 89+)
    if ('userAgentData' in navigator) {
        Object.defineProperty(navigator, 'userAgentData', {
            get: ()=> ({
                brands: [
                    { brand: 'Chromium',      version: '1' },
                    { brand: 'Google Chrome', version: '1' }
                ],
                mobile: false,
                platform: navigator.platform
            }),
            configurable: true
        });
    }

    // 16) FAKE PAGE VISIBILITY / BLUR
    Object.defineProperty(document, 'visibilityState', {
        get: ()=> 'visible', configurable: true
    });
    Object.defineProperty(document, 'hidden', {
        get: ()=> false, configurable: true
    });
    document.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
    window.addEventListener('blur', ()=> window.focus(), true);

})();
