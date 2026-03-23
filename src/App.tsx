/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getDocument, GlobalWorkerOptions, version as pdfjsVersion } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Use a reliable CDN for the worker that matches the installed version exactly
GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.mjs`;

import { 
  Upload, 
  FileText, 
  ChevronLeft, 
  ChevronRight, 
  Settings, 
  Loader2, 
  Download, 
  Languages,
  AlertCircle,
  CheckCircle2,
  Maximize2,
  Minimize2,
  Search,
  Trash2,
  RefreshCcw,
  ZoomIn,
  ZoomOut,
  Maximize,
  Type,
  ALargeSmall,
  Type as FontIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GeminiService } from './services/geminiService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface TranslationState {
  [page: number]: {
    content: string;
    status: 'idle' | 'loading' | 'success' | 'error';
  };
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [translations, setTranslations] = useState<TranslationState>({});
  const [isTranslating, setIsTranslating] = useState(false);
  const [apiKey, setApiKey] = useState<string>(localStorage.getItem('gemini_api_key') || '');
  const [showSettings, setShowSettings] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [zoom, setZoom] = useState(0.82); // Default to 82% as requested
  const [isAutoFit, setIsAutoFit] = useState(true);
  
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  
  const [fontSize, setFontSize] = useState(14);
  const [fontFamily, setFontFamily] = useState('Inter');
  
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  
  const clearFile = () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFile(null);
    setFileUrl(null);
    setPdfDoc(null);
    setNumPages(0);
    setCurrentPage(1);
    setTranslations({});
    setPdfError(null);
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);
  const geminiService = useRef<GeminiService | null>(null);

  useEffect(() => {
    geminiService.current = new GeminiService(apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (pdfDoc) {
      fitToWidth();
    }
  }, [pdfDoc]);

  // Handle container resize to maintain fit-to-width if enabled
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfDoc || !isAutoFit) return;

    const observer = new ResizeObserver(() => {
      fitToWidth();
    });
    
    observer.observe(container);
    return () => observer.disconnect();
  }, [pdfDoc, isAutoFit, currentPage]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      if (selectedFile.size > 200 * 1024 * 1024) {
        alert("File quá lớn. Vui lòng chọn file dưới 200MB.");
        return;
      }
      setFile(selectedFile);
      setTranslations({});
      setCurrentPage(1);
      setIsPdfLoading(true);
      
      try {
        const url = URL.createObjectURL(selectedFile);
        setFileUrl(url);
        const loadingTask = getDocument(url);
        const pdf = await loadingTask.promise;
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
      } catch (error) {
        console.error("Error loading PDF:", error);
        alert("Không thể tải file PDF. Vui lòng thử lại.");
      } finally {
        setIsPdfLoading(false);
      }
    }
  };

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDoc || !canvasRef.current) return;

    setIsRendering(true);
    // Cancel previous render task if any
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }

    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: zoom * 2 });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      if (context) {
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };
        
        const renderTask = page.render(renderContext as any);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      }
    } catch (error: any) {
      if (error.name === 'RenderingCancelledException') {
        // Ignore cancellation
      } else {
        console.error("Error rendering page:", error);
        setPdfError("Không thể hiển thị trang này. Vui lòng thử lại.");
      }
    } finally {
      setIsRendering(false);
    }
  }, [pdfDoc, zoom]);

  useEffect(() => {
    if (pdfDoc) {
      renderPage(currentPage);
    }
  }, [pdfDoc, currentPage, renderPage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setIsAutoFit(false);
          setZoom(z => Math.min(3, Number((z + 0.1).toFixed(1))));
        } else if (e.key === '-') {
          e.preventDefault();
          setIsAutoFit(false);
          setZoom(z => Math.max(0.5, Number((z - 0.1).toFixed(1))));
        } else if (e.key === '0') {
          e.preventDefault();
          fitToWidthAction();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfDoc) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setIsAutoFit(false);
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(prev => {
          const next = Math.min(3, Math.max(0.5, prev + delta));
          return Number(next.toFixed(1));
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [pdfDoc]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isPanning || !containerRef.current) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop
    });
    containerRef.current.style.cursor = 'grabbing';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    e.preventDefault();
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    containerRef.current.scrollLeft = dragStart.scrollLeft - dx;
    containerRef.current.scrollTop = dragStart.scrollTop - dy;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    if (containerRef.current) {
      containerRef.current.style.cursor = isPanning ? 'grab' : 'auto';
    }
  };

  const fitToWidth = async () => {
    if (!pdfDoc || !containerRef.current) return;
    try {
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: 1 });
      const containerWidth = containerRef.current.clientWidth - 64; // account for padding
      const newZoom = containerWidth / viewport.width;
      setZoom(Number(newZoom.toFixed(2)));
    } catch (error) {
      console.error("Error fitting to width:", error);
    }
  };

  const fitToWidthAction = () => {
    setIsAutoFit(true);
    fitToWidth();
  };

  const translateCurrentPage = async () => {
    if (!canvasRef.current || !geminiService.current) return;
    
    // Check if we have an API key before starting
    const hasKey = await geminiService.current.hasApiKey();
    if (!hasKey) {
      setTranslations(prev => ({
        ...prev,
        [currentPage]: { 
          content: 'Thiếu API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn từ hệ thống.', 
          status: 'error' 
        }
      }));
      return;
    }

    setIsTranslating(true);
    setTranslations(prev => ({
      ...prev,
      [currentPage]: { content: '', status: 'loading' }
    }));

    try {
      const imageBuffer = canvasRef.current.toDataURL('image/jpeg', 0.8);
      const stream = geminiService.current.translateMedicalPageStream(imageBuffer, currentPage);
      
      let fullContent = "";
      for await (const chunk of stream) {
        fullContent += chunk;
        setTranslations(prev => ({
          ...prev,
          [currentPage]: { content: fullContent, status: 'loading' }
        }));
      }
      
      setTranslations(prev => ({
        ...prev,
        [currentPage]: { content: fullContent, status: 'success' }
      }));
    } catch (error: any) {
      console.error("Translation Error:", error);
      const errorMessage = error instanceof Error 
        ? error.message 
        : (typeof error === 'string' ? error : 'Dịch thuật thất bại. Vui lòng kiểm tra API Key hoặc kết nối mạng.');
      
      setTranslations(prev => ({
        ...prev,
        [currentPage]: { content: errorMessage, status: 'error' }
      }));
    } finally {
      setIsTranslating(false);
    }
  };

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
    setShowSettings(false);
  };

  return (
    <div className={cn("h-screen flex flex-col bg-slate-50 overflow-hidden", isFullScreen && "fixed inset-0 z-50")}>
      {/* Header */}
      <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6 shrink-0 shadow-sm z-30">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Languages className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl text-slate-800 tracking-tight">MediTrans AI</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Medical Translation Expert</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {file && (
            <div className="flex items-center bg-slate-100 rounded-full px-4 py-1.5 gap-2 border border-slate-200">
              <FileText className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700 truncate max-w-[200px]">{file.name}</span>
            </div>
          )}
          
          <div className="h-8 w-px bg-slate-200 mx-2" />
          
          {file && (
            <button 
              onClick={clearFile}
              className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-full transition-colors text-xs font-bold uppercase tracking-wider border border-rose-100"
              title="Xóa tài liệu hiện tại"
            >
              <Trash2 className="w-4 h-4" />
              <span>Xóa PDF</span>
            </button>
          )}

          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600"
            title="Cài đặt API Key"
          >
            <Settings className="w-5 h-5" />
          </button>
          
          <button 
            onClick={() => setIsFullScreen(!isFullScreen)}
            className={cn(
              "p-2 rounded-full transition-all",
              isFullScreen ? "bg-indigo-600 text-white shadow-lg" : "hover:bg-slate-100 text-slate-600"
            )}
            title={isFullScreen ? "Thoát chế độ tập trung (Hiện bản dịch)" : "Chế độ tập trung (Ẩn bản dịch)"}
          >
            {isFullScreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden relative">
        {!file ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-xl w-full text-center"
            >
              <div className="mb-8 relative inline-block">
                <div className="absolute -inset-4 bg-indigo-100 rounded-full blur-2xl opacity-50 animate-pulse" />
                <div className="relative bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
                  <Upload className="w-16 h-16 text-indigo-600 mx-auto mb-6" />
                  <h2 className="text-2xl font-display font-bold text-slate-800 mb-2">Tải lên tài liệu y khoa</h2>
                  <p className="text-slate-500 mb-8">Hỗ trợ file PDF lên tới 200MB. Dịch thuật chuyên sâu giữ nguyên định dạng.</p>
                  
                  <label className="block">
                    <span className="sr-only">Chọn file PDF</span>
                    <input 
                      type="file" 
                      accept=".pdf" 
                      onChange={handleFileChange}
                      className="block w-full text-sm text-slate-500
                        file:mr-4 file:py-3 file:px-8
                        file:rounded-full file:border-0
                        file:text-sm file:font-semibold
                        file:bg-indigo-600 file:text-white
                        hover:file:bg-indigo-700
                        cursor-pointer transition-all"
                    />
                  </label>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-6 text-slate-400">
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <span className="text-xs font-medium uppercase tracking-wider">Chuẩn Y Khoa</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <span className="text-xs font-medium uppercase tracking-wider">Giữ Định Dạng</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <span className="text-xs font-medium uppercase tracking-wider">Tốc Độ Cao</span>
                </div>
              </div>

              <div className="mt-12 p-5 bg-amber-50 rounded-2xl border border-amber-100 max-w-md mx-auto">
                <p className="text-xs text-amber-700 leading-relaxed">
                  <span className="font-bold">Lưu ý cho file lớn:</span> Với các tài liệu trên 100 trang (như file 900 trang bạn đề cập), trình duyệt có thể bị quá tải. Để có trải nghiệm tốt nhất, bạn nên tách file thành các phần nhỏ (khoảng 50-100 trang mỗi file) trước khi tải lên.
                </p>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="flex-1 flex divide-x divide-slate-200 min-h-0 w-full overflow-hidden relative">
            {/* Left Side: Original PDF */}
            <div className={cn(
              "flex flex-col bg-slate-200/50 overflow-hidden border-r border-slate-200 transition-all duration-300 ease-in-out",
              isFullScreen ? "w-full" : "w-1/2"
            )}>
              <div className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 z-20 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Original PDF</span>
                  {isFullScreen && (
                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-600 text-[10px] font-bold rounded-full uppercase tracking-tighter">Focus Mode</span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-1 hover:bg-slate-100 rounded disabled:opacity-30"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-1">
                      <input 
                        type="number" 
                        min={1} 
                        max={numPages}
                        value={currentPage}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val) && val >= 1 && val <= numPages) {
                            setCurrentPage(val);
                          }
                        }}
                        className="w-12 h-7 text-center text-sm font-mono border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <span className="text-sm font-mono text-slate-400">/ {numPages}</span>
                    </div>
                    <button 
                      onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                      disabled={currentPage === numPages}
                      className="p-1 hover:bg-slate-100 rounded disabled:opacity-30"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="h-4 w-px bg-slate-300" />
                  <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                    <button 
                      onClick={() => setIsPanning(!isPanning)}
                      className={cn(
                        "p-1 rounded transition-all",
                        isPanning ? "bg-indigo-600 text-white shadow-sm" : "hover:bg-white text-slate-600"
                      )}
                      title={isPanning ? "Tắt chế độ di chuyển" : "Bật chế độ di chuyển (Hand Tool)"}
                    >
                      <Search className={cn("w-4 h-4", isPanning && "rotate-45")} />
                    </button>
                    <div className="w-px h-3 bg-slate-300 mx-0.5" />
                    <button 
                      onClick={() => {
                        setIsAutoFit(false);
                        setZoom(z => Math.max(0.5, z - 0.1));
                      }} 
                      className="p-1 hover:bg-white hover:shadow-sm rounded transition-all text-slate-600"
                      title="Thu nhỏ (Ctrl + Cuộn chuột)"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-[10px] font-bold font-mono text-slate-500 w-10 text-center">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button 
                      onClick={() => {
                        setIsAutoFit(false);
                        setZoom(z => Math.min(3, z + 0.1));
                      }} 
                      className="p-1 hover:bg-white hover:shadow-sm rounded transition-all text-slate-600"
                      title="Phóng to (Ctrl + Cuộn chuột)"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={fitToWidthAction} 
                      className={cn(
                        "p-1 rounded transition-all ml-1",
                        isAutoFit ? "bg-indigo-600 text-white shadow-sm" : "hover:bg-white text-slate-600"
                      )}
                      title="Vừa khít chiều rộng (Tự động)"
                    >
                      <Maximize className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="h-4 w-px bg-slate-300" />
                  <label className="flex items-center gap-2 px-2 py-1 hover:bg-slate-100 rounded cursor-pointer transition-colors text-slate-600">
                    <RefreshCcw className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase">Tải file khác</span>
                    <input type="file" accept=".pdf" onChange={handleFileChange} className="hidden" />
                  </label>
                </div>
              </div>
              <div 
                className={cn(
                  "flex-1 overflow-auto p-8 pdf-container relative bg-slate-200/50",
                  isPanning ? "cursor-grab" : "cursor-auto"
                )} 
                ref={containerRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <div className="min-w-full min-h-full flex">
                  <div className="relative m-auto">
                    {(isPdfLoading || isRendering) && (
                      <div className="absolute inset-0 flex items-center justify-center bg-slate-200/30 z-10 rounded-lg">
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                      </div>
                    )}
                    {pdfError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-20 p-4 text-center rounded-lg">
                        <div className="max-w-xs">
                          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-2" />
                          <p className="text-sm font-bold text-slate-800">{pdfError}</p>
                        </div>
                      </div>
                    )}
                    <canvas 
                      ref={canvasRef} 
                      className={cn(
                        "shadow-2xl rounded-lg border border-slate-200 bg-white transition-opacity duration-200", 
                        (isPdfLoading || isRendering) ? "opacity-50" : "opacity-100"
                      )} 
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Side: Translation */}
            {!isFullScreen && (
              <motion.div 
                initial={{ x: 300, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 300, opacity: 0 }}
                className="w-1/2 flex flex-col bg-white overflow-hidden"
              >
                <div className="h-12 border-b border-slate-200 flex items-center justify-between px-4 shrink-0 z-20 shadow-sm">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest">Vietnamese Translation</span>
                  
                  <div className="h-4 w-px bg-slate-200" />
                  
                  <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-1">
                    <div className="flex items-center gap-1">
                      <FontIcon className="w-3.5 h-3.5 text-slate-400" />
                      <select 
                        value={fontFamily}
                        onChange={(e) => setFontFamily(e.target.value)}
                        className="text-[10px] font-bold bg-transparent border-none focus:ring-0 cursor-pointer text-slate-600"
                      >
                        <option value="Inter">Sans (Inter)</option>
                        <option value="Cormorant Garamond">Serif (Garamond)</option>
                        <option value="Playfair Display">Display (Playfair)</option>
                        <option value="JetBrains Mono">Mono (JetBrains)</option>
                      </select>
                    </div>
                    
                    <div className="w-px h-3 bg-slate-200 mx-1" />
                    
                    <div className="flex items-center gap-1">
                      <ALargeSmall className="w-3.5 h-3.5 text-slate-400" />
                      <select 
                        value={fontSize}
                        onChange={(e) => setFontSize(Number(e.target.value))}
                        className="text-[10px] font-bold bg-transparent border-none focus:ring-0 cursor-pointer text-slate-600"
                      >
                        {[12, 13, 14, 15, 16, 18, 20].map(size => (
                          <option key={size} value={size}>{size}px</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {translations[currentPage]?.status === 'success' && (
                    <button className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                      <Download className="w-3 h-3" /> Tải xuống
                    </button>
                  )}
                  <button 
                    onClick={translateCurrentPage}
                    disabled={isTranslating}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-2",
                      isTranslating 
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed" 
                        : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200"
                    )}
                  >
                    {isTranslating ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Đang dịch...
                      </>
                    ) : (
                      <>
                        <Languages className="w-3 h-3" />
                        Dịch trang này
                      </>
                    )}
                  </button>
                  {!apiKey && !process.env.GEMINI_API_KEY && (
                    <div className="absolute top-full right-0 mt-2 p-3 bg-rose-50 border border-rose-100 rounded-xl shadow-xl z-50 w-64">
                      <div className="flex gap-2 text-rose-600 mb-1">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span className="text-[10px] font-bold uppercase">Thiếu API Key</span>
                      </div>
                      <p className="text-[10px] text-rose-500 leading-tight">
                        Bạn đang mở ứng dụng ở cửa sổ mới. Vui lòng nhập API Key trong phần Cài đặt để tiếp tục dịch.
                      </p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex-1 overflow-auto p-12 bg-white">
                <AnimatePresence mode="wait">
                  {!translations[currentPage] ? (
                    <motion.div 
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full flex flex-col items-center justify-center text-slate-400 text-center"
                    >
                      <Search className="w-12 h-12 mb-4 opacity-20" />
                      <p className="text-sm font-medium">Chưa có bản dịch cho trang này.</p>
                      <p className="text-xs">Nhấn "Dịch trang này" để bắt đầu.</p>
                    </motion.div>
                  ) : translations[currentPage].status === 'loading' && !translations[currentPage].content ? (
                    <motion.div 
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full flex flex-col items-center justify-center gap-4"
                    >
                      <div className="relative">
                        <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
                        <Languages className="absolute inset-0 m-auto w-5 h-5 text-indigo-600" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-slate-700">Đang phân tích y khoa...</p>
                        <p className="text-xs text-slate-400">Gemini đang xử lý hình ảnh và văn bản</p>
                      </div>
                    </motion.div>
                  ) : translations[currentPage].status === 'error' ? (
                    <motion.div 
                      key="error"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full flex flex-col items-center justify-center gap-4 text-rose-500 bg-rose-50 rounded-2xl p-8"
                    >
                      <AlertCircle className="w-12 h-12" />
                      <p className="text-sm font-bold text-center">{translations[currentPage].content}</p>
                      <div className="flex flex-wrap justify-center gap-4">
                        <button 
                          onClick={() => setShowSettings(true)}
                          className="px-4 py-2 bg-white border border-rose-200 rounded-xl text-xs font-bold hover:bg-rose-100 transition-colors"
                        >
                          Cấu hình API Key
                        </button>
                        {(window as any).aistudio?.openSelectKey && (
                          <button 
                            onClick={async () => {
                              await geminiService.current?.openKeySelection();
                              translateCurrentPage();
                            }}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                          >
                            Chọn Key từ AI Studio
                          </button>
                        )}
                        <button 
                          onClick={translateCurrentPage}
                          className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-colors"
                        >
                          Thử lại
                        </button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="content"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="markdown-body"
                      style={{ 
                        fontSize: `${fontSize}px`,
                        fontFamily: fontFamily === 'Inter' ? 'var(--font-sans)' : 
                                   fontFamily === 'JetBrains Mono' ? 'var(--font-mono)' : 
                                   fontFamily === 'Playfair Display' ? 'var(--font-display)' :
                                   fontFamily === 'Cormorant Garamond' ? 'var(--font-serif)' :
                                   fontFamily
                      }}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {translations[currentPage].content}
                      </ReactMarkdown>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-indigo-100 p-2 rounded-xl">
                    <Settings className="text-indigo-600 w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-display font-bold text-slate-800">Cấu hình API</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                      Gemini API Key
                    </label>
                    <input 
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Nhập API Key của bạn (Tùy chọn)..."
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono text-sm"
                    />
                    <div className="mt-2 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                      <p className="text-[10px] text-indigo-700 leading-relaxed">
                        <span className="font-bold">Chế độ Tự động:</span> Nếu để trống, ứng dụng sẽ sử dụng API Key mặc định của hệ thống. Bạn chỉ cần nhập nếu muốn sử dụng hạn mức riêng.
                      </p>
                    </div>
                    {(window as any).aistudio?.openSelectKey && (
                      <button 
                        onClick={async () => {
                          await geminiService.current?.openKeySelection();
                          setShowSettings(false);
                        }}
                        className="mt-4 w-full px-4 py-3 bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold hover:bg-indigo-200 transition-all flex items-center justify-center gap-2"
                      >
                        <Settings className="w-4 h-4" />
                        Chọn API Key từ AI Studio
                      </button>
                    )}
                  </div>
                  
                  <div className="pt-4 flex gap-3">
                    <button 
                      onClick={() => setShowSettings(false)}
                      className="flex-1 px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                    >
                      Hủy
                    </button>
                    <button 
                      onClick={() => saveApiKey(apiKey)}
                      className="flex-1 px-6 py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                    >
                      Lưu thay đổi
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      {!file && (
        <footer className="h-12 border-t border-slate-200 bg-white flex items-center justify-center px-6 shrink-0">
          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-[0.2em]">
            Powered by Google Gemini 2.0 & PDF.js • Medical Grade Translation
          </p>
        </footer>
      )}
    </div>
  );
}
