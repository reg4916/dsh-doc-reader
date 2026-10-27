#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate the OCR fixture corpus for dsh-doc-reader (test/fixtures/ocr/).

Run with the bundled Python (Pillow 12.3.0):

    /Users/a1/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 \
        test/fixtures/ocr/generate.py

Writes ocr-image.png, ocr-image-ru.png, ocr-scan.pdf, ocr-rotated.png,
expected.json and README.md next to this script.
Nothing outside test/fixtures/ocr/ is created or modified.
"""
import io
import json
import re
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, features

OUT = Path(__file__).resolve().parent

# Arial covers Latin and Cyrillic. The regular face keeps the corpus close to
# an ordinary scanned/exported document rather than a synthetic bold banner.
FONT_CANDIDATES = [
    Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    Path("/Library/Fonts/Arial.ttf"),
    Path("/System/Library/Fonts/Supplemental/Verdana.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
]
FONT = next((path for path in FONT_CANDIDATES if path.exists()), None)
if FONT is None:
    raise SystemExit("no TTF with Latin+Cyrillic coverage found")

BLACK = (0, 0, 0)
WHITE = (255, 255, 255)


def font(size):
    return ImageFont.truetype(str(FONT), size)


def fit_font(draw, text, max_width, max_size, min_size):
    """Largest available size in [min_size, max_size] whose text fits max_width."""
    size = max_size
    while size > min_size:
        candidate = font(size)
        if draw.textbbox((0, 0), text, font=candidate)[2] <= max_width:
            return candidate
        size -= 2
    return font(min_size)


def draw_centered_lines(lines, width, height, max_size, min_size=48, margin=40):
    """One horizontally centred line per vertical slot, so nothing is clipped."""
    image = Image.new("RGB", (width, height), WHITE)
    draw = ImageDraw.Draw(image)
    slot = (height - 2 * margin) / len(lines)
    for index, line in enumerate(lines):
        line_font = fit_font(draw, line, width - 2 * margin, max_size, min_size)
        y = margin + slot * (index + 0.5)
        draw.text((width / 2, y), line, font=line_font, fill=BLACK, anchor="mm")
    return image


# ------------------------------------------------------- 1. ocr-image.png ---
image_en = draw_centered_lines(
    ["OCR-IMAGE-MARKER", "Hello from OCR fixture", "Second line 12345"],
    width=1200,
    height=400,
    max_size=60,
)
image_en.save(OUT / "ocr-image.png")

# ---------------------------------------------------- 2. ocr-image-ru.png ---
image_ru = draw_centered_lines(
    ["ПРИВЕТ-OCR-МАРКЕР", "Проверка кириллицы 2026"],
    width=1200,
    height=300,
    max_size=64,
    margin=30,
)
image_ru.save(OUT / "ocr-image-ru.png")

# ---------------------------------------------------------- 3. ocr-scan.pdf ---
PAGE_W, PAGE_H = 1240, 1754  # A4 at 150 dpi


def scan_page(marker, lines):
    """A white 'page' with one large marker and a couple of ordinary lines."""
    image = Image.new("RGB", (PAGE_W, PAGE_H), WHITE)
    draw = ImageDraw.Draw(image)
    marker_font = fit_font(draw, marker, PAGE_W - 200, 96, 72)
    draw.text((PAGE_W / 2, 420), marker, font=marker_font, fill=BLACK, anchor="mm")
    y = 600
    for line in lines:
        line_font = fit_font(draw, line, PAGE_W - 260, 64, 48)
        draw.text((PAGE_W / 2, y), line, font=line_font, fill=BLACK, anchor="mm")
        y += 120
    return image


page1 = scan_page(
    "SCAN-PAGE-1-MARKER",
    ["Scanned page one", "This PDF has no text layer 111"],
)
page2 = scan_page(
    "SCAN-PAGE-2-MARKER",
    ["Scanned page two", "Only raster images here 222"],
)

# Bilevel with dithering disabled keeps glyph edges crisp; with libtiff present
# Pillow stores each page as CCITT Group 4, the way a real b/w scanner does.
scan_pages = [
    page1.convert("1", dither=Image.Dither.NONE),
    page2.convert("1", dither=Image.Dither.NONE),
]
scan_pages[0].save(
    OUT / "ocr-scan.pdf",
    "PDF",
    save_all=True,
    append_images=scan_pages[1:],
    resolution=150.0,
    # Pinned metadata keeps the PDF byte-identical between runs.
    creationDate=time.gmtime(0),
    modDate=time.gmtime(0),
)

# ------------------------------------------------------ 4. ocr-rotated.png ---
rotated = draw_centered_lines(["OCR-ROTATED-MARKER"], width=1200, height=300, max_size=60).rotate(
    90, expand=True
)
rotated.save(OUT / "ocr-rotated.png")

# --------------------------------------------------------- sanity checks -----
pdf_path = OUT / "ocr-scan.pdf"
pdf_bytes = pdf_path.read_bytes()
assert pdf_bytes.startswith(b"%PDF"), "ocr-scan.pdf is not a PDF"
assert len(re.findall(rb"/Type\s*/Page\b", pdf_bytes)) == 2, "ocr-scan.pdf must have 2 pages"
assert b"/Font" not in pdf_bytes, "ocr-scan.pdf unexpectedly contains a font (text layer?)"
assert len(re.findall(rb"/Subtype\s*/Image", pdf_bytes)) == 2, "ocr-scan.pdf pages are not images"
if features.check("libtiff"):
    assert b"CCITTFaxDecode" in pdf_bytes, "expected CCITT Group 4 page encoding"

for name, expected_size in [
    ("ocr-image.png", (1200, 400)),
    ("ocr-image-ru.png", (1200, 300)),
    ("ocr-rotated.png", (300, 1200)),
]:
    with Image.open(OUT / name) as opened:
        assert opened.size == expected_size, f"{name}: size {opened.size} != {expected_size}"
        opened.verify()


def png_size(image):
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.tell()


pdf_bytes_size = len(pdf_bytes)
png_pages_size = png_size(page1) + png_size(page2)

# ------------------------------------------------------------ 5. expected ---
match = {"ignoreCase": True, "normalizeSpaces": True}
expected = {
    "ocr-image.png": {
        "format": "image",
        "kind": "image",
        "extension": "png",
        "size": [1200, 400],
        "substrings": ["OCR-IMAGE-MARKER", "Hello from OCR fixture", "Second line 12345"],
        "lines": ["OCR-IMAGE-MARKER", "Hello from OCR fixture", "Second line 12345"],
        "match": match,
        "languages": ["eng"],
        "may_fail": False,
    },
    "ocr-image-ru.png": {
        "format": "image",
        "kind": "image",
        "extension": "png",
        "size": [1200, 300],
        "substrings": ["ПРИВЕТ", "2026"],
        "lines": ["ПРИВЕТ-OCR-МАРКЕР", "Проверка кириллицы 2026"],
        "match": match,
        "languages": ["rus"],
        "may_fail": False,
    },
    "ocr-scan.pdf": {
        "format": "pdf",
        "kind": "scanned",
        "pages": 2,
        "pageSize": [PAGE_W, PAGE_H],
        "textLayer": False,
        "substrings": ["SCAN-PAGE-1-MARKER", "SCAN-PAGE-2-MARKER"],
        "pageSubstrings": {
            "1": ["SCAN-PAGE-1-MARKER"],
            "2": ["SCAN-PAGE-2-MARKER"],
        },
        "pageLines": {
            "1": ["SCAN-PAGE-1-MARKER", "Scanned page one", "This PDF has no text layer 111"],
            "2": ["SCAN-PAGE-2-MARKER", "Scanned page two", "Only raster images here 222"],
        },
        "match": match,
        "languages": ["eng"],
        "may_fail": False,
    },
    "ocr-rotated.png": {
        "format": "image",
        "kind": "image",
        "extension": "png",
        "size": [300, 1200],
        "rotation": 90,
        "substrings": ["OCR-ROTATED-MARKER"],
        "lines": ["OCR-ROTATED-MARKER"],
        "match": match,
        "languages": ["eng"],
        "may_fail": True,
    },
}
(OUT / "expected.json").write_text(
    json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)

# --------------------------------------------------------------- 6. README ---
def human(size):
    return f"{size} B" if size < 1024 else f"{size / 1024:.1f} KB".replace(".", ",")


sizes = {
    name: (OUT / name).stat().st_size
    for name in [
        "ocr-image.png",
        "ocr-image-ru.png",
        "ocr-scan.pdf",
        "ocr-rotated.png",
        "expected.json",
        "generate.py",
    ]
}

readme = f"""# OCR-корпус dsh-doc-reader

Растровые картинки с крупным текстом и «сканированный» PDF только из картинок
(без текстового слоя). Нужен для проверок OCR: обычные экстракторы такие файлы
не читают, текст обязан появиться только после распознавания.
Каталог: test/fixtures/ocr/. Вне его ничего не создаётся.

## Состав

| Файл | Размер | Пиксели | Что внутри |
| --- | --- | --- | --- |
| ocr-image.png | {human(sizes["ocr-image.png"])} | 1200×400 | 3 строки: OCR-IMAGE-MARKER / Hello from OCR fixture / Second line 12345 |
| ocr-image-ru.png | {human(sizes["ocr-image-ru.png"])} | 1200×300 | 2 строки: ПРИВЕТ-OCR-МАРКЕР / Проверка кириллицы 2026 |
| ocr-scan.pdf | {human(sizes["ocr-scan.pdf"])} | 2 страницы 1240×1754 (A4 @150 dpi) | только растр: SCAN-PAGE-1-MARKER / SCAN-PAGE-2-MARKER |
| ocr-rotated.png | {human(sizes["ocr-rotated.png"])} | 300×1200 | OCR-ROTATED-MARKER, повёрнут на 90° — may_fail |
| expected.json | {human(sizes["expected.json"])} | — | карта ожиданий для тестов |
| generate.py | {human(sizes["generate.py"])} | — | генератор (не фикстура) |

Пиксельные размеры проверяются Pillow, страницы PDF — mdls и плагином.

## Как сгенерировано

- Bundled Python 3.12 + Pillow 12.3.0.
- Шрифт: /System/Library/Fonts/Supplemental/Arial.ttf — покрывает латиницу и кириллицу
  (в системе есть и Arial Bold, но корпус намеренно набран обычным начертанием).
- Белый фон (255,255,255), чёрный текст (0,0,0), сглаживание Pillow по умолчанию,
  без шума, наклона и JPEG-артефактов: тест проверяет, что пайплайн умеет OCR,
  а не устойчивость к деградации сканов.
- Кегль: 60 px в ocr-image.png, 64 px в ocr-image-ru.png, 96 px для маркера и
  64 px для остальных строк на страницах PDF (всё в требуемом диапазоне «крупно»).
- Строки центрируются по горизонтали и каждая получает свою вертикальную полосу,
  поэтому ничего не обрезается даже при смене шрифта.
- PDF: каждая страница — отдельный ч/б растр 1240×1754 (A4 при 150 dpi), запись Pillow:
  im.save("ocr-scan.pdf", save_all=True, append_images=[page2], resolution=150).
  Пиксели переводятся в bilevel без дизеринга, поэтому страницы хранятся как
  CCITT Group 4 — так их пишут реальные ч/б сканеры. В PDF нет ни шрифтов, ни
  текстовых операторов, только /Subtype/Image.
- Метаданные PDF (/CreationDate, /ModDate) зафиксированы на 1970-01-01, поэтому
  повторная генерация даёт байт-в-байт тот же файл.
- ocr-rotated.png: та же отрисовка, что в ocr-image.png, затем rotate(90, expand=True),
  получается 300×1200, текст идёт снизу вверх.

## Команда

~~~bash
/Users/a1/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 \
    test/fixtures/ocr/generate.py
~~~

Скрипт перезаписывает все файлы каталога, включая expected.json и README.md.
Повторный запуск даёт байт-в-байт те же файлы (проверено shasum; /CreationDate в PDF
зафиксирован).

## Текстового слоя в ocr-scan.pdf нет

Проверено четырьмя независимыми способами:

1. В байтах PDF отсутствует /Font, зато есть ровно два /Subtype/Image — страницы
   являются картинками, а не наборным текстом.
2. Плагинный doc_read возвращает на обеих страницах заглушку
   «(no extractable text on this page)» — извлекать нечего, нужен именно OCR.
3. macOS: mdls -name kMDItemNumberOfPages → 2.
4. Размер PDF — {human(pdf_bytes_size)}: это сжатые ч/б растры (для сравнения PNG тех же
   страниц занимает {human(png_pages_size)}), ни одной текстовой операции в файле нет,
   поэтому без OCR текст извлечься физически не может.

## expected.json

| Поле | Смысл |
| --- | --- |
| format | логический формат: image (PNG) или pdf |
| kind | image / scanned |
| extension | расширение файла (для image) |
| size | пиксельные размеры картинки |
| pages / pageSize | для PDF: число страниц и размер страницы в пикселях |
| textLayer | false — в PDF заведомо нет текстового слоя |
| substrings | подстроки, которые OCR обязан найти |
| pageSubstrings | для PDF: ожидаемые маркеры по страницам |
| lines / pageLines | полные строки, которые нарисованы (справочно) |
| match | правило сравнения: ignoreCase + normalizeSpaces |
| languages | подсказка для tesseract: eng / rus |
| may_fail | краевой случай: падение теста допустимо |

Как сравнивать: привести текст и подстроку к одному регистру и схлопнуть пробелы
(дефисы внутри маркеров значимы). Маркеры в картинках нарисованы заглавными
латинскими буквами и цифрами, чтобы совпадать при любом регистре; для кириллицы
ожидаются «ПРИВЕТ» и «2026».

Для ocr-image-ru.png нужен traineddata rus: tesseract с lang=eng кириллицу не
прочитает. В системе, где готовился корпус, tesseract не установлен (which tesseract
пусто), поэтому подстроки выбраны консервативно: заглавные маркеры, цифры и
короткие слова без пунктуации.

ocr-rotated.png помечен may_fail: true — поворот на 90° без OSD-данных
распознаётся не всеми движками, тест не должен на нём падать.

## Как перепроверить

~~~bash
# PNG открываются и имеют заявленные размеры
python3 -c 'from PIL import Image; print(Image.open("test/fixtures/ocr/ocr-image.png").size)'

# в PDF две страницы
mdls -name kMDItemNumberOfPages test/fixtures/ocr/ocr-scan.pdf

# плагин видит только картинки, текста нет
node -e 'import("./lib/read.js").then(m => m.readDocument({{path:"test/fixtures/ocr/ocr-scan.pdf"}})).then(t => console.log(t))'
~~~

## Примечания

- Корпус намеренно «чистый»: ровный фон, прямой текст, высокий контраст. Искажения
  (шум, наклон, JPEG) не добавлены — для них нужен отдельный корпус деградации.
- Страницы PDF — ч/б bilevel, как у бытового сканера: для OCR это даже проще, чем
  цветной JPEG, и ближе к реальным сканам.
- generate.py и README.md — не фикстуры; тесты должны читать только картинки, PDF
  и expected.json.
"""
(OUT / "README.md").write_text(readme, encoding="utf-8")

# --------------------------------------------------------------- summary ----
print("font:", FONT)
print("pdf:", pdf_bytes_size, "B; sum of page PNGs:", png_pages_size, "B")
for name, size in sizes.items():
    print(f"  {name:<18} {size:>7} B")
