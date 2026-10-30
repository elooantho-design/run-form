"""Validate the actual candidate launcher without starting a capture or opening a browser."""

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("prepare_launcher", Path(__file__).with_name("prepare-gvg-manual-launcher.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ManualLauncherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path(os.environ["GVG_LAUNCHER_INPUT_ZIP"]).resolve()
        cls.candidate = Path(os.environ["GVG_LAUNCHER_CANDIDATE_ZIP"]).resolve()

    def test_exact_startup_change_and_no_engine_template_changes(self):
        with zipfile.ZipFile(self.source) as before, zipfile.ZipFile(self.candidate) as after:
            self.assertEqual(before.namelist(), after.namelist())
            changed = [n for n in before.namelist() if before.read(n) != after.read(n)]
            self.assertEqual(changed, ["GVGProbe.ahk"])
            self.assertEqual(module.patch_launcher_source(before.read("GVGProbe.ahk")), after.read("GVGProbe.ahk"))

    def test_manual_launch_uses_authenticated_portal_and_exits(self):
        self.assertIn("?gvgLauncher=manual", module.MANUAL_AFTER)
        self.assertTrue(module.MANUAL_AFTER.rstrip().endswith("ExitApp"))
        self.assertNotIn("G1", module.MANUAL_AFTER)
        self.assertNotIn("G2", module.MANUAL_AFTER)
        self.assertNotIn("upload", module.MANUAL_AFTER.lower())
        self.assertIn("ExitApp", module.INVALID_AFTER)
        self.assertNotIn(':= "G1"', module.INVALID_AFTER)

    def test_changed_source_or_double_patch_is_refused(self):
        with zipfile.ZipFile(self.source) as source:
            data = source.read("GVGProbe.ahk")
        with self.assertRaises(ValueError):
            module.patch_launcher_source(data + b"\n")
        with self.assertRaises(ValueError):
            module.patch_launcher_source(module.patch_launcher_source(data))

    def test_existing_package_cannot_be_overwritten(self):
        with self.assertRaises(ValueError):
            module.prepare_package(self.source, self.source)
        with self.assertRaises(ValueError):
            module.prepare_package(self.source, self.candidate)

    @unittest.skipUnless(os.name == "nt", "AutoHotkey validation requires Windows")
    def test_autohotkey_parse_only(self):
        with tempfile.TemporaryDirectory(prefix="gvg-launcher-validate-") as temp:
            root = Path(temp)
            with zipfile.ZipFile(self.candidate) as package:
                for name in ["GVGProbe.ahk", "Bot-Paladin/lib/Gdip_All.ahk", "runtime/autohotkey/AutoHotkey64.exe"]:
                    package.extract(name, root)
            result = subprocess.run([str(root / "runtime/autohotkey/AutoHotkey64.exe"), "/Validate", "/ErrorStdOut=UTF-8", str(root / "GVGProbe.ahk")],
                                    cwd=root, capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
