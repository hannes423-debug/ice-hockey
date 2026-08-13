#!/usr/bin/env python3
"""Tiny GET+POST server for the visual probe.

python3 -m http.server has no POST, and headless --screenshot stalls on a live
WebGL page (see the notes in simprobe.sh). So: serve the folder normally, and
accept POST /shot with a data: URL body which is written straight to a PNG.
The page renders and reads back its own canvas in ONE synchronous block, which
is what makes toDataURL return real pixels instead of a blank buffer.

  python3 shotsrv.py [port] [outdir]
"""
import base64
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8133
OUTDIR = sys.argv[2] if len(sys.argv) > 2 else "."


class H(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode("utf-8", "replace")
        name = self.path.split("?", 1)[1] if "?" in self.path else "shot"
        name = "".join(c for c in name if c.isalnum() or c in "._-") or "shot"
        if "," in body:
            body = body.split(",", 1)[1]
        try:
            raw = base64.b64decode(body)
        except Exception as e:                      # noqa: BLE001
            sys.stderr.write("decode failed: %s\n" % e)
            self.send_response(400)
            self.end_headers()
            return
        path = os.path.join(OUTDIR, name + ".png")
        with open(path, "wb") as f:
            f.write(raw)
        sys.stderr.write("WROTE %s %d bytes\n" % (path, len(raw)))
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *a):
        sys.stderr.write("%s\n" % (fmt % a))


if __name__ == "__main__":
    http.server.HTTPServer(("127.0.0.1", PORT), H).serve_forever()
