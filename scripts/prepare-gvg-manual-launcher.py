"""Prepare a local launcher ZIP; only the native startup selection may change."""

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

SOURCE_SHA256 = "ea99411f4ba45a79cc8dbd05e7f5f3bf5b25a00f3240293513f71605bd1e0e67"
MANUAL_BEFORE = r'''    choiceMode := MsgBox("YES = G1`nNO = G2`nCancel = stop", "B1 probe mode", "YesNoCancel Iconi Default1")
    if (choiceMode = "Cancel")
        ExitApp
    MODE := (choiceMode = "Yes") ? "g1" : "g2"
    TARGET_GUILD := (MODE = "g1") ? "G1" : "G2"

    choiceSide := MsgBox("YES = enemy side`nNO = ally side`nCancel = stop", "B1 probe side", "YesNoCancel Iconi Default1")
    if (choiceSide = "Cancel")
        ExitApp
    SIDE := (choiceSide = "Yes") ? "enemy" : "ally"'''
MANUAL_AFTER = r'''    ; The portal resolves the signed-in account and its currently authorized guilds.
    try Run "https://run-form-tau.vercel.app/portal?gvgLauncher=manual"
    catch {
        MsgBox "Impossible d'ouvrir le portail. Connecte-toi au dashboard puis ouvre Launcher."
    }
    ExitApp'''
INVALID_BEFORE = r'''    if !RegExMatch(TARGET_GUILD, "^[A-Z0-9_]{2,24}$")
        TARGET_GUILD := "G1"'''
INVALID_AFTER = r'''    if !RegExMatch(TARGET_GUILD, "^[A-Z0-9_]{2,24}$") {
        MsgBox "Guilde invalide. Relance la capture depuis le portail."
        ExitApp
    }'''


def patch_launcher_source(source):
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError("Launcher source differs from the audited version; refusing to patch")
    text = source.decode("utf-8-sig").replace("\r\n", "\n")
    for before, after in [(MANUAL_BEFORE, MANUAL_AFTER), (INVALID_BEFORE, INVALID_AFTER)]:
        if text.count(before) != 1:
            raise ValueError("Expected startup selection block not found exactly once")
        text = text.replace(before, after, 1)
    newline = "\r\n" if b"\r\n" in source else "\n"
    bom = b"\xef\xbb\xbf" if source.startswith(b"\xef\xbb\xbf") else b""
    return bom + text.replace("\n", newline).encode("utf-8")


def prepare_package(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination or destination.exists():
        raise ValueError("Output must be a new local ZIP, never the input package")
    with zipfile.ZipFile(source) as original:
        names = original.namelist()
        if len(names) != len(set(names)) or names.count("GVGProbe.ahk") != 1:
            raise ValueError("Ambiguous launcher ZIP")
        patched = patch_launcher_source(original.read("GVGProbe.ahk"))
        with zipfile.ZipFile(destination, "x") as result:
            result.comment = original.comment
            for entry in original.infolist():
                result.writestr(entry, patched if entry.filename == "GVGProbe.ahk" else original.read(entry))
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(destination) as result:
        if original.namelist() != result.namelist():
            raise ValueError("ZIP inventory changed")
        changed = [name for name in original.namelist() if original.read(name) != result.read(name)]
        if changed != ["GVGProbe.ahk"]:
            raise ValueError("Unexpected package changes")
    return {"changed_files": changed, "unchanged_entries": len(names) - 1,
            "launcher_sha256": hashlib.sha256(patched).hexdigest(), "output": str(destination)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(prepare_package(args.input, args.output), indent=2))
