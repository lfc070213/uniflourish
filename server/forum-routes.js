// ================= 论坛 API 路由 =================
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const { requireUser, requireAdmin, optionalAuth } = require('./middleware/auth');
const User = require('./models/User');
const ForumPost = require('./models/ForumPost');
const ForumComment = require('./models/ForumComment');
const FriendRequest = require('./models/FriendRequest');
const ChatMessage = require('./models/ChatMessage');
const Notification = require('./models/Notification');
const BotConfig = require('./models/BotConfig');
const sharp = require('sharp');

// Forum Announcement
const ForumAnnouncementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  author: { type: String, required: true },
}, { timestamps: true });
const ForumAnnouncement = mongoose.model('ForumAnnouncement', ForumAnnouncementSchema);

// ================= 论坛公告 =================
router.get('/forum-announcements', async function (req, res) {
  try {
    var limit = parseInt(req.query.limit) || 50;
    var list = await ForumAnnouncement.find().sort({ createdAt: -1 }).limit(limit);
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/forum-announcements', requireAdmin, async function (req, res) {
  try {
    var { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
    var a = await ForumAnnouncement.create({ title, content, author: req.username });
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/forum-announcements/:id', requireAdmin, async function (req, res) {
  try {
    var { title, content } = req.body;
    var a = await ForumAnnouncement.findByIdAndUpdate(
      req.params.id, { title, content, updatedAt: new Date() }, { new: true }
    );
    if (!a) return res.status(404).json({ error: '公告不存在' });
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/forum-announcements/:id', requireAdmin, async function (req, res) {
  try {
    await ForumAnnouncement.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 文件上传 =================
const UPLOAD_DIR = '/data/uploads';
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif', '.bmp',
  '.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.rar', '.7z', '.mp3', '.ogg', '.wav', '.mp4', '.webm', '.mov'];

const ALLOWED_MIMES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/bmp',
  'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
  'audio/mpeg', 'audio/ogg', 'audio/wav',
  'video/mp4', 'video/webm', 'video/quicktime'
];

const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, UPLOAD_DIR); },
  filename: function (req, file, cb) {
    var ext = path.extname(file.originalname);
    var name = crypto.randomUUID() + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB server-side cap
  fileFilter: function (req, file, cb) {
    var ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIMES.indexOf(file.mimetype) !== -1 || ALLOWED_EXT.indexOf(ext) !== -1) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型: ' + (file.mimetype || ext)));
    }
  }
});

router.post('/upload', requireUser, upload.array('files', 10), async function (req, res) {
  var files = [];
  for (var i = 0; i < (req.files || []).length; i++) {
    var f = req.files[i];
    var isImage = f.mimetype.indexOf('image/') === 0;
    var fileInfo = {
      filename: f.originalname,
      storedName: f.filename,
      mimetype: f.mimetype,
      size: f.size,
      url: '/uploads/' + f.filename,
      type: isImage ? 'image' : 'file'
    };

    // Generate thumbnail for images
    if (isImage) {
      try {
        var thumbName = 'thumb_' + f.filename;
        await sharp(f.path)
          .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 65 })
          .toFile(UPLOAD_DIR + '/' + thumbName);
        fileInfo.thumbUrl = '/uploads/' + thumbName;
      } catch (e) {
        // If thumbnail fails, use original
        fileInfo.thumbUrl = fileInfo.url;
      }
    }

    files.push(fileInfo);
  }
  res.json({ files: files });
});

// ================= 用户搜索 & 资料 =================
router.get('/users/search', requireUser, async function (req, res) {
  try {
    var q = req.query.q || '';
    var me = await User.findById(req.userId);
    var blockedIds = (me && me.blockedUsers) ? me.blockedUsers : [];
    var filter = {
      $or: [
        { username: { $regex: q, $options: 'i' } },
        { nickname: { $regex: q, $options: 'i' } }
      ]
    };
    if (blockedIds.length > 0) {
      filter._id = { $nin: blockedIds };
    }
    var users = await User.find(filter).select('username nickname avatar').limit(20);
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/users/:id', optionalAuth, async function (req, res) {
  try {
    var user = await User.findById(req.params.id).select('username nickname avatar bio friendCount postCount commentCount lastActive role');
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/profile', requireUser, async function (req, res) {
  try {
    var { nickname, bio, avatar } = req.body;
    var update = {};
    if (nickname !== undefined) update.nickname = nickname;
    if (bio !== undefined) update.bio = bio;
    if (avatar !== undefined) update.avatar = avatar;
    await User.findByIdAndUpdate(req.userId, update);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 好友系统 =================
router.get('/friends', requireUser, async function (req, res) {
  try {
    var user = await User.findById(req.userId).populate('friends', 'username nickname avatar lastActive');
    res.json(user.friends || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/friends/requests', requireUser, async function (req, res) {
  try {
    var sent = await FriendRequest.find({ from: req.userId, status: 'pending' }).populate('to', 'username nickname avatar');
    var received = await FriendRequest.find({ to: req.userId, status: 'pending' }).populate('from', 'username nickname avatar');
    res.json({ sent: sent, received: received });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/friends/request', requireUser, async function (req, res) {
  try {
    var toId = req.body.to;
    if (!toId) return res.status(400).json({ error: '请指定用户' });
    if (toId === req.userId.toString()) return res.status(400).json({ error: '不能添加自己为好友' });

    // 检查是否已经是好友
    var currentUser = await User.findById(req.userId);
    if (currentUser.friends.some(function (f) { return f.toString() === toId; })) {
      return res.status(400).json({ error: '已经是好友' });
    }

    // 检查是否有 pending 请求
    var existing = await FriendRequest.findOne({
      from: req.userId, to: toId, status: 'pending'
    });
    if (existing) return res.status(400).json({ error: '已发送过好友请求' });

    // 对方是否已向我发送请求（双向检查）
    var reverse = await FriendRequest.findOne({
      from: toId, to: req.userId, status: 'pending'
    });
    if (reverse) return res.status(400).json({ error: '对方已向你发送好友请求，请先处理' });

    var message = req.body.message || '';
    var fr = await FriendRequest.create({ from: req.userId, to: toId, message: message });

    // 通知
    var fromUser = await User.findById(req.userId);
    await Notification.create({
      recipient: toId, type: 'friend_request', actor: req.userId,
      message: (fromUser.nickname || fromUser.username) + ' 请求添加你为好友'
    });

    res.json({ success: true, request: fr });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/friends/request/:id/accept', requireUser, async function (req, res) {
  try {
    var fr = await FriendRequest.findById(req.params.id);
    if (!fr) return res.status(404).json({ error: '请求不存在' });
    if (fr.to.toString() !== req.userId.toString()) return res.status(403).json({ error: '无权操作' });
    if (fr.status !== 'pending') return res.status(400).json({ error: '请求已处理' });

    fr.status = 'accepted';
    fr.updatedAt = new Date();
    await fr.save();

    // 双向加好友
    await User.findByIdAndUpdate(fr.from, { $addToSet: { friends: fr.to }, $inc: { friendCount: 1 } });
    await User.findByIdAndUpdate(fr.to, { $addToSet: { friends: fr.from }, $inc: { friendCount: 1 } });

    // 通知发起方
    var toUser = await User.findById(req.userId);
    await Notification.create({
      recipient: fr.from, type: 'friend_accepted', actor: req.userId,
      message: (toUser.nickname || toUser.username) + ' 已接受你的好友请求'
    });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/friends/request/:id/reject', requireUser, async function (req, res) {
  try {
    var fr = await FriendRequest.findById(req.params.id);
    if (!fr) return res.status(404).json({ error: '请求不存在' });
    if (fr.to.toString() !== req.userId.toString()) return res.status(403).json({ error: '无权操作' });
    if (fr.status !== 'pending') return res.status(400).json({ error: '请求已处理' });

    fr.status = 'rejected';
    fr.updatedAt = new Date();
    await fr.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/friends/:userId', requireUser, async function (req, res) {
  try {
    var friendId = req.params.userId;
    // 双向删除
    await User.findByIdAndUpdate(req.userId, { $pull: { friends: friendId }, $inc: { friendCount: -1 } });
    await User.findByIdAndUpdate(friendId, { $pull: { friends: req.userId }, $inc: { friendCount: -1 } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 辅助：构建帖子可见性过滤 =================
function isAdmin(role) {
  return role === 'super_admin' || role === 'poor_admin';
}

function buildPostFilter(userId, userRole) {
  // 管理员看全部
  if (userId && isAdmin(userRole)) return {};

  if (!userId) return { visibility: 'public' };

  return {
    $or: [
      { visibility: 'public' },
      { visibility: 'logged_in' },
      { author: userId, visibility: 'private' },
      { visibility: 'friends', author: { $in: [userId] } }, // 自己的好友帖在下方单独处理
      { visibility: 'whitelist', visibleTo: userId },
      { visibility: 'blacklist', hiddenFrom: { $ne: userId } }
    ]
  };
}

// 扩展过滤：好友可见的帖子需要作者是当前用户的好友
async function expandFriendsFilter(baseFilter, userId) {
  if (!userId) return baseFilter;
  // Admin sees all — filter is {} empty object, return as-is
  if (!baseFilter.$or) return baseFilter;
  var user = await User.findById(userId);
  if (!user) return baseFilter;
  var friendIds = user.friends || [];

  var filter = JSON.parse(JSON.stringify(baseFilter));
  for (var i = 0; i < filter.$or.length; i++) {
    if (filter.$or[i].visibility === 'friends') {
      filter.$or[i].author.$in = friendIds.concat([userId]);
    }
  }
  return filter;
}

// ================= 帖子 CRUD =================
router.get('/posts', optionalAuth, async function (req, res) {
  try {
    var page = parseInt(req.query.page) || 1;
    var limit = Math.min(parseInt(req.query.limit) || 20, 50);
    var skip = (page - 1) * limit;

    var baseFilter = buildPostFilter(req.userId, req.userRole);
    var filter = await expandFriendsFilter(baseFilter, req.userId);

    // Exclude posts from blocked users
    if (req.userId) {
      var currentUser = await User.findById(req.userId);
      if (currentUser && currentUser.blockedUsers && currentUser.blockedUsers.length > 0) {
        if (!filter.$or) filter = { $and: [filter] };
        filter.author = filter.author || {};
        filter.author.$nin = currentUser.blockedUsers;
      }
    }

    // Author filtering (profile page)
    if (req.query.author) {
      filter.author = req.query.author;
    }

    // Tag filtering
    if (req.query.tag) {
      filter.tags = req.query.tag.toLowerCase();
    }

    var query = ForumPost.find(filter)
      .populate('author', 'username nickname avatar role')
      .sort({ isPinned: -1, createdAt: -1 })
      .skip(skip).limit(limit);

    var countQuery = ForumPost.countDocuments(filter);

    var [posts, total] = await Promise.all([query.exec(), countQuery.exec()]);
    res.json({ posts: posts, total: total, page: page, pages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/posts/:id', optionalAuth, async function (req, res) {
  try {
    var post = await ForumPost.findById(req.params.id)
      .populate('author', 'username nickname avatar role');
    if (!post) return res.status(404).json({ error: '帖子不存在' });

    // 可见性检查
    if (!canView(post, req.userId, req.userRole)) {
      return res.status(403).json({ error: '无权查看此帖' });
    }

    res.json(post);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/posts', requireUser, upload.array('files', 10), async function (req, res) {
  try {
    var { title, content, visibility, visibleTo, hiddenFrom } = req.body;
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });

    var attachments = (req.files || []).map(function (f) {
      return {
        filename: f.originalname, storedName: f.filename,
        mimetype: f.mimetype, size: f.size,
        url: '/uploads/' + f.filename,
        type: f.mimetype.indexOf('image/') === 0 ? 'image' : 'file'
      };
    });

    // Extract #tags from content
    var tagMatches = content.match(/#([\w一-鿿]+)/g) || [];
    var tags = tagMatches.map(function (t) { return t.replace('#', '').toLowerCase(); });
    // deduplicate
    tags = tags.filter(function (v, i) { return tags.indexOf(v) === i; });

    var postData = {
      author: req.userId, title: title, content: content,
      visibility: visibility || 'public',
      tags: tags,
      attachments: attachments
    };

    if (visibility === 'whitelist' && visibleTo) {
      postData.visibleTo = Array.isArray(visibleTo) ? visibleTo : JSON.parse(visibleTo);
    }
    if (visibility === 'blacklist' && hiddenFrom) {
      postData.hiddenFrom = Array.isArray(hiddenFrom) ? hiddenFrom : JSON.parse(hiddenFrom);
    }

    var post = await ForumPost.create(postData);
    await User.findByIdAndUpdate(req.userId, { $inc: { postCount: 1 }, lastActive: new Date() });

    // 通知好友（仅对 public/logged_in/friends 可见的帖子）
    if (visibility === 'public' || visibility === 'logged_in' || visibility === 'friends') {
      notifyFriendsNewPost(req.userId, post._id);
    }

    res.json(post);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/posts/:id', requireUser, upload.array('files', 10), async function (req, res) {
  try {
    var post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (post.author.toString() !== req.userId.toString()) return res.status(403).json({ error: '无权编辑' });

    var { title, content, visibility, visibleTo, hiddenFrom, keepAttachments } = req.body;
    var updates = { updatedAt: new Date() };
    if (title) updates.title = title;
    if (content) {
      updates.content = content;
      var tagMatches = content.match(/#([\w一-鿿]+)/g) || [];
      var tags = tagMatches.map(function (t) { return t.replace('#', '').toLowerCase(); });
      updates.tags = tags.filter(function (v, i) { return tags.indexOf(v) === i; });
    }
    if (visibility) updates.visibility = visibility;
    if (visibility === 'whitelist' && visibleTo) {
      updates.visibleTo = Array.isArray(visibleTo) ? visibleTo : JSON.parse(visibleTo);
    } else if (visibility === 'whitelist') {
      updates.visibleTo = [];
    }
    if (visibility === 'blacklist' && hiddenFrom) {
      updates.hiddenFrom = Array.isArray(hiddenFrom) ? hiddenFrom : JSON.parse(hiddenFrom);
    } else if (visibility === 'blacklist') {
      updates.hiddenFrom = [];
    }

    // 处理附件
    var kept = [];
    if (keepAttachments) {
      var keepIds = Array.isArray(keepAttachments) ? keepAttachments : JSON.parse(keepAttachments);
      kept = post.attachments.filter(function (a) { return keepIds.indexOf(a.storedName) !== -1; });
    }
    var newFiles = (req.files || []).map(function (f) {
      return {
        filename: f.originalname, storedName: f.filename,
        mimetype: f.mimetype, size: f.size,
        url: '/uploads/' + f.filename,
        type: f.mimetype.indexOf('image/') === 0 ? 'image' : 'file'
      };
    });
    updates.attachments = kept.concat(newFiles);

    var updated = await ForumPost.findByIdAndUpdate(req.params.id, updates, { new: true })
      .populate('author', 'username nickname avatar role');
    res.json(updated);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/posts/:id', requireUser, async function (req, res) {
  try {
    var post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });

    var isOwner = post.author.toString() === req.userId.toString();
    var isUserAdmin = isAdmin(req.userRole);
    // 检查是否是 post author 的 bot 的 owner
    var isBotOwner = false;
    if (!isOwner) {
      var postAuthor = await User.findById(post.author);
      if (postAuthor) {
        var botConfig = await BotConfig.findOne({ owner: req.userId, botUsername: postAuthor.username });
        if (botConfig) isBotOwner = true;
      }
    }
    if (!isOwner && !isUserAdmin && !isBotOwner) return res.status(403).json({ error: '无权删除' });

    // 级联删除评论和通知
    await ForumComment.deleteMany({ post: post._id });
    await Notification.deleteMany({ post: post._id });
    await ForumPost.findByIdAndDelete(req.params.id);

    // 更新用户计数
    await User.findByIdAndUpdate(post.author, { $inc: { postCount: -1 } });

    // 管理员删除记录日志
    if (!isOwner && isUserAdmin) {
      var AdminLog = mongoose.model('AdminLog');
      var authorUser = await User.findById(post.author);
      await AdminLog.create({
        adminUsername: req.username,
        action: '删除了论坛帖子: ' + (post.title || '').substring(0, 50),
        targetUser: authorUser ? authorUser.username : 'unknown',
        timestamp: new Date()
      });
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 管理员置顶/锁定
router.put('/posts/:id/pin', requireAdmin, async function (req, res) {
  try {
    var post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    post.isPinned = !post.isPinned;
    await post.save();
    res.json({ success: true, isPinned: post.isPinned });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/posts/:id/lock', requireAdmin, async function (req, res) {
  try {
    var post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    post.isLocked = !post.isLocked;
    await post.save();
    res.json({ success: true, isLocked: post.isLocked });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 可见性检查辅助函数 =================
function canView(post, userId, userRole) {
  if (isAdmin(userRole)) return true;
  if (post.visibility === 'public') return true;
  if (!userId) return false;
  if (post.author._id ? post.author._id.toString() === userId.toString() : post.author.toString() === userId.toString()) return true;
  if (post.visibility === 'logged_in') return true;
  if (post.visibility === 'whitelist') {
    return post.visibleTo.some(function (id) { return id.toString() === userId.toString(); });
  }
  if (post.visibility === 'blacklist') {
    return !post.hiddenFrom.some(function (id) { return id.toString() === userId.toString(); });
  }
  // friends: checked during post fetch with friend list - here we just return true since it passed the query filter
  if (post.visibility === 'friends') return true;
  if (post.visibility === 'private') return false;
  return false;
}

// ================= 附件更新（后台传原图） =================
router.put('/posts/:id/attachment/:storedName', requireUser, async function (req, res) {
  try {
    var post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (post.author.toString() !== req.userId.toString()) return res.status(403).json({ error: '无权操作' });
    var { url, size } = req.body;
    for (var i = 0; i < post.attachments.length; i++) {
      if (post.attachments[i].storedName === req.params.storedName) {
        if (url) post.attachments[i].url = url;
        if (size) post.attachments[i].size = size;
        await post.save();
        return res.json({ success: true });
      }
    }
    res.status(404).json({ error: '附件不存在' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/comments/:id/attachment/:storedName', requireUser, async function (req, res) {
  try {
    var comment = await ForumComment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: '评论不存在' });
    if (comment.author.toString() !== req.userId.toString()) return res.status(403).json({ error: '无权操作' });
    var { url, size } = req.body;
    for (var i = 0; i < comment.attachments.length; i++) {
      if (comment.attachments[i].storedName === req.params.storedName) {
        if (url) comment.attachments[i].url = url;
        if (size) comment.attachments[i].size = size;
        await comment.save();
        return res.json({ success: true });
      }
    }
    res.status(404).json({ error: '附件不存在' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 点赞 =================
router.put('/posts/:id/like', requireUser, async function (req, res) {
  try {
    var post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (!canView(post, req.userId, req.userRole)) return res.status(403).json({ error: '无权访问' });

    var idx = post.likes.findIndex(function (id) { return id.toString() === req.userId.toString(); });
    if (idx > -1) {
      post.likes.splice(idx, 1);
      post.likeCount = Math.max(0, post.likeCount - 1);
    } else {
      post.likes.push(req.userId);
      post.likeCount = (post.likeCount || 0) + 1;
    }
    await post.save();
    res.json({ liked: idx === -1, likeCount: post.likeCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 评论 CRUD =================
router.get('/posts/:id/comments', optionalAuth, async function (req, res) {
  try {
    var comments = await ForumComment.find({ post: req.params.id })
      .populate('author', 'username nickname avatar role')
      .sort({ createdAt: 1 });
    res.json(comments);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/posts/:id/comments', requireUser, upload.array('files', 10), async function (req, res) {
  try {
    var post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (post.isLocked && !isAdmin(req.userRole)) return res.status(403).json({ error: '帖子已锁定' });

    // 可见性检查
    if (!canView(post, req.userId, req.userRole)) {
      return res.status(403).json({ error: '无权评论此帖' });
    }

    var content = req.body.content;
    if (!content) return res.status(400).json({ error: '评论内容不能为空' });

    var attachments = (req.files || []).map(function (f) {
      return {
        filename: f.originalname, storedName: f.filename,
        mimetype: f.mimetype, size: f.size,
        url: '/uploads/' + f.filename,
        type: f.mimetype.indexOf('image/') === 0 ? 'image' : 'file'
      };
    });

    var comment = await ForumComment.create({
      post: post._id, author: req.userId,
      content: content, attachments: attachments
    });

    await ForumPost.findByIdAndUpdate(post._id, { $inc: { commentCount: 1 } });
    await User.findByIdAndUpdate(req.userId, { $inc: { commentCount: 1 }, lastActive: new Date() });

    // 通知帖主
    if (post.author.toString() !== req.userId.toString()) {
      var commentUser = await User.findById(req.userId);
      await Notification.create({
        recipient: post.author, type: 'new_comment', actor: req.userId,
        post: post._id, comment: comment._id,
        message: (commentUser.nickname || commentUser.username) + ' 评论了你的帖子: ' + (post.title || '').substring(0, 30)
      });
    }

    var populated = await ForumComment.findById(comment._id)
      .populate('author', 'username nickname avatar role');
    res.json(populated);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/comments/:id', requireUser, async function (req, res) {
  try {
    var comment = await ForumComment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: '评论不存在' });
    if (comment.author.toString() !== req.userId.toString()) return res.status(403).json({ error: '无权编辑' });

    var content = req.body.content;
    if (!content) return res.status(400).json({ error: '评论内容不能为空' });

    comment.content = content;
    comment.updatedAt = new Date();
    await comment.save();
    res.json(comment);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/comments/:id', requireUser, async function (req, res) {
  try {
    var comment = await ForumComment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: '评论不存在' });

    var isOwner = comment.author.toString() === req.userId.toString();
    var isUserAdmin = isAdmin(req.userRole);
    if (!isOwner && !isUserAdmin) return res.status(403).json({ error: '无权删除' });

    await ForumComment.findByIdAndDelete(req.params.id);
    await ForumPost.findByIdAndUpdate(comment.post, { $inc: { commentCount: -1 } });
    await User.findByIdAndUpdate(comment.author, { $inc: { commentCount: -1 } });
    await Notification.deleteMany({ comment: comment._id });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 通知 =================
router.get('/notifications', requireUser, async function (req, res) {
  try {
    var list = await Notification.find({ recipient: req.userId })
      .populate('actor', 'username nickname avatar')
      .sort({ createdAt: -1 }).limit(50);
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/notifications/read', requireUser, async function (req, res) {
  try {
    if (req.body.all) {
      await Notification.updateMany({ recipient: req.userId, read: false }, { read: true });
    } else if (req.body.ids && req.body.ids.length > 0) {
      await Notification.updateMany(
        { _id: { $in: req.body.ids }, recipient: req.userId },
        { read: true }
      );
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/notifications/unread-count', requireUser, async function (req, res) {
  try {
    var count = await Notification.countDocuments({ recipient: req.userId, read: false });
    res.json({ count: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 未读消息计数 =================
router.get('/chat/unread-count', requireUser, async function (req, res) {
  try {
    var count = await ChatMessage.countDocuments({ receiver: req.userId, read: false });
    res.json({ count: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/chat/unread-by-friend', requireUser, async function (req, res) {
  try {
    var result = await ChatMessage.aggregate([
      { $match: { receiver: new mongoose.Types.ObjectId(req.userId), read: false } },
      { $group: { _id: '$sender', count: { $sum: 1 } } }
    ]);
    var map = {};
    for (var i = 0; i < result.length; i++) {
      map[result[i]._id.toString()] = result[i].count;
    }
    res.json(map);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 聊天历史（HTTP） =================
router.get('/chat/:userId/messages', requireUser, async function (req, res) {
  try {
    var partnerId = req.params.userId;
    var messages = await ChatMessage.find({
      $or: [
        { sender: req.userId, receiver: partnerId },
        { sender: partnerId, receiver: req.userId }
      ]
    }).sort({ createdAt: -1 }).limit(50);

    // 标记为已读
    await ChatMessage.updateMany(
      { sender: partnerId, receiver: req.userId, read: false },
      { read: true }
    );

    res.json(messages.reverse());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/chat/conversations', requireUser, async function (req, res) {
  try {
    // 聚合查找最近的会话
    var conversations = await ChatMessage.aggregate([
      {
        $match: {
          $or: [{ sender: new mongoose.Types.ObjectId(req.userId) }, { receiver: new mongoose.Types.ObjectId(req.userId) }]
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            $cond: {
              if: { $eq: ['$sender', new mongoose.Types.ObjectId(req.userId)] },
              then: '$receiver',
              else: '$sender'
            }
          },
          lastMessage: { $first: '$content' },
          lastTime: { $first: '$createdAt' },
          unread: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$receiver', new mongoose.Types.ObjectId(req.userId)] }, { $eq: ['$read', false] }] }, 1, 0]
            }
          }
        }
      },
      { $sort: { lastTime: -1 } },
      {
        $lookup: {
          from: 'users', localField: '_id', foreignField: '_id',
          pipeline: [{ $project: { username: 1, nickname: 1, avatar: 1 } }],
          as: 'user'
        }
      },
      { $unwind: '$user' }
    ]);
    res.json(conversations);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 标签 =================
router.get('/tags', async function (req, res) {
  try {
    var tags = await ForumPost.aggregate([
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 30 }
    ]);
    res.json(tags);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 通知好友新帖 =================
async function notifyFriendsNewPost(authorId, postId) {
  try {
    var author = await User.findById(authorId);
    var friends = author.friends || [];
    var authorName = author.nickname || author.username;
    for (var i = 0; i < friends.length; i++) {
      await Notification.create({
        recipient: friends[i], type: 'new_friend_post', actor: authorId,
        post: postId,
        message: authorName + ' 发布了新帖子'
      });
    }
  } catch (e) { /* 静默失败 */ }
}

module.exports = router;
