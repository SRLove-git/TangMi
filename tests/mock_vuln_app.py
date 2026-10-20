"""测试用「故意有漏洞」的迷你 Web 应用（仅监听 127.0.0.1，供离线单测使用）。"""

from __future__ import annotations

import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


class MockVulnHandler(BaseHTTPRequestHandler):
    server_version = "MockVulnApp/1.0"

    def log_message(self, format, *args):  # noqa: A003
        return

    def _send(self, body: str, status: int = 200, content_type: str = "text/html; charset=utf-8", headers=None):
        payload = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        query = {key: values[0] for key, values in parse_qs(parsed.query).items()}
        if path == "/":
            body = """<html><head><title>Mock Vulnerable App</title></head><body>
            <h1>Mock Vuln App</h1>
            <a href="/search?q=test">search</a>
            <a href="/file?path=index.html">file</a>
            <a href="/redirect?url=/home">redirect</a>
            <a href="/echo?msg=hello">echo</a>
            <a href="/render?tpl=hello">render</a>
            <a href="/fetch?url=http://example.com">fetch</a>
            <form method="POST" action="/login">
              <input name="username" value="">
              <input name="password" type="password" value="">
              <button type="submit">Login</button>
            </form>
            <script src="/js/app.js"></script>
            </body></html>"""
            forwarded = self.headers.get("X-Forwarded-Host", "")
            if forwarded:
                body = body.replace("</body>", f"<!-- forwarded: {forwarded} --></body>")
            jwt = (
                "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0."
                "eyJ1c2VyIjoiYWRtaW4iLCJyb2xlIjoiYWRtaW4ifQ."
            )
            return self._send(body, headers={"Set-Cookie": f"session={jwt}; Path=/"})
        if path == "/render":
            tpl = query.get("tpl", "")
            match = re.search(r"(?:\{\{|\$\{|<%=|#\{)?\s*(\d+)\s*\*\s*(\d+)\s*(?:\}\}|\}|%>|\})?", tpl)
            if match:
                return self._send(f"<html><body>result: {int(match.group(1)) * int(match.group(2))}</body></html>")
            return self._send("<html><body>Hello</body></html>")
        if path == "/fetch":
            url = query.get("url", "")
            if url.startswith(("http://127.0.0.1", "http://localhost")):
                try:
                    import urllib.request

                    with urllib.request.urlopen(url, timeout=2) as response:  # noqa: S310
                        return self._send(f"fetched: {response.status}")
                except Exception as exc:  # noqa: BLE001
                    return self._send(f"fetch failed: {exc}")
            return self._send("blocked")
        if path == "/js/app.js":
            return self._send(
                'const API = "/api/users?id=1";\n'
                'const AWS_KEY = "AKIAABCDEFGHIJKLMNOP";\n'
                'const cfg = {apiKey: "AIzaSyA1234567890abcdefghijklmnopqrstu"};\n',
                content_type="application/javascript",
            )
        if path == "/api/users":
            return self._send('{"id": 1, "name": "admin", "email": "admin@example.com"}', content_type="application/json")
        if path == "/search":
            q = query.get("q", "")
            if "'" in q or '"' in q or "\\" in q:
                return self._send(
                    "You have an error in your SQL syntax; check the manual that corresponds "
                    "to your MySQL server version for the right syntax to use near ''' at line 1"
                )
            if "sleep(" in q.lower():
                time.sleep(0.5)
                return self._send("slow response")
            if "../../" in q or "/etc/passwd" in q:
                return self._send("root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin/nologin\n")
            if "echo px_rce" in q:
                # 模拟 shell 执行：支持 echo px_rce_$((a+b)) 的算术展开
                match = re.search(r"echo\s+px_rce_\$\(\((\d+)\+(\d+)\)\)", q)
                if match:
                    total = int(match.group(1)) + int(match.group(2))
                    return self._send(f"result: px_rce_{total}")
                marker = q.split("echo ", 1)[1]
                return self._send(f"result: {marker}")
            return self._send(f"<html><body>Results for {q}</body></html>")
        if path == "/echo":
            return self._send(f"<html><body><div>{query.get('msg', '')}</div></body></html>")
        if path == "/file":
            value = query.get("path", "")
            if "../../" in value or "/etc/passwd" in value:
                return self._send("root:x:0:0:root:/root:/bin/bash\n")
            return self._send("file not found")
        if path == "/redirect":
            target = query.get("url", "")
            if target.startswith(("//", "http")):
                return self._send("", status=302, headers={"Location": target})
            return self._send("home")
        if path == "/.env":
            return self._send("DB_PASSWORD=secret\nAPP_KEY=abcdef123456\n", content_type="text/plain")
        if path == "/.git/HEAD":
            return self._send("ref: refs/heads/main\n", content_type="text/plain")
        if path == "/admin":
            return self._send("<html><body>admin area</body></html>")
        return self._send("404 not found", status=404)

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8", errors="replace")
        if self.path.startswith("/login"):
            return self._send("Invalid username or password", status=200)
        if self.path.startswith("/graphql"):
            if "__schema" in body:
                return self._send(
                    '{"data": {"__schema": {"queryType": {"name": "Query"}}}}',
                    content_type="application/json",
                )
            return self._send("{}", content_type="application/json")
        return self._send("ok")


class MockVulnServer:
    """上下文管理器：启动/停止测试用漏洞应用。"""

    def __init__(self) -> None:
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), MockVulnHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        host, port = self.httpd.server_address[:2]
        return f"http://{host}:{port}"

    def __enter__(self) -> "MockVulnServer":
        self.thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)
