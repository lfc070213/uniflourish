# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
# 👁️ You Are My Eyes (你是我的眼) | v1.4.0

**You Are My Eyes** 是一款基于 **Tauri + React** 构建的跨平台个人 AI 助手。它不仅支持多模型无缝切换，更拥有“云端同步大脑”，让你的 Mac 和 Windows 电脑共享同一份聊天记忆与配置。

## ✨ 正式版 v1.4.0 核心特性

- 🔄 **全量云端同步**：基于 Ubuntu + MongoDB 后端，实时同步会话列表、长期记忆、甚至你的 API Key。
- 🤖 **五大顶级模型**：
  - Gemini 3.1 (Flash Lite / Preview / Pro)
  - DeepSeek V4 (Flash / Pro)
- 🧠 **长期记忆系统**：支持手动编辑和 AI 自动提炼用户信息，跨对话通用，让 AI 越聊越懂你。
- 📐 **教科书级排版**：针对 DeepSeek 数学公式乱码进行深度修复，提供完美的 LaTeX 渲染体验。
- 🖼️ **多模态加固**：
  - 支持图片压缩发送，彻底解决 Mac M1 上因大图 Base64 导致的白屏崩溃。
  - 支持 PDF 文本解析与对话。
- 🎨 **极致 UI 对齐**：采用 CSS Grid 布局，侧边栏与主界面线条像素级对齐，视觉极简呼吸感。

---

## 🛠️ 环境布置与安装

### 1. 基础环境 (Mac & Windows)
确保你的电脑安装了以下工具：
- **Node.js**: v18+ (推荐 v20 LTS)
- **Rust**: [rustup.rs](https://rustup.rs/) (Tauri 内核需要)
- **C++ 生成工具**: (仅 Windows) 安装 Visual Studio Build Tools 并勾选“使用 C++ 的桌面开发”。

### 2. 克隆与初始化
```bash
# 克隆代码
git clone https://github.com/lfc070213/you-are-my-eyes.git
cd you-are-my-eyes

# 安装前端依赖
npm install
#3. 配置 API Key(现版本不用管，可在应用中设置)
#在项目根目录创建 .env 文件（或在软件启动后的“设置中心”直接填写，登录后可同步）：
#code
#Env
#VITE_GEMINI_API_KEY=你的Gemini_Key
#VITE_DEEPSEEK_API_KEY=你的DeepSeek_Key
#4. 部署后端 (Ubuntu 服务器)（仅作者使用）
#确保服务器安装了 Node.js 和 MongoDB。
#进入 you-are-my-eyes-server 目录执行 npm install。
#运行 node index.js 启动记忆中心。
#注意：若在校外访问北大内网服务器，需挂载 AnyConnect VPN。
🚀 启动与使用
开发者模式
code
Bash
     npm run tauri dev
#打包为正式软件
#code
#Bash
n#pm run tauri build
📅 版本记录
v1.4.1: 更新了readme文件
v1.4.0: 实现 API Key 云同步，修复 Mac 登出弹窗失效，彻底对齐 UI。
v1.3.0: 引入图片压缩算法，解决大图崩溃问题。
v1.2.0: 上线长期记忆提炼与多会话管理。
v1.1.0: 接入 Ubuntu 后端实现云同步。
📄 开源协议
MIT License
code
Code
---
下面的仅我个人学习使用，不必理会





### 第二步：上传到 GitHub 并打上正式版标签

请在你的 **Mac M1** 终端依次运行以下命令，这会把代码推送到 GitHub，并正式标记这个版本为 **v1.4.0**。

```bash
# 1. 添加所有更改（包括 README）
git add .

# 2. 提交备注
git commit -m "release: v1.4.0 正式版 - 全功能对齐、API云同步、Mac稳定性加固"

# 3. 推送到远程仓库
git push origin main

# 4. 创建版本标签
git tag -a v1.4.0 -m "stable release version 1.4.0"

# 5. 推送标签到 GitHub
git push origin v1.4.0


准备工作：你的“身份证”
在开始之前，确保你已经手握 GitHub 的 Personal Access Token (PAT)。

记住： 终端里的“密码”不是你的 GitHub 登录密码，而是那串以 ghp_ 开头的 Token。

配置身份（仅需一次）：

code
Bash
git config --global user.name "你的GitHub用户名"
git config --global user.email "你的邮箱"
场景一：上传代码 (Upload / Push)
当你在一台电脑上修改了代码（比如改了 UI 或修复了 Bug），按以下步骤上传：

查看变动（看看自己改了啥）：

code
Bash
git status
暂存文件（把改动放进待发送列表）：

code
Bash
git add .
提交存档（写个备注，方便以后回溯）：

code
Bash
git commit -m "本次改动的描述"
推送到云端：

code
Bash
git push origin main
场景二：下载/更新代码 (Download / Pull)
当你换到另一台电脑，需要把云端的最新版本拿下来：

1. 如果这台电脑还没有这个项目：
code
Bash
git clone https://github.com/你的用户名/you-are-my-eyes.git
2. 如果这台电脑已经有项目，只是想同步最新改动：
code
Bash
git pull origin main
场景三：解决“点不动”的网络报错（必看！）
在北大内网，GitHub 经常连不上。如果你遇到 Connection reset 或 Timeout：

1. 彻底关闭代理（如果没开代理软件）：
code
Bash
git config --global --unset http.proxy
git config --global --unset https.proxy
2. 强制走代理（如果开了 mihomo/Clash，假设端口是 7890）：
code
Bash
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
场景四：两台电脑协同的“每日工作流”
为了保证你两台电脑永远不冲突，建议养成以下习惯：

开始干活前：先跑一次 git pull，保证本地是最新的。

写完代码后：跑 git add . -> git commit -> git push。

特殊文件：记得 .env 文件（API Key）是不随 Git 走的。如果你换了新电脑，记得手动在根目录新建一个 .env。

💡 常见命令速查表
动作	命令	作用
下载	git clone [url]	第一次拿项目到本地
更新	git pull	把云端的最新改动下载下来
暂存	git add .	把本地所有修改标记为“准备上传”
存档	git commit -m "..."	给这次修改打个包，写好备注
上传	git push	把本地打包好的修改推送到 GitHub
看状态	git status	查看现在有哪些文件改了，还没传
🛡️ 安全提醒
绝对不要在 git add 之前删掉 .gitignore 里的 .env。如果你的 API Key 泄露到 GitHub，可能会在几分钟内被脚本抓走并刷爆额度。

学会这几招，你就能像专业开发者一样，让代码在两台电脑之间“瞬间移动”了！ 🚀
