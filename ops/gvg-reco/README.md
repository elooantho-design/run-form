# New-season map and arrow calibration

The dashboard configuration is shared by run addition, edition and search.
`map-calibration-20261025.json` records the exact lossless crops from the user's
blank screenshots. Tower: 7x10, fortress: 8x11, A at the bottom. The new images
already cover only the playable grid, so no second grid offset is applied.

These crops do not change the detector's full-screenshot coordinate system.
The existing launcher normalizes captures to 3840x2160 before recognition.

## Detector source

`b1_towers_responsive_probe_reco.py` mirrors the production detector with only
the direction function and helper import changed. `arrow_marker.py` recognizes
the hollow triangular pointer instead of counting portrait colours. A missing
or ambiguous pointer returns `unknown`; the existing pipeline then refuses a
successful import. Hero matching thresholds, cell geometry and templates remain
unchanged. No hero-specific exception is used.

Production destination for both Python files:
`/opt/gvg-paladin/reco/Bot-Paladin/scripts/utils/`.

The recognition worker bind-mounts this directory and launches a fresh Python
child for each job. Install the helper first, then atomically replace the main
script, only when the queue and recognition processes are idle. No worker,
launcher, API or Inter-saison bot changes or restarts are required. Before
replacement, save the current source for operational rollback and verify its
SHA-256 is `149b58f23ddff7feef5f4e00f9a8bae17557774c1ee7f094a4bf0eadd8ad827b`.
Rollback restores that script before removing the newly installed helper.

## Offline tests

```sh
node --test scripts/test-run-grid-config.mjs
python scripts/test-gvg-direction-marker.py
```

Python dependencies: OpenCV and NumPy, already used by the detector. The fixture
archive contains only 25 small cell contexts, not full desktop screenshots.
They cover five real captures, including Elowyn facing right and left.
Rotations, compression, scaling, alignment, portrait recolouring and missing or
ambiguous pointers are synthetic robustness checks, not additional live cases.

Full-engine offline replay additionally checked the five full screenshots with
both OpenCV and the launcher's GDI+ interpolation: 50 decisions pass, hero/cell
matching is identical, and the 63 other detector functions are AST-identical.
This is not a live launcher upload. The known ambiguity for unnormalized raw
screenshots below 2600x1600 is unchanged; production uses normalized captures.
