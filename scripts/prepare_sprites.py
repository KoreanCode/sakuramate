from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SPRITE_DIR = ROOT / "public" / "assets" / "sprites"
FRAME_DIR = ROOT / "public" / "assets" / "frames"

PIECES = ["pawn", "rook", "knight", "bishop", "queen", "king"]
STATES = ["idle", "selected", "attack", "hurt", "defeated"]
FRAME_COUNT = len(STATES)
CANVAS_SIZE = 512
EDGE_CLEAR = 32
ALPHA_THRESHOLD = 30
GUIDE_LINE_RATIO = 0.42
FRAME_PADDING_X = 62
FRAME_PADDING_Y = 92
BOTTOM_PADDING = 48
MAIN_COMPONENT_MIN_AREA = 10000
WIDE_ARTIFACT_AREA_MAX = 22000


def is_guide_pixel(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    if alpha <= ALPHA_THRESHOLD:
        return False

    brightness = (red + green + blue) / 3
    chroma = max(red, green, blue) - min(red, green, blue)
    return brightness > 150 and chroma < 38


def significant_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    alpha = image.getchannel("A")
    mask = alpha.point(lambda value: 255 if value > ALPHA_THRESHOLD else 0)
    return mask.getbbox()


def clear_cell_edges(cell: Image.Image) -> Image.Image:
    cleaned = cell.copy()
    alpha = cleaned.getchannel("A")
    width, height = cleaned.size

    for x in range(width):
        for y in range(EDGE_CLEAR):
            alpha.putpixel((x, y), 0)
            alpha.putpixel((x, height - 1 - y), 0)

    for y in range(height):
        for x in range(EDGE_CLEAR):
            alpha.putpixel((x, y), 0)
            alpha.putpixel((width - 1 - x, y), 0)

    pixels = cleaned.load()

    for y in range(height):
        guide_pixels = 0
        for x in range(width):
            if is_guide_pixel(pixels[x, y]):
                guide_pixels += 1

        if guide_pixels > width * GUIDE_LINE_RATIO:
            for band_y in range(max(0, y - 2), min(height, y + 3)):
                for x in range(width):
                    alpha.putpixel((x, band_y), 0)

    for x in range(width):
        guide_pixels = 0
        for y in range(height):
            if is_guide_pixel(pixels[x, y]):
                guide_pixels += 1

        if guide_pixels > height * GUIDE_LINE_RATIO:
            for band_x in range(max(0, x - 2), min(width, x + 3)):
                for y in range(height):
                    alpha.putpixel((band_x, y), 0)

    cleaned.putalpha(alpha)
    return cleaned


def extract_cells(sheet: Image.Image) -> list[Image.Image]:
    width, height = sheet.size
    cells: list[Image.Image] = []

    for index in range(FRAME_COUNT):
        left = round(width * index / FRAME_COUNT)
        right = round(width * (index + 1) / FRAME_COUNT)
        cell = sheet.crop((left, 0, right, height)).convert("RGBA")
        cells.append(clear_cell_edges(cell))

    return cells


def connected_components(image: Image.Image) -> list[dict[str, object]]:
    alpha = image.getchannel("A")
    width, height = image.size
    pixels = alpha.load()
    seen = bytearray(width * height)
    components: list[dict[str, object]] = []

    for start_y in range(height):
        for start_x in range(width):
            start_index = start_y * width + start_x

            if seen[start_index] or pixels[start_x, start_y] <= ALPHA_THRESHOLD:
                continue

            stack = [(start_x, start_y)]
            seen[start_index] = 1
            coords: list[tuple[int, int]] = []
            left = right = start_x
            top = bottom = start_y

            while stack:
                x, y = stack.pop()
                coords.append((x, y))
                left = min(left, x)
                right = max(right, x)
                top = min(top, y)
                bottom = max(bottom, y)

                for next_x, next_y in (
                    (x + 1, y),
                    (x - 1, y),
                    (x, y + 1),
                    (x, y - 1),
                ):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue

                    index = next_y * width + next_x
                    if seen[index] or pixels[next_x, next_y] <= ALPHA_THRESHOLD:
                        continue

                    seen[index] = 1
                    stack.append((next_x, next_y))

            components.append(
                {
                    "area": len(coords),
                    "bbox": (left, top, right + 1, bottom + 1),
                    "coords": coords,
                }
            )

    return components


def component_center(component: dict[str, object]) -> tuple[float, float]:
    left, top, right, bottom = component["bbox"]  # type: ignore[misc]
    return ((left + right) / 2, (top + bottom) / 2)


def is_sheet_wide_artifact(
    component: dict[str, object],
    source_width: int,
) -> bool:
    left, _top, right, _bottom = component["bbox"]  # type: ignore[misc]
    width = right - left
    area = component["area"]  # type: ignore[assignment]
    return width > source_width * 0.65 and area < WIDE_ARTIFACT_AREA_MAX


def crop_component_state(
    source: Image.Image,
    components: list[dict[str, object]],
) -> Image.Image:
    canvas = Image.new("RGBA", source.size, (0, 0, 0, 0))
    source_pixels = source.load()
    canvas_pixels = canvas.load()

    for component in components:
        for x, y in component["coords"]:  # type: ignore[index]
            canvas_pixels[x, y] = source_pixels[x, y]

    bbox = significant_bbox(canvas)

    if bbox is None:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))

    return canvas.crop(bbox)


def extract_component_cells(source: Image.Image) -> list[Image.Image]:
    components = [
        component
        for component in connected_components(source)
        if component["area"] > 20  # type: ignore[operator]
        and not is_sheet_wide_artifact(component, source.width)
    ]
    main_components = sorted(
        (
            component
            for component in components
            if component["area"] >= MAIN_COMPONENT_MIN_AREA  # type: ignore[operator]
        ),
        key=lambda component: component["bbox"][0],  # type: ignore[index]
    )

    if len(main_components) != FRAME_COUNT:
        return extract_cells(source)

    grouped: list[list[dict[str, object]]] = [[] for _ in range(FRAME_COUNT)]
    main_centers = [component_center(component) for component in main_components]

    for component in components:
        center_x, center_y = component_center(component)
        nearest_index = min(
            range(FRAME_COUNT),
            key=lambda index: (center_x - main_centers[index][0]) ** 2
            + (center_y - main_centers[index][1]) ** 2,
        )
        grouped[nearest_index].append(component)

    return [crop_component_state(source, group) for group in grouped]


def normalize_piece(piece: str) -> None:
    source = Image.open(SPRITE_DIR / f"{piece}.png").convert("RGBA")
    cells = extract_component_cells(source)
    bboxes = [significant_bbox(cell) for cell in cells]
    valid_sizes = [
        (bbox[2] - bbox[0], bbox[3] - bbox[1])
        for bbox in bboxes
        if bbox is not None
    ]

    if not valid_sizes:
        raise RuntimeError(f"No visible frames found for {piece}")

    max_width = max(width for width, _ in valid_sizes)
    max_height = max(height for _, height in valid_sizes)
    scale = min(
        (CANVAS_SIZE - FRAME_PADDING_X) / max_width,
        (CANVAS_SIZE - FRAME_PADDING_Y) / max_height,
    )
    piece_out = FRAME_DIR / piece
    piece_out.mkdir(parents=True, exist_ok=True)

    for state, cell, bbox in zip(STATES, cells, bboxes, strict=True):
        canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))

        if bbox is None:
            canvas.save(piece_out / f"{state}.png")
            continue

        crop = cell.crop(bbox)
        new_size = (
            max(1, round(crop.width * scale)),
            max(1, round(crop.height * scale)),
        )
        resized = crop.resize(new_size, Image.Resampling.LANCZOS)
        x = (CANVAS_SIZE - resized.width) // 2
        y = CANVAS_SIZE - resized.height - BOTTOM_PADDING
        canvas.alpha_composite(resized, (x, y))
        canvas.save(piece_out / f"{state}.png")


def main() -> None:
    for piece in PIECES:
        normalize_piece(piece)


if __name__ == "__main__":
    main()
