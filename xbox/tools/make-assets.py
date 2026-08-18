#!/usr/bin/env python3
"""Generate the UWP tile/splash PNGs for the Xbox host from build/icon.png.

The desktop build already has ONE icon (build/icon.png, 1024x1024, used by
electron-builder). UWP wants a dozen fixed-size PNGs with fixed names, and a
missing one is a build error rather than a missing picture. So they are
DERIVED here rather than hand-drawn and checked in: one source of truth, and
re-running this after the icon changes is the whole update.

Square tiles keep the icon's own transparency (Xbox draws them on the tile's
accent colour). Wide and splash are letterboxed onto the menu's darkest tone,
#05070b — the same colour electron/main.js uses as the window background, so
the app never flashes white on launch on any platform.

Usage:  python3 xbox/tools/make-assets.py
"""
import pathlib
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("needs Pillow:  pip install Pillow")

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent                      # repo root
SRC = ROOT / "build" / "icon.png"              # shared with electron-builder
OUT = ROOT / "xbox" / "IceHockeyXbox" / "Assets"
BG = (5, 7, 11, 255)                           # #05070b

# name -> (width, height, "fit" = letterbox on BG | "square" = transparent)
TILES = {
    "Square44x44Logo.png":                      (44, 44, "square"),
    "Square44x44Logo.targetsize-24_altform-unplated.png": (24, 24, "square"),
    "Square71x71Logo.png":                      (71, 71, "square"),
    "Square150x150Logo.png":                    (150, 150, "square"),
    "Square310x310Logo.png":                    (310, 310, "square"),
    "StoreLogo.png":                            (50, 50, "square"),
    "LockScreenLogo.png":                       (24, 24, "square"),
    "Wide310x150Logo.png":                      (310, 150, "fit"),
    # 620x300 is the 1x splash; Xbox renders it at 1080p from this, and a
    # bigger source only helps, so the 400% scale is emitted too.
    "SplashScreen.png":                         (620, 300, "fit"),
    "SplashScreen.scale-400.png":               (2480, 1200, "fit"),
}


def main():
    if not SRC.exists():
        sys.exit("missing %s — the Electron build's icon is the source" % SRC)
    OUT.mkdir(parents=True, exist_ok=True)
    src = Image.open(SRC).convert("RGBA")

    for name, (w, h, mode) in TILES.items():
        if mode == "square":
            img = src.resize((w, h), Image.LANCZOS)
        else:
            # contain, at 76% of the short side so the mark has real margin —
            # a tile whose art touches the edge reads as clipped on a TV
            side = int(min(w, h) * 0.76)
            mark = src.resize((side, side), Image.LANCZOS)
            img = Image.new("RGBA", (w, h), BG)
            img.alpha_composite(mark, ((w - side) // 2, (h - side) // 2))
        img.save(OUT / name)
        print("  %-52s %dx%d" % (name, w, h))

    print("%d assets written to %s" % (len(TILES), OUT.relative_to(ROOT)))


if __name__ == "__main__":
    main()
