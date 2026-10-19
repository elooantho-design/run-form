"""Persistent, read-only-source Discord avatar queue for the existing GvG API."""
import hashlib
import io
import json
import logging
import math
import os
import re
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    from PIL import Image, ImageOps
except ImportError:
    Image, ImageOps = None, None

LOG = logging.getLogger("discord-avatar-cache")
DISCORD_ID = re.compile(r"^[0-9]{15,22}$")
ASSET_KEY = re.compile(r"^[a-f0-9]{64}$")
VERSION = re.compile(r"^[a-f0-9]{16}$")
MAX_IMAGE_BYTES = 512 * 1024
MAX_JSON_BYTES = 1024 * 1024
SAFE_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
DISCORD_USER_AGENT = "DiscordBot (https://github.com/elooantho-design/run-form, 1.0)"


class SyncError(Exception):
    def __init__(self, code, retry_after=0):
        super().__init__(code)
        self.code, self.retry_after = code, retry_after


@dataclass
class Config:
    state_dir: Path
    assets_dir: Path
    enabled: bool = False
    refresh_seconds: int = 7 * 86400
    scan_seconds: int = 300
    request_spacing: float = 2.0
    supabase_url: str = ""
    supabase_key: str = ""
    discord_token: str = ""

    @classmethod
    def from_env(cls):
        storage = Path(os.environ.get("GVG_STORAGE_ROOT", "/data/storage"))
        return cls(
            state_dir=storage / "discord-avatar-cache",
            assets_dir=Path(os.environ.get("GVG_ASSETS_ROOT", str(storage / "assets"))) / "discord-avatars",
            enabled=os.environ.get("DISCORD_AVATAR_WORKER_ENABLED", "0") == "1",
            refresh_seconds=max(3600, int(os.environ.get("DISCORD_AVATAR_REFRESH_SECONDS", 7 * 86400))),
            scan_seconds=max(60, int(os.environ.get("DISCORD_AVATAR_SCAN_SECONDS", 300))),
            request_spacing=max(1.0, float(os.environ.get("DISCORD_AVATAR_REQUEST_SPACING", 2))),
            supabase_url=os.environ.get("SUPABASE_URL", "").rstrip("/"),
            supabase_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
            discord_token=os.environ.get("DISCORD_AVATAR_BOT_TOKEN", "") or os.environ.get("DISCORD_DEFENSE_BOT_TOKEN", ""),
        )


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SyncError("redirect_refused")


class HttpSource:
    """Only fixed HTTPS GET targets; no login, upload, message, or arbitrary URL."""
    def __init__(self, config):
        self.config = config
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def get(self, url, headers, limit, hosts):
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in hosts or parsed.port not in (None, 443) or parsed.username or parsed.password:
            raise SyncError("unsafe_url")
        if parsed.hostname in {"discord.com", "cdn.discordapp.com"}:
            headers = {**headers, "User-Agent": DISCORD_USER_AGENT}
        try:
            with self.opener.open(Request(url, headers=headers, method="GET"), timeout=8) as response:
                length = int(response.headers.get("Content-Length", 0))
                if length > limit:
                    raise SyncError("download_too_large")
                chunks, received, deadline = [], 0, time.monotonic() + 8
                while True:
                    chunk = response.read1(min(16384, limit + 1 - received))
                    received += len(chunk)
                    if received > limit:
                        raise SyncError("download_too_large")
                    if time.monotonic() > deadline:
                        raise SyncError("download_timeout")
                    if not chunk:
                        break
                    chunks.append(chunk)
                content = b"".join(chunks)
                return content, response.headers
        except HTTPError as error:
            if error.code == 429:
                try:
                    payload = json.loads(error.read(65536))
                    delay = float(payload.get("retry_after", error.headers.get("Retry-After", 60)))
                    if not math.isfinite(delay):
                        delay = 60
                except (ValueError, TypeError):
                    delay = 60
                raise SyncError("rate_limited", max(1, delay)) from None
            raise SyncError(f"http_{error.code}") from None
        except (TimeoutError, OSError, ValueError):
            raise SyncError("network_unavailable") from None

    def profile(self, discord_id):
        if not DISCORD_ID.fullmatch(discord_id):
            raise SyncError("invalid_discord_id")
        data, headers = self.get(f"https://discord.com/api/v10/users/{discord_id}",
            {"Authorization": f"Bot {self.config.discord_token}"}, 65536, {"discord.com"})
        try:
            profile = json.loads(data)
            if str(profile.get("id")) != discord_id:
                raise ValueError()
            return profile, headers
        except (ValueError, AttributeError):
            raise SyncError("invalid_profile") from None

    def image(self, url):
        content, headers = self.get(url, {}, MAX_IMAGE_BYTES, {"cdn.discordapp.com"})
        if headers.get_content_type() not in SAFE_IMAGE_TYPES:
            raise SyncError("invalid_content_type")
        return content

    def roster(self):
        parsed = urlsplit(self.config.supabase_url)
        if not parsed.hostname or parsed.path not in ("", "/"):
            raise SyncError("invalid_supabase_url")
        headers = {"apikey": self.config.supabase_key, "Authorization": f"Bearer {self.config.supabase_key}"}
        def rows(table, select):
            result = []
            for offset in range(0, 100000, 1000):
                query = urlencode({"select": select, "order": "id.asc", "limit": 1000, "offset": offset})
                content, _ = self.get(f"{self.config.supabase_url}/rest/v1/{table}?{query}", headers, MAX_JSON_BYTES, {parsed.hostname})
                try:
                    page = json.loads(content)
                    if not isinstance(page, list):
                        raise ValueError()
                except ValueError:
                    raise SyncError("invalid_roster_payload") from None
                result.extend(page)
                if len(page) < 1000:
                    return result
            raise SyncError("roster_limit")
        return valid_roster_ids(
            rows("portal_organizations", "id,is_active"),
            rows("portal_guilds", "id,organization_id,guild_code,is_active"),
            rows("guild_members", "id,guild_code,discord_id,primary_member_id,roster_status"),
        )


def valid_roster_ids(organizations, guilds, members):
    active_orgs = {row["id"] for row in organizations if row.get("is_active")}
    scopes = {}
    for guild in guilds:
        if guild.get("is_active") and guild.get("organization_id") in active_orgs:
            scopes.setdefault(guild["guild_code"], set()).add(guild["organization_id"])
    by_id, result = {m["id"]: m for m in members}, set()
    for member in members:
        scope = scopes.get(member.get("guild_code"), set())
        if len(scope) != 1 or member.get("roster_status") not in (None, "active"):
            continue
        root = by_id.get(member.get("primary_member_id")) if member.get("primary_member_id") else member
        if not root or root.get("primary_member_id") or scopes.get(root.get("guild_code"), set()) != scope:
            continue
        discord_id, own = str(root.get("discord_id") or "").strip(), str(member.get("discord_id") or "").strip()
        if DISCORD_ID.fullmatch(discord_id) and (not member.get("primary_member_id") or own in ("", discord_id)):
            result.add(discord_id)
    return sorted(result)


def profile_image(profile):
    discord_id, avatar = str(profile.get("id", "")), str(profile.get("avatar") or "")
    if not DISCORD_ID.fullmatch(discord_id):
        raise SyncError("invalid_discord_id")
    if avatar:
        if not re.fullmatch(r"(?:a_)?[a-f0-9]{32}", avatar):
            raise SyncError("invalid_avatar_hash")
        return avatar, f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar}.png?size=64"
    discriminator = str(profile.get("discriminator") or "")
    index = int(discriminator) % 5 if re.fullmatch(r"\d{4}", discriminator) and discriminator != "0000" else (int(discord_id) >> 22) % 6
    return f"default-{index}", f"https://cdn.discordapp.com/embed/avatars/{index}.png"


def optimize_image(content):
    if Image is None:
        raise SyncError("encoder_unavailable")
    if len(content) > MAX_IMAGE_BYTES:
        raise SyncError("download_too_large")
    try:
        with Image.open(io.BytesIO(content), formats=["PNG", "JPEG", "WEBP"]) as image:
            if image.width * image.height > 1048576:
                raise SyncError("too_many_pixels")
            image.seek(0)
            resized = ImageOps.fit(ImageOps.exif_transpose(image).convert("RGBA"), (64, 64), Image.Resampling.LANCZOS)
            # Construct fresh pixels instead of copying input metadata into the output.
            clean = Image.frombytes("RGBA", resized.size, resized.tobytes())
            output = io.BytesIO()
            clean.save(output, format="WEBP", quality=78, method=6)
            data = output.getvalue()
            if len(data) > 32768:
                raise SyncError("optimized_image_too_large")
            return data
    except (OSError, ValueError, Image.DecompressionBombError):
        raise SyncError("invalid_image") from None


class AvatarCache:
    def __init__(self, config, source=None, clock=time.time):
        self.config, self.source, self.clock = config, source or HttpSource(config), clock
        self.state_dir, self.assets_dir = config.state_dir.resolve(), config.assets_dir.resolve()
        if self.state_dir == self.assets_dir or self.state_dir.is_relative_to(self.assets_dir) or self.assets_dir.is_relative_to(self.state_dir):
            raise ValueError("Private cache and public assets must be separate directories")
        self.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.state_dir.chmod(0o700)
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        self.db_file = self.state_dir / "index.sqlite3"
        self.owner = uuid.uuid4().hex
        self.stop_event, self.thread = threading.Event(), None
        with self.db() as db:
            db.executescript("""
              create table if not exists settings(key text primary key,value text not null);
              create table if not exists avatars(
                discord_id text primary key,asset_key text unique not null,profile_key text,version text,
                status text not null default 'queued',active integer not null default 1,
                attempts integer not null default 0,next_attempt real not null default 0,
                checked_at real,last_success real,last_error text,bytes integer not null default 0);
            """)
        self.db_file.chmod(0o600)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.db_file, timeout=3)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def setting(self, db, key, default="0"):
        row = db.execute("select value from settings where key=?", (key,)).fetchone()
        return row[0] if row else default

    def put(self, db, key, value):
        db.execute("insert into settings values(?,?) on conflict(key) do update set value=excluded.value", (key, str(value)))

    def control(self, action, confirmed=False):
        if action not in {"sync-missing", "refresh-due", "pause", "resume"} or confirmed is not True:
            raise ValueError("Explicit confirmed administrative action required")
        if not self.config.enabled:
            raise ValueError("Avatar worker disabled in configuration")
        if action != "pause" and not (self.config.discord_token and self.config.supabase_url and self.config.supabase_key):
            raise ValueError("Avatar source configuration missing")
        with self.db() as db:
            if action in {"resume", "refresh-due"} and self.setting(db, "armed") != "1":
                raise ValueError("Run the initial explicit sync-missing command first")
            if action == "pause":
                self.put(db, "paused", 1)
            else:
                self.put(db, "armed", 1)
                self.put(db, "paused", 0)
                self.put(db, "scan_requested", 1)
                if action == "sync-missing":
                    # Only failures whose cooldown expired are eligible for a new bounded cycle.
                    db.execute("update avatars set attempts=0,status='queued' where active=1 and version is null and next_attempt<=?", (self.clock(),))
        return self.status()

    def status(self):
        with self.db() as db:
            rows = db.execute("select * from avatars where active=1").fetchall()
            return {"enabled": self.config.enabled, "armed": self.setting(db, "armed") == "1",
                "paused": self.setting(db, "paused") == "1", "total_ids": len(rows),
                "present": sum(bool(r["version"] and self.asset_path(r["asset_key"]).is_file()) for r in rows),
                "queued": sum(r["status"] == "queued" for r in rows),
                "unavailable": sum(r["status"] == "unavailable" for r in rows),
                "failures": sum(r["status"] == "failed" for r in rows),
                "recovered": int(self.setting(db, "recovered")),
                "last_scan": float(self.setting(db, "last_scan")),
                "last_error": self.setting(db, "last_error", ""),
                "retry_at": float(self.setting(db, "not_before"))}

    def asset_path(self, key):
        if not ASSET_KEY.fullmatch(key):
            raise ValueError("Invalid asset key")
        path = self.assets_dir / (key + ".webp")
        if path.is_symlink():
            raise ValueError("Asset symlink refused")
        return path

    def atomic_write(self, path, content):
        temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
        try:
            with temporary.open("xb") as file:
                file.write(content)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def publish(self):
        with self.db() as db:
            rows = db.execute("select asset_key,version from avatars where version is not null").fetchall()
        manifest = {"version": 1, "avatars": {r["asset_key"]: r["version"] for r in rows
            if VERSION.fullmatch(r["version"]) and self.asset_path(r["asset_key"]).is_file()}}
        self.atomic_write(self.assets_dir / "manifest.json", json.dumps(manifest, separators=(",", ":")).encode())
        with self.db() as db:
            self.put(db, "manifest_dirty", 0)

    def scan(self):
        # Read only, batched roster discovery, never called by a dashboard request.
        ids = self.source.roster()
        if any(not DISCORD_ID.fullmatch(value) for value in ids):
            raise SyncError("invalid_roster_id")
        now = self.clock()
        with self.db() as db:
            db.execute("update avatars set active=0")
            for discord_id in sorted(set(ids)):
                key = hashlib.sha256(discord_id.encode()).hexdigest()
                db.execute("insert into avatars(discord_id,asset_key) values(?,?) on conflict(discord_id) do update set active=1", (discord_id, key))
            for row in db.execute("select * from avatars where active=1 and version is not null").fetchall():
                if not self.asset_path(row["asset_key"]).is_file():
                    db.execute("update avatars set next_attempt=0,status='queued',attempts=0 where discord_id=?", (row["discord_id"],))
                    self.put(db, "manifest_dirty", 1)
            self.put(db, "last_scan", now)
            self.put(db, "scan_requested", 0)
            self.put(db, "last_error", "")

    def tick(self):
        if not self.config.enabled:
            return False
        if fcntl is None:
            return self._tick()  # Local Windows tests; production API runs on Linux.
        with (self.state_dir / "worker.lock").open("ab") as lock:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return False
            try:
                return self._tick()
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def _tick(self):
        if not self.config.enabled:
            return False
        now = self.clock()
        with self.db() as db:
            db.execute("begin immediate")
            if self.setting(db, "armed") != "1" or self.setting(db, "paused") == "1":
                return False
            owner = self.setting(db, "owner", "")
            if owner != self.owner and float(self.setting(db, "lease_until")) > now:
                return False
            self.put(db, "owner", self.owner)
            self.put(db, "lease_until", now + 120)
            dirty_manifest = self.setting(db, "manifest_dirty") == "1"
            if float(self.setting(db, "not_before")) > now:
                return False
            scan_due = self.setting(db, "scan_requested") == "1" or float(self.setting(db, "last_scan")) + self.config.scan_seconds <= now
        if dirty_manifest:
            self.publish()
        if scan_due:
            try:
                self.scan()
            except SyncError as error:
                with self.db() as db:
                    self.put(db, "not_before", now + max(60, error.retry_after))
                    self.put(db, "last_error", error.code)
                LOG.warning("avatar roster scan unavailable code=%s", error.code)
                return False
        with self.db() as db:
            row = db.execute("select * from avatars where active=1 and next_attempt<=? order by (version is not null),next_attempt,discord_id limit 1", (now,)).fetchone()
        if not row:
            return False
        try:
            profile, headers = self.source.profile(row["discord_id"])
            profile_key, image_url = profile_image(profile)
            version, size = row["version"], row["bytes"]
            unchanged = profile_key == row["profile_key"] and version and self.asset_path(row["asset_key"]).is_file()
            if not unchanged:
                content = optimize_image(self.source.image(image_url))
                version, size = hashlib.sha256(content).hexdigest()[:16], len(content)
                self.atomic_write(self.asset_path(row["asset_key"]), content)
            with self.db() as db:
                db.execute("update avatars set profile_key=?,version=?,bytes=?,status='ready',attempts=0,last_error=null,checked_at=?,last_success=?,next_attempt=? where discord_id=?",
                    (profile_key, version, size, now, now, now + self.config.refresh_seconds, row["discord_id"]))
                if not row["version"]:
                    self.put(db, "recovered", int(self.setting(db, "recovered")) + 1)
                self.put(db, "manifest_dirty", 1)
                delay = self.config.request_spacing
                if headers.get("X-RateLimit-Remaining") == "0":
                    try:
                        delay = max(delay, float(headers.get("X-RateLimit-Reset-After", 1)))
                    except ValueError:
                        delay = max(delay, 60)
                self.put(db, "not_before", now + delay)
            self.publish()
            LOG.info("avatar stored reused=%s bytes=%s", bool(unchanged), size)
        except SyncError as error:
            attempt = row["attempts"] + 1
            cooldown = max(error.retry_after, min(86400, 60 * 2 ** min(attempt, 10)))
            if attempt >= 5 or error.code == "http_404":
                cooldown = max(cooldown, self.config.refresh_seconds)
            with self.db() as db:
                db.execute("update avatars set status=?,attempts=?,last_error=?,checked_at=?,next_attempt=? where discord_id=?",
                    ("unavailable" if error.code == "http_404" else "failed", attempt, error.code, now, now + cooldown, row["discord_id"]))
                self.put(db, "not_before", now + max(self.config.request_spacing, error.retry_after))
            LOG.warning("avatar sync unavailable code=%s attempt=%s", error.code, attempt)
        return True

    def start(self):
        if not self.config.enabled or self.thread:
            return
        def run():
            while not self.stop_event.is_set():
                try:
                    self.tick()
                except Exception:
                    # Never print remote payloads, authorization headers or user identity.
                    LOG.error("avatar worker iteration failed")
                    self.stop_event.wait(30)
                self.stop_event.wait(1)
        self.thread = threading.Thread(target=run, name="discord-avatar-cache", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=20)
        with self.db() as db:
            if self.setting(db, "owner", "") == self.owner:
                self.put(db, "lease_until", 0)


def install_discord_avatar_cache(app, require_token, config=None, source=None):
    from fastapi import APIRouter, Depends, HTTPException
    from pydantic import BaseModel, ConfigDict

    class Control(BaseModel):
        model_config = ConfigDict(extra="forbid")
        action: str
        confirmed: bool = False

    service = None
    try:
        service = AvatarCache(config or Config.from_env(), source)
    except (OSError, sqlite3.Error, ValueError):
        LOG.error("avatar cache configuration unavailable; core API remains active")
    router = APIRouter(prefix="/api/v1/discord-avatars", dependencies=[Depends(require_token)])

    @router.get("/status")
    def status():
        return service.status() if service else {"enabled": False, "available": False, "last_error": "cache_unavailable"}

    @router.post("/control")
    def control(body: Control):
        if not service:
            raise HTTPException(status_code=503, detail="Avatar cache unavailable")
        try:
            return service.control(body.action, body.confirmed)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from None

    app.include_router(router)
    if service:
        app.add_event_handler("startup", service.start)
        app.add_event_handler("shutdown", service.stop)
    return service
