/* Digital.js - Verilog / VHDL 前端：词法、表达式、语句、IR 及 IR 仿真执行 */
(function (root) {
  'use strict';
  var DIG = (root.DIG = root.DIG || {});
  var U = DIG.Util;
  var H = (DIG.HDL = DIG.HDL || {});

  /* ==================== 词法分析 ==================== */
  var VHDL_WORDOPS = {
    and: '&', or: '|', xor: '^', nand: '~&', nor: '~|', xnor: '~^', not: '~',
    mod: '%', rem: '%', abs: '$abs'
  };
  var OPS3 = ['===', '!==', '<<<', '>>>', '~&', '~|', '~^', '^~'];
  var OPS2 = ['<=', '>=', '==', '!=', '/=', '=>', ':=', '<<', '>>', '&&', '||', '**', '++', '~&', '~|', '~^', '^~'];

  function tokenize(src, lang) {
    var toks = [], i = 0, n = src.length, vhdl = lang === 'vhdl';
    function wordAt(k) { return /[A-Za-z_$0-9]/.test(src[k] || ''); }
    while (i < n) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (src.substr(i, 2) === '//' || (vhdl && src.substr(i, 2) === '--')) {
        var e = src.indexOf('\n', i); i = e < 0 ? n : e + 1; continue;
      }
      if (src.substr(i, 2) === '/*') { var e2 = src.indexOf('*/', i + 2); i = e2 < 0 ? n : e2 + 2; continue; }
      // 数字
      if (/[0-9]/.test(c)) {
        var m = src.slice(i).match(/^([0-9_]+)'([sS]?)([bBoOdDhH])([0-9a-fA-F_xXzZ?]+)/);
        if (!vhdl && m) {
          toks.push({ t: 'num', v: parseVLit(m[0]), bits: parseInt(m[1], 10) || 32, raw: m[0] });
          i += m[0].length; continue;
        }
        if (vhdl && (c === 'X' || c === 'x') === false) {
          // 整数或基于进制的字面量 X"FF" / 16#FF#
          var hm = src.slice(i).match(/^([xXbBoO])"([0-9a-fA-F_]+)"/);
          if (hm) {
            var rad = { x: 16, b: 2, o: 8 }[hm[1].toLowerCase()];
            toks.push({ t: 'num', v: parseInt(hm[2].replace(/_/g, ''), rad) >>> 0, bits: hm[2].replace(/_/g, '').length * (rad === 16 ? 4 : rad === 8 ? 3 : 1), raw: hm[0] });
            i += hm[0].length; continue;
          }
        }
        var nm = src.slice(i).match(/^[0-9][0-9_]*/);
        toks.push({ t: 'num', v: parseInt(nm[0].replace(/_/g, ''), 10) >>> 0, bits: 32, raw: nm[0] });
        i += nm[0].length; continue;
      }
      if (!vhdl && c === "'" && /[bBoOdDhH]/.test(src[i + 1] || '')) {
        var um = src.slice(i).match(/^'[sS]?[bBoOdDhH][0-9a-fA-F_xXzZ?]+/);
        if (um) { toks.push({ t: 'num', v: parseVLit('32' + um[0]), bits: 32, raw: um[0] }); i += um[0].length; continue; }
      }
      if (vhdl && c === "'" && src[i + 2] === "'") {
        var lit = src[i + 1];
        toks.push({ t: 'num', v: lit === '1' || lit === 'H' ? 1 : 0, bits: 1, raw: src.substr(i, 3) });
        i += 3; continue;
      }
      if (c === '"') {
        var j = i + 1; while (j < n && src[j] !== '"') j++;
        toks.push({ t: 'str', v: src.slice(i + 1, j), raw: src.slice(i, j + 1) });
        i = j + 1; continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        var k = i + 1; while (k < n && /[A-Za-z_$0-9]/.test(src[k])) k++;
        var w = src.slice(i, k), lw = w.toLowerCase();
        if (vhdl && VHDL_WORDOPS[lw] !== undefined) {
          toks.push({ t: 'op', v: VHDL_WORDOPS[lw], raw: w });
        } else toks.push({ t: 'id', v: w, raw: w });
        i = k; continue;
      }
      var three = src.substr(i, 3), two = src.substr(i, 2);
      if (OPS3.indexOf(three) >= 0) { toks.push({ t: 'op', v: three, raw: three }); i += 3; continue; }
      if (OPS2.indexOf(two) >= 0) {
        var op = two;
        if (vhdl && op === '&') op = '++';       // VHDL 的 & 是拼接
        if (vhdl && op === '=') op = '==';
        toks.push({ t: 'op', v: op, raw: two }); i += 2; continue;
      }
      if (vhdl && c === '=') { toks.push({ t: 'op', v: '==', raw: '=' }); i++; continue; }
      if (vhdl && c === '&') { toks.push({ t: 'op', v: '++', raw: '&' }); i++; continue; }
      if (c === ':' && vhdl && src[i + 1] === '=') { toks.push({ t: 'op', v: ':=', raw: ':=' }); i += 2; continue; }
      toks.push({ t: 'op', v: c, raw: c });
      i++;
    }
    toks.push({ t: 'eof', v: '' });
    return toks;
  }
  H.tokenize = tokenize;
  function parseVLit(s) {
    var m = ('' + s).match(/(?:(\d+))?'([sS]?)([bBoOdDhH])([0-9a-fA-F_xXzZ?]+)/);
    if (!m) return 0;
    var rad = { b: 2, o: 8, d: 10, h: 16 }[m[3].toLowerCase()] || 10;
    return parseInt(m[4].replace(/_/g, '').replace(/[xXzZ?]/g, '0'), rad) >>> 0;
  }

  /* ==================== 表达式语法分析（Pratt） ==================== */
  var PREC = {
    '?': 1, '||': 2, '&&': 3, '|': 4, '~|': 4, '^': 5, '^~': 5, '~^': 5,
    '&': 6, '~&': 6, '==': 7, '!=': 7, '===': 7, '!==': 7,
    '<': 8, '<=': 8, '>': 8, '>=': 8, '<<': 9, '>>': 9, '<<<': 9, '>>>': 9,
    '+': 10, '-': 10, '++': 10, '*': 11, '/': 11, '%': 11, '**': 13
  };
  var UNARY = ['~', '!', '-', '+', '&', '|', '^', '~&', '~|', '~^', '$abs'];

  function Parser(toks, lang, ir) { this.t = toks; this.p = 0; this.lang = lang; this.ir = ir; }
  Parser.prototype.peek = function (o) {
    var i = this.p + (o || 0);
    return this.t[i < this.t.length ? i : this.t.length - 1];
  };
  Parser.prototype.next = function () {
    if (this.p >= this.t.length - 1) return this.t[this.t.length - 1];
    return this.t[this.p++];
  };
  Parser.prototype.is = function (v) {
    var t = this.peek(); if (!t) return false;
    var s = String(t.v == null ? '' : t.v);
    return s === v || s.toLowerCase() === v;
  };
  Parser.prototype.eat = function (v) { if (this.is(v)) { this.p++; return true; } return false; };
  Parser.prototype.expect = function (v) { if (!this.eat(v)) throw new Error('HDL 语法错误：期望 "' + v + '"，实际 "' + (this.peek().raw || this.peek().v) + '"（第 ' + this.p + ' 个记号）'); };
  Parser.prototype.skipTo = function (v) {
    var depth = 0;
    while (this.peek().t !== 'eof') {
      var t = this.peek();
      if ('([{'.indexOf(t.v) >= 0) depth++;
      if (')]}'.indexOf(t.v) >= 0) depth--;
      if (depth === 0 && this.is(v)) return;
      this.p++;
    }
  };
  Parser.prototype.parseExpr = function (min) {
    min = min || 0;
    var left = this.parsePrefix();
    for (;;) {
      var t = this.peek();
      if (!t || t.t === 'eof') break;
      var op = t.v;
      if (op === '?' && min <= 1) {
        this.next();
        var a = this.parseExpr(0);
        this.expect(':');
        var b = this.parseExpr(1);
        left = { t: '?:', c: left, a: a, b: b };
        continue;
      }
      var pr = PREC[op];
      if (pr === undefined || pr < min) break;
      this.next();
      var right = this.parseExpr(pr + 1);
      left = { t: 'bin', op: op, a: left, b: right };
    }
    return left;
  };
  Parser.prototype.parsePrefix = function () {
    var t = this.next();
    if (!t) throw new Error('表达式意外结束');
    if (t.t === 'num') return { t: 'num', v: t.v, bits: t.bits || 32 };
    if (t.t === 'str') return { t: 'num', v: parseInt(t.v.replace(/[xXzZ?]/g, '0') || '0', t.v.length && /^[01]+$/.test(t.v) ? 2 : 16) >>> 0, bits: t.v.length * (/^[01]+$/.test(t.v) ? 1 : 4) };
      if (t.t === 'op' && UNARY.indexOf(t.v) >= 0) {
        var a = this.parseExpr(12);
        var REDUCE = { '&': 1, '|': 1, '^': 1, '~&': 1, '~|': 1, '~^': 1, '^~': 1 };
        if (REDUCE[t.v]) return { t: 'reduce', op: t.v, a: a };
        return { t: 'un', op: t.v, a: a };
      }
    if (t.v === '(') { var e = this.parseExpr(0); this.expect(')'); return this.parsePostfix(e); }
    if (t.v === '{') {
      if (this.peek().t === 'num' && this.peek(1).v === '{') {
        var cnt = this.next().v; this.next();
        var part = this.parseExpr(0); this.expect('}'); this.expect('}');
        return { t: 'rep', n: cnt, a: part };
      }
      var parts = [];
      if (!this.is('}')) for (;;) { parts.push(this.parseExpr(0)); if (!this.eat(',')) break; }
      this.expect('}');
      return { t: 'concat', parts: parts };
    }
    if (t.t === 'id') {
      var name = t.v;
      if (this.is('(')) {
        this.next();
        var args = [];
        if (!this.is(')')) for (;;) { args.push(this.parseExpr(0)); if (!this.eat(',')) break; }
        this.expect(')');
        var low = name.toLowerCase();
        if (low === 'rising_edge' || low === 'falling_edge') {
          return { t: 'edge', name: args[0] && args[0].name || 'clk', neg: low === 'falling_edge' };
        }
        if (['unsigned', 'signed', 'std_logic_vector', 'to_unsigned', 'integer', 'conv_integer', 'to_integer', 'others'].indexOf(low) >= 0) {
          return args[0] || { t: 'num', v: 0, bits: 32 };
        }
        return { t: 'call', name: name, args: args };
      }
      var node = { t: 'id', name: name };
      return this.parsePostfix(node);
    }
    if (t.v === ';') return { t: 'num', v: 0, bits: 32 };
    throw new Error('无法解析的记号 "' + (t.raw || t.v) + '"');
  };
  Parser.prototype.parsePostfix = function (node) {
    if (this.is('[')) {
      this.next();
      var hi = this.parseExpr(0), lo = hi, ranged = false;
      if (this.eat(':')) { lo = this.parseExpr(0); ranged = true; }
      else if (this.eat('+:') || this.eat('-:')) { lo = hi; ranged = true; }
      this.expect(']');
      // mem[addr]：若该名字是已声明的存储器，生成「存储器读」节点而不是位选
      if (!ranged && node.name && this.ir && this.ir.memories &&
        this.ir.memories.some(function (m) { return m.name === node.name; })) {
        return { t: 'mrd', name: node.name, idx: hi };
      }
      return { t: 'sel', name: node.name, hi: hi, lo: lo };
    }
    if (this.is('(')) { // VHDL: a(3) 位选
      this.next(); var idx = this.parseExpr(0); this.expect(')');
      return { t: 'sel', name: node.name, hi: idx, lo: idx };
    }
    return node;
  };
  H.Parser = Parser;

  /* ==================== 表达式求值 / 位宽 ==================== */
  function widthOf(e, ir) {
    if (!e) return 1;
    switch (e.t) {
      case 'id': return (ir.widths[e.name] || 1);
      case 'num': return e.bits || 32;
      case 'mrd': {
        var md = (ir.memories || []).filter(function (m) { return m.name === e.name; })[0];
        return md ? md.bits : 32;
      }
      case 'sel': {
        try { var h = evalE(e.hi, {}, ir) >>> 0, l = evalE(e.lo, {}, ir) >>> 0; return Math.abs(h - l) + 1; } catch (x) { return 1; }
      }
      case 'concat': return e.parts.reduce(function (s, p) { return s + widthOf(p, ir); }, 0);
      case 'rep': return e.n * widthOf(e.a, ir);
      case 'bin': return Math.max(widthOf(e.a, ir), widthOf(e.b, ir));
      case 'un': case 'reduce': return widthOf(e.a, ir);
      case '?:': return Math.max(widthOf(e.a, ir), widthOf(e.b, ir));
      default: return 32;
    }
  }
  function evalE(e, env, ir) {
    if (!e) return 0;
    var a, b, w;
    switch (e.t) {
      case 'num': return (e.v >>> 0);
      case 'id': return (env[e.name] || 0) >>> 0;
      case 'edge': return env['__edge_' + e.name] ? 1 : 0;
      case 'call': return 0;
      case 'mrd': {
        var ix = evalE(e.idx, env, ir) >>> 0;
        var md = (ir.memories || []).filter(function (m) { return m.name === e.name; })[0];
        var arr = env.__mems && env.__mems[e.name];
        if (!md || !arr) return 0;
        var a = ix - md.lo;
        if (a < 0 || a >= arr.length) return 0;
        return (arr[a] >>> 0) & U.mask(md.bits);
      }
      case 'sel': {
        var hi = evalE(e.hi, env, ir) >>> 0, lo = evalE(e.lo, env, ir) >>> 0;
        if (lo > hi) { var t = lo; lo = hi; hi = t; }
        var v = (env[e.name] || 0) >>> 0;
        return ((v >>> lo) & U.mask(hi - lo + 1)) >>> 0;
      }
      case 'concat': {
        var r = 0, shift = 0, bits = 0;
        for (var i = e.parts.length - 1; i >= 0; i--) {
          w = widthOf(e.parts[i], ir);
          r = (r + ((evalE(e.parts[i], env, ir) & U.mask(w)) * Math.pow(2, shift))) >>> 0;
          shift += w; bits += w;
        }
        return r >>> 0;
      }
      case 'rep': {
        w = widthOf(e.a, ir); var rv = 0, one = evalE(e.a, env, ir) & U.mask(w);
        for (var k = 0; k < e.n; k++) rv = (rv * Math.pow(2, w) + one) >>> 0;
        return rv >>> 0;
      }
      case '?:': return evalE(e.c, env, ir) ? evalE(e.a, env, ir) : evalE(e.b, env, ir);
      case 'un':
        a = evalE(e.a, env, ir);
        switch (e.op) {
          case '~': return ((~a) & U.mask(widthOf(e.a, ir))) >>> 0;
          case '!': return a ? 0 : 1;
          case '-': return (-a) >>> 0;
          case '$abs': return Math.abs(a) >>> 0;
          default: return a;
        }
      case 'reduce': {
        a = evalE(e.a, env, ir); w = widthOf(e.a, ir); var all = U.mask(w);
        switch (e.op) {
          case '&': return (a & all) === all ? 1 : 0;
          case '|': return (a & all) ? 1 : 0;
          case '^': { var p = 0, q = a; for (var z = 0; z < w; z++) p ^= (q >> z) & 1; return p; }
          case '~&': return (a & all) === all ? 0 : 1;
          case '~|': return (a & all) ? 0 : 1;
          case '~^': { var p2 = 1, q2 = a; for (var z2 = 0; z2 < w; z2++) p2 ^= (q2 >> z2) & 1; return p2 ? 0 : 1; }
        }
        return a;
      }
      case 'bin': {
        a = evalE(e.a, env, ir); b = evalE(e.b, env, ir);
        switch (e.op) {
          case '&': return (a & b) >>> 0; case '|': return (a | b) >>> 0; case '^': return (a ^ b) >>> 0;
          case '~&': return ((~(a & b)) & U.mask(Math.max(widthOf(e.a, ir), widthOf(e.b, ir)))) >>> 0;
          case '~|': return ((~(a | b)) & U.mask(Math.max(widthOf(e.a, ir), widthOf(e.b, ir)))) >>> 0;
          case '^~': case '~^': return ((~(a ^ b)) & U.mask(Math.max(widthOf(e.a, ir), widthOf(e.b, ir)))) >>> 0;
          case '&&': return (a && b) ? 1 : 0; case '||': return (a || b) ? 1 : 0;
          case '==': case '===': return a === b ? 1 : 0; case '!=': case '!==': return a !== b ? 1 : 0;
          case '<': return a < b ? 1 : 0; case '<=': return a <= b ? 1 : 0;
          case '>': return a > b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
          case '<<': case '<<<': return (a << (b & 31)) >>> 0; case '>>': return a >>> (b & 31);
          case '>>>': return a >> (b & 31);
          case '+': return (a + b) >>> 0; case '-': return (a - b) >>> 0;
          case '*': return Math.imul(a, b) >>> 0;
          case '/': return b ? Math.floor(a / b) >>> 0 : 0;
          case '%': return b ? (a % b) >>> 0 : 0;
          case '**': return Math.pow(a, b) >>> 0;
          case '++': { // VHDL 拼接
            w = widthOf(e.b, ir);
            return ((a * Math.pow(2, w)) + (b & U.mask(w))) >>> 0;
          }
        }
        return 0;
      }
    }
    return 0;
  }
  H.evalE = evalE; H.widthOf = widthOf;

  /* ==================== 语句解析 ==================== */
  function lhsOf(P) {
    var e = P.parsePrefix();
    if (e.t === 'id') return { name: e.name, sel: null };
    if (e.t === 'mrd') return { name: null, mem: { name: e.name, idx: e.idx } };
    if (e.t === 'sel') return { name: e.name, sel: e };
    if (e.t === 'concat') return { name: null, concat: e };
    return { name: e.name || null, sel: null };
  }
  function parseVStmts(P, endWords) {
    var out = [];
    while (P.peek().t !== 'eof') {
      if (endWords.some(function (w) { return P.is(w); })) break;
      var t = P.peek();
      // case 标签（2'b00: / label: / default:）开始新分支
      if ((t.t === 'num' || t.t === 'id' || t.t === 'str') && P.peek(1).v === ':') break;
      if ((t.t === 'id' || t.t === 'op') && (P.is('begin') || P.is('{'))) { P.next(); var inner = parseVStmts(P, P.is('end') ? ['end'] : ['}']); P.eat('end'); P.eat('}'); out = out.concat(inner); continue; }
      if (P.is('if')) {
        P.next(); P.expect('('); var cond = P.parseExpr(0); P.expect(')');
        var th = parseVOne(P), el = [];
        if (P.eat('else')) el = parseVOne(P);
        out.push({ t: 'if', cond: cond, then: th, else: el }); continue;
      }
      if (P.is('case') || P.is('casez') || P.is('casex')) {
        P.next(); P.expect('('); var ce = P.parseExpr(0); P.expect(')');
        var cases = [], def = [];
        while (!P.is('endcase') && P.peek().t !== 'eof') {
          if (P.eat('default')) { P.eat(':'); def = def.concat(parseVStmts(P, ['default', 'endcase']).concat(parseVOneTail(P))); continue; }
          var labels = [];
          do { labels.push(P.parseExpr(0)); } while (P.eat(','));
          P.expect(':');
          var body = parseVStmts(P, ['default', 'endcase']);
          labels.forEach(function (l) { cases.push([l, body]); });
        }
        P.eat('endcase');
        out.push({ t: 'case', expr: ce, cases: cases, def: def }); continue;
      }
      if (P.is(';')) { P.next(); continue; }
      if (P.is('$display') || P.is('$write') || P.is('$monitor') || MEM_TASK_RE.test(P.peek().v || '')) { P.skipTo(';'); P.eat(';'); continue; }
      var lhs = lhsOf(P);
      if (!(P.eat('=') || P.eat('<=') || P.eat(':='))) { P.skipTo(';'); P.eat(';'); continue; }
      var expr = P.parseExpr(0); P.eat(';');
      out.push({ t: 'assign', lhs: lhs, expr: expr });
    }
    return out;
  }
  function parseVOneTail() { return []; }
  function parseVOne(P) {
    if (P.is('begin')) { P.next(); var s = parseVStmts(P, ['end']); P.eat('end'); return s; }
    if (P.is('{')) { P.next(); var s2 = parseVStmts(P, ['}']); P.eat('}'); return s2; }
    return parseVStmts(P, ['else', 'end', 'endcase', 'default', '}']);
  }

  function parseVHDLStmts(P, endWords) {
    var out = [];
    while (P.peek().t !== 'eof') {
      if (endWords.some(function (w) { return P.is(w); })) break;
      if (P.is('if')) {
        P.next();
        var cond = P.parseExprUntil(['then']); P.eat('then');
        var th = parseVHDLStmts(P, ['elsif', 'else', 'end']);
        var el = [];
        if (P.eat('elsif')) {
          var c2 = P.parseExprUntil(['then']); P.eat('then');
          var t2 = parseVHDLStmts(P, ['elsif', 'else', 'end']);
          el = [{ t: 'if', cond: c2, then: t2, else: [] }];
          while (P.eat('else')) { /* 已由下方处理 */ break; }
        }
        if (P.eat('else')) el = parseVHDLStmts(P, ['end']);
        P.eat('end'); P.eat('if'); P.eat(';');
        out.push({ t: 'if', cond: cond, then: th, else: el }); continue;
      }
      if (P.is('case')) {
        P.next(); var ce = P.parseExprUntil(['is']); P.eat('is');
        var cases = [], def = [];
        while (!P.is('end') && P.peek().t !== 'eof') {
          P.eat('when');
          if (P.is('others')) { P.next(); P.eat('=>'); def = def.concat(parseVHDLStmts(P, ['when', 'end'])); }
          else {
            var labels = [];
            do { labels.push(P.parseExprUntil(['=>', ',', '|', 'when', 'end'])); } while (P.eat('|') || P.eat(','));
            P.eat('=>');
            var body = parseVHDLStmts(P, ['when', 'end']);
            labels.forEach(function (l) { cases.push([l, body]); });
          }
        }
        P.eat('end'); P.eat('case'); P.eat(';');
        out.push({ t: 'case', expr: ce, cases: cases, def: def }); continue;
      }
      if (P.is('wait') || P.is('for') || P.is('null') || P.is('report')) { P.skipTo(';'); P.eat(';'); continue; }
      if (P.is(';')) { P.next(); continue; }
      var lhs = lhsOf(P);
      if (!P.eat('<=') && !P.eat(':=')) { P.skipTo(';'); P.eat(';'); continue; }
      var expr = P.parseExprUntil([';']); P.eat(';');
      out.push({ t: 'assign', lhs: lhs, expr: expr });
    }
    return out;
  }
  Parser.prototype.parseExprUntil = function (stops) {
    // 在指定顶层关键字处停止（不消耗它）
    var saved = this.p, depth = 0, e;
    var start = this.p;
    while (this.peek().t !== 'eof') {
      var t = this.peek();
      if ('([{'.indexOf(t.v) >= 0) depth++;
      else if (')]}'.indexOf(t.v) >= 0) { if (depth === 0) break; depth--; }
      if (depth === 0 && stops.some(function (s) { var tv = String(t.v == null ? '' : t.v); return tv === s || tv.toLowerCase() === s; })) break;
      if (depth === 0 && t.v === ';') break;
      this.p++;
    }
    var end = this.p;
    // 截出子记号流交给 Pratt 解析器
    var sub = this.t.slice(start, end).concat([{ t: 'eof', v: '' }]);
    var sp = new Parser(sub, this.lang, this.ir);
    try { e = sp.parseExpr(0); } catch (err) { e = { t: 'num', v: 0, bits: 32 }; }
    this.p = end;
    if (this.p === saved) this.p++;
    return e;
  };

  /* ==================== 模块解析 ==================== */
  function emptyIR(name, lang) {
    return {
      name: name, lang: lang, ports: [], regs: [], wires: [], params: {}, widths: {},
      memories: [], memInit: [],
      continuous: [], comb: [], seq: [], prims: [], submodules: [], errors: []
    };
  }

  /* ==================== 存储器初始化文件 ($readmemh / $readmemb) ==================== */
  // 兼容用户习惯的 $memreadh / $memreadb 别名
  var MEM_TASKS = {
    '$readmemh': 16, '$readmemb': 2, '$memreadh': 16, '$memreadb': 2
  };
  var MEM_TASK_RE = /^\$(?:readmem[hb]|memread[hb])$/i;

  /**
   * 解析 Verilog 存储器文件文本。
   * 支持：16/2 进制数值、空白/逗号分隔、// 与 /* *\/ 注释、
   *       @地址（十六进制，改变后续数据的装入地址）、x/z/? 未知位（按 0 处理）。
   * 返回 [{addr, v}]。
   */
  H.parseMemFile = function (text, radix) {
    var base = radix === 2 ? 2 : 16;
    var src = ('' + (text == null ? '' : text))
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\r\n]*/g, ' ')
      .replace(/#[^\r\n]*/g, ' ');
    var toks = src.split(/[\s,;]+/), out = [], addr = 0;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!t) continue;
      if (t.charAt(0) === '@') {
        var a = parseInt(t.slice(1).replace(/[xXzZ?]/g, '0'), 16);
        if (!isNaN(a)) addr = a >>> 0;
        continue;
      }
      var s = t.replace(/_/g, '').replace(/^0[xX]/, '').replace(/[xXzZ?]/g, '0');
      if (!s) continue;
      var v = parseInt(s, base);
      if (isNaN(v)) continue;
      out.push({ addr: addr++, v: v >>> 0 });
    }
    return out;
  };
  /** 从电路的数据文件表中按名字查找内容（支持路径与大小写回退） */
  H.resolveDataFile = function (files, name) {
    if (!files || !name) return null;
    if (Object.prototype.hasOwnProperty.call(files, name)) return files[name];
    var base = ('' + name).replace(/\\/g, '/').split('/').pop();
    var keys = Object.keys(files), i;
    for (i = 0; i < keys.length; i++) if (keys[i] === base) return files[keys[i]];
    for (i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === base.toLowerCase()) return files[keys[i]];
    return null;
  };
  /** 扫描 HDL 源码中被 $readmemh / $memreadh 等引用的文件名 */
  H.memFileRefs = function (code) {
    var refs = [], re = /\$(?:readmem[hb]|memread[hb])\s*\(\s*"([^"]+)"/gi, m;
    while ((m = re.exec('' + (code || '')))) if (refs.indexOf(m[1]) < 0) refs.push(m[1]);
    return refs;
  };

  function memRange(P) {
    // 已消耗 '['：解析 [hi:lo] 或 SV 的 [size]
    var hiE = P.parseExprUntil([':', ']']);
    var loE = null;
    if (P.eat(':')) loE = P.parseExprUntil([']']);
    P.eat(']');
    var ev = function (e) { try { return H.evalE(e, {}, { widths: {} }) >>> 0; } catch (x) { return 0; } };
    var hi = ev(hiE), lo = loE ? ev(loE) : 0;
    if (!loE) return { lo: 0, hi: Math.max(0, hi - 1), depth: Math.max(1, hi) };
    var a = Math.min(hi, lo), b = Math.max(hi, lo);
    return { lo: a, hi: b, depth: b - a + 1 };
  }

  function memArgNum(toks) {
    if (!toks || !toks.length) return null;
    try {
      var sp = new Parser(toks.concat([{ t: 'eof', v: '' }]), 'verilog', null);
      return H.evalE(sp.parseExpr(0), {}, { widths: {} }) >>> 0;
    } catch (e) { return null; }
  }

  /** 从 initial 块的记号流中提取 $readmemh(...) 调用 */
  function collectMemInit(ir, toks) {
    for (var i = 0; i < toks.length; i++) {
      var nm = (toks[i].v || '').toLowerCase();
      if (!MEM_TASK_RE.test(nm) || !toks[i + 1] || toks[i + 1].v !== '(') continue;
      var j = i + 2, args = [], cur = [], dep = 0;
      while (j < toks.length) {
        var t = toks[j];
        if ('([{'.indexOf(t.v) >= 0) dep++;
        else if (')]}'.indexOf(t.v) >= 0) { if (dep === 0) break; dep--; }
        if (t.v === ',' && dep === 0) { args.push(cur); cur = []; j++; continue; }
        cur.push(t); j++;
      }
      if (cur.length) args.push(cur);
      var file = args[0] && args[0][0] && args[0][0].t === 'str' ? args[0][0].v : '';
      var mem = args[1] && args[1][0] && args[1][0].t === 'id' ? args[1][0].v : '';
      if (file && mem) {
        ir.memInit.push({
          task: nm, file: file, mem: mem, radix: MEM_TASKS[nm],
          start: memArgNum(args[2]), end: memArgNum(args[3])
        });
      }
      i = j;
    }
  }
  function addPort(ir, name, dir, bits) {
    dir = ('' + dir).toLowerCase();
    dir = (dir === 'output' || dir === 'out') ? 'out' : 'in';
    var p = ir.ports.filter(function (x) { return x.name === name; })[0];
    if (p) { p.dir = dir; p.bits = bits; }
    else ir.ports.push({ name: name, dir: dir, bits: bits });
    ir.widths[name] = bits;
  }
  function widthFromRange(P) {
    if (!P.eat('[')) return 1;
    var hi = P.parseExpr(0), lo = hi;
    if (P.eat(':')) lo = P.parseExpr(0);
    P.eat(']');
    return Math.abs((hi.v || 0) - (lo.v || 0)) + 1;
  }
  function vhdlTypeBits(P) {
    if (P.is('std_logic') || P.is('std_ulogic') || P.is('bit') || P.is('boolean')) { P.next(); return 1; }
    if (P.is('integer') || P.is('natural') || P.is('positive')) { P.next(); return 32; }
    if (P.is('std_logic_vector') || P.is('unsigned') || P.is('signed') || P.is('bit_vector') || P.is('std_ulogic_vector')) {
      P.next();
      if (P.eat('(')) {
        var hi = P.parseExprUntil(['downto', 'to', ')']);
        P.eat('downto'); P.eat('to');
        var lo = P.parseExprUntil([')']);
        P.eat(')');
        try { return Math.abs(H.evalE(hi, {}, { widths: {} }) - H.evalE(lo, {}, { widths: {} })) + 1; } catch (e) { return 8; }
      }
      return 8;
    }
    // 未知类型，跳到 ';' 或 ':'
    while (P.peek().t !== 'eof' && !P.is(';') && !P.is(')') && !P.is(':')) P.next();
    return 1;
  }

  function parseVerilog(src) {
    src = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    var P = new Parser(tokenize(src, 'verilog'), 'verilog', null);
    var ir = emptyIR('top', 'verilog'); P.ir = ir;
    // 取第一个 module
    while (P.peek().t !== 'eof' && !P.is('module')) P.next();
    if (P.peek().t === 'eof') throw new Error('未找到 module 定义');
    P.next(); ir.name = P.next().v;
    if (P.eat('#')) { P.skipTo(')'); P.eat(')'); }  // 忽略参数列表
    if (P.eat('(')) {
      var start = P.p, depth = 1, ansi = false;
      while (depth > 0 && P.peek().t !== 'eof') {
        var t = P.next();
        if (t.v === '(') depth++; else if (t.v === ')') depth--;
        if (/^(input|output|inout)$/i.test(t.v)) ansi = true;
      }
      var portToks = P.t.slice(start, P.p - 1);
      if (ansi) {
        // 按顶层逗号切分： input [3:0] a, input b, output [7:0] y
        var segs = [[]], dep = 0;
        portToks.forEach(function (t) {
          if ('([{'.indexOf(t.v) >= 0) dep++;
          if (')]}'.indexOf(t.v) >= 0) dep--;
          if (t.v === ',' && dep === 0) { segs.push([]); return; }
          segs[segs.length - 1].push(t);
        });
        var curDir = 'input', curBits = 1;
        segs.forEach(function (seg) {
          if (!seg.length) return;
          var SP = new Parser(seg.concat([{ t: 'eof', v: '' }]), 'verilog', ir);
          var first = (SP.peek().v || '').toLowerCase();
          if (first === 'input' || first === 'output' || first === 'inout') {
            curDir = SP.next().v.toLowerCase();
            SP.eat('wire'); SP.eat('reg'); SP.eat('logic'); SP.eat('signed');
            curBits = widthFromRange(SP);
            SP.eat('reg'); SP.eat('logic');
          } else if (SP.peek().v === '[') curBits = widthFromRange(SP);
          var nm = '';
          while (SP.peek().t !== 'eof') { if (SP.peek().t === 'id') nm = SP.next().v; else SP.next(); }
          if (nm) addPort(ir, nm, curDir === 'inout' ? 'in' : curDir, curBits);
        });
      } else {
        portToks.filter(function (t) { return t.t === 'id'; }).forEach(function (t) { addPort(ir, t.v, 'in', 1); });
      }
      P.eat(';');
    }
    while (P.peek().t !== 'eof' && !P.is('endmodule')) {
      var w = (P.peek().v || '').toLowerCase();
      if (w === 'input' || w === 'output' || w === 'inout') {
        P.next(); P.eat('wire'); P.eat('logic'); P.eat('reg');
        var b = widthFromRange(P);
        P.eat('reg'); P.eat('logic'); P.eat('wire');
        var ns = [];
        do { if (P.is('=') || P.is(';')) break; ns.push(P.next().v); } while (P.eat(','));
        if (P.eat('=')) { P.parseExprUntil([';']); }
        P.eat(';');
        ns.forEach(function (nm) {
          addPort(ir, nm, w === 'inout' ? 'in' : w, b);
          if (!ir.regs.some(function (r) { return r.name === nm; })) ir.regs.push({ name: nm, bits: b, init: 0 });
        });
        continue;
      }
      if (w === 'wire' || w === 'reg' || w === 'logic' || w === 'tri') {
        P.next(); var bw = widthFromRange(P);
        var decls = [];
        for (;;) {
          if (P.is('=') || P.is(';')) break;
          if (P.peek().t !== 'id') { P.next(); continue; }
          var dn = P.next().v, mr = null;
          if (P.eat('[')) mr = memRange(P);       // reg [7:0] mem [0:255] 存储器数组
          decls.push({ name: dn, mem: mr });
          if (P.eat(',')) continue;
          break;
        }
        if (P.eat('=')) P.parseExprUntil([';']);
        P.eat(';');
        decls.forEach(function (d) {
          ir.widths[d.name] = bw;
          if (d.mem) {
            ir.memories.push({ name: d.name, bits: bw, lo: d.mem.lo, hi: d.mem.hi, depth: U.clamp(d.mem.depth, 1, 65536) });
          } else if (w === 'wire' || w === 'tri') ir.wires.push({ name: d.name, bits: bw });
          else ir.regs.push({ name: d.name, bits: bw, init: 0 });
        });
        continue;
      }
      if (w === 'parameter' || w === 'localparam') {
        P.next(); var pn = P.next().v; P.eat('=');
        var pv = P.parseExprUntil([';', ',']); P.eat(';');
        ir.params[pn] = H.evalE(pv, ir.params, ir); ir.widths[pn] = 32;
        continue;
      }
      if (w === 'assign') {
        P.next(); var lh = lhsOf(P); P.eat('=');
        var ex = P.parseExprUntil([';']); P.eat(';');
        ir.continuous.push({ lhs: lh, expr: ex });
        continue;
      }
      if (w === 'always' || w === 'always_ff' || w === 'always_comb' || w === 'always_latch') {
        P.next();
        var clocks = [], comb = (w === 'always_comb' || w === 'always_latch');
        if (P.eat('@')) {
          if (P.eat('(')) {
            if (P.eat('*')) comb = true;
            else {
              while (!P.is(')') && P.peek().t !== 'eof') {
                P.eat('or'); P.eat(',');
                var ed = 'pos';
                if (P.eat('posedge')) ed = 'pos'; else if (P.eat('negedge')) ed = 'neg';
                if (P.peek().t === 'id') clocks.push({ name: P.next().v, edge: ed });
                else P.next();
                P.eat('or'); P.eat(',');
              }
            }
            P.eat(')');
          } else if (P.eat('*')) comb = true;
        }
        P.eat('begin');
        var body = parseVStmts(P, ['end', 'endmodule']);
        P.eat('end');
        if (comb || !clocks.length) ir.comb.push({ stmts: body });
        else ir.seq.push({ clocks: clocks, stmts: body });
        continue;
      }
      if (w === 'initial') {
        P.next();
        var itoks = [];
        if (P.eat('begin')) {
          var idep = 1;
          while (P.peek().t !== 'eof' && idep > 0) {
            if (P.is('begin') || P.is('fork')) idep++;
            else if (P.is('end') || P.is('join')) { idep--; if (!idep) break; }
            itoks.push(P.next());
          }
          P.eat('end'); P.eat('join');
        } else {
          while (P.peek().t !== 'eof' && !P.is(';')) itoks.push(P.next());
          P.eat(';');
        }
        collectMemInit(ir, itoks);
        continue;
      }
      if (w === 'generate' || w === 'endgenerate' || w === 'specify' || w === 'defparam') { P.skipTo(';'); P.eat(';'); continue; }
      // 门级原语 / 模块实例化
      if (P.peek().t === 'id') {
        var prim = P.peek().v.toLowerCase();
        var GATEPRIMS = { and: 'and', nand: 'nand', or: 'or', nor: 'nor', xor: 'xor', xnor: 'xnor', not: 'not', buf: 'buffer', bufif0: 'tribuf', bufif1: 'tribuf' };
        if (GATEPRIMS[prim] !== undefined) {
          P.next();
          P.eat('#'); if (P.peek().v === '(') { P.next(); P.skipTo(')'); P.eat(')'); }
          var inst = '';
          if (P.peek().t === 'id' && !P.is('(')) inst = P.next().v;
          if (P.eat('(')) {
            var args = [];
            while (!P.is(')') && P.peek().t !== 'eof') {
              if (P.eat(',')) continue;
              if (P.peek().t === 'id') { args.push(P.next().v); if (P.eat('[')) P.skipTo(']'); }
              else if (P.peek().t === 'num') { args.push(P.next().raw); }
              else P.next();
            }
            P.eat(')'); P.eat(';');
            ir.prims.push({ op: GATEPRIMS[prim], name: inst, args: args });
            continue;
          }
          continue;
        }
        // 模块实例：Type inst ( .port(sig), ... );
        var modName = P.next().v, instName = '';
        P.eat('#'); if (P.is('(')) { P.next(); P.skipTo(')'); P.eat(')'); }
        if (P.peek().t === 'id') instName = P.next().v;
        if (P.is('(')) {
          P.next(); var conns = [];
          while (!P.is(')') && P.peek().t !== 'eof') {
            if (P.eat('.')) {
              var port = P.next().v; P.eat('(');
              var sig = P.peek().t === 'id' ? P.next().v : '';
              P.eat(')'); conns.push({ port: port, sig: sig });
            } else if (P.eat(',')) continue;
            else P.next();
          }
          P.eat(')'); P.eat(';');
          ir.submodules.push({ module: modName, name: instName, conns: conns });
          continue;
        }
        P.skipTo(';'); P.eat(';'); continue;
      }
      P.next();
    }
    return ir;
  }

  function parseVHDL(src) {
    src = src.replace(/--.*$/gm, '')
      .replace(/\b(\w+)\s*'\s*event\s+and\s+\1\s*=\s*'1'/gi, 'rising_edge($1)')
      .replace(/\b(\w+)\s*'\s*event\s+and\s+\1\s*=\s*'0'/gi, 'falling_edge($1)');
    // 去掉 library / use
    src = src.replace(/^\s*(library|use)\b[^;]*;/gim, '');
    var P = new Parser(tokenize(src, 'vhdl'), 'vhdl', null);
    var ir = emptyIR('top', 'vhdl'); P.ir = ir;
    while (P.peek().t !== 'eof' && !P.is('entity')) P.next();
    if (P.eat('entity')) {
      ir.name = P.next().v;
      while (!P.is('port') && P.peek().t !== 'eof') P.next();
      if (P.eat('port') && P.eat('(')) {
        var depth = 1, start = P.p;
        while (depth > 0 && P.peek().t !== 'eof') { var t = P.next(); if (t.v === '(') depth++; else if (t.v === ')') depth--; }
        var pt = P.t.slice(start, P.p - 1).concat([{ t: 'eof', v: '' }]);
        var PP = new Parser(pt, 'vhdl', ir);
        while (PP.peek().t !== 'eof') {
          var names = [];
          if (PP.is(';')) { PP.next(); continue; }
          do { if (PP.peek().t === 'eof') break; names.push(PP.next().v); } while (PP.eat(','));
          PP.eat(':');
          var dir = (PP.next().v || 'in').toLowerCase();
          var bits = vhdlTypeBits(PP);
          var def = null;
          if (PP.eat(':') && PP.eat('=')) def = PP.parseExprUntil([';', ')']);
          PP.eat(';');
          names.forEach(function (n) { addPort(ir, n, dir === 'out' ? 'out' : (dir === 'inout' ? 'in' : 'in'), bits); });
        }
        P.eat(')'); P.eat(';');
      }
      P.skipTo(';'); P.eat(';');   // end entity;
    }
    while (P.peek().t !== 'eof' && !P.is('architecture')) P.next();
    if (P.eat('architecture')) { P.next(); P.eat('of'); P.next(); P.eat('is'); }
    // 声明区
    while (P.peek().t !== 'eof' && !P.is('begin')) {
      var d = (P.peek().v || '').toLowerCase();
      if (d === 'signal') {
        P.next();
        var sn = [];
        do { sn.push(P.next().v); } while (P.eat(','));
        P.eat(':'); var sb = vhdlTypeBits(P);
        var initE = null;
        if (P.eat(':') && P.eat('=')) initE = P.parseExprUntil([';']);
        P.eat(';');
        sn.forEach(function (n) { ir.widths[n] = sb; ir.wires.push({ name: n, bits: sb }); });
        continue;
      }
      if (d === 'constant') {
        P.next(); var cn = P.next().v; P.eat(':'); vhdlTypeBits(P);
        P.eat(':'); P.eat('=');
        var cv = P.parseExprUntil([';']); P.eat(';');
        ir.params[cn] = H.evalE(cv, ir.params, ir); ir.widths[cn] = 32;
        continue;
      }
      if (d === 'component' || d === 'attribute' || d === 'type' || d === 'subtype' || d === 'function') { P.skipTo(';'); P.eat(';'); continue; }
      P.next();
    }
    P.eat('begin');
    // 并发语句区
    while (P.peek().t !== 'eof') {
      var w = (P.peek().v || '').toLowerCase();
      if (w === 'end') break;
      if (w === 'process') {
        P.next();
        var sens = [];
        if (P.eat('(')) { while (!P.is(')') && P.peek().t !== 'eof') { if (P.peek().t === 'id') sens.push(P.next().v); P.eat(','); } P.eat(')'); }
        // 跳过 process 的声明区（到 begin）
        while (!P.is('begin') && P.peek().t !== 'eof') P.next();
        P.eat('begin');
        var body = parseVHDLStmts(P, ['end']);
        P.eat('end'); P.eat('process'); P.eat(';');
        var seqBlock = null;
        if (body.length === 1 && body[0].t === 'if' && body[0].cond.t === 'edge') {
          seqBlock = { clocks: [{ name: body[0].cond.name, edge: body[0].cond.neg ? 'neg' : 'pos' }], stmts: body[0].then };
        } else if (body.length === 1 && body[0].t === 'if' && body[0].else.length === 1 && body[0].else[0].t === 'if') {
          // if rst then ... elsif rising_edge(clk) then ...
          var nested = body[0].else[0];
          if (nested.cond.t === 'edge') seqBlock = { clocks: [{ name: nested.cond.name, edge: nested.cond.neg ? 'neg' : 'pos' }], stmts: body };
        }
        if (seqBlock) ir.seq.push(seqBlock); else ir.comb.push({ stmts: body });
        continue;
      }
      if (w === 'with') {
        // with sel select y <= a when "00", b when others;
        P.next(); var sel = P.parseExprUntil(['select']); P.eat('select');
        var lh = lhsOf(P); P.eat('<=');
        var cs = [], df = [];
        for (;;) {
          var val = P.parseExprUntil(['when']); P.eat('when');
          var label = P.parseExprUntil([',', ';']);
          var st = [{ t: 'assign', lhs: lh, expr: val }];
          if (/others/i.test(label.rawLabel || '') || P.is('others')) { /* 下面统一处理 */ }
          if (P.eat(';')) { df = st; break; }
          if (P.eat(',')) {
            // 判断是否是 when others
            cs.push([label, st]);
            continue;
          }
          cs.push([label, st]); break;
        }
        // 简化：把 when others 视作默认（最后一项）
        if (cs.length) { df = cs.pop()[1]; }
        ir.comb.push({ stmts: [{ t: 'case', expr: sel, cases: cs, def: df }] });
        continue;
      }
      if (P.peek().t === 'id' && /^(\w+)\s*:/.test('')) { /* 占位 */ }
      // 标签实例：lab: entity work.foo ...
      if (P.peek().t === 'id' && P.peek(1).v === ':') {
        P.next(); P.next();
        if (P.is('entity') || P.is('component')) {
          var mod = '';
          while (!P.is('port') && P.peek().t !== 'eof') { if (P.peek().t === 'id') mod = P.next().v; else P.next(); }
          P.eat('port'); P.eat('map'); P.eat('(');
          var conns = [];
          while (!P.is(')') && P.peek().t !== 'eof') {
            if (P.eat(',')) continue;
            var port = P.next().v; P.eat('=>');
            var sig = P.next().v; conns.push({ port: port, sig: sig });
          }
          P.eat(')'); P.eat(';');
          ir.submodules.push({ module: mod, name: '', conns: conns });
          continue;
        }
      }
      // 并发信号赋值： y <= expr;  或 y <= a when cond else b;
      var lhsC = lhsOf(P);
      if (!P.eat('<=')) { P.skipTo(';'); P.eat(';'); continue; }
      var first = P.parseExprUntil(['when', ';']);
      if (P.eat('when')) {
        var condE = P.parseExprUntil(['else', ';']);
        var elseE = { t: 'num', v: 0, bits: 32 };
        while (P.eat('else')) {
          elseE = P.parseExprUntil(['when', ';']);
          if (P.eat('when')) {
            var c2 = P.parseExprUntil(['else', ';']);
            elseE = { t: '?:', c: c2, a: elseE, b: { t: 'num', v: 0, bits: 32 } };
          }
        }
        P.eat(';');
        ir.continuous.push({ lhs: lhsC, expr: { t: '?:', c: condE, a: first, b: elseE } });
      } else {
        P.eat(';');
        ir.continuous.push({ lhs: lhsC, expr: first });
      }
    }
    return ir;
  }

  H.parseVerilog = parseVerilog;
  H.parseVHDL = parseVHDL;

  /** 编译 HDL 源码 → 模块对象 */
  H.compile = function (code, lang) {
    lang = (lang || 'auto').toLowerCase();
    if (lang === 'auto') lang = /\bmodule\s+\w+/i.test(code) && !/\bentity\s+\w+\s+is\b/i.test(code) ? 'verilog' : 'vhdl';
    var ir;
    try { ir = lang === 'vhdl' ? parseVHDL(code) : parseVerilog(code); }
    catch (e) { throw new Error('HDL 解析失败：' + e.message); }
    if (!ir.ports.length) throw new Error('未找到任何端口声明（请检查 module / entity 端口列表）');
    // 未声明位宽的信号按 1 bit 处理；参数代入宽度表
    Object.keys(ir.params).forEach(function (k) { ir.widths[k] = 32; });
    return {
      name: ir.name, lang: lang, code: code, ir: ir,
      ports: ir.ports.map(function (p) { return { name: p.name, dir: p.dir, bits: Math.min(32, Math.max(1, p.bits | 0)) }; }),
      memFiles: (ir.memInit || []).map(function (m) { return m.file; })
    };
  };

  /* ==================== IR 执行 ==================== */
  function assignTo(env, lhs, val, ir) {
    if (lhs.mem) {
      var md = (ir.memories || []).filter(function (m) { return m.name === lhs.mem.name; })[0];
      var arr = env.__mems && env.__mems[lhs.mem.name];
      if (md && arr) {
        var ia = (evalE(lhs.mem.idx, env, ir) >>> 0) - md.lo;
        if (ia >= 0 && ia < arr.length) arr[ia] = (val >>> 0) & U.mask(md.bits);
      }
      return;
    }
    if (lhs.concat) {
      var shift = 0;
      for (var i = lhs.concat.parts.length - 1; i >= 0; i--) {
        var p = lhs.concat.parts[i], w = widthOf(p, ir);
        var nm = p.t === 'id' ? p.name : (p.t === 'sel' ? p.name : null);
        if (nm) env[nm] = ((val >>> shift) & U.mask(w)) >>> 0;
        shift += w;
      }
      return;
    }
    if (!lhs.name) return;
    var bits = ir.widths[lhs.name] || 1, m = U.mask(bits);
    if (lhs.sel) {
      var hi = evalE(lhs.sel.hi, env, ir) >>> 0, lo = evalE(lhs.sel.lo, env, ir) >>> 0;
      if (lo > hi) { var t = lo; lo = hi; hi = t; }
      var w = hi - lo + 1, sm = U.mask(w), old = env[lhs.name] || 0;
      env[lhs.name] = ((old & ~(sm << lo)) | ((val & sm) << lo)) >>> 0;
    } else env[lhs.name] = (val & m) >>> 0;
  }

  function execStmts(stmts, env, pending, ir) {
    for (var i = 0; i < stmts.length; i++) {
      var s = stmts[i];
      if (s.t === 'assign') {
        var v = evalE(s.expr, env, ir);
        if (pending) pending.push({ lhs: s.lhs, val: v });
        else assignTo(env, s.lhs, v, ir);
      } else if (s.t === 'if') {
        execStmts(evalE(s.cond, env, ir) ? s.then : (s.else || []), env, pending, ir);
      } else if (s.t === 'case') {
        var key = evalE(s.expr, env, ir), hit = false;
        for (var k = 0; k < s.cases.length; k++) {
          if (evalE(s.cases[k][0], env, ir) === key) { execStmts(s.cases[k][1], env, pending, ir); hit = true; break; }
        }
        if (!hit) execStmts(s.def || [], env, pending, ir);
      }
    }
  }

  function envHash(e) {
    var o = {};
    for (var k in e) if (k.indexOf('__') !== 0) o[k] = e[k];
    return JSON.stringify(o);
  }

  H.runIR = function (ir, inputs, st, props, ctx) {
    var env = {}, i, p;
    ctx = ctx || {};
    st.regs = st.regs || {}; st._edge = st._edge || {};
    // 存储器：首次求值时按声明建立数组，并装入 $readmemh / $readmemb 数据文件
    if (!st._memInit) {
      st.mems = st.mems || {};
      (ir.memories || []).forEach(function (m) {
        if (!st.mems[m.name] || st.mems[m.name].length !== m.depth) {
          var arr = new Array(m.depth);
          for (var z = 0; z < m.depth; z++) arr[z] = 0;
          st.mems[m.name] = arr;
        }
      });
      var files = ctx.dataFiles || (props && props.dataFiles) || null;
      (ir.memInit || []).forEach(function (mi) {
        var md = (ir.memories || []).filter(function (m) { return m.name === mi.mem; })[0];
        if (!md) { if (ctx.error) ctx.error(mi.task + '：找不到存储器声明 ' + mi.mem); return; }
        var text = H.resolveDataFile(files, mi.file);
        if (text == null) {
          if (ctx.error) ctx.error(mi.task + '：缺少数据文件「' + mi.file + '」，请在「文件 → 数据文件」中附加');
          return;
        }
        var vals = H.parseMemFile(text, mi.radix);
        var first = mi.start == null ? md.lo : mi.start;
        var last = mi.end == null ? md.hi : mi.end;
        var target = st.mems[md.name];
        for (var q = 0; q < vals.length; q++) {
          var abs = first + vals[q].addr;
          if (abs > last) continue;
          var ix = abs - md.lo;
          if (ix >= 0 && ix < target.length) target[ix] = vals[q].v & U.mask(md.bits);
        }
      });
      st._memInit = true;
    }
    env.__mems = st.mems;
    for (i = 0; i < ir.ports.length; i++) {
      p = ir.ports[i];
      if (p.dir === 'out') env[p.name] = (st.regs[p.name] !== undefined ? st.regs[p.name] : 0) >>> 0;
      else env[p.name] = (((inputs[p.name] || {}).v || 0) & U.mask(p.bits)) >>> 0;
    }
    for (i = 0; i < ir.regs.length; i++) {
      var r = ir.regs[i];
      env[r.name] = (st.regs[r.name] !== undefined ? st.regs[r.name] : (r.init || 0)) >>> 0;
      ir.widths[r.name] = ir.widths[r.name] || r.bits;
    }
    for (i = 0; i < ir.wires.length; i++) { var wn = ir.wires[i].name; if (env[wn] === undefined) env[wn] = 0; ir.widths[wn] = ir.widths[wn] || ir.wires[i].bits; }
    for (var k in ir.params) if (env[k] === undefined) env[k] = ir.params[k];

    // 时序块：边沿触发 + 非阻塞赋值（存储器写延迟到时间步末生效）
    var memPending = [];
    for (i = 0; i < ir.seq.length; i++) {
      var sq = ir.seq[i], fire = false;
      for (var c = 0; c < sq.clocks.length; c++) {
        var cl = sq.clocks[c], key = 'e' + i + '_' + cl.name, cur = (env[cl.name] || 0) & 1, prev = st._edge[key];
        st._edge[key] = cur;
        if (prev === undefined) continue;
        env['__edge_' + cl.name] = 0;
        if (cl.edge === 'neg' ? (prev === 1 && cur === 0) : (prev === 0 && cur === 1)) { fire = true; env['__edge_' + cl.name] = 1; }
      }
      if (fire) {
        var pending = [];
        execStmts(sq.stmts, env, pending, ir);
        pending.forEach(function (a) {
          if (a.lhs && a.lhs.mem) memPending.push(a);
          else assignTo(env, a.lhs, a.val, ir);
        });
      }
    }
    // 组合逻辑：连续赋值 + always @(*) / process，迭代至稳定
    for (var pass = 0; pass < 12; pass++) {
      var before = envHash(env);
      for (i = 0; i < ir.continuous.length; i++) assignTo(env, ir.continuous[i].lhs, evalE(ir.continuous[i].expr, env, ir), ir);
      for (i = 0; i < ir.comb.length; i++) execStmts(ir.comb[i].stmts, env, null, ir);
      if (envHash(env) === before) break;
    }
    for (i = 0; i < memPending.length; i++) assignTo(env, memPending[i].lhs, memPending[i].val, ir);
    // 保存寄存器状态
    for (i = 0; i < ir.regs.length; i++) st.regs[ir.regs[i].name] = env[ir.regs[i].name] >>> 0;
    for (i = 0; i < ir.ports.length; i++) if (ir.ports[i].dir === 'out') st.regs[ir.ports[i].name] = env[ir.ports[i].name] >>> 0;
    var out = {};
    for (i = 0; i < ir.ports.length; i++) {
      p = ir.ports[i];
      if (p.dir === 'out') out[p.name] = { v: (env[p.name] & U.mask(p.bits)) >>> 0, z: 0 };
    }
    return out;
  };

  H.tokensToSource = function (toks) { return toks.map(function (t) { return t.raw || t.v; }).join(' '); };

  if (typeof module !== 'undefined' && module.exports) module.exports = DIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
