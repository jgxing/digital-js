/* Digital.js - 电路分析：真值表、Quine-McCluskey 最小化、表达式综合、测试用例 */
(function (root) {
  'use strict';
  var DIG = (root.DIG = root.DIG || {});
  var U = DIG.Util, L = DIG.Lib;
  var A = (DIG.Analysis = {});

  function inputsOf(circuit) {
    return (circuit.components || []).filter(function (c) {
      return L.isInputPort(c) && ['clock', 'reset', 'const'].indexOf(c.type) < 0;
    });
  }
  function outputsOf(circuit) {
    return (circuit.components || []).filter(function (c) { return L.isOutputPort(c); });
  }
  function labelOf(c, i) { return (c.props.label || c.props.name || (c.type + i)).trim() || (c.type + i); }
  A.inputNames = function (circuit) { return inputsOf(circuit).map(labelOf); };
  A.outputNames = function (circuit) { return outputsOf(circuit).map(labelOf); };

  function evaluate(circuit, vector) {
    var sim = new DIG.Simulator(circuit);
    sim.powerOn();
    var dirty = false;
    for (var id in vector) if (sim.setInput(id, vector[id], false)) dirty = true;
    if (dirty) {
      sim.dirty.clear();
      for (var i = 0; i < sim.cs.length; i++) sim.dirty.add(i);
      sim.settle(300);
    }
    return { sim: sim, outputs: outputsOf(circuit).map(function (c) { return sim.outputValue(c); }) };
  }
  A.evaluate = evaluate;

  /** 由电路推导真值表（仅组合逻辑可靠） */
  A.truthTable = function (circuit, maxRows) {
    maxRows = maxRows || 1024;
    var ins = inputsOf(circuit), outs = outputsOf(circuit);
    var seq = (circuit.components || []).filter(function (c) {
      return ['dff', 'jkff', 'tff', 'rsff', 'register', 'counter', 'ram', 'rom'].indexOf(c.type) >= 0 ||
        (c.type === 'ic74' && c.props.part === '7474') ||
        (c.type === 'hdl' && c.props.hdlIR && c.props.hdlIR.seq && c.props.hdlIR.seq.length);
    });
    if (!ins.length) return { error: '电路中没有可分析的输入元件（开关 / 输入端口）' };
    if (!outs.length) return { error: '电路中没有可分析的输出元件（LED / 探针 / 输出端口）' };
    var totalBits = ins.reduce(function (s, c) { return s + (c.type === 'const' ? c.props.bits || 1 : (c.props.bits || 1)); }, 0);
    var rows = Math.pow(2, Math.min(totalBits, 20));
    if (rows > maxRows) return { error: '输入组合共 ' + rows + ' 行，超过上限 ' + maxRows + '（请减少输入位宽）' };
    var table = [];
    for (var r = 0; r < rows; r++) {
      var bit = 0, vec = {}, iv = [];
      for (var k = 0; k < ins.length; k++) {
        var c = ins[k], b = c.props.bits || 1;
        var v = (r >>> bit) & U.mask(b);
        bit += b;
        vec[c.id] = v; iv.push(v);
      }
      var res = evaluate(circuit, vec);
      table.push({ in: iv, out: res.outputs.slice(), osc: res.sim.oscillation });
    }
    return {
      inputs: ins.map(function (c, i) { return { name: labelOf(c, i), bits: c.props.bits || 1, id: c.id }; }),
      outputs: outs.map(function (c, i) { return { name: labelOf(c, i), bits: c.props.bits || 1, id: c.id }; }),
      rows: table, sequential: seq.length > 0,
      warning: seq.length ? '电路含时序元件，真值表仅反映当前上电状态，建议使用「测试用例」验证' : ''
    };
  };

  /* ---------- Quine-McCluskey ---------- */
  function popcount(x) { var n = 0; while (x) { x &= x - 1; n++; } return n; }
  A.minimize = function (minterms, dontcares, n) {
    n = n || 8;
    var all = minterms.concat(dontcares || []);
    if (!minterms.length) return { terms: [], expr: '0' };
    if (!dontcares || !dontcares.length) { }
    var cur = all.map(function (v) { return { v: v, m: 0 }; });
    var primes = [];
    var seen = {};
    for (var guard = 0; guard < 32 && cur.length; guard++) {
      cur.forEach(function (x) { seen[x.v + ':' + x.m] = 1; });
      var groups = {};
      cur.forEach(function (x) {
        var g = popcount(x.v & ~x.m);
        (groups[g] = groups[g] || []).push(x);
      });
      var next = [], used = {};
      var keys = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; });
      keys.forEach(function (g) {
        (groups[g] || []).forEach(function (a) {
          (groups[g + 1] || []).forEach(function (b) {
            if (a.m !== b.m) return;
            var d = (a.v ^ b.v);
            if (!d || (d & (d - 1)) || (d & a.m)) return;
            used[a.v + ':' + a.m] = 1; used[b.v + ':' + b.m] = 1;
            next.push({ v: a.v & ~d, m: a.m | d });
          });
        });
      });
      cur.forEach(function (x) { if (!used[x.v + ':' + x.m]) primes.push(x); });
      var dedup = {}, nn = [];
      next.forEach(function (x) { var k = x.v + ':' + x.m; if (!dedup[k]) { dedup[k] = 1; nn.push(x); } });
      cur = nn;
    }
    var pk = {}, uniqPrimes = [];
    primes.forEach(function (p) { var k = p.v + ':' + p.m; if (!pk[k]) { pk[k] = 1; uniqPrimes.push(p); } });
    // 覆盖表
    var cover = minterms.map(function (mt) {
      return uniqPrimes.map(function (p, i) { return ((mt & ~p.m) === p.v) ? i : -1; }).filter(function (i) { return i >= 0; });
    });
    var chosen = {}, remaining = minterms.map(function (_, i) { return i; });
    // 必要质蕴涵项
    cover.forEach(function (c) { if (c.length === 1) chosen[c[0]] = 1; });
    function satisfied(i) { return cover[i].some(function (p) { return chosen[p]; }); }
    remaining = remaining.filter(function (i) { return !satisfied(i); });
    while (remaining.length) {
      var best = -1, bestScore = -1;
      uniqPrimes.forEach(function (p, pi) {
        if (chosen[pi]) return;
        var score = remaining.filter(function (i) { return cover[i].indexOf(pi) >= 0; }).length;
        if (score > bestScore) { bestScore = score; best = pi; }
      });
      if (best < 0 || bestScore <= 0) break;
      chosen[best] = 1;
      remaining = remaining.filter(function (i) { return !satisfied(i); });
    }
    var terms = Object.keys(chosen).map(function (k) { return uniqPrimes[+k]; });
    return { terms: terms, expr: A.termsToExpr(terms, n) };
  };
  A.termsToExpr = function (terms, n, names) {
    if (!terms || !terms.length) return '0';
    names = names || Array.from({ length: n }, function (_, i) { return String.fromCharCode(65 + i); });
    var all = U.mask(n);
    return terms.map(function (t) {
      if ((t.m & all) === all) return '1';
      var lits = [];
      for (var i = 0; i < n; i++) {
        if (t.m & (1 << i)) continue;
        var nm = names[i] || ('x' + i);
        lits.push(((t.v >> i) & 1) ? nm : '~' + nm);
      }
      return lits.length === 1 ? lits[0] : '(' + lits.join(' & ') + ')';
    }).join(' | ');
  };

  /** 从真值表为每个输出生成最简与或表达式 */
  A.expressions = function (tt) {
    if (!tt || !tt.rows) return [];
    var bits = tt.inputs.reduce(function (s, i) { return s + i.bits; }, 0);
    var names = [];
    tt.inputs.forEach(function (i) { for (var k = 0; k < i.bits; k++) names.push(i.bits > 1 ? i.name + k : i.name); });
    return tt.outputs.map(function (o, oi) {
      var minterms = [];
      tt.rows.forEach(function (row, r) { if ((row.out[oi] >>> 0) & 1) minterms.push(r); });
      var mm = A.minimize(minterms, [], bits);
      return { name: o.name, expr: A.termsToExpr(mm.terms, bits, names), terms: mm.terms, bits: bits, names: names };
    });
  };

  /** 由布尔表达式生成门级电路（复用 HDL 表达式编译器） */
  A.circuitFromExpression = function (expr, inputNames, outputName) {
    var ins = (inputNames && inputNames.length ? inputNames : ['A', 'B', 'C']).map(function (n) { return 'input ' + String(n).replace(/[^A-Za-z0-9_]/g, '_'); });
    var src = 'module expr_circuit(' + ins.join(', ') + ', output ' + (outputName || 'Y') + ');\n' +
      '  assign ' + (outputName || 'Y') + ' = ' + expr + ';\nendmodule';
    var mod = DIG.HDL.compile(src, 'verilog');
    var g = DIG.HDL.importGates(mod, src);
    g.circuit.name = '表达式综合: ' + (outputName || 'Y');
    return g.circuit;
  };

  /** 由真值表生成组合电路 */
  A.circuitFromTruthTable = function (tt, outputIndex) {
    var ex = A.expressions(tt)[outputIndex || 0];
    if (!ex) return null;
    return A.circuitFromExpression(ex.expr, ex.names, ex.name);
  };

  /* ---------- 测试用例 ---------- */
  /** 
   * 格式：首行用 | 分隔输入名与输出名，例如:
   *   a b clk | y
   *   0 0 0 | 0
   *   0 0 1 | 1
   * 支持 # 注释、x/X 忽略、0x/0b 数值
   */
  A.parseTests = function (text) {
    var lines = (text || '').split(/\r?\n/).map(function (l) { return l.replace(/#.*$/, '').trim(); }).filter(Boolean);
    if (!lines.length) return { error: '测试用例为空' };
    var head = lines[0].split('|');
    if (head.length !== 2) return { error: '首行格式应为：输入名1 输入名2 ... | 输出名1 输出名2 ...' };
    var ic = head[0].trim().split(/\s+/).filter(Boolean), oc = head[1].trim().split(/\s+/).filter(Boolean);
    if (!ic.length || !oc.length) return { error: '首行需要同时包含输入列和输出列' };
    var rows = lines.slice(1).map(function (l) {
      var p = l.split('|');
      return { in: (p[0] || '').trim().split(/\s+/).filter(Boolean), out: (p[1] || '').trim().split(/\s+/).filter(Boolean) };
    }).filter(function (r) { return r.in.length === ic.length; });
    return { inCols: ic, outCols: oc, rows: rows };
  };

  A.runTests = function (circuit, text) {
    var spec = A.parseTests(text);
    if (spec.error) return { error: spec.error };
    var ins = inputsOf(circuit), outs = outputsOf(circuit);
    var inMap = {}, outMap = {};
    ins.forEach(function (c, i) { inMap[labelOf(c, i).toLowerCase()] = c; });
    outs.forEach(function (c, i) { outMap[labelOf(c, i).toLowerCase()] = c; });
    var missingIn = spec.inCols.filter(function (n) { return !inMap[n.toLowerCase()]; });
    var missingOut = spec.outCols.filter(function (n) { return !outMap[n.toLowerCase()]; });
    if (missingIn.length || missingOut.length) return { error: '找不到对应元件：' + missingIn.concat(missingOut).join(', ') };
    var sim = new DIG.Simulator(circuit);
    sim.powerOn();
    var prev = {};
    var results = [];
    spec.rows.forEach(function (row, ri) {
      var clkRise = false;
      spec.inCols.forEach(function (name, k) {
        var raw = row.in[k] === undefined ? '0' : row.in[k];
        var v = U.parseNum(raw.replace(/^0b/i, '0b'));
        var c = inMap[name.toLowerCase()];
        sim.setInput(c.id, v, false);
        if (/^(clk|clock|clk_i)$/i.test(name) && (prev[name] || 0) === 0 && v === 1) clkRise = true;
        prev[name] = v;
      });
      sim.dirty.clear();
      for (var i = 0; i < sim.cs.length; i++) sim.dirty.add(i);
      sim.settle(300);
      if (clkRise) sim.stepTick(1);
      var actual = spec.outCols.map(function (name) { return sim.outputValue(outMap[name.toLowerCase()]); });
      var expected = spec.outCols.map(function (name, k) { return U.parseNum(row.out[k] === undefined ? '0' : row.out[k]); });
      var pass = spec.outCols.every(function (name, k) {
        var e = row.out[k];
        return /^[xX?]$/.test(e || '') || expected[k] === actual[k];
      });
      results.push({ line: ri + 2, in: row.in, expected: row.out, actual: actual, pass: pass });
    });
    return {
      inCols: spec.inCols, outCols: spec.outCols, rows: results,
      passed: results.filter(function (r) { return r.pass; }).length, total: results.length,
      errors: sim.errors.slice()
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
