#!/bin/bash
# Deploy Uniflourish Web + Status + yingchaorobot to server
set -e

SERVER="ubuntu@yc.tailb5e8d2.ts.net"
TARGET="/home/ubuntu/uniflourish-server"
SRC="/Users/lifuchun/cx/uniflourish"
PM2=/home/ubuntu/.npm-global/lib/node_modules/pm2/bin/pm2

echo "=== Deploying Uniflourish ==="

# 1. Upload built web app
echo "[1/6] Uploading web app..."
ssh $SERVER "mkdir -p $TARGET/uniflourish-app"
scp -r $SRC/dist-web/* $SERVER:$TARGET/uniflourish-app/

# 2. Upload status page
echo "[2/6] Uploading status page..."
scp $SRC/status.html $SERVER:$TARGET/uniflourish-app/

# 3. Upload updated server index.js
echo "[3/6] Uploading server index.js..."
scp $SRC/server/index.js $SERVER:$TARGET/
scp $SRC/server/forum-routes.js $SERVER:$TARGET/
scp $SRC/server/forum-socket.js $SERVER:$TARGET/
scp $SRC/server/models/*.js $SERVER:$TARGET/models/
scp $SRC/server/middleware/*.js $SERVER:$TARGET/middleware/

# 4. Upload yingchaorobot
echo "[4/6] Uploading yingchaorobot..."
scp $SRC/server/yingchaorobot.js $SERVER:$TARGET/
scp $SRC/server/yingchaorobot-state.json $SERVER:$TARGET/

# 5. Restart main server
echo "[5/6] Restarting uniflourish-server..."
ssh $SERVER "$PM2 restart uniflourish-server"

# 6. Start/restart yingchaorobot
echo "[6/6] Starting yingchaorobot..."
ssh $SERVER "cd $TARGET && $PM2 delete yingchaorobot 2>/dev/null; $PM2 start yingchaorobot.js --name yingchaorobot --log-date-format 'YYYY-MM-DD HH:mm:ss' && $PM2 save"

echo ""
echo "=== Done! ==="
echo "App:     https://yc.tailb5e8d2.ts.net/uniflourish/"
echo "Status:  https://yc.tailb5e8d2.ts.net/uniflourish/status"
echo "Forum:   https://yc.tailb5e8d2.ts.net/forum/"
echo "Bot log: ssh $SERVER \"$PM2 logs yingchaorobot --lines 20\""
