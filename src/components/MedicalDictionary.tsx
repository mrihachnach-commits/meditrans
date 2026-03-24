import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Book, Loader2, ExternalLink, Copy, Check } from 'lucide-react';
import { GeminiService } from '../services/geminiService';
import { cn } from '../lib/utils';

interface MedicalTermInfo {
  term: string;
  definition: string;
  synonyms: string[];
  relatedTerms: string[];
  source?: string;
}

interface MedicalDictionaryProps {
  selectedTerm: string;
  onClose: () => void;
  geminiService: GeminiService | null;
  position: { x: number; y: number };
}

export const MedicalDictionary: React.FC<MedicalDictionaryProps> = ({ 
  selectedTerm, 
  onClose, 
  geminiService,
  position 
}) => {
  const [info, setInfo] = useState<MedicalTermInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    if (!selectedTerm) return;

    const lookup = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!geminiService) throw new Error("Gemini Service not initialized");
        
        const result = await geminiService.lookupMedicalTerm(selectedTerm);
        setInfo(result);
      } catch (err: any) {
        console.error("Dictionary lookup error:", err);
        setError(err.message || "Không thể tra cứu thuật ngữ này.");
      } finally {
        setLoading(false);
      }
    };

    lookup();
  }, [selectedTerm, geminiService]);

  const handleCopy = () => {
    if (info) {
      navigator.clipboard.writeText(`${info.term}: ${info.definition}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Adjust position to keep it within viewport
  const adjustedPosition = {
    left: Math.min(position.x, window.innerWidth - 350),
    top: Math.min(position.y, window.innerHeight - 400)
  };

  return (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 10 }}
        className="fixed z-[100] w-[320px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        style={{ 
          left: adjustedPosition.left, 
          top: adjustedPosition.top,
        }}
      >
        <div className="bg-indigo-600 px-4 py-3 flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <Book className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider">Từ điển Y khoa</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 max-h-[400px] overflow-auto">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-xs font-medium italic">Đang tra cứu "{selectedTerm}"...</p>
            </div>
          ) : error ? (
            <div className="py-8 text-center">
              <p className="text-sm text-rose-500 font-medium">{error}</p>
              <button 
                onClick={onClose}
                className="mt-4 text-xs font-bold text-slate-400 hover:text-slate-600 uppercase"
              >
                Đóng
              </button>
            </div>
          ) : info ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-display font-bold text-slate-800 leading-tight">
                    {info.term}
                  </h3>
                  <button 
                    onClick={handleCopy}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                    title="Sao chép định nghĩa"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {info.term.toLowerCase() !== selectedTerm.toLowerCase() && (
                  <p className="text-[10px] text-slate-400 mb-2 italic">
                    Tra cứu từ: "{selectedTerm}"
                  </p>
                )}
                <div className="h-1 w-12 bg-indigo-500 rounded-full mb-3" />
                <p className="text-sm text-slate-600 leading-relaxed">
                  {info.definition}
                </p>
              </div>

              {info.synonyms.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Từ đồng nghĩa</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {info.synonyms.map((syn, i) => (
                      <span key={i} className="px-2 py-1 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md border border-slate-200">
                        {syn}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {info.relatedTerms.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Thuật ngữ liên quan</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {info.relatedTerms.map((term, i) => (
                      <span key={i} className="px-2 py-1 bg-indigo-50 text-indigo-600 text-[10px] font-bold rounded-md border border-indigo-100">
                        {term}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[9px] text-slate-400 italic">Nguồn: {info.source || 'AI Medical Lexicon'}</span>
                <button className="flex items-center gap-1 text-[9px] font-bold text-indigo-500 hover:underline">
                  Xem thêm <ExternalLink className="w-2 h-2" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
