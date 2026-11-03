"""Build an additive Maths Trek Worker from the verified live reference.

Never deploys. Refuses a changed baseline; prints fingerprints, never source.
"""
import hashlib
from pathlib import Path
import sys

BASELINE = "76c292c8917357543df63428e2effda4ace4311a5977b0dde6cc6d051f45a1bd"
MARKER = "// ================= TEACHER ================="

def build(source, block):
    source = source.replace("\r\n", "\n").replace("\r", "\n")
    if hashlib.sha256(source.encode()).hexdigest() != BASELINE:
        raise ValueError("Live Worker changed: inspect it again before building.")
    if source.count(MARKER) != 1 or "maths_trek_save" in source:
        raise ValueError("Unexpected baseline or Maths Trek already installed.")
    patched = source.replace(MARKER, block + "\n" + MARKER, 1)
    if patched.replace(block + "\n", "", 1) != source:
        raise ValueError("Existing Worker code was changed.")
    return patched

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: apply_patch.py VERIFIED_WORKER OUTPUT_WORKER")
    block = Path(__file__).with_name("worker-actions.js.txt").read_text()
    output = build(Path(sys.argv[1]).read_text(), block)
    destination = Path(sys.argv[2])
    if destination.exists():
        raise SystemExit("Output already exists; refusing to overwrite.")
    with destination.open("x") as stream:
        stream.write(output)
    destination.chmod(0o600)
    print("Additive Worker built. SHA-256:", hashlib.sha256(output.encode()).hexdigest())
