#!/usr/bin/env node
// 把 Digital.js 部署到 GitHub 仓库并发布 GitHub Pages。
//
//   node tools/deploy-github.js --check   只验证令牌与账号，不改动任何远程仓库
//   node tools/deploy-github.js           建仓 / 上传全部已跟踪文件 / 开启 Pages
//
// 令牌从本地文件读取（默认 ~/.workbuddy/github_pat.txt，可用 DIG_GITHUB_PAT_FILE 覆盖）。
// 令牌只通过 stdin 传给 curl 的配置，不打印、不落盘、不写进 git remote、不提交到仓库。
// 请求走系统代理（curl 自动读取 http_proxy / https_proxy 环境变量）。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TOKEN_FILE = process.env.DIG_GITHUB_PAT_FILE || path.join(os.homedir(), '.workbuddy', 'github_pat.txt');
const REPO = process.env.DIG_GITHUB_REPO || 'digital-js';
const PRIVATE = process.env.DIG_GITHUB_PRIVATE === '1';
const BRANCH = 'main';
const API = 'https://api.github.com';
const CHECK_ONLY = process.argv.indexOf('--check') >= 0;

function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error('未找到令牌文件：' + TOKEN_FILE + '\n请先把 GitHub Personal Access Token 保存为该路径下的单行纯文本。');
  }
  const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!t) throw new Error('令牌文件为空：' + TOKEN_FILE);
  return t;
}

let tmpSeq = 0;
function api(tok, method, urlPath, body) {
  let bodyFile = null;
  const cfg = [
    'header = "Authorization: Bearer ' + tok.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"',
    'header = "Accept: application/vnd.github+json"',
    'header = "X-GitHub-Api-Version: 2022-11-28"',
    'user-agent = "digital-js-deploy"',
    'silent',
    'show-error',
    'ssl-no-revoke',
    'max-time = 60'
  ];
  if (body !== undefined) {
    bodyFile = path.join(os.tmpdir(), 'digital-js-gh-' + process.pid + '-' + (++tmpSeq) + '.json');
    fs.writeFileSync(bodyFile, JSON.stringify(body), 'utf8');
    cfg.push('header = "Content-Type: application/json"');
    cfg.push('data-binary = "@' + bodyFile.replace(/\\/g, '/') + '"');
  }
  const args = ['-K', '-', '-X', method, '-w', '\n__HTTP__%{http_code}', API + urlPath];
  let out;
  try {
    out = execFileSync('curl', args, {
      input: cfg.join('\n') + '\n',
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (e) {
    const detail = String((e.stderr || e.stdout || e.message || '')).slice(0, 300);
    throw new Error('网络请求失败：' + method + ' ' + urlPath + '\n' + detail);
  } finally {
    if (bodyFile) { try { fs.unlinkSync(bodyFile); } catch (e) { } }
  }
  const i = out.lastIndexOf('__HTTP__');
  if (i < 0) throw new Error('响应格式异常：' + urlPath);
  const status = parseInt(out.slice(i + 8).trim(), 10);
  const raw = out.slice(0, i).replace(/\s+$/, '');
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch (e) { data = raw; } }
  return { status: status, data: data };
}

function fail(res, what) {
  const msg = res.data && res.data.message ? res.data.message : JSON.stringify(res.data || '').slice(0, 200);
  throw new Error(what + '失败（HTTP ' + res.status + '）：' + msg +
    (res.status === 401 || res.status === 403 ? '\n提示：令牌可能已失效，或缺少创建仓库 / Pages 的权限（classic token 请勾选 repo）。' : ''));
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function setRemote(owner) {
  const url = 'https://github.com/' + owner + '/' + REPO + '.git';
  let current = '';
  try { current = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (e) { }
  if (current === url) return 'origin 已指向 ' + url;
  if (current) execFileSync('git', ['remote', 'set-url', 'origin', url], { cwd: ROOT, encoding: 'utf8' });
  else execFileSync('git', ['remote', 'add', 'origin', url], { cwd: ROOT, encoding: 'utf8' });
  return '已设置 git remote origin = ' + url + '（不含令牌）';
}

function main() {
  const tok = readToken();
  const me = api(tok, 'GET', '/user');
  if (me.status !== 200) fail(me, '读取 GitHub 账号');
  const owner = me.data.login;
  console.log('GitHub 账号：' + owner);

  const repoPath = '/repos/' + owner + '/' + REPO;
  let repo = api(tok, 'GET', repoPath);
  if (repo.status === 404) {
    if (CHECK_ONLY) { console.log('仓库尚不存在：' + owner + '/' + REPO + '（--check 模式未创建）'); return; }
    repo = api(tok, 'POST', '/user/repos', {
      name: REPO,
      description: 'Digital.js - 网页版数字电路模拟器，原理图编辑、实时仿真，支持 Verilog / VHDL',
      private: PRIVATE,
      auto_init: false,
      has_issues: true
    });
    if (repo.status !== 201) fail(repo, '创建仓库');
    console.log('已创建' + (PRIVATE ? '私有' : '公开') + '仓库：' + repo.data.html_url);
  } else if (repo.status === 200) {
    console.log('复用已有仓库：' + repo.data.html_url);
  } else {
    fail(repo, '查询仓库');
  }

  if (CHECK_ONLY) {
    const p = api(tok, 'GET', repoPath + '/pages');
    console.log('Pages 状态：' + (p.status === 200 ? p.data.status + ' / ' + p.data.html_url : '未开启'));
    return;
  }

  const files = trackedFiles();
  console.log('准备上传 ' + files.length + ' 个文件…');

  // 刚创建且 auto_init:false 的空仓库没有 main 引用，Git Data API 会返回
  // 409 "Git Repository is empty"。先用 Contents API 写一个文件产生初始提交。
  let ref = api(tok, 'GET', repoPath + '/git/ref/heads/' + BRANCH);
  if (ref.status !== 200) {
    const first = files[0];
    const put = api(tok, 'PUT', repoPath + '/contents/' + first, {
      message: '初始化仓库',
      content: fs.readFileSync(path.join(ROOT, first)).toString('base64')
    });
    if (put.status !== 201 && put.status !== 200) fail(put, '初始化空仓库');
    ref = api(tok, 'GET', repoPath + '/git/ref/heads/' + BRANCH);
    if (ref.status !== 200) fail(ref, '读取 main 分支');
  }

  const tree = [];
  for (let n = 0; n < files.length; n++) {
    const f = files[n];
    const buf = fs.readFileSync(path.join(ROOT, f));
    const blobBody = buf.length
      ? { content: buf.toString('base64'), encoding: 'base64' }
      : { content: '', encoding: 'utf-8' }; // .nojekyll 等空文件
    const blob = api(tok, 'POST', repoPath + '/git/blobs', blobBody);
    if (blob.status !== 201) fail(blob, '上传文件 ' + f);
    tree.push({ path: f, mode: '100644', type: 'blob', sha: blob.data.sha });
  }

  const t = api(tok, 'POST', repoPath + '/git/trees', { tree: tree });
  if (t.status !== 201) fail(t, '创建文件树');

  const parent = ref.data.object.sha;
  const commitBody = { message: '部署 Digital.js 网页版数字电路模拟器', tree: t.data.sha };
  if (parent) commitBody.parents = [parent];
  const c = api(tok, 'POST', repoPath + '/git/commits', commitBody);
  if (c.status !== 201) fail(c, '创建提交');

  const r = parent
    ? api(tok, 'PATCH', repoPath + '/git/refs/heads/' + BRANCH, { sha: c.data.sha })
    : api(tok, 'POST', repoPath + '/git/refs', { ref: 'refs/heads/' + BRANCH, sha: c.data.sha });
  if (r.status !== 200 && r.status !== 201) fail(r, '更新 main 分支');
  console.log('提交完成：' + String(c.data.sha).slice(0, 7) + '（' + files.length + ' 个文件）');

  const source = { branch: BRANCH, path: '/' };
  let pages = api(tok, 'POST', repoPath + '/pages', { source: source });
  if (pages.status === 409 || pages.status === 422) {
    pages = api(tok, 'PUT', repoPath + '/pages', { source: source });
  }
  if (pages.status !== 201 && pages.status !== 200 && pages.status !== 204) fail(pages, '开启 GitHub Pages');

  let siteUrl = 'https://' + owner + '.github.io/' + REPO + '/';
  for (let i = 0; i < 12; i++) {
    const st = api(tok, 'GET', repoPath + '/pages');
    if (st.status === 200 && st.data) {
      siteUrl = st.data.html_url || siteUrl;
      if (st.data.status === 'built') break;
    }
    sleep(5000);
  }
  console.log('Pages 地址：' + siteUrl);
  console.log(setRemote(owner));
  console.log('部署完成。首次构建通常需要几十秒，若打开是 404 请稍后刷新。');
}

try { main(); }
catch (e) { console.error('部署失败：' + e.message); process.exit(1); }
