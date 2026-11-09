// Shows one uploaded document (image or PDF) with zoom, page buttons and highlight boxes over the OCR lines
// the selected field was read from. Boxes come from ocr_lines.bbox, in pixels of the page image PaddleOCR
// read (pageSizes), so they are drawn as percentages and line up at any zoom.
import { useEffect, useRef, useState } from 'react';
import { getDocumentUrl } from '../applicationForm/api';

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const PDF_RENDER_SCALE = 2; // same as PaddleOCR's PDF rendering; CSS does the zooming

const isPdf = (doc) => /\.pdf$/i.test(doc.file_path) || /\.pdf$/i.test(doc.file_name);

// pdf.js is large: only load it when a PDF is opened
const loadPdf = async (url) => {
    const pdfjs = await import('pdfjs-dist');
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs.getDocument(url).promise;
};

const box = (bbox, size) => {
    const xs = bbox.map((p) => p[0]);
    const ys = bbox.map((p) => p[1]);
    const pad = 4;
    return {
        left: `${((Math.min(...xs) - pad) / size.width) * 100}%`,
        top: `${((Math.min(...ys) - pad) / size.height) * 100}%`,
        width: `${((Math.max(...xs) - Math.min(...xs) + pad * 2) / size.width) * 100}%`,
        height: `${((Math.max(...ys) - Math.min(...ys) + pad * 2) / size.height) * 100}%`,
    };
};

const DocumentViewer = ({ doc, pageSizes, highlights, page, onPageChange }) => {
    const [url, setUrl] = useState(null);
    const [pdf, setPdf] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [error, setError] = useState(null);
    const canvasRef = useRef(null);
    const firstBoxRef = useRef(null);
    const pdfFile = isPdf(doc);
    const filePath = doc.file_path;

    // Signed URL (60 s) is only needed to start loading; the image / PDF stays in memory afterwards.
    // The parent keys this component by document, so state starts fresh for each file.
    useEffect(() => {
        let cancelled = false;
        let loaded = null;
        (async () => {
            try {
                const signed = await getDocumentUrl({ file_path: filePath });
                if (cancelled) return;
                setUrl(signed);
                if (pdfFile) {
                    loaded = await loadPdf(signed);
                    if (cancelled) loaded.destroy();
                    else setPdf(loaded);
                }
            } catch (err) {
                if (!cancelled) setError(err.message);
            }
        })();
        return () => {
            cancelled = true;
            loaded?.destroy();
        };
    }, [filePath, pdfFile]);

    useEffect(() => {
        if (!pdf || !canvasRef.current) return undefined;
        let task = null;
        let cancelled = false;
        (async () => {
            try {
                const pdfPage = await pdf.getPage(Math.min(page, pdf.numPages));
                if (cancelled) return;
                const viewport = pdfPage.getViewport({ scale: PDF_RENDER_SCALE });
                const canvas = canvasRef.current;
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                task = pdfPage.render({ canvas, viewport });
                await task.promise;
            } catch (err) {
                if (!cancelled && err?.name !== 'RenderingCancelledException') setError(err.message);
            }
        })();
        return () => {
            cancelled = true;
            task?.cancel();
        };
    }, [pdf, page]);

    // Bring the highlighted line into view when the selection changes
    useEffect(() => {
        firstBoxRef.current?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    }, [highlights, page, zoom]);

    const pageCount = pdfFile ? pdf?.numPages ?? 1 : 1;
    const size = pageSizes?.[page];
    const boxes = (highlights ?? []).filter((h) => h.page_no === page);
    const canDrawBoxes = Boolean(size) && !size.angle;
    const setZoomClamped = (z) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)));

    const button = 'border rounded px-3 py-1 bg-white hover:bg-gray-50 disabled:opacity-40';

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex flex-wrap items-center gap-2 pb-2">
                <button type="button" className={button} onClick={() => setZoomClamped(zoom + ZOOM_STEP)} aria-label="Zoom in">+</button>
                <button type="button" className={button} onClick={() => setZoomClamped(zoom - ZOOM_STEP)} aria-label="Zoom out">−</button>
                <button type="button" className={button} onClick={() => setZoom(1)}>Reset</button>
                <span className="text-sm text-gray-600">{Math.round(zoom * 100)}%</span>
                {pageCount > 1 && (
                    <span className="flex items-center gap-2 ml-auto">
                        <button type="button" className={button} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>‹ Prev</button>
                        <span className="text-sm">Page {page} of {pageCount}</span>
                        <button type="button" className={button} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Next ›</button>
                    </span>
                )}
                {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm underline ml-auto">Open file</a>}
            </div>

            {error && <p className="text-red-600">{error}</p>}
            {boxes.length > 0 && !canDrawBoxes && (
                <p className="text-sm text-gray-600 pb-1">
                    {size ? 'This page was rotated before reading, so the location can\'t be drawn.'
                        : 'Location not available for this file (read before page sizes were saved). Re-OCR it to see boxes.'}
                </p>
            )}

            <div className="flex-1 min-h-0 overflow-auto border rounded bg-gray-100 p-2">
                <div className="relative mx-auto" style={{ width: `${zoom * 100}%` }}>
                    {!url && !error && <p className="p-4 text-gray-600">Loading document...</p>}
                    {url && !pdfFile && <img src={url} alt={doc.file_name} className="block w-full h-auto bg-white shadow" />}
                    {pdfFile && <canvas ref={canvasRef} className="block w-full h-auto bg-white shadow" />}
                    {canDrawBoxes && boxes.map((h, i) => (
                        <div key={h.id} ref={i === 0 ? firstBoxRef : undefined}
                            className="absolute border-2 border-amber-500 bg-amber-300/30 rounded-sm pointer-events-none"
                            style={box(h.bbox, size)} title={h.text} />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default DocumentViewer;
