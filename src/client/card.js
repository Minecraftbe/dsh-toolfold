const { acquireReact } = require('./react-env.js');

// ------------------------------------------------------------------
// Settings card: Settings → 插件 → 工具折叠. Rendered with the same
// chrome as the product's own plugin cards (the .ccxCard rules live in
// the plugin-lifetime cardCss tag, NOT the engine's style tag), so it
// is visually indistinguishable from them — even with the engine off.
// ------------------------------------------------------------------
/**
 * One plugin card under Settings → 插件, owning the folding preferences.
 * @param props - injected face: useCcxSettings snapshot hook, setDur,
 *   setThinkMode; every change applies live through the shared store.
 * @returns the card.
 */
function SettingsCard(props) {
  var React = acquireReact();
  var state = props.useCcxSettings(function (snapshot) { return snapshot; });
  var openCell = React.useState(false);
  var isOpen = openCell[0];
  var setOpen = openCell[1];
  var nowCell = React.useState(0);
  var setNow = nowCell[1];
  // While the stats toggle is on, re-render once per second so the
  // cumulative cost figures stay live (ticker rides the timer service).
  React.useEffect(function () {
    if (!state.stats) return;
    var handle = props.tick(function () { setNow(Date.now()); }, 1000);
    return function () { props.cancelTick(handle); };
  }, [state.stats]);
  var cardClass = isOpen ? 'ccxCard ccxCardOpen' : 'ccxCard';
  var compat = props.compat();
  var warnEl = null;
  if (compat.state === 'old' || compat.state === 'new') {
    warnEl = React.createElement('span', {
      className: 'ccxWarn',
      'data-tip': compat.state === 'old'
        ? '版本不匹配：当前 DSH 版本落后。\n本插件需要 DSH >= 0.1.2-rc.1，请升级 DSH。'
        : '版本不匹配：当前 DSH 版本过新。\n本插件尚未适配，请等待插件更新。',
      'aria-label': '版本不匹配',
      role: 'img'
    }, '\u26A0');
  }
  var header = React.createElement('button', {
    type: 'button',
    className: 'ccxHeader',
    'aria-expanded': isOpen,
    'aria-label': (isOpen ? '收起' : '展开') + ': 工具折叠',
    onClick: function () { setOpen(!isOpen); }
  },
    React.createElement('span', { className: 'ccxHeadText' },
      React.createElement('span', { className: 'ccxName' }, '工具折叠'),
      React.createElement('span', { className: 'ccxDescription' }, '折叠工具调用与思考的显示设置')),
    warnEl,
    React.createElement('span', { className: isOpen ? 'ccxChevron ccxChevronOpen' : 'ccxChevron' }, '▾'));
  if (!isOpen) return React.createElement('li', { className: cardClass }, header);
  var enabledField = React.createElement('div', { className: 'ccxField' },
    React.createElement('div', { className: 'ccxFieldHead' },
      React.createElement('label', { className: 'ccxFieldLabel', htmlFor: 'ccx-enabled' }, '启用插件'),
      React.createElement('input', {
        id: 'ccx-enabled', type: 'checkbox', className: 'ccxToggle', checked: state.enabled,
        onChange: function (event) { props.setEnabled(event.target.checked); }
      })),
    React.createElement('p', { className: 'ccxFieldHint' },
      state.enabled
        ? '启用工具调用与思考的折叠显示（关闭后立即取消全部折叠、恢复默认显示）'
        : '已停用：不折叠、恢复产品默认显示；此卡片保留，随时可重新启用'));
  var durField = React.createElement('div', { className: 'ccxField' },
    React.createElement('div', { className: 'ccxFieldHead' },
      React.createElement('label', { className: 'ccxFieldLabel', htmlFor: 'ccx-dur' }, '展开动画时长'),
      React.createElement('span', { className: 'ccxBadge' }, state.durMs + ' ms')),
    React.createElement('input', {
      id: 'ccx-dur', type: 'range', className: 'ccxRange', min: 0, max: 1000, step: 10,
      disabled: !state.enabled,
      value: state.durMs,
      onChange: function (event) { props.setDur(Number(event.target.value)); }
    }),
    React.createElement('p', { className: 'ccxFieldHint' }, '折叠与展开的弹性动画时长，0 为瞬时切换'));
  // One dropdown, three modes — the two old checkboxes (keepThink, only
  // meaningful with auto off) collapsed a dead control into the UI.
  var thinkMode = state.thinkMode === 'keep' || state.thinkMode === 'hide' ? state.thinkMode : 'auto';
  var thinkField = React.createElement('div', { className: 'ccxField' },
    React.createElement('div', { className: 'ccxFieldHead' },
      React.createElement('label', { className: 'ccxFieldLabel', htmlFor: 'ccx-think-mode' }, '思考显示'),
      React.createElement('select', {
        id: 'ccx-think-mode', className: 'ccxSelect', disabled: !state.enabled, value: thinkMode,
        onChange: function (event) { props.setThinkMode(event.target.value); }
      },
        React.createElement('option', { value: 'auto' }, '自动跟随官方折叠'),
        React.createElement('option', { value: 'keep' }, '始终保留'),
        React.createElement('option', { value: 'hide' }, '始终隐藏'))),
    React.createElement('p', { className: 'ccxFieldHint' }, '已完成思考的显示方式。自动（默认）：官方「对话显示 = Compact」收起整块过程时保留思考，其余时候隐藏以节省空间；始终保留：思考一直可见（分隔模式下位于两条折叠条之间）；始终隐藏：已完成的思考一律不显示'));
  var splitField = React.createElement('div', { className: 'ccxField' },
    React.createElement('div', { className: 'ccxFieldHead' },
      React.createElement('label', { className: 'ccxFieldLabel', htmlFor: 'ccx-split-think' }, '思考分隔调用组'),
      React.createElement('input', {
        id: 'ccx-split-think', type: 'checkbox', className: 'ccxToggle', disabled: !state.enabled, checked: state.splitThink,
        onChange: function (event) { props.setSplitThink(event.target.checked); }
      })),
    React.createElement('p', { className: 'ccxFieldHint' }, '开启（默认）：已完成的思考把前后两组工具调用隔开、各自独立折叠；关闭：思考并入所在工具组一起折叠'));
  var statsField = React.createElement('div', { className: 'ccxField' },
    React.createElement('div', { className: 'ccxFieldHead' },
      React.createElement('label', { className: 'ccxFieldLabel', htmlFor: 'ccx-stats' }, '性能统计'),
      React.createElement('input', {
        id: 'ccx-stats', type: 'checkbox', className: 'ccxToggle', disabled: !state.enabled, checked: state.stats,
        onChange: function (event) { props.setStats(event.target.checked); }
      })),
    React.createElement('p', { className: 'ccxFieldHint' }, '统计插件自身耗时并实时显示在本卡片内（默认关；开启才产生极小的计时开销）'));
  var storageHint = props.bridgeStatus === undefined || props.bridgeStatus() === 'dsh'
    ? '设置保存在 DSH 主机配置（~/.dsh/settings.yaml），由 DSH 设置服务持久化'
    : '未检测到 DSH 设置服务，设置仅保存在本浏览器（localStorage）';
  var body = React.createElement('div', { className: 'ccxBody' },
    enabledField, durField, thinkField, splitField, statsField,
    React.createElement('p', { className: 'ccxFieldHint' }, storageHint));
  var children = [header, body];
  if (state.stats) {
    var engineStats = props.stats();
    if (engineStats !== undefined) {
      var elapsed = Math.max(1, (Date.now() - engineStats.start) / 1000);
      var rows = [
        ['观察回调', 'obs', engineStats.obs, engineStats.obsMs],
        ['引擎刷新', 'refresh', engineStats.refresh, engineStats.refreshMs],
        ['合并重算', 'pass', engineStats.pass, engineStats.passMs],
        ['安全重扫', 'scan', engineStats.scan, engineStats.scanMs],
        ['摘要克隆', 'clone', engineStats.clone, engineStats.cloneMs]
      ];
      var statRows = rows.map(function (row) {
        return React.createElement('div', { className: 'ccxStatRow', key: row[1] },
          React.createElement('span', { className: 'ccxFieldLabel' }, row[0]),
          React.createElement('span', { className: 'ccxStatValue' },
            row[2] + ' 次 · ' + row[3].toFixed(1) + ' ms（' + (row[3] / elapsed).toFixed(2) + ' ms/s）'));
      });
      children.push(React.createElement('div', { className: 'ccxBody' },
        statRows,
        React.createElement('p', { className: 'ccxFieldHint' }, '流式变更直接忽略（零开销短路）：' + engineStats.skip + ' 批次'),
        React.createElement('p', { className: 'ccxFieldHint' }, '累计自开启统计起算；标签页隐藏时引擎全部暂停，不计入')));
    }
  }
  return React.createElement('li', { className: cardClass }, children);
}

module.exports = { SettingsCard };

