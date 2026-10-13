"""PaddleOCR wrapper: file in, detected text lines out. No database code here."""

from importlib.metadata import version

from paddleocr import PaddleOCR

_engine = None


def engine_name():
    return f"paddleocr {version('paddleocr')} (lang=en)"


def _get_engine():
    # Loading the models takes a few seconds, so do it once per process.
    global _engine
    if _engine is None:
        _engine = PaddleOCR(
            lang="en",
            use_doc_orientation_classify=True,  # phone photos are often rotated 90/180
            use_doc_unwarping=False,            # unwarping tends to distort flat IDs and scans
            use_textline_orientation=True,      # upside-down text lines
        )
    return _engine


def run_ocr(path):
    """OCR an image or PDF. Returns one dict per line:
    {page_no, line_no, text, confidence, bbox} — bbox = 4 corner points [[x, y], ...]."""
    lines = []
    for page_no, page in enumerate(_get_engine().predict(path), start=1):
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
    return lines
