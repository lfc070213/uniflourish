// 本地 SMTP 转发器 — 拦截 Haraka 出站 25，通过标准 SMTP 转发到 Resend
const net = require('net');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');

const transporter = nodemailer.createTransport({
  host: 'smtp.resend.com', port: 587,
  auth: { user: 'resend', pass: process.env.RESEND_API_KEY || '' }
});

net.createServer((client) => {
  let buf = '', mailfrom = '', rcpt = '', dataAcc = [];
  let inData = false;
  const addr = client.remoteAddress + ':' + client.remotePort;
  console.log('CONN', addr);

  client.write('220 local-relay ESMTP\r\n');

  client.on('data', (chunk) => {
    buf += chunk.toString();
    while (buf.includes('\n')) {
      const idx = buf.indexOf('\n');
      const rawLine = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const line = rawLine.replace(/\r$/, '');

      if (inData) {
        if (line === '.') {
          inData = false;
          const rawEmail = dataAcc.join('\r\n') + '\r\n';
          // Parse and forward properly via nodemailer
          simpleParser(rawEmail, (err, parsed) => {
            if (err) {
              console.log('PARSE FAIL', addr, err.message);
              client.write('550 Parse error\r\n');
              return;
            }
            const html = parsed.html || false;
            const text = parsed.text || (html ? '' : ' '); // Resend requires non-empty content
            transporter.sendMail({
              from: parsed.from?.text || mailfrom,
              to: parsed.to?.text || rcpt,
              subject: parsed.subject || '',
              text: text,
              html: html || undefined,
              attachments: parsed.attachments || []
            }).then(() => {
              client.write('250 OK\r\n');
              console.log('OK', rcpt);
            }).catch(e => {
              client.write('550 ' + e.message + '\r\n');
              console.log('FAIL', rcpt, e.message);
            });
          });
          dataAcc = [];
        } else {
          dataAcc.push(line.startsWith('..') ? line.slice(1) : line);
        }
        continue;
      }

      const u = line.toUpperCase();
      if (u.startsWith('EHLO') || u.startsWith('HELO') || u.startsWith('RSET')) client.write('250 OK\r\n');
      else if (u.startsWith('MAIL FROM:')) { mailfrom = line.replace(/^MAIL FROM:\s*/i, '').replace(/[<>]/g, '').trim(); client.write('250 OK\r\n'); }
      else if (u.startsWith('RCPT TO:')) { rcpt = line.replace(/^RCPT TO:\s*/i, '').replace(/[<>]/g, '').trim(); client.write('250 OK\r\n'); }
      else if (u === 'DATA') { inData = true; dataAcc = []; client.write('354 Go ahead\r\n'); }
      else if (u === 'QUIT') { client.write('221 Bye\r\n'); client.end(); }
      else client.write('250 OK\r\n');
    }
  });
  client.on('error', (e) => console.log('ERR', addr, e.message));
}).listen(2525, '127.0.0.1', () => console.log('Local relay ready on 127.0.0.1:2525'));
