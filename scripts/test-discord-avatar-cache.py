import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from email.message import Message
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from unittest.mock import patch

from PIL import Image, PngImagePlugin

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("discord_avatar_cache", ROOT / "ops/discord-avatars/discord_avatar_cache.py")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
package = types.ModuleType("avatar_ops_test")
package.__path__ = [str(ROOT / "ops/discord-avatars")]
sys.modules[package.__name__] = package
sys.modules[package.__name__ + ".discord_avatar_cache"] = module
limited_spec = importlib.util.spec_from_file_location(package.__name__ + ".discord_avatar_limited_test", ROOT / "ops/discord-avatars/discord_avatar_limited_test.py")
limited = importlib.util.module_from_spec(limited_spec)
limited_spec.loader.exec_module(limited)
ID = "111111111111111111"
OTHER = "222222222222222222"


def png(color="red", size=(128, 128)):
    out = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("PrivateAuthor", "must be stripped")
    Image.new("RGBA", size, color).save(out, format="PNG", pnginfo=metadata)
    return out.getvalue()


class Source:
    def __init__(self):
        self.ids, self.scans, self.profiles, self.downloads = [ID, ID], 0, [], []
        self.avatar, self.content, self.failure = "a" * 32, png(), None

    def roster(self):
        self.scans += 1
        return self.ids

    def profile(self, discord_id):
        self.profiles.append(discord_id)
        if self.failure:
            raise self.failure
        return {"id": discord_id, "avatar": self.avatar}, {}

    def image(self, url):
        self.downloads.append(url)
        return self.content


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="avatar-cache-isolated-")
        self.path, self.clock, self.source = Path(self.tmp.name), [1000000.0], Source()
        self.config = module.Config(self.path / "private", self.path / "assets", enabled=True,
            supabase_url="https://example.supabase.co", supabase_key="fake", discord_token="fake")
        self.cache = module.AvatarCache(self.config, self.source, lambda: self.clock[0])

    def tearDown(self):
        self.cache.stop()
        self.tmp.cleanup()

    def start_sync(self):
        self.cache.control("sync-missing", True)
        self.assertTrue(self.cache.tick())

    def test_explicit_start_deduplication_optimization_and_privacy(self):
        self.assertFalse(self.cache.tick())
        self.assertEqual(self.source.scans, 0, "deployment/startup must not synchronize")
        self.start_sync()
        self.assertEqual(len(self.source.profiles), 1)
        self.assertEqual(len(self.source.downloads), 1)
        files = list(self.config.assets_dir.glob("*.webp"))
        self.assertEqual(len(files), 1)
        self.assertLess(files[0].stat().st_size, 4096)
        with Image.open(files[0]) as image:
            self.assertEqual(image.size, (64, 64))
            self.assertEqual(image.format, "WEBP")
            self.assertNotIn("PrivateAuthor", image.info)
            self.assertNotIn("exif", image.info)
        manifest = json.loads((self.config.assets_dir / "manifest.json").read_text())
        self.assertNotIn(ID, json.dumps(manifest))
        self.assertIn(hashlib.sha256(ID.encode()).hexdigest(), manifest["avatars"])
        self.assertEqual(self.cache.status()["total_ids"], 1)
        self.assertEqual(self.cache.status()["recovered"], 1)

    def test_persistence_resume_no_repeated_download_and_single_leader(self):
        self.start_sync()
        another = module.AvatarCache(self.config, self.source, lambda: self.clock[0])
        self.assertFalse(another.tick(), "second API worker must not process the same queue")
        self.cache.stop()
        self.clock[0] += 5
        self.assertEqual(another.status()["present"], 1)
        self.assertFalse(another.tick())
        self.assertEqual(len(self.source.profiles), 1)
        another.stop()

    def test_weekly_refresh_only_downloads_changed_images(self):
        self.start_sync()
        self.clock[0] += self.config.refresh_seconds + 1
        self.assertTrue(self.cache.tick())
        self.assertEqual(len(self.source.profiles), 2)
        self.assertEqual(len(self.source.downloads), 1)
        previous = (self.config.assets_dir / "manifest.json").read_bytes()
        self.source.avatar, self.source.content = "b" * 32, png("blue")
        self.clock[0] += self.config.refresh_seconds + 1
        self.assertTrue(self.cache.tick())
        self.assertEqual(len(self.source.downloads), 2)
        self.assertNotEqual((self.config.assets_dir / "manifest.json").read_bytes(), previous)
        self.assertEqual(len(list(self.config.assets_dir.glob("*.webp"))), 1)

    def test_linux_lock_excludes_a_second_worker_during_a_long_scan(self):
        class FileLock:
            LOCK_EX, LOCK_NB, LOCK_UN = 1, 2, 4
            held = False
            def flock(self, descriptor, operation):
                if operation == self.LOCK_UN:
                    self.held = False
                elif self.held:
                    raise BlockingIOError()
                else:
                    self.held = True
        other_source = Source()
        another = module.AvatarCache(self.config, other_source, lambda: self.clock[0])
        original_roster = self.source.roster
        def long_scan():
            self.clock[0] += 121
            self.assertFalse(another.tick(), "filesystem lock protects even after the leader lease expires")
            return original_roster()
        with patch.object(module, "fcntl", FileLock()), patch.object(self.source, "roster", side_effect=long_scan):
            self.start_sync()
        self.assertEqual(len(self.source.downloads), 1)
        self.assertEqual(other_source.downloads, [])
        another.stop()

    def test_failure_preserves_old_image_and_backoff(self):
        self.start_sync()
        image = next(self.config.assets_dir.glob("*.webp"))
        before = image.read_bytes()
        manifest = (self.config.assets_dir / "manifest.json").read_bytes()
        self.source.failure = module.SyncError("network_unavailable")
        self.clock[0] += self.config.refresh_seconds + 1
        self.cache.tick()
        self.assertEqual(image.read_bytes(), before)
        self.assertEqual((self.config.assets_dir / "manifest.json").read_bytes(), manifest)
        calls = len(self.source.profiles)
        self.clock[0] += 3
        self.assertFalse(self.cache.tick())
        self.assertEqual(len(self.source.profiles), calls)
        self.source.failure = None
        self.clock[0] += 120
        self.assertTrue(self.cache.tick())
        self.assertEqual(self.cache.status()["failures"], 0)

    def test_rate_limit_pause_and_new_account_background_discovery(self):
        self.source.failure = module.SyncError("rate_limited", 45)
        self.start_sync()
        self.clock[0] += 30
        self.assertFalse(self.cache.tick())
        self.assertEqual(len(self.source.profiles), 1)
        self.source.failure = None
        self.clock[0] += 100
        self.cache.tick()
        self.source.ids = [ID, OTHER, OTHER]
        self.clock[0] += self.config.scan_seconds + 1
        self.cache.tick()
        self.assertEqual(self.cache.status()["total_ids"], 2)
        self.assertEqual(self.source.profiles.count(OTHER), 1)
        self.assertEqual(self.cache.status()["present"], 2)

    def test_manifest_write_failure_resumes_without_discord(self):
        self.cache.control("sync-missing", True)
        with patch.object(self.cache, "publish", side_effect=OSError("simulated disk fault")):
            with self.assertRaises(OSError):
                self.cache.tick()
        self.clock[0] += 3
        self.cache.tick()
        self.assertTrue((self.config.assets_dir / "manifest.json").is_file())
        self.assertEqual(len(self.source.profiles), 1)
        self.assertEqual(len(self.source.downloads), 1)

    def test_pause_resume_invalid_commands_and_missing_config(self):
        with self.assertRaises(ValueError):
            self.cache.control("sync-missing", False)
        with self.assertRaises(ValueError):
            self.cache.control("resume", True)
        self.start_sync()
        self.cache.control("pause", True)
        self.clock[0] += self.config.refresh_seconds + 1
        self.assertFalse(self.cache.tick())
        self.cache.control("resume", True)
        self.assertTrue(self.cache.tick())
        self.config.enabled = False
        with self.assertRaises(ValueError):
            self.cache.control("sync-missing", True)

    def test_avatar_path_download_and_decoder_validation(self):
        for value in ["../escape", ID, "a" * 63, "b" * 64 + "/x"]:
            with self.assertRaises(ValueError):
                self.cache.asset_path(value)
        for data in [b"<svg></svg>", b"<html>error</html>", b"x" * (module.MAX_IMAGE_BYTES + 1), png(size=(1025, 1025))]:
            with self.assertRaises(module.SyncError):
                module.optimize_image(data)
        with self.assertRaises(module.SyncError):
            module.profile_image({"id": ID, "avatar": "../../evil"})
        source = module.HttpSource(self.config)
        for url in ["http://127.0.0.1/private", "https://cdn.discordapp.com.evil.test/x", "https://user:pass@cdn.discordapp.com/x", "https://cdn.discordapp.com:444/x"]:
            with self.assertRaises(module.SyncError):
                source.image(url)

    def test_tenant_scope_secondary_accounts_and_invalid_discord_ids(self):
        organizations = [{"id": "o1", "is_active": True}, {"id": "o2", "is_active": True}]
        guilds = [{"guild_code": "G1", "organization_id": "o1", "is_active": True}, {"guild_code": "MAD G1", "organization_id": "o2", "is_active": True}]
        members = [{"id": "root", "guild_code": "G1", "discord_id": ID},
            {"id": "alt", "guild_code": "G1", "discord_id": "", "primary_member_id": "root"},
            {"id": "wrong", "guild_code": "MAD G1", "discord_id": ID, "primary_member_id": "root"},
            {"id": "invalid", "guild_code": "G1", "discord_id": "../../bad"}]
        self.assertEqual(module.valid_roster_ids(organizations, guilds, members), [ID])
        guilds.append({"guild_code": "G1", "organization_id": "o2", "is_active": True})
        self.assertEqual(module.valid_roster_ids(organizations, guilds, members), [])

    def test_http_source_batches_readonly_roster_and_bounds_downloads(self):
        source = module.HttpSource(self.config)
        requests = []
        class Response(io.BytesIO):
            def __init__(self, content, content_type="application/json", length=None):
                super().__init__(content)
                self.headers = Message()
                self.headers["Content-Type"] = content_type
                if length is not None:
                    self.headers["Content-Length"] = str(length)
        def open_request(request, timeout):
            requests.append(request)
            self.assertEqual(request.method, "GET")
            self.assertEqual(timeout, 8)
            url = urlsplit(request.full_url)
            if url.path.endswith("portal_organizations"):
                data = [{"id": "o1", "is_active": True}]
            elif url.path.endswith("portal_guilds"):
                data = [{"id": "g1", "guild_code": "G1", "organization_id": "o1", "is_active": True}]
            else:
                data = [{"id": "m1", "guild_code": "G1", "discord_id": ID}]
            return Response(json.dumps(data).encode())
        with patch.object(source.opener, "open", side_effect=open_request):
            self.assertEqual(source.roster(), [ID])
        self.assertEqual(len(requests), 3, "three batched table reads, not one query per avatar")
        self.assertTrue(all("/rest/v1/" in request.full_url for request in requests))
        with patch.object(source.opener, "open", return_value=Response(b"x" * (module.MAX_IMAGE_BYTES + 1), "image/png")):
            with self.assertRaisesRegex(module.SyncError, "download_too_large"):
                source.image("https://cdn.discordapp.com/test.png")
        with patch.object(source.opener, "open", return_value=Response(b"", "image/png", module.MAX_IMAGE_BYTES + 1)):
            with self.assertRaisesRegex(module.SyncError, "download_too_large"):
                source.image("https://cdn.discordapp.com/test.png")
        with patch.object(source.opener, "open", return_value=Response(b"html", "text/html")):
            with self.assertRaisesRegex(module.SyncError, "invalid_content_type"):
                source.image("https://cdn.discordapp.com/test.png")
        with patch.object(source.opener, "open", return_value=Response(b"x", "image/png")), patch.object(module.time, "monotonic", side_effect=[0, 9]):
            with self.assertRaisesRegex(module.SyncError, "download_timeout"):
                source.image("https://cdn.discordapp.com/test.png")
        with self.assertRaisesRegex(module.SyncError, "redirect_refused"):
            module.NoRedirect().redirect_request(None, None, 302, "", {}, "https://evil.test")
        rate_limit = HTTPError("https://discord.com", 429, "", Message(), io.BytesIO(b'{"retry_after": 42}'))
        with patch.object(source.opener, "open", side_effect=rate_limit):
            with self.assertRaises(module.SyncError) as failure:
                source.profile(ID)
            self.assertEqual(failure.exception.code, "rate_limited")
            self.assertEqual(failure.exception.retry_after, 42)

    def test_admin_endpoints_require_existing_token_and_no_arbitrary_targets(self):
        from fastapi import FastAPI, Header, HTTPException
        from fastapi.testclient import TestClient
        def token(x_gvg_token: str = Header(default="")):
            if x_gvg_token != "fake-admin-token":
                raise HTTPException(status_code=401)
        app = FastAPI()
        service = module.install_discord_avatar_cache(app, token, self.config, self.source)
        client = TestClient(app)
        self.assertEqual(client.post("/api/v1/discord-avatars/control", json={"action": "sync-missing", "confirmed": True}).status_code, 401)
        headers = {"X-GVG-Token": "fake-admin-token"}
        self.assertEqual(client.get("/api/v1/discord-avatars/status", headers=headers).status_code, 200)
        self.assertFalse(client.get("/api/v1/discord-avatars/status", headers=headers).json()["armed"])
        self.assertEqual(client.post("/api/v1/discord-avatars/control", headers=headers, json={"action": "sync-missing", "confirmed": True, "url": "https://evil.test"}).status_code, 422)
        self.assertEqual(client.post("/api/v1/discord-avatars/control", headers=headers, json={"action": "sync-missing", "confirmed": False}).status_code, 400)
        self.assertEqual(client.post("/api/v1/discord-avatars/control", headers=headers, json={"action": "sync-missing", "confirmed": True}).status_code, 200)
        self.assertEqual(self.source.scans, 0, "control only persists a command; no network in the request handler")
        self.assertTrue(service.status()["armed"])
        client.close()
        service.stop()

    def test_cache_initialization_failure_does_not_break_api(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        app = FastAPI()
        @app.get("/health")
        def health():
            return {"ok": True}
        config = module.Config(self.path / "assets", self.path / "assets")
        service = module.install_discord_avatar_cache(app, lambda: None, config, self.source)
        self.assertIsNone(service)
        client = TestClient(app)
        self.assertEqual(client.get("/health").json(), {"ok": True})
        self.assertEqual(client.get("/api/v1/discord-avatars/status").json()["last_error"], "cache_unavailable")
        client.close()

    def test_limited_three_ids_never_arms_the_global_queue(self):
        self.config.enabled = False
        third, fourth = "333333333333333333", "444444444444444444"
        self.source.ids = [ID, OTHER, third, fourth]
        selected = [ID, OTHER, third]
        sleep = lambda delay: self.clock.__setitem__(0, self.clock[0] + delay)
        result = limited.run_limited_test(self.config, selected, True, self.source, lambda: self.clock[0], sleep)
        self.assertEqual(result["available"], 3)
        self.assertEqual(result["files"], 3)
        self.assertEqual(set(self.source.profiles), set(selected))
        self.assertEqual(len(self.source.downloads), 3)
        self.assertFalse(result["automatic_enabled"])
        self.assertFalse(result["armed"])
        with self.cache.db() as db:
            self.assertEqual({row[0] for row in db.execute("select discord_id from avatars")}, set(selected))
        limited.run_limited_test(self.config, selected, True, self.source, lambda: self.clock[0], sleep)
        self.assertEqual(len(self.source.downloads), 3, "repeat test reuses already fresh images")
        self.clock[0] += self.config.refresh_seconds + 1
        self.assertFalse(self.cache.tick(), "no recurrent or automatic synchronization after test")
        self.assertEqual(len(self.source.profiles), 3)

    def test_limited_scope_is_checked_before_discord(self):
        self.config.enabled = False
        for selected, confirmed in [([ID, OTHER, "333333333333333333", "444444444444444444"], True), ([ID, ID], True), ([OTHER], True), ([ID], False)]:
            with self.assertRaises(ValueError):
                limited.run_limited_test(self.config, selected, confirmed, self.source)
        self.assertEqual(self.source.profiles, [])
        self.assertEqual(self.source.downloads, [])
        self.config.enabled = True
        with self.assertRaisesRegex(ValueError, "disabled"):
            limited.run_limited_test(self.config, [ID], True, self.source)
        self.config.enabled = False
        with self.cache.db() as db:
            self.cache.put(db, "armed", 1)
        with self.assertRaisesRegex(ValueError, "unarmed"):
            limited.run_limited_test(self.config, [ID], True, self.source)

    def test_limited_rate_limit_stops_without_automatic_retry(self):
        self.config.enabled = False
        self.source.ids = [ID, OTHER]
        self.source.failure = module.SyncError("rate_limited", 60)
        result = limited.run_limited_test(self.config, [ID, OTHER], True, self.source, lambda: self.clock[0], lambda _: self.fail("No sleep through a rate limit"))
        self.assertEqual(len(self.source.profiles), 1)
        self.assertEqual(result["available"], 0)
        self.assertFalse(result["armed"])
        self.assertFalse(result["automatic_enabled"])


if __name__ == "__main__":
    with patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("Real network forbidden in avatar tests")):
        unittest.main()
