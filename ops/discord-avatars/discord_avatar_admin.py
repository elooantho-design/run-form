"""Explicit administrator CLI. Run only inside the existing API container."""
import argparse
import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["status", "sync-missing", "refresh-due", "pause", "resume"])
    parser.add_argument("--confirm", action="store_true")
    args = parser.parse_args()
    token = os.environ.get("GVG_API_TOKEN", "")
    if not token:
        parser.error("GVG_API_TOKEN missing")
    if args.action != "status" and not args.confirm:
        parser.error("Explicit --confirm required. No command sent.")
    payload = None if args.action == "status" else json.dumps({"action": args.action, "confirmed": True}).encode()
    request = Request("http://127.0.0.1:8000/api/v1/discord-avatars/" + ("status" if payload is None else "control"),
        data=payload, headers={"X-GVG-Token": token, "Content-Type": "application/json"}, method="GET" if payload is None else "POST")
    try:
        with urlopen(request, timeout=5) as response:
            print(json.dumps(json.load(response), indent=2))
    except HTTPError as error:
        raise SystemExit(f"Administrative avatar command refused: HTTP {error.code}") from None


if __name__ == "__main__":
    main()
