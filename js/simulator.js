/* Digital.js - 事件驱动仿真内核 */
(function (root) {
  'use strict';
  var DIG = (root.DIG = root.DIG || {});
  var U = DIG.Util, L = DIG.Lib, NL = DIG.Netlist;

  function Simulator(circuit, options) {
    this.circuit = circuit;
    this.options = options || {};
    this.watch = [];
    this.reset();
  }

  Simulator.prototype.reset = function () {
    this.nl = NL.build(this.circuit);
    this.nets = this.nl.nets;
    this.comps = this.nl.comps;
    this.cs = this.comps.map(function (c) {
      var d = L.get(c.type) || L.get('text');
      var st = d.init ? U.clone(d.init(c.props) || {}) : {};
      var out = {};
      L.pinsOf(c).forEach(function (p) { if (p.dir === 'out') out[p.name] = { v: 0, z: U.mask(p.bits) }; });
      return { def: d, st: st, out: out, inp: {} };
    });
    this.values = this.nets.map(function (n) { return { v: 0, z: U.mask(n.bits) }; });
    this.dirty = new Set();
    this.tick = 0;
    this.settling = false;
    this.on = false;
    this.oscillation = false;
    this.errors = [];
    this.history = [];
    this.hashSeen = [];
    this.nets.forEach(function (n) { n.conflict = false; n.floating = n.drivers.length === 0 && n.sinks.length > 0; });
    for (var i = 0; i < this.cs.length; i++) this.dirty.add(i);
  };

  Simulator.prototype.ctx = function () {
    var self = this;
    return {
      settling: this.settling, tick: this.tick,
      error: function (m) { if (self.errors.indexOf(m) < 0) self.errors.push(m); }
    };
  };

  Simulator.prototype.readInputs = function (ci) {
    var c = this.comps[ci], inp = {}, pinNet = this.nl.pinNet;
    L.pinsOf(c).forEach(function (p) {
      if (p.dir === 'out') return;
      var id = pinNet[c.id + '|' + p.name];
      inp[p.name] = id === undefined ? { v: 0, z: U.mask(p.bits) } : this.values[id];
    }, this);
    this.cs[ci].inp = inp;
    return inp;
  };

  Simulator.prototype.evalComp = function (ci) {
    var c = this.comps[ci], cs = this.cs[ci];
    var inp = this.readInputs(ci);
    try {
      var o = cs.def.eval(inp, cs.st, c.props, this.ctx()) || {};
      return o;
    } catch (e) {
      this.ctx().error(c.type + ' (' + (c.props.label || c.id) + ') 计算出错: ' + e.message);
      return {};
    }
  };

  Simulator.prototype.resolveNet = function (n) {
    var bits = n.bits, m = U.mask(bits), v = 0, z = m, conflict = false;
    for (var b = 0; b < bits; b++) {
      var bit = 1 << b, first = -1;
      for (var i = 0; i < n.drivers.length; i++) {
        var d = n.drivers[i], s = this.cs[d.c].out[d.pin];
        if (!s || ((s.z >>> 0) & bit)) continue;
        var bv = ((s.v >>> 0) >> b) & 1;
        if (first < 0) first = bv;
        else if (first !== bv) conflict = true;
      }
      if (first >= 0) { z &= ~bit; if (first) v |= bit; }
    }
    n.conflict = conflict;
    return { v: v >>> 0, z: z >>> 0 };
  };

  /** 立刻写入某元件的输出，并重算所有网络；返回发生变化的网络下标列表 */
  Simulator.prototype.apply = function (updates) {
    var self = this;
    updates.forEach(function (u) {
      var cs = self.cs[u.ci], pin = u.pin, s = u.val;
      cs.out[pin] = { v: (s.v >>> 0), z: s.z >>> 0 };
    });
    var changed = [];
    for (var i = 0; i < this.nets.length; i++) {
      var nv = this.resolveNet(this.nets[i]);
      var ov = this.values[i];
      if (nv.v !== ov.v || nv.z !== ov.z) {
        this.values[i] = nv;
        changed.push(i);
      }
    }
    changed.forEach(function (id) {
      self.nets[id].sinks.forEach(function (s) { self.dirty.add(s.c); });
    });
    return changed;
  };

  Simulator.prototype.hash = function () {
    var s = '';
    for (var i = 0; i < this.values.length; i++) s += this.values[i].v + ':' + this.values[i].z + ',';
    return s;
  };

  /** 同步轮次稳定：本轮所有门同时读输入，然后同时更新输出（Digital 的 gate delay 模型） */
  Simulator.prototype.settle = function (maxRounds) {
    maxRounds = maxRounds || 250;
    var rounds = 0;
    this.hashSeen = [];
    while (this.dirty.size && rounds < maxRounds) {
      var batch = Array.from(this.dirty).sort(function (a, b) { return a - b; });
      this.dirty.clear();
      var updates = [];
      for (var k = 0; k < batch.length; k++) {
        var ci = batch[k], o = this.evalComp(ci);
        for (var pin in o) if (Object.prototype.hasOwnProperty.call(o, pin)) updates.push({ ci: ci, pin: pin, val: o[pin] });
      }
      var changed = this.apply(updates);
      rounds++;
      // 没有任何网络变化 => 已经稳定（此时 dirty 中可能仍有纯接收端元件，不应判为振荡）
      if (!changed.length) break;
      var h = this.hash();
      if (this.hashSeen.indexOf(h) >= 0) { this.oscillation = true; break; }
      this.hashSeen.push(h);
      if (this.hashSeen.length > 60) this.hashSeen.shift();
    }
    if (rounds >= maxRounds && this.dirty.size) this.oscillation = true;
    if (this.oscillation) this.ctx().error('检测到振荡：电路无法达到稳定状态（可用「单门步进」定位问题）');
    return rounds;
  };

  /** 上电：随机顺序、逐门立即更新，直到稳定（可让 RS 锁存器等进入确定态） */
  Simulator.prototype.powerOn = function () {
    // 保留断电状态下用户预先拨好的开关 / 端口值
    var saved = [];
    if (this.comps) this.comps.forEach(function (c, i) {
      if (L.interactive(c.type)) saved.push({ id: c.id, val: this.cs[i] ? this.cs[i].st.val : undefined, value: c.props.value });
    }, this);
    this.reset();
    saved.forEach(function (s) {
      for (var i = 0; i < this.comps.length; i++) {
        if (this.comps[i].id !== s.id) continue;
        if (s.val !== undefined) this.cs[i].st.val = s.val;
        if (s.value !== undefined) this.comps[i].props.value = s.value;
        break;
      }
    }, this);
    this.on = true;
    this.settling = true;
    // 组合逻辑门上电时输出是未定义的：给一个随机初态，让带反馈的电路
    // 能像真实硬件一样收敛到某个稳定态（RS 锁存器）或暴露振荡（环形振荡器）
    var RANDOM_INIT = {
      and: 1, or: 1, xor: 1, nand: 1, nor: 1, xnor: 1, not: 1, buffer: 1,
      tribuf: 1, mux: 1, demux: 1, decoder: 1, adder: 1, comparator: 1,
      shift: 1, splitter: 1, ic74: 1
    };
    this.cs.forEach(function (cs, i) {
      var c = this.comps[i];
      if (!RANDOM_INIT[c.type]) return;
      L.pinsOf(c).forEach(function (p) {
        if (p.dir === 'out') cs.out[p.name] = { v: Math.random() < .5 ? 0 : 1, z: 0 };
      });
    }, this);
    var idx = this.comps.map(function (_, i) { return i; });
    var stable = false;
    for (var iter = 0; iter < 400 && !stable; iter++) {
      stable = true;
      U.shuffle(idx);
      for (var k = 0; k < idx.length; k++) {
        var ci = idx[k], o = this.evalComp(ci), updates = [];
        for (var pin in o) if (Object.prototype.hasOwnProperty.call(o, pin)) updates.push({ ci: ci, pin: pin, val: o[pin] });
        if (updates.length && this.apply(updates).length) stable = false;
      }
    }
    if (!stable) this.oscillation = true;
    this.settling = false;
    this.dirty.clear();
    for (var i = 0; i < this.cs.length; i++) this.dirty.add(i);
    this.settle(300);
    this.powerOffErrors();
    this.record();
    return this;
  };

  Simulator.prototype.powerOff = function () { this.on = false; this.reset(); };

  Simulator.prototype.powerOffErrors = function () {
    var floating = this.nets.filter(function (n) { return n.floating; });
    if (floating.length) this.ctx().error('有 ' + floating.length + ' 个网络没有驱动源（悬空），读数显示为 Z');
    var conflicts = this.nets.filter(function (n) { return n.conflict; });
    if (conflicts.length) this.ctx().error('检测到 ' + conflicts.length + ' 处总线冲突（多个驱动器输出不同电平）');
  };

  /** 修改可交互输入的值 */
  Simulator.prototype.setInput = function (compId, value, autoSettle) {
    var ci = -1;
    for (var i = 0; i < this.comps.length; i++) if (this.comps[i].id === compId) { ci = i; break; }
    if (ci < 0) return false;
    var c = this.comps[ci], st = this.cs[ci].st;
    if (c.type === 'const') c.props.value = value;
    else st.val = value >>> 0;
    this.dirty.add(ci);
    if (autoSettle !== false && this.on) this.settle();
    return true;
  };

  Simulator.prototype.getInput = function (compId) {
    for (var i = 0; i < this.comps.length; i++) if (this.comps[i].id === compId) {
      var c = this.comps[i];
      return c.type === 'const' ? U.parseNum(c.props.value) : (this.cs[i].st.val || 0);
    }
    return 0;
  };

  Simulator.prototype.inputComponents = function () {
    return this.comps.filter(function (c) { return L.isInputPort(c) || (c.type === 'hdl' && false); });
  };
  Simulator.prototype.outputComponents = function () {
    return this.comps.filter(function (c) { return L.isOutputPort(c); });
  };

  Simulator.prototype.pinValue = function (compId, pinName) {
    var id = this.nl.pinNet[compId + '|' + pinName];
    return id === undefined ? { v: 0, z: 0xFFFFFFFF } : this.values[id];
  };
  Simulator.prototype.netValue = function (id) { return this.values[id]; };

  /** 读取某个输出元件的输入引脚值（用于真值表 / 测试） */
  Simulator.prototype.outputValue = function (comp) {
    var pins = L.pinsOf(comp).filter(function (p) { return p.dir !== 'out'; });
    if (!pins.length) return 0;
    var v = this.pinValue(comp.id, pins[0].name);
    return v.v >>> 0;
  };

  /** 运行一个 tick：推进所有时钟，然后稳定 */
  Simulator.prototype.stepTick = function (n) {
    if (!this.on) return;
    n = n || 1;
    for (var t = 0; t < n; t++) {
      this.tick++;
      for (var i = 0; i < this.comps.length; i++) {
        var c = this.comps[i];
        if (c.type !== 'clock') continue;
        var div = Math.max(1, c.props.div | 0);
        var nv = Math.floor(this.tick / div) % 2;
        if (this.cs[i].st.val !== nv) { this.cs[i].st.val = nv; this.dirty.add(i); }
      }
      if (this.dirty.size) this.settle();
      if (!this.oscillation) this.record();
    }
  };

  /** 单门步进：只处理一个待更新元件 */
  Simulator.prototype.stepGate = function () {
    if (!this.dirty.size) return null;
    var ci = Array.from(this.dirty).sort(function (a, b) { return a - b; })[0];
    this.dirty.delete(ci);
    var o = this.evalComp(ci), updates = [];
    for (var pin in o) if (Object.prototype.hasOwnProperty.call(o, pin)) updates.push({ ci: ci, pin: pin, val: o[pin] });
    var changed = this.apply(updates);
    return { ci: ci, comp: this.comps[ci], changed: changed };
  };

  Simulator.prototype.record = function () {
    if (!this.watch.length) return;
    var row = { t: this.tick, v: {} };
    this.watch.forEach(function (id) {
      var s = this.values[id];
      row.v[id] = s ? (s.v >>> 0) + (s.z ? 0x100000000 : 0) : 0;
    }, this);
    this.history.push(row);
    if (this.history.length > 600) this.history.shift();
  };

  Simulator.prototype.setWatch = function (ids) { this.watch = ids.slice(); this.history = []; this.record(); };

  /** 设置全部输入端口值后重新上电稳定（分析 / 测试用例使用） */
  Simulator.prototype.applyVector = function (vector, fullReset) {
    var self = this;
    Object.keys(vector).forEach(function (id) { self.setInput(id, vector[id], false); });
    if (fullReset) {
      this.settling = false;
      this.dirty.clear();
      for (var i = 0; i < this.cs.length; i++) this.dirty.add(i);
      this.settle(300);
    } else this.settle(300);
    return this;
  };

  DIG.Simulator = Simulator;
  if (typeof module !== 'undefined' && module.exports) module.exports = DIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
