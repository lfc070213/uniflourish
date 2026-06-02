// ================= Socket.io 聊天服务器 =================
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const ChatMessage = require('./models/ChatMessage');
const User = require('./models/User');
const Notification = require('./models/Notification');

const SECRET = 'UNIFLOURISH_SECRET_2026';

function setupChatSocket(httpServer) {
  const io = new Server(httpServer, {
    path: '/chat/socket.io',
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  // Auth middleware
  io.use(function (socket, next) {
    var token = socket.handshake.auth.token;
    if (!token) return next(new Error('请先登录'));
    try {
      var decoded = jwt.verify(token, SECRET);
      socket.userId = decoded.uid;
      socket.username = decoded.username;
      socket.userRole = decoded.role || 'user';
      next();
    } catch (e) {
      next(new Error('登录已过期'));
    }
  });

  // Online tracking: userId -> Set of socket IDs
  var onlineUsers = new Map();

  io.on('connection', function (socket) {
    var userId = socket.userId.toString();

    // Track online
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    // Join personal room for notification pushes
    socket.join('user:' + userId);

    // Broadcast online status to friends
    broadcastFriendStatus(socket, userId, true);

    // Update lastActive
    User.findByIdAndUpdate(userId, { lastActive: new Date() }).catch(function () { });

    // --- Send message ---
    socket.on('chat:send', async function (data, callback) {
      callback = callback || function () { };
      try {
        var receiverId = data.receiverId;
        if (!receiverId) return callback({ ok: false, error: '缺少接收者' });

        // Validate friendship
        var user = await User.findById(userId);
        var isFriend = user && user.friends.some(function (f) { return f.toString() === receiverId; });
        if (!isFriend) return callback({ ok: false, error: '还不是好友，无法发送消息' });

        var content = data.content || '';
        var attachments = data.attachments || [];

        var message = await ChatMessage.create({
          sender: userId,
          receiver: receiverId,
          content: content,
          attachments: attachments
        });

        var payload = {
          _id: message._id,
          sender: userId,
          senderName: socket.username,
          content: content,
          attachments: attachments,
          createdAt: message.createdAt
        };

        // Send to receiver
        io.to('user:' + receiverId).emit('chat:message', payload);
        // Confirm to sender
        callback({ ok: true, message: payload });
      } catch (e) {
        callback({ ok: false, error: e.message });
      }
    });

    // --- Typing ---
    socket.on('chat:typing', function (data) {
      var receiverId = data.receiverId;
      if (receiverId) {
        io.to('user:' + receiverId).emit('chat:typing', { userId: userId });
      }
    });

    // --- Mark read ---
    socket.on('chat:read', function (data) {
      var senderId = data.senderId;
      if (senderId) {
        ChatMessage.updateMany(
          { sender: senderId, receiver: userId, read: false },
          { read: true }
        ).catch(function () { });
      }
    });

    // --- Disconnect ---
    socket.on('disconnect', function () {
      var sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          broadcastFriendStatus(socket, userId, false);
        }
      }
    });
  });

  // --- Broadcast friend online/offline ---
  async function broadcastFriendStatus(socket, userId, online) {
    try {
      var user = await User.findById(userId);
      if (!user || !user.friends) return;
      for (var i = 0; i < user.friends.length; i++) {
        io.to('user:' + user.friends[i].toString()).emit('friend:online', {
          userId: userId,
          online: online
        });
      }
    } catch (e) { /* silent */ }
  }

  // Export for use by forum-routes to push notifications
  io.pushNotification = async function (recipientId, notification) {
    try {
      var notif = await Notification.create(notification);
      var populated = await Notification.findById(notif._id)
        .populate('actor', 'username nickname avatar');
      io.to('user:' + recipientId).emit('notification', populated);
    } catch (e) { /* silent */ }
  };

  return io;
}

module.exports = setupChatSocket;
