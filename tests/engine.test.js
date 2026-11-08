/* Digital.js - Node 端单元 / 回归测试：node tests/engine.test.js */
'use strict';
var path = require('path');
var base = path.join(__dirname, '..', 'js');
['util', 'library', 'netlist', 'simulator', 'hdl-parse', 'hdl-io', 'analysis', 'examples'].forEach(function (f) {
  require(path.join(base, f + '.js'));
});
var D = globalThis.DIG, U = D.Util, L = D.Lib;

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); fail++; }
}
function eq(a, b, m) { if (a !== b) throw new Error((m || '') + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a)); }
function ok(v, m) { if (!v) throw new Error(m || '断言失败'); }
function near(a, b) { if (a !== b) throw new Error('期望 ' + b + '，实际 ' + a); }

function C(name) { return { name: name || 'test', components: [], wires: [], bindings: [], hdlModules: [], testText: '' }; }
function add(c, type, x, y, props) { var o = L.newComponent(type, x, y, props); c.components.push(o); return o; }
function net(c, name, conns) {
  conns.forEach(function (pair) { c.bindings.push({ compId: pair[0].id, pin: pair[1], net: name }); });
}
function sim(c) { var s = new D.Simulator(c); s.powerOn(); return s; }
function val(s, comp, pin) { return s.pinValue(comp.id, pin); }

console.log('\n[1] 基础工具');
t('位宽掩码', function () { eq(U.mask(1), 1); eq(U.mask(8), 255); eq(U.mask(32), 0xFFFFFFFF); });
t('数值解析 (十进制/十六进制/二进制/Verilog)', function () {
  eq(U.parseNum('42'), 42); eq(U.parseNum('0x2A'), 42); eq(U.parseNum('0b101010'), 42); eq(U.parseNum("8'hFF"), 255);
});
t('旋转变换', function () { eq(JSON.stringify(U.rotate(3, 0, 90)), '[0,3]'); eq(JSON.stringify(U.rotate(3, 0, 180)), '[-3,0]'); });
t('并查集合并', function () { var d = new U.DSU(); d.union('a', 'b'); d.union('b', 'c'); eq(d.find('a'), d.find('c')); });

console.log('\n[2] 网表与导线');
t('导线端点连通（含 T 形交点）', function () {
  var c = C(), a = add(c, 'portIn', 0, 0, { label: 'a' }), g = add(c, 'and', 20, 0, { inputs: 2 }), o = add(c, 'portOut', 40, 0, { label: 'y' });
  c.wires.push({ id: 'w1', points: [[3, 0], [10, 0], [17, -1]] });
  c.wires.push({ id: 'w2', points: [[10, 0], [10, 4]] });   // T 形分支
  c.wires.push({ id: 'w3', points: [[23, 0], [37, 0]] });
  c.bindings = [
    { compId: a.id, pin: 'y', net: 'a' }, { compId: g.id, pin: 'i0', net: 'a' },
    { compId: g.id, pin: 'i1', net: 'b' }, { compId: g.id, pin: 'y', net: 'y' }, { compId: o.id, pin: 'y', net: 'y' }
  ];
  var nl = D.Netlist.build(c);
  ok(nl.pinNet[a.id + '|y'] === nl.pinNet[g.id + '|i0'], '输入未连到门');
  eq(nl.nets.length, 3, '网络数');
});
t('命名网络标签把多引脚连成同一网络', function () {
  var c = C(), a = add(c, 'portIn', 0, 0, { label: 'a' }), b = add(c, 'and', 20, 0, { inputs: 2 });
  var l1 = add(c, 'netlabel', 6, 0, { name: 'X' }), l2 = add(c, 'netlabel', 14, 0, { name: 'X' });
  c.wires.push({ id: 'w1', points: [[3, 0], [6, 0]] });
  c.wires.push({ id: 'w2', points: [[14, 0], [17, -1]] });
  c.bindings = [{ compId: b.id, pin: 'i0', net: 'X' }];
  var nl = D.Netlist.build(c);
  eq(nl.pinNet[a.id + '|y'], nl.pinNet[b.id + '|i0']);
});

console.log('\n[3] 门电路与三态');
['and', 'or', 'xor', 'nand', 'nor', 'xnor'].forEach(function (type) {
  t(type + ' 真值表', function () {
    var expect = {
      and: [0, 0, 0, 1], or: [0, 1, 1, 1], xor: [0, 1, 1, 0],
      nand: [1, 1, 1, 0], nor: [1, 0, 0, 0], xnor: [1, 0, 0, 1]
    }[type];
    var c = C(), a = add(c, 'portIn', 0, 0, { label: 'a' }), b2 = add(c, 'portIn', 0, 8, { label: 'b' });
    var g = add(c, type, 20, 0, { inputs: 2 }), o = add(c, 'portOut', 40, 0, { label: 'y' });
    net(c, 'a', [[a, 'y'], [g, 'i0']]); net(c, 'b', [[b2, 'y'], [g, 'i1']]); net(c, 'y', [[g, 'y'], [o, 'y']]);
    var s = sim(c), got = [];
    for (var i = 0; i < 4; i++) {
      s.setInput(a.id, i & 1, false); s.setInput(b2.id, (i >> 1) & 1, false);
      s.dirty.clear(); for (var k = 0; k < s.cs.length; k++) s.dirty.add(k); s.settle();
      got.push(s.outputValue(o));
    }
    eq(JSON.stringify(got), JSON.stringify(expect));
  });
});
t('非门与缓冲器', function () {
  var c = C(), a = add(c, 'portIn', 0, 0, { label: 'a' }), n = add(c, 'not', 20, 0), o = add(c, 'portOut', 40, 0, { label: 'y' });
  net(c, 'a', [[a, 'y'], [n, 'i0']]); net(c, 'y', [[n, 'y'], [o, 'y']]);
  var s = sim(c); eq(s.outputValue(o), 1);
  s.setInput(a.id, 1); eq(s.outputValue(o), 0);
});
t('三态缓冲器输出高阻 Z', function () {
  var c = C(), a = add(c, 'const', 0, 0, { value: 1 }), e = add(c, 'const', 0, 10, { value: 0 }), g = add(c, 'tribuf', 20, 0), o = add(c, 'portOut', 40, 0, { label: 'y' });
  net(c, 'a', [[a, 'y'], [g, 'a']]); net(c, 'e', [[e, 'y'], [g, 'en']]); net(c, 'y', [[g, 'y'], [o, 'y']]);
  var s = sim(c), nid = s.nl.pinNet[o.id + '|y'];
  eq(s.values[nid].z, 1, '禁用时 z=1');
});
t('总线冲突检测', function () {
  var c = C(), a = add(c, 'const', 0, 0, { value: 1 }), b2 = add(c, 'const', 0, 10, { value: 0 }), o = add(c, 'portOut', 40, 0, { label: 'y' });
  net(c, 'x', [[a, 'y'], [b2, 'y'], [o, 'y']]);
  var s = sim(c);
  ok(s.nets.some(function (n) { return n.conflict; }), '未检测到冲突');
});

console.log('\n[4] 时序逻辑');
t('D 触发器仅在上升沿锁存', function () {
  var c = C(), d = add(c, 'portIn', 0, 0, { label: 'd' }), k = add(c, 'portIn', 0, 10, { label: 'c' });
  var f = add(c, 'dff', 20, 0), o = add(c, 'portOut', 40, 0, { label: 'q' });
  net(c, 'd', [[d, 'y'], [f, 'd']]); net(c, 'c', [[k, 'y'], [f, 'c']]); net(c, 'q', [[f, 'q'], [o, 'y']]);
  var s = sim(c);
  s.setInput(d.id, 1); eq(s.outputValue(o), 0, '上升沿前不应变化');
  s.setInput(k.id, 1); eq(s.outputValue(o), 1, '上升沿应锁存');
  s.setInput(d.id, 0); eq(s.outputValue(o), 1, '时钟保持高时不应变化');
  s.setInput(k.id, 0); s.setInput(k.id, 1); eq(s.outputValue(o), 0);
});
t('4 位计数器递增与清零', function () {
  var c = C(), k = add(c, 'portIn', 0, 0, { label: 'c' }), cnt = add(c, 'counter', 20, 0, { bits: 4 }), o = add(c, 'portOut', 40, 0, { label: 'q', bits: 4 });
  net(c, 'c', [[k, 'y'], [cnt, 'c']]); net(c, 'q', [[cnt, 'q'], [o, 'y']]);
  var s = sim(c), seq = [];
  for (var i = 0; i < 6; i++) { s.setInput(k.id, 1); seq.push(s.outputValue(o)); s.setInput(k.id, 0); }
  eq(JSON.stringify(seq), JSON.stringify([1, 2, 3, 4, 5, 6]));
});
t('RAM 写入 / 读取', function () {
  var c = C(), ad = add(c, 'portIn', 0, 0, { label: 'a', bits: 4 }), di = add(c, 'portIn', 0, 8, { label: 'd', bits: 8 });
  var we = add(c, 'portIn', 0, 16, { label: 'w' }), ck = add(c, 'portIn', 0, 24, { label: 'c' });
  var m = add(c, 'ram', 24, 0, { addrBits: 4, dataBits: 8, init: '' }), o = add(c, 'portOut', 50, 0, { label: 'q', bits: 8 });
  net(c, 'a', [[ad, 'y'], [m, 'addr']]); net(c, 'd', [[di, 'y'], [m, 'din']]);
  net(c, 'w', [[we, 'y'], [m, 'we']]); net(c, 'c', [[ck, 'y'], [m, 'clk']]); net(c, 'q', [[m, 'dout'], [o, 'y']]);
  var s = sim(c);
  s.setInput(ad.id, 3); s.setInput(di.id, 42); s.setInput(we.id, 1); s.setInput(ck.id, 1);
  eq(s.outputValue(o), 42);
  s.setInput(we.id, 0); s.setInput(di.id, 0); eq(s.outputValue(o), 42, '关闭写使能后应保持');
});
t('74xx 7400 与非门引脚映射', function () {
  var c = C(), a = add(c, 'portIn', 0, 0, { label: 'a' }), b2 = add(c, 'portIn', 0, 8, { label: 'b' });
  var ic = add(c, 'ic74', 24, 0, { part: '7400' }), o = add(c, 'portOut', 50, 0, { label: 'y' });
  net(c, 'a', [[a, 'y'], [ic, '1A']]); net(c, 'b', [[b2, 'y'], [ic, '1B']]); net(c, 'y', [[ic, '1Y'], [o, 'y']]);
  var s = sim(c); eq(s.outputValue(o), 1);
  s.setInput(a.id, 1); s.setInput(b2.id, 1); eq(s.outputValue(o), 0);
});
t('环形振荡器被检测为振荡', function () {
  var c = C(), g = add(c, 'not', 20, 20);
  c.wires.push({ id: 'w1', points: [[23, 20], [32, 20], [32, 8], [10, 8], [10, 20], [17, 20]] });
  var s = new D.Simulator(c); s.powerOn();
  ok(s.oscillation, '未检测到振荡');
});
t('RS 锁存器上电进入稳定态', function () {
  var c = C(), r = add(c, 'portIn', 0, 0, { label: 'r' }), ss = add(c, 'portIn', 0, 10, { label: 's' });
  var n1 = add(c, 'nor', 22, 0, { inputs: 2 }), n2 = add(c, 'nor', 22, 20, { inputs: 2 });
  net(c, 'r', [[r, 'y'], [n1, 'i0']]); net(c, 's', [[ss, 'y'], [n2, 'i0']]);
  net(c, 'q', [[n1, 'y'], [n2, 'i1']]); net(c, 'qn', [[n2, 'y'], [n1, 'i1']]);
  var s = sim(c);
  ok(!s.oscillation, '不应振荡');
  eq((val(s, n1, 'i1').v & 1) !== (val(s, n2, 'i1').v & 1), true, 'Q 与 Q̅ 应互补');
});

console.log('\n[5] Verilog / VHDL');
t('Verilog 组合逻辑编译与执行', function () {
  var m = D.HDL.compile('module ha(input a, input b, output s, output co); assign s = a ^ b; assign co = a & b; endmodule', 'verilog');
  eq(m.ports.length, 4);
  eq(D.HDL.runIR(m.ir, { a: { v: 1 }, b: { v: 1 } }, {}, {}).co.v, 1);
  eq(D.HDL.runIR(m.ir, { a: { v: 1 }, b: { v: 0 } }, {}, {}).s.v, 1);
});
t('Verilog 时序逻辑 always / if-else', function () {
  var m = D.HDL.compile('module cnt(input clk, input rst, output reg [3:0] q); always @(posedge clk or posedge rst) begin if (rst) q <= 0; else q <= q + 1; end endmodule', 'verilog');
  var st = {}, f = function (c, r) { return D.HDL.runIR(m.ir, { clk: { v: c }, rst: { v: r } }, st, {}).q.v; };
  eq(f(0, 0), 0); eq(f(1, 0), 1); eq(f(0, 0), 1); eq(f(1, 0), 2); eq(f(1, 1), 0);
});
t('Verilog case / always @(*)', function () {
  var m = D.HDL.compile("module alu(input [3:0] a, input [3:0] b, input [1:0] op, output reg [3:0] y); always @(*) begin case(op) 2'b00: y = a + b; 2'b01: y = a - b; 2'b10: y = a & b; default: y = a ^ b; endcase end endmodule", 'verilog');
  var st = {}, f = function (op) { return D.HDL.runIR(m.ir, { a: { v: 6 }, b: { v: 3 }, op: { v: op } }, st, {}).y.v; };
  eq(f(0), 9); eq(f(1), 3); eq(f(2), 2); eq(f(3), 5);
});
t('VHDL 组合逻辑编译与执行', function () {
  var m = D.HDL.compile('entity and2 is port (a,b : in std_logic; y : out std_logic); end and2; architecture rtl of and2 is begin y <= a and b; end rtl;', 'vhdl');
  eq(D.HDL.runIR(m.ir, { a: { v: 1 }, b: { v: 1 } }, {}, {}).y.v, 1);
  eq(D.HDL.runIR(m.ir, { a: { v: 1 }, b: { v: 0 } }, {}, {}).y.v, 0);
});
t('VHDL 字运算符 and/or/not 与括号', function () {
  var m = D.HDL.compile('entity lg is port (a,b,c : in std_logic; y : out std_logic); end lg; architecture rtl of lg is begin y <= (a and b) or (not c); end rtl;', 'vhdl');
  var f = function (a, b, c) { return D.HDL.runIR(m.ir, { a: { v: a }, b: { v: b }, c: { v: c } }, {}, {}).y.v; };
  eq(f(1, 1, 1), 1); eq(f(1, 1, 0), 1); eq(f(0, 1, 1), 0); eq(f(0, 0, 0), 1);
});
t('VHDL when-else 条件赋值', function () {
  var m = D.HDL.compile("entity mux2 is port (a,b,s : in std_logic; y : out std_logic); end mux2; architecture rtl of mux2 is begin y <= a when s = '1' else b; end rtl;", 'vhdl');
  var f = function (a, b, s) { return D.HDL.runIR(m.ir, { a: { v: a }, b: { v: b }, s: { v: s } }, {}, {}).y.v; };
  eq(f(1, 0, 1), 1); eq(f(1, 0, 0), 0);
});
t('VHDL process / rising_edge 触发器', function () {
  var m = D.HDL.compile("entity dff is port (d, clk : in std_logic; q : out std_logic); end dff; architecture rtl of dff is begin process(clk) begin if rising_edge(clk) then q <= d; end if; end process; end rtl;", 'vhdl');
  var st = {}, f = function (d, c) { return D.HDL.runIR(m.ir, { d: { v: d }, clk: { v: c } }, st, {}).q.v; };
  eq(f(1, 0), 0); eq(f(1, 1), 1); eq(f(0, 1), 1); eq(f(0, 0), 1); eq(f(0, 1), 0);
});
t('整图导出 Verilog / VHDL', function () {
  var c = D.Examples.halfAdder();
  var v = D.HDL.exportHDL(c, 'verilog'), h = D.HDL.exportHDL(c, 'vhdl');
  ok(/module Half_Adder\s*\(/.test(v.code), 'Verilog 缺少 module');
  ok(/assign\s+\w+\s*=\s*\(a \^ b\)/.test(v.code), 'Verilog 缺少异或赋值');
  ok(/entity Half_Adder is/.test(h.code), 'VHDL 缺少 entity');
  ok(/a xor b/.test(h.code), 'VHDL 缺少 xor');
  ok(/end rtl;/.test(h.code), 'VHDL 缺少 end rtl');
});
t('时序电路导出含 always/process', function () {
  var c = D.Examples.counterDisplay();
  var v = D.HDL.exportHDL(c, 'verilog'), h = D.HDL.exportHDL(c, 'vhdl');
  ok(/always @\(posedge/.test(v.code), '缺少 Verilog always');
  ok(/process\(/.test(h.code) && /rising_edge/.test(h.code), '缺少 VHDL process');
});
t('HDL 文件导入并展开为门级电路', function () {
  var src = 'module gates(input a, input b, output y, output z); and g1(y, a, b); xor g2(z, a, b); endmodule';
  var m = D.HDL.compile(src, 'verilog'), g = D.HDL.importGates(m, src);
  ok(g.circuit.components.some(function (x) { return x.type === 'and'; }), '未生成与门');
  var s = sim(g.circuit);
  ok(!s.oscillation, '展开电路振荡');
  ok(s.nets.length >= 4, '网络数不足');
});
t('HDL 元件在原理图中参与仿真', function () {
  var c = D.Examples.vhdlAdder(), s = sim(c);
  var ins = c.components.filter(function (x) { return x.type === 'portIn'; });
  var out = c.components.filter(function (x) { return x.type === 'probe'; })[0];
  s.setInput(ins[0].id, 3); s.setInput(ins[1].id, 4);
  eq(s.outputValue(out), 7);
});

console.log('\n[6] 分析与测试');
t('真值表 + Quine–McCluskey 最小化', function () {
  var c = D.Examples.halfAdder(), tt = D.Analysis.truthTable(c), ex = D.Analysis.expressions(tt);
  eq(tt.rows.length, 4);
  ok(/a & ~b/.test(ex[0].expr) || /~a & b/.test(ex[0].expr), '异或最小化结果异常: ' + ex[0].expr);
  eq(D.Analysis.termsToExpr(D.Analysis.minimize([3], [], 2).terms, 2, ['a', 'b']), '(a & b)');
});
t('测试用例执行', function () {
  var c = D.Examples.fullAdder(), r = D.Analysis.runTests(c, c.testText);
  eq(r.total, 5); eq(r.passed, 5);
});
t('表达式生成电路', function () {
  var c = D.Analysis.circuitFromExpression('(A & ~B) | (~A & B)', ['A', 'B'], 'Y');
  ok(c.components.length > 4);
  var s = sim(c); ok(!s.oscillation);
});
t('全部内置示例可上电稳定', function () {
  D.Examples.list.forEach(function (e) {
    var c = e.make(), s = sim(c);
    ok(!s.oscillation, e.id + ' 振荡');
    eq(s.errors.length, 0, e.id + ' 有错误');
  });
});

console.log('\n========================================');
console.log(pass + ' 项通过, ' + fail + ' 项失败');
console.log('========================================\n');
process.exit(fail ? 1 : 0);
