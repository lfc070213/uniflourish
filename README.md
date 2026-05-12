🌸 Uniflourish | v1.5.3
Uniflourish 是一款基于 Tauri v2 + React 构建的下一代全能多模态 AI 桌面助理。它不仅支持全球主流的所有 AI 模型，还拥有智能进化的“长期记忆融合”引擎、无限容量的本地 IndexedDB 存储以及企业级的多级管理员审计系统。
✨ 正式版 v1.5.3 核心特性
🤖 全模型宇宙：原生支持 ChatGPT, Claude, Gemini, DeepSeek, 豆包 (Doubao), Kimi，并支持用户自定义添加任意模型 ID。
🧠 进化版长期记忆 (LTM)：AI 自动提炼对话事实，并与旧记忆进行智能去重与融合，形成不断生长且不臃肿的个性化档案。
📑 智能会话管理：自动根据首轮对话生成简洁标题，侧边栏支持搜索与快速管理。
📦 无限本地存储：弃用 localStorage，采用底层 IndexedDB 引擎，支持存储数万条带“深度思考”的长对话而不白屏。
⌨️ 极客交互体验：Cmd/Ctrl + Enter 发送，原生回车换行；Mac 风格浅色代码卡片，支持吸顶跟随复制按钮。
🛠️ 技术栈
客户端 (Desktop)
内核: Tauri v2 (Rust)
前端: React 18 + TypeScript + Tailwind CSS
渲染: React-Markdown + KaTeX (数学公式) + Prism (代码高亮)
存储: IndexedDB (无限容量引擎)
后端 (Server)
环境: Node.js + Express
数据库: MongoDB 7.0 (存储用户、同步数据、审计日志)
内网穿透: cpolar (穿透地址: https://dc90b03.r8.cpolar.top)
进程管理: PM2 (永续后台运行)
🚀 快速开始
1. 基础环境
安装 Node.js (v20+)
安装 Rust (Tauri 编译需要)
2. 初始化与启动
code
Bash
# 克隆仓库
git clone https://github.com/lfc070213/uniflourish.git
cd uniflourish

# 安装依赖
npm install

# 启动开发者模式
npm run tauri dev

# 打包正式版
npm run tauri build
🛠️ 后端服务管理 (小贴士)
以后如果你想在服务器（Ubuntu）上查看或操作后端服务，可以用这些命令：
查看运行状态：
code
Bash
pm2 list
查看实时日志（排查报错神器）：
code
Bash
pm2 logs uniflourish-server
重启服务（当你修改了服务器端的 index.js 后）：
code
Bash
pm2 restart uniflourish-server
停止服务：
code
Bash
pm2 stop uniflourish-server
📅 版本记录
v1.5.3: 项目更名为 Uniflourish；cpolar 穿透地址更新；重写长期记忆融合去重机制。
v1.5.2: 上线 AI 自动标题生成；实现退出登录后“物理级”销毁本地所有配置与缓存。
v1.5.1: 接入 6+ AI 供应商；上线用户自定义模型 ID 功能；修复 Claude 多模态类型报错。
v1.5.0: 实现高级/低级管理员分级制度；上线管理员操作审计日志功能。
v1.4.0: 引入 IndexedDB 引擎，彻底解决大长文本导致的白屏崩溃。
🚀 Git 协同工作流
上传代码 (Push)：
code
Bash
git add .
git commit -m "本次改动的描述"
git push origin main
下载/更新代码 (Pull)：
code
Bash
git pull origin main
版本标签 (Tag)：
code
Bash
git tag -a v1.5.3 -m "stable release v1.5.3"
git push origin v1.5.3
📄 开源协议
MIT License




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
