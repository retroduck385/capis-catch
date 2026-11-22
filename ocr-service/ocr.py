"""PaddleOCR wrapper: file in, detected text lines out. No database code here."""

import os
from importlib.metadata import version
from pathlib import Path

from dotenv import load_dotenv
from paddleocr import PaddleOCR

_engine = None
_no_mkldnn = False   # set once oneDNN failed on this machine (or by OCR_DISABLE_MKLDNN=1)
ONEDNN_BUG = "ConvertPirAttribute2RuntimeAttribute"


def engine_name():
    return f"paddleocr {version('paddleocr')} (lang=en)"


def mkldnn_disabled():
    """OCR_DISABLE_MKLDNN=1 in .env: run PaddleOCR without oneDNN (MKLDNN) on CPU. Works around the PaddlePaddle bug
    "ConvertPirAttribute2RuntimeAttribute not support [pir::ArrayAttribute<pir::DoubleAttribute>]" that fails every
    file on some machines. Slower, same results. Unset or anything else: PaddleOCR's default, unchanged."""
    load_dotenv(Path(__file__).with_name(".env"))  # also for --file, which OCRs before the worker loads .env
    return os.getenv("OCR_DISABLE_MKLDNN", "").strip() == "1"


def _get_engine():
    # Loading the models takes a few seconds, so do it once per process.
    global _engine, _no_mkldnn
    if _engine is None:
        options = {}
        if not _no_mkldnn and mkldnn_disabled():
            _no_mkldnn = True
            print("OCR: oneDNN (MKLDNN) off (OCR_DISABLE_MKLDNN=1)", flush=True)
        if _no_mkldnn:
            options["enable_mkldnn"] = False
        _engine = PaddleOCR(
            lang="en",
            use_doc_orientation_classify=True,  # phone photos are often rotated 90/180
            use_doc_unwarping=False,            # unwarping tends to distort flat IDs and scans
            use_textline_orientation=True,      # upside-down text lines
            **options,
        )
    return _engine


def _predict(path):
    """PaddleOCR's pages for one file. If oneDNN hits the PaddlePaddle bug above (seen on teammates' Windows CPUs), the
    engine is rebuilt without it and the same file read again, and the worker stays that way until it restarts, so a
    missing OCR_DISABLE_MKLDNN=1 no longer fails every upload on that machine."""
    global _engine, _no_mkldnn
    try:
        return list(_get_engine().predict(path))
    except Exception as e:
        if _no_mkldnn or ONEDNN_BUG not in str(e):
            raise
        print("OCR: oneDNN (MKLDNN) failed on this machine; switching it off for this worker", flush=True)
        _no_mkldnn, _engine = True, None
        return list(_get_engine().predict(path))


def run_ocr(path):
    """OCR an image or PDF. Returns (lines, pages):
    lines: one dict per line {page_no, line_no, text, confidence, bbox} — bbox = 4 corner points [[x, y], ...]
    pages: one dict per page {page_no, width, height, angle} — the pixel size of the image the boxes refer to
           (PDF pages are rendered at 2x) and the rotation PaddleOCR applied before reading it."""
    lines, pages = [], []
    for page_no, page in enumerate(_predict(path), start=1):
        pre = page.get("doc_preprocessor_res")
        if pre is not None:
            height, width = pre["output_img"].shape[:2]
            pages.append({"page_no": page_no, "width": int(width), "height": int(height),
                          "angle": int(pre.get("angle") or 0)})
        rows = zip(page["rec_texts"], page["rec_scores"], page["rec_polys"])
        line_no = 0
        for text, score, poly in rows:
            text = text.strip()
            if not text:
                continue
            line_no += 1
            lines.append({
                "page_no": page_no,
                "line_no": line_no,
                "text": text,
                "confidence": round(float(score), 4),
                "bbox": [[int(x), int(y)] for x, y in poly],
            })
    return lines, pages
