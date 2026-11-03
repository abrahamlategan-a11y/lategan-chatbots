"""Apply the verified additive release using Cloudflare's content-only API."""
import email.parser
import email.policy
import json
import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error
import urllib.request
import uuid

from apply_patch import build

account = os.environ["CF_ACCOUNT"]
token = os.environ["CF_TOKEN"]
if not re.fullmatch(r"[a-fA-F0-9]{32}", account) or not token:
    raise SystemExit("Missing deployment credentials")
base = f"https://api.cloudflare.com/client/v4/accounts/{account}"
script = "/workers/scripts/lategan-chatbot"

def request(path, method="GET", data=None, content_type="application/json"):
    req = urllib.request.Request(base + path, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "Content-Type": content_type,
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.read(), response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Cloudflare {method} failed with HTTP {error.code}") from None

def api(path, method="GET", data=None, content_type="application/json"):
    payload = json.loads(request(path, method, data, content_type)[0])
    if not payload.get("success"):
        raise SystemExit("Cloudflare did not confirm success")
    return payload["result"]

def source():
    raw, kind = request(script)
    if "multipart/" not in kind:
        raise SystemExit("Expected multipart Worker source")
    message = email.parser.BytesParser(policy=email.policy.default).parsebytes(
        f"Content-Type: {kind}\r\nMIME-Version: 1.0\r\n\r\n".encode() + raw)
    parts = list(message.iter_parts())
    if len(parts) != 1:
        raise SystemExit("Expected exactly one Worker module")
    part = parts[0]
    name = part.get_filename() or part.get_param("name", header="Content-Disposition")
    if not name or not re.fullmatch(r"[a-zA-Z0-9._/-]+", name):
        raise SystemExit("Unexpected Worker module name")
    return name, part.get_payload(decode=True)

def main():
    name, original = source()
    root = Path(__file__).parent
    current = original.decode().replace("\r\n", "\n").replace("\r", "\n")
    start = "// Maths Trek isolated API block."
    marker = "// ================= TEACHER ================="
    updating = hashlib.sha256(current.encode()).hexdigest() == "b2e8c789ab075ff7de7f243063e4e82dad07b3917d5bdb48114da8dc1d185b17"
    if updating:
        begin = current.index(start)
        end = current.index(marker, current.index('if (action === "maths_trek_list"', begin))
        current = current[:begin] + current[end:]
    patched = build(current, (root / "worker-actions.js.txt").read_text()).encode()
    with tempfile.TemporaryDirectory() as directory:
        candidate = Path(directory) / "worker.mjs"
        candidate.write_bytes(patched)
        if subprocess.run(["node", "--check", str(candidate)], capture_output=True).returncode:
            raise SystemExit("Patched Worker failed syntax validation")
    settings = api(script + "/settings")
    bindings = [b for b in settings["bindings"] if b["type"] == "d1" and b["name"] == "DB"]
    if len(bindings) != 1:
        raise SystemExit("Expected exactly one D1 DB binding")
    db_id = bindings[0].get("id") or bindings[0].get("database_id")
    uuid.UUID(db_id)
    db = f"/d1/database/{db_id}"
    if os.environ.get("RELEASE_CONFIRMATION") != "DEPLOY-MATHS-TREK":
        print("Verified Worker source, syntax and D1 binding. Preflight only.")
        return
    if not updating:
        bookmark = api(db + "/time_travel/bookmark").get("bookmark")
        if not bookmark:
            raise SystemExit("D1 recovery bookmark unavailable")
        print("D1 recovery bookmark:", bookmark, flush=True)
        migration = (root / "migrations/001_create_tables.sql").read_text()
        result = api(db + "/query", "POST", json.dumps({"sql": migration}).encode())
        if not result or any(item.get("success") is not True for item in result):
            raise SystemExit("D1 migration did not confirm success")
    if source() != (name, original):
        raise SystemExit("Live Worker changed during migration")
    boundary = uuid.uuid4().hex
    metadata = json.dumps({"main_module": name})
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n'
        f'Content-Type: application/json\r\n\r\n{metadata}\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{name}"\r\n'
        'Content-Type: application/javascript+module\r\n\r\n'
    ).encode() + patched + f"\r\n--{boundary}--\r\n".encode()
    api(script + "/content", "PUT", body, f"multipart/form-data; boundary={boundary}")
    if source() != (name, patched):
        raise SystemExit("Uploaded Worker source did not match candidate")
    if api(script + "/settings") != settings:
        raise SystemExit("Worker settings differ after deployment; inspect before proceeding")
    print("Maths Trek Worker and D1 migration verified.")

if __name__ == "__main__":
    main()
