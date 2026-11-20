// Shows one uploaded document (image or PDF) with zoom, page buttons and highlight boxes over the OCR lines
// the selected field was read from. Boxes come from ocr_lines.bbox, in pixels of the page image PaddleOCR
// read (pageSizes), so they are drawn as percentages and line up at any zoom.
// It opens fitted: the whole page inside the viewer, so a portrait page is read without scrolling. Zooming in
// (or out) leaves the fit; the reset button brings it back.
// Styles: .dc-toolbar / .dc-stage in documentCheck.css (pill controls, a rounded stage, blue location boxes).
import { ViewerSkeleton } from '../../components/skeleton';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Minus, Plus, RotateCcw } from 'lucide-react';
import { getDocumentUrl } from '../applicationForm/api';

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const PDF_RENDER_SCALE = 2; // same as PaddleOCR's PDF rendering; CSS does the zooming

const isPdf = (doc) => /\.pdf$/i.test(doc.file_path) || /\.pdf$/i.test(doc.file_name);

// pdf.js is large: only load it when a PDF is opened. Returns the loading task: in pdf.js 6 the task
// (not the document) is what gets destroyed to free the worker.
const startPdfLoad = async (url) => {
    const pdfjs = await import('pdfjs-dist');
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs.getDocument({ url }); // pdf.js 6 takes an options object, not a bare URL
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
        let loadingTask = null;
        (async () => {
            try {
                const signed = await getDocumentUrl({ file_path: filePath });
                if (cancelled) return;
                setUrl(signed);
                if (pdfFile) {
                    loadingTask = await startPdfLoad(signed);
                    if (cancelled) {
                        loadingTask.destroy();
                        return;
                    }
                    const loaded = await loadingTask.promise;
                    if (!cancelled) setPdf(loaded);
                }
            } catch (err) {
                if (!cancelled) setError(err.message);
            }
        })();
        return () => {
            cancelled = true;
            loadingTask?.destroy();
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
        const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        firstBoxRef.current?.scrollIntoView({ block: 'center', inline: 'center', behavior: smooth ? 'smooth' : 'auto' });
    }, [highlights, page, zoom]);

    const pageCount = pdfFile ? pdf?.numPages ?? 1 : 1;
    const size = pageSizes?.[page];
    const boxes = (highlights ?? []).filter((h) => h.page_no === page);
    const canDrawBoxes = Boolean(size) && !size.angle;
    const setZoomClamped = (z) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)));

    return (
        <div className="dc-viewer">
            <div className="dc-toolbar">
                <div className="dc-group" role="group" aria-label="Zoom">
                    <button type="button" className="dc-tool" onClick={() => setZoomClamped(zoom - ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">
                        <Minus size={16} aria-hidden="true" />
                    </button>
                    <span className="dc-zoom" aria-live="polite">{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
                    <button type="button" className="dc-tool" onClick={() => setZoomClamped(zoom + ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
                        <Plus size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="dc-tool" onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Fit the page" title="Fit the page">
                        <RotateCcw size={15} aria-hidden="true" />
                    </button>
                </div>
                {pageCount > 1 && (
                    <div className="dc-group" role="group" aria-label="Pages">
                        <button type="button" className="dc-tool" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
                            <ChevronLeft size={16} aria-hidden="true" />
                        </button>
                        <span className="dc-zoom">Page {page} of {pageCount}</span>
                        <button type="button" className="dc-tool" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="Next page">
                            <ChevronRight size={16} aria-hidden="true" />
                        </button>
                    </div>
                )}
                {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="lf-btn quiet dc-open">
                        <ExternalLink size={15} aria-hidden="true" />Open file
                    </a>
                )}
            </div>

            {error && <p className="lf-err" role="alert">{error}</p>}
            {boxes.length > 0 && !canDrawBoxes && (
                <p className="dc-muted">
                    {size ? "This page was rotated before reading, so the location can't be drawn."
                        : 'Location not available for this file (read before page sizes were saved). Re-OCR it to see boxes.'}
                </p>
            )}

            <div className="dc-stage">
                <div className={`dc-page${zoom === 1 ? ' fit' : ''}`} style={zoom === 1 ? undefined : { width: `${zoom * 100}%` }}>
                    {!url && !error && <ViewerSkeleton />}
                    {url && !pdfFile && <img src={url} alt={doc.file_name} />}
                    {pdfFile && <canvas ref={canvasRef} />}
                    {canDrawBoxes && boxes.map((h, i) => (
                        <div key={h.id} ref={i === 0 ? firstBoxRef : undefined} className="dc-box"
                            style={box(h.bbox, size)} title={h.text} />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default DocumentViewer;
