"""Checks that a Tauri updater signature was made with the app's updater key.

    python scripts/verify-signature.py <pubkey-base64> <file> <file.sig>

<pubkey-base64> is the plugins.updater.pubkey value from tauri.conf.json and
<file.sig> is what `tauri build` writes next to the installer (both are the
base64 of a minisign text file). Exits 0 when the installer the release ships
would be accepted by the app's updater, 1 with a reason otherwise.
"""
import base64
import hashlib
import sys

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def minisign_lines(b64_text: str) -> list[str]:
    return base64.b64decode(b64_text.strip()).decode().splitlines()


def main(pubkey_b64: str, file_path: str, sig_path: str) -> int:
    try:
        pk = base64.b64decode(minisign_lines(pubkey_b64)[1])
    except (ValueError, IndexError):
        print("pubkey is not a base64 minisign public key file")
        return 1
    if pk[:2] != b"Ed" or len(pk) != 42:
        print("pubkey is not a minisign Ed25519 public key")
        return 1
    key_id, public_key = pk[2:10], Ed25519PublicKey.from_public_bytes(pk[10:])

    try:
        with open(sig_path) as f:
            sig_lines = minisign_lines(f.read())
        sig = base64.b64decode(sig_lines[1])
    except (ValueError, IndexError):
        print("signature file is not a base64 minisign signature")
        return 1
    if len(sig) != 74:
        print("signature block has the wrong length")
        return 1
    alg, sig_key_id, signature = sig[:2], sig[2:10], sig[10:]
    if sig_key_id != key_id:
        print("signature was made with a different key than the app's pubkey")
        return 1

    with open(file_path, "rb") as f:
        data = f.read()
    if alg == b"ED":  # prehashed (what tauri/rsign produce)
        message = hashlib.blake2b(data, digest_size=64).digest()
    elif alg == b"Ed":
        message = data
    else:
        print(f"unknown signature algorithm {alg!r}")
        return 1
    try:
        public_key.verify(signature, message)
    except InvalidSignature:
        print("signature does not match the file")
        return 1

    # The trusted comment is signed too (minisign "global signature").
    if len(sig_lines) >= 4:
        trusted = sig_lines[2].split(":", 1)[1].strip()
        try:
            public_key.verify(base64.b64decode(sig_lines[3]), signature + trusted.encode())
        except InvalidSignature:
            print("trusted comment was tampered with")
            return 1
    print(f"OK: {file_path} is signed by the app's updater key")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(*sys.argv[1:]))
