/* 浏览器端冒烟测试：把结果写进 <pre id="SMOKE_RESULT">，供 --dump-dom 抓取 */
(function () {
  var out = [], errors = [];
  window.confirm = function () { return true; };
  window.alert = function () { };
  window.prompt = function () { return ''; };
  window.addEventListener('error', function (e) { errors.push('window.onerror: ' + e.message + ' @' + e.filename + ':' + e.lineno); });
  function ok(name, fn) {
    try { var r = fn(); out.push('PASS | ' + name + (r === undefined ? '' : ' | ' + r)); }
    catch (e) { out.push('FAIL | ' + name + ' | ' + (e && e.stack || e)); }
  }
  function eq(name, a, b) { ok(name, function () { if (a !== b) throw new Error('期望 ' + b + '，实际 ' + a); return a; }); }

  function run() {
    var D = window.DIG, App = D && D.App;
    ok('命名空间与模块加载', function () {
      ['Util', 'Lib', 'Netlist', 'Simulator', 'HDL', 'Analysis', 'Examples', 'Render', 'Editor', 'App'].forEach(function (k) {
        if (!D[k]) throw new Error('缺少模块 ' + k);
      });
      return '元件类型 ' + D.Lib.allTypes().length;
    });
    ok('应用初始化 / 默认示例', function () { if (!App.sim) throw new Error('sim 未初始化'); return App.circuit.name + ', ' + App.circuit.components.length + ' 个对象'; });
    ok('元件面板渲染', function () { var n = document.querySelectorAll('.pal-item').length; if (n < 30) throw new Error('元件数过少 ' + n); return n + ' 项'; });
    ok('画布渲染', function () { App.repaint(); return App.canvas.width + 'x' + App.canvas.height; });
    ok('上电仿真', function () { App.powerToggle(); if (!App.sim.on) throw new Error('未上电'); return 'tick=' + App.sim.tick + ', errors=' + App.sim.errors.length; });
    ok('拨动开关并稳定', function () {
      var sw = App.circuit.components.filter(function (c) { return c.type === 'switch'; })[0];
      var inp = App.circuit.components.filter(function (c) { return c.type === 'portIn'; });
      if (inp.length) { App.sim.setInput(inp[0].id, 1); App.sim.setInput(inp[1].id, 1); }
      return 's=' + App.sim.outputValue(App.circuit.components.filter(function (c) { return c.type === 'portOut'; })[0]);
    });
    ok('单步 / 单门步进', function () { App.step(); App.gateStep(); return 'tick=' + App.sim.tick; });
    ok('Verilog 导出', function () { var r = D.HDL.exportHDL(App.circuit, 'verilog'); if (!/module /.test(r.code)) throw new Error('无 module'); return r.code.split('\n').length + ' 行'; });
    ok('VHDL 导出', function () { var r = D.HDL.exportHDL(App.circuit, 'vhdl'); if (!/entity /.test(r.code)) throw new Error('无 entity'); return r.code.split('\n').length + ' 行'; });
    ok('全部示例可仿真', function () {
      var s = [];
      D.Examples.list.forEach(function (e) {
        var c = e.make(), sim = new D.Simulator(c); sim.powerOn();
        if (sim.oscillation) throw new Error(e.id + ' 振荡');
        s.push(e.id);
      });
      return s.length + ' 个';
    });
    ok('真值表分析 + 最小化', function () {
      var c = D.Examples.halfAdder(), tt = D.Analysis.truthTable(c), ex = D.Analysis.expressions(tt);
      if (tt.rows.length !== 4) throw new Error('行数 ' + tt.rows.length);
      return 's=' + ex[0].expr + ' co=' + ex[1].expr;
    });
    ok('表达式生成电路', function () { var c = D.Analysis.circuitFromExpression('(A & ~B) | (~A & B)', ['A', 'B'], 'Y'); return c.components.length + ' 个对象'; });
    ok('测试用例', function () { var c = D.Examples.halfAdder(), r = D.Analysis.runTests(c, c.testText); if (r.passed !== r.total) throw new Error(r.passed + '/' + r.total); return r.passed + '/' + r.total; });
    ok('Verilog 行为级编译与执行', function () {
      var m = D.HDL.compile('module m(input a, input b, output y); assign y = a ^ b; endmodule', 'verilog');
      var r = D.HDL.runIR(m.ir, { a: { v: 1 }, b: { v: 0 } }, {}, {});
      if (r.y.v !== 1) throw new Error('y=' + r.y.v);
      return 'y=' + r.y.v;
    });
    ok('VHDL 行为级编译与执行', function () {
      var m = D.HDL.compile('entity m is port (a,b : in std_logic; y : out std_logic); end m; architecture rtl of m is begin y <= a and b; end rtl;', 'vhdl');
      var r = D.HDL.runIR(m.ir, { a: { v: 1 }, b: { v: 1 } }, {}, {});
      if (r.y.v !== 1) throw new Error('y=' + r.y.v);
      return 'y=' + r.y.v;
    });
    ok('HDL 结构级展开为门电路', function () {
      var src = 'module gates(input a, input b, output y, output z); and g1(y, a, b); xor g2(z, a, b); endmodule';
      var m = D.HDL.compile(src, 'verilog'), g = D.HDL.importGates(m, src);
      var sim = new D.Simulator(g.circuit); sim.powerOn();
      if (sim.oscillation) throw new Error('展开电路振荡');
      return g.circuit.components.length + ' 个对象 / ' + sim.nets.length + ' 个网络';
    });
    ok('UI: 真值表面板', function () { App.analyze(); return document.querySelectorAll('#tab-table table').length + ' 张表'; });
    ok('UI: 运行测试', function () { App.runTests(); return document.querySelector('#test-summary').textContent.trim(); });
    ok('UI: HDL 导出弹窗', function () { App.openHDL('verilog'); var t = document.querySelector('#hdl-code'); if (!t || !t.value) throw new Error('无代码'); App.closeModal(); return '弹窗正常'; });
    ok('UI: HDL 元件编辑弹窗', function () { App.openHDLEditor(null); var mod = App.hdlCompile(App._modal); if (!mod) throw new Error('编译失败'); App.closeModal(); return mod.name; });
    ok('UI: 示例弹窗', function () { App.openExamples(); var n = document.querySelectorAll('.ex-card').length; App.closeModal(); if (n < 8) throw new Error('示例过少'); return n + ' 个示例'; });
    ok('UI: 帮助弹窗', function () { App.openHelp(); App.closeModal(); return '正常'; });
    ok('UI: SVG 导出', function () { var s = D.Render.toSVG(App.circuit, App.sim); if (!/<svg/.test(s)) throw new Error('无 svg'); return s.length + ' 字节'; });
    ok('UI: 属性面板', function () { App.showProps(); return document.querySelectorAll('#props .prop-row').length + ' 行'; });
    ok('UI: 新建 + 撤销', function () { var before = App.circuit.name; App.doAction('new'); App.undo(); if (App.circuit.name !== before) throw new Error('撤销失效'); return '正常'; });

    var pre = document.createElement('pre');
    pre.id = 'SMOKE_RESULT';
    pre.textContent = '\n===SMOKE_BEGIN===\n' + out.join('\n') + '\n' + (errors.length ? 'JS_ERRORS:\n' + errors.join('\n') + '\n' : 'JS_ERRORS: none\n') +
      'SUMMARY: ' + out.filter(function (x) { return x.indexOf('PASS') === 0; }).length + ' passed, ' + out.filter(function (x) { return x.indexOf('FAIL') === 0; }).length + ' failed\n===SMOKE_END===\n';
    document.body.appendChild(pre);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(run, 60); });
  else setTimeout(run, 60);
})();
