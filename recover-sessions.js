// 在 Uniflourish 页面的浏览器控制台粘贴执行
// 从旧 STORAGE_KEY 恢复会话数据到服务器

(async () => {
  const OLD_KEY = "uniflourish_v1.5.3_stable";
  const token = localStorage.getItem("user_token");
  if (!token) { console.log("❌ 请先登录"); return; }

  // 1. 尝试从旧 IndexedDB key 读取
  const openReq = indexedDB.open("uniflourish_db");
  let sessions = null;

  try {
    const db = await new Promise((resolve, reject) => {
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error);
    });
    const tx = db.transaction("store", "readonly");
    const store = tx.objectStore("store");
    const getReq = store.get(OLD_KEY);
    const result = await new Promise((resolve, reject) => {
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => reject(getReq.error);
    });
    if (result && result.length > 0) {
      sessions = result;
      console.log(`✅ 从 IndexedDB 找到 ${sessions.length} 个会话`);
    }
  } catch (e) {
    console.log("IndexedDB 读取失败:", e.message);
  }

  // 2. 回退：尝试 localStorage
  if (!sessions) {
    const raw = localStorage.getItem(OLD_KEY);
    if (raw) {
      try {
        sessions = JSON.parse(raw);
        console.log(`✅ 从 localStorage 找到 ${sessions.length} 个会话`);
      } catch (e) {}
    }
  }

  if (!sessions || sessions.length === 0) {
    console.log("❌ 本地没有旧数据，尝试从本地 Tauri 存储…");
    console.log("请在终端运行: find ~/Library -name '*uniflourish*' -type d 2>/dev/null");
    return;
  }

  // 3. 恢复：同步到服务器
  console.log(`📤 正在恢复 ${sessions.length} 个会话到服务器...`);
  try {
    const res = await fetch("https://yc.tailb5e8d2.ts.net/api/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ sessions })
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`✅ 恢复成功！${sessions.length} 个会话已同步到服务器`);
      console.log("刷新页面即可看到");
    } else {
      console.log("❌ 服务器返回错误:", data);
    }
  } catch (e) {
    console.log("❌ 同步失败:", e.message);
  }
})();
