/* Digital.js - 应用主控制器 */
(function (root) {
  'use strict';
  var DIG = root.DIG, U = DIG.Util, L = DIG.Lib, ED = DIG.Editor, R = DIG.Render, A = DIG.Analysis, H = DIG.HDL;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var App = {
    canvas: null, wave: null, circuit: null, sim: null,
    ui: {
      view: { scale: 1, ox: 80, oy: 60 }, mode: 'select', placeType: null, placeProps: null,
      selection: new Set(), hoverId: null, wireDraft: null, rubber: null, clipboard: null,
      showValues: true, highlightComp: null, running: false, speed: 5, raf: null,
      cursor: [0, 0], spaceDown: false, logs: []
    },
    undoStack: [], redoStack: [],
    _modal: null, _menu: null, _hdlState: { lang: 'verilog', code: '' },

    init: function () {
      this.canvas = $('#canvas'); this.wave = $('#wave');
      this.circuit = DIG.Examples.halfAdder();
      this.sim = new DIG.Simulator(this.circuit);
      this.buildPalette(); this.buildHDLList();
      ED.attach(this);
      this.bindUI();
      this.sizeCanvases();
      window.addEventListener('resize', this.sizeCanvases.bind(this));
      ED.fitView();
      this.autoWatch();
      this.showProps(); this.showCircuitInfo(); this.showWatch();
      this.syncToolbar(); this.updateSimStatus();
      $('#test-editor').value = this.circuit.testText || '';
      $('#canvas-hint').textContent = '从左侧选元件 → 画布单击放置；从引脚拖到另一引脚连线 · 滚轮缩放 · 空格+拖拽平移';
      this.log('info', '已载入示例「半加器」。点击「⏻ 上电」开始仿真，或查看「示例」选择其它电路。');
      this.log('info', '支持从原理图导出 Verilog / VHDL，也支持用 Verilog / VHDL 编写自定义元件并直接参与仿真。');
      this.repaint();
    },

    sizeCanvases: function () {
      var d = window.devicePixelRatio || 1;
      [this.canvas, this.wave].forEach(function (cv) {
        if (!cv) return;
        var w = cv.clientWidth, h = cv.clientHeight;
        cv.width = Math.max(1, Math.round(w * d)); cv.height = Math.max(1, Math.round(h * d));
        cv.getContext('2d').setTransform(d, 0, 0, d, 0, 0);
      });
      if (this.sim) this.repaint();
    },

    repaint: function () {
      if (!this.canvas || !this.sim) return;
      R.draw(this.canvas, this.ui.view, this.circuit, this.sim, this.ui);
      if ($('#tab-wave').classList.contains('active')) R.drawWave(this.wave, this.sim, this.ui);
      $('#status-zoom').textContent = Math.round(this.ui.view.scale * 100) + '%';
      $('#status-count').textContent = this.circuit.components.length + ' 元件 · ' + this.circuit.wires.length + ' 导线';
    },

    status: function (msg) { $('#status-text').textContent = msg; $('#top-status').textContent = msg; },
    statusCoords: function (x, y) { $('#status-coords').textContent = '网格 ' + x + ', ' + y; },

    log: function (level, msg) {
      this.ui.logs.push({ level: level, msg: msg, t: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
      if (this.ui.logs.length > 200) this.ui.logs.shift();
      var el = $('#tab-log');
      el.innerHTML = this.ui.logs.slice().reverse().map(function (l) {
        return '<div class="log-line"><span class="tag ' + l.level + '">' + ({ err: '错误', warn: '警告', info: '信息', ok: '通过' }[l.level] || '信息') +
          '</span><span style="color:#94a3b8">' + l.t + '</span><span>' + U.escapeHtml(l.msg) + '</span></div>';
      }).join('');
      var n = this.ui.logs.filter(function (l) { return l.level === 'err' || l.level === 'warn'; }).length;
      var b = $('#log-badge');
      b.textContent = n; b.classList.toggle('hidden', n === 0);
    },

    /* ---------- 撤销 / 重做 ---------- */
    pushUndo: function () {
      this.undoStack.push(U.clone(this.circuit));
      if (this.undoStack.length > 80) this.undoStack.shift();
      this.redoStack.length = 0;
    },
    undo: function () {
      if (!this.undoStack.length) { this.status('没有可撤销的操作'); return; }
      this.redoStack.push(U.clone(this.circuit));
      this.circuit = this.undoStack.pop();
      this.afterLoad(true);
      this.status('已撤销');
    },
    redo: function () {
      if (!this.redoStack.length) { this.status('没有可重做的操作'); return; }
      this.undoStack.push(U.clone(this.circuit));
      this.circuit = this.redoStack.pop();
      this.afterLoad(true);
      this.status('已重做');
    },

    /* ---------- 电路加载 / 重建 ---------- */
    loadCircuit: function (obj, keepView) {
      this.pushUndo();
      this.circuit = this.normalize(obj);
      this.afterLoad(keepView);
      if (!keepView) ED.fitView();
      this.status('已载入电路「' + (this.circuit.name || '未命名') + '」');
      this.log('ok', '载入电路：' + (this.circuit.name || '未命名'));
    },
    normalize: function (o) {
      o = o || {};
      var c = {
        name: o.name || '未命名电路', description: o.description || '',
        components: Array.isArray(o.components) ? o.components : [],
        wires: Array.isArray(o.wires) ? o.wires : [],
        bindings: Array.isArray(o.bindings) ? o.bindings : [],
        hdlModules: Array.isArray(o.hdlModules) ? o.hdlModules : [],
        dataFiles: (o.dataFiles && typeof o.dataFiles === 'object' && !Array.isArray(o.dataFiles)) ? o.dataFiles : {},
        testText: o.testText || ''
      };
      var max = 0;
      c.components.forEach(function (x) {
        x.id = x.id || U.uid('c'); x.rot = x.rot || 0; x.props = x.props || {};
        var m = /_(\d+)_/.exec(x.id); if (m) max = Math.max(max, +m[1]);
        if (x.type === 'hdl' && x.props.code && !x.props.hdlIR) {
          try { var mod = H.compile(x.props.code, x.props.lang); x.props.hdlPorts = mod.ports; x.props.hdlIR = mod.ir; }
          catch (e) { /* 保留原样 */ }
        }
      });
      c.wires.forEach(function (w) { w.id = w.id || U.uid('w'); w.points = w.points || []; });
      U.seedIds(max + 10);
      return c;
    },
    afterLoad: function (keepView) {
      this.stopRun();
      this.sim = new DIG.Simulator(this.circuit);
      this.ui.selection = new Set(); this.ui.wireDraft = null; this.ui.mode = 'select';
      this.autoWatch();
      this.buildHDLList(); this.showProps(); this.showCircuitInfo(); this.showWatch();
      this.syncToolbar(); this.updateSimStatus();
      $('#test-editor').value = this.circuit.testText || '';
      $('#tab-table').innerHTML = '<div class="empty">点击工具栏「真值表」分析当前电路</div>';
      $('#test-result').innerHTML = '';
      if (this.sim.nl.warnings.length) this.sim.nl.warnings.slice(0, 5).forEach(function (w) { App.log('warn', w); });
      this.repaint();
    },
    rebuild: function () {
      var wasOn = this.sim.on;
      var names = this.sim.watch.map(function (id) { return this.sim.nets[id] && this.sim.nets[id].name; }, this);
      this.stopRun();
      this.sim = new DIG.Simulator(this.circuit);
      var ids = [];
      names.forEach(function (nm) {
        if (!nm) return;
        this.sim.nets.forEach(function (n) { if (n.name === nm && ids.indexOf(n.id) < 0) ids.push(n.id); });
      }, this);
      this.sim.setWatch(ids);
      if (wasOn) { this.status('电路已修改，仿真已自动断电'); this.log('warn', '运行中修改了电路，已自动断电（Digital 的仿真不允许带电修改）'); }
      this.sim.nl.warnings.slice(0, 5).forEach(function (w) { App.log('warn', w); });
      this.showCircuitInfo(); this.showWatch(); this.updateSimStatus(); this.syncToolbar();
      this.repaint();
    },

    /* ---------- 元件面板 ---------- */
    buildPalette: function () {
      var self = this, host = $('#palette-list');
      var q = ($('#search').value || '').trim().toLowerCase();
      var html = '';
      L.categories.forEach(function (cat, ci) {
        if (cat.name === 'HDL 元件') return;
        var items = cat.items.slice();
        if (cat.name === '74xx 芯片') {
          items = Object.keys(L.PARTS).map(function (p) {
            return { type: 'ic74', name: p + ' · ' + L.PARTS[p].d, props: { part: p } };
          });
        }
        var visible = items.filter(function (d) {
          return !q || (d.name + ' ' + d.type + ' ' + (d.props && d.props.part || '')).toLowerCase().indexOf(q) >= 0;
        });
        if (!visible.length) return;
        html += '<div class="cat-head" data-cat="' + ci + '"><span class="caret">▼</span>' + U.escapeHtml(cat.name) + ' <span style="margin-left:auto;color:#94a3b8">' + visible.length + '</span></div>';
        html += '<div class="cat-items" data-items="' + ci + '">' + visible.map(function (d) {
          var ico = { '输入 / 输出': '◈', '基本门电路': '⊓', '组合逻辑': '⊞', '时序逻辑': '◫', '74xx 芯片': '▤' }[cat.name] || '◇';
          return '<div class="pal-item" data-type="' + d.type + '" data-props="' + U.escapeHtml(JSON.stringify(d.props || {})) + '" title="' + U.escapeHtml(d.name) + '">' +
            '<span class="pi-ico">' + ico + '</span>' + U.escapeHtml(d.name) + '</div>';
        }).join('') + '</div>';
      });
      host.innerHTML = html || '<div class="empty">没有匹配的元件</div>';
      $('#comp-count').textContent = L.allTypes().length + ' 类';
      host.querySelectorAll('.cat-head').forEach(function (h) {
        h.onclick = function () { h.classList.toggle('closed'); host.querySelector('[data-items="' + h.dataset.cat + '"]').classList.toggle('closed'); };
      });
      host.querySelectorAll('.pal-item').forEach(function (el) {
        el.onclick = function () {
          var type = el.dataset.type, props = {};
          try { props = JSON.parse(el.dataset.props || '{}'); } catch (e) { }
          host.querySelectorAll('.pal-item').forEach(function (x) { x.classList.remove('active'); });
          el.classList.add('active');
          self.ui.mode = 'place'; self.ui.placeType = type; self.ui.placeProps = props;
          var d = L.get(type);
          $('#place-badge').textContent = '放置中：' + d.name + ' ' + (props.part || '') + ' · Esc 取消';
          $('#place-badge').classList.remove('hidden');
          self.status('在画布上单击放置「' + d.name + '」，按住 Shift 可连续放置');
        };
      });
    },
    buildHDLList: function () {
      var self = this, host = $('#hdl-list');
      var mods = this.circuit.hdlModules || [];
      host.innerHTML = mods.length ? mods.map(function (m, i) {
        return '<div class="hdl-item" data-i="' + i + '"><span>' + U.escapeHtml(m.name || 'module' + i) + '</span><span class="lang ' + (m.lang === 'vhdl' ? 'vhdl' : '') + '">' + (m.lang === 'vhdl' ? 'VHDL' : 'V') + '</span></div>';
      }).join('') : '<div class="prop-note">暂无自定义元件。点右上角 ＋ 用 Verilog / VHDL 编写。</div>';
      host.querySelectorAll('.hdl-item').forEach(function (el) {
        el.onclick = function () {
          var m = mods[+el.dataset.i];
          try {
            var mod = H.compile(m.code, m.lang);
            self.ui.mode = 'place'; self.ui.placeType = 'hdl';
            self.ui.placeProps = { name: mod.name, lang: mod.lang, code: m.code, hdlPorts: mod.ports, hdlIR: mod.ir };
            $('#place-badge').textContent = '放置中：HDL 元件 ' + mod.name + ' · Esc 取消';
            $('#place-badge').classList.remove('hidden');
            self.status('在画布上单击放置 HDL 元件「' + mod.name + '」');
          } catch (e) { self.log('err', 'HDL 元件编译失败：' + e.message); }
        };
      });
    },

    /* ---------- 属性面板 ---------- */
    showProps: function () {
      var self = this, host = $('#props'), sel = this.ui.selection;
      if (!sel || sel.size === 0) {
        host.innerHTML = '<div class="prop-title">电路属性</div>' +
          this.propRow('名称', 'circuit-name', this.circuit.name || '') +
          '<div class="prop-row" style="align-items:flex-start"><label>说明</label><textarea data-circuit="description">' + U.escapeHtml(this.circuit.description || '') + '</textarea></div>' +
          '<div class="prop-note">在左侧元件库选择元件后，于画布单击放置。单击引脚并拖到另一引脚即可连线。双击元件可编辑 HDL 源码 / 属性。</div>';
        this.bindProps(host);
        return;
      }
      var comps = this.circuit.components.filter(function (c) { return sel.has(c.id); });
      var wires = this.circuit.wires.filter(function (w) { return sel.has(w.id); });
      if (comps.length === 1 && !wires.length) { this.showCompProps(comps[0]); return; }
      if (wires.length === 1 && !comps.length) { this.showWireProps(wires[0]); return; }
      host.innerHTML = '<div class="prop-title">已选中 ' + comps.length + ' 个元件 / ' + wires.length + ' 条导线</div>' +
        '<div style="padding:10px;display:flex;flex-direction:column;gap:6px">' +
        '<button data-act="rotate">⟳ 旋转 90°</button><button data-act="copy">复制</button>' +
        '<button data-act="delete">✕ 删除</button></div>' +
        '<div class="prop-note">按住 Shift 单击可增减选择对象；拖拽可整体移动（相连导线端点会跟随）。</div>';
    },
    // 修改「总线位宽」时，把仍是默认形态的分割规格一起同步，避免出现「1*8 配 32 位总线」的不完整输入
    syncSplitBits: function (p, nb) {
      if (/^\d+$/.test(String(p.inSplit))) p.inSplit = String(nb);
      else if (/^1\*\d+$/.test(String(p.inSplit))) p.inSplit = '1*' + nb;
      if (/^1\*\d+$/.test(String(p.outSplit))) p.outSplit = '1*' + nb;
      else if (/^\d+$/.test(String(p.outSplit))) p.outSplit = String(nb);
    },
    propRow: function (label, key, value, extra) {
      return '<div class="prop-row"><label>' + U.escapeHtml(label) + '</label><input data-prop="' + key + '" value="' + U.escapeHtml(value == null ? '' : value) + '" ' + (extra || '') + '></div>';
    },
    showCompProps: function (c) {
      var self = this, d = L.get(c.type) || L.get('text'), host = $('#props');
      var html = '<div class="prop-title">' + U.escapeHtml(d.name) + ' <span style="font-weight:400;color:#94a3b8">' + c.type + '</span></div>';
      html += '<div class="prop-row"><label>ID</label><input value="' + U.escapeHtml(c.id) + '" readonly style="color:#94a3b8"></div>';
      html += this.propRow('X', 'x', c.x, 'type="number"') + this.propRow('Y', 'y', c.y, 'type="number"');
      if (c.type === 'hdl') {
        html += '<div class="prop-row"><label>模块名</label><input value="' + U.escapeHtml(c.props.name || '') + '" readonly></div>';
        html += '<div class="prop-row"><label>语言</label><input value="' + (c.props.lang === 'vhdl' ? 'VHDL' : 'Verilog') + '" readonly></div>';
        html += '<div style="padding:8px"><button data-act="edit-hdl" class="primary" style="width:100%">✎ 编辑 HDL 源码</button></div>';
        html += '<div class="prop-note">端口：' + (c.props.hdlPorts || []).map(function (p) { return p.name + '(' + p.dir + ',' + p.bits + 'b)'; }).join('、') + '</div>';
      } else {
        (d.propDefs || []).forEach(function (pd) {
          var v = c.props[pd.k];
          if (pd.t === 'check') html += '<div class="prop-row"><label>' + U.escapeHtml(pd.label) + '</label><input type="checkbox" data-prop="' + pd.k + '" ' + (v ? 'checked' : '') + '></div>';
          else if (pd.t === 'select') html += '<div class="prop-row"><label>' + U.escapeHtml(pd.label) + '</label><select data-prop="' + pd.k + '">' +
            pd.options.map(function (o) { return '<option value="' + U.escapeHtml(o[0]) + '" ' + (String(v) === String(o[0]) ? 'selected' : '') + '>' + U.escapeHtml(o[1]) + '</option>'; }).join('') + '</select></div>';
          else if (pd.t === 'area') html += '<div class="prop-row" style="align-items:flex-start"><label>' + U.escapeHtml(pd.label) + '</label><textarea data-prop="' + pd.k + '">' + U.escapeHtml(v == null ? '' : v) + '</textarea></div>';
          else html += '<div class="prop-row"><label>' + U.escapeHtml(pd.label) + '</label><input data-prop="' + pd.k + '" ' +
            (pd.t === 'number' ? 'type="number" min="' + (pd.min || 0) + '" max="' + (pd.max || 9999) + '"' : 'type="text"') + ' value="' + U.escapeHtml(v == null ? '' : v) + '"></div>';
        });
      }
      if (c.type === 'splitter') {
        var sm = L.splitModel(c.props);
        html += '<div class="prop-note"' + (sm.error ? ' style="color:#dc2626"' : '') + '>' +
          (sm.legacy ? '旧版分线器（bus + b0…bN，' + sm.busBits + ' 位）。删除后重新放置即可使用新的任意分割语法。'
            : sm.error ? '⚠ ' + U.escapeHtml(sm.error)
              : '✓ 总线 ' + sm.busBits + ' 位 · 输入 ' + sm.inSegments.length + ' 段 · 输出 ' + sm.outSegments.length + ' 段') + '</div>';
        html += '<div class="prop-note">输入分割 / 输出分割：<code>4,2,2</code>（顺序宽度）、<code>1*16</code>（位宽*个数）、<code>4-7,0-3</code>（直接指定位，可乱序、可反序 <code>7-4</code>），三种可混合。' +
          '输入分割必须<b>完整且唯一</b>覆盖所有位；输出分割可重复引用，如 <code>0-7,1-6,4-7</code>。总线最多 32 位。</div>';
      }
      html += '<div style="padding:8px;display:flex;gap:6px"><button data-act="rotate">⟳ 旋转</button><button data-act="copy">复制</button><button data-act="delete">✕ 删除</button></div>';
      if (L.interactive(c.type)) html += '<div class="prop-note">上电后单击该元件可直接改变输入值。</div>';
      host.innerHTML = html;
      this.bindProps(host, c);
    },
    showWireProps: function (w) {
      var host = $('#props'), nid = this.sim.nl.keyToNet[U.key(w.points[0][0], w.points[0][1])];
      var n = nid === undefined ? null : this.sim.nets[nid];
      var v = n ? this.sim.values[nid] : null;
      var html = '<div class="prop-title">导线 / 网络</div>';
      html += '<div class="prop-row"><label>点数</label><input value="' + w.points.length + '" readonly></div>';
      if (n) {
        html += '<div class="prop-row"><label>网络名</label><input value="' + U.escapeHtml(n.name || 'n' + n.id) + '" readonly></div>';
        html += '<div class="prop-row"><label>位宽</label><input value="' + n.bits + ' bit" readonly></div>';
        html += '<div class="prop-row"><label>当前值</label><input value="' + (v ? U.format(v, n.bits, 'hex') : '—') + '" readonly></div>';
        html += '<div class="prop-row"><label>驱动器</label><input value="' + n.drivers.length + '" readonly></div>';
        html += '<div style="padding:8px"><button data-act="toggle-watch" data-net="' + nid + '" style="width:100%">' + (this.sim.watch.indexOf(nid) >= 0 ? '− 移出波形观测' : '＋ 加入波形观测') + '</button></div>';
      }
      html += '<div style="padding:0 8px 8px"><button data-act="delete" style="width:100%">✕ 删除导线</button></div>';
      host.innerHTML = html;
    },
    bindProps: function (host, comp) {
      var self = this;
      host.querySelectorAll('[data-prop]').forEach(function (el) {
        var handler = function () {
          var k = el.dataset.prop, v;
          if (el.type === 'checkbox') v = el.checked;
          else if (el.type === 'number') v = U.clamp(parseFloat(el.value) || 0, parseFloat(el.min) || 0, parseFloat(el.max) || 9999);
          else v = el.value;
          self.pushUndo();
          if (comp) {
            if (k === 'x' || k === 'y') comp[k] = Math.round(v);
            else {
              comp.props[k] = v;
              if (comp.type === 'splitter' && k === 'bits') self.syncSplitBits(comp.props, v);
            }
            self.rebuild(); self.showProps();
          } else {
            if (k === 'circuit-name') self.circuit.name = v;
            self.status('已更新'); self.repaint();
          }
        };
        el.addEventListener('change', handler);
      });
      host.querySelectorAll('[data-circuit]').forEach(function (el) {
        el.addEventListener('change', function () { self.pushUndo(); self.circuit[el.dataset.circuit] = el.value; self.status('已更新说明'); });
      });
    },

    /* ---------- 电路信息 / 观测 ---------- */
    showCircuitInfo: function () {
      var c = this.circuit, s = this.sim;
      $('#circuit-info').innerHTML = [
        ['名称', c.name || '—'], ['元件', c.components.length], ['导线', c.wires.length],
        ['网络', s.nets.length], ['HDL 模块', (c.hdlModules || []).length],
        ['数据文件', Object.keys(c.dataFiles || {}).length],
        ['输入', s.inputComponents().length], ['输出', s.outputComponents().length],
        ['时钟', c.components.filter(function (x) { return x.type === 'clock'; }).length]
      ].map(function (r) { return '<div class="info-row"><span>' + r[0] + '</span><b>' + U.escapeHtml(r[1]) + '</b></div>'; }).join('') +
        '<div class="prop-note">' + U.escapeHtml(c.description || '暂无说明') + '</div>';
    },
    autoWatch: function () {
      var named = this.sim.nets.filter(function (n) { return n.name && n.drivers.length; }).map(function (n) { return n.id; });
      var others = this.sim.nets.filter(function (n) { return !n.name && n.drivers.length; }).map(function (n) { return n.id; });
      this.sim.setWatch(named.concat(others).slice(0, 8));
      this.showWatch();
    },
    showWatch: function () {
      var self = this, host = $('#watch-list'), sim = this.sim;
      var nets = sim.nets.filter(function (n) { return n.drivers.length || n.name; }).slice(0, 60);
      host.innerHTML = nets.length ? nets.map(function (n) {
        var v = sim.values[n.id];
        return '<div class="watch-row"><input type="checkbox" data-watch="' + n.id + '" ' + (sim.watch.indexOf(n.id) >= 0 ? 'checked' : '') + '>' +
          '<span class="nm">' + U.escapeHtml(n.name || 'n' + n.id) + (n.bits > 1 ? ' [' + n.bits + 'b]' : '') + '</span>' +
          '<span class="v">' + (v ? U.format(v, n.bits, 'hex') : '—') + '</span></div>';
      }).join('') : '<div class="prop-note">暂无可观测网络</div>';
      host.querySelectorAll('[data-watch]').forEach(function (el) {
        el.onchange = function () {
          var id = +el.dataset.watch, w = sim.watch.slice();
          if (el.checked) { if (w.indexOf(id) < 0) w.push(id); } else w = w.filter(function (x) { return x !== id; });
          sim.setWatch(w); self.repaint();
        };
      });
    },

    /* ---------- 仿真 ---------- */
    syncToolbar: function () {
      var on = this.sim.on, run = this.ui.running;
      var pb = $('#btn-power'), rb = $('#btn-run');
      pb.textContent = on ? '⏻ 断电' : '⏻ 上电';
      pb.classList.toggle('on', on);
      rb.textContent = run ? '⏸ 暂停' : '▶ 运行';
      rb.classList.toggle('on', run);
      $('#place-badge').classList.toggle('hidden', this.ui.mode !== 'place');
    },
    updateSimStatus: function () {
      var el = $('#status-sim'), on = this.sim.on, run = this.ui.running;
      el.textContent = this.sim.oscillation ? '振荡停止' : (run ? '运行中' : (on ? '已上电（暂停）' : '未上电'));
      el.className = 'pill ' + (this.sim.oscillation ? 'err' : (run ? 'run' : (on ? 'on' : '')));
    },
    powerToggle: function () {
      if (this.sim.on) {
        this.stopRun(); this.sim.powerOff(); this.status('已断电');
        this.log('info', '仿真已断电');
      } else {
        this.sim.powerOn();
        this.autoWatch();
        this.status('已上电，电路已稳定');
        this.log('ok', '上电完成，稳定轮次结束。');
        if (this.sim.errors.length) this.sim.errors.forEach(function (e) { App.log('warn', e); });
        if (this.sim.oscillation) this.log('err', '检测到振荡，请使用「单门」定位问题');
      }
      this.syncToolbar(); this.updateSimStatus(); this.showWatch(); this.repaint();
    },
    ensureOn: function () {
      if (!this.sim.on) { this.powerToggle(); }
      return this.sim.on;
    },
    gateStep: function () {
      if (!this.ensureOn()) return;
      var r = this.sim.stepGate();
      this.ui.highlightComp = r ? r.comp.id : null;
      this.status(r ? ('单门步进：' + r.comp.type + '，' + r.changed.length + ' 个网络变化') : '没有待更新的元件');
      this.repaint();
    },
    step: function () {
      if (!this.ensureOn()) return;
      this.sim.stepTick(1);
      if (this.sim.oscillation) this.log('err', '检测到振荡，仿真停止');
      this.status('tick ' + this.sim.tick);
      this.updateSimStatus(); this.showWatch(); this.repaint();
    },
    runToggle: function () {
      if (this.ui.running) { this.stopRun(); return; }
      if (!this.ensureOn()) return;
      this.ui.running = true;
      var self = this, last = U.now(), acc = 0;
      var loop = function () {
        if (!self.ui.running) return;
        var now = U.now(), dt = Math.min(.25, (now - last) / 1000); last = now;
        acc += dt * self.ui.speed;
        var steps = Math.min(500, Math.floor(acc));
        if (steps > 0) { acc -= steps; self.sim.stepTick(steps); }
        if (self.sim.oscillation) {
          self.stopRun(); self.log('err', '检测到振荡，运行已停止（tick ' + self.sim.tick + '）');
        }
        self.status('运行中 · tick ' + self.sim.tick + ' · ' + self.ui.speed + ' tick/s');
        self.repaint();
        self.ui.raf = requestAnimationFrame(loop);
      };
      this.ui.raf = requestAnimationFrame(loop);
      this.syncToolbar(); this.updateSimStatus();
    },
    stopRun: function () {
      this.ui.running = false;
      if (this.ui.raf) cancelAnimationFrame(this.ui.raf);
      this.ui.raf = null;
      this.syncToolbar(); this.updateSimStatus();
    },

    /* ---------- 交互元件 ---------- */
    interactiveClick: function (c, ev) {
      if (c.type === 'switch') {
        var v = (this.sim.getInput(c.id) || 0) ^ 1;
        this.sim.setInput(c.id, v);
        this.status('开关 ' + (c.props.label || '') + ' → ' + v);
        this.repaint();
      } else if (c.type === 'button') {
        this.status('按钮已按下');
      } else if (c.type === 'const' || c.type === 'portIn') {
        var self = this;
        this.quickPrompt('设置 ' + (c.props.label || c.type) + ' 的值', String(c.type === 'const' ? c.props.value : this.sim.getInput(c.id)), function (val) {
          self.pushUndo();
          self.sim.setInput(c.id, U.parseNum(val));
          self.status('已设置为 ' + val);
          self.repaint();
        }, '支持十进制、0x 前缀十六进制、0b 前缀二进制、Verilog 形式 8\'hFF');
      }
    },
    setButton: function (c, v) {
      this.sim.setInput(c.id, v);
      this.repaint();
    },
    openComponentEditor: function (c) {
      if (c.type === 'hdl') { this.openHDLEditor(c); return; }
      this.ui.selection = new Set([c.id]);
      this.showProps();
      this.status('已选中「' + (L.get(c.type) || {}).name + '」，可在右侧修改属性');
      this.repaint();
    },

    /* ---------- 菜单 / 模态框 ---------- */
    menu: function (x, y, items) {
      this.closeMenu();
      var self = this, el = $('#context-menu');
      el.innerHTML = items.map(function (it) {
        if (it.sep) return '<hr>';
        return '<button data-mi="' + U.escapeHtml(it.act) + '" ' + (it.data ? 'data-val="' + U.escapeHtml(it.data) + '"' : '') + (it.disabled ? ' disabled style="opacity:.4"' : '') + '>' + U.escapeHtml(it.label) + '</button>';
      }).join('');
      el.style.left = Math.min(x, window.innerWidth - 190) + 'px';
      el.style.top = Math.min(y, window.innerHeight - items.length * 30 - 20) + 'px';
      el.classList.remove('hidden');
      el.querySelectorAll('[data-mi]').forEach(function (b) {
        b.onclick = function () { self.closeMenu(); self.doAction(b.dataset.mi, b.dataset.val); };
      });
      this._menu = el;
    },
    closeMenu: function () { $('#context-menu').classList.add('hidden'); },
    contextMenu: function (x, y, ctx) {
      var self = this, items = [];
      if (ctx.comp) {
        var c = ctx.comp;
        items.push({ label: '✎ 编辑属性', act: 'edit-comp', data: c.id });
        if (c.type === 'hdl') items.push({ label: '⌨ 编辑 HDL 源码', act: 'edit-hdl', data: c.id });
        items.push({ label: '⟳ 旋转 90°', act: 'rotate' });
        items.push({ label: '⎘ 复制', act: 'copy' });
        items.push({ sep: true }, { label: '✕ 删除', act: 'delete' });
      } else if (ctx.wire) {
        var nid = this.sim.nl.keyToNet[U.key(ctx.wire.points[0][0], ctx.wire.points[0][1])];
        if (nid !== undefined) items.push({ label: (this.sim.watch.indexOf(nid) >= 0 ? '− 移出波形观测' : '＋ 加入波形观测'), act: 'toggle-watch', data: nid });
        items.push({ label: '✕ 删除导线', act: 'delete' });
        items.push({ sep: true }, { label: '查看网络属性', act: 'select-only' });
      } else {
        items.push({ label: '粘贴 (Ctrl+V)', act: 'paste', disabled: !this.ui.clipboard });
        items.push({ label: '全选 (Ctrl+A)', act: 'select-all' });
        items.push({ label: '适配视图 (F)', act: 'fit' });
      }
      this.menu(x, y, items);
    },
    modal: function (opt) {
      this.closeModal();
      var self = this, mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML = '<div class="modal ' + (opt.small ? 'small' : '') + '">' +
        '<div class="modal-head"><h3>' + U.escapeHtml(opt.title) + '</h3><button class="x">×</button></div>' +
        '<div class="modal-body">' + opt.body + '</div>' +
        (opt.foot ? '<div class="modal-foot">' + opt.foot + '</div>' : '') + '</div>';
      $('#modal-root').appendChild(mask);
      mask.querySelector('.x').onclick = function () { self.closeModal(); };
      mask.addEventListener('mousedown', function (e) { if (e.target === mask) self.closeModal(); });
      // 弹窗内 [data-act] 由 document 级事件委托统一处理，避免重复触发
      this._modal = mask;
      if (opt.onMount) opt.onMount(mask);
      return mask;
    },
    closeModal: function () {
      if (this._modal) { this._modal.remove(); this._modal = null; }
    },
    quickPrompt: function (title, value, cb, note) {
      var self = this;
      var m = this.modal({
        title: title, small: true,
        body: '<div class="form-row"><label>数值</label><input id="qp-val" value="' + U.escapeHtml(value) + '" autocomplete="off"></div>' +
          (note ? '<div class="prop-note">' + U.escapeHtml(note) + '</div>' : ''),
        foot: '<button data-act="close-modal">取消</button><button class="primary" id="qp-ok">确定</button>',
        onMount: function (mm) {
          var inp = mm.querySelector('#qp-val'); inp.focus(); inp.select();
          var ok = function () { var v = inp.value; self.closeModal(); cb(v); };
          mm.querySelector('#qp-ok').onclick = ok;
          inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') ok(); });
        }
      });
      return m;
    },

    /* ---------- 真值表 / 测试 ---------- */
    switchTab: function (name) {
      $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
      $$('.tab-pane').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
      if (name === 'wave') this.repaint();
      $('#bottom-panel').classList.remove('collapsed');
    },
    analyze: function () {
      var self = this, tt = A.truthTable(this.circuit, 1024);
      if (tt.error) { this.log('err', '真值表分析：' + tt.error); this.status(tt.error); this.switchTab('table'); $('#tab-table').innerHTML = '<div class="empty">' + U.escapeHtml(tt.error) + '</div>'; return; }
      var exprs = A.expressions(tt);
      var head = '<tr><th>#</th>' + tt.inputs.map(function (i) { return '<th>' + U.escapeHtml(i.name) + '</th>'; }).join('') +
        '<th style="background:#eff6ff">|</th>' + tt.outputs.map(function (o) { return '<th>' + U.escapeHtml(o.name) + '</th>'; }).join('') + '</tr>';
      var body = tt.rows.map(function (r, ri) {
        return '<tr><td>' + ri + '</td>' + r.in.map(function (v) { return '<td>' + U.format({ v: v, z: 0 }, 1, 'hex') + '</td>'; }).join('') +
          '<td style="background:#eff6ff"></td>' + r.out.map(function (v) { return '<td class="hi">' + U.format({ v: v, z: 0 }, 1, 'hex') + '</td>'; }).join('') + '</tr>';
      }).join('');
      var html = '<div class="pane-section"><h4>真值表（' + tt.rows.length + ' 行）</h4>' +
        (tt.warning ? '<div class="err-box" style="color:#b45309;background:#fffbeb;border-color:#fde68a">' + U.escapeHtml(tt.warning) + '</div>' : '') +
        '<div style="max-height:190px;overflow:auto"><table class="grid"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></div>';
      html += '<div class="pane-section"><h4>最简与或表达式（Quine–McCluskey 最小化）</h4>' +
        exprs.map(function (e, i) { return '<div><b>' + U.escapeHtml(e.name) + '</b> = <span class="expr">' + U.escapeHtml(e.expr) + '</span> <button data-act="gen-circuit" data-val="' + i + '">生成电路</button></div>'; }).join('') +
        '<div style="margin-top:8px"><button data-act="gen-from-expr">从布尔表达式生成电路…</button> <span style="color:#94a3b8;font-size:10.5px">支持 &amp; | ^ ~ 与括号，例如 (A &amp; ~B) | (~A &amp; B)</span></div></div>';
      $('#tab-table').innerHTML = html;
      this._tt = tt; this._exprs = exprs;
      this.switchTab('table');
      this.status('真值表分析完成：' + tt.rows.length + ' 行');
      this.log('ok', '真值表分析完成，' + exprs.length + ' 个输出已最小化');
    },
    genCircuit: function (i) {
      var c = A.circuitFromTruthTable(this._tt, i);
      if (!c) return;
      this.loadCircuit(c);
      this.log('ok', '已由最小化表达式生成门级电路');
    },
    runTests: function () {
      this.circuit.testText = $('#test-editor').value;
      var r = A.runTests(this.circuit, this.circuit.testText);
      var host = $('#test-result');
      if (r.error) { host.innerHTML = '<div class="err-box">' + U.escapeHtml(r.error) + '</div>'; $('#test-summary').textContent = '错误'; this.log('err', '测试：' + r.error); return; }
      var all = r.inCols.concat(r.outCols);
      var h = '<table class="grid"><thead><tr><th>行</th>' + r.inCols.map(function (n) { return '<th>' + U.escapeHtml(n) + '</th>'; }).join('') +
        '<th>|</th>' + r.outCols.map(function (n) { return '<th>' + U.escapeHtml(n) + ' 期望</th><th>' + U.escapeHtml(n) + ' 实际</th>'; }).join('') + '<th>结果</th></tr></thead><tbody>';
      h += r.rows.map(function (row) {
        return '<tr><td>' + row.line + '</td>' + row.in.map(function (v) { return '<td>' + U.escapeHtml(v) + '</td>'; }).join('') + '<td></td>' +
          r.outCols.map(function (n, k) {
            var ok = String(row.expected[k]).toLowerCase() === String(row.actual[k]) || /^[x?]$/i.test(row.expected[k] || '');
            return '<td>' + U.escapeHtml(row.expected[k]) + '</td><td class="' + (ok ? 'hi' : 'bad') + '">' + row.actual[k] + '</td>';
          }).join('') + '<td>' + (row.pass ? '<b style="color:#16a34a">✓</b>' : '<b style="color:#dc2626">✕</b>') + '</td></tr>';
      }).join('') + '</tbody></table>';
      host.innerHTML = h;
      $('#test-summary').innerHTML = '<b style="color:' + (r.passed === r.total ? '#16a34a' : '#dc2626') + '">' + r.passed + ' / ' + r.total + ' 通过</b>';
      (r.errors || []).forEach(function (e) { App.log('warn', e); });
      this.log(r.passed === r.total ? 'ok' : 'err', '测试用例：' + r.passed + '/' + r.total + ' 通过');
      this.switchTab('tests');
      this.status('测试完成：' + r.passed + '/' + r.total + ' 通过');
    },
    genTests: function () {
      var ins = A.inputNames(this.circuit), outs = A.outputNames(this.circuit);
      if (!ins.length || !outs.length) { this.log('warn', '需要至少一个输入和一个输出元件'); return; }
      var lines = [ins.join(' ') + ' | ' + outs.join(' ')];
      var n = Math.min(4, Math.pow(2, ins.length));
      for (var i = 0; i < n; i++) lines.push(ins.map(function (_, k) { return (i >> k) & 1; }).join(' ') + ' | ' + outs.map(function () { return 'x'; }).join(' '));
      $('#test-editor').value = lines.join('\n');
      this.circuit.testText = lines.join('\n');
      this.status('已生成测试模板，请填入期望输出');
    },

    /* ---------- HDL 对话框 ---------- */
    openHDL: function (lang) {
      var self = this, lg = lang || 'verilog';
      var body = '<div class="hdl-tabs"><button data-act="hdl-lang" data-val="verilog" class="' + (lg === 'verilog' ? 'active' : '') + '">Verilog</button>' +
        '<button data-act="hdl-lang" data-val="vhdl" class="' + (lg === 'vhdl' ? 'active' : '') + '">VHDL</button>' +
        '<span style="margin-left:auto;color:#94a3b8;font-size:11px;align-self:center">整张原理图 → 可综合 HDL 网表</span></div>' +
        '<textarea id="hdl-code" class="code-area" spellcheck="false" readonly></textarea><div id="hdl-warn"></div>';
      var foot = '<span class="left" id="hdl-info"></span>' +
        '<button data-act="new-hdl-comp">＋ 编写 HDL 元件</button>' +
        '<button data-act="import-hdl">导入 HDL 文件</button>' +
        '<button data-act="copy-hdl">复制</button>' +
        '<button class="primary" data-act="download-hdl">下载源码</button>';
      var m = this.modal({
        title: 'Verilog / VHDL 导出与导入', body: body, foot: foot,
        onMount: function (mm) { self.renderHDLCode(mm, lg); }
      });
    },
    renderHDLCode: function (mask, lang) {
      var r = H.exportHDL(this.circuit, lang);
      var ta = mask.querySelector('#hdl-code'); if (ta) ta.value = r.code;
      var w = mask.querySelector('#hdl-warn');
      if (w) w.innerHTML = r.warnings.length ? '<div class="err-box">' + r.warnings.map(U.escapeHtml).join('<br>') + '</div>' : '<div class="ok-box">导出完成，未发现问题。</div>';
      var i = mask.querySelector('#hdl-info');
      if (i) i.textContent = '模块 ' + r.module + ' · ' + r.ports.length + ' 个端口 · ' + r.code.split('\n').length + ' 行';
      mask.querySelectorAll('.hdl-tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.val === lang); });
      this._hdlLang = lang;
    },
    openHDLEditor: function (comp, draft) {
      var self = this;
      var cur = comp && comp.props ? comp.props : null;
      var code = draft ? draft.code : (cur ? cur.code : [
        '// 用 Verilog 描述一个自定义元件，编译后可放置到原理图中并直接参与仿真',
        'module my_module (',
        '    input  [3:0] a,',
        '    input  [3:0] b,',
        '    input        sel,',
        '    output [3:0] y',
        ');',
        '  assign y = sel ? (a + b) : (a ^ b);',
        'endmodule'
      ].join('\n'));
      var body = '<div class="form-row"><label>模块名</label><input id="hdl-name" value="' + U.escapeHtml(draft ? draft.name : (cur ? cur.name : 'my_module')) + '"></div>' +
        '<div class="form-row"><label>语言</label><select id="hdl-lang-sel"><option value="verilog" ' + (draft ? draft.lang === 'verilog' : (!cur || cur.lang === 'verilog') ? 'selected' : '') + '>Verilog</option>' +
        '<option value="vhdl" ' + (draft ? draft.lang === 'vhdl' : (cur && cur.lang === 'vhdl') ? 'selected' : '') + '>VHDL</option></select>' +
        '<button data-act="hdl-example" data-val="verilog">Verilog 示例</button><button data-act="hdl-example" data-val="vhdl">VHDL 示例</button>' +
        '<button data-act="hdl-example" data-val="rom">ROM $readmemh</button></div>' +
        '<textarea id="hdl-src" class="code-area" spellcheck="false">' + U.escapeHtml(code) + '</textarea>' +
        '<div id="hdl-compile-result"></div>';
      var foot = '<span class="left">支持 assign / always / case / process / $readmemh 等常用语法</span>' +
        '<button data-act="hdl-data-files">📁 数据文件…</button>' +
        '<button data-act="hdl-check">✓ 编译检查</button>' +
        (comp ? '<button class="primary" data-act="hdl-update">应用到元件</button>' : '<button class="primary" data-act="hdl-create">编译并放置元件</button>') +
        (comp ? '' : '<button data-act="hdl-save-module">仅保存到元件库</button>');
      this._hdlEditComp = comp || null;
      this.modal({
        title: comp ? '编辑 HDL 元件：' + (cur.name || '') : '新建 HDL 自定义元件', body: body, foot: foot,
        onMount: function (mm) { self._hdlMask = mm; }
      });
    },
    hdlExample: function (lang) {
      var v = [
        'module seq_detect (',
        '    input clk,',
        '    input rst,',
        '    input  [3:0] d,',
        '    output reg [3:0] q,',
        '    output hit',
        ');',
        '  always @(posedge clk or posedge rst) begin',
        '    if (rst) q <= 4\'d0;',
        '    else      q <= q + 4\'d1;',
        '  end',
        '  assign hit = (q == d);',
        'endmodule'
      ].join('\n');
      var h = [
        'library IEEE;', 'use IEEE.STD_LOGIC_1164.ALL;', 'use IEEE.NUMERIC_STD.ALL;',
        'entity fsm_lite is', '  port ( clk, rst : in  std_logic;', '         d       : in  std_logic_vector(3 downto 0);',
        '         q       : out std_logic_vector(3 downto 0);', '         hit     : out std_logic );',
        'end fsm_lite;', 'architecture rtl of fsm_lite is', '  signal cnt : std_logic_vector(3 downto 0);', 'begin',
        '  process(clk, rst)', '  begin', "    if rst = '1' then", "      cnt <= (others => '0');",
        '    elsif rising_edge(clk) then', '      cnt <= std_logic_vector(unsigned(cnt) + 1);',
        '    end if;', '  end process;', '  q <= cnt;', "  hit <= '1' when cnt = d else '0';", 'end rtl;'
      ].join('\n');
      var rom = [
        '// 16×8 ROM：从本地数据文件 firmware.hex 装入',
        'module rom16 (',
        '    input  [3:0] addr,',
        '    output [7:0] dout',
        ');',
        '  reg [7:0] mem [0:15];',
        '  initial $readmemh("firmware.hex", mem);',
        '  assign dout = mem[addr];',
        'endmodule'
      ].join('\n');
      if (lang === 'rom' && !H.resolveDataFile(this.circuit.dataFiles || {}, 'firmware.hex')) {
        this.pushUndo();
        this.circuit.dataFiles = this.circuit.dataFiles || {};
        this.circuit.dataFiles['firmware.hex'] = '// 16 个 8 位数据\n0A 14 1E 28 32 3C 46 50\n5A 64 6E 78 82 8C 96 A0';
        this.log('ok', '已自动附加示例数据文件 firmware.hex（内容嵌入当前电路）');
      }
      var mm = this._modal;
      mm.querySelector('#hdl-src').value = lang === 'vhdl' ? h : (lang === 'rom' ? rom : v);
      mm.querySelector('#hdl-lang-sel').value = lang === 'vhdl' ? 'vhdl' : 'verilog';
      mm.querySelector('#hdl-name').value = lang === 'vhdl' ? 'fsm_lite' : (lang === 'rom' ? 'rom16' : 'seq_detect');
    },
    hdlCompile: function (mm) {
      var code = mm.querySelector('#hdl-src').value, lang = mm.querySelector('#hdl-lang-sel').value;
      try {
        var mod = H.compile(code, lang);
        var miss = this.memFileWarnings(mod);
        mm.querySelector('#hdl-compile-result').innerHTML = '<div class="ok-box">编译成功：模块 <b>' + U.escapeHtml(mod.name) + '</b>，端口 ' +
          mod.ports.map(function (p) { return U.escapeHtml(p.name + '[' + p.dir + ',' + p.bits + 'b]'); }).join('、') + '</div>' +
          (miss.length ? '<div class="err-box">该模块引用了尚未附加的数据文件：<b>' + U.escapeHtml(miss.join('、')) + '</b>。' +
            '点 <button data-act="hdl-data-files">附加数据文件…</button> 选择本地 .hex 文件；未附加时存储器全为 0。</div>' : '') +
          ((mod.memFiles || []).length && !miss.length ? '<div class="ok-box">存储器数据文件已就绪：' + U.escapeHtml(mod.memFiles.join('、')) + '</div>' : '');
        return mod;
      } catch (e) {
        mm.querySelector('#hdl-compile-result').innerHTML = '<div class="err-box">' + U.escapeHtml(e.message) + '</div>';
        return null;
      }
    },
    hdlApply: function (mode) {
      var mm = this._modal;
      if (!mm) return;
      var mod = this.hdlCompile(mm);
      if (!mod) return;
      var miss = this.memFileWarnings(mod);
      if (miss.length) this.log('warn', 'HDL 模块 ' + mod.name + ' 缺少数据文件：' + miss.join('、') + '（请在「数据文件」中附加）');
      var code = mm.querySelector('#hdl-src').value;
      var props = { name: mod.name, lang: mod.lang, code: code, hdlPorts: mod.ports, hdlIR: mod.ir };
      var comp = this._hdlEditComp;
      if (mode === 'update' && comp && this.circuit.components.indexOf(comp) >= 0) {
        this.pushUndo();
        comp.props = Object.assign({}, comp.props, props);
        this.rebuild(); this.showProps();
        this.closeModal(); this.status('HDL 元件已更新');
        this.log('ok', 'HDL 元件 ' + mod.name + ' 已更新并重新编译');
        return;
      }
      this.circuit.hdlModules = this.circuit.hdlModules || [];
      var exist = this.circuit.hdlModules.filter(function (m) { return m.name === mod.name && m.lang === mod.lang; })[0];
      if (exist) { exist.code = code; exist.ports = mod.ports; } else this.circuit.hdlModules.push({ name: mod.name, lang: mod.lang, code: code, ports: mod.ports });
      this.buildHDLList(); this.showCircuitInfo();
      this.closeModal();
      if (mode === 'create') {
        this.ui.mode = 'place'; this.ui.placeType = 'hdl'; this.ui.placeProps = props;
        $('#place-badge').textContent = '放置中：HDL 元件 ' + mod.name + ' · Esc 取消';
        $('#place-badge').classList.remove('hidden');
        this.status('在画布上单击放置 HDL 元件「' + mod.name + '」');
        this.repaint();
      }
      this.log('ok', 'HDL 模块 ' + mod.name + ' 编译成功，已加入元件库');
    },
    openImportHDL: function () {
      var self = this;
      var body = '<div class="drop-zone">从本地选择 .v / .sv / .vhd / .vhdl 文件，或直接把源码粘贴到下方</div>' +
        '<div class="form-row"><label>选择文件</label><button data-act="pick-hdl-file" style="flex:1">浏览…</button></div>' +
        '<div class="form-row"><label>语言</label><select id="imp-lang"><option value="auto">自动识别</option><option value="verilog">Verilog</option><option value="vhdl">VHDL</option></select></div>' +
        '<div class="form-row"><label>导入方式</label><select id="imp-mode"><option value="component">作为 HDL 元件（行为级仿真）</option><option value="gates">展开为门级原理图</option></select></div>' +
        '<textarea id="imp-code" class="code-area" style="height:220px" spellcheck="false" placeholder="module top(input a, input b, output y);&#10;  assign y = a &amp; ~b;&#10;endmodule"></textarea>' +
        '<div id="imp-result"></div>';
      this.modal({
        title: '导入 Verilog / VHDL 文件', body: body,
        foot: '<span class="left">「展开为门级」会把 assign / 门原语 / 简单时序块还原为可编辑原理图</span><button data-act="close-modal">取消</button><button class="primary" data-act="do-import-hdl">导入</button>'
      });
    },
    doImportHDL: function () {
      var mm = this._modal, code = mm.querySelector('#imp-code').value.trim();
      if (!code) { mm.querySelector('#imp-result').innerHTML = '<div class="err-box">请先粘贴源码或选择文件</div>'; return; }
      var lang = mm.querySelector('#imp-lang').value, mode = mm.querySelector('#imp-mode').value;
      try {
        var mod = H.compile(code, lang);
        var miss = this.memFileWarnings(mod);
        if (miss.length) { this._dfPending = miss.slice(); this.log('warn', '导入的模块需要数据文件：' + miss.join('、') + '，请到「文件 → 数据文件」附加'); }
        if (mode === 'gates') {
          if (miss.length) this.log('warn', '展开为门级原理图不会保留 $readmemh 行为，请改用「作为 HDL 元件」导入');
          var g = H.importGates(mod, code);
          this.closeModal();
          this.loadCircuit(g.circuit);
          (g.warnings || []).forEach(function (w) { App.log('warn', 'HDL 展开：' + w); });
          this.log('ok', '已将 ' + mod.name + ' 展开为门级原理图（' + this.circuit.components.length + ' 个对象）');
        } else {
          this.circuit.hdlModules = this.circuit.hdlModules || [];
          this.circuit.hdlModules.push({ name: mod.name, lang: mod.lang, code: code, ports: mod.ports });
          this.buildHDLList(); this.showCircuitInfo(); this.closeModal();
          this.ui.mode = 'place'; this.ui.placeType = 'hdl';
          this.ui.placeProps = { name: mod.name, lang: mod.lang, code: code, hdlPorts: mod.ports, hdlIR: mod.ir };
          $('#place-badge').textContent = '放置中：HDL 元件 ' + mod.name;
          $('#place-badge').classList.remove('hidden');
          this.repaint();
          this.log('ok', 'HDL 模块 ' + mod.name + ' 已导入，在画布上单击放置');
        }
      } catch (e) {
        mm.querySelector('#imp-result').innerHTML = '<div class="err-box">' + U.escapeHtml(e.message) + '</div>';
        this.log('err', 'HDL 导入失败：' + e.message);
      }
    },

    /* ---------- 示例 / 帮助 ---------- */
    openExamples: function () {
      var self = this;
      var cats = {};
      DIG.Examples.list.forEach(function (e) { (cats[e.cat] = cats[e.cat] || []).push(e); });
      var body = Object.keys(cats).map(function (cat) {
        return '<h4 style="margin:12px 0 6px;font-size:12px;color:#2563eb">' + U.escapeHtml(cat) + '</h4><div class="ex-grid">' +
          cats[cat].map(function (e) { return '<div class="ex-card" data-ex="' + e.id + '"><span class="cat">' + U.escapeHtml(cat) + '</span><b>' + U.escapeHtml(e.name) + '</b><p>' + U.escapeHtml((e.make().description || '').slice(0, 66)) + '</p></div>'; }).join('') + '</div>';
      }).join('');
      this.modal({
        title: '内置示例电路', body: body,
        foot: '<span class="left">载入示例会覆盖当前电路（可用 Ctrl+Z 撤销）</span><button data-act="close-modal">关闭</button>',
        onMount: function (mm) {
          mm.querySelectorAll('[data-ex]').forEach(function (el) {
            el.onclick = function () {
              var e = DIG.Examples.list.filter(function (x) { return x.id === el.dataset.ex; })[0];
              self.closeModal(); self.loadCircuit(e.make());
            };
          });
        }
      });
    },
    openHelp: function () {
      var body = '<div class="help">' +
        '<h4>它是什么</h4><p>Digital.js 是 hneemann/Digital 的网页版实现：事件驱动的数字电路仿真器，带原理图编辑器、真值表分析、测试用例，以及 Verilog / VHDL 双向支持。纯前端、无需安装、可离线运行。</p>' +
        '<h4>仿真模型</h4><ul>' +
        '<li><b>上电</b>：随机门延迟逐门更新直到稳定，让 RS 锁存器等反馈电路进入确定态（与 Digital 的 "switch on" 一致）。</li>' +
        '<li><b>运行</b>：同步轮次更新（所有门同时读输入、同时写输出），可检测振荡并停止。</li>' +
        '<li><b>单门步进</b>：一次只更新一个门并高亮，用于定位振荡源。</li>' +
        '<li>支持三态高阻 Z、总线冲突检测、1–32 位总线、上电复位元件。</li></ul>' +
        '<h4>编辑</h4><p>左侧选元件 → 画布单击放置；从引脚拖到另一引脚连线；单击添加拐点，Tab 切换拐向，双击 / Enter 结束，Esc 取消。滚轮缩放，中键或空格+拖拽平移。</p>' +
        '<h4>总线分割（分线器 / 合线器）</h4><ul>' +
        '<li>元件面板提供<b>拆分 / 合并 / 任意分割</b>三种预设；属性面板可分别编辑「输入分割」与「输出分割」，输入引脚 <code>i0…</code> 按输入分割拼成内部总线，输出引脚 <code>o0…</code> 按输出分割取位。</li>' +
        '<li><code>4,2,2</code> = 3 段（宽 4/2/2 位）；<code>1*16</code> = 16 个 1 位段（位宽*个数）；<code>4-7,0-3</code> = 直接指定所用的总线位，段顺序任意，<code>7-4</code> 为反序；三种写法可混合，最多 32 位。</li>' +
        '<li><b>输入分割必须完整且唯一</b>覆盖 0..N-1 每一位，否则属性面板会指出重复 / 遗漏的位；<b>输出分割可以重复使用位</b>，如 <code>0-7,1-6,4-7</code>。</li>' +
        '<li>总线位宽由输入分割自动推导；「总线位宽」属性作为下限，修改时会同步默认形态的分割规格。旧版 bus + b0…bN 电路仍可正常打开与仿真。</li></ul>' +
        '<h4>快捷键</h4><p><span class="kbd">Del</span>删除 <span class="kbd">R</span>旋转 <span class="kbd">Ctrl+Z/Y</span>撤销重做 <span class="kbd">Ctrl+C/V/D</span>复制粘贴复制 <span class="kbd">Ctrl+A</span>全选 <span class="kbd">Ctrl+S</span>保存 <span class="kbd">Ctrl+Shift+S</span>另存为 <span class="kbd">F</span>适配 <span class="kbd">F2</span>编辑属性 <span class="kbd">+/-</span>缩放</p>' +
        '<h4>HDL 支持范围</h4><ul>' +
        '<li><b>导出</b>：整图导出为可综合的 Verilog / VHDL 结构网表；门、多路器、译码器、加法器、比较器、移位器、触发器、寄存器、计数器、RAM/ROM、74xx、HDL 元件均覆盖。</li>' +
        '<li><b>自定义元件</b>：编写 Verilog / VHDL 模块，编译成带端口的元件放到画布上，由内置 HDL 引擎直接仿真，无需 GHDL / Icarus。</li>' +
        '<li><b>导入</b>：可导入为行为级 HDL 元件，或把连续赋值 / 门原语 / 简单时序块展开为可编辑的门级原理图。</li>' +
        '<li>Verilog 子集：ANSI/非 ANSI 端口、wire/reg/parameter、assign、always @(*) / @(posedge/negedge)、if/else、case、阻塞/非阻塞赋值、位选与拼接、常用运算符。</li>' +
        '<li>VHDL 子集：entity / architecture、port / signal / std_logic(_vector)、并发赋值、when-else、with-select、process、rising_edge、if/case、and/or/xor/not、算术与比较。</li>' +
        '<li>HDL 中的 <code>clock</code> 元件导出为输入时钟端口；<code>reset</code> 导出为固定电平；多语言混合时源码作为注释附在文末，需单独编译。</li></ul>' +
        '<h4>Verilog 读取本地存储器文件</h4><ul>' +
        '<li>标准写法 <code>initial $readmemh("firmware.hex", mem);</code>，配套声明 <code>reg [7:0] mem [0:255];</code>，用 <code>mem[addr]</code> 读、<code>mem[addr] &lt;= data;</code> 写。</li>' +
        '<li>支持 <code>$readmemh</code>（十六进制）、<code>$readmemb</code>（二进制），并兼容别名 <code>$memreadh</code> / <code>$memreadb</code>；也支持 <code>initial begin … end</code> 与可选的起止地址参数。</li>' +
        '<li>数据文件内容支持空白/逗号分隔、<code>//</code> 与 <code>/* */</code> 注释、<code>@8</code> 指定装入地址、<code>x/z/?</code> 未知位（按 0 处理）。</li>' +
        '<li>浏览器不能静默读取任意本地文件，因此请点工具栏「<b>数据文件</b>」把 .hex/.mem 文件<b>附加一次</b>（可拖入、多选或粘贴文本）；内容会嵌入电路 JSON，随「保存 / 另存为」一起带走，之后离线打开仍可仿真。文件名与 HDL 中的字符串一致即可，也允许带路径。</li>' +
        '<li>导出 Verilog 网表时会把数据文件内容作为注释附在文末，便于在 Icarus/Verilator 等工具中另存为同名文件。</li></ul>' +
        '<h4>分析与测试</h4><p>真值表由电路自动推导，用 Quine–McCluskey 算法最小化，可一键由表达式生成门级电路。测试用例首行用 <code>|</code> 分隔输入名与输出名，支持 <code>x</code> 通配符和 0x/0b 数值。</p>' +
        '</div>';
      this.modal({ title: '帮助 · 功能与快捷键', body: body, foot: '<button data-act="close-modal">关闭</button>' });
    },

    /* ---------- 文件 ---------- */
    saveStats: function () {
      var c = this.circuit;
      return [
        c.components.length + ' 元件', c.wires.length + ' 导线',
        (c.hdlModules || []).length + ' HDL 模块',
        Object.keys(c.dataFiles || {}).length + ' 数据文件',
        (c.testText || '').split('\n').filter(function (l) { return l.trim(); }).length + ' 行测试'
      ].join(' · ');
    },
    saveFile: function () {
      this.circuit.testText = $('#test-editor').value;
      this.circuit.dataFiles = this.circuit.dataFiles || {};
      U.download((this.circuit.name || 'circuit').replace(/[^\w\u4e00-\u9fa5-]/g, '_') + '.json', JSON.stringify(this.circuit, null, 2), 'application/json;charset=utf-8');
      this.status('已保存电路文件');
    },
    saveAs: function () {
      var c = this.circuit;
      var base = (c.name || 'circuit').replace(/[^\w\u4e00-\u9fa5-]/g, '_');
      var body =
        '<div class="form-row"><label>文件名</label><input id="sa-file" value="' + U.escapeHtml(base + '.json') + '" spellcheck="false" autocomplete="off"></div>' +
        '<div class="form-row"><label>电路名称</label><input id="sa-name" value="' + U.escapeHtml(c.name || '') + '" spellcheck="false"></div>' +
        '<label class="chk" style="margin:2px 0 10px"><input type="checkbox" id="sa-rename"> 同时把当前编辑中的电路改成这个名称</label>' +
        '<div class="prop-note">文件将保存到浏览器下载目录。元件、导线、HDL 模块源码、测试用例和 <b>$readmemh 数据文件</b>都会一并写入 JSON，可离线重新打开。</div>' +
        '<div class="prop-note" style="margin-top:6px">当前电路内容：' + U.escapeHtml(this.saveStats()) + '</div>' +
        '<div id="sa-result"></div>';
      this.modal({
        title: '另存为…', small: true, body: body,
        foot: '<button data-act="close-modal">取消</button><button class="primary" data-act="do-save-as">保存文件</button>',
        onMount: function (mm) {
          var f = mm.querySelector('#sa-file');
          f.focus();
          // 只选中主文件名，方便直接改名而保留 .json 后缀
          try { f.setSelectionRange(0, base.length); } catch (e) { }
          f.addEventListener('keydown', function (e) { if (e.key === 'Enter') App.doSaveAs(); });
          mm.querySelector('#sa-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') App.doSaveAs(); });
        }
      });
    },
    doSaveAs: function () {
      var mm = this._modal; if (!mm) return;
      var fn = (mm.querySelector('#sa-file').value || '').trim();
      var nm = (mm.querySelector('#sa-name').value || '').trim();
      var ren = mm.querySelector('#sa-rename').checked;
      if (!fn) { mm.querySelector('#sa-result').innerHTML = '<div class="err-box">请输入文件名</div>'; return; }
      fn = fn.replace(/[\\/:*?"<>|]/g, '_');
      if (!/\.json$/i.test(fn)) fn += '.json';
      var data = U.clone(this.circuit);
      data.testText = $('#test-editor').value;
      data.dataFiles = data.dataFiles || {};
      data.hdlModules = data.hdlModules || [];
      if (nm) data.name = nm;
      U.download(fn, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
      if (ren && nm && nm !== this.circuit.name) {
        this.pushUndo();
        this.circuit.name = nm;
        this.showProps(); this.showCircuitInfo();
      }
      this.closeModal();
      this.status('已另存为 ' + fn);
      this.log('ok', '已另存为 ' + fn + '（' + this.saveStats() + '）');
    },
    openFile: function () { $('#file-input').click(); },

    /* ---------- 存储器数据文件（$readmemh / $readmemb） ---------- */
    dataFileRefs: function () {
      var refs = {};
      (this.circuit.components || []).forEach(function (c) {
        if (c.type === 'hdl' && c.props && c.props.code) H.memFileRefs(c.props.code).forEach(function (f) { refs[f] = (refs[f] || 0) + 1; });
      });
      (this.circuit.hdlModules || []).forEach(function (m) {
        H.memFileRefs(m.code).forEach(function (f) { refs[f] = (refs[f] || 0) + 1; });
      });
      return refs;
    },
    memFileWarnings: function (mod) {
      var files = this.circuit.dataFiles || {};
      return (mod && mod.memFiles || []).filter(function (f) { return H.resolveDataFile(files, f) === null; });
    },
    openDataFiles: function (fromHDL) {
      var self = this;
      var body =
        '<div class="drop-zone" id="df-drop">把本地 <b>.hex / .mem</b> 文件拖到这里，或点击下方按钮选择（可多选、可带路径名）' +
        '<div style="margin-top:9px"><button data-act="pick-data-files" class="primary">📂 选择本地文件…</button></div></div>' +
        '<div class="prop-note">在 Verilog 模块中写 <code>initial $readmemh("firmware.hex", mem);</code>，' +
        '本工具会按<b>文件名</b>在此查找数据（也支持 <code>$readmemb</code> / <code>$memreadh</code> / <code>$memreadb</code>）。' +
        '文件内容会<b>嵌入电路 JSON</b>，保存 / 另存为后随电路一起走，重新打开仍可离线仿真，不会上传到任何服务器。</div>' +
        '<div class="form-row" style="margin-top:10px"><label>或粘贴文本</label><input id="df-name" placeholder="文件名，例如 firmware.hex" spellcheck="false"></div>' +
        '<textarea id="df-text" class="code-area" style="height:80px" spellcheck="false" placeholder="0A 14 1E 28&#10;@8 55 AA"></textarea>' +
        '<div style="margin:4px 0 12px"><button data-act="data-file-add-text">＋ 添加为数据文件</button></div>' +
        '<div id="df-result"></div><div id="df-list"></div>';
      this.modal({
        title: '存储器数据文件 · $readmemh / $readmemb',
        body: body,
        foot: (fromHDL ? '<button data-act="back-to-hdl">← 返回 HDL 编辑器</button>' : '') +
          '<span class="left">支持 16/2 进制数值、// 与 /* */ 注释、@地址、x/z 未知位</span>' +
          '<button data-act="close-modal">关闭</button>',
        onMount: function (mm) {
          self._dfMask = mm;
          self.refreshDataFiles();
          var dz = mm.querySelector('#df-drop');
          dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.style.borderColor = '#2563eb'; });
          dz.addEventListener('dragleave', function () { dz.style.borderColor = ''; });
          dz.addEventListener('drop', function (e) {
            e.preventDefault(); dz.style.borderColor = '';
            self.addLocalDataFiles(e.dataTransfer && e.dataTransfer.files);
          });
        }
      });
    },
    refreshDataFiles: function () {
      var mm = this._dfMask;
      if (!mm || !mm.isConnected) return;
      var files = this.circuit.dataFiles = this.circuit.dataFiles || {};
      var keys = Object.keys(files).sort(), refs = this.dataFileRefs();
      var html = '<div class="prop-title" style="margin:12px 0 6px">已附加 ' + keys.length + ' 个数据文件</div>';
      if (!keys.length) html += '<div class="prop-note">尚未附加任何数据文件。</div>';
      else {
        html += '<table class="df-table">' + keys.map(function (k) {
          var text = '' + files[k];
          var used = H.resolveDataFile(files, k) !== null &&
            Object.keys(refs).some(function (r) { return H.resolveDataFile(files, r) !== null && (r === k || r.replace(/\\/g, '/').split('/').pop().toLowerCase() === k.toLowerCase()); });
          return '<tr><td><b>' + U.escapeHtml(k) + '</b><div class="df-prev">' + U.escapeHtml(text.replace(/\s+/g, ' ').slice(0, 52)) + '</div></td>' +
            '<td class="df-meta">' + text.length + ' 字符<br>' + (used ? '<span style="color:var(--green)">已被 HDL 引用</span>' : '<span style="color:var(--muted)">未引用</span>') + '</td>' +
            '<td class="df-ops"><button data-act="data-file-download" data-val="' + U.escapeHtml(k) + '">下载</button> ' +
            '<button data-act="data-file-remove" data-val="' + U.escapeHtml(k) + '">删除</button></td></tr>';
        }).join('') + '</table>';
      }
      var missing = Object.keys(refs).filter(function (r) { return H.resolveDataFile(files, r) === null; });
      (this._dfPending || []).forEach(function (n) { if (missing.indexOf(n) < 0 && H.resolveDataFile(files, n) === null) missing.push(n); });
      if (missing.length) html += '<div class="err-box">HDL 源码引用了尚未附加的数据文件：<b>' + U.escapeHtml(missing.join('、')) +
        '</b><br>请点「选择本地文件」选中同名文件，或用上方文本框粘贴内容。未附加时对应存储器全为 0。</div>';
      mm.querySelector('#df-list').innerHTML = html;
    },
    addLocalDataFiles: function (list) {
      var self = this, arr = Array.prototype.slice.call(list || []);
      if (!arr.length) return;
      var left = arr.length, added = [];
      arr.forEach(function (f) {
        var rd = new FileReader();
        rd.onload = function () {
          self.circuit.dataFiles = self.circuit.dataFiles || {};
          self.circuit.dataFiles[f.name] = rd.result;
          added.push(f.name);
          if (--left === 0) self.finishDataFiles(added);
        };
        rd.onerror = function () { if (--left === 0) self.finishDataFiles(added); };
        rd.readAsText(f);
      });
    },
    finishDataFiles: function (names) {
      if (!names.length) return;
      this._dfPending = [];
      this.rebuild();                       // 重新建立仿真状态，让存储器重新装入数据
      this.refreshDataFiles(); this.showCircuitInfo();
      var mm = this._dfMask;
      if (mm && mm.querySelector('#df-result')) mm.querySelector('#df-result').innerHTML =
        '<div class="ok-box">已附加：' + U.escapeHtml(names.join('、')) + '。上电后 HDL 元件会重新装入。</div>';
      this.status('已附加 ' + names.length + ' 个数据文件');
      this.log('ok', '已附加数据文件：' + names.join('、') + '（内容已嵌入电路，可用「另存为」保存）');
    },
    addDataFileText: function (mm) {
      if (!mm) return;
      var nm = (mm.querySelector('#df-name').value || '').trim();
      var text = mm.querySelector('#df-text').value;
      var box = mm.querySelector('#df-result');
      if (!nm) { box.innerHTML = '<div class="err-box">请填写文件名（要与 HDL 中 $readmemh 的字符串一致）</div>'; return; }
      if (!text.trim()) { box.innerHTML = '<div class="err-box">请粘贴或输入数据内容</div>'; return; }
      this.circuit.dataFiles = this.circuit.dataFiles || {};
      this.circuit.dataFiles[nm] = text;
      mm.querySelector('#df-text').value = '';
      this.finishDataFiles([nm]);
    },
    removeDataFile: function (name) {
      if (!this.circuit.dataFiles || !Object.prototype.hasOwnProperty.call(this.circuit.dataFiles, name)) return;
      this.pushUndo();
      delete this.circuit.dataFiles[name];
      this.rebuild(); this.refreshDataFiles(); this.showCircuitInfo();
      this.log('warn', '已移除数据文件：' + name);
    },
    downloadDataFile: function (name) {
      var t = (this.circuit.dataFiles || {})[name];
      if (t == null) return;
      U.download(name, t, 'text/plain;charset=utf-8');
    },
    hdlDataFiles: function () {
      var mm = this._modal;
      this._hdlDraft = mm && mm.querySelector('#hdl-src') ? {
        code: mm.querySelector('#hdl-src').value,
        lang: mm.querySelector('#hdl-lang-sel').value,
        name: mm.querySelector('#hdl-name').value,
        comp: this._hdlEditComp
      } : null;
      this.openDataFiles(true);
    },
    hdlMenu: function (btn) {
      var r = btn.getBoundingClientRect();
      this.menu(r.left, r.bottom + 4, [
        { label: '⌨ 查看 / 导出 Verilog', act: 'open-hdl-verilog' },
        { label: '⌨ 查看 / 导出 VHDL', act: 'open-hdl-vhdl' },
        { sep: true },
        { label: '↓ 直接下载 .v', act: 'export-verilog' },
        { label: '↓ 直接下载 .vhd', act: 'export-vhdl' },
        { sep: true },
        { label: '＋ 编写 HDL 自定义元件', act: 'new-hdl-comp' },
        { label: '📁 存储器数据文件 ($readmemh)…', act: 'data-files' },
        { label: '📥 导入 HDL 文件…', act: 'import-hdl' }
      ]);
    },
    exportMenu: function (btn) {
      var r = btn.getBoundingClientRect();
      this.menu(r.left, r.bottom + 4, [
        { label: '💾 电路文件 (.json)', act: 'save' },
        { label: '💾 另存为… (Ctrl+Shift+S)', act: 'save-as' },
        { label: '📁 存储器数据文件…', act: 'data-files' },
        { label: '🖼 原理图 (.svg)', act: 'export-svg' },
        { label: '🖼 画布快照 (.png)', act: 'export-png' },
        { sep: true },
        { label: '⌨ Verilog (.v)', act: 'export-verilog' },
        { label: '⌨ VHDL (.vhd)', act: 'export-vhdl' },
        { sep: true },
        { label: '📥 导入 HDL 文件…', act: 'import-hdl' }
      ]);
    },

    /* ---------- 动作分发 ---------- */
    doAction: function (act, val, ev, mask) {
      var self = this;
      switch (act) {
        case 'new':
          if (this.circuit.components.length && !confirm('新建空白电路？当前电路可用 Ctrl+Z 撤销恢复。')) return;
          this.loadCircuit({ name: '未命名电路', components: [], wires: [] }); this.status('已新建空白电路'); break;
        case 'open': this.openFile(); break;
        case 'save': this.saveFile(); break;
        case 'save-as': this.saveAs(); break;
        case 'do-save-as': this.doSaveAs(); break;
        case 'data-files': this.openDataFiles(false); break;
        case 'pick-data-files': $('#data-file-input').click(); break;
        case 'data-file-remove': this.removeDataFile(val); break;
        case 'data-file-download': this.downloadDataFile(val); break;
        case 'data-file-add-text': this.addDataFileText(this._modal); break;
        case 'hdl-data-files': this.hdlDataFiles(); break;
        case 'back-to-hdl': {
          var d = this._hdlDraft; this.closeModal();
          this.openHDLEditor(d && d.comp || null, d);
          break;
        }
        case 'export-menu': this.exportMenu($('#toolbar [data-act="export-menu"]')); break;
        case 'export-svg': U.download((this.circuit.name || 'circuit') + '.svg', R.toSVG(this.circuit, this.sim), 'image/svg+xml;charset=utf-8'); this.log('ok', '已导出 SVG'); break;
        case 'export-png': {
          var a = document.createElement('a'); a.download = (this.circuit.name || 'circuit') + '.png'; a.href = this.canvas.toDataURL('image/png'); a.click();
          this.log('ok', '已导出 PNG 快照'); break;
        }
        case 'export-verilog': {
          var r1 = H.exportHDL(this.circuit, 'verilog');
          U.download(r1.module + '.v', r1.code, 'text/plain;charset=utf-8');
          this.log('ok', '已导出 Verilog：' + r1.module + '.v'); break;
        }
        case 'export-vhdl': {
          var r2 = H.exportHDL(this.circuit, 'vhdl');
          U.download(r2.module + '.vhd', r2.code, 'text/plain;charset=utf-8');
          this.log('ok', '已导出 VHDL：' + r2.module + '.vhd'); break;
        }
        case 'undo': this.undo(); break;
        case 'redo': this.redo(); break;
        case 'rotate': ED.rotateSelection(90); break;
        case 'delete': ED.deleteSelection(); break;
        case 'copy': this.ui.clipboard = ED.copy(); this.status('已复制 ' + (this.ui.clipboard ? this.ui.clipboard.comps.length : 0) + ' 个元件'); break;
        case 'paste': ED.paste(this.ui.clipboard, this.ui.cursor[0], this.ui.cursor[1]); break;
        case 'select-all': ED.selectAll(); break;
        case 'fit': ED.fitView(); break;
        case 'power': this.powerToggle(); break;
        case 'gate-step': this.gateStep(); break;
        case 'step': this.step(); break;
        case 'run': this.runToggle(); break;
        case 'truth': this.analyze(); break;
        case 'run-tests': this.runTests(); break;
        case 'gen-tests': this.genTests(); break;
        case 'hdl': this.hdlMenu($('#toolbar [data-act="hdl"]')); break;
        case 'open-hdl-verilog': this.openHDL('verilog'); break;
        case 'open-hdl-vhdl': this.openHDL('vhdl'); break;
        case 'examples': this.openExamples(); break;
        case 'help': this.openHelp(); break;
        case 'edit-hdl': {
          var hid = val || (this.ui.selection.size === 1 ? this.ui.selection.values().next().value : null);
          var hc = this.circuit.components.filter(function (x) { return x.id === hid && x.type === 'hdl'; })[0];
          if (hc) this.openHDLEditor(hc); else this.log('warn', '请先选中一个 HDL 元件');
          break;
        }
        case 'edit-comp': {
          var c = this.circuit.components.filter(function (x) { return x.id === val; })[0];
          if (c) { this.ui.selection = new Set([c.id]); this.showProps(); this.repaint(); }
          break;
        }
        case 'toggle-watch': {
          var id = +val, w = this.sim.watch.slice();
          if (w.indexOf(id) >= 0) w = w.filter(function (x) { return x !== id; }); else w.push(id);
          this.sim.setWatch(w); this.showWatch(); this.showProps(); this.repaint(); break;
        }
        case 'select-only': this.showProps(); break;
        case 'gen-circuit': this.genCircuit(+val); break;
        case 'gen-from-expr': this.quickPrompt('布尔表达式（输入名可用 A,B,C…）', '(A & ~B) | (~A & B)', function (expr) {
          var c = A.circuitFromExpression(expr, ['A', 'B'], 'Y'); self.loadCircuit(c); self.log('ok', '已由表达式生成电路');
        }, '运算符：& 与、| 或、^ 异或、~ 非、括号。生成的电路用网络标签连接。'); break;
        case 'hdl-lang': this.renderHDLCode(this._modal, val); break;
        case 'copy-hdl': {
          var ta = this._modal.querySelector('#hdl-code'); ta.select(); document.execCommand('copy');
          this.status('HDL 源码已复制到剪贴板'); break;
        }
        case 'download-hdl': {
          var lang = this._hdlLang || 'verilog', rr = H.exportHDL(this.circuit, lang);
          U.download(rr.module + (lang === 'vhdl' ? '.vhd' : '.v'), rr.code, 'text/plain;charset=utf-8');
          this.log('ok', 'HDL 源码已下载'); break;
        }
        case 'new-hdl-comp': this.openHDLEditor(null); break;
        case 'import-hdl': this.openImportHDL(); break;
        case 'pick-hdl-file': $('#hdl-file-input').click(); break;
        case 'do-import-hdl': this.doImportHDL(); break;
        case 'hdl-example': this.hdlExample(val); break;
        case 'hdl-check': this.hdlCompile(this._modal); break;
        case 'hdl-update': this.hdlApply('update'); break;
        case 'hdl-create': this.hdlApply('create'); break;
        case 'hdl-save-module': this.hdlApply('save'); break;
        case 'close-modal': this.closeModal(); break;
        default: break;
      }
    },

    /* ---------- UI 事件绑定 ---------- */
    bindUI: function () {
      var self = this;
      document.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-act]');
        if (b) {
          if (!b.closest('#context-menu')) self.closeMenu();
          self.doAction(b.dataset.act, b.dataset.val, ev, self._modal);
        } else if (!ev.target.closest('#context-menu')) self.closeMenu();
      });
      $$('.tab').forEach(function (t) { t.onclick = function () { self.switchTab(t.dataset.tab); }; });
      $('#toggle-bottom').onclick = function () {
        var p = $('#bottom-panel'); p.classList.toggle('collapsed'); self.sizeCanvases(); self.repaint();
      };
      $('#search').addEventListener('input', function () { self.buildPalette(); });
      $('#add-hdl').onclick = function () { self.openHDLEditor(null); };
      $('#watch-clear').onclick = function () { self.sim.setWatch([]); self.showWatch(); self.repaint(); };
      $('#speed').onchange = function () { self.ui.speed = +this.value; self.status('运行速度：' + self.ui.speed + ' tick/s'); };
      $('#show-values').onchange = function () { self.ui.showValues = this.checked; self.repaint(); };
      $('#test-editor').addEventListener('change', function () { self.circuit.testText = this.value; });
      $('#file-input').addEventListener('change', function (e) {
        var f = e.target.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          try { self.loadCircuit(JSON.parse(rd.result)); } catch (err) { self.log('err', '无法打开电路文件：' + err.message); }
        };
        rd.readAsText(f); e.target.value = '';
      });
      $('#hdl-file-input').addEventListener('change', function (e) {
        var f = e.target.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          var ta = self._modal && self._modal.querySelector('#imp-code');
          if (ta) {
            ta.value = rd.result;
            var ext = (f.name.split('.').pop() || '').toLowerCase();
            var sel = self._modal.querySelector('#imp-lang');
            if (ext === 'v' || ext === 'sv') sel.value = 'verilog';
            else if (ext === 'vhd' || ext === 'vhdl') sel.value = 'vhdl';
          }
        };
        rd.readAsText(f); e.target.value = '';
      });
      $('#data-file-input').addEventListener('change', function (e) {
        self.addLocalDataFiles(e.target.files); e.target.value = '';
      });
      window.addEventListener('beforeunload', function () { /* 无需提示，纯本地应用 */ });
    }
  };

  DIG.App = App;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { App.init(); });
    else App.init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
