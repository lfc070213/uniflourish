// 迎潮邮件系统 — Poste.io 邮箱管理 & SMTP 发信
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');

const POSTE_URL = 'http://127.0.0.1';
const ADMIN_EMAIL = 'auth@uniflourish.top';
const ADMIN_PASS = 'REDACTED_POSTE_PASS';
const DOMAIN = 'uniflourish.top';

let adminCookie = null;
let cookieExpiry = 0;

// ---------- Poste.io admin 登录 ----------
async function adminLogin() {
  if (adminCookie && Date.now() < cookieExpiry) return adminCookie;

  const body = new URLSearchParams();
  body.append('email', ADMIN_EMAIL);
  body.append('password', ADMIN_PASS);

  // 获取 CSRF token
  const loginPage = await fetch(`${POSTE_URL}/admin/login`);
  const html = await loginPage.text();
  const csrf = html.match(/_csrf_token.*?value="([^"]+)"/)?.[1] || '';
  const cookies = loginPage.headers.get('set-cookie') || '';

  body.append('_csrf_token', csrf);

  const res = await fetch(`${POSTE_URL}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: body.toString(),
    redirect: 'manual'
  });

  const setCookie = res.headers.get('set-cookie') || '';
  adminCookie = setCookie;
  cookieExpiry = Date.now() + 30 * 60 * 1000; // 30 分钟
  return adminCookie;
}

// ---------- 创建邮箱 ----------
async function createMailbox(username, password) {
  try {
    const cookie = await adminLogin();

    const body = new URLSearchParams();
    body.append('name', username);
    body.append('user', username);
    body.append('domain', DOMAIN);
    body.append('passwordPlaintext', password);

    const res = await fetch(`${POSTE_URL}/admin/box/new?domain=${DOMAIN}&show=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: body.toString(),
      redirect: 'manual'
    });

    if (res.status === 302) {
      console.log(`[Mail] 邮箱创建成功: ${username}@${DOMAIN}`);
      return { success: true, email: `${username}@${DOMAIN}` };
    }
    console.error(`[Mail] 邮箱创建失败: ${username}@${DOMAIN}, status: ${res.status}`);
    return { success: false, error: '创建失败' };
  } catch (e) {
    console.error('[Mail] 创建邮箱异常:', e.message);
    return { success: false, error: e.message };
  }
}

// ---------- 设置邮箱存储限额 ----------
const DEFAULT_QUOTA = 104857600; // 100MB

async function setMailboxQuota(username, quotaBytes) {
  try {
    const q = quotaBytes || DEFAULT_QUOTA;
    execSync(
      `sudo docker exec mailserver sqlite3 /data/users.db "UPDATE users SET quota = ${q} WHERE username = '${username.replace(/'/g, "''")}' AND domainName = '${DOMAIN}';"`,
      { timeout: 5000 }
    );
    console.log(`[Mail] 配额已设置: ${username}@${DOMAIN} → ${Math.round(q / 1048576)}MB`);
    return true;
  } catch (e) {
    console.error('[Mail] 设置配额异常:', e.message);
    return false;
  }
}

// ---------- 修改邮箱密码 ----------
async function updateMailboxPassword(username, newPassword) {
  try {
    const hash = execSync(
      `sudo docker exec mailserver doveadm pw -s SHA512-CRYPT -p '${newPassword.replace(/'/g, "'\\''")}'`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();

    // 通过临时文件传递 SQL 避免 shell 转义 $ 符号
    const tmpFile = path.join(os.tmpdir(), `mailpw_${Date.now()}.sql`);
    fs.writeFileSync(tmpFile, `UPDATE users SET password='${hash}' WHERE username='${username.replace(/'/g, "''")}' AND domainName='${DOMAIN}';`);

    execSync(`sudo docker exec -i mailserver sqlite3 /data/users.db < ${tmpFile}`, { timeout: 5000 });
    fs.unlinkSync(tmpFile);

    console.log(`[Mail] 密码已更新: ${username}@${DOMAIN}`);
    return true;
  } catch (e) {
    console.error('[Mail] 修改密码异常:', e.message);
    return false;
  }
}

// ---------- SMTP 发信 ----------
const transporter = nodemailer.createTransport({
  host: 'smtp.resend.com',
  port: 587,
  secure: false,
  auth: { user: 'resend', pass: 'REDACTED_RESEND_KEY' },
  tls: { rejectUnauthorized: false }
});

async function sendMail(to, subject, htmlBody) {
  try {
    await transporter.sendMail({
      from: `"迎潮邮局" <auth@${DOMAIN}>`,
      to,
      subject,
      html: htmlBody
    });
    console.log(`[Mail] 邮件发送成功: ${to}`);
    return true;
  } catch (e) {
    console.error(`[Mail] 发送失败: ${to}`, e.message);
    return false;
  }
}

// ---------- 发送验证码 ----------
async function sendVerificationCode(toEmail, code, purpose) {
  const title = purpose === 'bind'
    ? '绑定邮箱验证码 - 迎潮社区'
    : '密码重置验证码 - 迎潮社区';

  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif">
      <h2 style="color:#2c3e50">迎潮社区</h2>
      <p>您的验证码是：</p>
      <div style="font-size:32px;font-weight:bold;color:#e74c3c;padding:20px;background:#fdf2f2;text-align:center;letter-spacing:8px">${code}</div>
      <p style="color:#7f8c8d;margin-top:20px">验证码 5 分钟内有效，请勿转发给他人。</p>
      <hr style="border:none;border-top:1px solid #eee">
      <p style="color:#bdc3c7;font-size:12px">此邮件由迎潮邮局自动发送，请勿回复。</p>
    </div>`;

  return sendMail(toEmail, title, html);
}

// ---------- 用户名清洗 ----------
function sanitizeEmailPrefix(username) {
  return username
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '')
    .substring(0, 30)
    || `user${Date.now().toString(36)}`;
}

// ---------- 生成验证码 ----------
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = {
  createMailbox,
  setMailboxQuota,
  updateMailboxPassword,
  sendVerificationCode,
  sanitizeEmailPrefix,
  generateCode
};
