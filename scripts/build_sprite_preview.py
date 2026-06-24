from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
FRAME_DIR = ROOT / "public" / "assets" / "frames"
OUT = ROOT / "public" / "assets" / "sprite-preview.jpg"

PIECES = ["pawn", "rook", "knight", "bishop", "queen", "king"]
STATES = ["idle", "selected", "attack", "hurt", "defeated"]

CELL = 160
HEADER = 34


def main() -> None:
    preview = Image.new(
        "RGBA",
        (CELL * len(STATES), HEADER + CELL * len(PIECES)),
        (40, 38, 34, 255),
    )
    draw = ImageDraw.Draw(preview)

    for index, state in enumerate(STATES):
        draw.text((index * CELL + 8, 10), state, fill=(250, 239, 218, 255))

    for row, piece in enumerate(PIECES):
        draw.text((8, HEADER + row * CELL + 8), piece, fill=(250, 239, 218, 255))

        for column, state in enumerate(STATES):
            frame = Image.open(FRAME_DIR / piece / f"{state}.png").convert("RGBA")
            frame.thumbnail((CELL - 18, CELL - 18))
            x = column * CELL + (CELL - frame.width) // 2
            y = HEADER + row * CELL + (CELL - frame.height) // 2
            preview.alpha_composite(frame, (x, y))

    preview.convert("RGB").save(OUT, quality=92)


if __name__ == "__main__":
    main()
