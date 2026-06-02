// SMTP 发件中继 — 跑在阿里云，接收 PKU 发来的邮件，用干净 IPv4 发出
const net = require('net');

const LISTEN_PORT = 2525;

const server = net.createServer((clientSocket) => {
  let clientBuf = '';
  let targetSocket = null;
  let targetBuf = '';

  clientSocket.on('data', (data) => {
    clientBuf += data.toString();

    if (!targetSocket && clientBuf.includes('\r\n')) {
      // Parse initial SMTP greeting — extract the first EHLO/HELO
      // We just connect to the real destination when we see RCPT TO
      const lines = clientBuf.split('\r\n');
      clientSocket.write('220 smtp-relay.uniflourish.top ESMTP Ready\r\n');
    }

    if (targetSocket) {
      targetSocket.write(data);
    }
  });

  // Actually, this approach is too complex for a simple TCP proxy.
  // Let me use a different approach: transparent TCP forward.
  clientSocket.write('220 smtp-relay.uniflourish.top ESMTP Ready\r\n');
  clientSocket.on('close', () => { if (targetSocket) targetSocket.end(); });
  clientSocket.on('error', () => { if (targetSocket) targetSocket.destroy(); });
});

server.listen(LISTEN_PORT, '100.80.125.20', () => {
  console.log('SMTP relay listening on 100.80.125.20:' + LISTEN_PORT);
});
