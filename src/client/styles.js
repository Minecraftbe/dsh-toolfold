// ------------------------------------------------------------------
// Styles. Class names carry the `ccx` prefix; colors reuse the
// product's --dsw-* semantic aliases with plain fallbacks. Durations
// ride --ccx-dur / --ccx-step custom properties (set by the engine).
//
// TWO independent style tags:
//  - engineCss (dsh-toolfold/style) is owned by the ENGINE: installed
//    on boot, removed on dispose, so the master switch fully unloads
//    folding without ever touching the settings card's look;
//  - cardCss (dsh-toolfold/card) is owned by the PLUGIN: installed for
//    the plugin's whole life, because the always-mounted settings card
//    must keep its chrome while the engine is switched off (one shared
//    tag would strip the card's styles the moment the switch flips).
// ------------------------------------------------------------------
var STYLE_ID = 'dsh-toolfold/style';
var CARD_STYLE_ID = 'dsh-toolfold/card';
/** Folding-engine rules — owned by the engine (boot .. dispose). */
var engineCss = [
  '[data-chat-flow] [data-chat-flow-kind].ccxMerged{display:none}',
  '[data-chat-flow] [data-chat-flow-kind="assistant-step"].ccxEmpty{display:none}',
  '[data-chat-flow]:not(.ccxKeepThink) [data-variant="think"][data-state="ok"]{display:none}',
  // The think root's PARENT wrapper must collapse with it: the assistant
  // body is a gap:16px flex column whose items are the think wrapper and
  // the answer block, and a 0-height wrapper item still pins the answer
  // down by the gap. The engine JS adds ccxWrapGone to that wrapper in
  // lockstep with hiding the think root.
  '[data-chat-flow] .ccxWrapGone{display:none}',
  '[data-chat-flow] .ccxBar{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;padding:3px 0;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:13px;line-height:20px;cursor:pointer;text-align:left}',
  '[data-chat-flow] .ccxBar:focus-visible{outline:2px solid var(--dsw-static-deepseek-500,#4d6bfe);outline-offset:1px}',
  '.ccxBarCall{flex:1 1 auto;min-width:0;display:flex;align-items:center;pointer-events:none;max-width:1400px;overflow:hidden;transition:max-width var(--ccx-dur,260ms) ease,opacity calc(var(--ccx-dur,260ms)*0.77) ease}',
  '[data-chat-flow] .ccxBar.ccxExpanded .ccxBarCall{max-width:0;opacity:0}',
  '.ccxBarCall > *{flex:1 1 auto;min-width:0;width:100%}',
  '.ccxBarIcon{flex:none;font-size:10px;line-height:20px;opacity:.75;transition:transform var(--ccx-dur,240ms) ease}',
  '.ccxBarLabel{flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:transform var(--ccx-dur,240ms) ease}',
  '@keyframes ccxFall{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:translateY(0)}}',
  '[data-chat-flow] [data-chat-flow-kind].ccxFalling{animation:ccxFall var(--ccx-dur,240ms) cubic-bezier(0.34,1.56,0.64,1) both;animation-delay:calc(var(--ccx-i,0)*var(--ccx-step,45ms))}',
  '@keyframes ccxRise{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-20px)}}',
  '[data-chat-flow] [data-chat-flow-kind].ccxCollapsing{animation:ccxRise var(--ccx-dur,240ms) cubic-bezier(0,0,0.58,1) both;animation-delay:calc(var(--ccx-i,0)*var(--ccx-step,45ms))}',
  '@media (prefers-reduced-motion:reduce){[data-chat-flow] [data-chat-flow-kind].ccxFalling,[data-chat-flow] [data-chat-flow-kind].ccxCollapsing{animation:none}.ccxBarCall,.ccxBarIcon,.ccxBarLabel{transition:none}}'
].join('');
/** Settings-card chrome rules — owned by the PLUGIN for its whole life
 * (the always-mounted settings card must keep its look even while the
 * master switch has the engine fully unloaded). */
var cardCss = [
  // Settings card chrome — mirrors the product's PluginCard / field
  // styles token-for-token, so the card is indistinguishable from the
  // built-in ones (bordered 12px card, header with name over
  // description, rotating chevron, field rows with label/hint).
  '.ccxCard{list-style:none;border:1px solid var(--dsw-alias-border-l2,#e4e4e7);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);transition:border-color .16s,background .16s}',
  '.ccxCard:hover{border-color:var(--dsw-alias-label-dimmed,#a1a1aa)}',
  '.ccxCardOpen{background:var(--dsw-alias-bg-layer-2,#fafafa);border-color:var(--dsw-alias-label-dimmed,#a1a1aa)}',
  '.ccxHeader{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}',
  '.ccxHeader:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:-2px}',
  '.ccxHeadText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
  '.ccxName{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,#222)}',
  '.ccxDescription{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#888)}',
  '.ccxChevron{flex:none;font-size:14px;line-height:1;color:var(--dsw-alias-label-tertiary,#888);transition:transform .16s}',
  '.ccxChevronOpen{transform:rotate(180deg)}',
  '.ccxBody{border-top:1px solid var(--dsw-alias-border-l2,#e4e4e7);margin:0 16px;padding:4px 0 8px}',
  '.ccxField{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
  '.ccxField + .ccxField{border-top:1px solid var(--dsw-alias-border-l2,#e4e4e7)}',
  '.ccxFieldHead{display:flex;align-items:center;gap:8px}',
  '.ccxFieldLabel{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary,#222)}',
  '.ccxFieldHint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#888)}',
  '.ccxBadge{flex:none;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;white-space:nowrap;font-weight:500;background:var(--dsw-alias-bg-module-platform,#f0f0f2);color:var(--dsw-alias-label-secondary,#666)}',
  '.ccxRange{width:100%;height:34px;margin:0;accent-color:var(--dsw-alias-brand-primary,#4d6bfe);cursor:pointer}',
  '.ccxToggle{width:16px;height:16px;margin:0;flex:none;accent-color:var(--dsw-alias-brand-primary,#4d6bfe);cursor:pointer}',
  '.ccxStatRow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;font-size:12px;line-height:1.5}',
  '.ccxStatValue{flex:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#666)}',
  // Version-mismatch warning icon (header) + CSS-only hover tooltip.
  '.ccxWarn{flex:none;position:relative;font-size:15px;line-height:1;cursor:help;color:#d97706}',
  '.ccxWarn::after{content:attr(data-tip);position:absolute;top:calc(100% + 8px);right:-6px;width:250px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#e4e4e7);color:var(--dsw-alias-label-primary,#222);font-size:12px;font-weight:400;line-height:1.5;text-align:left;white-space:pre-line;box-shadow:0 4px 16px rgba(0,0,0,.14);opacity:0;visibility:hidden;pointer-events:none;z-index:60;transition:opacity .12s ease,visibility .12s ease}',
  '.ccxWarn:hover::after{opacity:1;visibility:visible}'
].join('');

module.exports = { STYLE_ID, CARD_STYLE_ID, engineCss, cardCss };

