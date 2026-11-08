/* Digital.js - HDL 双向接口：整图导出 Verilog/VHDL，HDL 文件导入并展开为门电路 */
(function (root) {
  'use strict';
  var DIG = (root.DIG = root.DIG || {});
  var U = DIG.Util, L = DIG.Lib, H = DIG.HDL;

  function safe(s, fallback) {
    s = ('' + (s == null ? '' : s)).replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+/, '');
    if (!s || /^[0-9]/.test(s)) s = (fallback || 'n') + (s ? '_' + s : '');
    return s;
  }
  function uniq(name, used) {
    var n = name, i = 2;
    while (used[n]) n = name + '_' + (i++);
    used[n] = 1; return n;
  }

  /* ==================== 导出 ==================== */
  function exportHDL(circuit, lang) {
    lang = lang === 'vhdl' ? 'vhdl' : 'verilog';
    var isV = lang === 'verilog';
    var cm = isV ? '// ' : '-- ';
    var nl = DIG.Netlist.build(circuit);
    var nets = nl.nets, pinNet = nl.pinNet;
    var warnings = nl.warnings.slice();
    var used = {};
    var modName = safe(circuit.name || 'circuit', 'circuit');
    var netNames = nets.map(function (n, i) {
      var base = n.name ? safe(n.name, 'net') : 'n' + i;
      return uniq(base, used);
    });
    var ports = [];       // {name, dir, bits, net, comp}
    var extraModules = [];
    var decl = [];        // 内部 reg / signal / memory 声明
    var assigns = [];     // 连续赋值
    var procs = [];       // always / process
    var initBlocks = [];

    function netRef(id) { return id === undefined ? null : netNames[id]; }
    function outNet(comp, pin) { return netRef(pinNet[comp.id + '|' + pin]); }
    function rd(comp, pin, bits) {
      var id = pinNet[comp.id + '|' + pin];
      if (id === undefined) return K(bits || 1, 0);
      var n = nets[id], r = netNames[id];
      if (n.bits > (bits || n.bits)) r = slice(r, (bits || 1) - 1, 0);
      return r;
    }
    function K(bits, v) {
      bits = U.clamp(bits || 1, 1, 32); v = v >>> 0;
      if (isV) return bits + "'h" + (v & U.mask(bits)).toString(16);
      if (bits === 1) return "'" + (v & 1) + "'";
      return 'std_logic_vector(to_unsigned(' + (v & U.mask(bits)) + ', ' + bits + '))';
    }
    function slice(r, hi, lo) { return isV ? r + '[' + hi + ':' + lo + ']' : r + '(' + hi + ' downto ' + lo + ')'; }
    function bit(r, i) { return isV ? r + '[' + i + ']' : r + '(' + i + ')'; }
    function NOT(x) { return isV ? '(~' + x + ')' : '(not ' + x + ')'; }
    function BIN(op, list) {
      if (isV) {
        var m = { '&': '&', '|': '|', '^': '^', '~&': '&', '~|': '|', '~^': '^', '^~': '^' }[op] || op;
        var s = '(' + list.join(' ' + m + ' ') + ')';
        return op[0] === '~' ? NOT(s) : s;
      }
      var m2 = { '&': 'and', '|': 'or', '^': 'xor', '~&': 'nand', '~|': 'nor', '~^': 'xnor', '^~': 'xnor' }[op] || 'and';
      return '(' + list.join(' ' + m2 + ' ') + ')';
    }
    function ADD(a, b, bits) {
      return isV ? '(' + a + ' + ' + b + ')' : 'std_logic_vector(unsigned(' + a + ') + unsigned(' + b + '))';
    }
    function SUB(a, b, bits) {
      return isV ? '(' + a + ' - ' + b + ')' : 'std_logic_vector(unsigned(' + a + ') - unsigned(' + b + '))';
    }
    function EQ(a, k, bits) {
      return isV ? '(' + a + ' == ' + K(bits, k) + ')' : '(to_integer(unsigned(' + a + ')) = ' + k + ')';
    }
    function CMP(a, b, op) {
      if (isV) return '(' + a + ' ' + op + ' ' + b + ')';
      return '(' + a + ' ' + (op === '==' ? '=' : op) + ' ' + b + ')';
    }
    function COND(c, a, b) { return isV ? '(' + c + ' ? ' + a + ' : ' + b + ')' : '(' + a + ' when ' + c + ' else ' + b + ')'; }
    function emit(net, expr) {
      if (!net) return;
      assigns.push(isV ? '  assign ' + net + ' = ' + expr + ';' : '  ' + net + ' <= ' + expr + ';');
    }
    function emitConst(net, expr) { emit(net, expr); }
    function portBits(c) {
      switch (c.type) {
        case 'portIn': case 'probe': return c.props.bits || 1;
        case 'switch': return c.props.bits || 1;
        case 'hexdisplay': return 4;
        case 'led': case 'button': case 'clock': return 1;
        case 'portOut': return c.props.bits || 1;
        default: return 1;
      }
    }
    function portLabel(c, idx) {
      var nm = c.props.label || c.props.name || (c.type + idx);
      return uniq(safe(nm, c.type + idx), used);
    }

    // ---- 端口收集 ----
    var IN_PORT_TYPES = { switch: 1, button: 1, portIn: 1, clock: 1 };
    circuit.components.forEach(function (c, i) {
      if (IN_PORT_TYPES[c.type]) {
        var label = portLabel(c, i);
        ports.push({ name: label, dir: 'in', bits: portBits(c), net: outNet(c, 'y'), comp: c });
      } else if (L.isOutputPort(c)) {
        var label2 = portLabel(c, i);
        ports.push({ name: label2, dir: 'out', bits: portBits(c), net: netRef(pinNet[c.id + '|' + (c.type === 'hexdisplay' ? 'd' : (c.type === 'portOut' ? 'y' : 'a'))]), comp: c });
      }
    });
    // 输出元件的实际输入引脚名
    var OUTPIN = { led: 'a', probe: 'a', hexdisplay: 'd', portOut: 'y' };
    // 上面 portOut 用 'y'，实际引脚是 'y'？ portOut 定义引脚名为 'y' 且 dir 为 in —— 修正
    ports.forEach(function (p) {
      if (p.dir === 'out') {
        var c = p.comp;
        var pinName = OUTPIN[c.type] || L.pinsOf(c)[0].name;
        p.net = netRef(pinNet[c.id + '|' + pinName]);
      }
    });

    var inputNetToPort = {};
    ports.forEach(function (p) { if (p.dir === 'in' && p.net) inputNetToPort[p.net] = p; });
    var isPortNet = netNames.map(function (nm) { return !!inputNetToPort[nm]; });

    // 输入端口直接使用端口名作为网络名，避免重复声明
    netNames = netNames.map(function (nm, i) {
      var p = inputNetToPort[nm];
      return p ? p.name : nm;
    });
    // 重新绑定 rd/outNet（闭包引用 netNames，已更新）

    var regNets = {};
    function seqRegName(c, suffix, bits) {
      var nm = 'q_' + safe(c.id, 'x').replace(/[^A-Za-z0-9_]/g, '') + (suffix || '');
      decl.push(isV
        ? '  reg [' + (bits - 1) + ':0] ' + nm + ' = ' + K(bits, 0) + ';'
        : '  signal ' + nm + ' : std_logic_vector(' + (bits - 1) + ' downto 0) := (others => \'0\');');
      return nm;
    }
    function edgeProc(clk, body, neg) {
      if (isV) procs.push('  always @(' + (neg ? 'negedge ' : 'posedge ') + clk + ') begin\n' + body + '\n  end');
      else procs.push('  process(' + clk + ')\n  begin\n    if ' + (neg ? 'falling_edge' : 'rising_edge') + '(' + clk + ') then\n' + body.replace(/^/gm, '  ') + '\n    end if;\n  end process;');
    }
    function nonblk(target, expr) { return isV ? '    ' + target + ' <= ' + expr + ';' : '      ' + target + ' <= ' + expr + ';'; }

    // ---- 逐元件生成 ----
    circuit.components.forEach(function (c, ci) {
      var p = c.props, b, i, r, tmp, parts = [];
      var bits = p.bits || 1;
      switch (c.type) {
        case 'switch': case 'button': case 'portIn': case 'clock':
          // 已映射为输入端口
          break;
        case 'reset':
          emit(outNet(c, 'y'), p.activeLow ? K(1, 0) : K(1, 1));
          warnings.push('「上电复位」元件在 HDL 中导出为固定电平（其仿真语义依赖上电过程）');
          break;
        case 'const':
          emit(outNet(c, 'y'), K(bits, U.parseNum(p.value))); break;
        case 'pull':
          emit(outNet(c, 'y'), K(bits, p.value ? U.mask(bits) : 0)); break;
        case 'and': case 'or': case 'xor': case 'nand': case 'nor': case 'xnor': {
          var opMap = { and: '&', or: '|', xor: '^', nand: '~&', nor: '~|', xnor: '~^' };
          for (i = 0; i < p.inputs; i++) parts.push(rd(c, 'i' + i, bits));
          emit(outNet(c, 'y'), BIN(opMap[c.type], parts)); break;
        }
        case 'not': emit(outNet(c, 'y'), NOT(rd(c, 'i0', bits))); break;
        case 'buffer': emit(outNet(c, 'y'), rd(c, 'i0', bits)); break;
        case 'tribuf':
          emit(outNet(c, 'y'), COND(rd(c, 'en', 1), rd(c, 'a', bits), isV ? '{' + bits + "{1'bz}}" : '(others => \'Z\')')); break;
        case 'mux': {
          var sel = rd(c, 'sel', Math.ceil(Math.log2(p.inputs))), e = rd(c, 'i' + (p.inputs - 1), bits);
          for (i = p.inputs - 2; i >= 0; i--) e = COND(EQ(sel, i, Math.ceil(Math.log2(p.inputs))), rd(c, 'i' + i, bits), e);
          emit(outNet(c, 'y'), e); break;
        }
        case 'demux': {
          for (i = 0; i < p.outputs; i++) emit(outNet(c, 'y' + i), COND(EQ(rd(c, 'sel', Math.ceil(Math.log2(p.outputs))), i, Math.ceil(Math.log2(p.outputs))), rd(c, 'a', bits), K(bits, 0)));
          break;
        }
        case 'decoder': {
          var n = 1 << p.bits, en = p.enable ? rd(c, 'en', 1) : null;
          var av = rd(c, 'a', p.bits);
          for (i = 0; i < n; i++) {
            var hit = EQ(av, i, p.bits);
            var ex = en ? COND(isV ? '(' + en + ' == ' + K(1, 1) + ')' : '(' + en + ' = \'1\')', COND(hit, K(1, 1), K(1, 0)), K(1, 0)) : COND(hit, K(1, 1), K(1, 0));
            emit(outNet(c, 'y' + i), ex);
          }
          break;
        }
        case 'adder': {
          tmp = 't_' + ci;
          decl.push(isV ? '  wire [' + bits + ':0] ' + tmp + ';' : '  signal ' + tmp + ' : std_logic_vector(' + bits + ' downto 0);');
          var a = rd(c, 'a', bits), bb = rd(c, 'b', bits), cix = rd(c, 'ci', 1);
          if (isV) {
            emit(tmp, '{' + K(1, 0) + ', (' + a + (p.sub ? ' + (~' + bb + ')' : ' + ' + bb) + ')} + ' + cix);
          } else {
            emit(tmp, 'std_logic_vector(unsigned(\'0\' & ' + a + ') ' + (p.sub ? '- unsigned(\'0\' & ' + bb + ')' : '+ unsigned(\'0\' & ' + bb + ')') + ' + to_integer(unsigned(' + cix + ')))');
          }
          emit(outNet(c, 's'), slice(tmp, bits - 1, 0));
          emit(outNet(c, 'co'), p.sub ? NOT(bit(tmp, bits)) : bit(tmp, bits));
          break;
        }
        case 'comparator': {
          var ca = rd(c, 'a', bits), cb = rd(c, 'b', bits);
          emit(outNet(c, 'eq'), COND(CMP(ca, cb, '=='), K(1, 1), K(1, 0)));
          emit(outNet(c, 'lt'), COND(CMP(ca, cb, '<'), K(1, 1), K(1, 0)));
          emit(outNet(c, 'gt'), COND(CMP(ca, cb, '>'), K(1, 1), K(1, 0)));
          break;
        }
        case 'shift': {
          var sa = rd(c, 'a', bits), sh = rd(c, 'sh', 5);
          var se;
          if (p.dir === 'r') se = isV ? '(' + sa + ' >> ' + sh + ')' : 'std_logic_vector(shift_right(unsigned(' + sa + '), to_integer(unsigned(' + sh + '))))';
          else if (p.dir === 'rot') se = isV ? '((' + sa + ' << ' + sh + ') | (' + sa + ' >> (' + bits + ' - ' + sh + ')))' : 'std_logic_vector(rotate_left(unsigned(' + sa + '), to_integer(unsigned(' + sh + '))))';
          else se = isV ? '(' + sa + ' << ' + sh + ')' : 'std_logic_vector(shift_left(unsigned(' + sa + '), to_integer(unsigned(' + sh + '))))';
          emit(outNet(c, 'y'), se); break;
        }
        case 'splitter': {
          var sm = L.splitModel(p);
          if (sm.legacy) {
            var n2 = sm.busBits, busL = sm.mode === 'combine' ? outNet(c, 'bus') : rd(c, 'bus', n2);
            if (sm.mode === 'combine') {
              var lstL = [];
              for (i = n2 - 1; i >= 0; i--) lstL.push(rd(c, 'b' + i, 1));
              emit(busL, isV ? '{' + lstL.join(', ') + '}' : lstL.join(' & '));
            } else {
              for (i = 0; i < n2; i++) emit(outNet(c, 'b' + i), bit(busL, i));
            }
            break;
          }
          if (sm.error) {
            warnings.push('分线器 ' + safe(c.id, 'x') + ' 分割规格错误：' + sm.error + '，该元件未导出');
            break;
          }
          var busName = uniq('split_bus_' + safe(c.id, 'x'), used);
          decl.push(isV
            ? '  wire [' + (sm.busBits - 1) + ':0] ' + busName + ';'
            : '  signal ' + busName + ' : std_logic_vector(' + (sm.busBits - 1) + ' downto 0);');
          for (i = 0; i < sm.busBits; i++) {
            var srcSeg = sm.inputMap[i].seg, srcNet = netRef(pinNet[c.id + '|i' + srcSeg]);
            emit(bit(busName, i), srcNet ? bit(srcNet, sm.inputMap[i].bit) : K(1, 0));
          }
          sm.outSegments.forEach(function (seg, oi) {
            var on = outNet(c, 'o' + oi);
            if (!on) return;
            for (var kb = 0; kb < seg.bits.length; kb++) emit(bit(on, kb), bit(busName, seg.bits[kb]));
          });
          break;
        }
        case 'dff': case 'register': {
          var q = seqRegName(c, '', bits), clk = rd(c, 'c', 1);
          var hasEn = c.type === 'register' && pinNet[c.id + '|en'] !== undefined;
          var body = nonblk(q, hasEn ? COND(isV ? '(' + rd(c, 'en', 1) + ' == ' + K(1, 1) + ')' : '(' + rd(c, 'en', 1) + " = '1')", rd(c, 'd', bits), q) : rd(c, 'd', bits));
          edgeProc(clk, body, p.edge === 'neg');
          emit(outNet(c, 'q'), q);
          if (c.type === 'dff') emit(outNet(c, 'qn'), NOT(q));
          break;
        }
        case 'jkff': case 'tff': case 'counter': {
          var q2 = seqRegName(c, '', c.type === 'counter' ? bits : 1), clk2 = rd(c, 'c', 1);
          var nx;
          if (c.type === 'jkff') nx = COND('(' + rd(c, 'j', 1) + ' ' + (isV ? '&' : 'and') + ' ' + rd(c, 'k', 1) + ')', NOT(q2),
            COND(rd(c, 'j', 1), K(1, 1), COND(rd(c, 'k', 1), K(1, 0), q2)));
          else if (c.type === 'tff') nx = COND(rd(c, 't', 1), NOT(q2), q2);
          else nx = p.down ? SUB(q2, K(bits, 1), bits) : ADD(q2, K(bits, 1), bits);
          var body2 = nonblk(q2, COND(rd(c, 'clr', 1), K(bits, 0), nx));
          if (c.type !== 'counter') body2 = nonblk(q2, nx);
          edgeProc(clk2, body2, p.edge === 'neg');
          emit(outNet(c, 'q'), q2);
          if (c.type !== 'counter') emit(outNet(c, 'qn'), NOT(q2));
          break;
        }
        case 'rsff': {
          // 纯组合反馈的锁存器
          var qq = outNet(c, 'q');
          if (qq) emit(qq, NOT(BIN('|', [rd(c, 'r', 1), outNet(c, 'qn') || K(1, 0)])));
          if (outNet(c, 'qn')) emit(outNet(c, 'qn'), NOT(BIN('|', [rd(c, 's', 1), qq || K(1, 0)])));
          break;
        }
        case 'ram': case 'rom': {
          var ab = p.addrBits, db = p.dataBits, size = 1 << U.clamp(ab, 1, 12);
          var mem = 'mem_' + ci, addr = rd(c, 'addr', ab), dout = outNet(c, 'dout');
          if (isV) {
            decl.push('  reg [' + (db - 1) + ':0] ' + mem + ' [0:' + (size - 1) + '];');
            if (c.type === 'ram') {
              procs.push('  always @(posedge ' + rd(c, 'clk', 1) + ')\n    if (' + rd(c, 'we', 1) + ') ' + mem + '[' + addr + '] <= ' + rd(c, 'din', db) + ';');
            } else {
              var vals = L.parseMem(p.init, size, db);
              initBlocks.push('  initial begin\n' + vals.map(function (v, i2) { return '    ' + mem + '[' + i2 + "] = " + K(db, v) + ';'; }).join('\n') + '\n  end');
            }
            emit(dout, mem + '[' + addr + ']');
          } else {
            decl.push('  type mem_t_' + ci + ' is array (0 to ' + (size - 1) + ') of std_logic_vector(' + (db - 1) + ' downto 0);');
            var vals2 = L.parseMem(p.init, size, db);
            decl.push('  signal ' + mem + ' : mem_t_' + ci + ' := (' + vals2.map(function (v) { return K(db, v); }).join(', ') + ');');
            if (c.type === 'ram') {
              procs.push('  process(' + rd(c, 'clk', 1) + ')\n  begin\n    if rising_edge(' + rd(c, 'clk', 1) + ') then\n      if ' + rd(c, 'we', 1) + " = '1' then\n        " + mem + '(to_integer(unsigned(' + addr + '))) <= ' + rd(c, 'din', db) + ';\n      end if;\n    end if;\n  end process;');
            }
            emit(dout, mem + '(to_integer(unsigned(' + addr + ')))');
          }
          break;
        }
        case 'ic74': {
          var part = L.PARTS[p.part] || L.PARTS['7400'];
          if (part.g) {
            part.g.forEach(function (g) {
              var op = g[0], args = g.slice(1, -1), on = g[g.length - 1];
              var vs = args.map(function (nm) { return rd(c, nm, 1); });
              var opM = { and: '&', or: '|', xor: '^', nand: '~&', nor: '~|' }[op] || '&';
              emit(outNet(c, on), op === 'not' ? NOT(vs[0]) : BIN(opM, vs));
            });
          } else if (p.part === '7474') {
            ['1', '2'].forEach(function (n) {
              var qq = seqRegName(c, '_' + n, 1), ck = rd(c, n + 'CLK', 1);
              var body3 = '    ' + (isV ? 'if (!' + rd(c, n + 'CLRn', 1) + ') ' + qq + ' <= ' + K(1, 0) + ';\n    else if (!' + rd(c, n + 'PREn', 1) + ') ' + qq + ' <= ' + K(1, 1) + ';\n    else ' + qq + ' <= ' + rd(c, n + 'D', 1) + ';'
                : 'if ' + rd(c, n + 'CLRn', 1) + " = '0' then " + qq + ' <= ' + K(1, 0) + ';\n      elsif ' + rd(c, n + 'PREn', 1) + " = '0' then " + qq + ' <= ' + K(1, 1) + ';\n      else ' + qq + ' <= ' + rd(c, n + 'D', 1) + ';\n      end if;');
              edgeProc(ck, body3, false);
              emit(outNet(c, n + 'Q'), qq); emit(outNet(c, n + 'Qn'), NOT(qq));
            });
          } else {
            warnings.push('74xx 型号 ' + p.part + ' 的完整 HDL 导出尚未实现，请检查生成代码');
          }
          break;
        }
        case 'hdl': {
          var ports = p.hdlPorts || [];
          if (p.lang === lang) {
            extraModules.push(cm + ' ---- 自定义 HDL 元件: ' + (p.name || 'hdl') + ' ----\n' + (p.code || ''));
          } else {
            warnings.push('HDL 元件「' + (p.name || '') + '」使用 ' + p.lang + '，导出为 ' + lang + ' 时需另外编译该模块（源码已附在文末）');
            extraModules.push((cm + ' 需要单独编译的 ' + p.lang + ' 模块 ' + (p.name || '') + ':\n') +
              (p.code || '').split('\n').map(function (l) { return cm + ' ' + l; }).join('\n'));
          }
          var conns = ports.map(function (po) {
            var nm = po.name;
            var ex = po.dir === 'out' ? outNet(c, nm) : rd(c, nm, po.bits);
            return isV ? ('.' + nm + '(' + (ex || K(po.bits, 0)) + ')') : (nm + ' => ' + (ex || K(po.bits, 0)));
          });
          var inst = isV
            ? '  ' + safe(p.name || 'hdl_mod', 'hdl') + ' u_' + ci + ' (\n    ' + conns.join(',\n    ') + '\n  );'
            : '  u_' + ci + ': entity work.' + safe(p.name || 'hdl_mod', 'hdl') + '\n    port map (\n      ' + conns.join(',\n      ') + '\n    );';
          assigns.push(inst);
          break;
        }
        case 'led': case 'probe': case 'hexdisplay': case 'portOut': case 'netlabel': case 'text':
          break;
        default:
          warnings.push('元件 ' + c.type + ' 未生成 HDL 代码');
      }
    });

    // 悬空输出端口置 0
    ports.forEach(function (p) { if (p.dir === 'out' && !p.net) { /* 保持未驱动 */ } });

    var code = '';
    var hdr = cm + 'Digital.js - 自动生成' + (isV ? ' Verilog' : ' VHDL') + ' 网表\n' + cm + '电路: ' + (circuit.name || 'circuit') + '\n\n';
    if (isV) {
      var pl = ports.map(function (p) { return (p.dir === 'in' ? '  input ' : '  output ') + '[' + (p.bits - 1) + ':0] ' + p.name; });
      code += hdr + 'module ' + modName + ' (\n' + pl.join(',\n') + '\n);\n\n';
      nets.forEach(function (n, i) {
        if (isPortNet[i]) return;   // 输入端口即该网络
        code += '  wire [' + (n.bits - 1) + ':0] ' + netNames[i] + ';\n';
      });
      code += '\n' + (decl.length ? decl.join('\n') + '\n\n' : '');
      code += (assigns.length ? assigns.join('\n') + '\n' : '');
      code += (procs.length ? '\n' + procs.join('\n\n') + '\n' : '');
      code += (initBlocks.length ? '\n' + initBlocks.join('\n\n') + '\n' : '');
      code += '\nendmodule\n';
    } else {
      code += hdr + 'library IEEE;\nuse IEEE.STD_LOGIC_1164.ALL;\nuse IEEE.NUMERIC_STD.ALL;\n\n';
      code += 'entity ' + modName + ' is\n  port (\n' +
        ports.map(function (p) { return '    ' + p.name + ' : ' + (p.dir === 'in' ? 'in ' : 'out ') + 'std_logic_vector(' + (p.bits - 1) + ' downto 0)'; }).join(';\n') + '\n  );\nend ' + modName + ';\n\n';
      code += 'architecture rtl of ' + modName + ' is\n';
      nets.forEach(function (n, i) {
        if (isPortNet[i]) return;
        code += '  signal ' + netNames[i] + ' : std_logic_vector(' + (n.bits - 1) + ' downto 0);\n';
      });
      code += (decl.length ? decl.join('\n') + '\n' : '');
      code += 'begin\n';
      code += (assigns.length ? assigns.join('\n') + '\n' : '');
      code += (procs.length ? '\n' + procs.join('\n\n') + '\n' : '');
      code += '\nend rtl;\n';
    }
    // 输出端口赋值
    var outAssign = ports.filter(function (p) { return p.dir === 'out' && p.net && p.net !== p.name; })
      .map(function (p) { return isV ? '  assign ' + p.name + ' = ' + p.net + ';' : '  ' + p.name + ' <= ' + p.net + ';'; });
    if (outAssign.length) {
      if (isV) code = code.replace(/\nendmodule\s*$/, '\n' + outAssign.join('\n') + '\n\nendmodule\n');
      else code = code.replace(/\nend rtl;\s*$/, '\n' + outAssign.join('\n') + '\n\nend rtl;\n');
    }
    if (extraModules.length) code += '\n' + extraModules.join('\n\n') + '\n';
    return { code: code, warnings: warnings, ports: ports, module: modName };
  }

  /* ==================== 导入：HDL → 门级原理图 ==================== */
  function importGates(mod, source) {
    var ir = mod.ir, warn = [];
    var circuit = { name: mod.name, components: [], wires: [], bindings: [], hdlModules: [], testText: '' };
    var comps = [];        // {c, conn:{pin:signal}}
    var labels = [];       // {compId, pin, net, bits}
    var sigBits = {};
    var usedSig = {};
    var constIdx = 0;

    mod.ports.forEach(function (p) { sigBits[p.name] = p.bits; });
    (ir.regs || []).forEach(function (r) { sigBits[r.name] = Math.min(32, r.bits || 1); });
    (ir.wires || []).forEach(function (w) { sigBits[w.name] = Math.min(32, w.bits || 1); });
    Object.keys(ir.widths || {}).forEach(function (n) { if (!sigBits[n]) sigBits[n] = Math.min(32, ir.widths[n] || 1); });

    function fresh(hint) {
      var n = safe(hint || 'sig', 'sig'), i = 2;
      while (usedSig[n]) n = safe(hint || 'sig', 'sig') + '_' + (i++);
      usedSig[n] = 1; sigBits[n] = 1; return n;
    }
    function literal(e) {
      var bits = H.widthOf(e, ir), v = H.evalE(e, ir.params || {}, ir);
      var nm = fresh('const' + (constIdx++));
      var c = L.newComponent('const', 0, 0, { value: v, bits: U.clamp(bits, 1, 32) });
      comps.push({ c: c, conn: { y: nm } });
      sigBits[nm] = U.clamp(bits, 1, 32);
      return nm;
    }
    function add(type, props, conn) {
      var c = L.newComponent(type, 0, 0, props || {});
      comps.push({ c: c, conn: conn || {} });
      return c;
    }
    function bitsOf(sig) { return sigBits[sig] || 1; }

    // 位选择 / 拼接支持
    var splitters = {};
    function getBit(sig, idx) {
      var key = sig + '#' + idx;
      if (splitters[key]) return splitters[key];
      var n = U.clamp(bitsOf(sig), 2, 32), bi = U.clamp(idx, 0, n - 1), nm = fresh(sig + '_b' + idx);
      add('splitter', { bits: n, inSplit: String(n), outSplit: bi + '-' + bi }, { i0: sig, o0: nm });
      splitters[key] = nm; return nm;
    }

    function exprSig(e) {
      if (!e) return literal({ t: 'num', v: 0, bits: 1 });
      switch (e.t) {
        case 'num': return literal(e);
        case 'id': return e.name;
        case 'edge': return literal({ t: 'num', v: 0, bits: 1 });
        case 'call': return literal({ t: 'num', v: 0, bits: 1 });
        case 'sel': {
          var hi = H.evalE(e.hi, ir.params || {}, ir) >>> 0, lo = H.evalE(e.lo, ir.params || {}, ir) >>> 0;
          if (lo > hi) { var t = lo; lo = hi; hi = t; }
          if (hi === lo) return getBit(e.name, lo);
          var out = fresh(e.name + '_sl');
          var bits = U.clamp(bitsOf(e.name), hi + 1, 32);
          add('shift', { bits: bits, dir: 'r' }, { a: e.name, sh: literal({ t: 'num', v: lo, bits: 5 }), y: out });
          return out;
        }
        case 'concat': case 'rep': {
          var parts = e.t === 'rep' ? Array(e.n).fill(e.a) : e.parts;
          var names = parts.map(exprSig);
          var widths = names.map(function (x) { return U.clamp(bitsOf(x), 1, 32); });
          var nb = widths.reduce(function (s, x) { return s + x; }, 0);
          var nb2 = U.clamp(nb, 1, 32);
          if (nb > 32) warn.push('拼接表达式为 ' + nb + ' 位，超过 32 位上限，已截断');
          if (nb > nb2) {
            var acc = 0, ws = [];
            for (var wi = 0; wi < widths.length && acc < nb2; wi++) {
              var w = Math.min(widths[wi], nb2 - acc); ws.push(w); acc += w;
            }
            widths = ws; names = names.slice(0, ws.length);
          }
          var out2 = fresh('cat'), cn2 = { o0: out2 };
          names.forEach(function (x, k) { cn2['i' + k] = x; });
          add('splitter', { bits: nb2, inSplit: widths.join(','), outSplit: String(nb2) }, cn2);
          return out2;
        }
        case 'un': {
          if (e.op === '~' || e.op === '!') { var a1 = exprSig(e.a), o1 = fresh('inv'); add('not', { bits: bitsOf(a1) }, { i0: a1, y: o1 }); return o1; }
          warn.push('暂不支持一元运算符 ' + e.op); return literal({ t: 'num', v: 0, bits: 1 });
        }
        case 'reduce': {
          var ar = exprSig(e.a), or_ = fresh('red');
          var typ = e.op === '&' || e.op === '~&' ? 'and' : (e.op === '|' || e.op === '~|' ? 'or' : 'xor');
          add(typ, { inputs: bitsOf(ar), bits: 1 }, { i0: ar, y: or_ });
          if (e.op[0] === '~') { var o2 = fresh('redn'); add('not', { bits: 1 }, { i0: or_, y: o2 }); return o2; }
          return or_;
        }
        case '?:': {
          var c1 = exprSig(e.c), a2 = exprSig(e.a), b2 = exprSig(e.b), o3 = fresh('mux');
          add('mux', { inputs: 2, bits: Math.max(bitsOf(a2), bitsOf(b2)) }, { i0: b2, i1: a2, sel: c1, y: o3 });
          return o3;
        }
        case 'bin': {
          var l = exprSig(e.a), r = exprSig(e.b), o;
          var bv = Math.max(bitsOf(l), bitsOf(r));
          switch (e.op) {
            case '&': case '|': case '^': case '~&': case '~|': case '^~': case '~^': {
              var t = { '&': 'and', '|': 'or', '^': 'xor', '~&': 'nand', '~|': 'nor', '^~': 'xnor', '~^': 'xnor' }[e.op];
              o = fresh(t); add(t, { inputs: 2, bits: bv }, { i0: l, i1: r, y: o }); return o;
            }
            case '+': case '-': {
              o = fresh('sum');
              add('adder', { bits: bv, sub: e.op === '-' }, { a: l, b: r, ci: literal({ t: 'num', v: e.op === '-' ? 0 : 0, bits: 1 }), s: o, co: fresh('carry') });
              return o;
            }
            case '==': case '!=': case '<': case '<=': case '>': case '>=': {
              o = fresh('cmp');
              add('comparator', { bits: bv }, { a: l, b: r, eq: o, lt: fresh('lt'), gt: fresh('gt') });
              if (e.op !== '==' && e.op !== '<') {
                var o4 = fresh('cmp2');
                if (e.op === '!=') add('not', { bits: 1 }, { i0: o, y: o4 });
                else if (e.op === '>' || e.op === '>=') add('or', { inputs: 2, bits: 1 }, { i0: fresh('lt'), i1: o, y: o4 });
                else o4 = o;
                return o4;
              }
              return o;
            }
            case '<<': case '>>': {
              o = fresh('sh'); add('shift', { bits: bv, dir: e.op === '<<' ? 'l' : 'r' }, { a: l, sh: r, y: o }); return o;
            }
            case '++': {
              o = fresh('cat');
              var bw = U.clamp(bv, 1, 16), tot = U.clamp(bv * 2, 1, 32);
              add('splitter', { bits: tot, inSplit: bw + ',' + bw, outSplit: String(tot) }, { i0: r, i1: l, o0: o });
              return o;
            }
            case '&&': case '||': {
              o = fresh('log'); add(e.op === '&&' ? 'and' : 'or', { inputs: 2, bits: 1 }, { i0: l, i1: r, y: o }); return o;
            }
            default: warn.push('表达式运算符 ' + e.op + ' 未能展开为门电路'); return literal({ t: 'num', v: 0, bits: 1 });
          }
        }
      }
      return literal({ t: 'num', v: 0, bits: 1 });
    }

    function assignSignal(lhs, e) {
      if (!lhs || !lhs.name) { warn.push('复杂左值赋值未展开'); return; }
      var s = exprSig(e);
      // 用 buffer 连接到目标信号（保持信号名）
      add('buffer', { bits: bitsOf(lhs.name) || bitsOf(s) }, { i0: s, y: lhs.name });
    }

    // 端口元件
    mod.ports.forEach(function (p) {
      if (p.dir === 'out') add('portOut', { label: p.name, bits: p.bits }, { y: p.name });
      else add('portIn', { label: p.name, bits: p.bits }, { y: p.name });
    });

    // 连续赋值
    (ir.continuous || []).forEach(function (a) { assignSignal(a.lhs, a.expr); });
    // always @(*) / process 组合块
    (ir.comb || []).forEach(function (blk) {
      (blk.stmts || []).forEach(function (s) {
        if (s.t === 'assign') assignSignal(s.lhs, s.expr);
        else if (s.t === '?:' || s.t === 'if') {
          // 用条件表达式近似
          if (s.t === 'if' && s.then.length && s.then[0].t === 'assign') {
            var lh = s.then[0].lhs, a1 = s.then[0].expr, b1 = (s.else && s.else[0] && s.else[0].expr) || { t: 'id', name: lh.name };
            assignSignal(lh, { t: '?:', c: s.cond, a: a1, b: b1 });
          } else warn.push('复杂组合过程块未完整展开（可作为 HDL 元件导入）');
        } else warn.push('case 组合块未展开为门电路');
      });
    });
    // 时序块（简单 q <= d）
    (ir.seq || []).forEach(function (blk) {
      var stmts = blk.stmts || [];
      var simple = [];
      function collect(ss) { ss.forEach(function (s) { if (s.t === 'assign') simple.push(s); else if (s.t === 'if') { collect(s.then || []); collect(s.else || []); } }); }
      collect(stmts);
      if (!simple.length) { warn.push('时序块未展开'); return; }
      var clk = (blk.clocks && blk.clocks[0] && blk.clocks[0].name) || 'clk';
      simple.forEach(function (s) {
        if (!s.lhs || !s.lhs.name) return;
        var d = exprSig(s.expr), c = add('dff', { bits: bitsOf(s.lhs.name) || 1, edge: (blk.clocks && blk.clocks[0] && blk.clocks[0].edge === 'neg') ? 'neg' : 'pos' }, { d: d, c: clk, q: s.lhs.name, qn: fresh('qn') });
      });
    });
    // 门级原语实例
    (ir.prims || []).forEach(function (g) {
      var args = g.args || [];
      if (args.length < 2) return;
      var out = args[0], ins = args.slice(1);
      var type = g.op;
      if (type === 'not' || type === 'buffer') add(type, { bits: 1 }, { i0: ins[0], y: out });
      else if (type === 'tribuf') add(type, { bits: 1 }, { a: ins[0], en: ins[1] || '0', y: out });
      else add(type, { inputs: ins.length, bits: 1 }, (function () { var cn = { y: out }; ins.forEach(function (s, i) { cn['i' + i] = s; }); return cn; })());
    });
    if ((ir.submodules || []).length) warn.push('包含 ' + ir.submodules.length + ' 个模块实例，未展开（请改用「作为 HDL 元件导入」）');

    // ---- 布局 + 网络标签连线 ----
    var level = {};
    comps.forEach(function (e, i) { level[i] = 0; });
    for (var pass = 0; pass < 8; pass++) {
      comps.forEach(function (e, i) {
        Object.keys(e.conn).forEach(function (pin) {
          var sig = e.conn[pin];
          comps.forEach(function (f, j) { if (j !== i && f.conn && Object.values(f.conn).indexOf(sig) >= 0) level[i] = Math.max(level[i], level[j] + 1); });
        });
      });
    }
    // 端口固定为最左 / 最右
    var maxLevel = Math.max.apply(null, Object.values(level).concat([1]));
    comps.forEach(function (e, i) {
      if (e.c.type === 'portIn') level[i] = 0;
      if (e.c.type === 'portOut') level[i] = maxLevel + 2;
    });
    var rows = {};
    comps.forEach(function (e, i) {
      var lv = level[i] || 0;
      rows[lv] = (rows[lv] || 0) + 1;
      e.c.x = 14 + lv * 20;
      e.c.y = 8 + (rows[lv] - 1) * 22;
      circuit.components.push(e.c);
    });

    var labelPos = {};
    comps.forEach(function (e) {
      var pins = L.pinsOf(e.c);
      pins.forEach(function (pin) {
        var sig = e.conn[pin.name];
        if (sig === undefined || pin.hidden) return;
        var px = e.c.x + pin.x, py = e.c.y + pin.y;
        var lx = px + (pin.ax || -1) * 3, ly = py + (pin.ay || 0) * 3;
        var k = lx + ',' + ly;
        while (labelPos[k] && labelPos[k] !== sig) { ly += 3; k = lx + ',' + ly; }
        labelPos[k] = sig;
        var lab = L.newComponent('netlabel', lx, ly, { name: sig, bits: U.clamp(bitsOf(sig) || pin.bits, 1, 32) });
        circuit.components.push(lab);
        circuit.wires.push({ id: U.uid('w'), points: [[px, py], [lx, ly]] });
      });
    });

    circuit.name = mod.name + ' (HDL 展开)';
    return { circuit: circuit, warnings: warn };
  }

  H.exportHDL = exportHDL;
  H.importGates = importGates;
  H.safeName = safe;

  if (typeof module !== 'undefined' && module.exports) module.exports = DIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
