/* Digital.js - 原理图编辑器交互 */
(function (root) {
  'use strict';
  var DIG = (root.DIG = root.DIG || {});
  var U = DIG.Util, L = DIG.Lib;
  var ED = (DIG.Editor = {});

  var app = null;
  function ui() { return app.ui; }
  function circuit() { return app.circuit; }
  function canvas() { return app.canvas; }
  function repaint() { app.repaint(); }

  function local(ev) {
    var r = canvas().getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }
  function toGrid(sx, sy) {
    var v = ui().view, g = U.GRID * v.scale;
    return [Math.round((sx - v.ox) / g), Math.round((sy - v.oy) / g)];
  }
  function toScreen(gx, gy) {
    var v = ui().view, g = U.GRID * v.scale;
    return [gx * g + v.ox, gy * g + v.oy];
  }
  ED.toGrid = toGrid; ED.toScreen = toScreen;

  ED.hitPin = function (a, gx, gy, radius) {
    radius = radius || 1.2;
    var best = null, bd = radius * radius;
    (a.circuit.components || []).forEach(function (c) {
      L.pinsOf(c).forEach(function (p) {
        if (p.hidden) return;
        var dx = c.x + p.x - gx, dy = c.y + p.y - gy, d2 = dx * dx + dy * dy;
        if (d2 <= bd) { bd = d2; best = { comp: c, pin: p, x: c.x + p.x, y: c.y + p.y }; }
      });
    });
    return best;
  };
  ED.hitComp = function (a, gx, gy) {
    var cs = a.circuit.components || [];
    for (var i = cs.length - 1; i >= 0; i--) {
      var c = cs[i], b = L.bounds(c);
      if (gx >= c.x - b.hw - .4 && gx <= c.x + b.hw + .4 && gy >= c.y - b.hh - .4 && gy <= c.y + b.hh + .4) return c;
    }
    return null;
  };
  ED.hitWire = function (a, gx, gy, tol) {
    tol = tol == null ? 1.0 : tol;
    var ws = a.circuit.wires || [];
    for (var i = ws.length - 1; i >= 0; i--) {
      var pts = ws[i].points || [];
      for (var j = 0; j + 1 < pts.length; j++) {
        var ax = pts[j][0], ay = pts[j][1], bx = pts[j + 1][0], by = pts[j + 1][1];
        if (ax === bx) { if (Math.abs(gx - ax) <= tol && gy >= Math.min(ay, by) - tol && gy <= Math.max(ay, by) + tol) return ws[i]; }
        else if (ay === by) { if (Math.abs(gy - ay) <= tol && gx >= Math.min(ax, bx) - tol && gx <= Math.max(ax, bx) + tol) return ws[i]; }
      }
    }
    return null;
  };

  function route(from, to, verticalFirst) {
    if (from[0] === to[0] || from[1] === to[1]) return [to.slice()];
    return verticalFirst ? [[from[0], to[1]], to.slice()] : [[to[0], from[1]], to.slice()];
  }

  ED.startWire = function (gx, gy, fromPin) {
    ui().mode = 'wire';
    ui().wireDraft = { points: [[gx, gy]], preview: null, verticalFirst: false, fromPin: fromPin || null };
    app.status('连线中：单击添加拐点，单击引脚/双击结束，Tab 切换拐向，Esc 取消');
    repaint();
  };
  ED.wireClick = function (gx, gy, pin) {
    var d = ui().wireDraft;
    if (!d) { ED.startWire(gx, gy, pin); return; }
    var last = d.points[d.points.length - 1];
    var r = route(last, [gx, gy], d.verticalFirst);
    r.forEach(function (p) {
      var lp = d.points[d.points.length - 1];
      if (lp[0] !== p[0] || lp[1] !== p[1]) d.points.push(p);
    });
    d.preview = null;
    if (pin || d.points.length >= 2 && d.fromPin && (gx === d.fromPin.x && gy === d.fromPin.y)) ED.finishWire();
    repaint();
  };
  ED.finishWire = function () {
    var d = ui().wireDraft;
    ui().wireDraft = null;
    ui().mode = 'select';
    if (!d) { repaint(); return; }
    var pts = d.points.filter(function (p, i, arr) { return i === 0 || p[0] !== arr[i - 1][0] || p[1] !== arr[i - 1][1]; });
    if (pts.length < 2) { repaint(); return; }
    app.pushUndo();
    circuit().wires.push({ id: U.uid('w'), points: pts });
    app.rebuild();
    app.status('已添加导线（' + (pts.length - 1) + ' 段）');
  };
  ED.cancel = function () {
    ui().wireDraft = null; ui().rubber = null; ui().mode = 'select'; ui().placeType = null;
    ui().drag = null; ui().spaceDown = false;
    app.status('就绪');
    repaint();
  };

  ED.place = function (type, gx, gy, props) {
    var c = L.newComponent(type, gx, gy, props);
    app.pushUndo();
    circuit().components.push(c);
    app.rebuild();
    ui().selection = new Set([c.id]);
    app.showProps();
    app.status('已放置 ' + (L.get(type) || {}).name);
    return c;
  };

  ED.deleteSelection = function () {
    var sel = ui().selection;
    if (!sel || !sel.size) return;
    app.pushUndo();
    var c = circuit();
    c.components = c.components.filter(function (x) { return !sel.has(x.id); });
    c.wires = c.wires.filter(function (w) { return !sel.has(w.id); });
    if (c.bindings) c.bindings = c.bindings.filter(function (b) { return !sel.has(b.compId); });
    ui().selection = new Set();
    app.rebuild(); app.showProps();
    app.status('已删除 ' + sel.size + ' 个对象');
  };

  ED.rotateSelection = function (deg) {
    var sel = ui().selection;
    if (!sel || !sel.size) return;
    app.pushUndo();
    circuit().components.forEach(function (c) { if (sel.has(c.id)) c.rot = ((c.rot || 0) + (deg || 90)) % 360; });
    app.rebuild(); app.status('已旋转');
  };

  ED.copy = function (pasteAt) {
    var sel = ui().selection;
    if (!sel || !sel.size) return null;
    var comps = circuit().components.filter(function (c) { return sel.has(c.id); });
    var wires = circuit().wires.filter(function (w) { return sel.has(w.id); });
    if (!comps.length) return null;
    var minX = Math.min.apply(null, comps.map(function (c) { return c.x; }));
    var minY = Math.min.apply(null, comps.map(function (c) { return c.y; }));
    return {
      comps: U.clone(comps).map(function (c) { c.x -= minX; c.y -= minY; return c; }),
      wires: U.clone(wires).map(function (w) {
        w.points = w.points.map(function (p) { return [p[0] - minX, p[1] - minY]; }); return w;
      })
    };
  };

  ED.paste = function (data, gx, gy) {
    if (!data) return;
    app.pushUndo();
    var map = {}, c = circuit();
    var existing = {};
    c.components.forEach(function (x) { if (x.type === 'netlabel') existing[x.props.name] = 1; });
    var ox = gx == null ? 4 : gx, oy = gy == null ? 4 : gy;
    data.comps.forEach(function (src) {
      var n = U.clone(src);
      n.id = U.uid('c'); map[src.id] = n.id;
      n.x += ox; n.y += oy;
      if (n.type === 'netlabel' && existing[n.props.name]) n.props.name = n.props.name + '_c' + Math.floor(Math.random() * 100);
      c.components.push(n);
    });
    data.wires.forEach(function (w) {
      var n = U.clone(w); n.id = U.uid('w');
      n.points = n.points.map(function (p) { return [p[0] + ox, p[1] + oy]; });
      c.wires.push(n);
    });
    if (c.bindings && c.bindings.length) {
      c.bindings = c.bindings.filter(function (b) { return !data.comps.some(function (x) { return x.id === b.compId; }); });
    }
    ui().selection = new Set(Object.values(map));
    app.rebuild(); app.showProps(); app.status('已粘贴 ' + data.comps.length + ' 个元件');
  };

  ED.selectAll = function () {
    ui().selection = new Set(circuit().components.map(function (c) { return c.id; }).concat(circuit().wires.map(function (w) { return w.id; })));
    repaint();
  };

  ED.fitView = function () {
    var c = circuit();
    if (!c.components.length) { ui().view = { scale: 1, ox: 60, oy: 60 }; repaint(); return; }
    var xs = [], ys = [];
    c.components.forEach(function (comp) {
      var b = L.bounds(comp);
      xs.push(comp.x - b.hw - 4, comp.x + b.hw + 4); ys.push(comp.y - b.hh - 4, comp.y + b.hh + 4);
    });
    (c.wires || []).forEach(function (w) { (w.points || []).forEach(function (p) { xs.push(p[0] - 2); ys.push(p[1] - 2); }); });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var W = canvas().clientWidth, H = canvas().clientHeight;
    var sc = U.clamp(Math.min(W / ((maxX - minX) * U.GRID + 60), H / ((maxY - minY) * U.GRID + 60)), .25, 2.2);
    ui().view.scale = sc;
    ui().view.ox = (W - (maxX - minX) * U.GRID * sc) / 2 - minX * U.GRID * sc;
    ui().view.oy = (H - (maxY - minY) * U.GRID * sc) / 2 - minY * U.GRID * sc;
    repaint();
  };

  ED.zoom = function (factor, sx, sy) {
    var v = ui().view, old = v.scale;
    var ns = U.clamp(old * factor, .2, 5);
    if (ns === old) return;
    var gx = (sx - v.ox) / (U.GRID * old), gy = (sy - v.oy) / (U.GRID * old);
    v.scale = ns;
    v.ox = sx - gx * U.GRID * ns;
    v.oy = sy - gy * U.GRID * ns;
    repaint();
  };

  function onDown(ev) {
    var a = app;
    if (ev.button === 2) return;
    var p = local(ev), sx = p[0], sy = p[1], g = toGrid(sx, sy);
    canvas().focus();
    if (ev.button === 1 || ui().spaceDown) {
      ui().drag = { kind: 'pan', sx: sx, sy: sy, ox: ui().view.ox, oy: ui().view.oy };
      ev.preventDefault(); return;
    }
    if (ui().mode === 'place') {
      ED.place(ui().placeType, g[0], g[1], ui().placeProps);
      if (!ev.shiftKey) { ui().mode = 'select'; ui().placeType = null; ui().placeProps = null; a.syncToolbar(); }
      return;
    }
    var pin = ED.hitPin(a, g[0], g[1], 1.3);
    if (ui().mode === 'wire') {
      ED.wireClick(g[0], g[1], pin);
      return;
    }
    if (pin) {
      ui().drag = { kind: 'wire', start: [pin.x, pin.y], moved: false };
      ED.startWire(pin.x, pin.y, pin);
      return;
    }
    var comp = ED.hitComp(a, g[0], g[1]);
    if (comp) {
      var interactive = L.interactive(comp.type) && comp.type !== 'clock';
      var already = ui().selection.has(comp.id);
      if (ev.shiftKey) {
        if (already) ui().selection.delete(comp.id); else ui().selection.add(comp.id);
      } else if (!already) ui().selection = new Set([comp.id]);
      a.showProps();
      var selComps = circuit().components.filter(function (c) { return ui().selection.has(c.id); });
      var pinPos = {};
      selComps.forEach(function (c) { L.pinsOf(c).forEach(function (q) { pinPos[U.key(c.x + q.x, c.y + q.y)] = 1; }); });
      var wpts = [];
      circuit().wires.forEach(function (w) {
        (w.points || []).forEach(function (q, qi) {
          if (pinPos[U.key(q[0], q[1])]) wpts.push({ pts: w.points, qi: qi, x: q[0], y: q[1] });
        });
      });
      ui().drag = {
        kind: 'move', startGrid: g, sx: sx, sy: sy, moved: false, undoPushed: false,
        orig: selComps.map(function (c) { return { c: c, x: c.x, y: c.y }; }),
        wpts: wpts, clickComp: comp, interactive: interactive
      };
      if (interactive && comp.type === 'button' && a.sim.on) { a.setButton(comp, 1); }
      repaint(); return;
    }
    var wire = ED.hitWire(a, g[0], g[1], 1.0);
    if (wire) {
      if (!ev.shiftKey) ui().selection = new Set([wire.id]); else ui().selection.add(wire.id);
      a.showProps(); repaint(); return;
    }
    if (!ev.shiftKey) { ui().selection = new Set(); a.showProps(); }
    ui().rubber = { x: sx, y: sy, w: 0, h: 0, sx: sx, sy: sy };
    repaint();
  }

  function onMove(ev) {
    var a = app, p = local(ev), sx = p[0], sy = p[1], g = toGrid(sx, sy);
    ui().cursor = g;
    var d = ui().drag;
    if (d && d.kind === 'pan') {
      ui().view.ox = d.ox + (sx - d.sx); ui().view.oy = d.oy + (sy - d.sy);
      repaint(); return;
    }
    if (d && d.kind === 'move') {
      var dx = g[0] - d.startGrid[0], dy = g[1] - d.startGrid[1];
      if (Math.abs(sx - d.sx) + Math.abs(sy - d.sy) > 3) d.moved = true;
      if (d.moved) {
        if (!d.undoPushed) { a.pushUndo(); d.undoPushed = true; }
        d.orig.forEach(function (o) { o.c.x = o.x + dx; o.c.y = o.y + dy; });
        d.wpts.forEach(function (wp) { wp.pts[wp.qi] = [wp.x + dx, wp.y + dy]; });
        repaint();
      }
      return;
    }
    var hit = ED.hitComp(a, g[0], g[1]);
    var hid = hit ? hit.id : null;
    if (hid !== ui().hoverId) { ui().hoverId = hid; repaint(); }
    if (ui().wireDraft) {
      var last = ui().wireDraft.points[ui().wireDraft.points.length - 1];
      ui().wireDraft.preview = route(last, g, ui().wireDraft.verticalFirst);
      repaint();
    }
    if (ui().rubber) {
      ui().rubber.x = Math.min(ui().rubber.sx, sx); ui().rubber.y = Math.min(ui().rubber.sy, sy);
      ui().rubber.w = Math.abs(sx - ui().rubber.sx); ui().rubber.h = Math.abs(sy - ui().rubber.sy);
      repaint();
    }
    a.statusCoords(g[0], g[1]);
  }

  function onUp(ev) {
    var a = app, p = local(ev), sx = p[0], sy = p[1], g = toGrid(sx, sy);
    var d = ui().drag;
    ui().drag = null;
    if (d && d.kind === 'wire') {
      var pin = ED.hitPin(a, g[0], g[1], 1.3);
      var moved = Math.abs(g[0] - d.start[0]) + Math.abs(g[1] - d.start[1]) > 1;
      if (moved) {
        if (pin) ED.wireClick(g[0], g[1], pin);
        else {
          var wd = ui().wireDraft;
          if (wd) {
            var last = wd.points[wd.points.length - 1];
            route(last, g, wd.verticalFirst).forEach(function (q) {
              var lp = wd.points[wd.points.length - 1];
              if (lp[0] !== q[0] || lp[1] !== q[1]) wd.points.push(q);
            });
          }
        }
        repaint();
      }
      return;
    }
    if (d && d.kind === 'move') {
      if (d.moved) { a.rebuild(); }
      else if (d.interactive && d.clickComp) a.interactiveClick(d.clickComp, ev);
      if (d.clickComp && d.clickComp.type === 'button' && a.sim.on) a.setButton(d.clickComp, 0);
      repaint(); return;
    }
    if (ui().rubber) {
      var rb = ui().rubber; ui().rubber = null;
      if (rb.w > 4 || rb.h > 4) {
        var x0 = Math.min(rb.sx, sx), x1 = Math.max(rb.sx, sx), y0 = Math.min(rb.sy, sy), y1 = Math.max(rb.sy, sy);
        var g0 = toGrid(x0, y0), g1 = toGrid(x1, y1);
        circuit().components.forEach(function (c) {
          if (c.x >= g0[0] - 1 && c.x <= g1[0] + 1 && c.y >= g0[1] - 1 && c.y <= g1[1] + 1) ui().selection.add(c.id);
        });
        circuit().wires.forEach(function (w) {
          if ((w.points || []).every(function (q) { return q[0] >= g0[0] && q[0] <= g1[0] && q[1] >= g0[1] && q[1] <= g1[1]; })) ui().selection.add(w.id);
        });
        a.showProps();
      }
      repaint();
    }
  }

  function onDblClick(ev) {
    var p = local(ev), g = toGrid(p[0], p[1]);
    var comp = ED.hitComp(app, g[0], g[1]);
    if (comp) { app.openComponentEditor(comp); return; }
    if (ui().wireDraft) ED.finishWire();
  }

  function onContext(ev) {
    ev.preventDefault();
    var p = local(ev), g = toGrid(p[0], p[1]);
    if (ui().wireDraft) { ED.cancel(); return; }
    var wire = ED.hitWire(app, g[0], g[1], 1.2);
    var comp = ED.hitComp(app, g[0], g[1]);
    app.contextMenu(ev.clientX, ev.clientY, { wire: wire, comp: comp, gx: g[0], gy: g[1] });
  }

  function onWheel(ev) {
    ev.preventDefault();
    var p = local(ev);
    ED.zoom(ev.deltaY < 0 ? 1.12 : 1 / 1.12, p[0], p[1]);
  }

  function onKey(ev) {
    var a = app;
    var tag = (ev.target && ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    var k = ev.key, ctrl = ev.ctrlKey || ev.metaKey;
    if (k === 'Escape') { ED.cancel(); a.closeMenu(); a.closeModal(); return; }
    if (k === ' ' && !ctrl) { ui().spaceDown = true; ev.preventDefault(); return; }
    if (ctrl && k.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? a.redo() : a.undo(); return; }
    if (ctrl && k.toLowerCase() === 'y') { ev.preventDefault(); a.redo(); return; }
    if (ctrl && k.toLowerCase() === 'c') { ev.preventDefault(); ui().clipboard = ED.copy(); a.status('已复制'); return; }
    if (ctrl && k.toLowerCase() === 'x') { ev.preventDefault(); ui().clipboard = ED.copy(); ED.deleteSelection(); return; }
    if (ctrl && k.toLowerCase() === 'v') { ev.preventDefault(); ED.paste(ui().clipboard, ui().cursor ? ui().cursor[0] : 4, ui().cursor ? ui().cursor[1] : 4); return; }
    if (ctrl && k.toLowerCase() === 'a') { ev.preventDefault(); ED.selectAll(); return; }
    if (ctrl && k.toLowerCase() === 's') { ev.preventDefault(); ev.shiftKey ? a.saveAs() : a.saveFile(); return; }
    if (ctrl && k.toLowerCase() === 'd') { ev.preventDefault(); var cl = ED.copy(); ED.paste(cl, 4, 4); return; }
    if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); ED.deleteSelection(); return; }
    if (k.toLowerCase() === 'r' && !ctrl) { ED.rotateSelection(90); return; }
    if (k === 'Tab' && ui().wireDraft) { ev.preventDefault(); ui().wireDraft.verticalFirst = !ui().wireDraft.verticalFirst; a.status('拐向：' + (ui().wireDraft.verticalFirst ? '先垂直' : '先水平')); repaint(); return; }
    if (k === 'Enter' && ui().wireDraft) { ED.finishWire(); return; }
    if (k === '+' || k === '=') { ED.zoom(1.2, canvas().clientWidth / 2, canvas().clientHeight / 2); return; }
    if (k === '-') { ED.zoom(1 / 1.2, canvas().clientWidth / 2, canvas().clientHeight / 2); return; }
    if (k.toLowerCase() === 'f') { ED.fitView(); return; }
    if (k === 'F2' && ui().selection && ui().selection.size === 1) {
      var c = circuit().components.filter(function (x) { return ui().selection.has(x.id); })[0];
      if (c) a.openComponentEditor(c);
    }
  }
  function onKeyUp(ev) { if (ev.key === ' ') ui().spaceDown = false; }

  ED.attach = function (a) {
    app = a;
    var cv = a.canvas;
    cv.tabIndex = 0;
    cv.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    cv.addEventListener('dblclick', onDblClick);
    cv.addEventListener('contextmenu', onContext);
    cv.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
