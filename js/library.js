/* Digital.js - 元件库：引脚定义、绘制元数据、行为模型 */
(function (root) {
  'use strict';
  var DIG = (root.DIG = root.DIG || {});
  var U = DIG.Util;
  var L = (DIG.Lib = {});
  var defs = (L.defs = {});
  var categories = (L.categories = []);

  /* ---------- 引脚构造工具 ---------- */
  function P(name, x, y, dir, bits, ax, ay) {
    return { name: name, x: x, y: y, dir: dir, bits: bits || 1, ax: ax, ay: ay || 0, label: name };
  }
  function S(names, x, dir, defBits) {
    return names.map(function (e, i) {
      var n = typeof e === 'string' ? e : e.n;
      var b = typeof e === 'string' ? (defBits || 1) : (e.b || defBits || 1);
      var y = 2 * i - (names.length - 1);
      var ax = x < 0 ? -1 : 1;
      return P(n, x, y, dir, b, ax, 0);
    });
  }
  function gatePins(n, bits) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(P('i' + i, -3, 2 * i - (n - 1), 'in', bits, -1, 0));
    a.push(P('y', 3, 0, 'out', bits, 1, 0));
    return a;
  }
  function box(ins, outs, bits, extra) {
    var a = S(ins, -4, 'in', bits).concat(S(outs, 4, 'out', bits));
    if (extra) a = a.concat(extra);
    return a;
  }
  function sig(v, z) { return { v: (v >>> 0), z: z || 0 }; }
  // 使能端悬空（高阻）时按「有效」处理，符合教学电路的直觉
  function enVal(x) { return (x === undefined || ((x.z >>> 0) & 1)) ? 1 : (num(x) & 1); }
  function VAL(x) { return { v: ((x && x.v) || 0) >>> 0, z: (x && x.z) || 0 }; }
  function num(x) { return (x && x.v) || 0; }
  function zOf(x) { return (x && x.z) || 0; }
  function apply(fn, inputs, names, mask) {
    var r = 0;
    for (var i = 0; i < names.length; i++) {
      var s = VAL(inputs[names[i]]);
      r = fn(r, s.v, i);   // 悬空输入按 0 处理，输出始终驱动（避免反馈环卡在高阻）
    }
    return sig((r & mask) >>> 0, 0);
  }

  function register(def) {
    def.props = def.props || {};
    def.propDefs = def.propDefs || [];
    def.pins = def.pins || function () { return []; };
    def.init = def.init || function () { return {}; };
    def.eval = def.eval || function () { return {}; };
    def.hw = def.hw || 3;
    def.hh = def.hh || 3;
    def.shape = def.shape || 'box';
    def.symbol = def.symbol || def.type.toUpperCase();
    defs[def.type] = def;
    var cat = categories.filter(function (c) { return c.name === def.cat; })[0];
    if (!cat) { cat = { name: def.cat, items: [] }; categories.push(cat); }
    cat.items.push(def);
    return def;
  }
  L.register = register;
  L.get = function (type) { return defs[type]; };

  /* ---------- 总线分割规格（对齐 hneemann/Digital 的 Splitter） ----------
     支持三种写法，可用逗号任意混合：
       "4,2,2"          顺序宽度段，从最低位开始依次占用总线位
       "1*16" / "4*8"   [Bits]*[Number]，Number 个 Bits 位宽的段
       "4-7,0-3"        直接指定所使用的总线位，顺序任意；"7-4" 表示反序
     输入分割：必须完整且唯一地覆盖 0..busBits-1（每位恰好一次）。
     输出分割：允许重复引用同一位、允许只取部分位，如 "0-7,1-6,4-7"。
   */
  L.parseSplit = function (spec, opts) {
    opts = opts || {};
    var maxBits = opts.maxBits || U.MAX_BITS || 32;
    var minBits = Math.max(1, opts.minBits | 0);
    var given = opts.busBits | 0;          // 输出侧：总线宽度由输入分割确定
    var segments = [], cursor = 0, maxIndex = -1, derived = 0;
    function fail(msg) {
      return { segments: segments, busBits: given || Math.max(derived, minBits), error: msg, inputMap: null };
    }
    var text = ('' + (spec == null ? '' : spec)).replace(/[，；;]/g, ',').trim();
    if (!text) return fail('分割规格为空');
    var parts = text.split(',');
    for (var pi = 0; pi < parts.length; pi++) {
      var part = parts[pi].trim();
      if (!part) continue;
      var m = /^(\d+)\s*\*\s*(\d+)$/.exec(part);
      if (m) {
        var w = +m[1], cnt = +m[2];
        if (w < 1 || cnt < 1) return fail('「' + part + '」的位数与个数必须为正整数');
        if (cnt > maxBits) return fail('「' + part + '」段数超过 ' + maxBits);
        for (var j = 0; j < cnt; j++) {
          var bs = [];
          for (var k = 0; k < w; k++) bs.push(cursor++);
          segments.push({ bits: bs, width: w });
        }
        continue;
      }
      m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (m) {
        var a = +m[1], b = +m[2], arr = [], q;
        if (a <= b) for (q = a; q <= b; q++) arr.push(q);
        else for (q = a; q >= b; q--) arr.push(q);
        if (a > maxIndex) maxIndex = a;
        if (b > maxIndex) maxIndex = b;
        segments.push({ bits: arr, width: arr.length });
        continue;
      }
      m = /^(\d+)$/.exec(part);
      if (m) {
        var w2 = +m[1], arr2 = [];
        if (w2 < 1) return fail('「' + part + '」位数必须为正整数');
        for (var k2 = 0; k2 < w2; k2++) arr2.push(cursor++);
        segments.push({ bits: arr2, width: w2 });
        continue;
      }
      return fail('无法解析「' + part + '」，可用 4,2,2 / 1*16 / 4-7,0-3');
    }
    if (!segments.length) return fail('分割规格为空');
    derived = Math.max(cursor, maxIndex + 1);
    var B = given ? given : Math.max(derived, minBits);
    if (B > maxBits) return fail('总线宽度 ' + B + ' 超过上限 ' + maxBits + ' 位');
    for (var si = 0; si < segments.length; si++) {
      for (var bi = 0; bi < segments[si].bits.length; bi++) {
        var idx = segments[si].bits[bi];
        if (idx < 0 || idx >= B) return fail('引用了位 ' + idx + '，超出 ' + B + ' 位总线范围');
      }
    }
    var res = { segments: segments, busBits: B, error: null, inputMap: null };
    if (opts.requireComplete) {
      var map = new Array(B), dup = null, missing = [];
      for (var s2 = 0; s2 < segments.length && dup === null; s2++) {
        for (var k3 = 0; k3 < segments[s2].bits.length; k3++) {
          var ib = segments[s2].bits[k3];
          if (map[ib]) { dup = ib; break; }
          map[ib] = { seg: s2, bit: k3 };
        }
      }
      if (dup !== null) return fail('位 ' + dup + ' 被重复指定（输入分割要求每位恰好一次）');
      for (var b2 = 0; b2 < B; b2++) if (!map[b2]) missing.push(b2);
      if (missing.length) return fail('位 ' + missing.slice(0, 8).join(',') + (missing.length > 8 ? '…' : '') +
        ' 未指定（输入分割必须完整覆盖 0-' + (B - 1) + '）');
      res.inputMap = map;
    }
    return res;
  };

  // 解析元件的两个分割规格，得到总线位宽、段定义、位映射与错误信息。
  // 旧电路（props 中没有 inSplit / outSplit）走 legacy 分支，引脚与行为保持不变。
  L.splitModel = function (p) {
    p = p || {};
    if (p.inSplit === undefined && p.outSplit === undefined) {
      var n = U.clamp(p.bits || 1, 1, U.MAX_BITS);
      return { legacy: true, error: null, busBits: n, mode: p.mode === 'combine' ? 'combine' : 'split', inSegments: [], outSegments: [], inputMap: null };
    }
    var bits = U.clamp(p.bits || 8, 1, U.MAX_BITS);
    var inSpec = (p.inSplit === '' || p.inSplit == null) ? String(bits) : p.inSplit;
    var inp = L.parseSplit(inSpec, { minBits: bits, requireComplete: true });
    if (inp.error) return { legacy: false, error: '输入分割：' + inp.error, busBits: inp.busBits, inSegments: inp.segments, outSegments: [], inputMap: null };
    var B = inp.busBits;
    var outSpec = (p.outSplit === '' || p.outSplit == null) ? String(B) : p.outSplit;
    var outp = L.parseSplit(outSpec, { busBits: B });
    if (outp.error) return { legacy: false, error: '输出分割：' + outp.error, busBits: B, inSegments: inp.segments, outSegments: outp.segments, inputMap: inp.inputMap };
    return {
      legacy: false, error: null, busBits: B,
      inSegments: inp.segments, outSegments: outp.segments, inputMap: inp.inputMap
    };
  };
  L.pinsOf = function (comp) {
    var d = defs[comp.type];
    if (!d) return [];
    var ps = typeof d.pins === 'function' ? d.pins(comp.props) : d.pins;
    var r = (comp.rot || 0) % 360;
    if (!r) return ps;
    return ps.map(function (p) {
      var xy = U.rotate(p.x, p.y, r), aa = U.rotate(p.ax, p.ay, r);
      var q = {}; for (var k in p) q[k] = p[k];
      q.x = xy[0]; q.y = xy[1]; q.ax = aa[0]; q.ay = aa[1];
      return q;
    });
  };
  L.absPin = function (comp, p) { return { x: comp.x + p.x, y: comp.y + p.y, ax: p.ax, ay: p.ay, bits: p.bits, dir: p.dir, name: p.name }; };
  L.bounds = function (comp) {
    var d = defs[comp.type]; if (!d) return { hw: 3, hh: 3 };
    var hw = typeof d.hw === 'function' ? d.hw(comp.props) : d.hw;
    var hh = typeof d.hh === 'function' ? d.hh(comp.props) : d.hh;
    return { hw: hw, hh: hh };
  };
  L.interactive = function (type) { var d = defs[type]; return !!(d && d.interactive); };
  L.isInputPort = function (c) { return ['switch', 'button', 'clock', 'const', 'reset', 'portIn'].indexOf(c.type) >= 0; };
  L.isOutputPort = function (c) { return ['led', 'probe', 'hexdisplay', 'portOut'].indexOf(c.type) >= 0; };

  function propNum(k, label, min, max) { return { k: k, t: 'number', label: label, min: min, max: max }; }
  function propSel(k, label, opts) { return { k: k, t: 'select', label: label, options: opts }; }
  function propText(k, label) { return { k: k, t: 'text', label: label }; }
  function propArea(k, label) { return { k: k, t: 'area', label: label }; }
  function propCheck(k, label) { return { k: k, t: 'check', label: label }; }
  L.propNum = propNum; L.propSel = propSel; L.propText = propText; L.propArea = propArea; L.propCheck = propCheck;

  var EDGE = propSel('edge', '触发沿', [['pos', '上升沿'], ['neg', '下降沿'], ['both', '双边沿']]);
  var FMT = propSel('format', '显示格式', [['hex', '十六进制'], ['bin', '二进制'], ['dec', '无符号十进制'], ['signed', '有符号十进制'], ['ascii', 'ASCII']]);

  /* ================= 输入 / 输出 ================= */
  register({
    type: 'switch', name: '拨动开关', cat: '输入 / 输出', shape: 'switch', hw: 2, hh: 2,
    props: { label: 'In', bits: 1, init: 0 }, interactive: true,
    propDefs: [propText('label', '名称'), propNum('bits', '位宽', 1, 32), propText('init', '初始值'), propSel('format', '显示', [['onoff', '开 / 关'], ['hex', '数值']])],
    pins: function (p) { return [P('y', 3, 0, 'out', p.bits, 1, 0)]; },
    init: function (p) { return { val: U.parseNum(p.init || 0) & U.mask(p.bits || 1) }; },
    eval: function (i, st) { return { y: sig(st.val) }; }
  });
  register({
    type: 'button', name: '按钮（点按）', cat: '输入 / 输出', shape: 'button', hw: 2, hh: 2,
    props: { label: 'Btn', invert: false }, interactive: true,
    propDefs: [propText('label', '名称'), propCheck('invert', '常闭（取反）')],
    pins: function () { return [P('y', 3, 0, 'out', 1, 1, 0)]; },
    init: function () { return { val: 0 }; },
    eval: function (i, st, p) { return { y: sig(p.invert ? (st.val ? 0 : 1) : st.val) }; }
  });
  register({
    type: 'clock', name: '时钟发生器', cat: '输入 / 输出', shape: 'clock', hw: 2, hh: 2,
    props: { label: 'CLK', div: 5 }, clock: true,
    propDefs: [propText('label', '名称'), propNum('div', '半周期（tick）', 1, 100000)],
    pins: function () { return [P('y', 3, 0, 'out', 1, 1, 0)]; },
    init: function () { return { val: 0 }; },
    eval: function (i, st) { return { y: sig(st.val) }; }
  });
  register({
    type: 'const', name: '常量', cat: '输入 / 输出', shape: 'const', hw: 2, hh: 2,
    props: { value: 1, bits: 1 }, interactive: true,
    propDefs: [propText('value', '数值（支持 0x / 0b / 十进制）'), propNum('bits', '位宽', 1, 32)],
    pins: function (p) { return [P('y', 3, 0, 'out', p.bits, 1, 0)]; },
    eval: function (i, st, p) { return { y: sig(U.parseNum(p.value) & U.mask(p.bits)) }; }
  });
  register({
    type: 'reset', name: '上电复位', cat: '输入 / 输出', shape: 'reset', hw: 2, hh: 2,
    props: { label: 'RST', activeLow: true },
    propDefs: [propText('label', '名称'), propCheck('activeLow', '低电平有效')],
    pins: function () { return [P('y', 3, 0, 'out', 1, 1, 0)]; },
    eval: function (i, st, p, ctx) { var hi = ctx.settling ? 0 : 1; return { y: sig(p.activeLow ? 1 - hi : hi) }; }
  });
  register({
    type: 'portIn', name: '输入端口', cat: '输入 / 输出', shape: 'port', hw: 2, hh: 2,
    props: { label: 'A', bits: 1, init: 0 }, interactive: true, exportPort: 'input',
    propDefs: [propText('label', '端口名'), propNum('bits', '位宽', 1, 32), propText('init', '初始值'), FMT],
    pins: function (p) { return [P('y', 3, 0, 'out', p.bits, 1, 0)]; },
    init: function (p) { return { val: U.parseNum(p.init || 0) & U.mask(p.bits || 1) }; },
    eval: function (i, st) { return { y: sig(st.val) }; }
  });
  register({
    type: 'portOut', name: '输出端口', cat: '输入 / 输出', shape: 'port', hw: 2, hh: 2,
    props: { label: 'Y', bits: 1 }, exportPort: 'output',
    propDefs: [propText('label', '端口名'), propNum('bits', '位宽', 1, 32), FMT],
    pins: function (p) { return [P('y', -3, 0, 'in', p.bits, -1, 0)]; }
  });
  register({
    type: 'led', name: 'LED 指示灯', cat: '输入 / 输出', shape: 'led', hw: 2, hh: 2,
    props: { label: '', color: 'red' },
    propDefs: [propText('label', '名称'), propSel('color', '颜色', [['red', '红'], ['green', '绿'], ['blue', '蓝'], ['yellow', '黄']])],
    pins: function () { return [P('a', -3, 0, 'in', 1, -1, 0)]; }
  });
  register({
    type: 'hexdisplay', name: '七段数码管（HEX）', cat: '输入 / 输出', shape: 'hex', hw: 3, hh: 5,
    props: { label: '', dp: false },
    propDefs: [propText('label', '名称'), propCheck('dp', '含小数点输入')],
    pins: function (p) {
      var a = [P('d', -4, -2, 'in', 4, -1, 0)];
      if (p.dp) a.push(P('dp', -4, 2, 'in', 1, -1, 0));
      return a;
    }
  });
  L.HEX_SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];
  register({
    type: 'probe', name: '数值探针', cat: '输入 / 输出', shape: 'probe', hw: 4, hh: 2,
    props: { label: '', format: 'hex', bits: 4 },
    propDefs: [propText('label', '名称'), FMT, propNum('bits', '位宽', 1, 32)],
    pins: function (p) { return [P('a', -5, 0, 'in', p.bits, -1, 0)]; }
  });
  register({
    type: 'netlabel', name: '网络标签', cat: '输入 / 输出', shape: 'label', hw: 2, hh: 1,
    props: { name: 'NET', bits: 1 }, netName: true,
    propDefs: [propText('name', '网络名'), propNum('bits', '位宽', 1, 32)],
    pins: function (p) { return [P('n', 0, 0, 'inout', p.bits, 0, 1)]; }
  });
  register({
    type: 'text', name: '文字注释', cat: '输入 / 输出', shape: 'text', hw: 6, hh: 1,
    props: { text: '注释', size: 14 },
    propDefs: [propText('text', '文字'), propNum('size', '字号', 8, 48)],
    pins: function () { return []; }
  });

  /* ================= 基本门 ================= */
  function gate(type, name, symbol, fn, bubble) {
    var def = {
      type: type, name: name, cat: '基本门电路', shape: bubble ? 'gateBubble' : (symbol === '1' ? 'not' : 'gate'),
      symbol: symbol, props: { inputs: 2, bits: 1 },
      propDefs: [propNum('inputs', '输入数', 1, 16), propNum('bits', '位宽', 1, 32)],
      hw: 2, hh: function (p) { return Math.max(2, p.inputs + 1); },
      pins: function (p) { return gatePins(p.inputs, p.bits); },
      eval: function (i, st, p) {
        var m = U.mask(p.bits), names = [];
        for (var k = 0; k < p.inputs; k++) names.push('i' + k);
        var f = function (acc, v, idx) { return idx === 0 ? v : fn(acc, v); };
        return { y: apply(f, i, names, m) };
      }
    };
    if (type === 'not' || type === 'buffer') {
      def.propDefs = [propNum('bits', '位宽', 1, 32)];
      def.props = { bits: 1 };
      def.pins = function (p) { return [P('i0', -3, 0, 'in', p.bits, -1, 0), P('y', 3, 0, 'out', p.bits, 1, 0)]; };
      def.hh = 2;
      def.eval = function (i, st, p) {
        var a = VAL(i.i0), m = U.mask(p.bits);
        return { y: { v: ((type === 'not' ? ~a.v : a.v) & m) >>> 0, z: 0 } };
      };
    }
    return register(def);
  }
  gate('and', '与门 AND', '&', function (a, b) { return a & b; });
  gate('or', '或门 OR', '≥1', function (a, b) { return a | b; });
  gate('xor', '异或门 XOR', '=1', function (a, b) { return a ^ b; });
  gate('nand', '与非门 NAND', '&', function (a, b) { return ~(a & b); }, true);
  gate('nor', '或非门 NOR', '≥1', function (a, b) { return ~(a | b); }, true);
  gate('xnor', '同或门 XNOR', '=1', function (a, b) { return ~(a ^ b); }, true);
  gate('not', '非门 NOT', '1', function (a) { return ~a; }, true);
  gate('buffer', '缓冲器 BUF', '1', function (a) { return a; });
  register({
    type: 'tribuf', name: '三态缓冲器', cat: '基本门电路', shape: 'tri', hw: 2, hh: 3,
    props: { bits: 1 }, propDefs: [propNum('bits', '位宽', 1, 32)],
    pins: function (p) { return [P('a', -3, -2, 'in', p.bits, -1, 0), P('en', -3, 2, 'in', 1, -1, 0), P('y', 3, 0, 'out', p.bits, 1, 0)]; },
    eval: function (i, st, p) {
      var m = U.mask(p.bits), a = VAL(i.a);
      return { y: num(i.en) ? { v: a.v & m, z: a.z & m } : { v: 0, z: m } };
    }
  });
  register({
    type: 'pull', name: '上拉 / 下拉电阻', cat: '基本门电路', shape: 'pull', hw: 2, hh: 2,
    props: { bits: 1, value: 1 }, propDefs: [propNum('bits', '位宽', 1, 32), propNum('value', '上拉值(0/1)', 0, 1)],
    pins: function (p) { return [P('y', 0, 3, 'out', p.bits, 0, 1)]; },
    eval: function (i, st, p) { return { y: sig(p.value ? U.mask(p.bits) : 0) }; }
  });

  /* ================= 组合逻辑 ================= */
  register({
    type: 'mux', name: '多路选择器 MUX', cat: '组合逻辑', shape: 'box', symbol: 'MUX', hw: 3,
    hh: function (p) { return p.inputs + 3; },
    props: { inputs: 2, bits: 1 },
    propDefs: [propSel('inputs', '输入路数', [[2, '2 路'], [4, '4 路'], [8, '8 路']]), propNum('bits', '位宽', 1, 32)],
    pins: function (p) {
      var names = []; for (var k = 0; k < p.inputs; k++) names.push('i' + k);
      var a = S(names, -4, 'in', p.bits);
      a.push(P('sel', 0, 2 * (p.inputs / 2 | 0) + 2, 'in', Math.ceil(Math.log2(p.inputs)), 0, 1));
      a.push(P('y', 4, 0, 'out', p.bits, 1, 0));
      return a;
    },
    eval: function (i, st, p) {
      var idx = num(i.sel) % p.inputs, s = VAL(i['i' + idx]);
      return { y: { v: s.v & U.mask(p.bits), z: s.z & U.mask(p.bits) } };
    }
  });
  register({
    type: 'demux', name: '多路分配器 DEMUX', cat: '组合逻辑', shape: 'box', symbol: 'DMX', hw: 3,
    hh: function (p) { return p.outputs + 3; },
    props: { outputs: 2, bits: 1 },
    propDefs: [propSel('outputs', '输出路数', [[2, '2 路'], [4, '4 路'], [8, '8 路']]), propNum('bits', '位宽', 1, 32)],
    pins: function (p) {
      var names = []; for (var k = 0; k < p.outputs; k++) names.push('y' + k);
      var a = S(names, 4, 'out', p.bits);
      a.push(P('sel', 0, 2 * (p.outputs / 2 | 0) + 2, 'in', Math.ceil(Math.log2(p.outputs)), 0, 1));
      a.push(P('a', -4, 0, 'in', p.bits, -1, 0));
      return a;
    },
    eval: function (i, st, p) {
      var idx = num(i.sel) % p.outputs, o = {}, s = VAL(i.a), m = U.mask(p.bits);
      for (var k = 0; k < p.outputs; k++) o['y' + k] = k === idx ? { v: s.v & m, z: s.z & m } : sig(0, m);
      return o;
    }
  });
  register({
    type: 'decoder', name: '译码器 DECODER', cat: '组合逻辑', shape: 'box', symbol: 'DEC', hw: 3,
    hh: function (p) { return (1 << p.bits) + 2; },
    props: { bits: 2, enable: true },
    propDefs: [propNum('bits', '输入位宽', 1, 4), propCheck('enable', '带使能端')],
    pins: function (p) {
      var n = 1 << p.bits, names = []; for (var k = 0; k < n; k++) names.push('y' + k);
      var a = S(names, 4, 'out', 1);
      a.push(P('a', -4, 0, 'in', p.bits, -1, 0));
      if (p.enable) a.push(P('en', 0, n + 1, 'in', 1, 0, 1));
      return a;
    },
    eval: function (i, st, p) {
      var n = 1 << p.bits, o = {}, on = p.enable ? enVal(i.en) : 1, a = num(i.a);
      for (var k = 0; k < n; k++) o['y' + k] = sig(on && k === a ? 1 : 0);
      return o;
    }
  });
  register({
    type: 'adder', name: '加法 / 减法器', cat: '组合逻辑', shape: 'box', symbol: 'ADD', hw: 3, hh: 4,
    props: { bits: 4, sub: false },
    propDefs: [propNum('bits', '位宽', 1, 32), propCheck('sub', '作为减法器')],
    pins: function (p) {
      return [P('a', -4, -2, 'in', p.bits, -1, 0), P('b', -4, 0, 'in', p.bits, -1, 0),
      P('ci', -4, 2, 'in', 1, -1, 0), P('s', 4, -2, 'out', p.bits, 1, 0), P('co', 4, 2, 'out', 1, 1, 0)];
    },
    eval: function (i, st, p) {
      var m = U.mask(p.bits), a = num(i.a) & m, b = (num(i.b) & m), ci = num(i.ci) & 1;
      var r = p.sub ? a + ((~b >>> 0) & m) + ci : a + b + ci;
      return { s: sig(r & m), co: sig(p.sub ? ((r >> p.bits) & 1) ^ 1 : (r >> p.bits) & 1) };
    }
  });
  register({
    type: 'comparator', name: '数值比较器', cat: '组合逻辑', shape: 'box', symbol: 'CMP', hw: 3, hh: 4,
    props: { bits: 4, signed: false },
    propDefs: [propNum('bits', '位宽', 1, 32), propCheck('signed', '有符号比较')],
    pins: function (p) {
      return [P('a', -4, -2, 'in', p.bits, -1, 0), P('b', -4, 2, 'in', p.bits, -1, 0),
      P('eq', 4, -4, 'out', 1, 1, 0), P('lt', 4, 0, 'out', 1, 1, 0), P('gt', 4, 4, 'out', 1, 1, 0)];
    },
    eval: function (i, st, p) {
      var m = U.mask(p.bits), a = num(i.a) & m, b = num(i.b) & m;
      if (p.signed) {
        var s = function (x) { return (x >> (p.bits - 1)) & 1 ? x - Math.pow(2, p.bits) : x; };
        a = s(a); b = s(b);
      }
      return { eq: sig(a === b ? 1 : 0), lt: sig(a < b ? 1 : 0), gt: sig(a > b ? 1 : 0) };
    }
  });
  register({
    type: 'shift', name: '移位器', cat: '组合逻辑', shape: 'box', symbol: 'SHIFT', hw: 3, hh: 4,
    props: { bits: 8, dir: 'l' },
    propDefs: [propNum('bits', '位宽', 2, 32), propSel('dir', '方向', [['l', '左移'], ['r', '逻辑右移'], ['ra', '算术右移'], ['rot', '循环左移']])],
    pins: function (p) {
      return [P('a', -4, -2, 'in', p.bits, -1, 0), P('sh', -4, 2, 'in', 5, -1, 0), P('y', 4, 0, 'out', p.bits, 1, 0)];
    },
    eval: function (i, st, p) {
      var m = U.mask(p.bits), a = num(i.a) & m, n = num(i.sh) % p.bits, r;
      switch (p.dir) {
        case 'r': r = (a >>> n); break;
        case 'ra': r = ((a << (32 - p.bits)) >> (Math.min(n, 31))) >>> (32 - p.bits); break;
        case 'rot': r = ((a << n) | (a >>> (p.bits - n))) & m; break;
        default: r = (a << n) & m;
      }
      return { y: sig(r & m) };
    }
  });
  var splitterDef = register({
    type: 'splitter', name: '总线分线器 / 合线器', cat: '组合逻辑', shape: 'splitter', hw: 4,
    hh: function (p) {
      var m = L.splitModel(p);
      return Math.max(2, (m.legacy ? m.busBits : Math.max(m.inSegments.length, m.outSegments.length) || 1) + 1);
    },
    props: { bits: 8, inSplit: '8', outSplit: '1*8' },
    propDefs: [
      propNum('bits', '总线位宽（下限）', 1, 32),
      propText('inSplit', '输入分割'),
      propText('outSplit', '输出分割')
    ],
    pins: function (p) {
      var m = L.splitModel(p), a = [], i, pin, w;
      if (m.legacy) {
        var n = m.busBits;
        if (m.mode === 'combine') {
          a.push(P('bus', 4, 0, 'out', n, 1, 0));
          for (i = 0; i < n; i++) a.push(P('b' + i, -4, 2 * i - (n - 1), 'in', 1, -1, 0));
        } else {
          a.push(P('bus', -4, 0, 'in', n, -1, 0));
          for (i = 0; i < n; i++) a.push(P('b' + i, 4, 2 * i - (n - 1), 'out', 1, 1, 0));
        }
        return a;
      }
      if (m.error) {
        var nb = U.clamp(p.bits || 1, 1, U.MAX_BITS);
        a.push(P('i0', -4, 0, 'in', nb, -1, 0));
        a.push(P('o0', 4, 0, 'out', nb, 1, 0));
        return a;
      }
      var ni = m.inSegments.length, no = m.outSegments.length;
      for (i = 0; i < ni; i++) {
        w = m.inSegments[i].width;
        pin = P('i' + i, -4, 2 * i - (ni - 1), 'in', w, -1, 0);
        pin.label = 'i' + i + (w > 1 ? '[' + (w - 1) + ':0]' : '');
        a.push(pin);
      }
      for (i = 0; i < no; i++) {
        w = m.outSegments[i].width;
        pin = P('o' + i, 4, 2 * i - (no - 1), 'out', w, 1, 0);
        pin.label = 'o' + i + (w > 1 ? '[' + (w - 1) + ':0]' : '');
        a.push(pin);
      }
      return a;
    },
    eval: function (i, st, p) {
      var m = L.splitModel(p), o = {}, k, b;
      if (m.legacy) {
        var n = m.busBits;
        if (m.mode === 'combine') {
          var lv = 0, lz = 0;
          for (k = 0; k < n; k++) { var ls = VAL(i['b' + k]); lv |= (ls.v & 1) << k; lz |= (ls.z & 1) << k; }
          o.bus = sig(lv, lz);
        } else {
          var lb = VAL(i.bus);
          for (k = 0; k < n; k++) o['b' + k] = ((lb.z >> k) & 1) ? sig(0, 1) : sig((lb.v >> k) & 1);
        }
        return o;
      }
      if (m.error) return { o0: sig(0, 0) };
      var bv = 0, bz = 0;
      for (b = 0; b < m.busBits; b++) {
        var src = m.inputMap[b], s = VAL(i['i' + src.seg]);
        if (((s.v >>> src.bit) & 1)) bv = (bv | (1 << b)) >>> 0;
        if (((s.z >>> src.bit) & 1)) bz = (bz | (1 << b)) >>> 0;
      }
      for (var si = 0; si < m.outSegments.length; si++) {
        var seg = m.outSegments[si], v = 0, z = 0;
        for (k = 0; k < seg.bits.length; k++) {
          var ib = seg.bits[k];
          if ((bv >>> ib) & 1) v = (v | (1 << k)) >>> 0;
          if ((bz >>> ib) & 1) z = (z | (1 << k)) >>> 0;
        }
        o['o' + si] = sig(v, z);
      }
      return o;
    }
  });

  // 元件面板里提供三种常用预设（都是同一个元件，仅默认分割规格不同）
  (function () {
    var cat = categories.filter(function (x) { return x.name === '组合逻辑'; })[0];
    if (!cat) return;
    var at = cat.items.indexOf(splitterDef);
    cat.items.splice(at + 1, 0,
      { type: 'splitter', name: '总线合线器（位 → 总线）', props: { bits: 8, inSplit: '1*8', outSplit: '8' } },
      { type: 'splitter', name: '总线任意分割器（4,2,2）', props: { bits: 8, inSplit: '4,2,2', outSplit: '0-7,1-6,4-7' } });
  })();

  /* ================= 时序逻辑 ================= */
  function edge(st, clk, prop) {
    var c = num(clk) & 1, prev = st._clk === undefined ? c : st._clk, e = prop.edge || 'pos';
    st._clk = c;
    if (e === 'both') return c !== prev;
    if (e === 'neg') return prev === 1 && c === 0;
    return prev === 0 && c === 1;
  }
  register({
    type: 'dff', name: 'D 触发器', cat: '时序逻辑', shape: 'box', symbol: 'DFF', hw: 3, hh: 4,
    props: { bits: 1, edge: 'pos', init: 0 },
    propDefs: [propNum('bits', '位宽', 1, 32), EDGE, propText('init', '初值')],
    pins: function (p) {
      return [P('d', -4, -2, 'in', p.bits, -1, 0), P('c', -4, 2, 'in', 1, -1, 0),
      P('q', 4, -2, 'out', p.bits, 1, 0), P('qn', 4, 2, 'out', p.bits, 1, 0)];
    },
    init: function (p) { return { q: U.parseNum(p.init) & U.mask(p.bits) }; },
    eval: function (i, st, p) {
      if (edge(st, i.c, p)) st.q = num(i.d) & U.mask(p.bits);
      return { q: sig(st.q), qn: sig((~st.q >>> 0) & U.mask(p.bits)) };
    }
  });
  register({
    type: 'jkff', name: 'JK 触发器', cat: '时序逻辑', shape: 'box', symbol: 'JKFF', hw: 3, hh: 5,
    props: { edge: 'neg' }, propDefs: [EDGE],
    pins: function () {
      return [P('j', -4, -4, 'in', 1, -1, 0), P('c', -4, 0, 'in', 1, -1, 0), P('k', -4, 4, 'in', 1, -1, 0),
      P('q', 4, -2, 'out', 1, 1, 0), P('qn', 4, 2, 'out', 1, 1, 0)];
    },
    init: function () { return { q: 0 }; },
    eval: function (i, st, p) {
      if (edge(st, i.c, p)) {
        var j = num(i.j), k = num(i.k);
        if (j && k) st.q = st.q ? 0 : 1; else if (j) st.q = 1; else if (k) st.q = 0;
      }
      return { q: sig(st.q), qn: sig(st.q ? 0 : 1) };
    }
  });
  register({
    type: 'tff', name: 'T 触发器', cat: '时序逻辑', shape: 'box', symbol: 'TFF', hw: 3, hh: 3,
    props: { edge: 'pos' }, propDefs: [EDGE],
    pins: function () { return [P('t', -4, -2, 'in', 1, -1, 0), P('c', -4, 2, 'in', 1, -1, 0), P('q', 4, -2, 'out', 1, 1, 0), P('qn', 4, 2, 'out', 1, 1, 0)]; },
    init: function () { return { q: 0 }; },
    eval: function (i, st, p) {
      if (edge(st, i.c, p) && num(i.t)) st.q = st.q ? 0 : 1;
      return { q: sig(st.q), qn: sig(st.q ? 0 : 1) };
    }
  });
  register({
    type: 'rsff', name: 'RS 锁存器（或非）', cat: '时序逻辑', shape: 'box', symbol: 'RS', hw: 3, hh: 3,
    props: {}, propDefs: [],
    pins: function () { return [P('r', -4, -2, 'in', 1, -1, 0), P('s', -4, 2, 'in', 1, -1, 0), P('q', 4, -2, 'out', 1, 1, 0), P('qn', 4, 2, 'out', 1, 1, 0)]; },
    init: function () { return { q: 0 }; },
    eval: function (i, st, p, ctx) {
      var r = num(i.r), s = num(i.s);
      // 组合反馈：输出直接由输入与自身状态决定，上电随机稳定过程可收敛
      var q = ~(r | (~(s | st.q) >>> 0 & 1)) & 1;
      if (r && s) { q = 0; }
      if (ctx.settling && r === 0 && s === 0 && st.q === 0 && st._touched === undefined) {
        // 上电时给一个随机的初态，模拟真实 RS 锁存器的未定义状态
        q = Math.random() < 0.5 ? 0 : 1;
      }
      st._touched = 1; st.q = q & 1;
      return { q: sig(st.q), qn: sig(st.q ? 0 : 1) };
    }
  });
  register({
    type: 'register', name: '寄存器', cat: '时序逻辑', shape: 'box', symbol: 'REG', hw: 3, hh: 4,
    props: { bits: 8, edge: 'pos' }, propDefs: [propNum('bits', '位宽', 1, 32), EDGE],
    pins: function (p) {
      return [P('d', -4, -2, 'in', p.bits, -1, 0), P('c', -4, 0, 'in', 1, -1, 0), P('en', -4, 2, 'in', 1, -1, 0),
      P('q', 4, 0, 'out', p.bits, 1, 0)];
    },
    init: function () { return { q: 0 }; },
    eval: function (i, st, p) {
      if (edge(st, i.c, p) && enVal(i.en)) st.q = num(i.d) & U.mask(p.bits);
      return { q: sig(st.q) };
    }
  });
  register({
    type: 'counter', name: '计数器', cat: '时序逻辑', shape: 'box', symbol: 'CNT', hw: 3, hh: 4,
    props: { bits: 4, edge: 'pos', down: false }, propDefs: [propNum('bits', '位宽', 1, 32), EDGE, propCheck('down', '递减计数')],
    pins: function (p) {
      return [P('c', -4, -2, 'in', 1, -1, 0), P('en', -4, 0, 'in', 1, -1, 0), P('clr', -4, 2, 'in', 1, -1, 0),
      P('q', 4, 0, 'out', p.bits, 1, 0)];
    },
    init: function () { return { q: 0 }; },
    eval: function (i, st, p) {
      if (num(i.clr)) st.q = 0;
      else if (edge(st, i.c, p) && enVal(i.en)) st.q = (st.q + (p.down ? -1 : 1)) & U.mask(p.bits);
      return { q: sig(st.q) };
    }
  });
  function parseMem(text, size, bits) {
    var a = new Array(size).fill(0);
    if (!text) return a;
    var toks = ('' + text).split(/[\s,;]+/).filter(Boolean);
    for (var i = 0; i < Math.min(size, toks.length); i++) a[i] = U.parseNum(toks[i]) & U.mask(bits);
    return a;
  }
  L.parseMem = parseMem;
  register({
    type: 'ram', name: 'RAM 随机存储器', cat: '时序逻辑', shape: 'box', symbol: 'RAM', hw: 4, hh: 6,
    props: { addrBits: 4, dataBits: 8, init: '', edge: 'pos' },
    propDefs: [propNum('addrBits', '地址位宽', 1, 16), propNum('dataBits', '数据位宽', 1, 32), EDGE, propArea('init', '初始数据（空格/换行分隔）')],
    pins: function (p) {
      return [P('addr', -5, -4, 'in', p.addrBits, -1, 0), P('din', -5, -1, 'in', p.dataBits, -1, 0),
      P('we', -5, 2, 'in', 1, -1, 0), P('clk', -5, 5, 'in', 1, -1, 0), P('dout', 5, 0, 'out', p.dataBits, 1, 0)];
    },
    init: function (p) { return { mem: parseMem(p.init, 1 << U.clamp(p.addrBits, 1, 12), p.dataBits) }; },
    eval: function (i, st, p) {
      var size = 1 << U.clamp(p.addrBits, 1, 12);
      if (!st.mem || st.mem.length !== size) st.mem = parseMem(p.init, size, p.dataBits);
      var ad = num(i.addr) % size;
      if (edge(st, i.clk, p) && num(i.we)) st.mem[ad] = num(i.din) & U.mask(p.dataBits);
      return { dout: sig(st.mem[ad] || 0) };
    }
  });
  register({
    type: 'rom', name: 'ROM 只读存储器', cat: '时序逻辑', shape: 'box', symbol: 'ROM', hw: 4, hh: 4,
    props: { addrBits: 4, dataBits: 8, init: '0 1 2 3 4 5 6 7 8 9 A B C D E F' },
    propDefs: [propNum('addrBits', '地址位宽', 1, 16), propNum('dataBits', '数据位宽', 1, 32), propArea('init', '数据（空格/换行/逗号分隔）')],
    pins: function (p) { return [P('addr', -5, 0, 'in', p.addrBits, -1, 0), P('dout', 5, 0, 'out', p.dataBits, 1, 0)]; },
    init: function (p) { return { mem: parseMem(p.init, 1 << U.clamp(p.addrBits, 1, 12), p.dataBits) }; },
    eval: function (i, st, p) {
      var size = 1 << U.clamp(p.addrBits, 1, 12);
      if (!st.mem || st.mem.length !== size) st.mem = parseMem(p.init, size, p.dataBits);
      return { dout: sig(st.mem[num(i.addr) % size] || 0) };
    }
  });

  /* ================= 74xx 系列 ================= */
  var PARTS = {
    '7400': { d: '四 2 输入与非门', p: ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'], g: [['nand', '1A', '1B', '1Y'], ['nand', '2A', '2B', '2Y'], ['nand', '3A', '3B', '3Y'], ['nand', '4A', '4B', '4Y']] },
    '7402': { d: '四 2 输入或非门', p: ['1Y', '1A', '1B', '2Y', '2A', '2B', 'GND', '3A', '3B', '3Y', '4A', '4B', '4Y', 'VCC'], g: [['nor', '1A', '1B', '1Y'], ['nor', '2A', '2B', '2Y'], ['nor', '3A', '3B', '3Y'], ['nor', '4A', '4B', '4Y']] },
    '7404': { d: '六反相器', p: ['1A', '1Y', '2A', '2Y', '3A', '3Y', 'GND', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'VCC'], g: [['not', '1A', '1Y'], ['not', '2A', '2Y'], ['not', '3A', '3Y'], ['not', '4A', '4Y'], ['not', '5A', '5Y'], ['not', '6A', '6Y']] },
    '7408': { d: '四 2 输入与门', p: ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'], g: [['and', '1A', '1B', '1Y'], ['and', '2A', '2B', '2Y'], ['and', '3A', '3B', '3Y'], ['and', '4A', '4B', '4Y']] },
    '7432': { d: '四 2 输入或门', p: ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'], g: [['or', '1A', '1B', '1Y'], ['or', '2A', '2B', '2Y'], ['or', '3A', '3B', '3Y'], ['or', '4A', '4B', '4Y']] },
    '7486': { d: '四 2 输入异或门', p: ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'], g: [['xor', '1A', '1B', '1Y'], ['xor', '2A', '2B', '2Y'], ['xor', '3A', '3B', '3Y'], ['xor', '4A', '4B', '4Y']] },
    '7410': { d: '三 3 输入与非门', p: ['1A', '1B', '2A', '2B', '2C', '2Y', 'GND', '1Y', '1C', '3A', '3B', '3C', '3Y', 'VCC'], g: [['nand', '1A', '1B', '1C', '1Y'], ['nand', '2A', '2B', '2C', '2Y'], ['nand', '3A', '3B', '3C', '3Y']] },
    '7420': { d: '双 4 输入与非门', p: ['1A', '1B', 'NC', '1C', '1D', '1Y', 'GND', '2Y', '2A', '2B', 'NC', '2C', '2D', 'VCC'], g: [['nand', '1A', '1B', '1C', '1D', '1Y'], ['nand', '2A', '2B', '2C', '2D', '2Y']] },
    '7474': { d: '双 D 触发器（带预置/清零）', p: ['1CLRn', '1D', '1CLK', '1PREn', '1Q', '1Qn', 'GND', '2Qn', '2Q', '2PREn', '2CLK', '2D', '2CLRn', 'VCC'], special: 'dff2' },
    '74138': { d: '3-8 线译码器', p: ['A', 'B', 'C', 'G2An', 'G2Bn', 'G1', 'Y7n', 'GND', 'Y6n', 'Y5n', 'Y4n', 'Y3n', 'Y2n', 'Y1n', 'Y0n', 'VCC'], special: 'dec38' },
    '74157': { d: '四 2 选 1 数据选择器', p: ['SEL', '1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3B', '3A', '4Y', '4B', '4A', 'Gn', 'VCC'], special: 'mux4' }
  };
  L.PARTS = PARTS;
  var GATEOPS = {
    'and': function (a, b) { return a & b; }, 'or': function (a, b) { return a | b; },
    'xor': function (a, b) { return a ^ b; }, 'nand': function (a, b) { return ~(a & b) & 1; },
    'nor': function (a, b) { return ~(a | b) & 1; }, 'not': function (a) { return ~a & 1; }
  };
  function icPins(partName) {
    var part = PARTS[partName] || PARTS['7400'];
    var names = part.p, n = names.length, half = n / 2, out = [];
    var outs = {};
    (part.g || []).forEach(function (g) { outs[g[g.length - 1]] = 1; });
    if (part.special === 'dff2') { ['1Q', '1Qn', '2Q', '2Qn'].forEach(function (x) { outs[x] = 1; }); }
    if (part.special === 'dec38') { for (var k = 0; k < 8; k++) outs['Y' + k + 'n'] = 1; }
    if (part.special === 'mux4') { ['1Y', '2Y', '3Y', '4Y'].forEach(function (x) { outs[x] = 1; }); }
    for (var i = 0; i < n; i++) {
      var name = names[i], left = i < half;
      var slot = left ? i : (n - 1 - i);
      var y = 2 * slot - (half - 1);
      var hidden = /^(GND|VCC|NC)$/.test(name);
      var dir = outs[name] ? 'out' : 'in';
      out.push({ name: name, x: left ? -5 : 5, y: y, dir: dir, bits: 1, ax: left ? -1 : 1, ay: 0, label: name, hidden: hidden, num: i + 1 });
    }
    return out;
  }
  L.icPins = icPins;
  register({
    type: 'ic74', name: '74xx 集成电路', cat: '74xx 芯片', shape: 'dip', hw: 4,
    hh: function (p) { return (PARTS[p.part] || PARTS['7400']).p.length / 2 + 1; },
    props: { part: '7400' },
    propDefs: [{ k: 'part', t: 'select', label: '型号', options: Object.keys(PARTS).map(function (k) { return [k, k + ' · ' + PARTS[k].d]; }) }],
    pins: function (p) { return icPins(p.part); },
    init: function () { return { q1: 0, q2: 0, _c1: 0, _c2: 0 }; },
    eval: function (i, st, p) {
      var part = PARTS[p.part] || PARTS['7400'], o = {}, g, k, r;
      var get = function (nm) { return num(i[nm]) & 1; };
      if (part.g) {
        part.g.forEach(function (gg) {
          var op = gg[0], fn = GATEOPS[op], args = gg.slice(1, -1), outName = gg[gg.length - 1];
          r = op === 'not' ? (~get(args[0]) & 1) : get(args[0]);
          for (k = 1; k < args.length; k++) r = fn(r, get(args[k])) & 1;
          o[outName] = sig(r & 1);
        });
      }
      if (part.special === 'dff2') {
        ['1', '2'].forEach(function (n) {
          var pre = get(n + 'PREn'), clr = get(n + 'CLRn'), c = get(n + 'CLK'), key = n === '1' ? 'q1' : 'q2', ck = n === '1' ? '_c1' : '_c2';
          if (!pre && clr) st[key] = 1;
          else if (!clr) st[key] = 0;
          else if (st[ck] === 0 && c === 1) st[key] = get(n + 'D');
          st[ck] = c;
          o[n + 'Q'] = sig(st[key]); o[n + 'Qn'] = sig(st[key] ? 0 : 1);
        });
      }
      if (part.special === 'dec38') {
        var a = get('A') | (get('B') << 1) | (get('C') << 2);
        var en = get('G1') && !get('G2An') && !get('G2Bn');
        for (k = 0; k < 8; k++) o['Y' + k + 'n'] = sig((en && a === k) ? 0 : 1);
      }
      if (part.special === 'mux4') {
        var sel = get('SEL'), strobe = get('Gn');
        for (k = 1; k <= 4; k++) o[k + 'Y'] = sig(strobe ? 0 : get(k + (sel ? 'B' : 'A')));
      }
      return o;
    }
  });

  /* ================= HDL 自定义元件 ================= */
  register({
    type: 'hdl', name: 'HDL 元件', cat: 'HDL 元件', shape: 'hdl', hw: 4,
    hh: function (p) { return Math.max(3, ((p.hdlPorts || []).length || 4) + 1); },
    props: { name: 'my_module', lang: 'verilog', code: '', hdlPorts: [] },
    hdl: true,
    propDefs: [],
    pins: function (p) {
      var ports = p.hdlPorts || [], ins = ports.filter(function (x) { return x.dir === 'in'; }), outs = ports.filter(function (x) { return x.dir === 'out'; });
      var a = ins.map(function (x, idx) { return P(x.name, -5, 2 * idx - (ins.length - 1), 'in', x.bits, -1, 0); });
      a = a.concat(outs.map(function (x, idx) { return P(x.name, 5, 2 * idx - (outs.length - 1), 'out', x.bits, 1, 0); }));
      return a;
    },
    init: function () { return { regs: {}, _edge: {} }; },
    eval: function (i, st, p, ctx) {
      if (!p.hdlIR) return {};
      var H = DIG.HDL;
      try { return H.runIR(p.hdlIR, i, st, p, ctx); }
      catch (e) { ctx.error('HDL 元件 ' + p.name + ': ' + e.message); return {}; }
    }
  });

  L.allTypes = function () { return Object.keys(defs); };
  L.newComponent = function (type, x, y, props) {
    var d = defs[type]; if (!d) throw new Error('未知元件: ' + type);
    var c = { id: U.uid('c'), type: type, x: x, y: y, rot: 0, props: U.clone(d.props) };
    if (props) for (var k in props) c.props[k] = props[k];
    // 旧代码 / 旧脚本用 {bits, mode} 创建分线器：去掉默认分割规格，保持 bus + b0…bN 语义
    if (type === 'splitter' && props && props.mode !== undefined &&
        props.inSplit === undefined && props.outSplit === undefined) {
      delete c.props.inSplit; delete c.props.outSplit;
    }
    if (type === 'hdl' && props && props.hdlPorts) c.props.hdlPorts = U.clone(props.hdlPorts);
    return c;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
