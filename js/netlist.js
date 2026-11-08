/* Digital.js - 网表构建：把原理图（元件 + 导线 + 网络标签）编译成连接关系 */
(function (root) {
  'use strict';
  var DIG = (root.DIG = root.DIG || {});
  var U = DIG.Util, L = DIG.Lib;

  function build(circuit) {
    var dsu = new U.DSU();
    var comps = circuit.components || [];
    var wires = circuit.wires || [];
    var nodeKeys = Object.create(null);
    var pinIndex = [];          // {comp, ci, pin, key, x, y}
    var K = U.key;

    comps.forEach(function (comp, ci) {
      L.pinsOf(comp).forEach(function (p) {
        if (p.hidden) return;
        var x = comp.x + p.x, y = comp.y + p.y, key = K(x, y);
        pinIndex.push({ comp: comp, ci: ci, pin: p, key: key, x: x, y: y });
        nodeKeys[key] = true;
      });
    });

    var segments = [];
    wires.forEach(function (w) {
      var pts = w.points || [];
      for (var i = 0; i < pts.length; i++) nodeKeys[K(pts[i][0], pts[i][1])] = true;
      for (var j = 0; j + 1 < pts.length; j++) {
        segments.push([pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]]);
        dsu.union(K(pts[j][0], pts[j][1]), K(pts[j + 1][0], pts[j + 1][1]));
      }
    });

    // T 形连接：引脚 / 导线顶点落在另一条导线的线段中间时也应连通
    var coords = Object.keys(nodeKeys).map(function (s) {
      var a = s.split(','); return { x: +a[0], y: +a[1], key: s };
    });
    segments.forEach(function (s) {
      var a = K(s[0], s[1]), b = K(s[2], s[3]);
      for (var i = 0; i < coords.length; i++) {
        var c = coords[i];
        if (U.onSegment(c.x, c.y, s[0], s[1], s[2], s[3])) { dsu.union(c.key, a); dsu.union(c.key, b); }
      }
    });

    // 命名网络（网络标签 / HDL 导入绑定）
    var named = Object.create(null);
    comps.forEach(function (comp, ci) {
      if (comp.type !== 'netlabel') return;
      var name = (comp.props.name || '').trim();
      if (!name) return;
      var ps = L.pinsOf(comp);
      if (!ps.length) return;
      var key = K(comp.x + ps[0].x, comp.y + ps[0].y);
      dsu.union(key, 'N:' + name);
      (named['N:' + name] = named['N:' + name] || []).push(name);
    });
    (circuit.bindings || []).forEach(function (b) {
      var comp = comps.filter(function (c) { return c.id === b.compId; })[0];
      if (!comp) return;
      var ps = L.pinsOf(comp).filter(function (p) { return p.name === b.pin; });
      if (!ps.length) return;
      dsu.union(K(comp.x + ps[0].x, comp.y + ps[0].y), 'B:' + b.net);
      named['B:' + b.net] = [b.net];
    });
    // 让所有命名键都出现在并查集中
    Object.keys(named).forEach(function (k) { dsu.find(k); });

    var groups = dsu.groups();
    var keyToNet = Object.create(null);
    var nets = [];
    Object.keys(groups).forEach(function (rootKey) {
      var keys = groups[rootKey];
      var id = nets.length;
      var net = { id: id, keys: keys, bits: 1, drivers: [], sinks: [], name: '', conflict: false };
      keys.forEach(function (k) {
        keyToNet[k] = id;
        if (named[k]) net.name = named[k][0];
      });
      nets.push(net);
    });

    pinIndex.forEach(function (e) {
      var net = nets[keyToNet[e.key]];
      if (!net) return; // 理论上不会发生
      var ref = { c: e.ci, comp: e.comp, pin: e.pin.name, bits: e.pin.bits, x: e.x, y: e.y };
      if (e.pin.dir === 'out') net.drivers.push(ref);
      else net.sinks.push(ref);
      net.bits = Math.max(net.bits, e.pin.bits | 0);
    });

    // 位宽以驱动器为准（若存在），并检查位宽不匹配
    var warnings = [];
    nets.forEach(function (n) {
      if (n.drivers.length) n.bits = Math.max.apply(null, n.drivers.map(function (d) { return d.bits | 0; }));
      n.bits = U.clamp(n.bits, 1, U.MAX_BITS);
      var all = n.drivers.concat(n.sinks);
      var bad = all.filter(function (r) { return (r.bits | 0) !== n.bits; });
      if (bad.length) warnings.push('网络 ' + (n.name || 'n' + n.id) + ' 位宽不一致 (' + n.bits + ' bit)：' + bad.map(function (b) { return b.comp.type + '.' + b.pin + '=' + b.bits; }).join(', '));
      if (n.drivers.length > 1) {
        var kind = {};
        n.drivers.forEach(function (d) { kind[d.comp.type] = 1; });
        // 三态 / 集电极开路之外的多驱动视为潜在冲突（运行时再按电平判定）
        if (Object.keys(kind).length > 1 || n.drivers.length > 2) n.multiDriver = true;
      }
    });

    var pinNet = Object.create(null);
    pinIndex.forEach(function (e) { pinNet[e.comp.id + '|' + e.pin.name] = keyToNet[e.key]; });

    return {
      nets: nets, pinNet: pinNet, keyToNet: keyToNet, pinIndex: pinIndex,
      segments: segments, warnings: warnings, comps: comps, wires: wires
    };
  }

  DIG.Netlist = { build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = DIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
