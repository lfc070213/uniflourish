// ====== Forum App ======
(function () {
  'use strict';

  // ===== State =====
  var TOKEN_KEY = 'forum_token';
  var token = sessionStorage.getItem(TOKEN_KEY) || '';
  var currentUser = null;
  var socket = null;
  var friendsList = [];

  function getToken() { return token; }
  function setToken(t) { token = t; sessionStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { token = ''; sessionStorage.removeItem(TOKEN_KEY); currentUser = null; }
  function isAdmin() { return currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'poor_admin'); }

  // ===== API =====
  function api(path, options) {
    options = options || {};
    var headers = options.headers || {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var isFormData = options.body instanceof FormData;
    if (!isFormData) headers['Content-Type'] = 'application/json';
    return fetch(path, {
      method: options.method || 'GET',
      headers: headers,
      body: isFormData ? options.body : (options.body ? JSON.stringify(options.body) : undefined)
    }).then(function (r) { return r.json(); });
  }

  // ===== Utilities =====
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function timeAgo(d) {
    if (!d) return '';
    var now = new Date();
    var date = new Date(d);
    var diff = Math.floor((now - date) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 2592000) return Math.floor(diff / 86400) + ' 天前';
    return date.toLocaleDateString('zh-CN');
  }

  function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function getVisLabel(v) {
    var map = { 'public': '公开', 'logged_in': '登录可见', 'friends': '好友可见', 'private': '私密', 'whitelist': '指定可见', 'blacklist': '排除好友' };
    return map[v] || v;
  }

  function authorName(u) {
    if (!u) return '';
    var name = u.nickname || u.username || '';
    return esc(name);
  }

  function avatarEl(u, cls) {
    if (!u) return '';
    cls = cls || 'avatar-sm';
    var letter = (u.nickname || u.username || '?').charAt(0).toUpperCase();
    if (u.avatar) return '<span class="' + cls + '"><img src="' + esc(u.avatar) + '" alt=""></span>';
    return '<span class="' + cls + '">' + letter + '</span>';
  }

  function authorHtml(u) {
    if (!u) return '';
    var name = authorName(u);
    var uid = u._id || '';
    var isUAdmin = u.role === 'super_admin' || u.role === 'poor_admin';
    var badge = isUAdmin ? ' <span class="admin-badge">管理员</span>' : '';
    return '<a href="#/profile/' + uid + '" class="post-author-row" onclick="event.stopPropagation()">' + avatarEl(u, 'avatar-xs') + '<span>' + name + badge + '</span></a>';
  }

  // ===== Modal =====
  function showModal(html, wide) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal' + (wide ? ' wide' : '') + '">' + html + '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    return overlay;
  }

  // ===== Login Modal =====
  function showLoginModal(callback) {
    var html =
      '<h3>登录 Forum</h3>' +
      '<label>账号</label><input type="text" id="loginUser" placeholder="用户名">' +
      '<label>密码</label><input type="password" id="loginPass" placeholder="密码">' +
      '<div class="error" id="loginErr"></div>' +
      '<div class="actions">' +
        '<button class="btn-ghost" id="btnLoginCancel">取消</button>' +
        '<button class="btn-primary" id="btnLoginSubmit">登录</button>' +
      '</div>' +
      '<div style="text-align:center;margin-top:14px;font-size:12px;color:#bbb;">' +
        '没有账号？<a href="javascript:void(0)" id="showRegister" style="color:#333;">立即注册</a>' +
      '</div>';
    var overlay = showModal(html);

    overlay.querySelector('#btnLoginCancel').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('#btnLoginSubmit').addEventListener('click', function () {
      var u = overlay.querySelector('#loginUser').value.trim();
      var p = overlay.querySelector('#loginPass').value.trim();
      var err = overlay.querySelector('#loginErr');
      if (!u || !p) { err.textContent = '请输入账号和密码'; err.style.display = 'block'; return; }
      var btn = overlay.querySelector('#btnLoginSubmit');
      btn.textContent = '登录中...'; btn.disabled = true;
      api('/api/auth', { method: 'POST', body: { username: u, password: p } }).then(function (data) {
        if (data.error) { err.textContent = data.error; err.style.display = 'block'; btn.textContent = '登录'; btn.disabled = false; return; }
        setToken(data.token);
        overlay.remove();
        updateNav(); loadMe(function () { updateNav(); }); navigate(); if (callback) callback();
      }).catch(function () { err.textContent = '网络错误'; err.style.display = 'block'; btn.textContent = '登录'; btn.disabled = false; });
    });
    overlay.querySelector('#loginPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') overlay.querySelector('#btnLoginSubmit').click(); });
    overlay.querySelector('#showRegister').addEventListener('click', function () { overlay.remove(); showRegisterModal(callback); });
  }

  function showRegisterModal(callback) {
    var html =
      '<h3>注册 Forum</h3>' +
      '<label>账号</label><input type="text" id="regUser" placeholder="用户名">' +
      '<label>密码</label><input type="password" id="regPass" placeholder="密码">' +
      '<div class="error" id="regErr"></div>' +
      '<div class="actions">' +
        '<button class="btn-ghost" id="btnRegCancel">取消</button>' +
        '<button class="btn-primary" id="btnRegSubmit">注册</button>' +
      '</div>' +
      '<div style="text-align:center;margin-top:14px;font-size:12px;color:#bbb;">' +
        '已有账号？<a href="javascript:void(0)" id="showLogin" style="color:#333;">去登录</a>' +
      '</div>';
    var overlay = showModal(html);

    overlay.querySelector('#btnRegCancel').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('#btnRegSubmit').addEventListener('click', function () {
      var u = overlay.querySelector('#regUser').value.trim();
      var p = overlay.querySelector('#regPass').value.trim();
      var err = overlay.querySelector('#regErr');
      if (!u || !p) { err.textContent = '请输入账号和密码'; err.style.display = 'block'; return; }
      if (p.length < 6) { err.textContent = '密码至少6位'; err.style.display = 'block'; return; }
      var btn = overlay.querySelector('#btnRegSubmit');
      btn.textContent = '注册中...'; btn.disabled = true;
      api('/api/register', { method: 'POST', body: { username: u, password: p } }).then(function (data) {
        if (data.error) { err.textContent = data.error; err.style.display = 'block'; btn.textContent = '注册'; btn.disabled = false; return; }
        overlay.remove();
        showLoginModal(callback);
      }).catch(function () { err.textContent = '网络错误'; err.style.display = 'block'; btn.textContent = '注册'; btn.disabled = false; });
    });
    overlay.querySelector('#regPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') overlay.querySelector('#btnRegSubmit').click(); });
    overlay.querySelector('#showLogin').addEventListener('click', function () { overlay.remove(); showLoginModal(callback); });
  }

  // ===== Auth Nav =====
  function parseJWT(t) {
    try {
      var payload = t.split('.')[1];
      var decoded = JSON.parse(atob(payload));
      return decoded;
    } catch (e) { return null; }
  }

  function updateNav() {
    var nav = document.getElementById('navAuth');
    if (token) {
      var decoded = parseJWT(token);
      var name = (currentUser && (currentUser.nickname || currentUser.username)) || (decoded && decoded.username) || '';
      var adminBadge = (currentUser && isAdmin()) || (decoded && (decoded.role === 'super_admin' || decoded.role === 'poor_admin')) ? ' <span class="admin-badge">管理员</span>' : '';
      nav.innerHTML =
        '<a href="#/profile/me">' + esc(name) + adminBadge + '</a>' +
        '<a id="btnLogout">退出</a>';
      document.getElementById('btnLogout').addEventListener('click', function () {
        clearToken(); updateNav(); navigate();
      });
    } else {
      nav.innerHTML = '<a id="btnLogin">登录</a><a id="btnRegister">注册</a>';
      document.getElementById('btnLogin').addEventListener('click', function () { showLoginModal(); });
      document.getElementById('btnRegister').addEventListener('click', function () { showRegisterModal(); });
    }
  }

  function loadMe(callback) {
    if (!token) { currentUser = null; updateNav(); if (callback) callback(); return; }
    api('/api/me').then(function (data) {
      if (data.error) { clearToken(); updateNav(); if (callback) callback(); return; }
      currentUser = data.user;
      updateNav();
      setupSocket();
      if (callback) callback();
    }).catch(function () { if (callback) callback(); });
    updateNotifBadge();
  }

  function updateNotifBadge() {
    if (!token) return;
    api('/api/notifications/unread-count').then(function (data) {
      var badge = document.getElementById('notifBadge');
      if (badge) {
        if (data.count > 0) { badge.style.display = 'inline'; badge.textContent = data.count; }
        else { badge.style.display = 'none'; }
      }
    }).catch(function () { });
  }

  function updateFriendBadge() {
    if (!token) return;
    Promise.all([
      api('/api/friends/requests'),
      api('/api/chat/unread-count')
    ]).then(function (results) {
      var badge = document.getElementById('friendBadge');
      if (!badge) return;
      var reqData = results[0] || {};
      var chatData = results[1] || {};
      var count = (reqData.received ? reqData.received.length : 0) + (chatData.count || 0);
      if (count > 0) { badge.style.display = 'inline'; badge.textContent = count; }
      else { badge.style.display = 'none'; }
    }).catch(function () { });
  }

  // ===== Socket.io =====
  function setupSocket() {
    if (socket) return;
    if (!token) return;
    try {
      socket = io({ path: '/chat/socket.io', auth: { token: token } });
      socket.on('chat:message', function (msg) {
        updateFriendBadge();
        // If user is currently viewing the chat with this sender, add to view
        if (activeChatId && (msg.sender === activeChatId || (currentUser && msg.sender.toString() === currentUser._id.toString()))) {
          chatMessages.push(msg);
          renderChatMessagesFull();
          socket.emit('chat:read', { senderId: msg.sender });
        }
      });
      socket.on('chat:typing', function (data) {
        if (data.userId === activeChatId) {
          var el = document.getElementById('chatTypingFull');
          if (el) { el.textContent = '对方正在输入...'; clearTimeout(chatMessages._typingTimer); chatMessages._typingTimer = setTimeout(function () { if (el) el.textContent = ''; }, 2000); }
        }
      });
      socket.on('friend:online', function (data) {
        // Could show online indicator
      });
      socket.on('connect_error', function () { /* ignore */ });
    } catch (e) { /* Socket.io not loaded yet */ }
  }

  // ===== Router =====
  function navigate() {
    var hash = window.location.hash || '#/';
    var app = document.getElementById('app');
    if (!app) return;

    // Parse hash
    var fullPath = hash.replace('#', '') || '/';
    // Extract query params from hash
    var queryIdx = fullPath.indexOf('?');
    var queryStr = queryIdx > -1 ? fullPath.substring(queryIdx + 1) : '';
    var path = queryIdx > -1 ? fullPath.substring(0, queryIdx) : fullPath;
    var params = {};
    if (queryStr) {
      queryStr.split('&').forEach(function (p) {
        var kv = p.split('=');
        if (kv.length === 2) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
      });
    }
    var parts = path.split('/').filter(function (p) { return p; });

    // Clear chat state when leaving chat page
    if (parts[0] !== 'chat') { activeChatId = null; chatMessages = []; }

    if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) {
      renderPostList(1, params.tag || '');
    } else if (parts[0] === 'new') {
      renderPostForm(null);
    } else if (parts[0] === 'edit' && parts[1]) {
      renderPostForm(parts[1]);
    } else if (parts[0] === 'post' && parts[1]) {
      renderPostDetail(parts[1]);
    } else if (parts[0] === 'friends') {
      renderFriends();
    } else if (parts[0] === 'notifications') {
      renderNotifications();
    } else if (parts[0] === 'chat' && parts[1]) {
      renderChatPage(parts[1]);
    } else if (parts[0] === 'profile' && parts[1]) {
      renderProfile(parts[1] === 'me' ? (currentUser ? currentUser._id : null) : parts[1]);
    } else if (parts[0] === 'setting') {
      renderSetting();
    } else {
      renderPostList(1, '');
    }
  }

  window.addEventListener('hashchange', function () { navigate(); });

  // ===== Post List =====
  function renderPostList(page, tagFilter) {
    tagFilter = tagFilter || '';
    var app = document.getElementById('app');
    app.innerHTML =
      '<div class="page-header">' +
        '<h2>' + (tagFilter ? '#' + esc(tagFilter) + ' 的帖子' : '帖子') + '</h2>' +
        (tagFilter ? '<button class="btn-sm" id="btnClearTag">清除筛选</button>' : '') +
        (token ? '<button class="btn btn-primary" id="btnNewPost">发帖</button>' : '') +
      '</div>' +
      '<div id="tagCloud" style="margin-bottom:16px;"><div class="loading" style="padding:8px;">加载标签...</div></div>' +
      '<div id="postList"><div class="loading">加载中...</div></div>' +
      '<div class="pagination" id="pagination"></div>';

    if (tagFilter) {
      document.getElementById('btnClearTag').addEventListener('click', function () {
        window.location.hash = '#/';
      });
    }

    if (token) {
      document.getElementById('btnNewPost').addEventListener('click', function () {
        window.location.hash = '#/new';
      });
    }

    var apiUrl = '/api/posts?page=' + page + '&limit=20';
    if (tagFilter) apiUrl += '&tag=' + encodeURIComponent(tagFilter);

    // Load tag cloud
    api('/api/tags').then(function (tags) {
      var cloud = document.getElementById('tagCloud');
      if (!cloud || !tags || tags.length === 0) { if (cloud) cloud.style.display = 'none'; }
      else {
        var tagHtml = '';
        for (var i = 0; i < Math.min(tags.length, 20); i++) {
          var t = tags[i];
          tagHtml += '<span class="tag' + (tagFilter === t._id ? ' active' : '') + '" data-tag="' + esc(t._id) + '">#' + esc(t._id) + '(' + t.count + ')</span>';
        }
        cloud.innerHTML = tagHtml;
        cloud.querySelectorAll('.tag').forEach(function (el) {
          el.addEventListener('click', function () {
            window.location.hash = '#/?tag=' + encodeURIComponent(this.dataset.tag);
          });
        });
      }
    });

    api(apiUrl).then(function (data) {
      var list = document.getElementById('postList');
      if (!list) return;
      if (!data.posts || data.posts.length === 0) {
        list.innerHTML = '<div class="empty">暂无帖子</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < data.posts.length; i++) {
        var p = data.posts[i];
        var visClass = p.visibility;
        html += '<div class="post-card' + (p.isPinned ? ' pinned' : '') + '" data-id="' + p._id + '">';
        if (p.isPinned) html += '<div style="font-size:10px;color:#bbb;margin-bottom:4px;">📌 置顶</div>';
        html += '<div class="post-meta">' +
          '<span class="post-author">' + authorHtml(p.author) + '</span>' +
          '<span class="post-vis ' + visClass + '">' + getVisLabel(p.visibility) + '</span>' +
          '<span class="post-date">' + timeAgo(p.createdAt) + '</span>' +
        '</div>' +
        '<div class="post-title">' + esc(p.title) + '</div>' +
        '<div class="post-snippet">' + esc((p.content || '').substring(0, 120)) + '</div>';
        // Attachments thumbnails
        if (p.attachments && p.attachments.length > 0) {
          html += '<div class="post-attach-thumbs">';
          for (var j = 0; j < Math.min(p.attachments.length, 4); j++) {
            var a = p.attachments[j];
            if (a.type === 'image') {
              html += '<img src="' + esc(a.thumbUrl || a.url) + '" alt="" loading="lazy">';
            } else {
              html += '<span class="file-tag">📎 ' + esc(a.filename) + '</span>';
            }
          }
          if (p.attachments.length > 4) html += '<span class="file-tag">+' + (p.attachments.length - 4) + '</span>';
          html += '</div>';
        }
        // Tags
        if (p.tags && p.tags.length > 0) {
          html += '<div class="post-tags">';
          for (var jj = 0; jj < p.tags.length; jj++) {
            html += '<span class="tag" data-tag="' + esc(p.tags[jj]) + '">#' + esc(p.tags[jj]) + '</span>';
          }
          html += '</div>';
        }
        html += '<div class="post-footer">' +
          '<button class="btn-like" data-id="' + p._id + '" data-likes="' + (p.likeCount || 0) + '">♥ ' + (p.likeCount || 0) + '</button>' +
          '<span>' + (p.commentCount || 0) + ' 评论</span>' +
        '</div></div>';
      }
      list.innerHTML = html;

      // Tag click: filter by tag
      var tagEls = list.querySelectorAll('.tag');
      for (var jj = 0; jj < tagEls.length; jj++) {
        tagEls[jj].addEventListener('click', function (e) {
          e.stopPropagation();
          var t = this.dataset.tag;
          window.location.hash = '#/?tag=' + encodeURIComponent(t);
        });
      }

      // Like buttons
      var likeBtns = list.querySelectorAll('.btn-like');
      for (var lk = 0; lk < likeBtns.length; lk++) {
        likeBtns[lk].addEventListener('click', function (e) {
          e.stopPropagation();
          if (!token) { showLoginModal(); return; }
          var id = this.dataset.id;
          var btn = this;
          api('/api/posts/' + id + '/like', { method: 'PUT' }).then(function (r) {
            if (r.error) return;
            btn.dataset.likes = r.likeCount;
            btn.textContent = '♥ ' + r.likeCount;
            if (r.liked) btn.classList.add('liked'); else btn.classList.remove('liked');
          });
        });
      }

      // Click to view post
      var cards = list.querySelectorAll('.post-card');
      for (var k = 0; k < cards.length; k++) {
        cards[k].addEventListener('click', function () {
          window.location.hash = '#/post/' + this.dataset.id;
        });
      }

      // Pagination
      var pag = document.getElementById('pagination');
      if (pag && data.pages > 1) {
        var pagHtml = '';
        if (page > 1) pagHtml += '<button id="btnPrev">上一页</button>';
        pagHtml += '<span>' + page + ' / ' + data.pages + '</span>';
        if (page < data.pages) pagHtml += '<button id="btnNext">下一页</button>';
        pag.innerHTML = pagHtml;
        if (page > 1) document.getElementById('btnPrev').addEventListener('click', function () { renderPostList(page - 1); window.scrollTo(0, 0); });
        if (page < data.pages) document.getElementById('btnNext').addEventListener('click', function () { renderPostList(page + 1); window.scrollTo(0, 0); });
      }
    }).catch(function () {
      document.getElementById('postList').innerHTML = '<div class="empty">加载失败</div>';
    });
  }

  // ===== Post Detail =====
  function renderPostDetail(postId) {
    if (!postId) return;
    var app = document.getElementById('app');
    app.innerHTML = '<div class="loading">加载中...</div>';

    api('/api/posts/' + postId).then(function (post) {
      if (post.error) { app.innerHTML = '<div class="empty">' + esc(post.error) + '</div>'; return; }

      var canEdit = currentUser && (currentUser._id === (post.author._id || post.author));
      var canDelete = canEdit || isAdmin();
      var isLocked = post.isLocked;

      var html =
        '<a class="back-link" href="#/">← 返回</a>' +
        '<div class="post-detail">' +
          '<div class="post-meta">' +
            '<span class="post-author">' + authorHtml(post.author) + '</span>' +
            '<span class="post-vis ' + post.visibility + '">' + getVisLabel(post.visibility) + '</span>' +
            '<span class="post-date">' + formatDate(post.createdAt) + '</span>' +
          '</div>' +
          '<h1 class="post-title">' + esc(post.title) + '</h1>' +
          '<div class="post-content">' + esc(post.content) + '</div>';

      // Tags
      if (post.tags && post.tags.length > 0) {
        html += '<div class="post-tags" style="margin-bottom:12px;">';
        for (var ti = 0; ti < post.tags.length; ti++) {
          html += '<span class="tag" data-tag="' + esc(post.tags[ti]) + '">#' + esc(post.tags[ti]) + '</span>';
        }
        html += '</div>';
      }

      // Attachments
      if (post.attachments && post.attachments.length > 0) {
        html += '<div class="post-attachments">';
        for (var i = 0; i < post.attachments.length; i++) {
          var a = post.attachments[i];
          if (a.type === 'image') {
            html += '<img src="' + esc(a.url) + '" alt="' + esc(a.filename) + '" class="img-clickable" data-src="' + esc(a.url) + '">';
          } else {
            html += '<a href="' + esc(a.url) + '" download>' + esc(a.filename) + ' (' + formatSize(a.size) + ')</a>';
          }
        }
        html += '</div>';
      }

      html += '<div class="post-actions">';
      html += '<button class="btn-like" id="btnLikePost" data-id="' + post._id + '" data-likes="' + (post.likeCount || 0) + '">♥ ' + (post.likeCount || 0) + '</button>';
      if (canEdit) html += '<button class="btn-sm" id="btnEditPost">编辑</button>';
      if (canDelete) html += '<button class="btn-danger" id="btnDeletePost">删除</button>';
      if (isAdmin()) {
        html += '<button class="btn-sm" id="btnPinPost">' + (post.isPinned ? '取消置顶' : '置顶') + '</button>';
        html += '<button class="btn-sm" id="btnLockPost">' + (post.isLocked ? '解锁评论' : '锁定评论') + '</button>';
      }
      html += '</div></div>';

      // Comments section
      html += '<div class="comments-section">' +
        '<h4>评论 (' + (post.commentCount || 0) + ')</h4>' +
        '<div id="commentsList"><div class="loading">加载中...</div></div>';

      if (token && !isLocked) {
        html += '<div class="comment-form">' +
          '<textarea id="commentContent" placeholder="写下评论..."></textarea>' +
          '<div class="form-row">' +
            '<input type="file" id="commentFiles" multiple><span class="file-hint">可上传图片和文件</span>' +
          '</div>' +
          '<div class="form-row" style="margin-top:8px;">' +
            '<span></span>' +
            '<button class="btn btn-primary" id="btnSubmitComment" style="flex:none;">发表评论</button>' +
          '</div>' +
        '</div>';
      } else if (isLocked) {
        html += '<div class="empty" style="padding:12px;font-size:12px;">评论已锁定</div>';
      } else {
        html += '<div class="empty" style="padding:12px;font-size:12px;"><a href="javascript:void(0)" id="loginToComment" style="color:#333;">登录</a>后可评论</div>';
      }

      html += '</div>';
      app.innerHTML = html;

      // Image click
      var imgs = app.querySelectorAll('.img-clickable');
      for (var j = 0; j < imgs.length; j++) {
        imgs[j].addEventListener('click', function () {
          showImageModal(this.dataset.src);
        });
      }

      // Tag click
      var tagEls = app.querySelectorAll('.tag');
      for (var tj = 0; tj < tagEls.length; tj++) {
        tagEls[tj].addEventListener('click', function () {
          window.location.hash = '#/?tag=' + encodeURIComponent(this.dataset.tag);
        });
      }

      // Login to comment
      var loginLink = document.getElementById('loginToComment');
      if (loginLink) loginLink.addEventListener('click', function () { showLoginModal(function () { renderPostDetail(postId); }); });

      // Like
      var btnLike = document.getElementById('btnLikePost');
      if (btnLike) btnLike.addEventListener('click', function () {
        if (!token) { showLoginModal(); return; }
        var id = this.dataset.id;
        var btn = this;
        api('/api/posts/' + id + '/like', { method: 'PUT' }).then(function (r) {
          if (r.error) return;
          btn.dataset.likes = r.likeCount;
          btn.textContent = '♥ ' + r.likeCount;
          if (r.liked) btn.classList.add('liked'); else btn.classList.remove('liked');
        });
      });

      // Edit
      var btnEdit = document.getElementById('btnEditPost');
      if (btnEdit) btnEdit.addEventListener('click', function () { window.location.hash = '#/edit/' + postId; });

      // Delete
      var btnDelete = document.getElementById('btnDeletePost');
      if (btnDelete) btnDelete.addEventListener('click', function () {
        if (!confirm('确定删除此帖？')) return;
        api('/api/posts/' + postId, { method: 'DELETE' }).then(function (r) {
          if (r.error) { alert(r.error); return; }
          window.location.hash = '#/';
        });
      });

      // Pin/Lock
      var btnPin = document.getElementById('btnPinPost');
      if (btnPin) btnPin.addEventListener('click', function () {
        api('/api/posts/' + postId + '/pin', { method: 'PUT' }).then(function () { renderPostDetail(postId); });
      });
      var btnLock = document.getElementById('btnLockPost');
      if (btnLock) btnLock.addEventListener('click', function () {
        api('/api/posts/' + postId + '/lock', { method: 'PUT' }).then(function () { renderPostDetail(postId); });
      });

      // Load comments
      loadComments(postId);

      // Submit comment
      var btnSubmit = document.getElementById('btnSubmitComment');
      if (btnSubmit) btnSubmit.addEventListener('click', function () { submitComment(postId); });

      var textarea = document.getElementById('commentContent');
      if (textarea) {
        textarea.addEventListener('keydown', function (e) {
          if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey)) || (e.key === 'Enter' && !e.shiftKey)) {
            e.preventDefault();
            submitComment(postId);
          }
        });
      }

      // Bot owner can delete their bot's posts
      if (!canDelete && token) {
        api('/api/bot').then(function (data) {
          if (data.bot && data.bot.botUsername === post.author.username) {
            var actions = document.querySelector('.post-actions');
            if (actions) {
              var delBtn = document.createElement('button');
              delBtn.className = 'btn-danger';
              delBtn.id = 'btnDeletePost';
              delBtn.textContent = '删除';
              delBtn.addEventListener('click', function () {
                if (!confirm('确定删除此帖？')) return;
                api('/api/posts/' + postId, { method: 'DELETE' }).then(function (r) {
                  if (r.error) { alert(r.error); return; }
                  window.location.hash = '#/';
                });
              });
              var editBtn = document.getElementById('btnEditPost');
              if (editBtn) {
                editBtn.parentNode.insertBefore(delBtn, editBtn.nextSibling);
              } else {
                var likeBtn = document.getElementById('btnLikePost');
                likeBtn.parentNode.insertBefore(delBtn, likeBtn.nextSibling);
              }
            }
          }
        });
      }
    }).catch(function () { app.innerHTML = '<div class="empty">加载失败</div>'; });
  }

  function loadComments(postId) {
    api('/api/posts/' + postId + '/comments').then(function (comments) {
      var list = document.getElementById('commentsList');
      if (!list) return;
      if (!comments || comments.length === 0) {
        list.innerHTML = '<div class="empty" style="font-size:13px;">暂无评论</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < comments.length; i++) {
        var c = comments[i];
        var canDelete = currentUser && (currentUser._id === (c.author._id || c.author) || isAdmin());
        html += '<div class="comment" data-id="' + c._id + '">' +
          '<div class="comment-header">' +
            '<span class="comment-author">' + authorHtml(c.author) + '</span>' +
            '<span class="comment-date">' + timeAgo(c.createdAt) + '</span>' +
          '</div>' +
          '<div class="comment-content">' + esc(c.content) + '</div>';
        if (c.attachments && c.attachments.length > 0) {
          html += '<div class="comment-attachments">';
          for (var j = 0; j < c.attachments.length; j++) {
            var a = c.attachments[j];
            if (a.type === 'image') {
              html += '<img src="' + esc(a.url) + '" class="img-clickable" data-src="' + esc(a.url) + '">';
            } else {
              html += '<a href="' + esc(a.url) + '" download style="font-size:11px;color:#999;">📎 ' + esc(a.filename) + '</a>';
            }
          }
          html += '</div>';
        }
        if (canDelete) {
          html += '<div class="comment-actions"><button class="btn-danger btn-del-comment" data-id="' + c._id + '">删除</button></div>';
        }
        html += '</div>';
      }
      list.innerHTML = html;

      // Image click
      var imgs = list.querySelectorAll('.img-clickable');
      for (var k = 0; k < imgs.length; k++) {
        imgs[k].addEventListener('click', function () { showImageModal(this.dataset.src); });
      }

      // Delete comment
      var delBtns = list.querySelectorAll('.btn-del-comment');
      for (var m = 0; m < delBtns.length; m++) {
        delBtns[m].addEventListener('click', function () {
          if (!confirm('确定删除此评论？')) return;
          var id = this.dataset.id;
          api('/api/comments/' + id, { method: 'DELETE' }).then(function (r) {
            if (r.error) { alert(r.error); return; }
            loadComments(postId);
          });
        });
      }
    });
  }

  function submitComment(postId) {
    var content = document.getElementById('commentContent').value.trim();
    if (!content) { alert('请输入评论内容'); return; }
    var filesInput = document.getElementById('commentFiles');
    var formData = new FormData();
    formData.append('content', content);
    if (filesInput && filesInput.files) {
      for (var i = 0; i < filesInput.files.length; i++) {
        formData.append('files', filesInput.files[i]);
      }
    }
    var btn = document.getElementById('btnSubmitComment');
    btn.textContent = '提交中...'; btn.disabled = true;
    api('/api/posts/' + postId + '/comments', { method: 'POST', body: formData }).then(function (r) {
      if (r.error) { alert(r.error); btn.textContent = '发表评论'; btn.disabled = false; return; }
      document.getElementById('commentContent').value = '';
      if (filesInput) filesInput.value = '';
      btn.textContent = '发表评论'; btn.disabled = false;
      loadComments(postId);
      // Refresh post for comment count
      api('/api/posts/' + postId).then(function (post) {
        var h4 = document.querySelector('.comments-section h4');
        if (h4) h4.textContent = '评论 (' + (post.commentCount || 0) + ')';
      });
    }).catch(function () { btn.textContent = '发表评论'; btn.disabled = false; });
  }

  // ===== Post Create/Edit =====
  function renderPostForm(editId) {
    if (!token) { showLoginModal(function () { renderPostForm(editId); }); return; }

    var app = document.getElementById('app');
    var isEdit = !!editId;

    if (isEdit) {
      app.innerHTML = '<div class="loading">加载中...</div>';
      api('/api/posts/' + editId).then(function (post) {
        if (post.error) { app.innerHTML = '<div class="empty">' + esc(post.error) + '</div>'; return; }
        if (currentUser._id !== (post.author._id || post.author)) {
          app.innerHTML = '<div class="empty">无权编辑</div>'; return;
        }
        renderFormHtml(post);
      }).catch(function () { app.innerHTML = '<div class="empty">加载失败</div>'; });
    } else {
      renderFormHtml(null);
    }

    function renderFormHtml(post) {
      var title = post ? post.title : '';
      var content = post ? post.content : '';
      var visibility = post ? post.visibility : 'public';
      var attachments = post ? post.attachments : [];

      var visOptions = '';
      var visLabels = { 'public': '公开', 'logged_in': '仅登录用户可见', 'friends': '仅好友可见', 'private': '私密', 'whitelist': '指定好友可见', 'blacklist': '指定好友不可见' };
      for (var key in visLabels) {
        visOptions += '<option value="' + key + '"' + (visibility === key ? ' selected' : '') + '>' + visLabels[key] + '</option>';
      }

      var html =
        '<a class="back-link" href="' + (isEdit ? '#/post/' + editId : '#/') + '">← 返回</a>' +
        '<h2 style="margin-bottom:20px;font-size:18px;">' + (isEdit ? '编辑帖子' : '发帖') + '</h2>' +
        '<div class="vis-group"><label>标题</label><input type="text" id="postTitle" value="' + esc(title) + '" maxlength="200" placeholder="标题"></div>' +
        '<div class="vis-group"><label>内容</label><textarea id="postContent" placeholder="想说些什么...">' + esc(content) + '</textarea></div>' +

        '<div class="vis-group"><label>可见范围</label>' +
          '<select id="postVis">' + visOptions + '</select>' +
        '</div>' +
        '<div class="vis-group" id="friendSelectGroup" style="display:none;">' +
          '<label>选择好友</label>' +
          '<div id="friendCheckList"></div>' +
        '</div>' +

        '<div class="vis-group"><label>附件</label>' +
          '<input type="file" id="postFiles" multiple>' +
          '<span class="file-size-warn" id="fileSizeWarn">文件过大会导致传输变慢</span>' +
        '</div>';

      if (isEdit && attachments.length > 0) {
        html += '<div class="vis-group"><label>已有附件</label><div style="display:flex;gap:8px;flex-wrap:wrap;">';
        for (var i = 0; i < attachments.length; i++) {
          var a = attachments[i];
          html += '<label style="font-size:12px;display:flex;align-items:center;gap:4px;">' +
            '<input type="checkbox" name="keepAttach" value="' + esc(a.storedName) + '" checked> ' + esc(a.filename) +
            '</label>';
        }
        html += '</div></div>';
      }

      html +=
        '<div class="actions" style="margin-top:20px;">' +
          '<button class="btn-ghost" id="btnFormCancel">取消</button>' +
          '<button class="btn-primary" id="btnFormSubmit">' + (isEdit ? '保存' : '发布') + '</button>' +
        '</div>';

      app.innerHTML = html;

      // Visibility change handler
      var visSelect = document.getElementById('postVis');
      var friendGroup = document.getElementById('friendSelectGroup');
      function updateFriendSelect() {
        var v = visSelect.value;
        if (v === 'whitelist' || v === 'blacklist') {
          friendGroup.style.display = 'block';
          loadFriendCheckboxes(v, isEdit && post ? (v === 'whitelist' ? post.visibleTo : post.hiddenFrom) : []);
        } else {
          friendGroup.style.display = 'none';
        }
      }
      visSelect.addEventListener('change', updateFriendSelect);
      updateFriendSelect();

      // File size warning
      var fileInput = document.getElementById('postFiles');
      if (fileInput) {
        fileInput.addEventListener('change', function () {
          var warn = document.getElementById('fileSizeWarn');
          if (!warn) return;
          var big = false;
          for (var i = 0; i < fileInput.files.length; i++) {
            if (fileInput.files[i].size > 20 * 1024 * 1024) { big = true; break; }
          }
          warn.style.display = big ? 'inline' : 'none';
        });
      }

      document.getElementById('btnFormCancel').addEventListener('click', function () { history.back(); });
      document.getElementById('btnFormSubmit').addEventListener('click', function () {
        var t = document.getElementById('postTitle').value.trim();
        var c = document.getElementById('postContent').value.trim();
        if (!t || !c) { alert('标题和内容不能为空'); return; }

        var btn = document.getElementById('btnFormSubmit');
        btn.textContent = '处理图片...'; btn.disabled = true;

        var filesInput = document.getElementById('postFiles');
        var rawFiles = filesInput && filesInput.files ? Array.from(filesInput.files) : [];

        // Step 1: Resize images client-side and upload thumbnails first
        resizeAndUpload(rawFiles, function (thumbResults) {
          // Step 2: Submit post with thumbnails immediately
          var formData = new FormData();
          formData.append('title', t);
          formData.append('content', c);
          formData.append('visibility', visSelect.value);

          if (visSelect.value === 'whitelist' || visSelect.value === 'blacklist') {
            var checked = [];
            var checkboxes = document.querySelectorAll('#friendCheckList input:checked');
            for (var i = 0; i < checkboxes.length; i++) { checked.push(checkboxes[i].value); }
            formData.append(visSelect.value === 'whitelist' ? 'visibleTo' : 'hiddenFrom', JSON.stringify(checked));
          }

          if (isEdit) {
            var keepChecks = document.querySelectorAll('input[name="keepAttach"]:checked');
            var keepList = [];
            for (var j = 0; j < keepChecks.length; j++) { keepList.push(keepChecks[j].value); }
            formData.append('keepAttachments', JSON.stringify(keepList));
          }

          // Attach thumbnails (small, fast upload)
          for (var k = 0; k < thumbResults.length; k++) {
            formData.append('files', thumbResults[k].blob, thumbResults[k].name);
          }

          btn.textContent = '发布中...';
          var method = isEdit ? 'PUT' : 'POST';
          var apiUrl = isEdit ? '/api/posts/' + editId : '/api/posts';
          api(apiUrl, { method: method, body: formData }).then(function (r) {
            if (r.error) { alert(r.error); btn.textContent = isEdit ? '保存' : '发布'; btn.disabled = false; return; }
            var postId = r._id;
            window.location.hash = '#/post/' + postId;

            // Step 3: Upload originals in background, then patch attachments
            uploadOriginals(postId, null, rawFiles, thumbResults);
          }).catch(function () { btn.textContent = isEdit ? '保存' : '发布'; btn.disabled = false; });
        });
      });
    }
  }

  function loadFriendCheckboxes(visMode, selectedIds) {
    if (!token) return;
    api('/api/friends').then(function (friends) {
      var list = document.getElementById('friendCheckList');
      if (!list) return;
      if (!friends || friends.length === 0) {
        list.innerHTML = '<div style="font-size:12px;color:#bbb;">暂无好友，<a href="#/friends" style="color:#333;">去添加</a></div>';
        return;
      }
      var html = '';
      for (var i = 0; i < friends.length; i++) {
        var f = friends[i];
        var name = f.nickname || f.username;
        var checked = '';
        if (selectedIds) {
          for (var j = 0; j < selectedIds.length; j++) {
            if (selectedIds[j] === f._id) { checked = ' checked'; break; }
          }
        }
        html += '<div class="friend-check"><input type="checkbox" value="' + f._id + '"' + checked + '> ' + esc(name) + '</div>';
      }
      list.innerHTML = html;
    });
  }

  // ===== Friends =====
  function renderFriends() {
    if (!token) { showLoginModal(function () { renderFriends(); }); return; }

    var app = document.getElementById('app');
    app.innerHTML =
      '<div class="page-header">' +
        '<h2>好友</h2>' +
        '<button class="btn btn-sm" id="btnAddFriend">+ 添加好友</button>' +
      '</div>' +
      '<div id="friendRequests"></div>' +
      '<div id="friendList"><div class="loading">加载中...</div></div>';

    document.getElementById('btnAddFriend').addEventListener('click', function () { showAddFriendModal(); });

    // Load requests + friends list + unread in parallel
    var reqPromise = api('/api/friends/requests');
    var friendsPromise = Promise.all([api('/api/friends'), api('/api/chat/unread-by-friend')]);

    reqPromise.then(function (data) {
      var reqDiv = document.getElementById('friendRequests');
      if (!reqDiv) return;
      var html = '';
      if (data.received && data.received.length > 0) {
        html += '<div style="font-weight:600;font-size:13px;margin-bottom:12px;">收到的好友请求</div>';
        for (var i = 0; i < data.received.length; i++) {
          var r = data.received[i];
          var name = r.from.nickname || r.from.username;
          html += '<div class="request-card">' +
            '<div class="request-info"><span class="name">' + esc(name) + '</span>' +
            (r.message ? '<span class="msg">' + esc(r.message) + '</span>' : '') + '</div>' +
            '<div class="friend-actions">' +
              '<button class="btn btn-sm btn-accept" data-id="' + r._id + '">接受</button>' +
              '<button class="btn btn-sm btn-reject" data-id="' + r._id + '">拒绝</button>' +
            '</div></div>';
        }
      }
      if (data.sent && data.sent.length > 0) {
        html += '<div style="font-weight:600;font-size:13px;margin:16px 0 12px;">已发送的请求</div>';
        for (var j = 0; j < data.sent.length; j++) {
          var s = data.sent[j];
          var sname = s.to.nickname || s.to.username;
          html += '<div class="request-card"><div class="request-info"><span class="name">' + esc(sname) + '</span><span class="msg">等待对方回应</span></div></div>';
        }
      }
      if (!html) html = '<div class="empty" style="font-size:13px;">暂无好友请求</div>';
      reqDiv.innerHTML = html;

      // Bind accept/reject
      var accepts = reqDiv.querySelectorAll('.btn-accept');
      for (var k = 0; k < accepts.length; k++) {
        accepts[k].addEventListener('click', function () {
          api('/api/friends/request/' + this.dataset.id + '/accept', { method: 'PUT' }).then(function () { renderFriends(); updateNotifBadge(); });
        });
      }
      var rejects = reqDiv.querySelectorAll('.btn-reject');
      for (var m = 0; m < rejects.length; m++) {
        rejects[m].addEventListener('click', function () {
          api('/api/friends/request/' + this.dataset.id + '/reject', { method: 'PUT' }).then(function () { renderFriends(); });
        });
      }
    });

    // Load friends list + unread counts
    Promise.all([api('/api/friends'), api('/api/chat/unread-by-friend')]).then(function (results) {
      var friends = results[0] || [];
      var unreadMap = results[1] || {};
      friendsList = friends;
      var list = document.getElementById('friendList');
      if (!list) return;
      if (!friends || friends.length === 0) {
        list.innerHTML = '<div class="empty">暂无好友</div>';
        return;
      }
      var html = '<div style="font-weight:600;font-size:13px;margin:20px 0 12px;">好友列表 (' + friends.length + ')</div>';
      for (var i = 0; i < friends.length; i++) {
        var f = friends[i];
        var name = f.nickname || f.username;
        var unread = unreadMap[f._id] || 0;
        var badgeHtml = unread > 0 ? '<span class="friend-badge">' + unread + '</span>' : '';
        var avatarHtml = f.avatar ? '<div class="friend-avatar"><img src="' + esc(f.avatar) + '"></div>' : '<div class="friend-avatar">' + name.charAt(0).toUpperCase() + '</div>';
        html += '<div class="friend-card">' +
          '<a href="#/profile/' + f._id + '" style="display:flex;align-items:center;text-decoration:none;color:inherit;position:relative;">' + avatarHtml + badgeHtml + '</a>' +
          '<div class="friend-info"><span class="friend-name">' + esc(name) + '</span>' +
          (f.bio ? '<span class="friend-bio">' + esc(f.bio) + '</span>' : '') + '</div>' +
          '<div class="friend-actions">' +
            '<button class="btn btn-sm btn-chat" data-id="' + f._id + '" data-name="' + esc(name) + '">私聊</button>' +
            '<button class="btn btn-sm btn-unfriend" data-id="' + f._id + '">删除</button>' +
          '</div></div>';
      }
      list.innerHTML = html;

      // Chat buttons
      var chatBtns = list.querySelectorAll('.btn-chat');
      for (var j = 0; j < chatBtns.length; j++) {
        chatBtns[j].addEventListener('click', function () {
          openChatWindow(this.dataset.id, this.dataset.name);
        });
      }

      // Unfriend buttons
      var delBtns = list.querySelectorAll('.btn-unfriend');
      for (var k = 0; k < delBtns.length; k++) {
        delBtns[k].addEventListener('click', function () {
          if (!confirm('确定删除此好友？')) return;
          api('/api/friends/' + this.dataset.id, { method: 'DELETE' }).then(function () { renderFriends(); });
        });
      }
    });
  }

  function showAddFriendModal() {
    var html =
      '<h3>添加好友</h3>' +
      '<label>搜索用户</label><input type="text" id="searchUser" placeholder="输入用户名搜索">' +
      '<div id="searchResults" style="margin-top:12px;"></div>' +
      '<div class="actions" style="margin-top:16px;"><button class="btn-ghost" id="btnSearchCancel">关闭</button></div>';
    var overlay = showModal(html);

    overlay.querySelector('#btnSearchCancel').addEventListener('click', function () { overlay.remove(); });

    var searchInput = overlay.querySelector('#searchUser');
    var timer;
    searchInput.addEventListener('input', function () {
      clearTimeout(timer);
      var q = searchInput.value.trim();
      if (!q) { document.getElementById('searchResults').innerHTML = ''; return; }
      timer = setTimeout(function () {
        api('/api/users/search?q=' + encodeURIComponent(q)).then(function (users) {
          var resultsDiv = document.getElementById('searchResults');
          if (!resultsDiv) return;
          if (!users || users.length === 0) { resultsDiv.innerHTML = '<div style="color:#bbb;font-size:12px;">未找到用户</div>'; return; }
          var html = '';
          for (var i = 0; i < users.length; i++) {
            var u = users[i];
            if (currentUser && u._id === currentUser._id) continue;
            html += '<div class="friend-card"><div class="friend-info"><span class="friend-name">' + esc(u.nickname || u.username) + '</span></div>' +
              '<button class="btn btn-sm btn-send-req" data-id="' + u._id + '">添加</button></div>';
          }
          resultsDiv.innerHTML = html || '<div style="color:#bbb;font-size:12px;">未找到用户</div>';

          var btns = resultsDiv.querySelectorAll('.btn-send-req');
          for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', function () {
              var id = this.dataset.id;
              this.textContent = '发送中...'; this.disabled = true;
              api('/api/friends/request', { method: 'POST', body: { to: id } }).then(function (r) {
                if (r.error) { alert(r.error); this.textContent = '添加'; this.disabled = false; return; }
                overlay.remove();
                renderFriends();
                updateNotifBadge();
              }.bind(this));
            }.bind(btns[j]));
          }
        });
      }, 300);
    });
  }

  // ===== Chat =====
  var activeChatId = null;
  var chatMessages = [];
  var chatPartnerName = '';

  function openChatWindow(partnerId, partnerName) {
    window.location.hash = '#/chat/' + partnerId;
  }

  function renderChatPage(partnerId) {
    if (!token) { showLoginModal(function () { renderChatPage(partnerId); }); return; }

    // Clear previous chat state when entering a new chat
    if (activeChatId && activeChatId !== partnerId) {
      chatMessages = [];
    }
    activeChatId = partnerId;
    chatMessages = [];
    chatPartnerName = '';

    var app = document.getElementById('app');
    app.innerHTML =
      '<div style="display:flex;flex-direction:column;height:100dvh;overflow:hidden;">' +
        '<div style="flex-shrink:0;display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;">' +
          '<a class="back-link" href="#/friends" style="margin-bottom:0;">← 返回</a>' +
          '<span style="font-weight:600;font-size:15px;margin-left:12px;" id="chatPartnerLabel">加载中...</span>' +
        '</div>' +
        '<div class="chat-messages-full" id="chatMsgsFull" style="flex:1;overflow-y:auto;padding:12px 0;-webkit-overflow-scrolling:touch;">' +
          '<div class="loading">加载中...</div>' +
        '</div>' +
        '<div class="chat-typing" id="chatTypingFull" style="flex-shrink:0;height:18px;font-size:11px;color:#bbb;padding:0;"></div>' +
        '<div class="chat-input-area" style="flex-shrink:0;padding:6px 0;border-top:1px solid #f0f0f0;display:flex;gap:6px;align-items:center;">' +
          '<label class="chat-file-btn" title="发送图片或文件">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>' +
            '<input type="file" id="chatFileInput" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.7z,.txt,.mp3,.mp4" style="display:none;">' +
          '</label>' +
          '<input type="text" id="chatInputFull" placeholder="输入消息..." style="flex:1;padding:8px 10px;border:1px solid #e8e8e8;border-radius:6px;font-size:14px;outline:none;font-family:inherit;background:#fafafa;">' +
          '<button class="btn btn-primary" id="chatSendFull" style="flex:none;">发送</button>' +
        '</div>' +
        '<div id="chatUploadPreview" style="flex-shrink:0;font-size:11px;color:#999;padding:2px 0;"></div>' +
      '</div>';

    // Load user info
    api('/api/users/' + partnerId).then(function (user) {
      if (user.username) {
        chatPartnerName = user.nickname || user.username;
        window._partnerAv = user.avatar || '';
        document.getElementById('chatPartnerLabel').textContent = chatPartnerName;
      }
    });

    // Load history (marks as read server-side)
    api('/api/chat/' + partnerId + '/messages').then(function (msgs) {
      chatMessages = msgs || [];
      renderChatMessagesFull();
      // Clear unread badge for this friend
      if (socket) socket.emit('chat:read', { senderId: partnerId });
      updateFriendBadge();
    });

    // Bind events
    document.getElementById('chatSendFull').addEventListener('click', function () { sendChatMessageFull(); });
    var input = document.getElementById('chatInputFull');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessageFull(); }
    });
    input.addEventListener('input', function () {
      if (socket) socket.emit('chat:typing', { receiverId: partnerId });
    });
    input.focus();

    // File input
    document.getElementById('chatFileInput').addEventListener('change', function () {
      handleChatFileUpload(this);
    });

    // Socket handlers are set up globally in setupSocket()
  }

  function renderChatMessagesFull() {
    var msgsDiv = document.getElementById('chatMsgsFull');
    if (!msgsDiv) return;
    var msgs = chatMessages || [];
    var myAv = (currentUser && currentUser.avatar) || '';
    var html = '';
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var isMine = currentUser && (m.sender === currentUser._id || (m.sender.toString && m.sender.toString() === currentUser._id.toString()));
      var avUrl = isMine ? myAv : (window._partnerAv || '');
      var avLetter = isMine ? ((currentUser.nickname || currentUser.username || '?').charAt(0).toUpperCase()) : (chatPartnerName || '?').charAt(0).toUpperCase();
      var profileHref = isMine ? '#/profile/me' : '#/profile/' + activeChatId;
      var avHtml = avUrl ? '<a href="' + profileHref + '" class="chat-avatar" onclick="event.stopPropagation()"><img src="' + esc(avUrl) + '"></a>' : '<a href="' + profileHref + '" class="chat-avatar" onclick="event.stopPropagation()">' + avLetter + '</a>';

      html += '<div class="chat-msg-row' + (isMine ? ' mine' : '') + '">';
      html += avHtml;
      html += '<div class="chat-msg ' + (isMine ? 'mine' : 'theirs') + (m.sending ? ' sending' : '') + '">';
      if (m.content) html += '<div class="chat-text">' + esc(m.content) + '</div>';
      if (m.attachments && m.attachments.length > 0) {
        html += '<div class="chat-attach">';
        for (var j = 0; j < m.attachments.length; j++) {
          var a = m.attachments[j];
          if (a.type === 'image') {
            html += '<div style="position:relative;display:inline-block;">';
            html += '<img src="' + esc(a.url) + '" style="max-width:240px;max-height:180px;border-radius:8px;display:block;margin:4px 0;' + (m.sending ? 'opacity:0.6;' : 'cursor:pointer;') + '" ' + (m.sending ? '' : 'class="img-clickable" data-src="' + esc(a.url) + '"') + '>';
            if (m.sending) {
              html += '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);"><span class="spinner"></span></div>';
            }
            html += '</div>';
          } else {
            html += '<a href="' + esc(a.url) + '" download style="display:flex;align-items:center;gap:4px;padding:6px 10px;background:rgba(255,255,255,0.2);border-radius:6px;font-size:12px;">📎 ' + esc(a.filename) + ' (' + formatSize(a.size) + ')</a>';
          }
        }
        html += '</div>';
      }
      html += '<div class="time">' + (m.sending ? '<span class="spinner" style="width:10px;height:10px;display:inline-block;"></span> 发送中...' : timeAgo(m.createdAt)) + '</div>';
      html += '</div></div>';
    }
    msgsDiv.innerHTML = html || '<div style="text-align:center;color:#ccc;font-size:13px;padding:40px;">开始聊天吧</div>';
    msgsDiv.scrollTop = msgsDiv.scrollHeight;

    var imgs = msgsDiv.querySelectorAll('.img-clickable');
    for (var k = 0; k < imgs.length; k++) {
      imgs[k].addEventListener('click', function () { showImageModal(this.dataset.src); });
    }
  }

  function sendChatMessageFull() {
    var input = document.getElementById('chatInputFull');
    if (!input) return;
    var content = input.value.trim();
    if (!content) return;
    if (!socket || !socket.connected) { alert('连接已断开，请刷新页面'); return; }

    socket.emit('chat:send', { receiverId: activeChatId, content: content }, function (resp) {
      if (resp.ok) {
        input.value = '';
        chatMessages.push(resp.message);
        renderChatMessagesFull();
      } else {
        alert(resp.error || '发送失败');
      }
    });
  }

  function handleChatFileUpload(fileInput) {
    var files = fileInput.files;
    if (!files || files.length === 0) return;

    if (!socket || !socket.connected) {
      if (token) setupSocket();
      alert('连接已断开，请稍后重试');
      return;
    }
    if (!activeChatId) return;

    for (var i = 0; i < files.length; i++) {
      (function (file, idx) {
        if (file.size > 50 * 1024 * 1024) { alert('文件过大（最大50MB）'); return; }

        var tempId = 'sending_' + Date.now() + '_' + idx;
        var isImg = file.type && file.type.indexOf('image/') === 0;

        if (isImg) {
          var reader = new FileReader();
          reader.onerror = function () { alert('无法读取文件'); };
          reader.onload = function (e) {
            chatMessages.push({
              _id: tempId, sender: currentUser._id, content: '',
              attachments: [{ type: 'image', url: e.target.result, filename: file.name }],
              createdAt: new Date().toISOString(), sending: true
            });
            renderChatMessagesFull();
          };
          reader.readAsDataURL(file);
        }

        // Upload file (resize if image)
        function doUpload(uploadFile) {
          var fd = new FormData();
          fd.append('files', uploadFile, file.name);
          api('/api/upload', { method: 'POST', body: fd }).then(function (r) {
            if (r.error || !r.files || !r.files.length) { removeTempMsg(tempId); alert(r.error || '上传失败'); return; }
            var f = r.files[0];
            socket.emit('chat:send', {
              receiverId: activeChatId,
              content: isImg ? '' : ('[文件] ' + f.filename),
              attachments: [{ filename: f.filename, storedName: f.storedName, mimetype: f.mimetype, size: f.size, url: f.url, thumbUrl: f.thumbUrl, type: f.type }]
            }, function (resp) {
              removeTempMsg(tempId);
              if (resp.ok) {
                chatMessages.push(resp.message);
                renderChatMessagesFull();
              } else {
                alert(resp.error || '发送失败');
              }
            });
          }).catch(function (e) { removeTempMsg(tempId); alert('网络错误'); });
        }

        if (isImg) {
          resizeImage(file, 1200, 1200, 0.75, function (blob) {
            doUpload(blob || file);
          });
        } else {
          doUpload(file);
        }
      })(files[i], i);
    }
    fileInput.value = '';
  }

  function removeTempMsg(tempId) {
    if (!chatMessages) return;
    var found = false;
    for (var i = 0; i < chatMessages.length; i++) {
      if (chatMessages[i]._id === tempId) { found = true; break; }
    }
    if (!found) return;
    chatMessages = chatMessages.filter(function (m) { return m._id !== tempId; });
    renderChatMessagesFull();
  }

  // ===== Notifications =====
  function renderNotifications() {
    if (!token) { showLoginModal(function () { renderNotifications(); }); return; }

    var app = document.getElementById('app');
    app.innerHTML =
      '<div class="page-header"><h2>通知</h2>' +
      '<div style="display:flex;gap:8px;">' +
        (isAdmin() ? '<button class="btn btn-sm" id="btnAnnManage">管理公告</button>' : '') +
        '<button class="btn btn-sm" id="btnReadAll">全部已读</button>' +
      '</div></div>' +
      '<div id="notifList"><div class="loading">加载中...</div></div>';

    var btnAnn = document.getElementById('btnAnnManage');
    if (btnAnn) btnAnn.addEventListener('click', function () { showForumAnnounceModal(); });

    document.getElementById('btnReadAll').addEventListener('click', function () {
      api('/api/notifications/read', { method: 'PUT', body: { all: true } }).then(function () {
        renderNotifications();
        updateNotifBadge();
      });
    });

    api('/api/notifications').then(function (list) {
      var div = document.getElementById('notifList');
      if (!div) return;
      if (!list || list.length === 0) {
        div.innerHTML = '<div class="empty">暂无通知</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        var actorName = n.actor ? (n.actor.nickname || n.actor.username) : '';
        html += '<div class="notif-card' + (n.read ? ' read' : '') + '"' + (n.post ? ' data-post="' + n.post + '"' : '') + '>' +
          '<div class="notif-dot"></div>' +
          '<div class="notif-body">' + esc(n.message) +
            '<div class="notif-time">' + timeAgo(n.createdAt) + '</div>' +
          '</div></div>';
      }
      div.innerHTML = html;

      // Click to go to post
      div.querySelectorAll('.notif-card').forEach(function (card) {
        if (card.dataset.post) {
          card.style.cursor = 'pointer';
          card.addEventListener('click', function () { window.location.hash = '#/post/' + this.dataset.post; });
        }
      });
    });
  }

  // ===== Profile =====
  function renderProfile(userId) {
    if (!userId) return;
    var app = document.getElementById('app');

    api('/api/users/' + userId).then(function (user) {
      if (user.error) { app.innerHTML = '<div class="empty">' + esc(user.error) + '</div>'; return; }

      var isMe = currentUser && currentUser._id === userId;
      var isFriend = currentUser && friendsList.some(function (f) { return f._id === userId; });

      var html =
        '<div class="profile-header">' +
          '<div class="profile-avatar">' +
            (user.avatar ? '<img src="' + esc(user.avatar) + '" alt="">' : (user.nickname || user.username || '').charAt(0).toUpperCase()) +
          '</div>' +
          '<div>' +
            '<div class="profile-name">' + esc(user.nickname || user.username) + (user.role === 'super_admin' || user.role === 'poor_admin' ? ' <span class="admin-badge">管理员</span>' : '') + '</div>' +
            '<div class="profile-bio">' + esc(user.bio || '这个人很懒，什么都没写') + '</div>' +
            '<div style="font-size:12px;color:#bbb;margin-top:4px;">' +
              (user.postCount || 0) + ' 帖子 · ' + (user.commentCount || 0) + ' 评论 · ' + (user.friendCount || 0) + ' 好友' +
            '</div>' +
          '</div>' +
        '</div>';

      if (isMe) {
        html += '<button class="btn btn-sm" id="btnEditProfile" style="margin-bottom:20px;">编辑资料</button>';
      }
      if (isAdmin() && !isMe) {
        html += '<button class="btn btn-sm" id="btnManageBlocks" data-uid="' + userId + '" style="margin-bottom:20px;">管理屏蔽</button>';
      }
      if (!isMe && token) {
        if (!isFriend) {
          html += '<button class="btn btn-sm" id="btnAddFriendProfile" data-id="' + userId + '" style="margin-bottom:20px;">添加好友</button>';
        } else {
          html += '<button class="btn btn-sm btn-chat" data-id="' + userId + '" data-name="' + esc(user.nickname || user.username) + '" style="margin-bottom:20px;">私聊</button>';
        }
      }

      html += '<div id="userPosts"><div class="loading">加载中...</div></div>';
      app.innerHTML = html;

      // Edit profile
      var btnEdit = document.getElementById('btnEditProfile');
      if (btnEdit) btnEdit.addEventListener('click', function () { showEditProfileModal(user); });

      // Manage blocks (admin)
      var btnBlocks = document.getElementById('btnManageBlocks');
      if (btnBlocks) btnBlocks.addEventListener('click', function () {
        showBlockManageModal(this.dataset.uid);
      });

      // Add friend
      var btnAdd = document.getElementById('btnAddFriendProfile');
      if (btnAdd) btnAdd.addEventListener('click', function () {
        api('/api/friends/request', { method: 'POST', body: { to: userId } }).then(function (r) {
          if (r.error) { alert(r.error); return; }
          alert('好友请求已发送');
          renderProfile(userId);
        });
      });

      // Chat
      var btnChat = document.querySelector('.btn-chat');
      if (btnChat) btnChat.addEventListener('click', function () {
        openChatWindow(this.dataset.id, this.dataset.name);
      });

      // Load user's posts
      api('/api/posts?author=' + userId).then(function (data) {
        var div = document.getElementById('userPosts');
        if (!div) return;
        if (!data.posts || data.posts.length === 0) {
          div.innerHTML = '<div class="empty" style="font-size:13px;">暂无帖子</div>';
          return;
        }
        var html = '';
        for (var i = 0; i < data.posts.length; i++) {
          var p = data.posts[i];
          html += '<div class="post-card" style="cursor:pointer;" data-id="' + p._id + '">' +
            '<div class="post-meta">' +
              '<span class="post-vis ' + p.visibility + '">' + getVisLabel(p.visibility) + '</span>' +
              '<span class="post-date">' + timeAgo(p.createdAt) + '</span>' +
            '</div>' +
            '<div class="post-title">' + esc(p.title) + '</div>' +
            '<div class="post-footer"><span>' + (p.commentCount || 0) + ' 评论</span></div>' +
          '</div>';
        }
        div.innerHTML = html;
        div.querySelectorAll('.post-card').forEach(function (card) {
          card.addEventListener('click', function () { window.location.hash = '#/post/' + this.dataset.id; });
        });
      });
    }).catch(function () { app.innerHTML = '<div class="empty">加载失败</div>'; });
  }

  function showEditProfileModal(user) {
    var avatarUrl = user.avatar || '';
    var html =
      '<h3>编辑资料</h3>' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">' +
        '<div style="width:48px;height:48px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:20px;color:#bbb;" id="avatarPreview">' +
          (avatarUrl ? '<img src="' + esc(avatarUrl) + '" style="width:100%;height:100%;object-fit:cover;">' : (user.nickname || user.username || '').charAt(0).toUpperCase()) +
        '</div>' +
        '<input type="file" id="editAvatar" accept="image/*" style="font-size:12px;color:#999;">' +
      '</div>' +
      '<label>昵称</label><input type="text" id="editNickname" value="' + esc(user.nickname || '') + '" placeholder="留空则使用用户名">' +
      '<label>简介</label><textarea id="editBio" style="min-height:80px;" placeholder="写一句话介绍自己...">' + esc(user.bio || '') + '</textarea>' +
      '<div class="error" id="editErr"></div>' +
      '<div class="actions">' +
        '<button class="btn-ghost" id="btnEditCancel">取消</button>' +
        '<button class="btn-primary" id="btnEditSave">保存</button>' +
      '</div>';
    var overlay = showModal(html);

    // Avatar preview on file select
    overlay.querySelector('#editAvatar').addEventListener('change', function () {
      var file = this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        var prev = overlay.querySelector('#avatarPreview');
        prev.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover;">';
      };
      reader.readAsDataURL(file);
    });

    overlay.querySelector('#btnEditCancel').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('#btnEditSave').addEventListener('click', function () {
      var nickname = overlay.querySelector('#editNickname').value.trim();
      var bio = overlay.querySelector('#editBio').value.trim();
      var avatarFile = overlay.querySelector('#editAvatar').files[0];
      var err = overlay.querySelector('#editErr');
      if (bio.length > 200) { err.textContent = '简介最多200字'; err.style.display = 'block'; return; }
      var btn = overlay.querySelector('#btnEditSave');
      btn.textContent = '保存中...'; btn.disabled = true;

      function doSave(newAvatarUrl) {
        var body = { nickname: nickname || null, bio: bio };
        if (newAvatarUrl) body.avatar = newAvatarUrl;
        api('/api/users/profile', { method: 'PUT', body: body }).then(function (r) {
          if (r.error) { err.textContent = r.error; err.style.display = 'block'; btn.textContent = '保存'; btn.disabled = false; return; }
          overlay.remove();
          loadMe(function () {
            updateNav();
            renderProfile(currentUser._id);
          });
        });
      }

      if (avatarFile) {
        var fd = new FormData();
        fd.append('files', avatarFile);
        api('/api/upload', { method: 'POST', body: fd }).then(function (r) {
          if (r.error || !r.files || !r.files.length) { err.textContent = '头像上传失败'; err.style.display = 'block'; btn.textContent = '保存'; btn.disabled = false; return; }
          doSave(r.files[0].url);
        }).catch(function () { err.textContent = '头像上传失败'; err.style.display = 'block'; btn.textContent = '保存'; btn.disabled = false; });
      } else {
        doSave(null);
      }
    });
  }

  // ===== Image Modal =====
  function showImageModal(src) {
    var overlay = document.createElement('div');
    overlay.className = 'img-modal-overlay';
    overlay.innerHTML = '<div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:12px;">' +
      '<img class="img-modal" src="' + esc(src) + '">' +
      '<a href="' + esc(src) + '" download style="color:#fff;font-size:13px;padding:8px 20px;border:1px solid rgba(255,255,255,0.3);border-radius:6px;text-decoration:none;transition:all 0.15s;" onmouseover="this.style.background=\'rgba(255,255,255,0.1)\'" onmouseout="this.style.background=\'transparent\'">⬇ 下载原图</a>' +
    '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }

  // ===== Helpers =====
  function formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // ===== Admin: Block Management =====
  function showBlockManageModal(targetUserId) {
    api('/api/users/' + targetUserId).then(function (user) {
      var blockedIds = user.blockedUsers || [];
      var name = user.nickname || user.username;

      var html =
        '<h3>管理屏蔽 — ' + esc(name) + '</h3>' +
        '<p style="font-size:12px;color:#999;margin-bottom:14px;">被屏蔽的用户将无法被 ' + esc(name) + ' 看到（帖子、搜索、好友请求）</p>' +
        '<label>搜索用户添加屏蔽</label><input type="text" id="blockSearch" placeholder="输入用户名搜索...">' +
        '<div id="blockSearchResults" style="margin:8px 0;max-height:150px;overflow-y:auto;"></div>' +
        '<div style="font-weight:600;font-size:12px;margin-top:14px;color:#333;">当前屏蔽列表</div>' +
        '<div id="blockList" style="margin:8px 0;max-height:150px;overflow-y:auto;"></div>' +
        '<div class="actions">' +
          '<button class="btn-ghost" id="btnBlockClose">关闭</button>' +
        '</div>';
      var overlay = showModal(html, true);

      // Render current block list
      renderBlockList(targetUserId, blockedIds);

      // Search
      var searchTimer;
      overlay.querySelector('#blockSearch').addEventListener('input', function () {
        clearTimeout(searchTimer);
        var q = this.value.trim();
        if (!q) { document.getElementById('blockSearchResults').innerHTML = ''; return; }
        searchTimer = setTimeout(function () {
          api('/api/users/search?q=' + encodeURIComponent(q)).then(function (users) {
            var div = document.getElementById('blockSearchResults');
            if (!div) return;
            if (!users || users.length === 0) { div.innerHTML = '<div style="font-size:11px;color:#bbb;">无结果</div>'; return; }
            var h = '';
            for (var i = 0; i < users.length; i++) {
              var u = users[i];
              if (u._id === targetUserId || blockedIds.indexOf(u._id) !== -1) continue;
              h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:12px;">' +
                '<span>' + esc(u.nickname || u.username) + '</span>' +
                '<button class="btn-sm btn-block-add" data-id="' + u._id + '">屏蔽</button>' +
              '</div>';
            }
            div.innerHTML = h || '<div style="font-size:11px;color:#bbb;">无结果</div>';
            div.querySelectorAll('.btn-block-add').forEach(function (btn) {
              btn.addEventListener('click', function () {
                var addId = this.dataset.id;
                api('/api/admin/users/' + targetUserId + '/blocked', { method: 'PUT', body: { add: [addId] } }).then(function (r) {
                  if (r.error) { alert(r.error); return; }
                  blockedIds.push(addId);
                  renderBlockList(targetUserId, blockedIds);
                  document.getElementById('blockSearchResults').innerHTML = '';
                  overlay.querySelector('#blockSearch').value = '';
                });
              });
            });
          });
        }, 300);
      });

      overlay.querySelector('#btnBlockClose').addEventListener('click', function () { overlay.remove(); });
    });
  }

  function renderBlockList(userId, blockedIds) {
    var div = document.getElementById('blockList');
    if (!div) return;
    if (blockedIds.length === 0) { div.innerHTML = '<div style="font-size:11px;color:#bbb;">无屏蔽用户</div>'; return; }
    // Load usernames for all blocked IDs
    var h = '<div style="font-size:11px;color:#bbb;margin-bottom:4px;">加载中...</div>';
    div.innerHTML = h;
    // Load each user
    var loaded = 0;
    var users = [];
    if (blockedIds.length === 0) { div.innerHTML = '<div style="font-size:11px;color:#bbb;">无屏蔽用户</div>'; return; }
    for (var i = 0; i < blockedIds.length; i++) {
      (function (idx, bid) {
        api('/api/users/' + bid).then(function (u) {
          users[idx] = u;
          loaded++;
          if (loaded === blockedIds.length) {
            var listHtml = '';
            for (var j = 0; j < users.length; j++) {
              var u = users[j];
              if (!u || u.error) continue;
              listHtml += '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:12px;">' +
                '<span>' + esc(u.nickname || u.username) + '</span>' +
                '<button class="btn-sm btn-block-remove" data-id="' + u._id + '" style="color:#e55;">取消屏蔽</button>' +
              '</div>';
            }
            div.innerHTML = listHtml || '<div style="font-size:11px;color:#bbb;">无屏蔽用户</div>';
            div.querySelectorAll('.btn-block-remove').forEach(function (btn) {
              btn.addEventListener('click', function () {
                var removeId = this.dataset.id;
                api('/api/admin/users/' + userId + '/blocked', { method: 'PUT', body: { remove: [removeId] } }).then(function (r) {
                  if (r.error) { alert(r.error); return; }
                  var idx = blockedIds.indexOf(removeId);
                  if (idx > -1) blockedIds.splice(idx, 1);
                  renderBlockList(userId, blockedIds);
                });
              });
            });
          }
        });
      })(i, blockedIds[i]);
    }
  }

  // ===== Fast Upload: Thumbnail first, original in background =====
  function resizeImage(file, maxW, maxH, quality, callback) {
    if (!file.type || !file.type.match(/image\//)) { callback(null, file); return; }
    var reader = new FileReader();
    reader.onerror = function () { callback(null, file); };
    reader.onload = function (e) {
      var img = new Image();
      img.onerror = function () { callback(null, file); };
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w <= maxW && h <= maxH) { callback(null, file); return; }
        var ratio = Math.min(maxW / w, maxH / h);
        var cw = Math.round(w * ratio), ch = Math.round(h * ratio);
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        canvas.toBlob(function (blob) {
          callback(blob || file, file);
        }, 'image/jpeg', quality || 0.65);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function resizeAndUpload(files, callback) {
    if (files.length === 0) { callback([]); return; }
    var results = [];
    var done = 0;
    for (var i = 0; i < files.length; i++) {
      (function (file, idx) {
        resizeImage(file, 800, 800, 0.7, function (blob, original) {
          results[idx] = { blob: blob || original, name: file.name, original: original, isImage: !!blob };
          done++;
          if (done === files.length) callback(results);
        });
      })(files[i], i);
    }
  }

  function uploadOriginals(postId, commentId, rawFiles, thumbResults) {
    if (!rawFiles || rawFiles.length === 0) return;
    // Find thumb → original mapping by filename
    var toUpload = [];
    for (var i = 0; i < thumbResults.length; i++) {
      var tr = thumbResults[i];
      if (tr.isImage && tr.original && tr.original.size > 50000) {
        // Only re-upload if original is significantly different (>50KB)
        for (var j = 0; j < rawFiles.length; j++) {
          if (rawFiles[j].name === tr.name && rawFiles[j].size > tr.blob.size) {
            toUpload.push({ thumbIdx: i, originalFile: rawFiles[j], thumbName: tr.name });
            break;
          }
        }
      }
    }
    if (toUpload.length === 0) return;

    for (var k = 0; k < toUpload.length; k++) {
      (function (item) {
        var fd = new FormData();
        fd.append('files', item.originalFile);
        api('/api/upload', { method: 'POST', body: fd }).then(function (r) {
          if (r.error || !r.files || !r.files.length) return;
          var origInfo = r.files[0];
          // Find the stored name from the thumbnail that matches this file
          // We need to match by filename - the post API returned attachments in order
          // Actually we need the storedName from the post response
          // For now, use the original uploaded url to update
          // The server uses UUID names so we can't match by filename
          // Instead, just update any attachment that has thumbUrl but not the full original
          if (!postId) return;
          api('/api/posts/' + postId, { method: 'GET' }).then(function (post) {
            if (!post.attachments) return;
            for (var a = 0; a < post.attachments.length; a++) {
              var att = post.attachments[a];
              if (att.type === 'image' && att.filename === item.thumbName) {
                // Update attachment URL to the full original
                api('/api/posts/' + postId + '/attachment/' + att.storedName, {
                  method: 'PUT',
                  body: { url: origInfo.url, size: origInfo.size }
                });
                break;
              }
            }
          });
        });
      })(toUpload[k]);
    }
  }

  // ===== Init =====
  // ===== Notice Bar =====
  function loadNotice() {
    fetch('/api/forum-announcements?limit=1')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.length > 0) {
          var bar = document.getElementById('noticeBar');
          bar.classList.add('show');
          document.getElementById('noticeTitle').textContent = data[0].title;
          bar.onclick = function () { window.location.hash = '#/notifications'; };
          var nav = document.getElementById('topNav');
          nav.classList.add('notice-active');
        }
      })
      .catch(function () {});
  }

  function showForumAnnounceModal() {
    if (!isAdmin()) return;
    var html =
      '<h3>管理论坛公告</h3>' +
      '<div id="announceList" style="margin-bottom:16px;max-height:200px;overflow-y:auto;"><div class="loading">加载中...</div></div>' +
      '<label>标题</label><input type="text" id="annTitle" placeholder="公告标题">' +
      '<label>内容</label><textarea id="annContent" placeholder="公告内容" style="min-height:80px;"></textarea>' +
      '<div class="error" id="annErr"></div>' +
      '<div class="actions">' +
        '<button class="btn-ghost" id="btnAnnCancel">关闭</button>' +
        '<button class="btn-primary" id="btnAnnPublish">发布</button>' +
      '</div>';
    var overlay = showModal(html, true);

    // Load existing
    fetch('/api/forum-announcements?limit=10')
      .then(function (r) { return r.json(); })
      .then(function (list) {
        var div = document.getElementById('announceList');
        if (!div) return;
        if (!list || list.length === 0) { div.innerHTML = '<div style="color:#bbb;font-size:12px;">暂无公告</div>'; return; }
        var h = '';
        for (var i = 0; i < list.length; i++) {
          h += '<div style="padding:6px 0;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="font-size:12px;">' + esc(list[i].title) + '</span>' +
            '<button class="btn-danger btn-del-ann" data-id="' + list[i]._id + '" style="font-size:10px;">删除</button>' +
          '</div>';
        }
        div.innerHTML = h;
        div.querySelectorAll('.btn-del-ann').forEach(function (btn) {
          btn.addEventListener('click', function () {
            fetch('/api/forum-announcements/' + this.dataset.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } })
              .then(function () { overlay.remove(); showForumAnnounceModal(); });
          });
        });
      });

    overlay.querySelector('#btnAnnCancel').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('#btnAnnPublish').addEventListener('click', function () {
      var title = overlay.querySelector('#annTitle').value.trim();
      var content = overlay.querySelector('#annContent').value.trim();
      var err = overlay.querySelector('#annErr');
      if (!title || !content) { err.textContent = '请填写标题和内容'; err.style.display = 'block'; return; }
      var btn = overlay.querySelector('#btnAnnPublish');
      btn.textContent = '发布中...'; btn.disabled = true;
      fetch('/api/forum-announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ title: title, content: content })
      }).then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.error) { err.textContent = d.error; err.style.display = 'block'; btn.textContent = '发布'; btn.disabled = false; return; }
          overlay.remove();
          loadNotice();
        }).catch(function () { btn.textContent = '发布'; btn.disabled = false; });
    });
  }

  function init() {
    updateNav();
    loadNotice();

    // Load Socket.io client dynamically
    var script = document.createElement('script');
    script.src = '/chat/socket.io/socket.io.js';
    script.onload = function () {
      if (token) setupSocket();
    };
    document.head.appendChild(script);

    // Start rendering immediately, load profile + badges in background
    if (token) {
      navigate();
      loadMe(function () {
        updateNav();
        updateNotifBadge();
        updateFriendBadge();
      });
    } else {
      navigate();
    }
  }

  // Expose for inline calls
  window.showLoginModal = showLoginModal;
  window.showRegisterModal = showRegisterModal;

  // ===== Setting Page =====
  function renderSetting() {
    var app = document.getElementById('app');
    var token = getToken();
    if (!token) {
      app.innerHTML = '<div class="page-header"><h2>设置</h2></div><p style="color:#999;text-align:center;padding:40px">请先<a href="javascript:showLoginModal()" style="color:#333">登录</a></p>';
      return;
    }

    app.innerHTML = '<div class="page-header"><h2>机器人设置</h2></div><div id="settingContent"><div class="loading">加载中…</div></div>';

    fetch('/api/bot', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var bot = data.bot;
        var isAdmin = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'poor_admin');
        var html = '';

        if (!bot) {
          html += renderCreateForm();
        } else {
          html += renderBotCard(bot);
          html += renderEditForm(bot);
          html += renderTokenStats(bot);
          html += '<div class="setting-actions"><button class="btn btn-primary" onclick="triggerPost()">立即发帖</button> <button class="btn btn-danger" onclick="deleteBot()">删除机器人</button></div>';
        }

        if (isAdmin) {
          html += renderAdminPanel();
        }

        document.getElementById('settingContent').innerHTML = html;

        if (isAdmin) {
          loadAdminBots();
        }
      })
      .catch(function (e) {
        document.getElementById('settingContent').innerHTML = '<p class="err">加载失败: ' + e.message + '</p>';
      });
  }

  function renderCreateForm() {
    return '<div class="setting-card">' +
      '<h3>创建你的机器人</h3>' +
      '<p style="color:#999;font-size:13px;margin-bottom:20px">机器人会追踪你的 Uniflourish 对话，用 AI 生成文章自动发布到论坛。密码默认与用户名相同。</p>' +
      '<div class="form-group"><label>机器人用户名</label><input id="botUsername" class="input" placeholder="输入机器人用户名"></div>' +
      '<div class="form-group"><label>发帖间隔（分钟）</label><input id="postInterval" class="input" type="number" value="60" min="5"></div>' +
      '<div class="form-group"><label>AI 模型</label><select id="aiModel" class="input"><option value="deepseek-chat">DeepSeek Chat</option></select></div>' +
      '<div class="form-group">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
          '<input type="checkbox" id="useSystemKey" checked onchange="document.getElementById(\'customKeyGroup\').style.display=this.checked?\'none\':\'block\'"> 使用系统 API Key（每日限额 100 万 token）' +
        '</label>' +
      '</div>' +
      '<div class="form-group" id="customKeyGroup" style="display:none"><label>自备 API Key</label><input id="aiApiKey" class="input" placeholder="sk-..."></div>' +
      '<div class="form-group"><label>夜间静默（可选）</label><div style="display:flex;gap:8px;align-items:center"><input id="quietStart" class="input" type="time" style="width:auto;flex:1"><span style="color:#999;font-size:13px">至</span><input id="quietEnd" class="input" type="time" style="width:auto;flex:1"></div></div>' +
      '<div class="form-group"><label>可见范围</label><select id="visibility" class="input"><option value="public">公开</option><option value="logged_in">仅登录用户</option><option value="friends">仅好友</option><option value="private">仅自己</option></select></div>' +
      '<button class="btn btn-primary" onclick="createBot()">创建机器人</button>' +
    '</div>';
  }

  function renderBotCard(bot) {
    var statusLabel = bot.enabled ? '<span style="color:#22c55e">运行中</span>' : '<span style="color:#ef4444">已暂停</span>';
    var lastPost = bot.lastPostTime ? new Date(bot.lastPostTime).toLocaleString('zh-CN') : '尚未发帖';
    var intervalLabel = '每 ' + bot.postInterval + ' 分钟';
    var keyLabel = bot.useSystemKey ? '系统 Key' : '自备 Key';
    return '<div class="setting-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:start">' +
        '<div><h3>' + esc(bot.botUsername) + '</h3></div>' +
        '<div style="text-align:right"><div style="font-size:20px;font-weight:700">' + statusLabel + '</div><div style="color:#999;font-size:11px">' + intervalLabel + ' | ' + keyLabel + '</div></div>' +
      '</div>' +
      '<div style="margin-top:12px;font-size:12px;color:#999">上次发帖: ' + lastPost + ' | 共 ' + (bot.totalPosts || 0) + ' 篇</div>' +
      (bot.lastError ? '<div style="margin-top:8px;font-size:12px;color:#ef4444">错误: ' + esc(bot.lastError) + '</div>' : '') +
    '</div>';
  }

  function renderEditForm(bot) {
    return '<div class="setting-card">' +
      '<h3>修改配置</h3>' +
      '<div class="form-group"><label>发帖间隔（分钟）</label><input id="editInterval" class="input" type="number" value="' + (bot.postInterval || 60) + '" min="5"></div>' +
      '<div class="form-group"><label>状态</label><select id="editEnabled" class="input"><option value="1"' + (bot.enabled ? ' selected' : '') + '>启用</option><option value="0"' + (bot.enabled ? '' : ' selected') + '>暂停</option></select></div>' +
      '<div class="form-group"><label>夜间静默</label><div style="display:flex;gap:8px;align-items:center"><input id="editQuietStart" class="input" type="time" value="' + (bot.quietStart || '') + '" style="width:auto;flex:1"><span style="color:#999;font-size:13px">至</span><input id="editQuietEnd" class="input" type="time" value="' + (bot.quietEnd || '') + '" style="width:auto;flex:1"></div><span style="font-size:11px;color:#999">留空则不限制。如 23:00 至 07:00</span></div>' +
      '<div class="form-group"><label>可见范围</label><select id="editVisibility" class="input"><option value="public"' + ((bot.visibility || 'public') === 'public' ? ' selected' : '') + '>公开（所有人可见）</option><option value="logged_in"' + (bot.visibility === 'logged_in' ? ' selected' : '') + '>仅登录用户</option><option value="friends"' + (bot.visibility === 'friends' ? ' selected' : '') + '>仅好友</option><option value="private"' + (bot.visibility === 'private' ? ' selected' : '') + '>仅自己</option></select></div>' +
      '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
        '<input type="checkbox" id="editUseSystemKey"' + (bot.useSystemKey ? ' checked' : '') + ' onchange="document.getElementById(\'editCustomKeyGroup\').style.display=this.checked?\'none\':\'block\'"> 使用系统 Key</label></div>' +
      '<div class="form-group" id="editCustomKeyGroup" style="' + (bot.useSystemKey ? 'display:none' : '') + '"><label>自备 API Key</label><input id="editApiKey" class="input" value="' + esc(bot.aiApiKey || '') + '" placeholder="sk-..."></div>' +
      '<button class="btn btn-primary" onclick="updateBot()">保存修改</button>' +
    '</div>';
  }

  function renderTokenStats(bot) {
    var tu = bot.tokenUsage || {};
    var todayTotal = (tu.todayPrompt || 0) + (tu.todayCompletion || 0);
    var monthTotal = (tu.monthPrompt || 0) + (tu.monthCompletion || 0);
    var allTotal = (tu.totalPrompt || 0) + (tu.totalCompletion || 0);
    return '<div class="setting-card">' +
      '<h3>Token 消耗</h3>' +
      '<div class="token-grid">' +
        '<div class="token-item"><div class="token-num">' + formatTokenNum(todayTotal) + '</div><div class="token-label">今日</div></div>' +
        '<div class="token-item"><div class="token-num">' + formatTokenNum(monthTotal) + '</div><div class="token-label">本月</div></div>' +
        '<div class="token-item"><div class="token-num">' + formatTokenNum(allTotal) + '</div><div class="token-label">总计</div></div>' +
      '</div>' +
    '</div>';
  }

  function renderAdminPanel() {
    return '<div class="setting-card" style="border-color:#333">' +
      '<h3 style="color:#333">[管理员] 全局管理</h3>' +
      '<div class="form-group"><label>系统每日 Token 限额</label><input id="sysDailyLimit" class="input" type="number" value="1000000"> <button class="btn" onclick="updateSystemSettings()">保存</button></div>' +
      '<div id="adminBotList" style="margin-top:16px"><div class="loading">加载中…</div></div>' +
    '</div>';
  }

  function loadAdminBots() {
    fetch('/api/admin/bots', { headers: { 'Authorization': 'Bearer ' + getToken() } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var bots = data.bots || [];
        var html = '<h4 style="margin-bottom:12px">所有机器人 (' + bots.length + ')</h4>';
        if (bots.length === 0) { html += '<p style="color:#999;font-size:13px">暂无</p>'; }
        else {
          bots.forEach(function (b) {
            var ownerName = b.owner ? b.owner.username : '?';
            var status = b.enabled ? '<span style="color:#22c55e">●</span>' : '<span style="color:#ef4444">●</span>';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px">' +
              '<div>' + status + ' <strong>' + esc(b.botUsername) + '</strong> <span style="color:#999">(' + ownerName + ' / ' + b.postInterval + 'min / ' + (b.totalPosts || 0) + '篇)</span></div>' +
              '<div><button class="btn-sm" onclick="adminToggleBot(\'' + b._id + '\',' + b.enabled + ')">' + (b.enabled ? '暂停' : '启用') + '</button> <button class="btn-sm btn-danger" onclick="adminDeleteBot(\'' + b._id + '\')">删除</button></div>' +
            '</div>';
          });
        }
        document.getElementById('adminBotList').innerHTML = html;
      })
      .catch(function (e) {
        document.getElementById('adminBotList').innerHTML = '<p class="err">加载失败: ' + e.message + '</p>';
      });
  }

  // ===== Setting Page Actions =====
  function createBot() {
    var username = document.getElementById('botUsername').value.trim();
    var interval = parseInt(document.getElementById('postInterval').value) || 60;
    var useSystemKey = document.getElementById('useSystemKey').checked;
    var aiApiKey = document.getElementById('aiApiKey').value.trim();
    var aiModel = document.getElementById('aiModel').value;
    var quietStart = document.getElementById('quietStart').value.trim();
    var quietEnd = document.getElementById('quietEnd').value.trim();
    var visibility = document.getElementById('visibility').value;

    if (!username) { alert('请填写机器人用户名'); return; }
    if (interval < 5) { alert('间隔最少 5 分钟'); return; }
    if (!useSystemKey && !aiApiKey) { alert('请填写自备 API Key'); return; }

    fetch('/api/bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
      body: JSON.stringify({ botUsername: username, postInterval: interval, useSystemKey: useSystemKey, aiApiKey: aiApiKey, aiModel: aiModel, quietStart: quietStart, quietEnd: quietEnd, visibility: visibility })
    }).then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { alert(data.error); return; }
        alert('机器人创建成功！');
        renderSetting();
      }).catch(function (e) { alert('失败: ' + e.message); });
  }

  function updateBot() {
    var interval = parseInt(document.getElementById('editInterval').value) || 60;
    var enabled = document.getElementById('editEnabled').value === '1';
    var useSystemKey = document.getElementById('editUseSystemKey').checked;
    var aiApiKey = document.getElementById('editApiKey').value.trim();
    var quietStart = document.getElementById('editQuietStart').value.trim();
    var quietEnd = document.getElementById('editQuietEnd').value.trim();
    var visibility = document.getElementById('editVisibility').value;

    fetch('/api/bot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
      body: JSON.stringify({ postInterval: interval, enabled: enabled, useSystemKey: useSystemKey, aiApiKey: aiApiKey, quietStart: quietStart, quietEnd: quietEnd, visibility: visibility })
    }).then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { alert(data.error); return; }
        alert('配置已更新！');
        renderSetting();
      }).catch(function (e) { alert('失败: ' + e.message); });
  }

  function triggerPost() {
    if (!confirm('确认立即触发发帖？')) return;
    fetch('/api/bot/trigger', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() }
    }).then(function (r) { return r.json(); })
      .then(function (data) { alert(data.error || data.message); })
      .catch(function (e) { alert('失败: ' + e.message); });
  }

  function deleteBot() {
    if (!confirm('确认删除机器人？此操作不可恢复。')) return;
    fetch('/api/bot', {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + getToken() }
    }).then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { alert(data.error); return; }
        alert('已删除');
        renderSetting();
      }).catch(function (e) { alert('失败: ' + e.message); });
  }

  function formatTokenNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
    return String(n || 0);
  }

  // Admin actions
  function adminToggleBot(id, enabled) {
    fetch('/api/admin/bots/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
      body: JSON.stringify({ enabled: !enabled })
    }).then(function (r) { return r.json(); })
      .then(function () { renderSetting(); })
      .catch(function (e) { alert('失败: ' + e.message); });
  }

  function adminDeleteBot(id) {
    if (!confirm('确认删除此机器人？')) return;
    fetch('/api/admin/bots/' + id, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + getToken() }
    }).then(function (r) { return r.json(); })
      .then(function () { renderSetting(); })
      .catch(function (e) { alert('失败: ' + e.message); });
  }

  function updateSystemSettings() {
    var limit = parseInt(document.getElementById('sysDailyLimit').value) || 1000000;
    fetch('/api/admin/bots/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
      body: JSON.stringify({ dailyTokenLimit: limit })
    }).then(function (r) { return r.json(); })
      .then(function () { alert('设置已保存'); })
      .catch(function (e) { alert('失败: ' + e.message); });
  }

  // Expose for inline onclick
  window.createBot = createBot;
  window.updateBot = updateBot;
  window.triggerPost = triggerPost;
  window.deleteBot = deleteBot;
  window.adminToggleBot = adminToggleBot;
  window.adminDeleteBot = adminDeleteBot;
  window.updateSystemSettings = updateSystemSettings;

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
