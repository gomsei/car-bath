#!/usr/bin/env python3
"""카바스 세차장 예약 현황 웹 서버."""

from __future__ import annotations

import json
import mimetypes
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fetch_availability import fetch_availability

STATIC_DIR = Path(__file__).parent / "static"
HOST = "0.0.0.0"
PORT = 8765


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path) -> None:
        content_type, _ = mimetypes.guess_type(path.name)
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path in ("/", "/index.html"):
            return self._send_file(STATIC_DIR / "index.html")

        if parsed.path == "/api/availability":
            return self._handle_availability(parsed.query)

        self.send_error(404)

    def _handle_availability(self, query: str) -> None:
        params = parse_qs(query)
        date_str = params.get("date", [None])[0]
        days_raw = params.get("days", ["1"])[0]

        try:
            days = int(days_raw)
        except ValueError:
            return self._send_json(400, {"error": "days는 정수여야 합니다."})

        if days < 1 or days > 14:
            return self._send_json(400, {"error": "days는 1~14 사이여야 합니다."})

        try:
            start = date.fromisoformat(date_str) if date_str else date.today()
        except ValueError:
            return self._send_json(400, {"error": "date는 YYYY-MM-DD 형식이어야 합니다."})

        try:
            data = fetch_availability(start, days)
        except RuntimeError as exc:
            return self._send_json(502, {"error": str(exc)})

        return self._send_json(200, data)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"서버 실행: http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n종료")
        server.server_close()


if __name__ == "__main__":
    main()
