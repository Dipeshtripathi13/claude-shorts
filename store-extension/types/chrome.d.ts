/**
 * Minimal ambient declaration so the extension's plain JS can be type-checked
 * without pulling in @types/chrome. We only need the checker to stop flagging
 * `chrome` itself, so it is free to find real mistakes like undeclared variables.
 */
declare const chrome: any;
