#!/usr/bin/env python3
"""SMTP 发件中继 — 标准 SMTP 协议，接收后通过阿里云干净 IPv4 投递"""
import smtplib, sys, os, subprocess, socket, threading, time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 2500
HOST = '100.80.125.20'

def get_mx(domain):
    try:
        out = subprocess.check_output(['host', '-t', 'MX', domain], timeout=5, text=True)
        records = []
        for line in out.strip().split('\n'):
            if 'mail exchanger' in line:
                parts = line.split()
                pref = int(parts[-2]) if len(parts) >= 2 else 10
                mx = parts[-1].rstrip('.')
                records.append((pref, mx))
        records.sort()
        return [r[1] for r in records]
    except:
        return [domain]

def handle_client(conn, addr):
    mailfrom = None
    rcpt = None
    data_lines = []
    in_data = False
    start = time.time()
    try:
        print(f'CONN {addr}', flush=True)
        conn.sendall(b'220 relay.uniflourish.top ESMTP\r\n')
        buf = b''
        while time.time() - start < 60:
            chunk = conn.recv(4096)
            if not chunk: break
            buf += chunk
            while b'\n' in buf:
                idx = buf.index(b'\n')
                line = buf[:idx].rstrip(b'\r').decode('utf-8', errors='replace')
                buf = buf[idx+1:]

                if in_data:
                    if line == '.':
                        # End of data — deliver
                        email_text = '\r\n'.join(data_lines) + '\r\n'
                        domain = rcpt.split('@')[1] if rcpt and '@' in rcpt else ''
                        if not domain:
                            conn.sendall(b'550 Invalid recipient\r\n')
                            break
                        mxs = get_mx(domain)
                        ok = False
                        for mx in mxs:
                            try:
                                with smtplib.SMTP(mx, 25, timeout=30) as s:
                                    s.sendmail(mailfrom, [rcpt], email_text)
                                print(f'OK {rcpt} via {mx}', flush=True)
                                conn.sendall(b'250 OK\r\n')
                                ok = True
                                break
                            except Exception as e:
                                print(f'TRY {mx}: {e}', flush=True)
                        if not ok:
                            print(f'FAIL {rcpt}', flush=True)
                            conn.sendall(b'550 Failed to deliver\r\n')
                        in_data = False
                        data_lines = []
                    else:
                        data_lines.append(line)
                    continue

                upper = line.upper()
                if upper.startswith('EHLO') or upper.startswith('HELO'):
                    conn.sendall(b'250 OK\r\n')
                elif upper.startswith('MAIL FROM:'):
                    mailfrom = line[10:].strip().strip('<>')
                    conn.sendall(b'250 OK\r\n')
                elif upper.startswith('RCPT TO:'):
                    rcpt = line[8:].strip().strip('<>')
                    conn.sendall(b'250 OK\r\n')
                elif upper.startswith('DATA'):
                    in_data = True
                    data_lines = []
                    conn.sendall(b'354 End data with <CR><LF>.<CR><LF>\r\n')
                elif upper.startswith('QUIT'):
                    conn.sendall(b'221 Bye\r\n')
                    break
                elif upper.startswith('RSET'):
                    mailfrom = None; rcpt = None
                    conn.sendall(b'250 OK\r\n')
                else:
                    conn.sendall(b'500 Unknown\r\n')
    except Exception as e:
        print(f'ERR {addr}: {e}', flush=True)
    finally:
        conn.close()
        print(f'DONE {addr}', flush=True)

def main():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((HOST, PORT))
    s.listen(50)
    print(f'RELAY READY {HOST}:{PORT} PID={os.getpid()}', flush=True)
    while True:
        conn, addr = s.accept()
        threading.Thread(target=handle_client, args=(conn, addr), daemon=True).start()

if __name__ == '__main__':
    main()
