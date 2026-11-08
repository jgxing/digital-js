/* Digital.js - 基础工具 */
(function (root) {
  'use strict';
  var DIG = (root.DIG = root.DIG || {});
  var U = (DIG.Util = {});

  U.GRID = 10;              // 一个网格单位 = 10 像素（缩放 1 时）
  U.MAX_BITS = 32;

  var _id = 1;
  U.uid = function (prefix) { return (prefix || 'x') + (_id++) + '_' + Math.floor(Math.random() * 1e6).toString(36); };
  U.resetIds = function () { _id = 1; };
  U.seedIds = function (n) { _id = Math.max(_id, n + 1); };

  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.mask = function (bits) {
    bits = U.clamp(bits | 0, 1, 32);
    return bits === 32 ? 0xFFFFFFFF : ((1 << bits) - 1) >>> 0;
  };
  U.v = function (v, z) { return { v: (v >>> 0), z: (z >>> 0) }; };
  U.ZERO = function () { return { v: 0, z: 0 }; };
  U.isZ = function (sig, bits) { return ((sig.z >>> 0) & U.mask(bits)) === U.mask(bits); };
  U.bit = function (sig, i) {
    if ((sig.z >>> 0) & (1 << i)) return 'z';
    return ((sig.v >>> 0) >> i) & 1;
  };
  U.format = function (sig, bits, mode) {
    if (!sig) return '?';
    var m = U.mask(bits);
    var z = sig.z >>> 0 & m;
    var v = sig.v >>> 0 & m;
    if (z === m) return 'Z';
    if (z) {
      var s = '';
      for (var i = bits - 1; i >= 0; i--) s += (z & (1 << i)) ? 'z' : ((v >> i) & 1);
      return s;
    }
    if (bits === 1) return '' + v;
    switch (mode) {
      case 'bin': return '0b' + v.toString(2).padStart(bits, '0');
      case 'dec': return '' + v;
      case 'signed': { var sg = (v >> (bits - 1)) & 1; return '' + (sg ? v - Math.pow(2, bits) : v); }
      case 'ascii': return "'" + String.fromCharCode(v & 0xff) + "'";
      default: return '0x' + v.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0');
    }
  };
  U.parseNum = function (s) {
    if (typeof s === 'number') return s >>> 0;
    s = ('' + s).trim().toLowerCase();
    if (!s) return 0;
    var m;
    if ((m = s.match(/^(\d+)'([bdoh])([0-9a-f_]+)$/))) {
      var radix = { b: 2, d: 10, o: 8, h: 16 }[m[2]];
      return parseInt(m[3].replace(/_/g, ''), radix) >>> 0;
    }
    if (/^0x[0-9a-f]+$/.test(s)) return parseInt(s.slice(2), 16) >>> 0;
    if (/^0b[01]+$/.test(s)) return parseInt(s.slice(2), 2) >>> 0;
    if (/^[01]+$/.test(s) && s.length > 1 && !/[2-9]/.test(s)) return parseInt(s, 2) >>> 0;
    var n = parseInt(s, 10);
    return isNaN(n) ? 0 : n >>> 0;
  };

  U.rotate = function (x, y, r) {
    switch (((r || 0) % 360 + 360) % 360) {
      case 90: return [-y, x];
      case 180: return [-x, -y];
      case 270: return [y, -x];
      default: return [x, y];
    }
  };
  U.key = function (x, y) { return x + ',' + y; };
  U.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  U.escapeHtml = function (s) {
    return ('' + (s == null ? '' : s)).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  U.download = function (name, text, mime) {
    if (typeof document === 'undefined') return;
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  U.onSegment = function (px, py, ax, ay, bx, by) {
    if (ax === bx) return px === ax && py >= Math.min(ay, by) && py <= Math.max(ay, by);
    if (ay === by) return py === ay && px >= Math.min(ax, bx) && px <= Math.max(ax, bx);
    // 45° 斜线（仅用于命中检测）
    var t = (px - ax) / (bx - ax);
    return t >= 0 && t <= 1 && Math.abs(ay + t * (by - ay) - py) < 0.01;
  };

  U.DSU = function () {
    this.p = Object.create(null);
  };
  U.DSU.prototype.find = function (x) {
    var p = this.p;
    if (p[x] === undefined) { p[x] = x; return x; }
    var r = x;
    while (p[r] !== r) r = p[r];
    while (p[x] !== x) { var n = p[x]; p[x] = r; x = n; }
    return r;
  };
  U.DSU.prototype.union = function (a, b) {
    var ra = this.find(a), rb = this.find(b);
    if (ra !== rb) p_union(this.p, ra, rb);
  };
  function p_union(p, a, b) { if (a < b) p[b] = a; else p[a] = b; }
  U.DSU.prototype.groups = function () {
    var g = Object.create(null), p = this.p;
    for (var k in p) {
      var r = this.find(k);
      (g[r] = g[r] || []).push(k);
    }
    return g;
  };

  U.gcd = function (a, b) { while (b) { var t = a % b; a = b; b = t; } return a; };
  U.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  U.now = function () { return (typeof performance !== 'undefined' ? performance : Date).now(); };

  // 简易事件总线
  U.emitter = function () {
    var map = {};
    return {
      on: function (k, f) { (map[k] = map[k] || []).push(f); return this; },
      off: function (k, f) { map[k] = (map[k] || []).filter(function (x) { return x !== f; }); },
      emit: function (k, a) { (map[k] || []).slice().forEach(function (f) { try { f(a); } catch (e) { console.error(e); } }); }
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
