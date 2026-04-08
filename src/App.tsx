/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

// Polyfill for Promise.withResolvers (required for pdfjs-dist 4.0+ on older browsers/iOS < 17.4)
if (typeof (Promise as any).withResolvers === 'undefined') {
  (Promise as any).withResolvers = function() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Polyfill for structuredClone (required for newer pdfjs-dist on older browsers)
if (typeof (window as any).structuredClone === 'undefined') {
  (window as any).structuredClone = function(obj: any) {
    if (obj === undefined) return undefined;
    return JSON.parse(JSON.stringify(obj));
  };
}

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { MedicalDictionary } from './components/MedicalDictionary';

import { Logo, LogoWithText } from './components/Logo';

// Use a reliable CDN for the worker that matches the installed version exactly
// We load the worker via fetch and create a Blob URL to bypass cross-origin worker restrictions on some mobile browsers
const loadWorker = async () => {
  const workerUrl = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.js`;
  try {
    const response = await fetch(workerUrl);
    const scriptText = await response.text();
    // Explicitly set the MIME type to application/javascript to satisfy strict browser checks (especially on iOS)
    const blob = new Blob([scriptText], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    pdfjs.GlobalWorkerOptions.workerSrc = blobUrl;
    console.log("[MediTrans AI] PDF Worker loaded successfully via Blob URL with explicit MIME type");
  } catch (error) {
    console.error("[MediTrans AI] Failed to load PDF Worker via Blob, falling back to direct URL:", error);
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
};
loadWorker();

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
  Type as FontIcon,
  LogIn,
  LogOut,
  Plus,
  Key,
  ShieldCheck,
  User as UserIcon,
  Square,
  Check,
  Copy
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { saveAs } from 'file-saver';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GeminiService } from './services/geminiService';
import { MedicalApiService } from './services/medicalApiService';
import { TranslationEngine, TranslationService } from './services/translationService';
import { 
  auth, 
  signOut, 
  onAuthStateChanged, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  db, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  onSnapshot, 
  deleteDoc, 
  updateDoc, 
  serverTimestamp,
  User,
  Timestamp
} from './firebase';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Đã có lỗi xảy ra. Vui lòng tải lại trang.";
      try {
        if (this.state.error?.message.startsWith('{')) {
          const info = JSON.parse(this.state.error.message);
          errorMessage = `Lỗi hệ thống (${info.operationType}): ${info.error}`;
        }
      } catch (e) {}

      return (
        <div className="h-screen flex flex-col items-center justify-center bg-slate-50 p-8 text-center">
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 max-w-md">
            <AlertCircle className="w-16 h-16 text-rose-500 mx-auto mb-6" />
            <h2 className="text-2xl font-display font-bold text-slate-800 mb-4">Rất tiếc!</h2>
            <p className="text-slate-500 mb-8">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-indigo-600 text-white rounded-full font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

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
  const currentPageRef = useRef<number>(1);
  const [activeTranslation, setActiveTranslation] = useState<{page: number, content: string, status: string} | null>(null);
  const translatingPagesRef = useRef<Set<number>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileIdRef = useRef<number>(0);
  const preTranslateControllersRef = useRef<Map<number, AbortController>>(new Map());

  useEffect(() => {
    translationsRef.current = translations;
  }, [translations]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

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
  const isTranslatingRef = useRef(false);
  useEffect(() => {
    isTranslatingRef.current = isTranslating;
  }, [isTranslating]);
  const selectedEngine: TranslationEngine = 'gemini-flash';
  
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
    const fallbackKey = "AIzaSyCNmiXe5GSlUcia4CEI78O50VjrD6WwTK0";
    const defaultKey = (envKey && envKey.trim() !== "" && envKey !== "MY_GEMINI_API_KEY") ? envKey : fallbackKey;
    
    return {
      'gemini-flash': defaultKey,
      'gemini-pro': defaultKey,
      'medical-specialized': ''
    };
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [selectedPagesToDownload, setSelectedPagesToDownload] = useState<number[]>([]);
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
  const isFullScreenRef = useRef(false);

  const toggleFullScreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch (err) {
      console.error(`Error attempting to enable full-screen mode: ${err}`);
      // Fallback to internal state if native fails (e.g. in some iframe environments)
      setIsFullScreen(!isFullScreen);
    }
  };

  useEffect(() => {
    const handleFullScreenChange = () => {
      const isNativeFull = !!document.fullscreenElement;
      setIsFullScreen(isNativeFull);
      isFullScreenRef.current = isNativeFull;
      if (isNativeFull) setSelectedTerm(null);
    };

    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
  }, []);
  const [showTranslationPanel, setShowTranslationPanel] = useState(false);
  const [mobileViewMode, setMobileViewMode] = useState<'pdf' | 'translation'>('pdf');
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [zoom, setZoom] = useState(0.82); // Default to 82% as requested
  const [isAutoFit, setIsAutoFit] = useState(true);
  
  const [isPanning, setIsPanning] = useState(false);
  const [isLookupEnabled, setIsLookupEnabled] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const isRenderingRef = useRef(false);
  const renderRequestIdRef = useRef(0);
  const [pdfError, setPdfError] = useState<string | null>(null);
  
  const [fontSize, setFontSize] = useState(14);
  const [fontFamily, setFontFamily] = useState('Inter');
  
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [userKeys, setUserKeys] = useState<any[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [newKey, setNewKey] = useState({ name: '', value: '', engine: 'gemini' });
  const [keyToDelete, setKeyToDelete] = useState<any | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      
      if (currentUser) {
        // Ensure user profile exists in Firestore
        const path = `users/${currentUser.uid}`;
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              createdAt: serverTimestamp(),
              role: 'user'
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, path);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      const path = 'apiKeys';
      const q = query(collection(db, 'apiKeys'), where('ownerId', '==', user.uid));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const keys = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setUserKeys(keys);
        
        // Auto-select first key if none selected
        if (keys.length > 0 && !selectedKeyId) {
          setSelectedKeyId(keys[0].id);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      });
      return () => unsubscribe();
    } else {
      setUserKeys([]);
      setSelectedKeyId(null);
    }
  }, [user]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setAuthError(null);

    try {
      if (authMode === 'register') {
        const userCredential = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        await updateProfile(userCredential.user, { displayName: authDisplayName });
        
        // Update local user state immediately for better UX
        setUser({ ...userCredential.user, displayName: authDisplayName } as User);
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
      setShowAuthModal(false);
      setAuthEmail('');
      setAuthPassword('');
      setAuthDisplayName('');
    } catch (error: any) {
      console.error("Email auth failed:", error);
      if (error.code === 'auth/email-already-in-use') {
        setAuthError("Email này đã được sử dụng.");
      } else if (error.code === 'auth/invalid-credential') {
        setAuthError("Email hoặc mật khẩu không chính xác.");
      } else if (error.code === 'auth/weak-password') {
        setAuthError("Mật khẩu quá yếu (tối thiểu 6 ký tự).");
      } else {
        setAuthError("Xác thực thất bại. Vui lòng kiểm tra lại thông tin.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleAddKey = async () => {
    if (!user || !newKey.name || !newKey.value) return;
    const path = 'apiKeys';
    try {
      await setDoc(doc(collection(db, 'apiKeys')), {
        ownerId: user.uid,
        name: newKey.name,
        value: newKey.value,
        engine: newKey.engine,
        createdAt: serverTimestamp(),
        lastUsed: serverTimestamp()
      });
      setNewKey({ name: '', value: '', engine: 'gemini' });
      setIsAddingKey(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    const path = `apiKeys/${keyId}`;
    try {
      await deleteDoc(doc(db, 'apiKeys', keyId));
      if (selectedKeyId === keyId) setSelectedKeyId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const handleDownload = async (pagesToDownload?: number[]) => {
    const pages = pagesToDownload || [currentPage];
    const availablePages = pages.filter(p => translations[p]?.status === 'success');
    
    if (availablePages.length === 0) return;

    try {
      const allChildren: Paragraph[] = [];
      
      for (const pageNum of availablePages) {
        const content = translations[pageNum]?.content;
        if (!content) continue;

        // Add page header
        allChildren.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: "center",
          spacing: { before: 400, after: 200 },
          children: [
            new TextRun({
              text: `Trang ${pageNum}`,
              bold: true,
              color: "4F46E5",
              size: 32,
              font: "Times New Roman"
            })
          ]
        }));

        const lines = content.split('\n');
        const pageParagraphs = lines.map(line => {
          let text = line.trim();
          if (!text) return new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] });

          let isHeading = false;
          let headingLevel: any = undefined;

          if (text.startsWith('### ')) {
            text = text.replace('### ', '');
            isHeading = true;
            headingLevel = HeadingLevel.HEADING_3;
          } else if (text.startsWith('## ')) {
            text = text.replace('## ', '');
            isHeading = true;
            headingLevel = HeadingLevel.HEADING_2;
          } else if (text.startsWith('# ')) {
            text = text.replace('# ', '');
            isHeading = true;
            headingLevel = HeadingLevel.HEADING_1;
          }

          let isBullet = false;
          if (text.startsWith('- ') || text.startsWith('* ')) {
            text = text.substring(2);
            isBullet = true;
          }

          return new Paragraph({
            heading: isHeading ? headingLevel : undefined,
            bullet: isBullet ? { level: 0 } : undefined,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: text,
                size: isHeading ? 28 : 24,
                font: "Times New Roman",
                bold: isHeading
              })
            ]
          });
        });

        allChildren.push(...pageParagraphs);
        
        // Add page break if not the last page
        if (pageNum !== availablePages[availablePages.length - 1]) {
          allChildren.push(new Paragraph({
            children: [new TextRun({ text: "", break: 1 })]
          }));
        }
      }

      const doc = new Document({
        sections: [{
          properties: {},
          children: allChildren,
        }],
      });

      const blob = await Packer.toBlob(doc);
      const fileName = availablePages.length === 1 
        ? `MediTrans_Trang_${availablePages[0]}.docx` 
        : `MediTrans_Tong_Hop_${availablePages.length}_Trang.docx`;
      saveAs(blob, fileName);
    } catch (error) {
      console.error("Error generating docx:", error);
      // Fallback to markdown if docx fails (just for the first page if multiple)
      const firstPageContent = translations[availablePages[0]]?.content || "";
      const blob = new Blob([firstPageContent], { type: 'text/markdown' });
      saveAs(blob, `MediTrans_Trang_${availablePages[0]}.md`);
    }
  };

  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
  const [dictionaryPosition, setDictionaryPosition] = useState({ x: 0, y: 0 });
  
  const clearFile = () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    
    // Increment fileId to invalidate all pending translations for the previous file
    fileIdRef.current += 1;
    
    // Abort all pending translations
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    preTranslateControllersRef.current.forEach(controller => controller.abort());
    preTranslateControllersRef.current.clear();
    
    setFile(null);
    setFileUrl(null);
    setPdfDoc(null);
    setNumPages(0);
    setCurrentPage(1);
    setCurrentJob(1);
    setTranslations({});
    setPdfError(null);
    isRenderingRef.current = false;
    translatingPagesRef.current.clear();
    
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renderTaskRef = useRef<any>(null);
  const translationService = useRef<TranslationService | null>(null);

  // Pre-load PDF worker
  useEffect(() => {
    console.log(`[MediTrans AI] Pre-loading PDF worker v${pdfjs.version}...`);
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    // Reset input value so the same file can be selected again
    e.target.value = '';
    
    if (!selectedFile) return;

    // Check file size (200MB limit)
    if (selectedFile.size > 200 * 1024 * 1024) {
      setUploadError("File quá lớn. Vui lòng chọn file dưới 200MB.");
      setTimeout(() => setUploadError(null), 5000);
      return;
    }

    const isPdf = selectedFile.type === 'application/pdf' || 
                  selectedFile.type === 'application/x-pdf' ||
                  selectedFile.name.toLowerCase().endsWith('.pdf');
    
    if (isPdf) {
      setIsPdfLoading(true);
      setPdfError(null);
      
      // Small delay to allow UI to update and browser to settle after file picker
      await new Promise(resolve => setTimeout(resolve, 100));

      // Clear previous
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      if (pdfDoc) {
        try {
          await pdfDoc.destroy();
        } catch (e) {
          console.warn("Error destroying previous PDF:", e);
        }
      }

      // Increment fileId to invalidate all pending translations for the previous file
      fileIdRef.current += 1;
      
      // Abort all pending translations
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      
      preTranslateControllersRef.current.forEach(controller => controller.abort());
      preTranslateControllersRef.current.clear();
      translatingPagesRef.current.clear();

      setFile(selectedFile);
      setTranslations({});
      setCurrentPage(1);
      setCurrentJob(1);
      setAutoTranslate(false);
      
      try {
        // For iOS Chrome/Safari stability, we'll try loading via ArrayBuffer if Blob URL fails
        // but first try the efficient Blob URL method
        const url = URL.createObjectURL(selectedFile);
        setFileUrl(url);
        
        console.log(`[MediTrans AI] Loading PDF: ${selectedFile.name} (${Math.round(selectedFile.size / 1024)} KB)`);

        const loadingTask = pdfjs.getDocument({
          url,
          // Use jsDelivr for cmaps as well for better reliability in Asia
          cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`,
          cMapPacked: true,
          disableAutoFetch: false,
          disableStream: false,
        });

        const pdf = await loadingTask.promise;
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
      } catch (error: any) {
        console.error("Error loading PDF with Blob URL, trying ArrayBuffer fallback:", error);
        
        try {
          // Fallback: Read as ArrayBuffer (more stable on some mobile browsers)
          const arrayBuffer = await selectedFile.arrayBuffer();
          const loadingTask = pdfjs.getDocument({
            data: arrayBuffer,
            cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`,
            cMapPacked: true,
          });
          const pdf = await loadingTask.promise;
          setPdfDoc(pdf);
          setNumPages(pdf.numPages);
        } catch (fallbackError: any) {
          console.error("Final PDF loading error:", fallbackError);
          setPdfError(`Không thể tải file PDF: ${fallbackError.message || "Lỗi không xác định"}`);
        }
      } finally {
        setIsPdfLoading(false);
      }
    } else {
      setUploadError("Vui lòng chọn file định dạng PDF.");
      setTimeout(() => setUploadError(null), 5000);
    }
  };

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDoc || !canvasRef.current || !textLayerRef.current) return;

    // Bounds check to prevent "Invalid page request"
    if (pageNum < 1 || pageNum > pdfDoc.numPages) {
      console.warn(`[MediTrans AI] Invalid page request: ${pageNum}. Document has ${pdfDoc.numPages} pages.`);
      return;
    }

    const requestId = ++renderRequestIdRef.current;

    setIsRendering(true);
    isRenderingRef.current = true;

    // Ensure previous render task is cancelled AND finished before starting a new one
    // This prevents "Cannot use the same canvas during multiple render() operations"
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      try {
        // Wait for the previous task to actually stop
        await renderTaskRef.current.promise;
      } catch (e) {
        // Ignore cancellation errors
      }
    }

    // Check if a newer request has come in while we were waiting for cancellation
    if (requestId !== renderRequestIdRef.current) {
      return;
    }

    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: zoom * 2 });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { alpha: false }); // Optimization: disable alpha if not needed

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
        
        // Only update state if this is still the current request
        if (requestId === renderRequestIdRef.current) {
          // Signal that visual rendering is done so translation can start immediately
          setIsRendering(false);
          isRenderingRef.current = false;
          renderTaskRef.current = null;
          
          // Render text layer in the background
          const textContent = await page.getTextContent();
          const textLayerDiv = textLayerRef.current;
          if (textLayerDiv) {
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
          }
        }

        // Crucial for memory: cleanup page resources
        page.cleanup();
      }
    } catch (error: any) {
      if (error.name !== 'RenderingCancelledException') {
        console.error("Error rendering page:", error);
      }
      
      if (requestId === renderRequestIdRef.current) {
        setIsRendering(false);
        isRenderingRef.current = false;
        renderTaskRef.current = null;
      }
    }
  }, [pdfDoc, zoom]);

  const fitToWidth = async () => {
    if (!pdfDoc || !containerRef.current) return;
    
    // Use the current page from the doc to be safe
    const pageToFit = currentPage;
    if (pageToFit < 1 || pageToFit > pdfDoc.numPages) return;

    requestAnimationFrame(async () => {
      if (!pdfDoc || !containerRef.current) return;
      try {
        const page = await pdfDoc.getPage(pageToFit);
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

  const cancelTranslation = useCallback(() => {
    const currentFileId = fileIdRef.current;
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTranslating(false);
    setActiveTranslation(null);
    
    // Update status of the page being translated to error or idle
    const targetPage = currentPage;
    if (translatingPagesRef.current.has(targetPage)) {
      if (fileIdRef.current === currentFileId) {
        setTranslations(prev => ({
          ...prev,
          [targetPage]: { ...prev[targetPage], status: 'error', content: 'Đã dừng dịch thuật.' }
        }));
      }
      translatingPagesRef.current.delete(targetPage);
    }
  }, [currentPage]);

  const translateCurrentPage = useCallback(async (pageNumber?: number, force = false) => {
    const targetPage = pageNumber ?? currentPage;
    const currentFileId = fileIdRef.current;
    
    if (!canvasRef.current || !translationService.current) return;

    // Safety check: translateCurrentPage uses the global canvasRef, 
    // so it MUST only be used for the currently visible page.
    if (targetPage !== currentPage) {
      console.log(`[MediTrans] Hủy dịch trang ${targetPage} vì không còn là trang hiện tại.`);
      return;
    }

    // Abort any existing translation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    // Avoid double translation for the same page unless forced
    const currentStatus = translationsRef.current[targetPage]?.status;
    if (!force && (translatingPagesRef.current.has(targetPage) || (currentStatus === 'loading' || currentStatus === 'success'))) {
      return;
    }

    // If still rendering, we don't want to capture a half-rendered or old page
    if (isRenderingRef.current) {
      console.log(`[MediTrans] Đang render trang ${targetPage}, đợi giây lát...`);
      // Retry after a very short delay
      setTimeout(() => {
        // Re-check if we are still on the same page before retrying
        if (currentPageRef.current === targetPage) {
          translateCurrentPage(targetPage, force);
        }
      }, 50);
      return;
    }
    
    // Check if we have an API key before starting
    const hasKey = await translationService.current.hasApiKey();
    if (!hasKey) {
      if (fileIdRef.current === currentFileId) {
        setTranslations(prev => ({
          ...prev,
          [targetPage]: { 
            content: 'Thiếu API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn từ hệ thống.', 
            status: 'error' 
          }
        }));
      }
      return;
    }

    // Set active translation for smooth streaming without re-rendering the whole list
    setActiveTranslation({ page: targetPage, content: '', status: 'loading' });
    setIsTranslating(true);
    translatingPagesRef.current.add(targetPage);

    try {
      const startTime = Date.now();
      console.log(`[MediTrans] Bắt đầu dịch trang ${targetPage}...`);

      // Create a temporary canvas for optimized capture
      const originalCanvas = canvasRef.current;
      
      // Final safety check: ensure the canvas we're about to capture is still the right one
      if (targetPage !== currentPageRef.current || isRenderingRef.current) {
        console.log(`[MediTrans] Hủy capture trang ${targetPage} do thay đổi trạng thái (Page: ${currentPageRef.current}, Rendering: ${isRenderingRef.current})`);
        return;
      }

      const MAX_DIMENSION = 1024; // Further reduced for faster upload while maintaining OCR quality
      
      let captureCanvas = originalCanvas;
      
      // Resize if the original is too large to reduce payload size and API latency
      if (originalCanvas.width > MAX_DIMENSION || originalCanvas.height > MAX_DIMENSION) {
        const tempCanvas = document.createElement('canvas');
        const ratio = Math.min(MAX_DIMENSION / originalCanvas.width, MAX_DIMENSION / originalCanvas.height);
        tempCanvas.width = originalCanvas.width * ratio;
        tempCanvas.height = originalCanvas.height * ratio;
        
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          tempCtx.drawImage(originalCanvas, 0, 0, tempCanvas.width, tempCanvas.height);
          captureCanvas = tempCanvas;
          console.log(`[MediTrans] Đã tối ưu kích thước ảnh: ${tempCanvas.width}x${tempCanvas.height}`);
        }
      }

      const imageBuffer = captureCanvas.toDataURL('image/jpeg', 0.7); // Lower quality for faster upload
      console.log(`[MediTrans] Đã nén ảnh xong sau ${Date.now() - startTime}ms. Đang gửi yêu cầu tới Gemini...`);

      const stream = translationService.current.translateMedicalPageStream({
        imageBuffer,
        pageNumber: targetPage,
        signal
      });
      
      let fullContent = "";
      let lastUpdateTime = Date.now();
      let firstChunkReceived = false;
      const UPDATE_INTERVAL = 100; // Update UI every 100ms for smooth streaming without lag

      for await (const chunk of stream) {
        if (!firstChunkReceived) {
          firstChunkReceived = true;
          console.log(`[MediTrans] Đã nhận phản hồi đầu tiên sau ${Date.now() - startTime}ms`);
        }
        fullContent += chunk;
        const now = Date.now();
        if (now - lastUpdateTime > UPDATE_INTERVAL) {
          setActiveTranslation({ page: targetPage, content: fullContent, status: 'loading' });
          lastUpdateTime = now;
        }
      }
      
      console.log(`[MediTrans] Hoàn thành dịch trang ${targetPage} trong ${Date.now() - startTime}ms`);
      
      // Final update to ensure everything is rendered
      setActiveTranslation({ page: targetPage, content: fullContent, status: 'loading' });
      
      const finalResult = { content: fullContent, status: 'success' as const };
      
      // Only update if we are still on the same file
      if (fileIdRef.current === currentFileId) {
        setTranslations(prev => ({ ...prev, [targetPage]: finalResult }));
      }
      setActiveTranslation(null);
    } catch (error: any) {
      if (error.message === "Translation aborted" || error.name === 'AbortError') {
        console.log("Translation aborted by user");
        return;
      }
      console.error("Translation Error:", error);
      const errorMessage = error instanceof Error ? error.message : 'Dịch thuật thất bại.';
      const errorResult = { content: errorMessage, status: 'error' as const };
      
      if (fileIdRef.current === currentFileId) {
        setTranslations(prev => ({ ...prev, [targetPage]: errorResult }));
      }
      setActiveTranslation(null);
    } finally {
      translatingPagesRef.current.delete(targetPage);
      if (abortControllerRef.current?.signal === signal) {
        setIsTranslating(false);
        abortControllerRef.current = null;
      }
    }
  }, [currentPage, translationService]);

  const preTranslatePage = useCallback(async (pageNum: number, signal?: AbortSignal) => {
    if (!pdfDoc || !translationService.current || pageNum > numPages) return;
    const currentFileId = fileIdRef.current;

    if (signal?.aborted) return;

    // Avoid double translation
    const currentStatus = translationsRef.current[pageNum]?.status;
    if (translatingPagesRef.current.has(pageNum) || (currentStatus === 'loading' || currentStatus === 'success')) {
      return;
    }

    translatingPagesRef.current.add(pageNum);
    
    try {
      const page = await pdfDoc.getPage(pageNum);
      if (signal?.aborted) {
        page.cleanup();
        return;
      }

      // Use a fixed scale for pre-translation OCR to ensure consistency and quality
      const viewport = page.getViewport({ scale: 2 }); 
      
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      
      if (context) {
        const renderTask = page.render({
          canvasContext: context,
          viewport: viewport,
        } as any);
        
        if (signal) {
          signal.addEventListener('abort', () => renderTask.cancel());
        }

        await renderTask.promise;
        
        if (signal?.aborted) {
          page.cleanup();
          return;
        }

        const imageBuffer = canvas.toDataURL('image/jpeg', 0.8);
        const stream = translationService.current.translateMedicalPageStream({
          imageBuffer,
          pageNumber: pageNum,
          signal
        });
        
        let fullContent = "";
        let lastUpdateTime = Date.now();
        const UPDATE_INTERVAL = 150;

        for await (const chunk of stream) {
          if (signal?.aborted) break;
          fullContent += chunk;
          const now = Date.now();
          if (now - lastUpdateTime > UPDATE_INTERVAL) {
            // If the user has moved to this page while it was being pre-translated, show progress
            if (pageNum === currentPageRef.current) {
              setActiveTranslation({ page: pageNum, content: fullContent, status: 'loading' });
              setIsTranslating(true);
            }
            lastUpdateTime = now;
          }
        }
        
        if (signal?.aborted) return;

        // Final update if it's the current page
        if (pageNum === currentPageRef.current) {
          setActiveTranslation({ page: pageNum, content: fullContent, status: 'loading' });
          setIsTranslating(true);
        }
        
        const finalResult = { content: fullContent, status: 'success' as const };
        
        if (fileIdRef.current === currentFileId) {
          setTranslations(prev => ({ ...prev, [pageNum]: finalResult }));
        }
        
        // Clear active translation if it was this page
        if (pageNum === currentPageRef.current) {
          setActiveTranslation(null);
          setIsTranslating(false);
        }
      }
      
      page.cleanup();
    } catch (error: any) {
      if (error.message === "Translation aborted" || error.name === 'AbortError') {
        return;
      }
      console.error(`Pre-translation error for page ${pageNum}:`, error);
    } finally {
      translatingPagesRef.current.delete(pageNum);
      // If it was the current page, reset global translating state
      if (pageNum === currentPageRef.current) {
        setIsTranslating(false);
      }
    }
  }, [pdfDoc, numPages, translationService]);

  useEffect(() => {
    if (pdfDoc && autoTranslate && translations[currentPage]?.status === 'success' && !isTranslating) {
      // Look ahead up to 2 pages to maintain a buffer
      const pagesToBuffer = [currentPage + 1, currentPage + 2];
      const controllers: AbortController[] = [];
      
      for (const pageNum of pagesToBuffer) {
        if (pageNum <= numPages && !translations[pageNum] && !translatingPagesRef.current.has(pageNum)) {
          const controller = new AbortController();
          controllers.push(controller);
          preTranslateControllersRef.current.set(pageNum, controller);
          
          const timer = setTimeout(() => {
            preTranslatePage(pageNum, controller.signal).finally(() => {
              preTranslateControllersRef.current.delete(pageNum);
            });
          }, 500);
          
          // Note: we don't return here, we want to start all timers
        }
      }

      return () => {
        controllers.forEach(c => c.abort());
      };
    }
  }, [currentPage, pdfDoc, autoTranslate, translations, numPages, preTranslatePage, isTranslating]);

  const currentEngineRef = useRef<string | null>(null);
  const currentKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let key = engineKeys[selectedEngine];
    
    // If user is logged in and has a selected key from the vault, use it
    if (user && selectedKeyId) {
      const vaultKey = userKeys.find(k => k.id === selectedKeyId);
      // Map engine types
      const currentEngineType = selectedEngine.startsWith('gemini') ? 'gemini' : selectedEngine;
      if (vaultKey && vaultKey.engine === currentEngineType) {
        key = vaultKey.value;
      }
    }

    if (currentEngineRef.current === selectedEngine && currentKeyRef.current === key) {
      return;
    }

    currentEngineRef.current = selectedEngine;
    currentKeyRef.current = key;

    if (selectedEngine === 'gemini-flash') {
      translationService.current = new GeminiService(key, "gemini-3.1-flash-lite-preview");
    } else if (selectedEngine === 'gemini-pro') {
      translationService.current = new GeminiService(key, "gemini-3.1-pro-preview");
    } else if (selectedEngine === 'medical-specialized') {
      translationService.current = new MedicalApiService(key);
    }

    // Log key initialization for debugging (obfuscated)
    if (key) {
      const obfuscated = key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : '****';
      console.log(`[MediTrans AI] Initialized ${selectedEngine} with key: ${obfuscated}`);
    } else {
      console.log(`[MediTrans AI] Initialized ${selectedEngine} with system default key`);
    }
  }, [selectedEngine, engineKeys, user, selectedKeyId, userKeys]);

  // Handle Focus Mode (FullScreen) transitions
  useEffect(() => {
    if (file) {
      // Set auto-fit to true when toggling focus mode to ensure it fills the space
      setIsAutoFit(true);
      
      // Small delay to allow layout transitions to complete before measuring
      const timer = setTimeout(() => {
        fitToWidth();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [isFullScreen, file]);

  // Handle PDF document load
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
    if (pdfDoc && autoTranslate && !isRendering && !isTranslating && !translations[currentPage]) {
      const timer = setTimeout(() => {
        // Re-check conditions after delay
        if (!isRenderingRef.current && !isTranslatingRef.current && !translationsRef.current[currentPage]) {
          translateCurrentPage(currentPage);
        }
      }, 20); // Reduced delay from 100ms to 20ms for near-instant startup
      return () => clearTimeout(timer);
    }
  }, [currentPage, pdfDoc, autoTranslate, isRendering, isTranslating, translations, translateCurrentPage]);

  useEffect(() => {
    if (pdfDoc) {
      renderPage(currentPage);
    }
  }, [pdfDoc, currentPage, renderPage]);

  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(null);
  
  useEffect(() => {
    handleKeyDownRef.current = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullScreenRef.current) {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => setIsFullScreen(false));
        } else {
          setIsFullScreen(false);
        }
        return;
      }

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
      } else {
        // Arrow keys for navigation (only if not typing in an input)
        const activeElement = document.activeElement;
        const isTyping = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA' || (activeElement as HTMLElement)?.isContentEditable;
        
        if (!isTyping) {
          if (e.key === 'ArrowLeft') {
            setCurrentPage(p => Math.max(1, p - 1));
          } else if (e.key === 'ArrowRight') {
            setCurrentPage(p => Math.min(numPages, p + 1));
          }
        }
      }
    };
  }, [numPages, fitToWidthAction]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (handleKeyDownRef.current) {
        handleKeyDownRef.current(e);
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

    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (!isDragging || !containerRef.current || e.touches.length !== 1) return;
      // Prevent default to stop browser scrolling when panning
      e.preventDefault();
      const touch = e.touches[0];
      const dx = touch.clientX - dragStart.x;
      const dy = touch.clientY - dragStart.y;
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
      window.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
      window.addEventListener('touchend', handleGlobalMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchmove', handleGlobalTouchMove);
      window.removeEventListener('touchend', handleGlobalMouseUp);
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

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isPanning || !containerRef.current || e.touches.length !== 1) return;

    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({
      x: touch.clientX,
      y: touch.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop
    });
    containerRef.current.style.cursor = 'grabbing';
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // Handle text selection for dictionary
    // Only trigger if lookup is enabled, translation panel is open and NOT in full screen mode
    if (!isLookupEnabled || !showTranslationPanel || isFullScreen) return;

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

        // Clean the selected text: remove invisible characters and trim
        // We keep punctuation and internal spacing as the user wants the "exact" selection
        const text = selectedText
          .replace(/[\u00AD\u200B\u200C\u200D]/g, '') // Remove soft hyphens and zero-width spaces
          .trim();
        
        // Only trigger if it's not just whitespace
        const isNumeric = /^\d+$/.test(text);
        
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
                if (Math.abs(rects[i].top - firstRect.top) > 15) { // Slightly more tolerant
                  isSingleLine = false;
                  break;
                }
              }
            }
          }
        } catch (e) {}

        // Relax limits to allow longer phrases or short sentences (up to 200 chars, 20 words)
        const wordCount = text.split(/\s+/).length;
        // Allow slightly multi-line selections (up to 30px vertical difference)
        if (text.length > 1 && text.length < 200 && !isNumeric && wordCount <= 20) {
          try {
            const range = selection?.getRangeAt(0);
            if (range) {
              const rect = range.getBoundingClientRect();
              
              // Check if selection spans too many lines vertically
              let verticalSpan = 0;
              const rects = range.getClientRects();
              if (rects.length > 1) {
                let minTop = rects[0].top;
                let maxTop = rects[0].top;
                for (let i = 1; i < rects.length; i++) {
                  minTop = Math.min(minTop, rects[i].top);
                  maxTop = Math.max(maxTop, rects[i].top);
                }
                verticalSpan = maxTop - minTop;
              }

              // Only trigger if vertical span is reasonable (approx 2-3 lines max)
              if (verticalSpan < 60) {
                // Position relative to the viewport
                setDictionaryPosition({ x: rect.left, y: rect.bottom + 10 });
                setSelectedTerm(text);
              }
            }
          } catch (err) {
            // Range might be invalid if selection changed rapidly
          }
        }
      }
    }, 50);
  };

  const saveSettings = (keys: Record<TranslationEngine, string>) => {
    setEngineKeys(keys);
    localStorage.setItem('engine_keys', JSON.stringify(keys));
    setShowSettings(false);
  };

  const [copiedPage, setCopiedPage] = useState<number | null>(null);

  const handleCopyTranslation = (content: string, pageNum: number) => {
    navigator.clipboard.writeText(content);
    setCopiedPage(pageNum);
    setTimeout(() => setCopiedPage(null), 2000);
  };

  const clearAllTranslations = () => {
    if (window.confirm("Bạn có chắc chắn muốn xóa tất cả bản dịch hiện tại không? Hành động này không thể hoàn tác.")) {
      setTranslations({});
      translationsRef.current = {};
      setActiveTranslation(null);
      setIsTranslating(false);
    }
  };

  const [tempKeys, setTempKeys] = useState<Record<TranslationEngine, string>>(engineKeys);
  const [testStatus, setTestStatus] = useState<{ type: 'success' | 'error' | 'loading' | null, message: string }>({ type: null, message: '' });

  useEffect(() => {
    if (showSettings) {
      let currentKey = engineKeys[selectedEngine];
      if (user && selectedKeyId) {
        const vaultKey = userKeys.find(k => k.id === selectedKeyId);
        const currentEngineType = selectedEngine.startsWith('gemini') ? 'gemini' : selectedEngine;
        if (vaultKey && vaultKey.engine === currentEngineType) {
          currentKey = vaultKey.value;
        }
      }
      setTempKeys({ ...engineKeys, [selectedEngine]: currentKey });
    }
  }, [showSettings, engineKeys, user, selectedKeyId, userKeys, selectedEngine]);

  return (
    <ErrorBoundary>
      <div className={cn("h-screen flex flex-col bg-slate-50 overflow-hidden", isFullScreen && "fixed inset-0 z-50")}>
      {/* Header */}
      {!isFullScreen && (
        <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-4 shrink-0 shadow-sm z-30">
        <LogoWithText />

        <div className="flex items-center gap-2">
          {file && (
            <div className="hidden md:flex items-center bg-slate-50 rounded-full px-3 py-1 gap-2 border border-slate-100 max-w-[300px]">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-medium text-slate-600 truncate">{file.name}</span>
            </div>
          )}
          
          <div className="h-6 w-px bg-slate-200 mx-1 hidden md:block" />
          
          {file && (
            <button 
              onClick={clearFile}
              className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-rose-50 text-rose-500 hover:text-rose-600 rounded-full transition-all text-[10px] font-bold uppercase tracking-wider"
              title="Xóa tài liệu hiện tại"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Xóa PDF</span>
            </button>
          )}

          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500"
            title="Cài đặt API Key"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button 
            onClick={() => {
              const nextState = !showTranslationPanel;
              setShowTranslationPanel(nextState);
              if (!nextState) setSelectedTerm(null);
            }}
            className={cn(
              "p-2 rounded-full transition-all",
              showTranslationPanel ? "bg-indigo-50 text-indigo-600 shadow-sm" : "hover:bg-slate-100 text-slate-500"
            )}
            title={showTranslationPanel ? "Đóng Tra cứu & Dịch thuật" : "Mở Tra cứu & Dịch thuật"}
          >
            <Languages className="w-4 h-4" />
          </button>
          
          <button 
            onClick={toggleFullScreen}
            className={cn(
              "p-2 rounded-full transition-all",
              isFullScreen ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "hover:bg-slate-100 text-slate-500"
            )}
            title={isFullScreen ? "Thoát toàn màn hình" : "Toàn màn hình (F11)"}
          >
            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <div className="h-6 w-px bg-slate-200 mx-1" />

          {isAuthReady && (
            user ? (
              <div className="flex items-center gap-2 pl-1">
                <div className="hidden lg:flex flex-col items-end mr-1">
                  <span className="text-[10px] font-bold text-slate-700 leading-none">{user.displayName || 'Người dùng'}</span>
                  <span className="text-[8px] text-slate-400 font-medium">{user.email}</span>
                </div>
                <div className="relative group">
                  <img 
                    src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName || 'User'}&background=6366f1&color=fff`} 
                    alt="Avatar" 
                    className="w-8 h-8 rounded-full border-2 border-white shadow-sm cursor-pointer"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 p-2">
                    <div className="px-3 py-2 border-b border-slate-50 mb-1">
                      <p className="text-xs font-bold text-slate-800 truncate">{user.displayName}</p>
                      <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
                    </div>
                    <button 
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors text-xs font-bold"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Đăng xuất
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => setShowAuthModal(true)}
                className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-1.5 rounded-full text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95"
              >
                <LogIn className="w-3.5 h-3.5" />
                Đăng nhập
              </button>
            )
          )}
        </div>
      </header>
      )}

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden relative bg-slate-50">
        {!file ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-xl w-full text-center"
            >
              <div className="mb-8 relative inline-block">
                <div className="absolute -inset-4 bg-indigo-100 rounded-full blur-2xl opacity-50 animate-pulse" />
                <div className="relative bg-white p-10 rounded-3xl shadow-xl border border-slate-100 z-10">
                  <Logo size={80} className="mx-auto mb-8" />
                  <h2 className="text-2xl font-display font-bold text-slate-800 mb-2">Tải lên tài liệu y khoa</h2>
                  <p className="text-slate-500 mb-8">Hỗ trợ file PDF lên tới 200MB. Dịch thuật chuyên sâu giữ nguyên định dạng.</p>
                  
                  <button 
                    onClick={() => {
                      if (fileInputRef.current) {
                        fileInputRef.current.click();
                      }
                    }}
                    disabled={isPdfLoading}
                    className={cn(
                      "w-full py-4 rounded-full font-bold shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 mb-2",
                      isPdfLoading 
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none" 
                        : "bg-indigo-600 text-white shadow-indigo-100 hover:bg-indigo-700"
                    )}
                  >
                    {isPdfLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Đang xử lý file...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-5 h-5" />
                        <span>Chọn file PDF</span>
                      </>
                    )}
                  </button>
                  
                  <input 
                    ref={fileInputRef}
                    type="file" 
                    accept=".pdf,application/pdf" 
                    onChange={handleFileChange}
                    className="hidden"
                    title="Tải lên PDF"
                  />

                  {uploadError && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-xs font-bold flex items-center justify-center gap-2"
                    >
                      <AlertCircle className="w-4 h-4" />
                      {uploadError}
                    </motion.div>
                  )}
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
          <div className="flex-1 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-200 min-h-0 w-full overflow-hidden relative">
            {/* Left Side: Original PDF */}
            <div className={cn(
              "flex flex-col bg-slate-100 overflow-hidden border-r border-slate-200 transition-all duration-300 ease-in-out relative",
              isFullScreen ? "w-1/2" : (showTranslationPanel ? "w-full md:w-1/2" : "w-full"),
              mobileViewMode === 'pdf' ? "flex h-full" : "hidden md:flex"
            )}>
              <div className="h-11 bg-white border-b border-slate-200 flex items-center justify-between px-3 shrink-0 z-20 shadow-sm overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-3 min-w-max">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] hidden lg:block">Original</span>
                    {isFullScreen && (
                      <button 
                        onClick={toggleFullScreen}
                        className="flex items-center gap-1 px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-bold rounded-full hover:bg-indigo-700 transition-all shadow-sm ml-2"
                      >
                        <Minimize2 className="w-3 h-3" />
                        <span>THOÁT TOÀN MÀN HÌNH</span>
                      </button>
                    )}

                    {/* Mobile Navigation */}
                    <div className="flex items-center gap-0.5 md:hidden bg-slate-50 rounded-lg px-1.5 py-0.5 border border-slate-100">
                      <button 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-1 hover:bg-slate-200 rounded-md disabled:opacity-20 transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5 text-slate-600" />
                      </button>
                      <span className="text-[10px] font-black text-slate-500 min-w-[30px] text-center">{currentPage}/{numPages}</span>
                      <button 
                        onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                        disabled={currentPage === numPages}
                        className="p-1 hover:bg-slate-200 rounded-md disabled:opacity-20 transition-colors"
                      >
                        <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                      </button>
                    </div>
                  </div>

                  <div className="h-4 w-px bg-slate-200" />

                  {totalJobs > 1 && (
                    <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-2 py-1 border border-slate-100 shadow-sm">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Phần</span>
                      <div className="flex items-center gap-1">
                        <select 
                          value={currentJob}
                          onChange={(e) => {
                            const job = parseInt(e.target.value);
                            setCurrentJob(job);
                            setCurrentPage((job - 1) * PAGES_PER_JOB + 1);
                          }}
                          className="h-6 text-[11px] font-black border border-slate-200 rounded bg-white px-1.5 focus:ring-2 focus:ring-indigo-500 text-slate-700 appearance-none min-w-[32px] text-center"
                        >
                          {Array.from({ length: totalJobs }, (_, i) => i + 1).map(job => (
                            <option key={job} value={job}>{job}</option>
                          ))}
                        </select>
                        <span className="text-[10px] font-black text-slate-300">/ {totalJobs}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-0.5">
                    <button 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-1 hover:bg-slate-100 rounded-md disabled:opacity-20 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4 text-slate-600" />
                    </button>
                    <div className="flex items-center gap-1 px-1">
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
                        className="w-9 h-6 text-center text-[11px] font-bold border border-slate-200 rounded bg-slate-50 focus:bg-white focus:ring-1 focus:ring-indigo-500 transition-all"
                      />
                      <span className="text-[10px] font-bold text-slate-400">/ {numPages}</span>
                    </div>
                    <button 
                      onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                      disabled={currentPage === numPages}
                      className="p-1 hover:bg-slate-100 rounded-md disabled:opacity-20 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4 text-slate-600" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 min-w-max ml-4">
                  <div className="flex items-center gap-0.5 bg-slate-50 rounded-lg p-0.5 border border-slate-100">
                    <button 
                      onClick={() => setIsPanning(!isPanning)}
                      className={cn(
                        "p-1.5 rounded transition-all",
                        isPanning ? "bg-indigo-600 text-white shadow-md" : "hover:bg-white text-slate-500"
                      )}
                      title={isPanning ? "Tắt Hand Tool" : "Bật Hand Tool (Di chuyển)"}
                    >
                      <Hand className="w-3.5 h-3.5" />
                    </button>
                    <div className="w-px h-3 bg-slate-200 mx-0.5" />
                    <button 
                      onClick={() => {
                        const nextState = !isLookupEnabled;
                        setIsLookupEnabled(nextState);
                        if (!nextState) setSelectedTerm(null);
                      }}
                      className={cn(
                        "p-1.5 rounded transition-all",
                        isLookupEnabled ? "bg-indigo-600 text-white shadow-md" : "hover:bg-white text-slate-500"
                      )}
                      title={isLookupEnabled ? "Tắt Tra cứu nhanh" : "Bật Tra cứu nhanh (Bôi đen để dịch)"}
                    >
                      <Search className="w-3.5 h-3.5" />
                    </button>
                    <div className="w-px h-3 bg-slate-200 mx-0.5" />
                    <button 
                      onClick={() => {
                        setIsAutoFit(false);
                        setZoom(z => Math.max(0.5, z - 0.1));
                      }} 
                      className="p-1.5 hover:bg-white hover:shadow-sm rounded transition-all text-slate-500"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[10px] font-black font-mono text-slate-600 w-9 text-center">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button 
                      onClick={() => {
                        setIsAutoFit(false);
                        setZoom(z => Math.min(3, z + 0.1));
                      }} 
                      className="p-1.5 hover:bg-white hover:shadow-sm rounded transition-all text-slate-500"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={fitToWidthAction} 
                      className={cn(
                        "p-1.5 rounded transition-all ml-0.5",
                        isAutoFit ? "bg-indigo-600 text-white shadow-md" : "hover:bg-white text-slate-500"
                      )}
                      title="Vừa khít chiều rộng"
                    >
                      <Maximize className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
              <div 
                className={cn(
                  "flex-1 overflow-auto pdf-container relative bg-slate-100",
                  isFullScreen ? "p-0" : "p-4 md:p-8",
                  isPanning ? "cursor-grab select-none touch-none" : "cursor-auto"
                )} 
                ref={containerRef}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
              >
                <div className="inline-block min-w-full text-center align-top">
                  <div className={cn(
                    "inline-block text-left relative shadow-2xl bg-white overflow-hidden shrink-0 transition-all duration-300",
                    isFullScreen ? "my-0 rounded-none border-none" : "my-8 rounded-lg border border-slate-200"
                  )}>
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
            <motion.div 
              initial={{ x: 300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 300, opacity: 0 }}
              className={cn(
                "flex flex-col bg-white overflow-hidden transition-all duration-300",
                isFullScreen ? "flex w-1/2" : (mobileViewMode === 'translation' ? "flex h-full" : (showTranslationPanel ? "hidden md:flex w-1/2" : "hidden"))
              )}
            >
              <div className="h-11 border-b border-slate-200 flex items-center justify-between px-3 shrink-0 z-20 shadow-sm overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-3 min-w-max">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em]">Translation</span>
                    
                    {/* Mobile Navigation */}
                    <div className="flex items-center gap-0.5 md:hidden bg-slate-50 rounded-lg px-1.5 py-0.5 border border-slate-100">
                      <button 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-1 hover:bg-slate-200 rounded-md disabled:opacity-20 transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5 text-slate-600" />
                      </button>
                      <span className="text-[10px] font-black text-slate-500 min-w-[30px] text-center">{currentPage}/{numPages}</span>
                      <button 
                        onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                        disabled={currentPage === numPages}
                        className="p-1 hover:bg-slate-200 rounded-md disabled:opacity-20 transition-colors"
                      >
                        <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="h-4 w-px bg-slate-200" />
                  
                  {isTranslating && (
                    <button 
                      onClick={cancelTranslation}
                      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-100 text-rose-600 hover:bg-rose-100 transition-all"
                      title="Dừng dịch thuật"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                      <span className="text-[9px] font-black uppercase tracking-tight">Dừng</span>
                    </button>
                  )}

                  {isTranslating && <div className="h-4 w-px bg-slate-200" />}

                  <button 
                    onClick={() => setAutoTranslate(!autoTranslate)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-all border",
                      autoTranslate 
                        ? "bg-emerald-50 border-emerald-100 text-emerald-600" 
                        : "bg-slate-50 border-slate-100 text-slate-400 hover:text-slate-500"
                    )}
                    title="Tự động dịch khi chuyển trang"
                  >
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      autoTranslate ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                    )} />
                    <span className="text-[9px] font-black uppercase tracking-tight">Auto</span>
                  </button>

                  <div className="h-4 w-px bg-slate-200" />
                  
                  <div className="flex items-center gap-1.5 bg-slate-50 rounded-md p-0.5 border border-slate-100">
                    <div className="flex items-center gap-1 px-1">
                      <FontIcon className="w-3 h-3 text-slate-400" />
                      <select 
                        value={fontFamily}
                        onChange={(e) => setFontFamily(e.target.value)}
                        className="text-[10px] font-bold bg-transparent border-none focus:ring-0 cursor-pointer text-slate-600 px-0"
                      >
                        <option value="Inter">Sans</option>
                        <option value="Cormorant Garamond">Serif</option>
                        <option value="Playfair Display">Display</option>
                        <option value="JetBrains Mono">Mono</option>
                      </select>
                    </div>
                    
                    <div className="w-px h-3 bg-slate-200 mx-0.5" />
                    
                    <div className="flex items-center gap-1 px-1">
                      <ALargeSmall className="w-3 h-3 text-slate-400" />
                      <select 
                        value={fontSize}
                        onChange={(e) => setFontSize(Number(e.target.value))}
                        className="text-[10px] font-bold bg-transparent border-none focus:ring-0 cursor-pointer text-slate-600 px-0"
                      >
                        {[12, 14, 16, 18, 20].map(size => (
                          <option key={size} value={size}>{size}px</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 min-w-max ml-4">
                  <button 
                    onClick={() => {
                      // Pre-select current page if it's translated
                      if (translations[currentPage]?.status === 'success') {
                        setSelectedPagesToDownload([currentPage]);
                      } else {
                        setSelectedPagesToDownload([]);
                      }
                      setShowDownloadModal(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 uppercase tracking-tighter transition-all border border-indigo-100"
                  >
                    <Download className="w-3.5 h-3.5" /> Tải xuống
                  </button>
                  <button 
                    onClick={() => translateCurrentPage(currentPage, true)}
                    disabled={isTranslating || isRendering}
                    className={cn(
                      "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-lg",
                      (isTranslating || isRendering)
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none" 
                        : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200 hover:shadow-indigo-300 active:scale-95"
                    )}
                  >
                    {isTranslating || isRendering ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>{isRendering ? 'Đang vẽ...' : 'Đang dịch...'}</span>
                      </>
                    ) : (
                      <>
                        <RefreshCcw className="w-3.5 h-3.5" />
                        <span>{translations[currentPage] ? 'Dịch lại trang này' : 'Dịch trang này'}</span>
                      </>
                    )}
                  </button>

                  {translations[currentPage]?.content && (
                    <button 
                      onClick={() => handleCopyTranslation(translations[currentPage].content, currentPage)}
                      className={cn(
                        "p-1.5 border rounded-lg transition-all flex items-center gap-1.5",
                        copiedPage === currentPage 
                          ? "bg-emerald-50 border-emerald-200 text-emerald-600" 
                          : "bg-slate-50 border-slate-100 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                      )}
                      title="Sao chép bản dịch"
                    >
                      {copiedPage === currentPage ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-bold">Đã chép!</span>
                        </>
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
              
              <div className="flex-1 overflow-auto p-6 md:p-12 bg-white">
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
                        <p className="text-xs text-slate-400 mb-4">Gemini đang xử lý hình ảnh và văn bản</p>
                        <button 
                          onClick={cancelTranslation}
                          className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-rose-50 hover:text-rose-600 transition-all border border-slate-200"
                        >
                          Dừng dịch
                        </button>
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

                      {/* Mobile Navigation Buttons at bottom of translation */}
                      <div className="mt-12 pt-8 border-t border-slate-100 md:hidden flex flex-col gap-4">
                        {currentPage < numPages && (
                          <button 
                            onClick={() => {
                              setCurrentPage(p => p + 1);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-100"
                          >
                            <span>Trang tiếp theo ({currentPage + 1}/{numPages})</span>
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        )}
                        
                        {currentPage > 1 && (
                          <button 
                            onClick={() => {
                              setCurrentPage(p => p - 1);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-200 transition-all active:scale-95"
                          >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Trang trước ({currentPage - 1}/{numPages})</span>
                          </button>
                        )}
                      </div>

                      {activeTranslation && activeTranslation.page === currentPage && (
                        <div className="mt-4 flex flex-col gap-3">
                          <div className="flex items-center gap-2 text-indigo-400 italic text-xs animate-pulse">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Đang dịch...</span>
                          </div>
                          <button 
                            onClick={cancelTranslation}
                            className="w-fit px-3 py-1.5 bg-slate-50 text-slate-500 rounded-lg text-[10px] font-bold hover:bg-rose-50 hover:text-rose-600 transition-all border border-slate-100 flex items-center gap-1.5"
                          >
                            <Square className="w-2.5 h-2.5 fill-current" />
                            Dừng dịch trang này
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </div>
        )}
      </main>

      {/* Tablet Navigation Buttons */}
      {file && !showSettings && !showAuthModal && (
        <div className="fixed bottom-6 md:bottom-8 left-0 right-0 pointer-events-none z-40 flex justify-between px-4 md:px-12">
          <button 
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1 || isPdfLoading || isRendering}
            className={cn(
              "pointer-events-auto w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 border backdrop-blur-sm",
              (currentPage === 1 || isPdfLoading || isRendering)
                ? "bg-slate-50/80 text-slate-200 border-slate-100 cursor-not-allowed" 
                : "bg-white/90 text-indigo-600 hover:bg-indigo-50 border-indigo-100 hover:shadow-indigo-100"
            )}
            title="Trang trước"
          >
            <ChevronLeft className="w-6 h-6 md:w-8 md:h-8" />
          </button>
          
          <button 
            onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
            disabled={currentPage === numPages || isPdfLoading || isRendering}
            className={cn(
              "pointer-events-auto w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 border backdrop-blur-sm",
              (currentPage === numPages || isPdfLoading || isRendering)
                ? "bg-slate-50/80 text-slate-200 border-slate-100 cursor-not-allowed" 
                : "bg-indigo-600/90 text-white hover:bg-indigo-700 border-indigo-500 shadow-indigo-200 hover:shadow-indigo-300"
            )}
            title="Trang tiếp theo"
          >
            <ChevronRight className="w-6 h-6 md:w-8 md:h-8" />
          </button>
        </div>
      )}

      {/* Dictionary Pop-up */}
      {selectedTerm && (
        <MedicalDictionary 
          selectedTerm={selectedTerm}
          onClose={() => setSelectedTerm(null)}
          translationService={translationService.current}
          position={dictionaryPosition}
        />
      )}

      {/* Auth Modal */}
      <AnimatePresence>
        {showAuthModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuthModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="text-center mb-8">
                  <div className="bg-indigo-600 w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-200">
                    <UserIcon className="text-white w-6 h-6" />
                  </div>
                  <h3 className="text-2xl font-display font-bold text-slate-800">
                    {authMode === 'login' ? 'Chào mừng trở lại' : 'Tạo tài khoản mới'}
                  </h3>
                  <p className="text-slate-500 text-sm mt-1">
                    {authMode === 'login' ? 'Đăng nhập để quản lý API Key của bạn' : 'Bắt đầu lưu trữ Key an toàn ngay hôm nay'}
                  </p>
                </div>

                <form onSubmit={handleEmailAuth} className="space-y-4">
                  {authMode === 'register' && (
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Tên hiển thị</label>
                      <input 
                        type="text"
                        required
                        value={authDisplayName}
                        onChange={(e) => setAuthDisplayName(e.target.value)}
                        placeholder="VD: Nguyễn Văn A"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Email</label>
                    <input 
                      type="email"
                      required
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="email@example.com"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Mật khẩu</label>
                    <input 
                      type="password"
                      required
                      minLength={6}
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                    />
                  </div>

                  {authError && (
                    <div className="flex items-center gap-2 p-3 bg-rose-50 text-rose-500 rounded-xl text-xs font-bold animate-shake">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{authError}</span>
                    </div>
                  )}

                  <button 
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold text-sm hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2"
                  >
                    {isLoggingIn ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      authMode === 'login' ? 'Đăng nhập' : 'Đăng ký'
                    )}
                  </button>
                </form>

                <p className="mt-8 text-center text-xs text-slate-500">
                  {authMode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'}
                  <button 
                    onClick={() => {
                      setAuthMode(authMode === 'login' ? 'register' : 'login');
                      setAuthError(null);
                    }}
                    className="ml-1.5 text-indigo-600 font-bold hover:underline"
                  >
                    {authMode === 'login' ? 'Đăng ký ngay' : 'Đăng nhập ngay'}
                  </button>
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Key Confirmation Modal */}
      <AnimatePresence>
        {keyToDelete && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setKeyToDelete(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden p-8 text-center"
            >
              <div className="bg-rose-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-rose-100">
                <Trash2 className="text-rose-600 w-8 h-8" />
              </div>
              <h3 className="text-xl font-display font-bold text-slate-800 mb-2">Xác nhận xóa Key?</h3>
              <p className="text-slate-500 text-sm mb-4">
                Bạn có chắc chắn muốn xóa key <span className="font-bold text-slate-700">"{keyToDelete.name}"</span>? 
                Hành động này không thể hoàn tác.
              </p>

              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-8 text-left">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Thông tin hạn mức (Free Tier)</span>
                </div>
                <ul className="space-y-1.5">
                  <li className="text-[11px] text-amber-700 leading-relaxed flex justify-between">
                    <span>• Gemini 1.5 Flash:</span>
                    <span className="font-bold">1,500 yêu cầu/ngày</span>
                  </li>
                  <li className="text-[11px] text-amber-700 leading-relaxed flex justify-between">
                    <span>• Gemini 1.5 Pro:</span>
                    <span className="font-bold">50 yêu cầu/ngày</span>
                  </li>
                </ul>
                <p className="mt-2 pt-2 border-t border-amber-200 text-[10px] text-amber-600 italic leading-tight">
                  * Google hiện không cung cấp API để kiểm tra số lượng yêu cầu còn lại chính xác trong ngày.
                </p>
              </div>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => setKeyToDelete(null)}
                  className="flex-1 px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  Hủy
                </button>
                <button 
                  onClick={() => {
                    handleDeleteKey(keyToDelete.id);
                    setKeyToDelete(null);
                  }}
                  className="flex-1 px-6 py-3 rounded-xl text-sm font-bold bg-rose-500 text-white hover:bg-rose-600 transition-colors shadow-lg shadow-rose-100"
                >
                  Xác nhận xóa
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Mobile View Toggle & Navigation Floating Bar */}
      {file && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] md:hidden flex flex-col items-center gap-3 w-[90%] max-w-[360px]">
          {/* Main Action Bar */}
          <div className="w-full flex items-center bg-white/95 backdrop-blur-xl rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-slate-200 p-1.5 gap-1 ring-1 ring-slate-900/5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* View Toggle */}
            <div className="flex bg-slate-100/80 rounded-full p-1 gap-1 shrink-0">
              <button 
                onClick={() => setMobileViewMode('pdf')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-wider transition-all duration-300",
                  mobileViewMode === 'pdf' 
                    ? "bg-white text-indigo-600 shadow-sm scale-105" 
                    : "text-slate-500"
                )}
              >
                <FileText className="w-3 h-3" />
                PDF
              </button>
              <button 
                onClick={() => setMobileViewMode('translation')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-wider transition-all duration-300",
                  mobileViewMode === 'translation' 
                    ? "bg-white text-indigo-600 shadow-sm scale-105" 
                    : "text-slate-500"
                )}
              >
                <Languages className="w-3 h-3" />
                Dịch
              </button>
            </div>
            
            <div className="w-px h-6 bg-slate-200 mx-0.5 shrink-0" />
            
            {/* Navigation */}
            <div className="flex-1 flex items-center justify-center gap-1">
              <button 
                onClick={() => {
                  setCurrentPage(p => Math.max(1, p - 1));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                disabled={currentPage === 1}
                className="p-2 text-slate-600 disabled:opacity-20 active:scale-75 transition-all"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              
              <div className="flex flex-col items-center min-w-[40px]">
                <span className="text-[11px] font-black text-slate-800 leading-none">{currentPage}/{numPages}</span>
              </div>
              
              <button 
                onClick={() => {
                  setCurrentPage(p => Math.min(numPages, p + 1));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                disabled={currentPage === numPages}
                className="p-2 text-slate-600 disabled:opacity-20 active:scale-75 transition-all"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="w-px h-6 bg-slate-200 mx-0.5 shrink-0" />

            {/* Auto Toggle */}
            <button 
              onClick={() => setAutoTranslate(!autoTranslate)}
              className={cn(
                "p-2.5 rounded-full transition-all shrink-0",
                autoTranslate 
                  ? "bg-emerald-100 text-emerald-600 shadow-inner" 
                  : "bg-slate-100 text-slate-400"
              )}
              title="Tự động dịch"
            >
              <RefreshCcw className={cn("w-4 h-4", autoTranslate && "animate-spin-slow")} />
            </button>
          </div>
        </div>
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
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                      API Key cho Gemini 3 Flash
                    </label>
                    <div className="flex gap-2 mt-3">
                      <input 
                        type="password"
                        value={tempKeys['gemini-flash']}
                        onChange={(e) => {
                          setTempKeys(prev => ({ ...prev, ['gemini-flash']: e.target.value }));
                          setTestStatus({ type: null, message: '' });
                        }}
                        placeholder="Nhập API Key cho Gemini..."
                        className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono text-sm"
                      />
                      <button 
                        onClick={async () => {
                          if (!tempKeys['gemini-flash']) {
                            setTestStatus({ type: 'error', message: "Vui lòng nhập API Key để kiểm tra." });
                            return;
                          }
                          setTestStatus({ type: 'loading', message: "Đang kiểm tra..." });
                          const testService = new GeminiService(tempKeys['gemini-flash'], "gemini-3-flash-preview");
                          try {
                            await testService.lookupMedicalTerm("test");
                            setTestStatus({ type: 'success', message: "Kết nối thành công! API Key hoạt động tốt." });
                          } catch (err: any) {
                            setTestStatus({ type: 'error', message: "Lỗi kết nối: " + err.message });
                          }
                        }}
                        disabled={testStatus.type === 'loading'}
                        className="px-4 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-all flex items-center justify-center disabled:opacity-50"
                        title="Kiểm tra kết nối"
                      >
                        {testStatus.type === 'loading' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    {testStatus.type && (
                      <div className={cn(
                        "mt-2 p-3 rounded-xl text-[10px] font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-1",
                        testStatus.type === 'success' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : 
                        testStatus.type === 'error' ? "bg-rose-50 text-rose-600 border border-rose-100" :
                        "bg-indigo-50 text-indigo-600 border border-indigo-100"
                      )}>
                        {testStatus.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                        {testStatus.message}
                      </div>
                    )}
                    
                    <div className="mt-2 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                      <p className="text-[10px] text-indigo-700 leading-relaxed">
                        <span className="font-bold">Ghi chú:</span> Nếu để trống, ứng dụng sẽ sử dụng API Key mặc định từ hệ thống (nếu có).
                      </p>
                    </div>

                    {(window as any).aistudio?.openSelectKey && (
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
                  
                  {/* Key Vault Section */}
                  <div className="pt-4 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Key className="w-4 h-4 text-indigo-500" />
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                          Kho lưu trữ Key (Vault)
                        </label>
                      </div>
                      {user && (
                        <button 
                          onClick={() => setIsAddingKey(!isAddingKey)}
                          className="text-[10px] font-black text-indigo-600 hover:text-indigo-700 uppercase tracking-tighter flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded-md"
                        >
                          <Plus className="w-3 h-3" /> Thêm Key mới
                        </button>
                      )}
                    </div>

                    {!user ? (
                      <div className="bg-slate-50 rounded-2xl p-6 text-center border border-dashed border-slate-200">
                        <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                        <p className="text-xs font-bold text-slate-500 mb-4">Đăng nhập để lưu trữ nhiều API Key và tự động chuyển đổi khi hết hạn mức.</p>
                        <button 
                          onClick={() => setShowAuthModal(true)}
                          className="bg-indigo-600 text-white px-6 py-2 rounded-full text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                        >
                          Đăng nhập ngay
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {isAddingKey && (
                          <motion.div 
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-indigo-50/50 rounded-2xl p-4 border border-indigo-100 mb-4"
                          >
                            <div className="grid grid-cols-1 gap-3 mb-3">
                              <input 
                                type="text"
                                placeholder="Tên gợi nhớ (VD: Key 1)"
                                value={newKey.name}
                                onChange={(e) => setNewKey(prev => ({ ...prev, name: e.target.value }))}
                                className="px-3 py-2 bg-white border border-indigo-100 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                              />
                            </div>
                            <input 
                              type="password"
                              placeholder="Dán API Key vào đây..."
                              value={newKey.value}
                              onChange={(e) => setNewKey(prev => ({ ...prev, value: e.target.value }))}
                              className="w-full px-3 py-2 bg-white border border-indigo-100 rounded-xl text-xs mb-3 focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                            />
                            <div className="flex justify-end gap-2">
                              <button 
                                onClick={() => setIsAddingKey(false)}
                                className="px-3 py-1.5 text-[10px] font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                Hủy
                              </button>
                              <button 
                                onClick={handleAddKey}
                                className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100"
                              >
                                Lưu vào Vault
                              </button>
                            </div>
                          </motion.div>
                        )}

                        <div className="max-h-[200px] overflow-y-auto pr-2 space-y-2 no-scrollbar">
                          {userKeys.length === 0 ? (
                            <p className="text-[10px] text-slate-400 text-center py-4 italic">Chưa có Key nào trong kho lưu trữ.</p>
                          ) : (
                            userKeys.map((key) => (
                              <div 
                                key={key.id}
                                className={cn(
                                  "flex items-center justify-between p-3 rounded-xl border transition-all group",
                                  selectedKeyId === key.id 
                                    ? "bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200" 
                                    : "bg-white border-slate-100 hover:border-slate-200"
                                )}
                              >
                                <div 
                                  className="flex-1 cursor-pointer"
                                  onClick={() => setSelectedKeyId(key.id)}
                                >
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-xs font-bold text-slate-700">{key.name}</span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 font-mono truncate max-w-[200px]">
                                    {key.value.substring(0, 8)}••••••••{key.value.substring(key.value.length - 4)}
                                  </p>
                                  {key.lastUsed && (
                                    <p className="text-[8px] text-slate-300 italic mt-0.5">
                                      Dùng lần cuối: {new Date(key.lastUsed.toDate()).toLocaleString('vi-VN')}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={() => setKeyToDelete(key)}
                                    className="p-1.5 hover:bg-rose-50 text-rose-400 hover:text-rose-500 rounded-lg transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                  {selectedKeyId === key.id && (
                                    <div className="bg-emerald-500 p-1 rounded-full">
                                      <CheckCircle2 className="w-3 h-3 text-white" />
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="pt-6 border-t border-slate-100 mb-4">
                    <h3 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-2">
                      <Trash2 className="w-4 h-4 text-rose-500" />
                      Quản lý dữ liệu
                    </h3>
                    <p className="text-[10px] text-slate-500 mb-3">
                      Xóa tất cả các bản dịch đã lưu trong phiên làm việc hiện tại.
                    </p>
                    <button 
                      onClick={clearAllTranslations}
                      className="w-full py-2 bg-rose-50 text-rose-600 rounded-xl text-xs font-bold hover:bg-rose-100 transition-all border border-rose-100 flex items-center justify-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Xóa tất cả bản dịch
                    </button>
                  </div>
                  
                  <div className="pt-4 flex gap-3">
                    <button 
                      onClick={() => setShowSettings(false)}
                      className="flex-1 px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                    >
                      Hủy
                    </button>
                    <button 
                      onClick={() => saveSettings(tempKeys)}
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

      {/* Download Modal */}
      <AnimatePresence>
        {showDownloadModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDownloadModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="bg-indigo-100 p-2 rounded-xl">
                      <Download className="text-indigo-600 w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-xl font-display font-bold text-slate-800">Tải xuống bản dịch</h3>
                      <p className="text-xs text-slate-400 font-medium">Chọn các trang bạn muốn xuất ra file Word (.docx)</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowDownloadModal(false)}
                    className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5 text-slate-400 rotate-180" />
                  </button>
                </div>

                <div className="mb-4 flex items-center justify-between bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => {
                        const allTranslated = Object.keys(translations)
                          .filter(p => translations[Number(p)]?.status === 'success')
                          .map(Number);
                        setSelectedPagesToDownload(allTranslated);
                      }}
                      className="text-[10px] font-black text-indigo-600 hover:text-indigo-700 uppercase tracking-widest"
                    >
                      Chọn tất cả đã dịch
                    </button>
                    <button 
                      onClick={() => setSelectedPagesToDownload([])}
                      className="text-[10px] font-black text-slate-400 hover:text-slate-500 uppercase tracking-widest"
                    >
                      Bỏ chọn tất cả
                    </button>
                  </div>
                  <div className="text-[10px] font-bold text-slate-500">
                    Đã chọn: <span className="text-indigo-600">{selectedPagesToDownload.length}</span> trang
                  </div>
                </div>

                <div className="max-h-[400px] overflow-y-auto pr-2 grid grid-cols-5 sm:grid-cols-8 gap-2 no-scrollbar p-1">
                  {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => {
                    const isTranslated = translations[pageNum]?.status === 'success';
                    const isSelected = selectedPagesToDownload.includes(pageNum);
                    
                    return (
                      <button
                        key={pageNum}
                        disabled={!isTranslated}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedPagesToDownload(prev => prev.filter(p => p !== pageNum));
                          } else {
                            setSelectedPagesToDownload(prev => [...prev, pageNum].sort((a, b) => a - b));
                          }
                        }}
                        className={cn(
                          "aspect-square rounded-xl border flex flex-col items-center justify-center transition-all relative group",
                          isSelected 
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100 scale-105 z-10" 
                            : isTranslated
                              ? "bg-white border-indigo-100 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/30"
                              : "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed opacity-60"
                        )}
                      >
                        <span className="text-xs font-black">{pageNum}</span>
                        {isTranslated && !isSelected && (
                          <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                        )}
                        {isSelected && (
                          <CheckCircle2 className="w-3 h-3 absolute -top-1 -right-1 bg-white text-indigo-600 rounded-full" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-8 flex gap-3">
                  <button 
                    onClick={() => setShowDownloadModal(false)}
                    className="flex-1 px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    Hủy
                  </button>
                  <button 
                    disabled={selectedPagesToDownload.length === 0}
                    onClick={() => {
                      handleDownload(selectedPagesToDownload);
                      setShowDownloadModal(false);
                    }}
                    className="flex-1 px-6 py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Tải file Word ({selectedPagesToDownload.length} trang)
                  </button>
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
            Copyright © Dr. Hoang Hiep • Medical Grade Translation
          </p>
        </footer>
      )}
    </div>
    </ErrorBoundary>
  );
}
