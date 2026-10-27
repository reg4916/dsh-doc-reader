# dsh-doc-reader — тестовые документы

Корпус фикстур для плагина **dsh-doc-reader** (PDF / DOCX / XLSX / PPTX / текстовые форматы).
Все файлы созданы только в этом каталоге; код плагина не изменялся.

## Окружение генерации

- Python (bundled): /Users/a1/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 — 3.12.14
  - python-docx 1.2.0, python-pptx 1.0.2, openpyxl 3.1.5
- LibreOffice 26.2.4.2 (/opt/homebrew/bin/soffice) — только для пересчёта кэша формул в sample.xlsx
- Node v26.11.1 — проверка через собственные модули плагина (lib/read.js, lib/detect.js) и его библиотеки: mammoth, SheetJS, unpdf, jszip

## Состав корпуса

| Файл | Размер | Что внутри |
| --- | --- | --- |
| sample.txt | 202 B | 4 строки: латиница + кириллица (Привет, мир), UTF-8 без BOM |
| sample.md | 357 B | H1 + абзац + список из 3 пунктов + блок кода python |
| sample.csv | 52 B | 2 колонки (Год,Выручка): заголовок + 3 строки данных |
| sample.docx | 36,1 KB | Title DOCX-TITLE-MARKER, Heading 1, кириллица ДОКУМЕНТ-МАРКЕР, 2 пункта списка, таблица 2×3 (A1…C2) |
| sample.xlsx | 7,2 KB | листы Data и Second; A1:B1 merged MERGED-MARKER; A4 =SUM(A2:A3) с кэшем 12 |
| sample.pptx | 33,9 KB | 3 слайда (SLIDE-n-TITLE, BULLET-n-*); заметки NOTES-MARKER только на слайде 1 |
| sample.pdf | 1,9 KB | ровно 3 страницы: PAGE-1/2/3-MARKER, у каждой свой блок текста |
| empty.txt | 0 B | 0 байт |
| empty.xlsx | 4,7 KB | пустая книга openpyxl, один пустой лист Sheet |
| not-a-docx.docx | 151 B | обычный UTF-8 текст с расширением .docx — чтение должно упасть |
| corrupt.pdf | 1,0 KB | 1024 детерминированных случайных байта без %PDF — чтение должно упасть |
| expected.json | 1,6 KB | машинно-проверяемая карта ожиданий |

README.md — этот файл (в таблицу не входит).

## Как сгенерировано

### Текстовые файлы

sample.txt, sample.md, sample.csv, not-a-docx.docx записаны напрямую в UTF-8 (без BOM), перевод строки LF.

- sample.txt — 4 строки, две английские и две русские.
- sample.md — H1, абзац, список из трёх пунктов и блок кода python (ограждение ~~~python).
- sample.csv — разделитель «,», без кавычек: заголовок Год,Выручка и три строки 2024–2026.

### sample.docx — python-docx

~~~python
from docx import Document

doc = Document()
doc.core_properties.title = "DOCX fixture"
doc.add_heading("DOCX-TITLE-MARKER", level=0)          # стиль Title
doc.add_heading("Section One: fixture overview", level=1)  # стиль Heading 1
doc.add_paragraph("Кириллический абзац: ДОКУМЕНТ-МАРКЕР — проверка UTF-8 в DOCX.")
doc.add_paragraph("First bullet item", style="List Bullet")
doc.add_paragraph("Второй пункт списка", style="List Bullet")

table = doc.add_table(rows=2, cols=3)   # 2 строки × 3 колонки = 6 ячеек A1..C2
table.style = "Table Grid"
for r, row in enumerate([["A1", "B1", "C1"], ["A2", "B2", "C2"]]):
    for c, value in enumerate(row):
        table.cell(r, c).text = value

doc.save("sample.docx")
~~~

Порядок блоков: Title → Heading 1 → абзац с кириллицей → 2 пункта списка → таблица.

### sample.xlsx — openpyxl + однократный пересчёт LibreOffice

~~~python
from openpyxl import Workbook

wb = Workbook()
ws = wb.active
ws.title = "Data"
ws.append(["Year", "Revenue", "Note"])
ws.append([2024, 1000, "ok"])
ws.append([2025, 2000, "Привет"])

ws2 = wb.create_sheet("Second")
ws2["A1"] = "MERGED-MARKER"
ws2.merge_cells("A1:B1")
ws2["A2"] = 5
ws2["A3"] = 7
ws2["A4"] = "=SUM(A2:A3)"
wb.save("sample.xlsx")
~~~

Затем книга один раз пересчитана, чтобы у формулы появилось кэшированное значение (так выглядят реальные файлы из Excel):

~~~bash
soffice --headless --calc --convert-to xlsx --outdir <tmp> sample.xlsx
~~~

Зачем: SheetJS в плагине читает книгу с cellFormula: false и берёт только значение ячейки. Без кэша строка 4 на листе Second просто исчезла бы из вывода. После пересчёта в выводе есть «4 | 12», при этом формула =SUM(A2:A3) остаётся в xl/worksheets/sheet2.xml, объединение A1:B1 и порядок листов сохраняются.

### sample.pptx — python-pptx

Макет «Title and Content» (prs.slide_layouts[1]):

~~~python
from pptx import Presentation

prs = Presentation()
layout = prs.slide_layouts[1]

slide = prs.slides.add_slide(layout)
slide.shapes.title.text = "SLIDE-1-TITLE"
body = slide.placeholders[1].text_frame
body.text = "BULLET-1-A"
body.add_paragraph().text = "BULLET-1-B"
slide.notes_slide.notes_text_frame.text = "NOTES-MARKER: Заметки докладчика для первого слайда."

# слайд 2: SLIDE-2-TITLE / BULLET-2-A, BULLET-2-B
# слайд 3: SLIDE-3-TITLE / BULLET-3-A
prs.save("sample.pptx")
~~~

Заметки есть только у первого слайда (ppt/notesSlides/notesSlide1.xml).

### sample.pdf — собран вручную на Python

Вариант с cupsfilter (фильтр texttopdf) проверялся, но он упаковывает текст в сжатые потоки с подмножеством шрифта и без гарантии таблицы ToUnicode; pdftotext в системе отсутствует, поэтому проверить извлечение было нечем. Чтобы гарантировать результат, PDF собран напрямую:

- заголовок %PDF-1.4, 3 объекта /Type /Page, /Pages /Count 3;
- шрифт Helvetica, /Encoding /WinAnsiEncoding (стандартный, без встраивания);
- содержимое страниц — потоки BT / ET с командами Tj, без сжатия (FlateDecode отсутствует), поэтому маркеры лежат в файле литералами;
- MediaBox 612×792, по 4–6 строк осмысленного английского текста на странице;
- xref и trailer построены с реальными смещениями.

Страница 1 — PAGE-1-MARKER, страница 2 — PAGE-2-MARKER, страница 3 — PAGE-3-MARKER. Кириллицы в PDF нет: тест на UTF-8 покрывают DOCX/XLSX/PPTX/TXT.

### Крайние случаи

- empty.txt — записан 0 байт.
- corrupt.pdf — 1024 случайных байта (random.Random(20261026), детерминированно), без сигнатуры %PDF.
- not-a-docx.docx — обычный UTF-8 текст с расширением .docx.
- empty.xlsx — пустая книга openpyxl (Workbook() без данных, единственный лист Sheet).

## expected.json

Карта «файл → ожидания», проверенная фактическим выводом плагина.

| Поле | Смысл |
| --- | --- |
| format | ожидаемый формат: pdf / docx / xlsx / pptx / text |
| pages / sheets / slides | число страниц, имена листов, число слайдов |
| substrings | подстроки, которые обязаны присутствовать в тексте из readDocument |
| empty | файл пустой: ошибки нет, но и содержимого нет |
| invalid | файл должен быть отвергнут чтением (throw) |
| formula | справочно по sample.xlsx; в substrings намеренно не входит |

Все substrings проверены на реальном выводе: формат, страницы и число слайдов — через documentMeta, текст — через readDocument.

Чего в expected.json намеренно нет:

- вычисленного значения формулы как обязательной подстроки (в файле оно есть, но завязываться на него не нужно);
- порядка строк и точных отступов — только устойчивые подстроки;
- неоднозначного текста вроде «(empty file)» — плейсхолдеры плагина могут измениться.

## Проверка

~~~bash
# из корня плагина
node --test test/
~~~

Структурная проверка самих файлов (что они реально открываются):

- python-docx: 5 абзацев со стилями Title, Heading 1, Normal, List Bullet ×2; таблица 2×3 с ячейками A1..C2.
- openpyxl: листы [Data, Second]; merged A1:B1; A4 = =SUM(A2:A3); кэш A4 = 12; Data = Year/Revenue/Note + 2024/1000/ok + 2025/2000/Привет.
- python-pptx: 3 слайда, заголовки и пункты на месте, notes только у слайда 1.
- PDF: /Type /Page встречается 3 раза, /Count 3, маркеры лежат литералами, потоков без сжатия; macOS mdls показывает kMDItemNumberOfPages = 3.
- Через модули плагина: все substrings найдены, invalid-файлы отвергнуты.

## Фактическое поведение плагина на крайних случаях (проверено)

- corrupt.pdf: detectFormat возвращает "pdf" по расширению (isPdf проверяет сигнатуру и даёт false), затем resolveFormat бросает: "corrupt.pdf" is not a valid PDF (missing %PDF signature).
- not-a-docx.docx: detectFormat → "docx", readDocx бросает: not a readable DOCX file (ZIP container expected): Can't find end of central directory.
- empty.txt: readPlainText возвращает текст "(empty file)".
- empty.xlsx: readXlsx возвращает блок ## sheet "Sheet" — 0 rows × 0 cols и строку (empty sheet).

## Примечания и ограничения

- sample.xlsx прошёл через LibreOffice, поэтому его байты отличаются от «чистого» вывода openpyxl; состав данных от этого не изменился (проверено openpyxl и SheetJS).
- expected.json использует format: "text" для .md и .csv — в плагине они входят в TEXT_EXTS и читаются readPlainText.
- PDF намеренно только ASCII: маркеры должны находиться любым экстрактором.
- Кириллица в DOCX/XLSX/PPTX/CSV/TXT записана как UTF-8; проверено чтением обратно.
