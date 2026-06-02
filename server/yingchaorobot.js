#!/usr/bin/env node
'use strict';

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================
const BOT_USERNAME = 'yingchaorobot';
const BOT_PASSWORD = 'yingchaorobot';
const FORUM_BASE = 'http://127.0.0.1:3000';
const MONGO_URI = 'mongodb://127.0.0.1:27017/lifuchun-platform';
const STATE_FILE = path.join(__dirname, 'yingchaorobot-state.json');
const POST_INTERVAL_MS = 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;
const RECENT_WINDOW_MS = 60 * 60 * 1000;

const AI_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const AI_API_KEY = process.env.AI_API_KEY || 'sk-a2bacfca2c194634adb663878dbd783f';
const AI_MODEL = 'deepseek-chat';

const FALLBACK_TITLE = '静夜思';
const FALLBACK_CONTENT = '有时候，生活就像一条静静流淌的河。我们站在岸边，看着水面上倒映的星光，恍然发现，原来美好的事物一直都在身边，只是我们走得太快，忘记了停下来看一看。\n\n今晚的夜色很好，窗外的风带着初夏的味道。耳机里放着一首老歌，旋律温柔得像一个拥抱。这一刻，什么都不用想，什么都不用做，就这样安静地坐着，感受时间缓缓流过。\n\n大概这就是幸福的样子吧。不需要惊天动地，不需要轰轰烈烈，只是在某个平凡的夜晚，忽然觉得，活着真好。';

const UserSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const User = mongoose.model('BotUser', UserSchema);

// ==================== 状态管理 ====================
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[State] 状态文件损坏，重置:', e.message);
  }
  return { lastPostTime: 0, processedMessageIds: [], totalPosts: 0, lastError: null };
}

function saveState(state) {
  if (state.processedMessageIds.length > 500) {
    state.processedMessageIds = state.processedMessageIds.slice(-500);
  }
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

// ==================== Forum API ====================
let cachedToken = null;

async function ensureBotUser() {
  // 先尝试登录
  let res = await fetch(`${FORUM_BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: BOT_USERNAME, password: BOT_PASSWORD })
  });
  if (res.ok) {
    const data = await res.json();
    cachedToken = data.token;
    console.log('[Bot] 登录成功:', BOT_USERNAME);
    return;
  }

  // 登录失败，注册
  res = await fetch(`${FORUM_BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: BOT_USERNAME, password: BOT_PASSWORD })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`注册失败: ${err.error || res.status}`);
  }
  console.log('[Bot] 注册新用户:', BOT_USERNAME);

  // 注册后登录
  res = await fetch(`${FORUM_BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: BOT_USERNAME, password: BOT_PASSWORD })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`登录失败: ${err.error || res.status}`);
  }
  const data = await res.json();
  cachedToken = data.token;
  console.log('[Bot] 注册后登录成功');
}

async function createForumPost(title, content) {
  const formData = new FormData();
  formData.append('title', title.substring(0, 200));
  formData.append('content', content);
  formData.append('visibility', 'public');

  const res = await fetch(`${FORUM_BASE}/api/posts`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cachedToken}` },
    body: formData
  });

  if (!res.ok) {
    // 401 可能是 token 问题，重新登录
    if (res.status === 401) {
      console.log('[Bot] Token 失效，重新登录...');
      await ensureBotUser();
      return createForumPost(title, content);
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(`发帖失败: ${err.error || res.status}`);
  }
  return res.json();
}

// ==================== 消息提取 ====================
async function getMycRecentMessages(state) {
  const myc = await User.findOne({ username: 'myc' }).lean();
  if (!myc) {
    console.log('[Bot] 用户 "myc" 不存在');
    return { recentMessages: [], newMessageIds: [] };
  }

  const oneHourAgo = Date.now() - RECENT_WINDOW_MS;
  const recentMessages = [];
  const newMessageIds = [];

  for (const session of (myc.sessions || [])) {
    for (const msg of (session.messages || [])) {
      if (!msg.content || !msg.content.trim()) continue;
      const msgTime = Number(msg.id);
      if (isNaN(msgTime) || msgTime < oneHourAgo) continue;
      if (state.processedMessageIds.includes(msg.id)) continue;

      recentMessages.push({
        sessionTitle: session.title || '未命名对话',
        role: msg.role,
        content: msg.content,
        id: msg.id
      });
      newMessageIds.push(msg.id);
    }
  }

  return { recentMessages, newMessageIds };
}

// ==================== AI 调用 ====================
async function callAI(systemPrompt, userContent, retries = 3) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(AI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_API_KEY}`
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages,
          max_tokens: 1500,
          temperature: 0.85
        })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`AI API ${res.status}: ${errText.substring(0, 200)}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (content && content.trim()) return content;
      console.warn('[Bot] AI 返回空内容，重试...');
    } catch (e) {
      console.error(`[Bot] AI 调用失败 (${i + 1}/${retries}):`, e.message);
      if (i < retries - 1) await sleep(5000);
    }
  }
  return null;
}

function extractTitleAndBody(rawContent) {
  const lines = rawContent.trim().split('\n');
  let title = '';
  let bodyStart = 0;

  if (lines[0] && lines[0].startsWith('## ')) {
    title = lines[0].replace(/^##\s*/, '').trim();
    bodyStart = 1;
    if (bodyStart < lines.length && lines[bodyStart].trim() === '') {
      bodyStart++;
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && line.length > 0) {
        title = line.substring(0, 50);
        bodyStart = i + 1;
        break;
      }
    }
  }

  const body = lines.slice(bodyStart).join('\n').trim();
  return { title: title || '迎潮小记', body };
}

// ==================== 内容生成 ====================
function buildConversationPrompt(messages) {
  const parts = [];
  let currentSession = '';
  for (const m of messages) {
    if (m.sessionTitle !== currentSession) {
      currentSession = m.sessionTitle;
      parts.push(`\n--- ${currentSession} ---`);
    }
    const label = m.role === 'user' ? '用户' : 'AI';
    parts.push(`${label}：${m.content}`);
  }
  return parts.join('\n');
}

async function generateReflection(messages) {
  const sysPrompt = '你是一个名为"迎潮"的论坛机器人。请基于以下用户与AI的对话记录，写一篇200-500字的感悟文章。要求：1. 从对话中提炼一个有意义的主题或洞察 2. 语言风格：中文，自然真诚，有温度 3. 不要提及这是AI分析的结果，就当作是你自己的亲身感悟 4. 可以适当引用对话中的观点，但不要直接复制大段对话 5. 第一行以"## "开头作为文章标题，空一行后开始正文 6. 正文200-500字';
  const userContent = '以下是近期的对话记录：\n' + buildConversationPrompt(messages);
  return callAI(sysPrompt, userContent);
}

async function generateFreeContent() {
  const sysPrompt = '你是一个名为"迎潮"的论坛机器人。请写一篇200-500字的文章。要求：1. 主题自由发挥——可以是生活感悟、治愈文案、情感故事、哲学思考、诗歌散文等 2. 语言风格：中文，自然真诚，有温度和深度 3. 像深夜电台的文字，让人读了有感触 4. 第一行以"## "开头作为文章标题，空一行后开始正文 5. 正文200-500字';
  const userContent = '请写一篇有温度的文章，主题自由发挥。';
  return callAI(sysPrompt, userContent);
}

// ==================== 工具 ====================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] ${msg}`);
}

// ==================== 主循环 ====================
async function executePostCycle(state) {
  try {
    // 1. 获取 myc 的近期消息
    const { recentMessages, newMessageIds } = await getMycRecentMessages(state);

    let rawContent;
    if (newMessageIds.length > 0) {
      // Source A: 基于对话生成感悟
      log(`发现 ${newMessageIds.length} 条新消息，生成感悟...`);
      rawContent = await generateReflection(recentMessages);
    } else {
      // Source B: 自由生成
      log('无新对话，自由生成内容...');
      rawContent = await generateFreeContent();
    }

    // AI 失败时使用 fallback
    if (!rawContent) {
      log('AI 调用失败，使用 fallback 内容');
      rawContent = `## ${FALLBACK_TITLE}\n\n${FALLBACK_CONTENT}`;
    }

    const { title, body } = extractTitleAndBody(rawContent);

    // 2. 发帖
    log(`发帖: "${title}"`);
    const post = await createForumPost(title, body);
    log(`发帖成功: ${post._id} (${body.length} 字)`);

    // 3. 更新状态
    state.lastPostTime = Date.now();
    state.processedMessageIds.push(...newMessageIds);
    state.totalPosts++;
    state.lastError = null;
    saveState(state);

  } catch (e) {
    console.error('[Bot] 执行周期失败:', e.message);
    state.lastError = e.message;
    saveState(state);
  }
}

async function main() {
  log('=== yingchaorobot 启动 ===');

  // MongoDB
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  log('MongoDB 已连接');

  // 状态
  const state = loadState();
  log(`已加载状态: ${state.totalPosts} 篇历史帖子`);

  // 账号
  await ensureBotUser();

  // 首次检查：如果从未发帖，立即执行
  if (state.lastPostTime === 0) {
    log('首次运行，立即发帖...');
    await executePostCycle(state);
  } else {
    const elapsed = Date.now() - state.lastPostTime;
    log(`距上次发帖: ${Math.floor(elapsed / 60000)} 分钟`);
  }

  // 定时循环
  setInterval(async () => {
    const elapsed = Date.now() - state.lastPostTime;
    if (elapsed >= POST_INTERVAL_MS) {
      await executePostCycle(state);
    }
  }, CHECK_INTERVAL_MS);

  log(`定时器已启动（每 ${CHECK_INTERVAL_MS / 1000}s 检查，每 ${POST_INTERVAL_MS / 3600000}h 发帖）`);

  // 优雅退出
  const shutdown = async (signal) => {
    log(`收到 ${signal}，退出...`);
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(err => {
  console.error('[Bot] 致命错误:', err);
  process.exit(1);
});
