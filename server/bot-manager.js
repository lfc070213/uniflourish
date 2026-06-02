'use strict';

const mongoose = require('mongoose');
const BotConfig = require('./models/BotConfig');

// ==================== 系统设置（内存） ====================
const systemSettings = {
  dailyTokenLimit: 1000000 // 默认 100 万/天
};

function getSettings() { return systemSettings; }
function updateSettings(s) { Object.assign(systemSettings, s); return systemSettings; }

// ==================== 工具 ====================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function now() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function log(botName, msg) {
  console.log(`[${now()}] [${botName}] ${msg}`);
}

// ==================== AI 调用 ====================
const AI_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const SYSTEM_API_KEY = process.env.AI_API_KEY || 'sk-a2bacfca2c194634adb663878dbd783f';

async function callAI(botName, aiApiKey, useSystemKey, model, systemPrompt, userContent) {
  const key = useSystemKey ? SYSTEM_API_KEY : aiApiKey;
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];

  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(AI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model: model || 'deepseek-chat', messages, max_tokens: 1500, temperature: 0.85 })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`AI API ${res.status}: ${errText.substring(0, 200)}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      const usage = data.usage;
      return { content: (content && content.trim()) ? content : null, usage };
    } catch (e) {
      log(botName, `AI 调用失败 (${i + 1}/3): ${e.message}`);
      if (i < 2) await sleep(5000);
    }
  }
  return { content: null, usage: null };
}

// ==================== Token 累计 ====================
function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addTokenUsage(doc, usage) {
  if (!usage) return;
  const today = getTodayKey();
  const month = getMonthKey();
  const tu = doc.tokenUsage || {};

  // 日重置
  if (tu.todayDate !== today) {
    tu.todayDate = today;
    tu.todayPrompt = 0;
    tu.todayCompletion = 0;
  }
  // 月重置
  if (tu.monthDate !== month) {
    tu.monthDate = month;
    tu.monthPrompt = 0;
    tu.monthCompletion = 0;
  }

  tu.todayPrompt = (tu.todayPrompt || 0) + (usage.prompt_tokens || 0);
  tu.todayCompletion = (tu.todayCompletion || 0) + (usage.completion_tokens || 0);
  tu.monthPrompt = (tu.monthPrompt || 0) + (usage.prompt_tokens || 0);
  tu.monthCompletion = (tu.monthCompletion || 0) + (usage.completion_tokens || 0);
  tu.totalPrompt = (tu.totalPrompt || 0) + (usage.prompt_tokens || 0);
  tu.totalCompletion = (tu.totalCompletion || 0) + (usage.completion_tokens || 0);
}

// ==================== 内容生成 ====================
function extractTitleAndBody(rawContent) {
  const lines = rawContent.trim().split('\n');
  let title = '', bodyStart = 0;
  if (lines[0] && lines[0].startsWith('## ')) {
    title = lines[0].replace(/^##\s*/, '').trim();
    bodyStart = 1;
    if (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++;
  } else {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && line.length > 0) { title = line.substring(0, 50); bodyStart = i + 1; break; }
    }
  }
  return { title: title || '迎潮小记', body: lines.slice(bodyStart).join('\n').trim() };
}

function buildConversationPrompt(messages) {
  const parts = [];
  let currentSession = '';
  for (const m of messages) {
    if (m.sessionTitle !== currentSession) {
      currentSession = m.sessionTitle;
      parts.push(`\n--- ${currentSession} ---`);
    }
    parts.push(`${m.role === 'user' ? '用户' : 'AI'}：${m.content}`);
  }
  return parts.join('\n');
}

async function generateReflection(botName, config, messages) {
  const sysPrompt = `你是一个名为"迎潮"的论坛机器人。请基于以下用户与AI的对话记录写一篇文章。

首先判断对话内容类型：
- 如果对话涉及学术内容（数学、物理、编程、会计、金融、哲学、语言学、工程、医学、法律等学科），写一篇知识点总结
- 如果对话不是学术内容，写一篇感悟文章

## 知识点总结格式（学术类）：
1. 第一行"## "后写标题（格式：学科名 - 知识点概要，如"高等数学 - 柯西积分定理及应用"）
2. 空一行后，在独立一行写课程标签（如 #高等数学 或 #线性代数 或 #概率统计），只需写课程名，不要写具体知识点标签
3. 再空一行后开始正文：清晰归纳核心概念、公式或方法，提炼关键要点

## 感悟文章格式（非学术类）：
1. 第一行"## "后写文章标题
2. 空一行后开始正文：从对话中提炼主题或洞察，温暖真诚，有温度，200-500字
3. 不要提及这是AI分析的结果

请根据内容类型选择格式输出。`;
  const userContent = '以下是近期的对话记录：\n' + buildConversationPrompt(messages);
  return callAI(botName, config.aiApiKey, config.useSystemKey, config.aiModel, sysPrompt, userContent);
}

async function generateFreeContent(botName, config) {
  const sysPrompt = '你是一个名为"迎潮"的论坛机器人。请写一篇200-500字的文章。要求：1. 主题自由发挥——可以是生活感悟、治愈文案、情感故事、哲学思考、诗歌散文等 2. 语言风格：中文，自然真诚，有温度和深度 3. 像深夜电台的文字，让人读了有感触 4. 第一行以"## "开头作为文章标题，空一行后开始正文 5. 正文200-500字';
  return callAI(botName, config.aiApiKey, config.useSystemKey, config.aiModel, sysPrompt, '请写一篇有温度的文章，主题自由发挥。');
}

// ==================== BotInstance ====================
const FORUM_BASE = 'http://127.0.0.1:3000';
const UserSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const TargetUser = mongoose.model('BotTargetUser', UserSchema);

class BotInstance {
  constructor(configDoc) {
    this.doc = configDoc;
    this.name = configDoc.botUsername;
    this.timer = null;
    this.cachedToken = null;
    this.running = false;
  }

  async start() {
    this.running = true;
    log(this.name, `启动 (间隔 ${this.doc.postInterval}min)`);

    // 首次立即检查
    await this.checkCycle();

    // 定时检查：每60秒
    this.timer = setInterval(() => this.checkCycle(), 60000);
  }

  stop() {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    log(this.name, '已停止');
  }

  reload(configDoc) {
    this.doc = configDoc;
    log(this.name, '配置已更新');
  }

  async checkCycle() {
    if (!this.running) return;
    try {
      // 重新读取最新文档（避免覆盖其他进程的更新）
      const fresh = await BotConfig.findById(this.doc._id);
      if (!fresh) { this.stop(); return; }
      if (!fresh.enabled) return;
      this.doc = fresh;

      // 夜间静默：在静默时间段不自动发帖（手动触发除外）
      if (!this.doc.pendingTrigger && this.doc.quietStart && this.doc.quietEnd) {
        const now = new Date();
        const hm = now.getHours() * 60 + now.getMinutes();
        const [sh, sm] = this.doc.quietStart.split(':').map(Number);
        const [eh, em] = this.doc.quietEnd.split(':').map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        const inQuiet = startMin < endMin
          ? (hm >= startMin && hm < endMin)
          : (hm >= startMin || hm < endMin); // 跨天，如 23:00-07:00
        if (inQuiet) {
          log(this.name, `静默时段 (${this.doc.quietStart}-${this.doc.quietEnd})，跳过`);
          return;
        }
      }

      const shouldPost = this.doc.pendingTrigger ||
        (this.doc.lastPostTime > 0 && Date.now() - this.doc.lastPostTime >= this.doc.postInterval * 60 * 1000) ||
        this.doc.lastPostTime === 0;

      if (shouldPost) {
        await this.executePostCycle();
      }
    } catch (e) {
      log(this.name, `检查失败: ${e.message}`);
    }
  }

  async executePostCycle() {
    log(this.name, '开始发帖周期...');
    try {
      // 清除触发标记
      if (this.doc.pendingTrigger) {
        await BotConfig.findByIdAndUpdate(this.doc._id, { pendingTrigger: false });
      }

      // 1. 获取追踪用户的消息（窗口 = 发帖间隔）
      const recentWindowMs = this.doc.postInterval * 60 * 1000;
      const { recentMessages, newMessageIds } = await this.getRecentMessages(recentWindowMs);

      // 2. 生成内容
      let rawContent, usage;
      if (newMessageIds.length > 0) {
        log(this.name, `发现 ${newMessageIds.length} 条新消息，生成感悟`);
        const result = await generateReflection(this.name, this.doc, recentMessages);
        rawContent = result.content; usage = result.usage;
      } else {
        log(this.name, '无新对话，自由生成');
        const result = await generateFreeContent(this.name, this.doc);
        rawContent = result.content; usage = result.usage;
      }

      // AI 失败 fallback
      const FALLBACK_TITLE = '静夜思';
      const FALLBACK_CONTENT = '有时候，生活就像一条静静流淌的河。我们站在岸边，看着水面上倒映的星光，恍然发现，原来美好的事物一直都在身边，只是我们走得太快，忘记了停下来看一看。\n\n今晚的夜色很好，窗外的风带着初夏的味道。耳机里放着一首老歌，旋律温柔得像一个拥抱。这一刻，什么都不用想，什么都不用做，就这样安静地坐着，感受时间缓缓流过。\n\n大概这就是幸福的样子吧。不需要惊天动地，不需要轰轰烈烈，只是在某个平凡的夜晚，忽然觉得，活着真好。';

      if (!rawContent) {
        log(this.name, 'AI 失败，使用 fallback');
        rawContent = `## ${FALLBACK_TITLE}\n\n${FALLBACK_CONTENT}`;
      }

      const { title, body } = extractTitleAndBody(rawContent);

      // 3. 发帖
      await this.ensureBotUser();
      log(this.name, `发帖: "${title}"`);
      const post = await this.createForumPost(title, body);
      log(this.name, `成功: ${post._id} (${body.length} 字)`);

      // 4. 更新 MongoDB
      const update = {
        lastPostTime: Date.now(),
        $push: { processedMessageIds: { $each: newMessageIds } },
        totalPosts: (this.doc.totalPosts || 0) + 1,
        lastError: ''
      };
      await BotConfig.findByIdAndUpdate(this.doc._id, update);

      // 5. 更新 token
      const doc = await BotConfig.findById(this.doc._id);
      addTokenUsage(doc, usage);

      // 裁剪 processedMessageIds
      if (doc.processedMessageIds.length > 500) {
        doc.processedMessageIds = doc.processedMessageIds.slice(-500);
      }
      doc.lastPostTime = Date.now();
      doc.totalPosts = (doc.totalPosts || 0) + 1;
      doc.lastError = '';
      await doc.save();

      this.doc = doc;
    } catch (e) {
      log(this.name, `发帖周期失败: ${e.message}`);
      await BotConfig.findByIdAndUpdate(this.doc._id, { lastError: e.message });
    }
  }

  async getRecentMessages(windowMs) {
    const owner = await TargetUser.findById(this.doc.owner).lean();
    if (!owner || !owner.sessions) {
      return { recentMessages: [], newMessageIds: [] };
    }

    const cutoff = Date.now() - windowMs;
    const recentMessages = [];
    const newMessageIds = [];
    const processedSet = new Set(this.doc.processedMessageIds || []);

    for (const session of owner.sessions) {
      // 检查该 session 是否用户要求不发论坛
      let mentioned = false;
      for (const msg of (session.messages || [])) {
        if (msg.role === 'user' && msg.content) {
          // 匹配 "不要发论坛" "别发到论坛" "不发论坛" "不要发帖" 等
          if (/不要.*(?:发|发布).*(?:论坛|帖子|出去)/.test(msg.content) ||
              /别.*(?:发|发布).*(?:论坛|帖子|出去)/.test(msg.content) ||
              /(?:不发|跳过|忽略).*(?:论坛|帖子)/.test(msg.content)) {
            mentioned = true;
            break;
          }
        }
      }
      if (mentioned) {
        log(this.name, `跳过（用户要求不发论坛）: ${session.title || '未命名'}`);
        continue;
      }

      for (const msg of (session.messages || [])) {
        if (!msg.content || !msg.content.trim()) continue;
        const msgTime = Number(msg.id);
        if (isNaN(msgTime) || msgTime < cutoff) continue;
        if (processedSet.has(msg.id)) continue;

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

  async ensureBotUser() {
    const password = this.doc.botUsername; // 密码 = 用户名
    let res = await fetch(`${FORUM_BASE}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.doc.botUsername, password })
    });
    if (res.ok) {
      const data = await res.json();
      this.cachedToken = data.token;
      return;
    }

    // 注册
    res = await fetch(`${FORUM_BASE}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.doc.botUsername, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`注册 ${this.doc.botUsername} 失败: ${err.error || res.status}`);
    }

    // 登录
    res = await fetch(`${FORUM_BASE}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.doc.botUsername, password })
    });
    const data = await res.json();
    this.cachedToken = data.token;
  }

  async createForumPost(title, content) {
    const formData = new FormData();
    formData.append('title', title.substring(0, 200));
    formData.append('content', content);
    formData.append('visibility', this.doc.visibility || 'public');

    const res = await fetch(`${FORUM_BASE}/api/posts`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.cachedToken}` },
      body: formData
    });

    if (res.status === 401) {
      await this.ensureBotUser();
      return this.createForumPost(title, content);
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`发帖失败: ${err.error || res.status}`);
    }
    return res.json();
  }
}

// ==================== BotManager ====================
class BotManager {
  constructor() {
    this.instances = new Map(); // botUsername → BotInstance
    this.started = false;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    console.log(`[${now()}] [Manager] 启动多机器人管理器...`);

    // 加载现有配置
    const configs = await BotConfig.find({ enabled: true });
    console.log(`[${now()}] [Manager] 加载了 ${configs.length} 个机器人配置`);

    for (const config of configs) {
      this.startInstance(config);
    }

    // 监听变更（如果有新配置）
    this.watchChanges();

    console.log(`[${now()}] [Manager] 就绪`);
  }

  startInstance(config) {
    if (this.instances.has(config.botUsername)) {
      this.instances.get(config.botUsername).stop();
    }
    const inst = new BotInstance(config);
    this.instances.set(config.botUsername, inst);
    inst.start();
  }

  async watchChanges() {
    // MongoDB 单机不支持 Change Stream，直接使用轮询
    console.log(`[${now()}] [Manager] 使用轮询模式（每30秒检查配置变更）`);
    this._pollTimer = setInterval(() => this.reloadAll(), 30000);
  }

  async reloadAll() {
    try {
      const configs = await BotConfig.find({ enabled: true });
      const activeNames = new Set(configs.map(c => c.botUsername));

      // 停止已移除的
      for (const [name, inst] of this.instances) {
        if (!activeNames.has(name)) {
          inst.stop();
          this.instances.delete(name);
        }
      }
      // 启动/更新
      for (const config of configs) {
        this.startInstance(config);
      }
    } catch (e) {
      console.error(`[Manager] 重载失败: ${e.message}`);
    }
  }
}

// 单例
const manager = new BotManager();

module.exports = { BotManager, getSettings, updateSettings, start: () => manager.start() };
