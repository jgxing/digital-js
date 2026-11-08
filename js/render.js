/* Digital.js - Canvas 渲染 */
(function (root) {
  'use strict';
  var DIG = (root.DIG = root.DIG || {});
  var U = DIG.Util, L = DIG.Lib;
  var R = (DIG.Render = {});

  var C = {
    bg: '#f8fafc', grid: '#e6ebf2', gridMajor: '#d5deea',
    wire0: '#64748b', wire1: '#16a34a', wireBus: '#2563eb', wireZ: '#a3b4c8', wireErr: '#dc2626',
    body: '#ffffff', bodyAlt: '#f1f5f9', stroke: '#334155', text: '#0f172a', dim: '#64748b',
    sel: '#2563eb', pin: '#475569', hover: '#f59e0b', on: '#22c55e', off: '#cbd5e1',
    led: { red: '#ef4444', green: '#22c55e', blue: '#3b82f6', yellow: '#eab308' }
  };
  R.colors = C;

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function txt(ctx, s, x, y, size, color, align, bold) {
    ctx.fillStyle = color || C.text;
    ctx.font = (bold ? '600 ' : '') + Math.max(8, size) + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('' + s, x, y);
  }
  function line(ctx, a) {
    ctx.beginPath(); ctx.moveTo(a[0], a[1]);
    for (var i = 2; i < a.length; i += 2) ctx.lineTo(a[i], a[i + 1]);
    ctx.stroke();
  }

  function envOf(canvas, view, circuit, sim, ui) {
    var g = U.GRID * view.scale;
    return {
      ctx: canvas.getContext('2d'), g: g, s: view.scale, view: view, circuit: circuit, sim: sim, ui: ui,
      tx: function (x) { return x * g + view.ox; }, ty: function (y) { return y * g + view.oy; },
      sx: function (x) { return (x - view.ox) / g; }, sy: function (y) { return (y - view.oy) / g; }
    };
  }

  function netColor(n, val, sim) {
    if (!sim || !sim.on) return C.wire0;
    if (!val) return C.wireZ;
    if (n.conflict) return C.wireErr;
    var m = U.mask(n.bits);
    if ((val.z & m) === m) return C.wireZ;
    if (val.z) return C.wireBus;
    if (n.bits > 1) return C.wireBus;
    return (val.v & 1) ? C.wire1 : C.wire0;
  }

  R.draw = function (canvas, view, circuit, sim, ui) {
    var e = envOf(canvas, view, circuit, sim, ui), ctx = e.ctx;
    var W = canvas.clientWidth, H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    drawGrid(e, W, H);

    var nl = sim ? sim.nl : DIG.Netlist.build(circuit);
    // 导线
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    (circuit.wires || []).forEach(function (w) {
      var pts = w.points || [];
      if (pts.length < 2) return;
      var nid = nl.keyToNet[U.key(pts[0][0], pts[0][1])];
      var n = nid === undefined ? null : nl.nets[nid];
      var val = n && sim ? sim.values[nid] : null;
      var col = netColor(n || { bits: 1, conflict: false }, val, sim);
      var lw = n && n.bits > 1 ? Math.max(2.2, 3 * e.s) : Math.max(1.6, 2.2 * e.s);
      if (ui && ui.selection && ui.selection.has(w.id)) { ctx.strokeStyle = C.sel; ctx.lineWidth = lw + 3 * e.s; }
      else { ctx.strokeStyle = col; ctx.lineWidth = lw; }
      if (sim && sim.on && val && val.z && (!n || !n.conflict)) { ctx.setLineDash([4 * e.s, 3 * e.s]); }
      line(ctx, pts.reduce(function (a, p) { a.push(e.tx(p[0]), e.ty(p[1])); return a; }, []));
      ctx.setLineDash([]);
    });
    // 连接点（三条以上线相交）
    var counts = {};
    (circuit.wires || []).forEach(function (w) {
      (w.points || []).forEach(function (p) { var k = U.key(p[0], p[1]); counts[k] = (counts[k] || 0) + 1; });
    });
    Object.keys(counts).forEach(function (k) {
      if (counts[k] < 3) return;
      var a = k.split(',');
      ctx.fillStyle = C.wire0; ctx.beginPath();
      ctx.arc(e.tx(+a[0]), e.ty(+a[1]), Math.max(2, 3 * e.s), 0, 7); ctx.fill();
    });

    // 元件
    (circuit.components || []).forEach(function (c) {
      var sel = ui && ui.selection && ui.selection.has(c.id);
      var hov = ui && ui.hoverId === c.id;
      drawComponent(e, c, sel, hov);
    });

    // 电平标记
    if (sim && sim.on && ui && ui.showValues !== false) drawValues(e, nl, sim);
    // 单门步进高亮
    if (ui && ui.highlightComp != null) {
      var hc = circuit.components.filter(function (c) { return c.id === ui.highlightComp; })[0];
      if (hc) highlight(e, hc, C.hover);
    }
    // 连线预览
    if (ui && ui.wireDraft && ui.wireDraft.points.length) drawDraft(e, ui.wireDraft);
    // 框选
    if (ui && ui.rubber) {
      var rb = ui.rubber;
      ctx.fillStyle = 'rgba(37,99,235,0.10)'; ctx.strokeStyle = C.sel; ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(rb.x, rb.y, rb.w, rb.h); ctx.strokeRect(rb.x, rb.y, rb.w, rb.h);
      ctx.setLineDash([]);
    }
  };

  function drawGrid(e, W, H) {
    var ctx = e.ctx, g = e.g, s = e.s;
    if (s < 0.35) return;
    var step = s < 0.7 ? 5 : 1;
    var x0 = Math.floor(-e.view.ox / g / step) * step, x1 = x0 + Math.ceil(W / g / step) * step + step;
    var y0 = Math.floor(-e.view.oy / g / step) * step, y1 = y0 + Math.ceil(H / g / step) * step + step;
    ctx.lineWidth = 1;
    for (var x = x0; x <= x1; x += step) {
      var major = (x % 10 === 0);
      ctx.strokeStyle = major ? C.gridMajor : C.grid;
      ctx.beginPath(); ctx.moveTo(e.tx(x) + .5, 0); ctx.lineTo(e.tx(x) + .5, H); ctx.stroke();
    }
    for (var y = y0; y <= y1; y += step) {
      var major2 = (y % 10 === 0);
      ctx.strokeStyle = major2 ? C.gridMajor : C.grid;
      ctx.beginPath(); ctx.moveTo(0, e.ty(y) + .5); ctx.lineTo(W, e.ty(y) + .5); ctx.stroke();
    }
  }

  function highlight(e, c, color) {
    var ctx = e.ctx, b = L.bounds(c), pad = 0.8;
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, 2.5 * e.s); ctx.setLineDash([5 * e.s, 3 * e.s]);
    rr(ctx, e.tx(c.x - b.hw - pad), e.ty(c.y - b.hh - pad), (b.hw + pad) * 2 * e.g, (b.hh + pad) * 2 * e.g, 4 * e.s);
    ctx.stroke(); ctx.setLineDash([]);
  }

  function drawValues(e, nl, sim) {
    var ctx = e.ctx;
    var seen = {};
    nl.nets.forEach(function (n, id) {
      if (n.keys.length > 24) return;
      var seg = null;
      for (var i = 0; i < nl.segments.length && !seg; i++) {
        var s = nl.segments[i];
        if (n.keys.indexOf(U.key(s[0], s[1])) >= 0) seg = s;
      }
      var px, py;
      if (seg) { px = (seg[0] + seg[2]) / 2; py = (seg[1] + seg[3]) / 2; }
      else { var k = n.keys[0].split(','); px = +k[0]; py = +k[1]; }
      var key = Math.round(px * 2) + ',' + Math.round(py * 2);
      if (seen[key]) return; seen[key] = 1;
      var v = sim.values[id];
      if (!v) return;
      var X = e.tx(px), Y = e.ty(py) - 9 * e.s;
      var m = U.mask(n.bits);
      if (n.conflict) { txt(ctx, '✕', X, Y, 12 * e.s, C.wireErr, 'center', true); return; }
      if ((v.z & m) === m) { txt(ctx, 'Z', X, Y, 10 * e.s, C.wireZ, 'center', true); return; }
      if (n.bits === 1) {
        ctx.fillStyle = (v.v & 1) ? C.wire1 : '#94a3b8';
        ctx.beginPath(); ctx.arc(X, Y, Math.max(2.5, 3.1 * e.s), 0, 7); ctx.fill();
      } else {
        var s = U.format(v, n.bits, 'hex');
        var fs = Math.max(9, 10 * e.s);
        ctx.font = '600 ' + fs + 'px "Segoe UI", monospace';
        var w = ctx.measureText(s).width + 8 * e.s;
        ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
        rr(ctx, X - w / 2, Y - fs * .75, w, fs * 1.5, 3 * e.s); ctx.fill(); ctx.stroke();
        txt(ctx, s, X, Y, fs, C.wireBus, 'center', true);
      }
    });
  }

  function drawDraft(e, d) {
    var ctx = e.ctx, pts = d.points.slice();
    if (d.preview) {
      var pv = Array.isArray(d.preview) ? d.preview : [d.preview];
      pts = pts.concat(pv);
    }
    if (pts.length < 2) return;
    ctx.strokeStyle = C.sel; ctx.lineWidth = Math.max(1.6, 2.2 * e.s); ctx.setLineDash([5 * e.s, 4 * e.s]);
    line(ctx, pts.reduce(function (a, p) { a.push(e.tx(p[0]), e.ty(p[1])); return a; }, []));
    ctx.setLineDash([]);
    pts.forEach(function (p) {
      ctx.fillStyle = C.sel; ctx.beginPath(); ctx.arc(e.tx(p[0]), e.ty(p[1]), 3 * e.s, 0, 7); ctx.fill();
    });
  }

  function drawPins(e, c, pins, showNames) {
    var ctx = e.ctx, g = e.g;
    pins.forEach(function (p) {
      if (p.hidden) return;
      var X = e.tx(c.x + p.x), Y = e.ty(c.y + p.y);
      var X0 = X - (p.ax || -1) * g, Y0 = Y - (p.ay || 0) * g;
      var nid = e.sim ? e.sim.nl.pinNet[c.id + '|' + p.name] : undefined;
      var n = nid === undefined ? null : e.sim.nl.nets[nid];
      var val = n && e.sim ? e.sim.values[nid] : null;
      var col = n ? netColor(n, val, e.sim) : C.pin;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.3, (n && n.bits > 1 ? 2.6 : 1.8) * e.s);
      ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X, Y); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X, Y, Math.max(1.8, 2.3 * e.s), 0, 7); ctx.fill();
      if (showNames && e.s >= 0.85 && p.label) {
        var al = p.ax > 0 ? 'left' : (p.ax < 0 ? 'right' : 'center');
        var ox = p.ax > 0 ? 4 * e.s : (p.ax < 0 ? -4 * e.s : 0);
        var oy = p.ay !== 0 ? (p.ay > 0 ? 9 * e.s : -9 * e.s) : 0;
        txt(ctx, p.label, X0 + ox, Y0 + oy, Math.max(7, 8.5 * e.s), C.dim, al);
      }
    });
  }

  function shortSpec(s, n) {
    s = '' + (s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function drawComponent(e, c, sel, hov) {
    var ctx = e.ctx, g = e.g, s = e.s;
    var d = L.get(c.type) || L.get('text');
    var b = L.bounds(c);
    var X = e.tx(c.x), Y = e.ty(c.y);
    var hw = b.hw * g, hh = b.hh * g;
    var pins = L.pinsOf(c);
    var shape = d.shape;
    var val = function (pin) { return e.sim ? e.sim.pinValue(c.id, pin) : null; };
    var st = e.sim ? (e.sim.cs[e.sim.comps.indexOf(c)] || {}).st : null;
    // 若 sim 元件顺序不一致，按 id 查找
    if (e.sim) {
      var idx = -1;
      for (var i = 0; i < e.sim.comps.length; i++) if (e.sim.comps[i].id === c.id) { idx = i; break; }
      st = idx >= 0 ? e.sim.cs[idx].st : null;
    }

    ctx.save();
    if (sel) { ctx.shadowColor = 'rgba(37,99,235,.35)'; ctx.shadowBlur = 8 * s; }
    else if (hov) { ctx.shadowColor = 'rgba(245,158,11,.4)'; ctx.shadowBlur = 7 * s; }
    ctx.lineWidth = Math.max(1.2, 1.6 * s);
    ctx.strokeStyle = sel ? C.sel : (hov ? C.hover : C.stroke);
    ctx.fillStyle = C.body;

    if (shape === 'gate' || shape === 'gateBubble' || shape === 'not' || shape === 'tri') {
      var x0 = X - hw, x1 = X + hw, y0 = Y - hh, y1 = Y + hh;
      var bubble = shape === 'gateBubble' || shape === 'not';
      ctx.beginPath();
      if (shape === 'not' || shape === 'tri') {
        ctx.moveTo(x0, y0); ctx.lineTo(x1 - (bubble ? 5 * s : 0), Y); ctx.lineTo(x0, y1); ctx.closePath();
      } else {
        ctx.moveTo(x0, y0); ctx.lineTo(X - hw * 0.05, y0);
        ctx.bezierCurveTo(X + hw * .75, y0, X + hw * .75, y1, X - hw * .05, y1);
        ctx.lineTo(x0, y1); ctx.closePath();
      }
      ctx.fill(); ctx.stroke();
      if (bubble) {
        ctx.beginPath(); ctx.arc(x1 - 2.5 * s, Y, Math.max(2.5, 3.2 * s), 0, 7); ctx.fillStyle = C.body; ctx.fill(); ctx.stroke();
      }
      txt(ctx, d.symbol, X - hw * .35, Y, Math.max(9, 12 * s), C.text, 'center', true);
      if (c.type === 'tribuf') txt(ctx, 'EN', X - hw * .45, Y + hh * .55, Math.max(7, 8 * s), C.dim);
    } else if (shape === 'box' || shape === 'splitter' || shape === 'hdl') {
      rr(ctx, X - hw, Y - hh, hw * 2, hh * 2, 4 * s); ctx.fill(); ctx.stroke();
      var title = d.symbol;
      if (shape === 'hdl') {
        ctx.fillStyle = '#eff6ff'; rr(ctx, X - hw, Y - hh, hw * 2, Math.max(10, 12 * s), 4 * s); ctx.fill();
        txt(ctx, (c.props.lang === 'vhdl' ? 'VHDL' : 'VERILOG'), X, Y - hh + Math.max(6, 7 * s), Math.max(7, 8 * s), '#2563eb', 'center', true);
        title = c.props.name || 'HDL';
      }
      txt(ctx, title, X, Y + (shape === 'hdl' ? 3 * s : 0), Math.max(9, 11 * s), C.text, 'center', true);
      if (shape === 'splitter') {
        var sm = L.splitModel(c.props), lab;
        if (sm.legacy) lab = (c.props.mode === 'combine' ? '→' : '←') + sm.busBits + 'b (旧)';
        else if (sm.error) lab = '⚠ 分割规格错误';
        else lab = sm.busBits + 'b  ' + shortSpec(c.props.inSplit, 9) + ' → ' + shortSpec(c.props.outSplit, 9);
        txt(ctx, lab, X, Y + hh * .55, Math.max(7, 8 * s), sm.error ? '#dc2626' : C.dim);
      }
    } else if (shape === 'dip') {
      rr(ctx, X - hw, Y - hh, hw * 2, hh * 2, 3 * s); ctx.fillStyle = '#1e293b'; ctx.fill(); ctx.strokeStyle = '#0f172a'; ctx.stroke();
      ctx.beginPath(); ctx.arc(X - hw, Y - hh + 6 * s, 4 * s, 0, 7); ctx.fillStyle = '#0f172a'; ctx.fill();
      txt(ctx, c.props.part || '74xx', X, Y - hh + 12 * s, Math.max(9, 11 * s), '#fff', 'center', true);
      txt(ctx, (L.PARTS[c.props.part] || {}).d || '', X, Y + hh - 9 * s, Math.max(7, 8 * s), '#cbd5e1');
      if (s >= .7) pins.forEach(function (p) {
        if (p.hidden) return;
        var px = e.tx(c.x + p.x), py = e.ty(c.y + p.y);
        var left = p.ax < 0;
        txt(ctx, p.num, px + (left ? 4 * s : -4 * s), py, Math.max(6, 7.5 * s), '#94a3b8', left ? 'left' : 'right');
        txt(ctx, p.label, px + (left ? 11 * s : -11 * s), py, Math.max(6, 7.5 * s), '#e2e8f0', left ? 'left' : 'right');
      });
    } else if (shape === 'led') {
      var on = (val('a') || {}).v & 1, z = (val('a') || {}).z;
      ctx.beginPath(); ctx.arc(X, Y, Math.max(6, 8 * s), 0, 7);
      ctx.fillStyle = z ? C.off : (C.led[c.props.color] || C.led.red);
      ctx.globalAlpha = z ? .5 : (on ? 1 : .25); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = C.stroke; ctx.stroke();
      if (on && !z) { ctx.beginPath(); ctx.arc(X, Y, Math.max(9, 12 * s), 0, 7); ctx.strokeStyle = (C.led[c.props.color] || C.led.red) + '55'; ctx.lineWidth = 3 * s; ctx.stroke(); }
    } else if (shape === 'switch' || shape === 'button' || shape === 'clock' || shape === 'const' || shape === 'reset' || shape === 'port') {
      var isOn = false, label = c.props.label || '';
      if (shape === 'switch' || shape === 'port') isOn = !!((st && st.val) || 0);
      if (shape === 'button') isOn = !!((st && st.val) || 0);
      if (shape === 'clock') isOn = !!((st && st.val) || 0);
      if (shape === 'const') isOn = !!U.parseNum(c.props.value);
      if (shape === 'reset') isOn = !!(e.sim && e.sim.on && !e.sim.settling);
      if (shape === 'port') {
        // 五边形箭头
        ctx.beginPath();
        ctx.moveTo(X - hw, Y - hh); ctx.lineTo(X + hw * .55, Y - hh);
        ctx.lineTo(X + hw, Y); ctx.lineTo(X + hw * .55, Y + hh); ctx.lineTo(X - hw, Y + hh); ctx.closePath();
      } else rr(ctx, X - hw, Y - hh, hw * 2, hh * 2, 4 * s);
      ctx.fillStyle = shape === 'port' ? (c.type === 'portIn' ? '#eff6ff' : '#f0fdf4') : C.body;
      ctx.fill(); ctx.stroke();
      if (shape === 'switch' || shape === 'button') {
        ctx.fillStyle = isOn ? C.on : C.off;
        rr(ctx, X - hw * .72, Y - hh * .5, hw * 1.44, hh, 3 * s); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath();
        ctx.arc(X + (isOn ? hw * .42 : -hw * .42), Y, Math.max(3, 4 * s), 0, 7); ctx.fill();
      } else if (shape === 'clock') {
        ctx.strokeStyle = isOn ? C.wire1 : C.dim; ctx.lineWidth = 1.8 * s;
        var yy = Y + 1 * s;
        line(ctx, [X - hw * .7, yy + 3 * s, X - hw * .7, yy - 3 * s, X - hw * .1, yy - 3 * s, X - hw * .1, yy + 3 * s, X + hw * .5, yy + 3 * s, X + hw * .5, yy - 3 * s, X + hw * .8, yy - 3 * s]);
      } else if (shape === 'const') {
        txt(ctx, U.format({ v: U.parseNum(c.props.value), z: 0 }, c.props.bits || 1, 'hex'), X, Y, Math.max(8, 10 * s), C.text, 'center', true);
      } else if (shape === 'reset') {
        txt(ctx, 'RST', X, Y, Math.max(8, 9 * s), isOn ? C.wire1 : C.dim, 'center', true);
      } else {
        txt(ctx, label, X, Y, Math.max(8, 10 * s), C.text, 'center', true);
      }
      if (label && shape !== 'port' && shape !== 'const') txt(ctx, label, X, Y + hh + 9 * s, Math.max(8, 9.5 * s), C.dim, 'center', true);
      if (shape === 'port') txt(ctx, (c.props.bits || 1) > 1 ? (c.props.bits + 'b') : '', X + hw * .55, Y - hh - 7 * s, Math.max(7, 8 * s), C.dim);
    } else if (shape === 'hex') {
      rr(ctx, X - hw, Y - hh, hw * 2, hh * 2, 4 * s); ctx.fillStyle = '#111827'; ctx.fill(); ctx.strokeStyle = '#334155'; ctx.stroke();
      draw7seg(ctx, X, Y, hw, hh, val('d'), val('dp'), s);
    } else if (shape === 'probe') {
      rr(ctx, X - hw, Y - hh, hw * 2, hh * 2, 4 * s); ctx.fillStyle = '#0f172a'; ctx.fill(); ctx.strokeStyle = '#334155'; ctx.stroke();
      var sv = val('a');
      var str = sv ? U.format(sv, c.props.bits || 1, c.props.format || 'hex') : 'Z';
      txt(ctx, str, X, Y, Math.max(9, 12 * s), '#4ade80', 'center', true);
      if (c.props.label) txt(ctx, c.props.label, X, Y - hh - 8 * s, Math.max(8, 9 * s), C.dim);
    } else if (shape === 'label') {
      var nm = c.props.name || 'NET';
      ctx.font = '600 ' + Math.max(8, 9.5 * s) + 'px "Segoe UI", monospace';
      var w = ctx.measureText(nm).width + 10 * s, h = Math.max(12, 13 * s);
      ctx.fillStyle = '#e0f2fe'; ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1;
      rr(ctx, X - 3 * s, Y - h, w, h, 3 * s); ctx.fill(); ctx.stroke();
      txt(ctx, nm, X - 3 * s + w / 2, Y - h / 2, Math.max(8, 9.5 * s), '#0369a1', 'center', true);
      ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.arc(X, Y, Math.max(2, 2.6 * s), 0, 7); ctx.fill();
    } else if (shape === 'text') {
      ctx.restore();
      txt(ctx, c.props.text || '', X, Y, (c.props.size || 14) * s, C.text, 'center');
      if (sel) highlight(e, c, C.sel);
      return;
    } else if (shape === 'pull') {
      rr(ctx, X - hw, Y - hh, hw * 2, hh * 2, 3 * s); ctx.fill(); ctx.stroke();
      txt(ctx, c.props.value ? 'VCC' : 'GND', X, Y, Math.max(7, 9 * s), C.text, 'center', true);
    }
    ctx.restore();
    if (shape !== 'led' || true) drawPins(e, c, pins, ['box', 'splitter', 'hdl', 'dip', 'port'].indexOf(shape) >= 0);
    if (c.props.label && ['box', 'hdl', 'hex'].indexOf(shape) >= 0 && c.type !== 'hdl')
      txt(ctx, c.props.label, X, Y - hh - 8 * s, Math.max(8, 9 * s), C.dim);
    if (sel) highlight(e, c, C.sel); else if (hov) highlight(e, c, C.hover);
  }

  function draw7seg(ctx, X, Y, hw, hh, dval, dpval, s) {
    var v = dval ? dval.v : 0, z = dval ? dval.z : 15;
    var mask = (z & 15) ? 0 : L.HEX_SEG[v & 15];
    var w = hw * .62, h = hh * .78, t = Math.max(2, 2.4 * s);
    var segs = [
      [X - w / 2 + t, Y - h / 2, w - 2 * t, t, 0],       // a
      [X + w / 2 - t, Y - h / 2 + t, t, h / 2 - t, 1],   // b
      [X + w / 2 - t, Y + t, t, h / 2 - t, 2],           // c
      [X - w / 2 + t, Y + h / 2 - t, w - 2 * t, t, 3],   // d
      [X - w / 2, Y + t, t, h / 2 - t, 4],               // e
      [X - w / 2, Y - h / 2 + t, t, h / 2 - t, 5],       // f
      [X - w / 2 + t, Y - t / 2, w - 2 * t, t, 6]        // g
    ];
    segs.forEach(function (sg) {
      var on = (mask >> sg[4]) & 1;
      ctx.fillStyle = on ? '#f87171' : '#3f1d1d';
      ctx.save(); ctx.translate(sg[0] + sg[2] / 2, sg[1] + sg[3] / 2);
      if (sg[2] > sg[3]) { ctx.beginPath(); ctx.moveTo(-sg[2] / 2, 0); ctx.lineTo(-sg[2] / 2 + t / 2, -t / 2); ctx.lineTo(sg[2] / 2 - t / 2, -t / 2); ctx.lineTo(sg[2] / 2, 0); ctx.lineTo(sg[2] / 2 - t / 2, t / 2); ctx.lineTo(-sg[2] / 2 + t / 2, t / 2); ctx.closePath(); }
      else { ctx.beginPath(); ctx.moveTo(0, -sg[3] / 2); ctx.lineTo(t / 2, -sg[3] / 2 + t / 2); ctx.lineTo(t / 2, sg[3] / 2 - t / 2); ctx.lineTo(0, sg[3] / 2); ctx.lineTo(-t / 2, sg[3] / 2 - t / 2); ctx.lineTo(-t / 2, -sg[3] / 2 + t / 2); ctx.closePath(); }
      ctx.fill(); ctx.restore();
    });
    if (dpval) {
      ctx.fillStyle = (dpval.v & 1) && !(dpval.z & 1) ? '#f87171' : '#3f1d1d';
      ctx.beginPath(); ctx.arc(X + w / 2 + t, Y + h / 2 - t, t / 1.5, 0, 7); ctx.fill();
    }
  }

  /* ---------- 波形图 ---------- */
  R.drawWave = function (canvas, sim, ui) {
    var ctx = canvas.getContext('2d'), W = canvas.clientWidth, H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#fbfcfe'; ctx.fillRect(0, 0, W, H);
    var ids = sim.watch || [];
    if (!ids.length || sim.history.length < 1) {
      txt(ctx, '运行仿真后，此处显示被观测网络的时序波形（右键导线可加入观测）', W / 2, H / 2, 12, '#94a3b8');
      return;
    }
    var left = 92, top = 12, rowH = Math.min(38, (H - 24) / ids.length);
    var n = sim.history.length, dx = (W - left - 16) / Math.max(1, n - 1);
    ctx.font = '11px "Segoe UI", monospace';
    ids.forEach(function (id, k) {
      var net = sim.nets[id], y0 = top + k * rowH, y1 = y0 + rowH * .32, y2 = y0 + rowH * .82;
      var label = net ? (net.name || ('n' + id)) : 'n' + id;
      txt(ctx, label.length > 12 ? label.slice(0, 12) : label, 6, y0 + rowH / 2, 11, '#334155', 'left');
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, y2 + 2); ctx.lineTo(W - 8, y2 + 2); ctx.stroke();
      ctx.strokeStyle = net && net.bits > 1 ? C.wireBus : C.wire1; ctx.lineWidth = 1.7;
      ctx.beginPath();
      var prev = null;
      sim.history.forEach(function (row, i) {
        var v = row.v[id] || 0, x = left + i * dx;
        var yy = (v & 1) ? y1 : y2;
        if (prev === null) ctx.moveTo(x, yy);
        else { if (yy !== prev) ctx.lineTo(x, prev); ctx.lineTo(x, yy); }
        prev = yy;
        if (net && net.bits > 1 && i % Math.max(1, Math.floor(n / 18)) === 0) {
          txt(ctx, U.format({ v: v & 0xffffffff, z: 0 }, net.bits, 'hex'), x, y0 + 6 * (rowH / 38), 8, '#64748b');
        }
      });
      ctx.stroke();
    });
    txt(ctx, 'tick ' + sim.history[0].t + ' → ' + sim.history[sim.history.length - 1].t, W - 8, H - 6, 10, '#94a3b8', 'right');
  };

  /* ---------- SVG 导出 ---------- */
  R.toSVG = function (circuit, sim) {
    var nl = sim ? sim.nl : DIG.Netlist.build(circuit);
    var xs = [], ys = [];
    circuit.components.forEach(function (c) {
      var b = L.bounds(c); xs.push(c.x - b.hw - 6, c.x + b.hw + 6); ys.push(c.y - b.hh - 6, c.y + b.hh + 6);
    });
    (circuit.wires || []).forEach(function (w) { (w.points || []).forEach(function (p) { xs.push(p[0] - 3); ys.push(p[1] - 3); }); });
    var minX = Math.min.apply(null, xs.concat([0])), minY = Math.min.apply(null, ys.concat([0]));
    var maxX = Math.max.apply(null, xs.concat([100])), maxY = Math.max.apply(null, ys.concat([60]));
    var S = U.GRID, w = (maxX - minX) * S, h = (maxY - minY) * S;
    var o = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">',
      '<rect width="100%" height="100%" fill="#ffffff"/>',
      '<g stroke-linecap="round" fill="none" stroke-width="2">'];
    var T = function (x, y) { return ((x - minX) * S) + ',' + ((y - minY) * S); };
    (circuit.wires || []).forEach(function (wire) {
      var pts = wire.points || [];
      if (pts.length < 2) return;
      var nid = nl.keyToNet[U.key(pts[0][0], pts[0][1])], n = nid === undefined ? null : nl.nets[nid];
      var col = '#64748b';
      if (sim && sim.on && n) {
        var v = sim.values[nid];
        col = n.conflict ? '#dc2626' : (n.bits > 1 ? '#2563eb' : ((v.v & 1) ? '#16a34a' : '#64748b'));
      }
      o.push('<polyline points="' + pts.map(function (p) { return T(p[0], p[1]); }).join(' ') + '" stroke="' + col + '"/>');
    });
    o.push('</g><g stroke="#334155" stroke-width="1.6" fill="#ffffff" font-family="Segoe UI, Microsoft YaHei" font-size="11">');
    circuit.components.forEach(function (c) {
      var b = L.bounds(c), x = (c.x - b.hw - minX) * S, y = (c.y - b.hh - minY) * S;
      var ww = 2 * b.hw * S, hh = 2 * b.hh * S;
      var d = L.get(c.type) || L.get('text');
      var fill = c.type === 'probe' || c.type === 'hexdisplay' || c.type === 'ic74' ? '#1e293b' : '#ffffff';
      if (d.shape === 'text') {
        o.push('<text x="' + ((c.x - minX) * S) + '" y="' + ((c.y - minY) * S) + '" text-anchor="middle" fill="#0f172a" font-size="' + (c.props.size || 14) + '">' + U.escapeHtml(c.props.text) + '</text>');
        return;
      }
      if (d.shape === 'label') {
        o.push('<text x="' + ((c.x - minX) * S) + '" y="' + ((c.y - minY) * S) + '" fill="#0369a1" font-size="11">' + U.escapeHtml(c.props.name) + '</text>');
        return;
      }
      o.push('<rect x="' + x + '" y="' + y + '" width="' + ww + '" height="' + hh + '" rx="4" fill="' + fill + '"/>');
      var label = c.props.label || c.props.name || d.symbol || c.type;
      if (c.type === 'ic74') label = c.props.part;
      o.push('<text x="' + (x + ww / 2) + '" y="' + (y + hh / 2) + '" text-anchor="middle" dominant-baseline="middle" fill="' + (fill === '#ffffff' ? '#0f172a' : '#ffffff') + '">' + U.escapeHtml(label) + '</text>');
      L.pinsOf(c).forEach(function (p) {
        if (p.hidden) return;
        var px = (c.x + p.x - minX) * S, py = (c.y + p.y - minY) * S;
        var px0 = px - p.ax * S, py0 = py - p.ay * S;
        o.push('<line x1="' + px0 + '" y1="' + py0 + '" x2="' + px + '" y2="' + py + '"/>');
        o.push('<circle cx="' + px + '" cy="' + py + '" r="2.5" fill="#334155"/>');
      });
    });
    o.push('</g></svg>');
    return o.join('\n');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
