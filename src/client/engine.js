const { STYLE_ID, engineCss } = require('./styles.js');

/**
 * Install the folding engine on a document.
 * @param doc - the browser document of the Web GUI page.
 * @param settings - the shared settings store (getSnapshot/subscribe).
 * @returns a disposer that removes every side effect.
 */
function installCollapseEngine(doc, settings, timers) {
  var FLOW_SELECTOR = '[data-chat-flow]';
  var BADGE_ATTR = 'data-ccx-badge';
  var MERGED_CLASS = 'ccxMerged';
  var EMPTY_CLASS = 'ccxEmpty';
  var FALLING_CLASS = 'ccxFalling';
  var COLLAPSING_CLASS = 'ccxCollapsing';
  var KEEP_CLASS = 'ccxKeepThink';
  /** Hidden settled-think WRAPPER: the product leaves the think's flex
   * item in `.hWmORq_body` (a `gap:16px` column) even when the think root
   * is display:none, so the wrapper must be hidden too or a 16px blank
   * band survives under the folded think, above the row's answer text. */
  var WRAP_GONE_CLASS = 'ccxWrapGone';
  /** Ease-out for the row height shrink (no overshoot: heights clamp). */
  var COLLAPSE_EASE = 'cubic-bezier(0,0,0.58,1)';

  var styleTag = null;
  var adoptedStyle = false;
  /** flow element -> observation mode ('light' | 'full') */
  var flows = new Map();
  /** flow element -> its attached MutationObserver (absent while hidden) */
  var flowObservers = new Map();
  /** parent element -> childList-only observer (flow mounts/unmounts) */
  var parentObservers = new Map();
  /** flow element -> Set of expanded run node keys */
  var expanded = new Map();
  /** flow element -> Map<run head key, bar element> */
  var barsByFlow = new Map();
  /** flow element -> Set of run head keys mid collapse animation */
  var collapsing = new Map();
  /** flows whose DOM changed since the last pass (pending re-pass) */
  var dirtyFlows = new Set();
  /** per-flow reason for the pending pass: content | think | rows */
  var flowReasons = new Map();
  /** flow element -> Set of tool rows touched by content mutations */
  var contentRowsByFlow = new Map();
  /** per-flow counter for synthetic run keys (rows lacking a node key) */
  var syntheticKeys = new Map();
  /** flows may have appeared or disappeared since the last pass */
  var structureDirty = true;
  /** observers live only while the tab is visible */
  var active = true;
  /** slow safety rescan while visible (catches remounted flows) */
  var rescanTimer = null;
  /** rescan delay, backing off while nothing changes (3s..10s) */
  var rescanDelay = 3000;
  var rafId = 0;
  var pending = false;
  var disposed = false;
  var offSettings = null;
  /** deferred boot init (one frame after activation) */
  var booted = false;
  var bootRaf = 0;
  /** cached MediaQueryList for prefers-reduced-motion */
  var motionMql = null;
  /** cache of confirmed tool-call rows (closestToolCall positive hits) */
  var toolRowCache = new WeakMap();
  /**
   * Assistant rows currently hidden as emptied think rows (carry
   * EMPTY_CLASS). Kept so the single-text-node streaming fast path can
   * notice answer text arriving inside one without walking the DOM on
   * every ordinary streamed token.
   */
  var hiddenRows = new WeakSet();
  /** Count of rows in `hiddenRows` (a WeakSet exposes no size). */
  var hiddenCount = 0;
  /** opt-in live cost stats (settings card); created at engine init */
  var statsObj = null;

  function statsBegin() {
    if (statsObj === null || !statsObj.enabled) return null;
    return performance.now();
  }

  function statsEnd(key, count, t0) {
    if (t0 === null) return;
    statsObj[key] += count;
    statsObj[key + 'Ms'] += performance.now() - t0;
  }

  function ensureStats() {
    if (statsObj !== null) return statsObj;
    statsObj = {
      enabled: settings.getSnapshot().stats === true,
      start: Date.now(),
      obs: 0, obsMs: 0,
      refresh: 0, refreshMs: 0,
      pass: 0, passMs: 0,
      scan: 0, scanMs: 0,
      clone: 0, cloneMs: 0,
      skip: 0
    };
    return statsObj;
  }

  function reducedMotion() {
    if (motionMql === null) {
      motionMql = (typeof matchMedia === 'function') ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    }
    return motionMql !== null && motionMql.matches;
  }

  function durMs() {
    var value = settings.getSnapshot().durMs;
    return reducedMotion() ? 0 : value;
  }

  function stepMs() {
    var value = settings.getSnapshot().durMs;
    return reducedMotion() ? 0 : Math.max(0, Math.min(60, Math.round(value * 45 / 240)));
  }

  /** Push the current durations into --ccx-dur / --ccx-step. */
  function applySettings() {
    var style = doc.documentElement.style;
    style.setProperty('--ccx-dur', durMs() + 'ms');
    style.setProperty('--ccx-step', stepMs() + 'ms');
  }

  // ----------------------------------------------------------------
  // Style tag (self-managed; removed on dispose).
  // ----------------------------------------------------------------
  function insertStyle() {
    var existing = doc.querySelector('style[data-plugin-css="' + STYLE_ID + '"]');
    if (existing !== null) {
      styleTag = existing;
      adoptedStyle = true;
      return;
    }
    var tag = doc.createElement('style');
    tag.setAttribute('data-plugin', 'dsh-toolfold');
    tag.setAttribute('data-plugin-css', STYLE_ID);
    tag.textContent = engineCss;
    doc.head.appendChild(tag);
    styleTag = tag;
    adoptedStyle = false;
  }

  // ----------------------------------------------------------------
  // Scheduling: dirty-flag based, rAF-batched, one pass per frame at
  // most. Only flows whose DOM actually changed are re-passed.
  // ----------------------------------------------------------------
  var REASON_RANK = { content: 1, think: 2, rows: 3 };

  function markDirty(flow, reason) {
    if (disposed) return;
    var prev = flowReasons.get(flow);
    if (prev === undefined || REASON_RANK[prev] < REASON_RANK[reason]) {
      flowReasons.set(flow, reason);
    }
    dirtyFlows.add(flow);
    // Any flow event means the page is alive: keep the safety rescan
    // prompt so newly mounted containers are discovered quickly.
    if (rescanDelay > 3000) {
      rescanDelay = 3000;
      if (rescanTimer !== null) {
        timers.cancel(rescanTimer);
        rescanTimer = null;
        scheduleNextRescan();
      }
    }
    schedule();
  }

  function schedule() {
    if (pending || disposed) return;
    pending = true;
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(function () {
        pending = false;
        refresh();
      });
    } else {
      pending = false;
      refresh();
    }
  }

  // ----------------------------------------------------------------
  // Flow discovery and per-flow observers.
  // ----------------------------------------------------------------
  /**
   * Whether an added/removed node can change folding outcomes: a row
   * (`[data-chat-flow-kind]`) or a think block (`[data-variant="think"]`).
   */
  function nodeHasMarker(node) {
    if (node.nodeType !== 1) return false;
    if (typeof node.matches === 'function'
      && node.matches('[data-chat-flow-kind],[data-variant="think"]')) return true;
    if (typeof node.querySelector === 'function'
      && node.querySelector('[data-chat-flow-kind],[data-variant="think"]') !== null) return true;
    return false;
  }

  /**
   * Nearest ancestor (or self) that is a tool-call row. Plain attribute
   * walk — the MutationObserver hot path never invokes the selector
   * engine. The RESULT is cached on the start element (both positive and
   * negative), so streaming — which keeps mutating the same containers —
   * amortizes the walk to O(1) per container after the first event.
   * Staleness would require reparenting a container into a tool row,
   * which the product never does; worst case one missed content refresh.
   */
  function closestToolCall(el) {
    var start = (el.nodeType === 1) ? el : el.parentElement;
    if (start === null) return null;
    var hit = toolRowCache.get(start);
    if (hit !== undefined) return hit;
    var node = start;
    while (node !== null && node.nodeType === 1) {
      var cached = toolRowCache.get(node);
      if (cached !== undefined) {
        node = cached;
        break;
      }
      if (node.getAttribute('data-chat-flow-kind') === 'tool-call') break;
      node = node.parentElement;
    }
    toolRowCache.set(start, node);
    return node;
  }

  /**
   * Nearest flow row whose content just changed while the row itself is
   * hidden (EMPTY_CLASS), or null. Mutations inside a think block never
   * count: the product may keep writing reasoning tokens into a
   * just-settled, display:none think, and those must not resurrect the
   * row. Plain attribute walk — no selector engine on the hot path.
   */
  function hiddenEmptyRow(el) {
    var node = (el.nodeType === 1) ? el : el.parentElement;
    while (node !== null && node.nodeType === 1) {
      if (node.getAttribute('data-variant') === 'think') return null;
      if (node.hasAttribute('data-chat-flow-kind')) {
        return node.classList.contains(EMPTY_CLASS) ? node : null;
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Classify a mutation batch by what it can change:
   *  - 'rows': row-level add/remove/reorder, or added/removed nodes that
   *    are or contain rows / think blocks — the merge must be rebuilt;
   *  - 'think': a `data-state` flip on a think element (settled thinking
   *    starts hiding, empties its assistant row, and in merge mode stops
   *    separating runs) — the merge must be rebuilt;
   *  - 'content': a mutation inside a tool-call row (result streaming) —
   *    only that run's bar clone can be stale, no merge rebuild needed;
   *  - null: content streaming inside any other row (think text tokens,
   *    markdown spans) — cannot change any folding outcome.
   * The single appended-text-node case short-circuits with zero DOM
   * walks, so agent/think streaming costs nothing at all. Content
   * mutations report the affected tool row(s) through `collect`, so the
   * refresh touches only the bar of the run whose LAST row changed.
   */
  function mutationReason(records, flow, collect) {
    if (records.length === 1) {
      var only = records[0];
      if (only.type === 'childList' && only.removedNodes.length === 0
        && only.addedNodes.length === 1 && only.addedNodes[0].nodeType === 3) {
        // Fast path for streamed text. With no emptied (hidden) row
        // around this stays a zero-walk skip. If a hidden row exists,
        // the new text may be the answer arriving in a row that was
        // emptied when it held only settled thinking — resurrect it.
        // Text still landing inside a think block is ignored.
        if (hiddenCount > 0) {
          var resurrect = hiddenEmptyRow(only.addedNodes[0]);
          if (resurrect !== null) {
            rowInfo.delete(resurrect);
            return 'rows';
          }
        }
        return null;
      }
    }
    var best = 0; // 0 none, 1 content, 2 think, 3 rows
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.type === 'attributes') {
        // DSH's official completed-Turn fold flips `hidden` and the
        // `data-turn-process-*` markers on whole process windows when a
        // turn collapses or expands: treat that as a row-level change so
        // runs/bars are rebuilt around whatever the product just folded
        // or revealed.
        if (record.attributeName === 'hidden'
          || (record.attributeName !== null && record.attributeName.indexOf('data-turn-process-') === 0)) {
          if (best < 3) best = 3;
        } else if (record.attributeName === 'data-state'
          && record.target !== null && record.target.nodeType === 1
          && typeof record.target.matches === 'function'
          && record.target.matches('[data-variant="think"]')) {
          if (best < 2) best = 2;
        }
        continue;
      }
      if (record.type === 'characterData') {
        var toolRow = closestToolCall(record.target);
        if (toolRow !== null) {
          if (collect !== undefined) collect(toolRow);
          if (best < 1) best = 1;
        } else {
          // Answer text started streaming into a row that was emptied
          // (hidden) when it held only settled thinking: drop the stale
          // empty assessment and force a full re-pass, so the row comes
          // back as soon as its content is real — otherwise the answer
          // would stream invisibly into the display:none row and leave
          // a blank hole where the think used to be.
          var hiddenRow = hiddenEmptyRow(record.target);
          if (hiddenRow !== null) {
            rowInfo.delete(hiddenRow);
            if (best < 3) best = 3;
          }
        }
        continue;
      }
      if (record.type !== 'childList') continue;
      var target = record.target;
      if (target === flow) {
        best = 3;
        continue;
      }
      if (target !== null && target.nodeType === 1) {
        var row = closestToolCall(target);
        if (row !== null) {
          if (collect !== undefined) collect(row);
          if (best < 1) best = 1;
          continue;
        }
        // A content container (e.g. the answer markdown block) was
        // added inside an emptied hidden assistant row: same recovery
        // as characterData above.
        var hiddenRow = hiddenEmptyRow(target);
        if (hiddenRow !== null) {
          rowInfo.delete(hiddenRow);
          if (best < 3) best = 3;
        }
      }
      var lists = [record.addedNodes, record.removedNodes];
      for (var l = 0; l < lists.length && best < 3; l++) {
        var nodes = lists[l];
        for (var j = 0; j < nodes.length; j++) {
          if (nodeHasMarker(nodes[j])) { best = 3; break; }
        }
      }
    }
    if (best === 0) return null;
    if (best === 1) return 'content';
    if (best === 2) return 'think';
    return 'rows';
  }

  /**
   * Attach (or replace) the per-flow observer for a mode. 'light' is a
   * childList-only observer on the flow's direct children — the only
   * events that can change folding are row adds/removes/reorders, so a
   * pure-chat flow costs nothing while text streams inside its rows.
   * 'full' adds subtree childList and `data-state` attribute coverage,
   * which foldable content (tool cards, think blocks) actually needs.
   */
  function attachFlowObserver(flow, mode) {
    var existing = flowObservers.get(flow);
    if (existing !== null && existing !== undefined) existing.disconnect();
    if (typeof MutationObserver !== 'function') {
      flowObservers.set(flow, null);
      return;
    }
    var observer;
    if (mode === 'light') {
      observer = new MutationObserver(function () {
        var t0 = statsBegin();
        markDirty(flow, 'rows');
        statsEnd('obs', 1, t0);
      });
      observer.observe(flow, { childList: true });
    } else {
      observer = new MutationObserver(function (records) {
        var t0 = statsBegin();
        var contentSet = undefined;
        var reason = mutationReason(records, flow, function (row) {
          if (contentSet === undefined) {
            contentSet = contentRowsByFlow.get(flow);
            if (contentSet === undefined) {
              contentSet = new Set();
              contentRowsByFlow.set(flow, contentSet);
            }
          }
          contentSet.add(row);
        });
        if (reason !== null) {
          markDirty(flow, reason);
        } else if (statsObj !== null && statsObj.enabled) {
          statsObj.skip += 1;
        }
        statsEnd('obs', 1, t0);
      });
      observer.observe(flow, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-state', 'hidden', 'data-turn-process-hidden', 'data-turn-process-member', 'data-turn-process-answer']
      });
    }
    flowObservers.set(flow, observer);
  }

  /** Switch a flow's observation mode (attaches only while visible). */
  function setFlowMode(flow, mode) {
    if (flows.get(flow) === mode) return;
    flows.set(flow, mode);
    if (active) attachFlowObserver(flow, mode);
  }

  function discover() {
    var list = doc.querySelectorAll(FLOW_SELECTOR);
    for (var i = 0; i < list.length; i++) {
      var flow = list[i];
      if (flows.has(flow)) continue;
      var needFull = typeof flow.querySelector === 'function'
        && flow.querySelector('[data-chat-flow-kind="tool-call"],[data-variant="think"]') !== null;
      flows.set(flow, needFull ? 'full' : 'light');
      expanded.set(flow, new Set());
      barsByFlow.set(flow, new Map());
      collapsing.set(flow, new Set());
      if (active) attachFlowObserver(flow, needFull ? 'full' : 'light');
      // Newly discovered flows always need an initial pass.
      markDirty(flow, 'rows');
    }
  }

  /**
   * Flow mount/unmount detection WITHOUT a page-wide observer: each
   * known flow's parent gets a childList-only observer (direct children
   * only, no subtree), so it fires only when a sibling flow appears or
   * disappears — never on chat churn. Parents that appeared while the
   * engine was idle are covered by the slow visible-only rescan.
   */
  function observeParents() {
    if (!active || typeof MutationObserver !== 'function') return;
    flows.forEach(function (mode, flow) {
      var parent = flow.parentElement;
      if (parent === null || parentObservers.has(parent)) return;
      var observer = new MutationObserver(function (records) {
        var t0 = statsBegin();
        var relevant = false;
        for (var i = 0; i < records.length && !relevant; i++) {
          var record = records[i];
          if (record.type !== 'childList') continue;
          var lists = [record.addedNodes, record.removedNodes];
          for (var l = 0; l < lists.length && !relevant; l++) {
            var nodes = lists[l];
            for (var j = 0; j < nodes.length; j++) {
              var node = nodes[j];
              if (node.nodeType !== 1 || typeof node.matches !== 'function') continue;
              if (node.matches(FLOW_SELECTOR)
                || (typeof node.querySelector === 'function'
                  && node.querySelector(FLOW_SELECTOR) !== null)) {
                relevant = true;
                break;
              }
            }
          }
        }
        if (relevant) {
          structureDirty = true;
          schedule();
        }
        statsEnd('obs', 1, t0);
      });
      observer.observe(parent, { childList: true });
      parentObservers.set(parent, observer);
    });
  }

  // ----------------------------------------------------------------
  // Slow safety rescan + visibility gating. The rescan is discovery-
  // only (one attribute scan + map diff), schedules a pass only when a
  // flow actually appeared, and backs off 3s → 10s while the page is
  // quiet (any flow event resets it). While the tab is hidden the
  // engine holds NO observers and NO timers: literally zero work. On
  // return to visibility everything re-attaches and one refresh pass
  // catches up with whatever changed meanwhile.
  // ----------------------------------------------------------------
  function rescanTick() {
    rescanTimer = null;
    if (disposed || !active || doc.hidden) return;
    var t0 = statsBegin();
    // Discovery-only tick: one `[data-chat-flow]` scan + map diff. No
    // pass is scheduled unless a flow was actually discovered (which
    // marks it dirty), and the delay backs off (3s → 10s) while the
    // page is stable — an idle page costs one attribute scan every
    // ~10s at most. Light→full observer upgrades are driven by row
    // events (pass outcomes), never by per-flow subtree scans.
    var before = flows.size;
    discover();
    pruneFlows();
    observeParents();
    if (flows.size === before) {
      // Nothing mounted/unmounted. Back off only while at least one
      // flow is known — with none known, first discovery must stay
      // prompt.
      if (flows.size > 0) rescanDelay = Math.min(rescanDelay * 2, 10000);
    } else {
      rescanDelay = 3000;
    }
    statsEnd('scan', 1, t0);
    scheduleNextRescan();
  }

  function scheduleNextRescan() {
    if (rescanTimer !== null) return;
    rescanTimer = timers.after(rescanTick, rescanDelay);
  }

  function startRescan() {
    rescanDelay = 3000;
    scheduleNextRescan();
  }

  function stopRescan() {
    if (rescanTimer !== null) {
      timers.cancel(rescanTimer);
      rescanTimer = null;
    }
  }

  function disconnectObservers() {
    flowObservers.forEach(function (observer) {
      if (observer !== null && observer !== undefined) observer.disconnect();
    });
    flowObservers.clear();
    parentObservers.forEach(function (observer) {
      observer.disconnect();
    });
    parentObservers.clear();
  }

  function onVisibility() {
    setActive(!doc.hidden);
  }

  function setActive(on) {
    if (on === active) return;
    active = on;
    if (on) {
      if (!booted) {
        bootInit();
        return;
      }
      flows.forEach(function (mode, flow) {
        if (doc.contains(flow)) attachFlowObserver(flow, mode);
      });
      observeParents();
      startRescan();
      structureDirty = true;
      schedule();
    } else {
      stopRescan();
      disconnectObservers();
    }
  }

  // ----------------------------------------------------------------
  // Row helpers.
  // ----------------------------------------------------------------
  function rowList(flow) {
    var rows = [];
    var children = flow.children;
    for (var i = 0; i < children.length; i++) {
      var el = children[i];
      if (el.nodeType === 1 && el.hasAttribute('data-chat-flow-kind') && !productHiddenRow(el)) rows.push(el);
    }
    return rows;
  }

  /**
   * Whether the product itself currently hides this flow row. DSH's
   * completed-Turn transcript view "Compact" (对话信息折叠) keeps every row
   * of a folded process window in the DOM but marks it `hidden` (the
   * searchable-hidden attribute, so browser find can still reveal it).
   * Rows the product hides must be invisible to folding — no runs, no
   * bars, no empty-row work — so nothing of ours can survive as an
   * orphaned element "outside" the product's own fold.
   */
  function productHiddenRow(el) {
    return el !== null && el.nodeType === 1 && el.hasAttribute('hidden');
  }

  /**
   * Whether the product's official completed-Turn fold (transcript view
   * "Compact") is active for this flow: any row tagged as a process
   * member or compacted answer, or a turn-process chip carrying text.
   * The engine uses it for the "思考自动跟随官方折叠" rule: with the
   * official fold active, the whole big block is already collapsed, so
   * thinking content is preserved by default (it should not silently
   * vanish under the fold); without the official fold, thinking takes
   * space and the legacy default hides settled thinking.
   */
  function flowHasOfficialFold(flow) {
    if (flow === null || typeof flow.querySelector !== 'function') return false;
    if (flow.querySelector('[data-turn-process-member],[data-turn-process-answer]') !== null) return true;
    var chips = flow.querySelectorAll('[data-chat-flow-kind="turn-process"]');
    for (var i = 0; i < chips.length; i++) {
      if (chips[i].textContent.trim() !== '') return true;
    }
    return false;
  }

  /** Effective keep-think flag for one flow (see flowHasOfficialFold). */
  function effectiveKeepThink(flow) {
    var snap = settings.getSnapshot();
    if (snap.thinkAuto === false) return snap.keepThink === true;
    return flowHasOfficialFold(flow);
  }

  /**
   * Per-row assessment of think-only content, cached by a signature of
   * the row's think blocks (count + data-states + keepThink + splitThink
   * flags). Reassessed only when the signature changes; the check is
   * purely structural, so steady-state passes perform zero layout reads.
   *
   * In split mode (default) a row that only settled Think rows occupy
   * ENDS the run it follows — completed thinking separates runs, it
   * never merges across them. In merge mode it is transparent: it folds
   * WITH the surrounding tool calls. Either way it is empty (hidden)
   * when think is not preserved; with "保留思考" on it stays visible —
   * between the bars in split mode, inside the run on expand in merge
   * mode.
   */
  var rowInfo = new WeakMap();
  var NEUTRAL_ASSESSMENT = { sig: '', thinks: [], transparent: false, empty: false };

  function thinkSig(thinks, keepThink, splitThink) {
    var sig = (keepThink ? '1' : '0') + (splitThink ? '1' : '0');
    for (var i = 0; i < thinks.length; i++) {
      sig += ':' + (thinks[i].getAttribute('data-state') || '');
    }
    return sig;
  }

  /**
   * Whether an element contains nothing but think blocks and empty
   * wrappers: every text leaf outside a think block is whitespace-only
   * and every non-think element recurses. Structural — no layout reads,
   * immune to wrapper padding/margins that a height check would mistake
   * for content.
   */
  function thinkOnlyContent(el) {
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType === 3) {
        if (node.textContent.trim() !== '') return false;
      } else if (node.nodeType === 1) {
        if (node.matches('[data-variant="think"]')) continue;
        if (!thinkOnlyContent(node)) return false;
      }
    }
    return true;
  }

  function assessRow(row, keepThink, splitThink) {
    if (row.getAttribute('data-chat-flow-kind') !== 'assistant-step') return NEUTRAL_ASSESSMENT;
    var cached = rowInfo.get(row);
    if (cached !== undefined && cached.sig === thinkSig(cached.thinks, keepThink, splitThink)) {
      return cached;
    }
    var thinks = row.querySelectorAll('[data-variant="think"]');
    var assessment = {
      sig: thinkSig(thinks, keepThink, splitThink),
      thinks: thinks,
      transparent: false,
      empty: false
    };
    if (thinks.length > 0 && thinkOnlyContent(row)) {
      var allOk = true;
      for (var i = 0; i < thinks.length; i++) {
        if (thinks[i].getAttribute('data-state') !== 'ok') { allOk = false; break; }
      }
      if (allOk) {
        // A row made of settled think alone: transparent (folds with
        // the surrounding calls) only in merge mode; in split mode it
        // ends the run. Hidden unless 保留思考 keeps it visible.
        assessment.transparent = !splitThink;
        assessment.empty = !keepThink;
      }
    }
    rowInfo.set(row, assessment);
    return assessment;
  }

  /**
   * Mirror the think-hiding CSS on the think's PARENT wrapper. The
   * assistant body is a `gap:16px` flex column whose items are the think
   * wrapper and the answer block; display:none on the think root alone
   * leaves a 0-height wrapper item that still pins the answer 16px below
   * the row top — the "blank band under the folded think". Hiding that
   * wrapper (ccxWrapGone) restores the row to its true height. Guarded:
   * only a wrapper whose sole element child is the think is hidden, so a
   * layout that genuinely shares the container is never harmed. With
   * 保留思考 on, or while the think is still streaming (state != ok),
   * the wrapper must stay visible — remove any stale marker.
   */
  function syncThinkWrappers(row, keepThink) {
    var thinks = row.querySelectorAll('[data-variant="think"]');
    for (var i = 0; i < thinks.length; i++) {
      var think = thinks[i];
      var wrap = think.parentElement;
      if (wrap === null || wrap === row) continue;
      var hide = !keepThink && think.getAttribute('data-state') === 'ok'
        && wrap.childElementCount === 1 && wrap.firstElementChild === think;
      if (hide) {
        if (!wrap.classList.contains(WRAP_GONE_CLASS)) wrap.classList.add(WRAP_GONE_CLASS);
      } else if (wrap.classList.contains(WRAP_GONE_CLASS)) {
        wrap.classList.remove(WRAP_GONE_CLASS);
      }
    }
  }

  // ----------------------------------------------------------------
  // The collapsed-run bar (flow-level element; replaces every card of
  // the run when collapsed). Shows the LAST call's one-line summary.
  // ----------------------------------------------------------------
  /** Strip interactivity from a card-row clone so it is display-only. */
  function sanitizeClone(node) {
    node.removeAttribute('role');
    node.removeAttribute('tabindex');
    node.removeAttribute('aria-expanded');
    node.removeAttribute('data-expandable');
    var buttons = node.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      var span = doc.createElement('span');
      span.className = button.className;
      span.textContent = button.textContent;
      button.replaceWith(span);
    }
    return node;
  }

  function createBar(flow, run) {
    var bar = doc.createElement('div');
    bar.className = 'ccxBar';
    bar.setAttribute(BADGE_ATTR, '');
    bar.setAttribute('role', 'button');
    bar.setAttribute('tabindex', '0');
    var call = doc.createElement('span');
    call.className = 'ccxBarCall';
    call.setAttribute('aria-hidden', 'true');
    var icon = doc.createElement('span');
    icon.className = 'ccxBarIcon';
    var label = doc.createElement('span');
    label.className = 'ccxBarLabel';
    bar.appendChild(call);
    bar.appendChild(icon);
    bar.appendChild(label);
    // Cached parts: updateBar/updateBarClone avoid selector lookups.
    bar._ccxIcon = icon;
    bar._ccxLabel = label;
    bar._ccxCall = call;
    var toggle = function () {
      var set = expanded.get(flow);
      if (set === undefined || disposed) return;
      // The closure `run` is the bar's creation-time snapshot; every
      // pass refreshes bar._ccxRun with the CURRENT run. When the model
      // streams more calls into the same run (the newest info at the
      // bottom of the flow), collapsing the stale snapshot would animate
      // only the original rows and then snap the rest shut — the "runs
      // briefly, then suddenly collapses" symptom.
      var current = bar._ccxRun !== undefined ? bar._ccxRun : run;
      if (set.has(current.headKey)) {
        startCollapse(flow, current, bar);
      } else {
        set.add(current.headKey);
        cancelCollapse(flow, current, bar);
        pass(flow);
        pinBar(bar, current);
      }
    };
    bar.addEventListener('click', toggle);
    bar.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });
    return bar;
  }

  /** Waterfall entrance: the run's rows cascade in top-down on expand. */
  function animateFall(bar, run) {
    var rows = run.rows;
    var dur = durMs();
    var step = stepMs();
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.remove(FALLING_CLASS, COLLAPSING_CLASS);
      rows[i].style.setProperty('--ccx-i', String(i));
    }
    for (var j = 0; j < rows.length; j++) rows[j].classList.add(FALLING_CLASS);
    if (bar._ccxFallTimer !== undefined) timers.cancel(bar._ccxFallTimer);
    bar._ccxFallTimer = timers.after(function () {
      bar._ccxFallTimer = undefined;
      if (disposed || !bar.isConnected) return;
      for (var k = 0; k < rows.length; k++) rows[k].classList.remove(FALLING_CLASS);
    }, Math.max(0, rows.length - 1) * step + dur + 60);
  }

  /**
   * Collapse each card's ROW in place: freeze the current height, then
   * transition height to 0 with the same stagger as the rise animation.
   * The measured trailing gap to the next visible row is cancelled via
   * margin-bottom, so everything below the run follows upward
   * continuously — no blank hole while the cards fade, no snap when the
   * merge finally applies. Styles are cleared on completion (and on
   * cancel/dispose) so rows return to auto layout.
   */
  function animateRowShrink(rows, dur, step) {
    if (dur <= 0 || rows.length === 0) return;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var h = row.offsetHeight;
      if (h <= 0) continue;
      var gap = 0;
      var next = row.nextElementSibling;
      while (next !== null && next.offsetHeight === 0) next = next.nextElementSibling;
      if (next !== null) {
        gap = Math.max(0, next.getBoundingClientRect().top - row.getBoundingClientRect().bottom);
      }
      row.style.height = h + 'px';
      row.style.overflow = 'hidden';
      row.style.marginBottom = '0px';
      row.style.transition = 'height ' + dur + 'ms ' + COLLAPSE_EASE + ',margin-bottom ' + dur + 'ms ' + COLLAPSE_EASE;
      row.style.transitionDelay = (i * step) + 'ms';
      void row.offsetHeight; // commit the frozen height before shrinking
      row.style.height = '0px';
      row.style.marginBottom = (-gap) + 'px';
    }
  }

  /** Remove the shrink animation's inline styles (restores auto layout). */
  function clearRowShrink(row) {
    row.style.removeProperty('height');
    row.style.removeProperty('overflow');
    row.style.removeProperty('margin-bottom');
    row.style.removeProperty('transition');
    row.style.removeProperty('transition-delay');
  }

  /** Rise-out exit: cards cascade back up, then the run collapses. */
  function startCollapse(flow, run, bar) {
    var set = expanded.get(flow);
    if (set === undefined || !set.has(run.headKey)) return;
    set.delete(run.headKey);
    var per = collapsing.get(flow);
    if (per === undefined) {
      per = new Set();
      collapsing.set(flow, per);
    }
    per.add(run.headKey);
    var rows = run.rows;
    var dur = durMs();
    var step = stepMs();
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.remove(FALLING_CLASS, COLLAPSING_CLASS);
      rows[i].style.setProperty('--ccx-i', String(i));
    }
    for (var j = 0; j < rows.length; j++) rows[j].classList.add(COLLAPSING_CLASS);
    animateRowShrink(rows, dur, step);
    // Track which rows the cascade has covered: a run that keeps
    // GROWING while it collapses (the model is still streaming the
    // newest calls into it) extends the cascade via extendCollapse and
    // re-arms the finish timer. Without this, rows added after the
    // collapse began would snap shut when the timer armed for the OLD
    // row count fires — the "runs briefly, then suddenly collapses"
    // symptom.
    bar._ccxCollapseRows = rows;
    // The bar flips to collapsed visuals now; the cards stay visible for
    // the rise (pass skips ccxMerged while the head key is collapsing).
    pass(flow);
    armCollapseFinish(flow, run, bar);
  }

  /**
   * Arm (or re-arm) the collapse-finish timer. The delay covers one
   * full cascade — last row's stagger + rise + margin — measured from
   * the arm moment. `cascadeCount` defaults to the full covered row
   * set; extendCollapse passes only the NEW rows it just added, since
   * the already-covered rows have finished animating.
   */
  function armCollapseFinish(flow, run, bar, cascadeCount) {
    if (bar._ccxCollapseTimer !== undefined) timers.cancel(bar._ccxCollapseTimer);
    var rows = bar._ccxCollapseRows;
    var dur = durMs();
    var step = stepMs();
    var n = cascadeCount !== undefined ? cascadeCount : rows.length;
    var delay = Math.max(0, n - 1) * step + dur + 60;
    bar._ccxCollapseTimer = timers.after(function () {
      bar._ccxCollapseTimer = undefined;
      if (disposed || !flow.isConnected) return;
      var perNow = collapsing.get(flow);
      if (perNow !== undefined) {
        perNow.delete(run.headKey);
        if (perNow.size === 0) collapsing.delete(flow);
      }
      var all = bar._ccxCollapseRows;
      for (var k = 0; k < all.length; k++) {
        all[k].classList.remove(COLLAPSING_CLASS);
        clearRowShrink(all[k]);
      }
      bar._ccxCollapseRows = undefined;
      pass(flow); // applies ccxMerged now
    }, delay);
  }

  /**
   * A run that is mid-collapse and still GROWING (the model streams the
   * newest tool calls into it) folds the newly added rows into the same
   * rise/shrink cascade — with their own relative stagger, starting
   * immediately — and re-arms the finish timer so the last new row's
   * animation completes before the merge applies. Without this the new
   * rows sit at full height and then snap shut with the merge.
   */
  function extendCollapse(flow, run, bar) {
    var oldRows = bar._ccxCollapseRows;
    var rows = run.rows;
    if (oldRows === undefined || rows.length <= oldRows.length) return;
    var dur = durMs();
    var step = stepMs();
    // The rows that joined the run since the cascade covered it. Diff by
    // identity so appended, inserted, or replaced rows all join — the
    // streaming case appends, but never assume.
    var added = [];
    for (var i = 0; i < rows.length; i++) {
      if (oldRows.indexOf(rows[i]) === -1) added.push(rows[i]);
    }
    if (added.length === 0) return;
    for (var j = 0; j < added.length; j++) {
      var row = added[j];
      row.classList.remove(FALLING_CLASS, COLLAPSING_CLASS);
      row.style.setProperty('--ccx-i', String(j));
      row.classList.add(COLLAPSING_CLASS);
    }
    animateRowShrink(added, dur, step);
    bar._ccxCollapseRows = rows;
    armCollapseFinish(flow, run, bar, added.length);
  }

  /** Abort a pending collapse (the user re-expanded mid-animation). */
  function cancelCollapse(flow, run, bar) {
    var per = collapsing.get(flow);
    if (per !== undefined) {
      per.delete(run.headKey);
      if (per.size === 0) collapsing.delete(flow);
    }
    if (bar !== undefined && bar._ccxCollapseTimer !== undefined) {
      timers.cancel(bar._ccxCollapseTimer);
      bar._ccxCollapseTimer = undefined;
    }
    if (bar !== undefined) {
      bar._ccxCollapseRows = undefined;
    }
    var rows = run.rows;
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.remove(COLLAPSING_CLASS);
      clearRowShrink(rows[i]);
    }
  }

  // ----------------------------------------------------------------
  // Scroll pinning. The product's chat view follows its own column
  // height growth while the reader is pinned to the bottom; expanding a
  // group near the bottom would therefore shove the bar out of the top
  // of the viewport. Keep the bar's viewport position fixed for the
  // duration of the fall animation; stop as soon as the user scrolls.
  // ----------------------------------------------------------------
  function findScrollport(el) {
    var host = el.closest('[data-conversation-scroll]');
    if (host !== null) return host;
    var node = el.parentElement;
    while (node !== null) {
      var style = getComputedStyle(node);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll')
        && node.scrollHeight > node.clientHeight) return node;
      node = node.parentElement;
    }
    return null;
  }

  function pinBar(bar, run) {
    if (typeof requestAnimationFrame !== 'function') return;
    var sp = findScrollport(bar);
    if (sp === null) return;
    var savedTop = sp.scrollTop;
    var targetTop = bar.getBoundingClientRect().top - sp.getBoundingClientRect().top;
    // Restore the reader position immediately: the sticky-bottom follow
    // re-pins only while the reader is still flagged at-bottom, and the
    // scroll event our write queues clears that flag.
    sp.scrollTop = savedTop;
    var dur = durMs();
    var step = stepMs();
    var until = Date.now() + Math.max(0, run.rows.length - 1) * step + dur + 260;
    var stopped = false;
    var cancel = function () {
      stopped = true;
      sp.removeEventListener('wheel', cancel);
      sp.removeEventListener('touchstart', cancel);
    };
    sp.addEventListener('wheel', cancel, { passive: true });
    sp.addEventListener('touchstart', cancel, { passive: true });
    var frame = function () {
      if (stopped || disposed || !bar.isConnected) {
        cancel();
        return;
      }
      var current = bar.getBoundingClientRect().top - sp.getBoundingClientRect().top;
      var delta = current - targetTop;
      if (Math.abs(delta) > 0.5) sp.scrollTop += delta;
      if (Date.now() < until) requestAnimationFrame(frame);
      else cancel();
    };
    requestAnimationFrame(frame);
  }

  /** Refresh the bar for one run: copy, aria, and the last-call clone. */
  function updateBar(bar, run) {
    // The run this bar stands in for, kept current by every full pass so
    // the light 'content' pass can refresh clones without rebuilding.
    bar._ccxRun = run;
    // The whole run folds into the bar, so the count is the run's TOTAL
    // tool-call count (every card of the group is hidden when collapsed).
    var total = run.toolRows.length;
    bar.setAttribute('aria-expanded', run.expanded ? 'true' : 'false');
    bar.setAttribute('aria-label', (run.expanded ? '收起' : '展开') + ' ' + total + ' 个工具调用');
    bar.title = run.expanded ? '点击收起' : '点击展开';
    bar._ccxIcon.textContent = run.expanded ? '▾' : '▸';
    bar._ccxLabel.textContent = run.expanded
      ? '已展开 ' + total + ' 个工具调用 · 点击收起'
      : '已折叠 ' + total + ' 个工具调用 · 点击展开';
    // Expanding collapses the summary clone (fade + shrink) so the label
    // slides left, and the hidden cards cascade in below the bar.
    var wasExpanded = bar._ccxPrevExpanded === true;
    bar.classList.toggle('ccxExpanded', run.expanded);
    if (run.expanded && !wasExpanded) animateFall(bar, run);
    bar._ccxPrevExpanded = run.expanded;
    if (!run.expanded) updateBarClone(bar);
  }

  /** Replace the bar's clone contents; counted as one clone op. */
  function replaceClone(call, node) {
    var t0 = statsBegin();
    while (call.firstChild !== null) call.removeChild(call.firstChild);
    call.appendChild(node);
    statsEnd('clone', 1, t0);
  }

  /**
   * Clone the last call's collapsed one-line row (product chrome) so
   * the bar itself displays the last tool call. Re-clone only when the
   * source row's markup changed (e.g. a tool result just arrived), and
   * at most every 120ms while a result streams in — the clone's
   * freshness is invisible beyond that, but serialization plus clone
   * DOM work would otherwise run on every frame of the stream.
   */
  function updateBarClone(bar) {
    var run = bar._ccxRun;
    if (run === undefined) return;
    var call = bar._ccxCall;
    var source = run.lastRow.querySelector('[data-disclosure-row]');
    if (source !== null) {
      var sig = source.innerHTML;
      if (bar._ccxSig === sig) return;
      var now = Date.now();
      if (bar._ccxCloneAt !== undefined && now - bar._ccxCloneAt < 120) return;
      bar._ccxCloneAt = now;
      bar._ccxSig = sig;
      replaceClone(call, sanitizeClone(source.cloneNode(true)));
      return;
    }
    // Bash (and any future sample) uses a custom header without
    // data-disclosure-row (data-sample="bash"). Without this branch the
    // fallback below finds no [data-tool] and the bar's call slot stays
    // empty — exactly the "WSL bash shows only the count" symptom.
    var bashSource = run.lastRow.querySelector('[data-sample="bash"]');
    if (bashSource !== null) {
      var bsig = bashSource.innerHTML;
      if (bar._ccxSig === bsig) return;
      var bnow = Date.now();
      if (bar._ccxCloneAt !== undefined && bnow - bar._ccxCloneAt < 120) return;
      bar._ccxCloneAt = bnow;
      bar._ccxSig = bsig;
      replaceClone(call, sanitizeClone(bashSource.cloneNode(true)));
      return;
    }
    // Generic fallback for custom cards (e.g. cordis run) that render
    // outside the standard DisclosureRow/tool patterns.
    var card = run.lastRow.querySelector('[data-tool]');
    var head = card !== null && card.firstElementChild !== null ? card.firstElementChild : null;
    if (head !== null) {
      var hsig = head.innerHTML;
      if (bar._ccxSig !== hsig) {
        var now2 = Date.now();
        if (bar._ccxCloneAt === undefined || now2 - bar._ccxCloneAt >= 120) {
          bar._ccxCloneAt = now2;
          bar._ccxSig = hsig;
          replaceClone(call, sanitizeClone(head.cloneNode(true)));
        }
      }
      return;
    }
    // Last resort: whatever the row rendered first (covers future custom
    // tool views that use neither marker).
    var fallback = run.lastRow.firstElementChild;
    if (fallback !== null) {
      var fsig = fallback.innerHTML;
      if (bar._ccxSig !== fsig) {
        var fnow = Date.now();
        if (bar._ccxCloneAt === undefined || fnow - bar._ccxCloneAt >= 120) {
          bar._ccxCloneAt = fnow;
          bar._ccxSig = fsig;
          replaceClone(call, sanitizeClone(fallback.cloneNode(true)));
        }
      }
      return;
    }
    if (bar._ccxSig !== '') {
      bar._ccxSig = '';
      while (call.firstChild !== null) call.removeChild(call.firstChild);
    }
  }

  /** Create/update/remove the flow-level bars for the merged runs. */
  function syncBars(flow, runs) {
    var registry = barsByFlow.get(flow);
    if (registry === undefined) {
      registry = new Map();
      barsByFlow.set(flow, registry);
    }
    var wanted = new Set();
    for (var r = 0; r < runs.length; r++) {
      var run = runs[r];
      if (run.headKey === null) continue;
      wanted.add(run.headKey);
      var bar = registry.get(run.headKey);
      if (bar === undefined || !flow.contains(bar)) {
        bar = createBar(flow, run);
        registry.set(run.headKey, bar);
      }
      updateBar(bar, run);
      // A run that is mid-collapse and still GROWING (the model is
      // streaming the newest calls into it) extends its cascade to the
      // newly added rows; the finish timer is re-armed by
      // extendCollapse. Without this the new rows would sit at full
      // height and then snap shut with the merge.
      if (bar._ccxCollapseRows !== undefined
        && run.rows.length > bar._ccxCollapseRows.length) {
        extendCollapse(flow, run, bar);
      }
      // The bar is the group HEADER: it stays before the run's first row,
      // so on expand the cards cascade downward below it. Guard against
      // re-inserting when already in place (insertBefore always mutates).
      var anchor = run.toolRows[0];
      if (bar.nextSibling !== anchor) flow.insertBefore(bar, anchor);
    }
    registry.forEach(function (bar, key) {
      if (!wanted.has(key)) {
        bar.remove();
        registry.delete(key);
      }
    });
  }

  /**
   * Light pass for 'content'-dirty flows: the merge structure is
   * unchanged, so only bar clones can be stale. Touches ONLY the bars
   * of runs whose LAST row was mutated and which are collapsed — an
   * expanded run shows its own cards (no clone needed) and earlier
   * cards of a run are hidden (their content never reaches a bar).
   * No run rebuild, no class toggles, no layout.
   */
  function barRefresh(flow, contentRows) {
    var registry = barsByFlow.get(flow);
    if (registry === undefined || contentRows === undefined) return;
    registry.forEach(function (bar) {
      var run = bar._ccxRun;
      if (run === undefined || run.expanded || !bar.isConnected) return;
      if (contentRows.has(run.lastRow)) updateBarClone(bar);
    });
  }

  // ----------------------------------------------------------------
  // The pass: merge runs, sync bars, clean empty rows.
  // ----------------------------------------------------------------
  function pass(flow) {
    var t0 = statsBegin();
    var rows = rowList(flow);
    var set = expanded.get(flow);
    var per = collapsing.get(flow);
    var keepThink = effectiveKeepThink(flow);
    var splitThink = settings.getSnapshot().splitThink;

    // Prune expansion keys that no longer exist in this flow. Synthetic
    // keys are flow-local and never row-bound, so they are kept.
    if (set !== undefined && set.size > 0) {
      var stale = [];
      set.forEach(function (key) {
        if (key.indexOf('ccx-run-') === 0) return;
        var found = false;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].getAttribute('data-chat-flow-key') === key) { found = true; break; }
        }
        if (!found) stale.push(key);
      });
      for (var s = 0; s < stale.length; s++) set.delete(stale[s]);
    }

    // Runs: maximal sequences of tool-call rows with only transparent
    // (settled-thinking-only) rows between them — in split mode (the
    // default) no row is transparent, so ANY other row (settled or
    // in-progress thinking, AI text, user/steering/command content)
    // ends a run and completed thinking separates the calls into
    // independent bars. sawTool/sawThink feed the light→full observer
    // upgrade: a flow with foldable content needs subtree + data-state
    // coverage.
    var runs = [];
    var current = [];
    var sawTool = false;
    var sawThink = false;
    var sawProcess = false;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var kind = row.getAttribute('data-chat-flow-kind');
      if (kind === 'tool-call') {
        sawTool = true;
        current.push(row);
      } else if (kind === 'assistant-step') {
        var assessment = assessRow(row, keepThink, splitThink);
        if (assessment.thinks.length > 0) sawThink = true;
        if (current.length > 0 && assessment.transparent) {
          current.push(row);
        } else {
          if (current.length > 0) runs.push(current);
          current = [];
        }
      } else {
        if (current.length > 0) runs.push(current);
        current = [];
      }
    }
    if (current.length > 0) runs.push(current);

    // A foldable turn-process chip (the official Compact transcript)
    // can appear or gain text without any tool/think row being added —
    // notice it so light observers upgrade to full coverage.
    if (!sawTool && !sawThink) {
      for (var pc = 0; pc < rows.length; pc++) {
        if (rows[pc].getAttribute('data-chat-flow-kind') === 'turn-process'
          && rows[pc].textContent.trim() !== '') {
          sawProcess = true;
          break;
        }
      }
    }

    var mergedRows = new Set();
    var mergedRuns = [];
    for (var r = 0; r < runs.length; r++) {
      var run = runs[r];
      var toolRows = [];
      var thinkRows = [];
      for (var t = 0; t < run.length; t++) {
        if (run[t].getAttribute('data-chat-flow-kind') === 'tool-call') toolRows.push(run[t]);
        else thinkRows.push(run[t]);
      }
      if (toolRows.length < 2) continue;
      // The node key is the stable expansion identity; rows without one
      // (defensive: the product always sets it) get a flow-local
      // synthetic key so a run can never hide without a bar.
      var headKey = toolRows[0].getAttribute('data-chat-flow-key');
      if (headKey === null || headKey === '') {
        var synth = syntheticKeys.get(flow);
        if (synth === undefined) synth = 0;
        syntheticKeys.set(flow, synth + 1);
        headKey = 'ccx-run-' + synth;
      }
      var expandedRun = set !== undefined && headKey !== null && set.has(headKey);
      var collapsingRun = per !== undefined && headKey !== null && per.has(headKey);
      // Every card of the run hides when collapsed — the bar stands in
      // for the whole group and displays the last call itself. In merge
      // mode the run's settled-think rows fold with it too: hidden
      // while collapsed, shown in their original order between the
      // calls when expanded (they ride the same cascade). In split mode
      // think rows never enter a run (they separate runs), so with
      // "保留思考" on they stay visible between the bars. A run mid
      // collapse animation keeps its rows visible for the rise.
      var hide = !expandedRun && !collapsingRun;
      for (var k = 0; k < toolRows.length; k++) {
        toolRows[k].classList.toggle(MERGED_CLASS, hide);
        if (hide) toolRows[k].classList.remove(FALLING_CLASS, COLLAPSING_CLASS);
        mergedRows.add(toolRows[k]);
      }
      for (var w = 0; w < thinkRows.length; w++) {
        thinkRows[w].classList.toggle(MERGED_CLASS, hide);
        if (hide) thinkRows[w].classList.remove(FALLING_CLASS, COLLAPSING_CLASS);
        mergedRows.add(thinkRows[w]);
      }
      mergedRuns.push({
        headKey: headKey,
        toolRows: toolRows,
        thinkRows: thinkRows,
        // The run's rows in DOM order: cards and (merge mode) settled-
        // think rows interleaved exactly as they appear, used by the
        // waterfall.
        rows: run,
        lastRow: toolRows[toolRows.length - 1],
        expanded: expandedRun
      });
    }

    // Remove stale merge/animation classes from rows that left a run.
    for (var m = 0; m < rows.length; m++) {
      if (!mergedRows.has(rows[m])) rows[m].classList.remove(MERGED_CLASS, FALLING_CLASS, COLLAPSING_CLASS);
    }

    // Drop collapse-animation markers whose run no longer merges.
    if (per !== undefined && per.size > 0) {
      var keys = [];
      per.forEach(function (key) { keys.push(key); });
      for (var p = 0; p < keys.length; p++) {
        var still = false;
        for (var q = 0; q < mergedRuns.length; q++) {
          if (mergedRuns[q].headKey === keys[p]) { still = true; break; }
        }
        if (!still) per.delete(keys[p]);
      }
      if (per.size === 0) collapsing.delete(flow);
    }

    syncBars(flow, mergedRuns);

    // Hide assistant rows that became empty after settled-think folding
    // (the column's 16px flex gap would otherwise leave a hole). With
    // "保留思考" on nothing is hidden so nothing can be empty — remove
    // any stale marker instead. Decisions come from the cached row
    // assessment, so this loop performs no layout reads. The think's
    // parent wrapper is hidden in the same lockstep (syncThinkWrappers):
    // a 0-height wrapper item of the gap:16px body column would pin the
    // answer 16px down — the blank band under a folded think.
    for (var x = 0; x < rows.length; x++) {
      var candidate = rows[x];
      if (candidate.getAttribute('data-chat-flow-kind') !== 'assistant-step') continue;
      syncThinkWrappers(candidate, keepThink);
      if (keepThink) {
        if (candidate.classList.remove(EMPTY_CLASS)) {
          if (hiddenRows.delete(candidate)) hiddenCount -= 1;
        }
        continue;
      }
      var assessment = assessRow(candidate, keepThink, splitThink);
      if (assessment.empty) {
        candidate.classList.add(EMPTY_CLASS);
        if (!hiddenRows.has(candidate)) {
          hiddenRows.add(candidate);
          hiddenCount += 1;
        }
      } else {
        if (candidate.classList.remove(EMPTY_CLASS)) {
          if (hiddenRows.delete(candidate)) hiddenCount -= 1;
        }
      }
    }
    statsEnd('pass', 1, t0);
    return { sawTool: sawTool, sawThink: sawThink, sawProcess: sawProcess };
  }

  /** Drop observers/registries for flows no longer in the document. */
  function pruneFlows() {
    var flowsNow = [];
    flows.forEach(function (mode, flow) { flowsNow.push(flow); });
    for (var i = 0; i < flowsNow.length; i++) {
      var flow = flowsNow[i];
      if (doc.contains(flow)) continue;
      var observer = flowObservers.get(flow);
      if (observer !== null && observer !== undefined) observer.disconnect();
      flowObservers.delete(flow);
      flows.delete(flow);
      expanded.delete(flow);
      barsByFlow.delete(flow);
      collapsing.delete(flow);
      dirtyFlows.delete(flow);
      flowReasons.delete(flow);
      contentRowsByFlow.delete(flow);
      syntheticKeys.delete(flow);
    }
    // Parent observers: drop those whose parent is gone or hosts no flow.
    parentObservers.forEach(function (observer, parent) {
      if (!doc.contains(parent)) {
        observer.disconnect();
        parentObservers.delete(parent);
        return;
      }
      var used = false;
      flows.forEach(function (mode, flow) {
        if (flow.parentElement === parent) used = true;
      });
      if (!used) {
        observer.disconnect();
        parentObservers.delete(parent);
      }
    });
  }

  function refresh() {
    if (disposed || !active) return;
    var t0 = statsBegin();
    if (structureDirty) {
      structureDirty = false;
      discover();
      pruneFlows();
      observeParents();
    }
    var pending = [];
    dirtyFlows.forEach(function (flow) { pending.push(flow); });
    dirtyFlows.clear();
    for (var i = 0; i < pending.length; i++) {
      var flow = pending[i];
      if (!flows.has(flow) || !doc.contains(flow)) continue;
      var keep = effectiveKeepThink(flow);
      flow.classList.toggle(KEEP_CLASS, keep);
      var reason = flowReasons.get(flow);
      flowReasons.delete(flow);
      var contentRows = contentRowsByFlow.get(flow);
      if (contentRows !== undefined) contentRowsByFlow.delete(flow);
      if (reason === 'content') {
        if (contentRows !== undefined) barRefresh(flow, contentRows);
      } else {
        var outcome = pass(flow);
        // Light→full upgrade: foldable content appeared (or the flow
        // already had it when the rescan discovered it in light mode).
        // Never downgrades.
        if (flows.get(flow) === 'light' && (outcome.sawTool || outcome.sawThink || outcome.sawProcess)) {
          setFlowMode(flow, 'full');
        }
      }
    }
    statsEnd('refresh', 1, t0);
  }

  // ----------------------------------------------------------------
  // Public lifecycle.
  // ----------------------------------------------------------------
  function dispose() {
    if (disposed) return;
    disposed = true;
    stopRescan();
    if (typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('visibilitychange', onVisibility);
    }
    if (offSettings !== null) offSettings();
    if (rafId !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
    if (bootRaf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(bootRaf);
    disconnectObservers();
    barsByFlow.forEach(function (registry) {
      registry.forEach(function (bar) {
        if (bar._ccxFallTimer !== undefined) timers.cancel(bar._ccxFallTimer);
        if (bar._ccxCollapseTimer !== undefined) timers.cancel(bar._ccxCollapseTimer);
      });
    });
    flows.clear();
    flowObservers.clear();
    parentObservers.clear();
    expanded.clear();
    barsByFlow.clear();
    collapsing.clear();
    dirtyFlows.clear();
    flowReasons.clear();
    contentRowsByFlow.clear();
    syntheticKeys.clear();
    // Remove injected UI and classes so the flow returns to normal.
    var flowsNow = doc.querySelectorAll(FLOW_SELECTOR);
    for (var f = 0; f < flowsNow.length; f++) {
      flowsNow[f].classList.remove(KEEP_CLASS);
      var bars = flowsNow[f].querySelectorAll('[' + BADGE_ATTR + ']');
      for (var b = 0; b < bars.length; b++) bars[b].remove();
      var tagged = flowsNow[f].querySelectorAll('.' + MERGED_CLASS + ',.' + EMPTY_CLASS + ',.' + FALLING_CLASS + ',.' + COLLAPSING_CLASS + ',.' + WRAP_GONE_CLASS);
      for (var t = 0; t < tagged.length; t++) tagged[t].classList.remove(MERGED_CLASS, EMPTY_CLASS, FALLING_CLASS, COLLAPSING_CLASS, WRAP_GONE_CLASS);
    }
    // Clear any shrink-animation inline styles left on tool rows.
    var allToolRows = doc.querySelectorAll('[data-chat-flow-kind="tool-call"]');
    for (var tr = 0; tr < allToolRows.length; tr++) clearRowShrink(allToolRows[tr]);
    if (styleTag !== null && !adoptedStyle) styleTag.remove();
    styleTag = null;
    doc.documentElement.style.removeProperty('--ccx-dur');
    doc.documentElement.style.removeProperty('--ccx-step');
  }

  // Boot work (style tag, flow discovery, first passes) is deferred one
  // frame so plugin activation never blocks the page's first paint. If
  // the tab is hidden at boot the rAF never fires: the visibility
  // listener still arms, and becoming visible runs bootInit directly.
  function bootInit() {
    if (booted || disposed) return;
    booted = true;
    applySettings();
    settings.stats = ensureStats();
    insertStyle();
    discover();
    observeParents();
    startRescan();
    structureDirty = true;
    schedule();
  }
  if (typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', onVisibility);
  }
  if (doc.hidden) setActive(false);
  offSettings = settings.subscribe(function () {
    applySettings();
    if (statsObj !== null) {
      var statsOn = settings.getSnapshot().stats === true;
      if (statsOn && !statsObj.enabled) {
        statsObj.obs = 0; statsObj.obsMs = 0;
        statsObj.refresh = 0; statsObj.refreshMs = 0;
        statsObj.pass = 0; statsObj.passMs = 0;
        statsObj.scan = 0; statsObj.scanMs = 0;
        statsObj.clone = 0; statsObj.cloneMs = 0;
        statsObj.skip = 0;
        statsObj.start = Date.now();
      }
      statsObj.enabled = statsOn;
    }
    flows.forEach(function (mode, flow) { markDirty(flow, 'rows'); });
    schedule();
  });
  if (typeof requestAnimationFrame === 'function') {
    bootRaf = requestAnimationFrame(bootInit);
  } else {
    bootInit();
  }
  return dispose;
}

module.exports = { installCollapseEngine };

