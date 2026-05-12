import "./App.css";
import "katex/dist/katex.min.css";
import { useState, useRef, useEffect } from "react";
import {
  Send, Paperclip, Plus, MessageSquare, Loader2, ChevronDown, X, FileText,
  Trash2, Settings, Eye, EyeOff, Save, Clock, BrainCircuit, Brain, Edit3,
  Check, Zap, ZapOff, User as UserIcon, LogOut, Cloud, AlertTriangle, ShieldAlert,
  Key, Trash, Database, Search, ArrowLeft, Copy, Users, Shield, Activity
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js`;

const MODELS =[
  { id: "gemini-3.1-flash-lite", name: "gemini-3.1-flash-lite", provider: "google" },
  { id: "gemini-3-flash-preview", name: "gemini-3-flash-preview", provider: "google" },
  { id: "gemini-3.1-pro-preview", name: "gemini-3.1-pro-preview", provider: "google" },
  { id: "deepseek-v4-flash", name: "deepseek-v4-flash", provider: "deepseek" },
  { id: "deepseek-v4-pro", name: "deepseek-v4-pro", provider: "deepseek" },
];

const STORAGE_KEY = "you_are_my_eyes_v1.3.1_stable";
const SERVER_URL = "https://79866b64.r8.cpolar.top";

const standardizeContent = (text: string) => {
  if (!text) return "";
  const lines = text.split('\n');
  return lines.map(line => line.trim() === '$' ? '$$' : line)
    .join('\n')
    .replace(/\\\[/g, '$$$$')
    .replace(/\\\]/g, '$$$$')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$');
};

const smartCompress = (file: File): Promise<{ display: string, api: string }> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX = 1000;
        let w = img.width, h = img.height;
        if (w > h && w > MAX) { h *= MAX / w; w = MAX; }
        else if (h > MAX) { w *= MAX / h; h = MAX; }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        const fullBase64 = canvas.toDataURL("image/jpeg", 0.5);
        resolve({ display: fullBase64, api: fullBase64.split(",")[1] });
      };
    };
  });
};

const initDB = () => new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open("EyesInfinityDB", 1);
  req.onupgradeneeded = (e: any) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains("store")) db.createObjectStore("store");
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const saveToIDB = async (key: string, val: any) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("store", "readwrite");
    tx.objectStore("store").put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const loadFromIDB = async (key: string) => {
  const db = await initDB();
  return new Promise<any>((resolve, reject) => {
    const tx = db.transaction("store", "readonly");
    const req = tx.objectStore("store").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

// ================= ✨ 浅色主题代码块 =================
const CodeBlock = ({ node, inline, className, children, ...props }: any) => {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const codeString = String(children).replace(/\n$/, '');

  const isBlock = !inline && (match || codeString.includes('\n'));

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isBlock) {
    return (
      <div className="relative my-6 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shadow-md font-mono">
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-slate-100/90 backdrop-blur-sm border-b border-slate-200 text-slate-600 text-xs">
          <span className="uppercase tracking-wider font-bold text-slate-500">
            {match ? match[1] : 'CODE'}
          </span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-slate-600 hover:text-black transition-colors bg-white border border-slate-200 hover:bg-slate-200 px-2.5 py-1.5 rounded-md active:scale-95 shadow-sm"
          >
            {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
            <span className="font-bold">{copied ? '已复制' : '复制代码'}</span>
          </button>
        </div>
        <div className="overflow-x-auto p-4 text-[14px] leading-relaxed text-slate-800 custom-scrollbar">
          <code className={className} {...props}>
            {children}
          </code>
        </div>
      </div>
    );
  }

  return (
    <code className={`bg-slate-100 text-pink-600 px-1.5 py-0.5 rounded-md text-[0.9em] font-mono border border-slate-200 ${className || ''}`} {...props}>
      {children}
    </code>
  );
};

interface Attachment { id: string; type: 'image' | 'pdf'; name: string; mimeType: string; displayUrl: string; apiBase64: string; preview: string; extractedText?: string; file: File; }
interface Message { id: string; role: "user" | "assistant"; content: string; reasoning?: string; modelName?: string; isError?: boolean; previewImages?: string[]; }
interface ChatSession { id: string; title: string; messages: Message[]; createdAt: number; }

export default function App() {
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const [longTermMemory, setLongTermMemory] = useState(localStorage.getItem("eye_brain_memory") || "尚未记录。");
  const [geminiKey, setGeminiKey] = useState(localStorage.getItem("eye_gemini_key") || "");
  const [deepseekKey, setDeepseekKey] = useState(localStorage.getItem("eye_deepseek_key") || "");
  const [showReasoning, setShowReasoning] = useState(localStorage.getItem("eye_show_reasoning") !== "false");
  const [autoUpdateBrain, setAutoUpdateBrain] = useState(localStorage.getItem("eye_auto_brain") !== "false");
  const [showKeys, setShowKeys] = useState(false);

  const [token, setToken] = useState(localStorage.getItem("user_token") || "");
  const [username, setUsername] = useState(localStorage.getItem("saved_username") || "");
  const [isAdmin, setIsAdmin] = useState(localStorage.getItem("is_admin") === "true");
  const [adminRole, setAdminRole] = useState(localStorage.getItem("admin_role") || "");

  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ user: "", pass: "" });

  const [isPwdOpen, setIsPwdOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ old: "", new: "" });
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);

  const [isSyncing, setIsSyncing] = useState(false);
  const isInitialLoad = useRef(true);

  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [inputText, setInputText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [thinkSeconds, setThinkSeconds] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBrainOpen, setIsBrainOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  // 👑 管理员专属状态
  const [adminTab, setAdminTab] = useState<'users' | 'admins' | 'logs'>('users');
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [poorAdmins, setPoorAdmins] = useState<any[]>([]);
  const [adminLogs, setAdminLogs] = useState<any[]>([]);
  const [newAdminForm, setNewAdminForm] = useState({ user: "", pass: "" });

  const [viewUserSessions, setViewUserSessions] = useState<any>(null);
  const [readSession, setReadSession] = useState<ChatSession | null>(null);

  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };
  const [confirmAction, setConfirmAction] = useState<{ type: 'resetPwd' | 'deleteUser' | 'deleteSession' | 'deletePoorAdmin', payload: any } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const adminScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadFromIDB(STORAGE_KEY).then(saved => {
      if (saved && saved.length > 0) {
        setSessions(saved);
        setCurrentSessionId(saved[0].id);
      } else {
        const oldSaved = localStorage.getItem(STORAGE_KEY);
        if (oldSaved) {
          const parsed = JSON.parse(oldSaved);
          setSessions(parsed);
          if (parsed.length > 0) setCurrentSessionId(parsed[0].id);
          saveToIDB(STORAGE_KEY, parsed);
        }
      }
      setIsDataLoaded(true);
    }).catch(() => setIsDataLoaded(true));
  },[]);

  // 🔔 自动拉取管理员所需数据
  useEffect(() => {
    if (isAdmin && token) {
      fetchAdminUsers(token);
      if (adminRole === 'super_admin') {
        fetchPoorAdmins(token);
        fetchAdminLogs(token);
      }
    }
  }, [isAdmin, token, adminRole]);

  useEffect(() => {
    if (!isDataLoaded) return;
    const cleanSessions = sessions.map((s: ChatSession) => ({ ...s, messages: s.messages.map((m: Message) => ({ ...m, previewImages:[] })) }));
    saveToIDB(STORAGE_KEY, cleanSessions).catch(e => console.error("IDB 写入失败:", e));

    localStorage.setItem("eye_brain_memory", longTermMemory);
    localStorage.setItem("user_token", token);
    localStorage.setItem("saved_username", username);
    localStorage.setItem("is_admin", isAdmin ? "true" : "false");
    localStorage.setItem("admin_role", adminRole);

    if (isAdmin) return;
    if (isInitialLoad.current) { isInitialLoad.current = false; return; }

    const timer = setTimeout(async () => {
      if (!token) return;
      setIsSyncing(true);
      try {
        await fetch(`${SERVER_URL}/api/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ sessions, longTermMemory, geminiKey, deepseekKey })
        });
      } catch (e) { } finally { setIsSyncing(false); }
    }, 3000);
    return () => clearTimeout(timer);
  }, [sessions, longTermMemory, token, username, geminiKey, deepseekKey, isDataLoaded, isAdmin, adminRole]);

  useEffect(() => {
    let interval: any;
    if (isLoading) {
      interval = setInterval(() => setThinkSeconds(s => s + 1), 1000);
    } else {
      setThinkSeconds(0);
      if (interval) clearInterval(interval);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isLoading]);

  const triggerBrainUpdate = async (userText: string, aiText: string) => {
    if (!autoUpdateBrain || !userText) return;
    const prompt = `你是一个全局记忆提炼系统。请分析以下对话，提取用户的习惯偏好。如有，按 "FACT: [具体事实]" 格式输出，没有回复 NONE。\n用户：${userText}\nAI：${aiText.slice(0, 300)}...`;
    try {
      let newMemory = "";
      if (selectedModel.provider === "google") {
        const payload = {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          safetySettings:[
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ]
        };
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${geminiKey}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
        });
        const d = await res.json();
        newMemory = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
      } else {
        const res = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekKey}` },
          body: JSON.stringify({ model: "deepseek-v4-flash", messages: [{ role: "user", content: prompt }] })
        });
        const d = await res.json();
        newMemory = d.choices?.[0]?.message?.content || "";
      }
      if (newMemory.includes("FACT:")) {
        const facts = newMemory.split("\n").filter(l => l.includes("FACT:")).map(l => l.replace("FACT:", "").trim());
        if (facts.length > 0) {
          setLongTermMemory(prev => (prev + (prev.endsWith("。") || prev === "" ? "" : "\n") + facts.map(f => "- " + f).join("\n")).trim());
        }
      }
    } catch (e) { }
  };

  const handleAuth = async () => {
    const endpoint = authMode === 'login' ? '/api/login' : '/api/register';
    try {
      const res = await fetch(`${SERVER_URL}${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: authForm.user, password: authForm.pass })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (authMode === 'login') {
        setToken(data.token);
        setUsername(authForm.user);
        setIsAuthOpen(false);
        showToast("登录成功");
        if (data.role === 'super_admin' || data.role === 'poor_admin') {
          setIsAdmin(true);
          setAdminRole(data.role);
          fetchAdminUsers(data.token);
          if (data.role === 'super_admin') {
            fetchPoorAdmins(data.token);
            fetchAdminLogs(data.token);
          }
        } else {
          setIsAdmin(false);
          setAdminRole("");
          isInitialLoad.current = true;
          if (data.sessions && data.sessions.length > 0) setSessions(data.sessions);
          if (data.longTermMemory) setLongTermMemory(data.longTermMemory);
          if (data.geminiKey) setGeminiKey(data.geminiKey);
          if (data.deepseekKey) setDeepseekKey(data.deepseekKey);
        }
      } else {
        showToast("注册成功，请登录");
        setAuthMode('login');
      }
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const handleChangePwd = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/change-password`, {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ oldPassword: pwdForm.old, newPassword: pwdForm.new })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast("密码修改成功！");
      setIsPwdOpen(false);
      setPwdForm({ old: "", new: "" });
    } catch (e: any) { showToast(e.message, 'error'); }
  }

  const confirmLogout = () => {
    setToken("");
    setUsername("");
    setIsAdmin(false);
    setAdminRole("");
    setIsLogoutConfirmOpen(false);
    localStorage.removeItem("user_token");
    localStorage.removeItem("saved_username");
    localStorage.removeItem("is_admin");
    localStorage.removeItem("admin_role");
    showToast("已安全退出");
  };

  const fetchAdminUsers = async (adminToken: string) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/users`, { headers: { "Authorization": `Bearer ${adminToken}` } });
      if (!res.ok) {
        if(res.status === 401 || res.status === 403) confirmLogout();
        return;
      }
      setAdminUsers(await res.json());
    } catch(e) {}
  };

  const fetchPoorAdmins = async (adminToken: string) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/poor-admins`, { headers: { "Authorization": `Bearer ${adminToken}` } });
      if (res.ok) setPoorAdmins(await res.json());
    } catch(e) {}
  };

  const fetchAdminLogs = async (adminToken: string) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/logs`, { headers: { "Authorization": `Bearer ${adminToken}` } });
      if (res.ok) setAdminLogs(await res.json());
    } catch(e) {}
  };

  const createPoorAdmin = async () => {
    if (!newAdminForm.user || !newAdminForm.pass) {
      showToast("账号密码不能为空", "error");
      return;
    }
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/poor-admin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ username: newAdminForm.user, password: newAdminForm.pass })
      });
      const d = await res.json();
      if(!res.ok) throw new Error(d.error);
      showToast("低级管理员创建成功");
      setNewAdminForm({user:'', pass:''});
      fetchPoorAdmins(token);
      fetchAdminLogs(token);
    } catch(e:any) { showToast(e.message, 'error'); }
  };

  const executeConfirmAction = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction.type === 'resetPwd') {
        await fetch(`${SERVER_URL}/api/admin/reset-password/${confirmAction.payload.id}`, { method: "POST", headers: { "Authorization": `Bearer ${token}` } });
        showToast("密码已强制重置为 123456");
      } else if (confirmAction.type === 'deleteUser') {
        await fetch(`${SERVER_URL}/api/admin/user/${confirmAction.payload.id}`, { method: "DELETE", headers: { "Authorization": `Bearer ${token}` } });
        showToast("该用户已彻底抹除");
        fetchAdminUsers(token);
      } else if (confirmAction.type === 'deleteSession') {
        await fetch(`${SERVER_URL}/api/admin/user/${confirmAction.payload.uid}/session/${confirmAction.payload.sid}`, { method: "DELETE", headers: { "Authorization": `Bearer ${token}` } });
        showToast("会话已成功删除");
        const updatedSessions = viewUserSessions.sessions.filter((s: any) => s.id !== confirmAction.payload.sid);
        setViewUserSessions({ ...viewUserSessions, sessions: updatedSessions });
        setAdminUsers(prev => prev.map(u => u._id === confirmAction.payload.uid ? { ...u, sessions: updatedSessions } : u));
      } else if (confirmAction.type === 'deletePoorAdmin') {
        await fetch(`${SERVER_URL}/api/admin/poor-admin/${confirmAction.payload.id}`, { method: "DELETE", headers: { "Authorization": `Bearer ${token}` } });
        showToast("低级管理员已剥夺权限并删除");
        fetchPoorAdmins(token);
      }
      if (adminRole === 'super_admin') fetchAdminLogs(token);
    } catch (e) {
      showToast("高危操作执行失败，请检查网络", "error");
    }
    setConfirmAction(null);
  };

  const handleSend = async () => {
    const key = selectedModel.provider === 'google' ? geminiKey : deepseekKey;
    if (!key) { setIsSettingsOpen(true); return; }
    if ((!inputText.trim() && attachments.length === 0) || isLoading || !currentSessionId) return;

    const curAtts = [...attachments];
    const text = inputText.trim() || "分析内容。";
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text, previewImages: curAtts.filter(a => a.type === 'image').map(a => a.displayUrl) };
    
    setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, messages: [...s.messages, userMsg] } : s));
    setInputText("");
    setAttachments([]);
    setIsLoading(true);

    const sys = `你是一个全能助手。对话背景：\n${longTermMemory}`;
    try {
      let rText = "";
      let rReason = "";
      if (selectedModel.provider === "google") {
        const payload = [
          { role: "user", parts: [{ text: sys }] },
          ...sessions.find(s => s.id === currentSessionId)!.messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
          })),
          { role: "user", parts: [{ text }, ...curAtts.filter(a => a.type === 'image').map(a => ({ inline_data: { mime_type: "image/jpeg", data: a.apiBase64 } }))] }
        ];
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel.id}:generateContent?key=${geminiKey}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: payload })
        });
        const d = await res.json();
        rText = d.candidates[0].content.parts[0].text;
      } else {
        const dsMsgs = [
          { role: "system", content: sys },
          ...sessions.find(s => s.id === currentSessionId)!.messages.map(m => ({ role: m.role, content: m.content })),
          { role: "user", content: curAtts.map(a => `[附件: ${a.name}]`).join("\n") + "\n" + text }
        ];
        const res = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekKey}` }, body: JSON.stringify({ model: selectedModel.id, messages: dsMsgs })
        });
        const d = await res.json();
        rText = d.choices[0].message.content;
        rReason = d.choices[0].message.reasoning_content || "";
      }

      setSessions(prev => prev.map(s => s.id === currentSessionId ? {
        ...s,
        messages: [...s.messages, { id: Date.now().toString(), role: "assistant", content: rText, reasoning: rReason, modelName: selectedModel.name }],
        title: s.messages.length === 0 ? text.slice(0, 15) : s.title
      } : s));
      triggerBrainUpdate(text, rText);

    } catch (err: any) {
      showToast("API 报错: " + err.message, "error");
    } finally {
      setIsLoading(false);
      scrollRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ||[]);
    for (const f of files) {
      if (!f.type.startsWith('image/') && f.type !== 'application/pdf') {
        showToast("仅支持图片或 PDF", "error");
        continue;
      }
      const reader = new FileReader();
      await new Promise<void>((res) => {
        reader.onload = async (ev) => {
          const raw = ev.target?.result as string;
          let disp = "";
          let api = "";
          if (f.type.startsWith('image/')) {
            const comp = await smartCompress(f);
            disp = comp.display;
            api = comp.api;
          } else {
            api = raw.split(",")[1];
          }
          setAttachments(p =>[...p, { id: Math.random().toString(36).substr(2, 9), type: f.type.startsWith('image/') ? 'image' : 'pdf', name: f.name, displayUrl: disp, apiBase64: api, preview: URL.createObjectURL(f), file: f, mimeType: f.type }]);
          res();
        };
        reader.readAsDataURL(f);
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const createNewSession = () => {
    const id = Date.now().toString();
    setSessions(p => [{ id, title: "新对话", messages: [], createdAt: Date.now() }, ...p]);
    setCurrentSessionId(id);
    setAttachments([]);
    setInputText("");
  };

  if (!isDataLoaded) return <div className="h-screen w-screen flex items-center justify-center bg-white"><Loader2 className="animate-spin text-black" size={32} /></div>;

  return (
    <div className="grid grid-cols-[256px_1fr] h-screen bg-white text-gray-900 font-sans overflow-hidden relative">
      
      {/* 🟢 全局提示条 (Toast) */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-2xl z-[300] animate-in slide-in-from-top-4 fade-in flex items-center gap-2 bg-black text-white">
          {toast.type === 'error' ? <AlertTriangle size={16} className="text-red-400" /> : <Check size={16} className="text-emerald-400" />}
          <span className="font-bold text-sm">{toast.msg}</span>
        </div>
      )}

      {/* 🔴 高危操作二次确认模态框 */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 space-y-4 text-center animate-in zoom-in duration-200">
            <AlertTriangle className="mx-auto text-red-600" size={32} />
            <h2 className="text-xl font-black">
              {confirmAction.type === 'resetPwd' && "确认重置密码？"}
              {confirmAction.type === 'deleteUser' && "确认抹除该用户？"}
              {confirmAction.type === 'deleteSession' && "确认删除这段记忆？"}
              {confirmAction.type === 'deletePoorAdmin' && "确认删除该低级管理员？"}
            </h2>
            <p className="text-slate-500 text-xs">
              {confirmAction.type === 'resetPwd' && `即将把 [${confirmAction.payload.name}] 的密码强制修改为 123456`}
              {confirmAction.type === 'deleteUser' && `彻底清空 [${confirmAction.payload.name}] 的所有数据，此操作不可逆！`}
              {confirmAction.type === 'deleteSession' && `将为该用户永久删除会话 [${confirmAction.payload.title}]`}
              {confirmAction.type === 'deletePoorAdmin' && `删除后，[${confirmAction.payload.name}] 将立即失去所有底层管理权限！`}
            </p>
            <div className="flex gap-3 pt-4">
              <button onClick={() => setConfirmAction(null)} className="flex-1 bg-slate-100 p-3 rounded-xl font-bold hover:bg-slate-200 transition-colors">点错了</button>
              <button onClick={executeConfirmAction} className="flex-1 bg-red-600 text-white p-3 rounded-xl font-bold hover:bg-red-700 transition-colors">确定执行</button>
            </div>
          </div>
        </div>
      )}

      {/* ================= 👑 管理员视图 👑 ================= */}
      {isAdmin ? (
        <div className="absolute inset-0 z-50 min-h-screen bg-slate-900 text-white font-sans flex flex-col p-8 overflow-y-auto">
          <header className="flex items-center justify-between border-b border-slate-700 pb-6 mb-6">
            <div className="flex items-center gap-3">
              <ShieldAlert className={adminRole === 'super_admin' ? "text-red-500" : "text-amber-500"} size={32} />
              <div>
                <h1 className="text-2xl font-black tracking-widest">系统监控中心</h1>
                <p className="text-xs text-slate-400">当前权限身份：{adminRole === 'super_admin' ? '👑 高级全栈透视' : '🛡️ 基础安全管控'}</p>
              </div>
            </div>
            <button onClick={() => setIsLogoutConfirmOpen(true)} className="bg-red-600 hover:bg-red-700 px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-all">
              <LogOut size={16} /> 安全退出
            </button>
          </header>

          {/* 🌟 顶部导航（仅超管可见全部） */}
          {adminRole === 'super_admin' && (
            <div className="flex gap-6 mb-6 border-b border-slate-800 pb-2">
              <button onClick={() => setAdminTab('users')} className={`pb-2 border-b-2 font-bold transition-all flex items-center gap-2 ${adminTab === 'users' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-300'}`}><Users size={16}/> 普通用户池</button>
              <button onClick={() => setAdminTab('admins')} className={`pb-2 border-b-2 font-bold transition-all flex items-center gap-2 ${adminTab === 'admins' ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-400 hover:text-slate-300'}`}><Shield size={16}/> 低级管理员池</button>
              <button onClick={() => setAdminTab('logs')} className={`pb-2 border-b-2 font-bold transition-all flex items-center gap-2 ${adminTab === 'logs' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-300'}`}><Activity size={16}/> 操作审计日志</button>
            </div>
          )}

          {/* Tab 1: 用户池 */}
          {adminTab === 'users' && (
            <div className="bg-slate-800 rounded-2xl p-6 shadow-2xl border border-slate-700 animate-in fade-in duration-300">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Database size={20} className="text-emerald-400" /> 用户数据沙盘 ({adminUsers.length})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-slate-400 text-sm">
                      <th className="p-4 rounded-tl-xl">账号</th>
                      {adminRole === 'super_admin' && <th className="p-4">对话总数</th>}
                      {adminRole === 'super_admin' && <th className="p-4">大脑记忆池</th>}
                      <th className="p-4 rounded-tr-xl">操作管控</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map(u => (
                      <tr key={u._id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                        <td className="p-4 font-bold text-slate-200">{u.username}</td>
                        {adminRole === 'super_admin' && (
                          <td className="p-4"><span className="bg-blue-900/50 text-blue-400 px-3 py-1 rounded-full text-xs font-bold">{u.sessions?.length || 0} 条会话</span></td>
                        )}
                        {adminRole === 'super_admin' && (
                          <td className="p-4"><div className="w-48 truncate text-xs text-slate-400">{u.longTermMemory || '无记录'}</div></td>
                        )}
                        <td className="p-4 flex gap-2">
                          <button onClick={() => setConfirmAction({ type: 'resetPwd', payload: { id: u._id, name: u.username } })} className="bg-amber-600/20 text-amber-500 hover:bg-amber-600 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all"><Key size={12} /> 重置</button>
                          {adminRole === 'super_admin' && (
                            <button onClick={() => setViewUserSessions({ uid: u._id, username: u.username, sessions: u.sessions ||[] })} className="bg-emerald-600/20 text-emerald-500 hover:bg-emerald-600 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all"><Search size={12} /> 翻阅历史</button>
                          )}
                          <button onClick={() => setConfirmAction({ type: 'deleteUser', payload: { id: u._id, name: u.username } })} className="bg-red-600/20 text-red-500 hover:bg-red-600 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all"><Trash size={12} /> 抹除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 2: 低级管理员池 */}
          {adminRole === 'super_admin' && adminTab === 'admins' && (
            <div className="animate-in fade-in duration-300">
              <div className="bg-slate-800 rounded-2xl p-6 shadow-2xl border border-slate-700 mb-6 flex flex-col sm:flex-row gap-4 justify-between items-center">
                <div>
                  <h3 className="font-bold text-lg text-amber-400">册封底层管理员</h3>
                  <p className="text-xs text-slate-400 mt-1">他们只能重置普通用户密码和抹除账户，没有其他权限。</p>
                </div>
                <div className="flex gap-2">
                  <input type="text" placeholder="设置新账号" className="bg-slate-900 text-sm border border-slate-700 px-4 py-2 rounded-lg outline-none focus:border-amber-500" value={newAdminForm.user} onChange={e=>setNewAdminForm({...newAdminForm, user:e.target.value})} />
                  <input type="password" placeholder="设置初始化密码" className="bg-slate-900 text-sm border border-slate-700 px-4 py-2 rounded-lg outline-none focus:border-amber-500" value={newAdminForm.pass} onChange={e=>setNewAdminForm({...newAdminForm, pass:e.target.value})} />
                  <button onClick={createPoorAdmin} className="bg-amber-600 hover:bg-amber-700 text-white px-6 py-2 rounded-lg font-bold text-sm transition-colors whitespace-nowrap">确认创建</button>
                </div>
              </div>
              <div className="bg-slate-800 rounded-2xl p-6 shadow-2xl border border-slate-700">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-slate-400 text-sm"><th className="p-4 rounded-tl-xl">底层权限账号</th><th className="p-4 rounded-tr-xl">收回权限</th></tr>
                  </thead>
                  <tbody>
                    {poorAdmins.map(u => (
                      <tr key={u._id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                        <td className="p-4 font-bold text-amber-300 flex items-center gap-2"><ShieldAlert size={14} className="text-amber-500/50"/> {u.username}</td>
                        <td className="p-4">
                          <button onClick={() => setConfirmAction({ type: 'deletePoorAdmin', payload: { id: u._id, name: u.username } })} className="bg-red-600/20 text-red-500 hover:bg-red-600 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center w-fit gap-1 transition-all"><Trash size={12} /> 剥夺并抹除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 3: 操作审计日志 */}
          {adminRole === 'super_admin' && adminTab === 'logs' && (
            <div className="bg-slate-800 rounded-2xl p-6 shadow-2xl border border-slate-700 animate-in fade-in duration-300">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Activity size={20} className="text-blue-400" /> 全局管理员行为审计表</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-slate-400 text-sm">
                      <th className="p-4 rounded-tl-xl">操作时间戳</th>
                      <th className="p-4">执行管理账号</th>
                      <th className="p-4">危险操作类型</th>
                      <th className="p-4 rounded-tr-xl">受波及目标用户</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminLogs.map(log => (
                      <tr key={log._id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                        <td className="p-4 text-xs text-slate-400">{new Date(log.timestamp).toLocaleString()}</td>
                        <td className="p-4 font-bold text-amber-400">{log.adminUsername}</td>
                        <td className="p-4 text-pink-400 text-xs font-mono bg-pink-900/10 rounded my-2">{log.action}</td>
                        <td className="p-4 text-blue-300 font-bold">{log.targetUser}</td>
                      </tr>
                    ))}
                    {adminLogs.length === 0 && (<tr><td colSpan={4} className="p-8 text-center text-slate-500">暂时没有记录任何危险操作</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 超管会话列表 Modal */}
          {viewUserSessions && !readSession && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-8 z-[70] backdrop-blur-sm animate-in zoom-in duration-200">
              <div className="bg-slate-900 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col border border-slate-700 shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800">
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <Search size={20} className="text-emerald-400" /> 用户 [{viewUserSessions.username}] 的历史档案
                  </h3>
                  <button onClick={() => setViewUserSessions(null)} className="text-slate-400 hover:text-white transition-colors bg-slate-700 p-2 rounded-lg"><X size={20} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {viewUserSessions.sessions.length === 0 ? <div className="text-slate-500 text-center mt-10">该用户是空的，没有任何历史对话。</div> : null}
                  {viewUserSessions.sessions.map((s: any) => (
                    <div key={s.id} className="bg-slate-800/50 p-4 rounded-xl flex justify-between items-center border border-slate-700 hover:bg-slate-800 transition-colors">
                      <div>
                        <h4 className="font-bold text-emerald-100">{s.title}</h4>
                        <p className="text-xs text-slate-500 mt-1">包含 {s.messages?.length || 0} 条消息往返 • {new Date(s.createdAt || parseInt(s.id)).toLocaleString()}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setReadSession(s)} className="bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2"><Eye size={14} /> 上帝透视</button>
                        <button onClick={() => setConfirmAction({ type: 'deleteSession', payload: { uid: viewUserSessions.uid, sid: s.id, title: s.title } })} className="bg-red-600/20 text-red-500 hover:bg-red-600 hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition-all"><Trash size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 超管阅读具体会话 Modal */}
          {readSession && (
            <div className="fixed inset-0 bg-black flex items-center justify-center p-4 z-[80] animate-in slide-in-from-bottom duration-300">
              <div className="bg-white text-gray-900 rounded-3xl w-full max-w-5xl h-[95vh] flex flex-col shadow-2xl overflow-hidden relative">
                <header className="h-[71px] bg-slate-50 border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-10">
                  <div className="flex items-center gap-4">
                    <button onClick={() => setReadSession(null)} className="p-2 hover:bg-slate-200 rounded-full text-slate-600 transition-colors"><ArrowLeft size={20} /></button>
                    <h3 className="font-black text-slate-800 text-lg">
                      📝 {readSession.title}
                      <span className="text-xs text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full font-bold ml-2">上帝视角阅读模式</span>
                    </h3>
                  </div>
                </header>
                <div className="flex-1 overflow-y-auto bg-white p-4 md:p-12 space-y-12 custom-scrollbar">
                  {readSession.messages.map((msg: Message) => (
                    <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`w-full ${msg.role === "user" ? "max-w-[80%] ml-auto" : "max-w-none"}`}>
                        {msg.role === "user" ? (
                          <div className="bg-black text-white rounded-2xl px-5 py-3 shadow-sm ml-auto w-fit">
                            {msg.previewImages?.map((url, i) => <img key={i} src={url} className="max-w-xs rounded-xl border border-white/20 mb-2" alt="p" />)}
                            <p className="whitespace-pre-wrap text-[15px]">{msg.content}</p>
                          </div>
                        ) : (
                          <div className="bg-white text-gray-800">
                            {msg.reasoning && (
                              <div className="mb-8 bg-slate-50/80 rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                                <div className="flex items-center gap-2 px-5 py-3 text-slate-400 text-[11px] font-bold border-b border-slate-200/50"><BrainCircuit size={14} className="text-blue-400" /> 思考路径</div>
                                <div className="px-6 py-5 text-slate-500 text-[14px] italic opacity-80 markdown-container">
                                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{ code: CodeBlock as any }}>{standardizeContent(msg.reasoning)}</ReactMarkdown>
                                </div>
                              </div>
                            )}
                            <div className="markdown-container prose prose-slate max-w-none text-[16px]">
                              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{ code: CodeBlock as any }}>{standardizeContent(msg.content)}</ReactMarkdown>
                            </div>
                            <div className="mt-4 text-[10px] text-slate-300 italic flex items-center gap-1"><Check size={10} /> Powered by {msg.modelName}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={adminScrollRef} className="h-10" />
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ================= 普通用户侧边栏 ================= */
        <aside className="flex flex-col h-full bg-slate-50 border-r border-gray-200 overflow-hidden">
          <div className="h-[71px] p-4 shrink-0 border-b border-gray-200 bg-slate-50 flex items-center justify-center">
            <button onClick={createNewSession} className="w-full bg-black text-white py-2 rounded-xl font-bold text-sm shadow-md transition-all active:scale-95 flex items-center justify-center gap-2">
              <Plus size={16} /> 新建对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 custom-scrollbar">
            {sessions.map((s: ChatSession) => (
              <div key={s.id} onClick={() => setCurrentSessionId(s.id)} className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer ${currentSessionId === s.id ? 'bg-white shadow-sm ring-1 ring-black/5' : 'hover:bg-slate-200/50'}`}>
                <div className="flex items-center gap-3 overflow-hidden flex-1">
                  <MessageSquare size={16} className={currentSessionId === s.id ? 'text-black' : 'text-slate-400'} />
                  {editingSessionId === s.id ? (
                    <input autoFocus className="bg-slate-100 text-sm w-full rounded outline-none" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} onBlur={() => { setSessions(p => p.map(ss => ss.id === s.id ? { ...ss, title: editTitle } : ss)); setEditingSessionId(null); }} onKeyDown={(e) => e.key === 'Enter' && (setSessions(p => p.map(ss => ss.id === s.id ? { ...ss, title: editTitle } : ss)), setEditingSessionId(null))} />
                  ) : ( <span className={`text-sm truncate ${currentSessionId === s.id ? 'font-bold text-black' : 'text-slate-600'}`}>{s.title}</span> )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button onClick={(e) => { e.stopPropagation(); setEditingSessionId(s.id); setEditTitle(s.title); }} className="p-1 hover:text-blue-500"><Edit3 size={14} /></button>
                  <button onClick={(e) => { e.stopPropagation(); setSessions(prev => prev.filter(ss => ss.id !== s.id)); }} className="p-1 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 bg-slate-50 border-t border-gray-200 space-y-2 shrink-0">
            <button onClick={() => setIsBrainOpen(true)} className="w-full flex items-center gap-2 text-slate-500 hover:text-blue-600 p-2 rounded-lg hover:bg-white text-sm font-medium transition-all"><Brain size={16} /> 长期记忆</button>
            <button onClick={() => setIsSettingsOpen(true)} className="w-full flex items-center gap-2 text-slate-500 hover:text-black p-2 rounded-lg hover:bg-white text-sm font-medium transition-all"><Settings size={16} /> 设置中心</button>
            <div className="pt-1">
              {token ? (
                <div className="flex items-center justify-between p-2 bg-blue-50 rounded-lg border border-blue-100 group">
                  <div className="flex items-center gap-2 text-blue-600 font-bold text-xs truncate max-w-[120px]"><UserIcon size={14} /> {username} {isSyncing && <Cloud size={12} className="animate-pulse" />}</div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setIsPwdOpen(true)} className="text-blue-400 hover:text-blue-600" title="修改密码"><Key size={14} /></button>
                    <button onClick={() => setIsLogoutConfirmOpen(true)} className="text-slate-400 hover:text-red-500 ml-1"><LogOut size={14} /></button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setIsAuthOpen(true)} className="w-full bg-blue-600 text-white p-2 rounded-lg text-xs font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-sm"><Cloud size={14} /> 登录同步记忆</button>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* ================= 普通用户主对话区 ================= */}
      {!isAdmin && (
        <main className="flex flex-col h-full overflow-hidden bg-white">
          <header className="h-[71px] flex items-center justify-center border-b border-gray-200 bg-white/90 backdrop-blur-md sticky top-0 z-10 shrink-0">
            <div className="flex items-center gap-2 bg-slate-100 px-4 py-1.5 rounded-full border border-gray-200 shadow-sm">
              <select value={selectedModel.id} onChange={(e) => setSelectedModel(MODELS.find(m => m.id === e.target.value)!)} className="bg-transparent outline-none font-bold text-[11px] cursor-pointer appearance-none pr-4 text-gray-700">
                {MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <ChevronDown size={12} className="text-gray-400" />
            </div>
          </header>

          <div className="flex-1 overflow-y-auto custom-scrollbar bg-white">
            <div className="max-w-4xl mx-auto p-4 md:p-12 space-y-12">
              {(sessions.find(s => s.id === currentSessionId) || sessions[0])?.messages.map((msg: Message) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`w-full ${msg.role === "user" ? "max-w-[80%] ml-auto" : "max-w-none"}`}>
                    {msg.role === "user" ? (
                      <div className="bg-black text-white rounded-2xl px-5 py-3 shadow-sm ml-auto w-fit">
                        {msg.previewImages?.map((url, i) => <img key={i} src={url} className="max-w-xs rounded-xl border border-white/20 mb-2" alt="p" />)}
                        <p className="whitespace-pre-wrap text-[15px]">{msg.content}</p>
                      </div>
                    ) : (
                      <div className="bg-white text-gray-800">
                        {showReasoning && msg.reasoning && (
                          <div className="mb-8 bg-slate-50/80 rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                            <div className="flex items-center gap-2 px-5 py-3 text-slate-400 text-[11px] font-bold border-b border-slate-200/50">
                              <BrainCircuit size={14} className="text-blue-400" /> 思考路径
                            </div>
                            <div className="px-6 py-5 text-slate-500 text-[14px] italic opacity-80 markdown-container">
                              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{ code: CodeBlock as any }}>{standardizeContent(msg.reasoning)}</ReactMarkdown>
                            </div>
                          </div>
                        )}
                        <div className="markdown-container prose prose-slate max-w-none text-[16px]">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{ code: CodeBlock as any }}>{standardizeContent(msg.content)}</ReactMarkdown>
                        </div>
                        {!msg.isError && (<div className="mt-4 text-[10px] text-slate-300 italic flex items-center gap-1"><Check size={10} /> Powered by {msg.modelName}</div>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex items-center gap-3 text-slate-400 text-[11px] font-bold py-3 px-4 bg-slate-50 w-fit rounded-full border border-gray-200 shadow-sm">
                  <Loader2 size={14} className="animate-spin text-black" />
                  <div className="flex items-center gap-1"><Clock size={12} /><span>已思考 {thinkSeconds}s</span></div>
                </div>
              )}
              <div ref={scrollRef} className="h-24" />
            </div>
          </div>

          <footer className="p-4 bg-white border-t border-gray-200 shrink-0">
            <div className="max-w-4xl mx-auto flex flex-col gap-3">
              {attachments.length > 0 && (
                <div className="flex gap-3 p-3 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 overflow-x-auto shadow-inner">
                  {attachments.map((att: Attachment) => (
                    <div key={att.id} className="relative w-16 h-16 flex-shrink-0 group">
                      {att.type === 'image' ? (
                        <img src={att.preview} className="w-full h-full object-cover rounded-xl border-2 border-white shadow-sm" alt="p" />
                      ) : (
                        <div className="w-full h-full bg-white rounded-xl flex flex-col items-center justify-center text-blue-500 border border-slate-200 shadow-sm"><FileText size={20} /><span className="text-[8px] font-bold truncate px-1">{att.name}</span></div>
                      )}
                      <button onClick={() => setAttachments(p => p.filter(a => a.id !== att.id))} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-xl active:scale-110 transition-transform"><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2 bg-slate-100 p-2.5 rounded-[2rem] border border-gray-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-slate-100 transition-all shadow-sm">
                <button onClick={() => fileInputRef.current?.click()} className="p-3 text-slate-400 hover:text-black transition-colors"><Paperclip size={22} /></button>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" multiple accept="image/*,application/pdf" />
                <textarea rows={1} value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), handleSend())} placeholder="问我任何问题 (Cmd/Ctrl + Enter 发送)..." className="flex-1 bg-transparent outline-none py-3 px-1 resize-none max-h-60 text-[15px]" />
                <button onClick={handleSend} disabled={isLoading} className="p-3.5 bg-black text-white rounded-full shadow-2xl disabled:bg-slate-300 transition-all active:scale-95"><Send size={22} /></button>
              </div>
            </div>
          </footer>
        </main>
      )}

      {/* ================= 常规功能弹窗 ================= */}
      {isPwdOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in duration-200 relative">
            <h2 className="text-2xl font-black text-center flex items-center justify-center gap-2"><Key size={24} /> 修改密码</h2>
            <div className="space-y-4">
              <input type="password" placeholder="请输入原密码" className="w-full bg-slate-100 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" value={pwdForm.old} onChange={e => setPwdForm({ ...pwdForm, old: e.target.value })} />
              <input type="password" placeholder="请输入新密码" className="w-full bg-slate-100 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" value={pwdForm.new} onChange={e => setPwdForm({ ...pwdForm, new: e.target.value })} />
              <button onClick={handleChangePwd} className="w-full bg-blue-600 text-white p-3 rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center">确认修改</button>
            </div>
            <button onClick={() => setIsPwdOpen(false)} className="absolute top-4 right-4 text-slate-300 hover:text-black"><X size={24} /></button>
          </div>
        </div>
      )}

      {isAuthOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 space-y-6 relative animate-in zoom-in duration-200">
            <h2 className="text-2xl font-black text-center">{authMode === 'login' ? '欢迎回来' : '开启同步'}</h2>
            <div className="space-y-4">
              <input type="text" placeholder="用户名" className="w-full bg-slate-100 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" value={authForm.user} onChange={e => setAuthForm({ ...authForm, user: e.target.value })} />
              <input type="password" placeholder="密码" className="w-full bg-slate-100 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" value={authForm.pass} onChange={e => setAuthForm({ ...authForm, pass: e.target.value })} />
              <button onClick={handleAuth} className="w-full bg-black text-white p-3 rounded-xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center">立即操作</button>
            </div>
            <button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} className="w-full text-blue-600 text-xs font-bold underline">{authMode === 'login' ? '没有账号？去注册' : '已有账号？登录'}</button>
            <button onClick={() => setIsAuthOpen(false)} className="absolute top-4 right-4 text-slate-300 hover:text-black transition-colors"><X size={24} /></button>
          </div>
        </div>
      )}

      {isLogoutConfirmOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white text-slate-900 w-full max-w-sm rounded-3xl shadow-2xl p-8 space-y-6 text-center animate-in zoom-in duration-200">
            <AlertTriangle className="mx-auto text-red-600" size={32} />
            <h2 className="text-xl font-black">确认退出？</h2>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setIsLogoutConfirmOpen(false)} className="flex-1 bg-slate-100 p-3 rounded-xl font-bold hover:bg-slate-200 transition-colors">点错了</button>
              <button onClick={confirmLogout} className="flex-1 bg-red-600 text-white p-3 rounded-xl font-bold hover:bg-red-700 transition-colors">确定退出</button>
            </div>
          </div>
        </div>
      )}

      {isBrainOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col h-[70vh] animate-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-blue-50/50">
              <h2 className="font-bold text-xl flex items-center gap-2 text-blue-700"><Brain size={24} /> 长期记忆</h2>
              <button onClick={() => setIsBrainOpen(false)} className="text-slate-400 hover:text-black transition-all"><X size={24} /></button>
            </div>
            <div className="flex-1 p-6"><textarea className="w-full h-full bg-slate-50 p-4 rounded-2xl outline-none border border-gray-200 text-sm leading-relaxed" value={longTermMemory} onChange={(e) => setLongTermMemory(e.target.value)} /></div>
            <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button onClick={() => setIsBrainOpen(false)} className="flex-1 bg-black text-white p-3 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors"><Save size={18} /> 确认保存</button>
            </div>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <h2 className="font-bold text-xl flex items-center gap-2 text-gray-800"><Settings size={20} /> 设置中心</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-black transition-all"><X size={24} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Gemini API Key</label>
                <div className="relative">
                  <input type={showKeys ? "text" : "password"} value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} className="w-full bg-slate-100 p-3 pr-12 rounded-xl outline-none focus:ring-2 focus:ring-black" />
                  <button onClick={() => setShowKeys(!showKeys)} className="absolute right-3 top-3 text-slate-400 hover:text-black">{showKeys ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">DeepSeek API Key</label>
                <div className="relative">
                  <input type={showKeys ? "text" : "password"} value={deepseekKey} onChange={(e) => setDeepseekKey(e.target.value)} className="w-full bg-slate-100 p-3 pr-12 rounded-xl outline-none focus:ring-2 focus:ring-black" />
                  <button onClick={() => setShowKeys(!showKeys)} className="absolute right-3 top-3 text-slate-400 hover:text-black">{showKeys ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-100 rounded-2xl">
                <div className="text-sm font-bold flex items-center gap-2"><BrainCircuit size={16} className="text-blue-500" /> 显示思考过程</div>
                <button onClick={() => setShowReasoning(!showReasoning)} className={`w-10 h-5 rounded-full relative transition-colors ${showReasoning ? 'bg-black' : 'bg-slate-300'}`}><div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${showReasoning ? 'left-5' : 'left-1'}`} /></button>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-100 rounded-2xl">
                <div className="text-sm font-bold flex items-center gap-2">{autoUpdateBrain ? <Zap size={16} className="text-amber-500" /> : <ZapOff size={16} className="text-slate-400" />} 自动提炼长期记忆</div>
                <button onClick={() => setAutoUpdateBrain(!autoUpdateBrain)} className={`w-10 h-5 rounded-full relative transition-colors ${autoUpdateBrain ? 'bg-amber-500' : 'bg-slate-300'}`}><div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${autoUpdateBrain ? 'left-5' : 'left-1'}`} /></button>
              </div>
            </div>
            <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button onClick={() => setIsSettingsOpen(false)} className="flex-1 bg-white border border-gray-200 p-3 rounded-xl font-bold text-sm hover:bg-slate-50 transition-colors">取消</button>
              <button onClick={() => {
                localStorage.setItem("eye_gemini_key", geminiKey);
                localStorage.setItem("eye_deepseek_key", deepseekKey);
                localStorage.setItem("eye_show_reasoning", showReasoning.toString());
                localStorage.setItem("eye_auto_brain", autoUpdateBrain.toString());
                setIsSettingsOpen(false);
                showToast("配置已保存");
              }} className="flex-1 bg-black text-white p-3 rounded-xl font-bold shadow-lg text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors"><Save size={18} /> 保存配置</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}