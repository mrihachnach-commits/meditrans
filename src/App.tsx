/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { MedicalDictionary } from './components/MedicalDictionary';

// Use a reliable CDN for the worker that matches the installed version exactly
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

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
  Hand,
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
import { MedicalApiService } from './services/medicalApiService';
import { TranslationEngine, TranslationService } from './services/translationService';

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
  const [currentJob, setCurrentJob] = useState(1);
  const PAGES_PER_JOB = 100;
  const totalJobs = Math.ceil(numPages / PAGES_PER_JOB);

  // Use a ref for the master list to avoid massive state updates causing lag
  const [translations, setTranslations] = useState<TranslationState>({});
  const translationsRef = useRef<TranslationState>({});
  const [activeTranslation, setActiveTranslation] = useState<{page: number, content: string, status: string} | null>(null);
  const translatingPagesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    translationsRef.current = translations;
  }, [translations]);

  // Sync currentJob with currentPage (Virtual Job)
  useEffect(() => {
    if (numPages > 0) {
      const newJob = Math.ceil(currentPage / PAGES_PER_JOB);
      if (newJob !== currentJob) {
        setCurrentJob(newJob);
      }
    }
  }, [currentPage, numPages, currentJob]);

  const [isTranslating, setIsTranslating] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState<TranslationEngine>(() => {
    const saved = localStorage.getItem('selected_engine');
    return (saved as TranslationEngine) || 'gemini-flash';
  });
  const [engineKeys, setEngineKeys] = useState<Record<TranslationEngine, string>>(() => {
    const saved = localStorage.getItem('engine_keys');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse engine keys:", e);
      }
    }
    
    // Initial defaults
    const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    const defaultKey = (envKey && envKey !== "MY_GEMINI_API_KEY" && envKey.trim() !== "") ? envKey : '';
    
    return {
      'gemini-flash': defaultKey,
      'gemini-pro': defaultKey,
      'medical-specialized': ''
    };
  });
  const [showSettings, setShowSettings] = useState(false);
  const [hasEnvKey, setHasEnvKey] = useState(false);

  useEffect(() => {
    const checkKey = async () => {
      if (translationService.current) {
        const hasKey = await translationService.current.hasApiKey();
        setHasEnvKey(hasKey);
      }
    };
    checkKey();
  }, [selectedEngine, engineKeys]);

  const [isFullScreen, setIsFullScreen] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [zoom, setZoom] = useState(0.82); // Default to 82% as requested
  const [isAutoFit, setIsAutoFit] = useState(true);
  
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const isRenderingRef = useRef(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  
  const [fontSize, setFontSize] = useState(14);
  const [fontFamily, setFontFamily] = useState('Inter');
  
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
  const [dictionaryPosition, setDictionaryPosition] = useState({ x: 0, y: 0 });
  
  const clearFile = () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFile(null);
    setFileUrl(null);
    setPdfDoc(null);
    setNumPages(0);
    setCurrentPage(1);
    setCurrentJob(1);
    setTranslations({});
    setPdfError(null);
    isRenderingRef.current = false;
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);
  const translationService = useRef<TranslationService | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      // Clear previous
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      if (pdfDoc) await pdfDoc.destroy();

      setFile(selectedFile);
      setTranslations({});
      setCurrentPage(1);
      setCurrentJob(1);
      setIsPdfLoading(true);
      setPdfError(null);
      
      try {
        // Use URL.createObjectURL for memory efficiency - browser handles the file access
        const url = URL.createObjectURL(selectedFile);
        setFileUrl(url);
        
        const loadingTask = pdfjs.getDocument({
          url,
          cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
          cMapPacked: true,
          disableAutoFetch: false,
          disableStream: false,
        });

        const pdf = await loadingTask.promise;
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
      } catch (error) {
        console.error("Error loading PDF:", error);
        setPdfError("Không thể tải file PDF. Vui lòng thử lại.");
      } finally {
        setIsPdfLoading(false);
      }
    }
  };

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDoc || !canvasRef.current || !textLayerRef.current) return;

    setIsRendering(true);
    isRenderingRef.current = true;
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
        canvas.style.width = `${viewport.width / 2}px`;
        canvas.style.height = `${viewport.height / 2}px`;
        
        const renderTask = page.render({
          canvasContext: context,
          viewport: viewport,
        } as any);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        
        // Render text layer
        const textContent = await page.getTextContent();
        const textLayerDiv = textLayerRef.current;
        textLayerDiv.innerHTML = '';
        
        // Use the same scale as the visual representation
        const textViewport = page.getViewport({ scale: zoom });
        textLayerDiv.style.width = `${textViewport.width}px`;
        textLayerDiv.style.height = `${textViewport.height}px`;
        textLayerDiv.style.left = '0';
        textLayerDiv.style.top = '0';
        
        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport: textViewport,
        });
        await textLayer.render();

        // Crucial for memory: cleanup page resources
        page.cleanup();
      }
    } catch (error: any) {
      if (error.name !== 'RenderingCancelledException') {
        console.error("Error rendering page:", error);
      }
    } finally {
      setIsRendering(false);
      isRenderingRef.current = false;
    }
  }, [pdfDoc, zoom]);

  const fitToWidth = async () => {
    if (!pdfDoc || !containerRef.current) return;
    
    requestAnimationFrame(async () => {
      if (!pdfDoc || !containerRef.current) return;
      try {
        const page = await pdfDoc.getPage(currentPage);
        const viewport = page.getViewport({ scale: 1 });
        const rect = containerRef.current.getBoundingClientRect();
        const containerWidth = rect.width - 64;
        const newZoom = containerWidth / viewport.width;
        setZoom(Number(newZoom.toFixed(2)));
        page.cleanup();
      } catch (error) {
        console.error("Error fitting to width:", error);
      }
    });
  };

  const fitToWidthAction = () => {
    setIsAutoFit(true);
    fitToWidth();
  };

  const translateCurrentPage = useCallback(async (pageNumber?: number, force = false) => {
    const targetPage = pageNumber ?? currentPage;
    if (!canvasRef.current || !translationService.current) return;

    // Avoid double translation for the same page unless forced
    const currentStatus = translationsRef.current[targetPage]?.status;
    if (!force && (translatingPagesRef.current.has(targetPage) || (currentStatus === 'loading' || currentStatus === 'success'))) {
      return;
    }

    // If still rendering, we don't want to capture a half-rendered or old page
    if (isRenderingRef.current) {
      // Retry after a short delay
      setTimeout(() => translateCurrentPage(targetPage, force), 500);
      return;
    }
    
    // Check if we have an API key before starting
    const hasKey = await translationService.current.hasApiKey();
    if (!hasKey) {
      setTranslations(prev => ({
        ...prev,
        [targetPage]: { 
          content: 'Thiếu API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn từ hệ thống.', 
          status: 'error' 
        }
      }));
      return;
    }

    translatingPagesRef.current.add(targetPage);
    setIsTranslating(true);
    
    // Set active translation for smooth streaming without re-rendering the whole list
    setActiveTranslation({ page: targetPage, content: '', status: 'loading' });

    try {
      await new Promise(resolve => setTimeout(resolve, 200));
      const imageBuffer = canvasRef.current.toDataURL('image/jpeg', 0.8);
      const stream = translationService.current.translateMedicalPageStream({
        imageBuffer,
        pageNumber: targetPage
      });
      
      let fullContent = "";
      for await (const chunk of stream) {
        fullContent += chunk;
        setActiveTranslation({ page: targetPage, content: fullContent, status: 'loading' });
      }
      
      const finalResult = { content: fullContent, status: 'success' as const };
      setTranslations(prev => ({ ...prev, [targetPage]: finalResult }));
      setActiveTranslation(null);
    } catch (error: any) {
      console.error("Translation Error:", error);
      const errorMessage = error instanceof Error ? error.message : 'Dịch thuật thất bại.';
      const errorResult = { content: errorMessage, status: 'error' as const };
      setTranslations(prev => ({ ...prev, [targetPage]: errorResult }));
      setActiveTranslation(null);
    } finally {
      translatingPagesRef.current.delete(targetPage);
      setIsTranslating(false);
    }
  }, [currentPage, translationService]);

  useEffect(() => {
    const key = engineKeys[selectedEngine];
    if (selectedEngine === 'gemini-flash') {
      translationService.current = new GeminiService(key, "gemini-3-flash-preview");
    } else if (selectedEngine === 'gemini-pro') {
      translationService.current = new GeminiService(key, "gemini-3.1-pro-preview");
    } else if (selectedEngine === 'medical-specialized') {
      translationService.current = new MedicalApiService(key);
    }
  }, [selectedEngine, engineKeys]);

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

  useEffect(() => {
    if (pdfDoc && autoTranslate && !isRendering && !translations[currentPage]) {
      const timer = setTimeout(() => {
        // Re-check conditions after delay
        if (!isRenderingRef.current && !translationsRef.current[currentPage]) {
          translateCurrentPage(currentPage);
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [currentPage, pdfDoc, autoTranslate, isRendering, translations, translateCurrentPage]);

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

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      e.preventDefault();
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      containerRef.current.scrollLeft = dragStart.scrollLeft - dx;
      containerRef.current.scrollTop = dragStart.scrollTop - dy;
    };

    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        document.body.style.cursor = 'auto';
        if (containerRef.current) {
          containerRef.current.style.cursor = isPanning ? 'grab' : 'auto';
        }
      }
    };

    if (isDragging) {
      document.body.style.cursor = 'grabbing';
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, isPanning, dragStart]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isPanning || !containerRef.current) return;
    
    // Only handle left click
    if (e.button !== 0) return;

    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop
    });
    containerRef.current.style.cursor = 'grabbing';
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // Handle text selection for dictionary
    // Use a small timeout to ensure the selection is fully captured by the browser
    setTimeout(() => {
      const selection = window.getSelection();
      const selectedText = selection?.toString() || "";
      
      if (selectedText.trim().length > 0) {
        // Verify selection is within our target areas to avoid accidental triggers
        const anchorNode = selection?.anchorNode;
        if (!anchorNode) return;
        
        const targetElement = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
        const isInsidePDF = targetElement?.closest('.textLayer');
        const isInsideTranslation = targetElement?.closest('.markdown-body');
        
        if (!isInsidePDF && !isInsideTranslation) return;

        // Clean the selected text: collapse whitespace and remove surrounding punctuation
        // We also remove soft hyphens and other invisible characters common in PDFs
        const text = selectedText
          .replace(/[\u00AD\u200B\u200C\u200D]/g, '') // Remove soft hyphens and zero-width spaces
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/[.,;:!?()\[\]{}'"]+$/, '')
          .replace(/^[.,;:!?()\[\]{}'"]+/, '');
        
        // Only trigger if it looks like a medical term (not too long, not just numbers)
        const isNumeric = /^\d+$/.test(text);
        const wordCount = text.split(/\s+/).length;
        
        // Check if selection spans multiple lines by comparing rects
        let isSingleLine = true;
        try {
          const range = selection?.getRangeAt(0);
          if (range) {
            const rects = range.getClientRects();
            if (rects.length > 1) {
              // If multiple rects, check if they are on different vertical levels
              const firstRect = rects[0];
              for (let i = 1; i < rects.length; i++) {
                if (Math.abs(rects[i].top - firstRect.top) > 10) {
                  isSingleLine = false;
                  break;
                }
              }
            }
          }
        } catch (e) {}

        if (text.length > 1 && text.length < 50 && !isNumeric && wordCount <= 4 && isSingleLine) {
          try {
            const range = selection?.getRangeAt(0);
            if (range) {
              const rect = range.getBoundingClientRect();
              // Position relative to the viewport
              setDictionaryPosition({ x: rect.left, y: rect.bottom + 10 });
              setSelectedTerm(text);
            }
          } catch (err) {
            // Range might be invalid if selection changed rapidly
          }
        }
      }
    }, 50);
  };

  const saveSettings = (engine: TranslationEngine, keys: Record<TranslationEngine, string>) => {
    setSelectedEngine(engine);
    setEngineKeys(keys);
    localStorage.setItem('selected_engine', engine);
    localStorage.setItem('engine_keys', JSON.stringify(keys));
    setShowSettings(false);
  };

  const [tempEngine, setTempEngine] = useState<TranslationEngine>(selectedEngine);
  const [tempKeys, setTempKeys] = useState<Record<TranslationEngine, string>>(engineKeys);

  useEffect(() => {
    if (showSettings) {
      setTempEngine(selectedEngine);
      setTempKeys(engineKeys);
    }
  }, [showSettings, selectedEngine, engineKeys]);

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
            </motion.div>
          </div>
        ) : (
          <div className="flex-1 flex divide-x divide-slate-200 min-h-0 w-full overflow-hidden relative">
            {/* Left Side: Original PDF */}
            <div className={cn(
              "flex flex-col bg-slate-200/50 overflow-hidden border-r border-slate-200 transition-all duration-300 ease-in-out relative",
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
                  {totalJobs > 1 && (
                    <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-2 py-1 border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Phần (Job):</span>
                      <select 
                        value={currentJob}
                        onChange={(e) => {
                          const job = parseInt(e.target.value);
                          setCurrentJob(job);
                          setCurrentPage((job - 1) * PAGES_PER_JOB + 1);
                        }}
                        className="h-6 text-[10px] font-bold border-none rounded bg-white px-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-sm"
                      >
                        {Array.from({ length: totalJobs }, (_, i) => i + 1).map(job => (
                          <option key={job} value={job}>
                            {job} ({ (job-1)*PAGES_PER_JOB + 1 } - { Math.min(job*PAGES_PER_JOB, numPages) })
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
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
                      <Hand className="w-4 h-4" />
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
                  isPanning ? "cursor-grab select-none touch-none" : "cursor-auto"
                )} 
                ref={containerRef}
                onMouseDown={handleMouseDown}
              >
                <div className="inline-block min-w-full text-center align-top">
                  <div className="inline-block text-left relative my-8 shadow-2xl rounded-lg border border-slate-200 bg-white overflow-hidden shrink-0">
                    {(isPdfLoading || isRendering) && (
                      <div className="absolute inset-0 flex items-center justify-center bg-slate-200/30 z-20">
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                        </div>
                      </div>
                    )}
                    {pdfError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-20 p-4 text-center">
                        <div className="max-w-xs">
                          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-2" />
                          <p className="text-sm font-bold text-slate-800">{pdfError}</p>
                        </div>
                      </div>
                    )}
                    <canvas 
                      ref={canvasRef} 
                      className={cn(
                        "transition-opacity duration-200 relative z-0 block", 
                        (isPdfLoading || isRendering) ? "opacity-50" : "opacity-100"
                      )} 
                    />
                    <div 
                      ref={textLayerRef}
                      className="absolute inset-0 textLayer pointer-events-auto z-10"
                      onMouseUp={handleMouseUp}
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
                  
                  <button 
                    onClick={() => setAutoTranslate(!autoTranslate)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1 rounded-full transition-all border",
                      autoTranslate 
                        ? "bg-emerald-50 border-emerald-200 text-emerald-600" 
                        : "bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600"
                    )}
                    title="Tự động dịch khi chuyển trang"
                  >
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      autoTranslate ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                    )} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">Auto-Translate</span>
                  </button>

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
                    onClick={() => translateCurrentPage(currentPage, true)}
                    disabled={isTranslating || isRendering}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-2",
                      (isTranslating || isRendering)
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed" 
                        : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200"
                    )}
                  >
                    {isTranslating || isRendering ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {isRendering ? 'Đang vẽ trang...' : 'Đang dịch...'}
                      </>
                    ) : (
                      <>
                        <Languages className="w-3 h-3" />
                        {translations[currentPage] ? 'Dịch lại' : 'Dịch trang này'}
                      </>
                    )}
                  </button>
                  {!engineKeys[selectedEngine] && !hasEnvKey && (
                    <div className="absolute top-full right-0 mt-2 p-3 bg-rose-50 border border-rose-100 rounded-xl shadow-xl z-50 w-64">
                      <div className="flex gap-2 text-rose-600 mb-1">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span className="text-[10px] font-bold uppercase">Thiếu API Key</span>
                      </div>
                      <p className="text-[10px] text-rose-500 leading-tight">
                        Vui lòng nhập API Key trong phần Cài đặt hoặc chọn API Key từ hệ thống để tiếp tục dịch.
                      </p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex-1 overflow-auto p-12 bg-white">
                <AnimatePresence mode="wait">
                  {(!translations[currentPage] && (!activeTranslation || activeTranslation.page !== currentPage)) ? (
                    (isRendering || isPdfLoading) ? (
                      <motion.div 
                        key="rendering"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="h-full flex flex-col items-center justify-center text-slate-400 text-center"
                      >
                        <Loader2 className="w-12 h-12 mb-4 text-indigo-400 animate-spin" />
                        <p className="text-sm font-medium">Đang chuẩn bị trang...</p>
                        <p className="text-xs">Vui lòng đợi trong giây lát</p>
                      </motion.div>
                    ) : (
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
                    )
                  ) : (translations[currentPage]?.status === 'loading' && !translations[currentPage].content && (!activeTranslation || activeTranslation.page !== currentPage)) ? (
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
                  ) : translations[currentPage]?.status === 'error' ? (
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
                              if (translationService.current instanceof GeminiService) {
                                await (translationService.current as any).openKeySelection();
                                translateCurrentPage(currentPage, true);
                              }
                            }}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                          >
                            Chọn Key từ AI Studio
                          </button>
                        )}
                        <button 
                          onClick={() => translateCurrentPage(currentPage, true)}
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
                      className="markdown-body select-text"
                      onMouseUp={handleMouseUp}
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
                        {activeTranslation && activeTranslation.page === currentPage 
                          ? activeTranslation.content 
                          : translations[currentPage]?.content || ''}
                      </ReactMarkdown>
                      {activeTranslation && activeTranslation.page === currentPage && (
                        <div className="mt-4 flex items-center gap-2 text-indigo-400 italic text-xs animate-pulse">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Đang dịch...</span>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </main>

      {/* Dictionary Pop-up */}
      {selectedTerm && (
        <MedicalDictionary 
          selectedTerm={selectedTerm}
          onClose={() => setSelectedTerm(null)}
          translationService={translationService.current}
          position={dictionaryPosition}
        />
      )}

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
              className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-indigo-100 p-2 rounded-xl">
                    <Settings className="text-indigo-600 w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-display font-bold text-slate-800">Cấu hình Translation Engine</h3>
                </div>
                
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
                      Chọn Engine Dịch thuật
                    </label>
                    <div className="grid grid-cols-1 gap-3">
                      {[
                        { id: 'gemini-flash', name: 'Gemini 2.0 Flash', desc: 'Nhanh, hiệu quả, phù hợp đa số tài liệu.' },
                        { id: 'gemini-pro', name: 'Gemini 1.5 Pro', desc: 'Chính xác cao, xử lý ngữ cảnh phức tạp tốt hơn.' },
                        { id: 'medical-specialized', name: 'Medical Specialized API', desc: 'API chuyên dụng cho thuật ngữ y khoa (Mô phỏng).' }
                      ].map((engine) => (
                        <button
                          key={engine.id}
                          onClick={() => setTempEngine(engine.id as TranslationEngine)}
                          className={cn(
                            "flex flex-col items-start p-4 rounded-2xl border-2 transition-all text-left",
                            tempEngine === engine.id 
                              ? "border-indigo-600 bg-indigo-50/50" 
                              : "border-slate-100 hover:border-slate-200 bg-white"
                          )}
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <span className={cn("font-bold text-sm", tempEngine === engine.id ? "text-indigo-700" : "text-slate-700")}>
                              {engine.name}
                            </span>
                            {tempEngine === engine.id && <CheckCircle2 className="w-4 h-4 text-indigo-600" />}
                          </div>
                          <span className="text-[10px] text-slate-500 leading-tight">{engine.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                      API Key cho {tempEngine === 'medical-specialized' ? 'Medical API' : 'Gemini'}
                    </label>
                    <input 
                      type="password"
                      value={tempKeys[tempEngine]}
                      onChange={(e) => setTempKeys(prev => ({ ...prev, [tempEngine]: e.target.value }))}
                      placeholder={`Nhập API Key cho ${tempEngine}...`}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono text-sm"
                    />
                    
                    {tempEngine.startsWith('gemini') && (
                      <div className="mt-2 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                        <p className="text-[10px] text-indigo-700 leading-relaxed">
                          <span className="font-bold">Ghi chú:</span> Nếu để trống, ứng dụng sẽ sử dụng API Key mặc định từ hệ thống (nếu có).
                        </p>
                      </div>
                    )}

                    {tempEngine.startsWith('gemini') && (window as any).aistudio?.openSelectKey && (
                      <button 
                        onClick={async () => {
                          if (translationService.current instanceof GeminiService) {
                            await (translationService.current as any).openKeySelection();
                            setShowSettings(false);
                          }
                        }}
                        className="mt-3 w-full px-4 py-2.5 bg-indigo-100 text-indigo-700 rounded-xl text-[10px] font-bold hover:bg-indigo-200 transition-all flex items-center justify-center gap-2"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Sử dụng API Key từ AI Studio
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
                      onClick={() => saveSettings(tempEngine, tempKeys)}
                      className="flex-1 px-6 py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                    >
                      Lưu cấu hình
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
