"""One-shot administrator test, never arming the persistent automatic queue."""
import argparse
import json
import tempfile
import time
from dataclasses import replace
from pathlib import Path
from urllib.parse import urlsplit

from .discord_avatar_cache import AvatarCache, Config, DISCORD_ID, HttpSource, fcntl


class CountedSource(HttpSource):
    def __init__(self, config):
        super().__init__(config)
        self.requests = {"discord_api": 0, "discord_cdn": 0, "supabase": 0}

    def get(self, url, headers, limit, hosts):
        host = urlsplit(url).hostname
        key = "discord_api" if host == "discord.com" else "discord_cdn" if host == "cdn.discordapp.com" else "supabase"
        self.requests[key] += 1
        return super().get(url, headers, limit, hosts)


class UnpublishedTestCache(AvatarCache):
    def publish(self):
        # Only the main index may publish; never temporarily hide other cached IDs.
        pass


def run_limited_test(config, discord_ids, confirmed=False, source=None, clock=time.time, sleep=time.sleep):
    if confirmed is not True or not isinstance(discord_ids, list) or not 1 <= len(discord_ids) <= 3:
        raise ValueError("Explicit confirmation and one to three Discord IDs required")
    if any(not isinstance(value, str) or not DISCORD_ID.fullmatch(value) for value in discord_ids) or len(set(discord_ids)) != len(discord_ids):
        raise ValueError("Invalid or duplicate Discord IDs")
    if config.enabled:
        raise ValueError("Automatic worker must be disabled before a limited test")
    source = source or CountedSource(config)
    main = AvatarCache(config, source, clock)
    with (main.state_dir / "worker.lock").open("ab") as lock:
        if fcntl:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError("Another avatar operation is active") from None
        try:
            with main.db() as db:
                if main.setting(db, "armed") == "1":
                    raise ValueError("Persistent automatic queue must remain unarmed")
            eligible = set(source.roster())
            if not set(discord_ids).issubset(eligible):
                raise ValueError("All selected IDs must belong to the active dashboard roster")

            class BoundedSource:
                def roster(self):
                    return discord_ids

                def profile(self, discord_id):
                    if discord_id not in discord_ids:
                        raise ValueError("Out-of-scope Discord ID refused")
                    return source.profile(discord_id)

                def image(self, url):
                    return source.image(url)

            with tempfile.TemporaryDirectory(prefix="limited-", dir=main.state_dir) as folder:
                temporary = UnpublishedTestCache(replace(config, state_dir=Path(folder), enabled=True), BoundedSource(), clock)
                try:
                    with main.db() as db, temporary.db() as target:
                        for discord_id in discord_ids:
                            row = db.execute("select * from avatars where discord_id=?", (discord_id,)).fetchone()
                            if row:
                                target.execute("insert or replace into avatars values(" + ",".join("?" for _ in row) + ")", tuple(row))
                        delay = float(main.setting(db, "not_before"))
                        temporary.put(target, "not_before", delay)
                    temporary.control("sync-missing", True)
                    for _ in discord_ids:
                        with temporary.db() as db:
                            delay = float(temporary.setting(db, "not_before")) - clock()
                        if delay > 10:
                            break  # Never wait through a rate limit or start automatic retries.
                        if delay > 0:
                            sleep(delay)
                        if not temporary.tick():
                            break
                    with temporary.db() as db:
                        rows = db.execute("select * from avatars").fetchall()
                        retry_at = float(temporary.setting(db, "not_before"))
                    if any(row["discord_id"] not in discord_ids for row in rows):
                        raise ValueError("Limited cache scope invalid")
                    with main.db() as db:
                        recovered = int(main.setting(db, "recovered"))
                        for row in rows:
                            previous = db.execute("select version from avatars where discord_id=?", (row["discord_id"],)).fetchone()
                            if row["version"] and (not previous or not previous["version"]):
                                recovered += 1
                            db.execute("insert or replace into avatars values(" + ",".join("?" for _ in row) + ")", tuple(row))
                        main.put(db, "recovered", recovered)
                        main.put(db, "not_before", retry_at)
                        main.put(db, "manifest_dirty", 1)
                    main.publish()
                finally:
                    temporary.stop()
            status = main.status()
            return {"selected_ids": len(discord_ids), "available": sum(bool(row["version"]) for row in rows),
                "files": status["present"], "total_ids": status["total_ids"],
                "total_image_bytes": sum(path.stat().st_size for path in main.assets_dir.glob("*.webp")),
                "requests": getattr(source, "requests", {}), "automatic_enabled": status["enabled"], "armed": status["armed"]}
        finally:
            if fcntl:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", action="store_true")
    args = parser.parse_args()
    import sys
    payload = json.loads(sys.stdin.read(4097))
    if not isinstance(payload, dict) or set(payload) != {"discord_ids"}:
        raise SystemExit("Expected only discord_ids in administrator stdin")
    try:
        result = run_limited_test(Config.from_env(), payload["discord_ids"], args.confirm)
    except ValueError as error:
        raise SystemExit(str(error)) from None
    print(json.dumps(result))


if __name__ == "__main__":
    main()
