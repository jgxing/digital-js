/* Digital.js - 内置示例电路 */
(function (root) {
  'use strict';
  var DIG = (root.DIG = root.DIG || {});
  var U = DIG.Util, L = DIG.Lib;
  var E = (DIG.Examples = {});

  function Builder(name) {
    this.c = { name: name, components: [], wires: [], bindings: [], hdlModules: [], testText: '', description: '' };
    this.pos = {};
  }
  Builder.prototype.add = function (type, x, y, props, conn) {
    var c = L.newComponent(type, x, y, props);
    this.c.components.push(c);
    if (conn) for (var pin in conn) if (Object.prototype.hasOwnProperty.call(conn, pin)) this.bind(c, pin, conn[pin]);
    return c;
  };
  Builder.prototype.bind = function (c, pin, net) {
    var ps = L.pinsOf(c).filter(function (p) { return p.name === pin; });
    if (!ps.length) return;
    var p = ps[0], px = c.x + p.x, py = c.y + p.y;
    var lx = px + (p.ax || -1) * 4, ly = py + (p.ay || 0) * 4;
    var k = lx + ',' + ly, guard = 0;
    while (this.pos[k] !== undefined && this.pos[k] !== net && guard++ < 30) { ly += 3; k = lx + ',' + ly; }
    if (this.pos[k] === net) { // 复用同名标签
      this.c.wires.push({ id: U.uid('w'), points: [[px, py], [lx, ly]] });
      return;
    }
    this.pos[k] = net;
    var lab = L.newComponent('netlabel', lx, ly, { name: net, bits: U.clamp(p.bits, 1, 32) });
    this.c.components.push(lab);
    this.c.wires.push({ id: U.uid('w'), points: [[px, py], [lx, ly]] });
  };
  Builder.prototype.wire = function (points) {
    this.c.wires.push({ id: U.uid('w'), points: U.clone(points) });
    return this;
  };
  Builder.prototype.done = function (desc, test) {
    this.c.description = desc || '';
    if (test) this.c.testText = test;
    return U.clone(this.c);
  };
  E.Builder = Builder;

  /* ---------- 1. 半加器 ---------- */
  E.halfAdder = function () {
    var b = new Builder('半加器 Half Adder');
    b.add('portIn', 10, 12, { label: 'a' });
    b.add('portIn', 10, 30, { label: 'b' });
    b.add('xor', 34, 12, { inputs: 2 });
    b.add('and', 34, 34, { inputs: 2 });
    b.add('portOut', 60, 12, { label: 's' });
    b.add('portOut', 60, 34, { label: 'co' });
    b.add('text', 35, 54, { text: 's = a ⊕ b   ·   co = a ∧ b', size: 13 });
    // a 扇出到两个门的 i0
    b.wire([[13, 12], [20, 12], [20, 11], [31, 11]]);
    b.wire([[20, 12], [20, 33], [31, 33]]);
    // b 扇出到两个门的 i1
    b.wire([[13, 30], [24, 30], [24, 13], [31, 13]]);
    b.wire([[24, 30], [24, 35], [31, 35]]);
    // 输出
    b.wire([[37, 12], [57, 12]]);
    b.wire([[37, 34], [57, 34]]);
    return b.done('两个 1 位输入，输出和 s 与进位 co。可在「分析」中生成真值表并最小化表达式。',
      'a b | s co\n0 0 | 0 0\n0 1 | 1 0\n1 0 | 1 0\n1 1 | 0 1');
  };

  /* ---------- 2. 全加器 ---------- */
  E.fullAdder = function () {
    var b = new Builder('全加器 Full Adder');
    b.add('portIn', 10, 10, { label: 'a' }, { y: 'a' });
    b.add('portIn', 10, 26, { label: 'b' }, { y: 'b' });
    b.add('portIn', 10, 42, { label: 'ci' }, { y: 'ci' });
    b.add('xor', 34, 10, { inputs: 2 }, { i0: 'a', i1: 'b', y: 'p' });
    b.add('xor', 56, 10, { inputs: 2 }, { i0: 'p', i1: 'ci', y: 's' });
    b.add('and', 34, 34, { inputs: 2 }, { i0: 'a', i1: 'b', y: 'g' });
    b.add('and', 56, 34, { inputs: 2 }, { i0: 'p', i1: 'ci', y: 'h' });
    b.add('or', 78, 34, { inputs: 2 }, { i0: 'g', i1: 'h', y: 'co' });
    b.add('portOut', 100, 10, { label: 's' }, { y: 's' });
    b.add('portOut', 100, 40, { label: 'co' }, { y: 'co' });
    return b.done('带进位输入的 1 位全加器，可级联成多位加法器。',
      'a b ci | s co\n0 0 0 | 0 0\n0 0 1 | 1 0\n0 1 0 | 1 0\n0 1 1 | 0 1\n1 1 1 | 1 1');
  };

  /* ---------- 3. RS 锁存器 ---------- */
  E.rsLatch = function () {
    var b = new Builder('RS 锁存器（或非门交叉耦合）');
    b.add('switch', 10, 12, { label: 'S' }, { y: 's' });
    b.add('switch', 10, 40, { label: 'R' }, { y: 'r' });
    b.add('nor', 38, 12, { inputs: 2 }, { i0: 'r', i1: 'qn', y: 'q' });
    b.add('nor', 38, 40, { inputs: 2 }, { i0: 's', i1: 'q', y: 'qn' });
    b.add('led', 66, 12, { label: 'Q', color: 'green' }, { a: 'q' });
    b.add('led', 66, 40, { label: 'Q̅', color: 'red' }, { a: 'qn' });
    return b.done('典型组合反馈电路。上电时采用随机门延迟进入稳定状态；拨动 S / R 观察置位与复位。');
  };

  /* ---------- 4. 4 位计数器 + 七段显示 ---------- */
  E.counterDisplay = function () {
    var b = new Builder('4 位计数器与七段显示');
    b.add('clock', 10, 12, { label: 'CLK', div: 5 }, { y: 'clk' });
    b.add('switch', 10, 34, { label: 'EN', init: 1 }, { y: 'en' });
    b.add('switch', 10, 54, { label: 'CLR' }, { y: 'clr' });
    b.add('counter', 40, 22, { bits: 4 }, { c: 'clk', en: 'en', clr: 'clr', q: 'q' });
    b.add('hexdisplay', 74, 14, {}, { d: 'q' });
    b.add('probe', 74, 40, { label: 'Q', format: 'dec', bits: 4 }, { a: 'q' });
    return b.done('点击工具栏「上电」再「运行」，观察计数与数码管。开关 EN 控制使能，CLR 清零。');
  };

  /* ---------- 5. 4 位 ALU ---------- */
  E.alu = function () {
    var b = new Builder('4 位简易 ALU');
    b.add('portIn', 8, 10, { label: 'A', bits: 4 }, { y: 'a' });
    b.add('portIn', 8, 32, { label: 'B', bits: 4 }, { y: 'b' });
    b.add('switch', 8, 56, { label: 'SUB' }, { y: 'sub' });
    b.add('adder', 36, 14, { bits: 4, sub: false }, { a: 'a', b: 'b', ci: 'sub', s: 'sum', co: 'carry' });
    b.add('and', 36, 46, { inputs: 2, bits: 4 }, { i0: 'a', i1: 'b', y: 'land' });
    b.add('xor', 36, 68, { inputs: 2, bits: 4 }, { i0: 'a', i1: 'b', y: 'lxor' });
    b.add('mux', 66, 16, { inputs: 4, bits: 4 }, { i0: 'sum', i1: 'lxor', i2: 'land', i3: 'sum', sel: 'op', y: 'y' });
    b.add('portIn', 66, 60, { label: 'OP', bits: 2 }, { y: 'op' });
    b.add('probe', 96, 16, { label: 'Y', format: 'dec', bits: 4 }, { a: 'y' });
    b.add('led', 96, 46, { label: 'C', color: 'yellow' }, { a: 'carry' });
    return b.done('OP: 00=加法（SUB 控制进位）、01=异或、10=与。修改输入端口数值后按「单步」观察。',
      'A B SUB OP | Y C\n0 0 0 0 | 0 0\n3 4 0 0 | 7 0\n3 4 0 1 | 7 0\n3 4 0 2 | 0 0');
  };

  /* ---------- 6. 74xx 芯片 ---------- */
  E.ic7400 = function () {
    var b = new Builder('7400 四与非门');
    for (var k = 0; k < 4; k++) {
      var y = 10 + k * 20;
      b.add('switch', 8, y, { label: 'A' + (k + 1) }, { y: 'a' + k });
      b.add('switch', 8, y + 8, { label: 'B' + (k + 1) }, { y: 'bb' + k });
    }
    var ic = b.add('ic74', 44, 40, { part: '7400' });
    var map = ['1A', '1B', '1Y', '2A', '2B', '2Y', '3A', '3B', '3Y', '4A', '4B', '4Y'];
    var conn = {};
    conn['1A'] = 'a0'; conn['1B'] = 'bb0'; conn['1Y'] = 'y0';
    conn['2A'] = 'a1'; conn['2B'] = 'bb1'; conn['2Y'] = 'y1';
    conn['3A'] = 'a2'; conn['3B'] = 'bb2'; conn['3Y'] = 'y2';
    conn['4A'] = 'a3'; conn['4B'] = 'bb3'; conn['4Y'] = 'y3';
    for (var pin in conn) if (Object.prototype.hasOwnProperty.call(conn, pin)) b.bind(ic, pin, conn[pin]);
    for (var j = 0; j < 4; j++) b.add('led', 78, 10 + j * 20, { label: 'Y' + (j + 1) }, { a: 'y' + j });
    return b.done('使用内置 74xx 元件库。在属性面板可切换为 7402 / 7404 / 7408 / 7432 / 7486 / 7474 / 74138 / 74157 等型号。');
  };

  /* ---------- 7. Verilog HDL 元件 ---------- */
  E.verilogCounter = function () {
    var code = [
      '// 4 位同步计数器（Verilog 行为描述）',
      'module vcounter (',
      '    input clk,',
      '    input rst,',
      '    output reg [3:0] q',
      ');',
      '  always @(posedge clk or posedge rst) begin',
      '    if (rst) q <= 4\'d0;',
      '    else      q <= q + 4\'d1;',
      '  end',
      'endmodule'
    ].join('\n');
    var mod = DIG.HDL.compile(code, 'verilog');
    var b = new Builder('Verilog HDL 元件：计数器');
    b.add('clock', 10, 12, { label: 'CLK', div: 4 }, { y: 'clk' });
    b.add('switch', 10, 38, { label: 'RST' }, { y: 'rst' });
    b.add('hdl', 44, 24, {
      name: mod.name, lang: 'verilog', code: code, hdlPorts: mod.ports, hdlIR: mod.ir
    }, { clk: 'clk', rst: 'rst', q: 'q' });
    b.add('hexdisplay', 78, 14, {}, { d: 'q' });
    b.add('probe', 78, 42, { label: 'Q', format: 'dec', bits: 4 }, { a: 'q' });
    b.c.hdlModules.push({ name: mod.name, lang: 'verilog', code: code });
    return b.done('该元件由 Verilog 源码直接编译并参与仿真（无需外部 GHDL / Icarus）。双击元件可编辑源码。');
  };

  /* ---------- 8. VHDL HDL 元件 ---------- */
  E.vhdlAdder = function () {
    var code = [
      '-- 4 位加法器（VHDL 行为描述）',
      'library IEEE;',
      'use IEEE.STD_LOGIC_1164.ALL;',
      'use IEEE.NUMERIC_STD.ALL;',
      'entity vhdl_adder is',
      '  port ( a : in  std_logic_vector(3 downto 0);',
      '         b : in  std_logic_vector(3 downto 0);',
      '         y : out std_logic_vector(3 downto 0) );',
      'end vhdl_adder;',
      'architecture rtl of vhdl_adder is',
      'begin',
      '  y <= std_logic_vector(unsigned(a) + unsigned(b));',
      'end rtl;'
    ].join('\n');
    var mod = DIG.HDL.compile(code, 'vhdl');
    var b = new Builder('VHDL HDL 元件：加法器');
    b.add('portIn', 10, 12, { label: 'A', bits: 4 }, { y: 'a' });
    b.add('portIn', 10, 38, { label: 'B', bits: 4 }, { y: 'b' });
    b.add('hdl', 46, 24, {
      name: mod.name, lang: 'vhdl', code: code, hdlPorts: mod.ports, hdlIR: mod.ir
    }, { a: 'a', b: 'b', y: 'y' });
    b.add('probe', 82, 24, { label: 'Y', format: 'dec', bits: 4 }, { a: 'y' });
    b.c.hdlModules.push({ name: mod.name, lang: 'vhdl', code: code });
    return b.done('该元件由 VHDL 源码编译并参与仿真。支持 std_logic_vector、unsigned、rising_edge、process 等常用语法。',
      'A B | Y\n0 0 | 0\n3 4 | 7\n9 6 | 15');
  };

  /* ---------- 9. RAM 演示 ---------- */
  E.ramDemo = function () {
    var b = new Builder('16×8 RAM 读写演示');
    b.add('portIn', 8, 10, { label: 'ADDR', bits: 4 }, { y: 'addr' });
    b.add('portIn', 8, 32, { label: 'DIN', bits: 8 }, { y: 'din' });
    b.add('clock', 8, 56, { label: 'CLK', div: 6 }, { y: 'clk' });
    b.add('switch', 8, 76, { label: 'WE' }, { y: 'we' });
    b.add('ram', 44, 34, { addrBits: 4, dataBits: 8, init: '0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15' },
      { addr: 'addr', din: 'din', we: 'we', clk: 'clk', dout: 'dout' });
    b.add('probe', 82, 34, { label: 'DOUT', format: 'dec', bits: 8 }, { a: 'dout' });
    return b.done('打开 WE 并在时钟上升沿写入数据，关闭 WE 后修改 ADDR 可读取。');
  };

  /* ---------- 10. 3-8 译码器 ---------- */
  E.decoder = function () {
    var b = new Builder('3-8 译码器');
    b.add('portIn', 10, 20, { label: 'A', bits: 3 }, { y: 'a' });
    b.add('switch', 10, 48, { label: 'EN' }, { y: 'en' });
    b.add('decoder', 42, 40, { bits: 3, enable: true }, (function () {
      var cn = { a: 'a', en: 'en' }; for (var i = 0; i < 8; i++) cn['y' + i] = 'y' + i; return cn;
    })());
    for (var i = 0; i < 8; i++) b.add('led', 78, 8 + i * 12, { label: 'Y' + i, color: i % 2 ? 'green' : 'red' }, { a: 'y' + i });
    return b.done('输入 3 位地址点亮对应的输出 LED，EN 为使能端。');
  };

  E.list = [
    { id: 'halfAdder', name: '半加器', cat: '基础', make: E.halfAdder },
    { id: 'fullAdder', name: '全加器', cat: '基础', make: E.fullAdder },
    { id: 'rsLatch', name: 'RS 锁存器', cat: '基础', make: E.rsLatch },
    { id: 'decoder', name: '3-8 译码器', cat: '组合逻辑', make: E.decoder },
    { id: 'alu', name: '4 位 ALU', cat: '组合逻辑', make: E.alu },
    { id: 'counterDisplay', name: '计数器 + 七段显示', cat: '时序逻辑', make: E.counterDisplay },
    { id: 'ramDemo', name: '16×8 RAM', cat: '时序逻辑', make: E.ramDemo },
    { id: 'ic7400', name: '7400 与非门芯片', cat: '74xx', make: E.ic7400 },
    { id: 'verilogCounter', name: 'Verilog 计数器元件', cat: 'HDL', make: E.verilogCounter },
    { id: 'vhdlAdder', name: 'VHDL 加法器元件', cat: 'HDL', make: E.vhdlAdder }
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = DIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
