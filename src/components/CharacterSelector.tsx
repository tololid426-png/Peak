import React, { useRef, useState, useEffect } from 'react';
import { History, X, Check, Image as ImageIcon, Sparkles } from 'lucide-react';
import { CharacterItem } from '../types/motion';
import { CHARACTER_PRESETS } from '../data/presets';

interface CharacterSelectorProps {
  selectedCharacter: CharacterItem | null;
  onSelectCharacter: (char: CharacterItem) => void;
  customCharacterUrl: string | null;
  customCharacterFile: File | null;
  onUploadCustomImage: (dataUrl: string, file?: File | null) => void;
}

export const CharacterSelector: React.FC<CharacterSelectorProps> = ({
  selectedCharacter,
  onSelectCharacter,
  customCharacterUrl,
  customCharacterFile,
  onUploadCustomImage,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isGalleryOpen, setIsGalleryOpen] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeImageUrl = customCharacterUrl || selectedCharacter?.imageUrl || null;
  const isCustom = Boolean(customCharacterUrl);

  const handleProcessFile = (file: File) => {
    setErrorMessage(null);
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Mohon pilih file gambar yang valid (JPG, PNG, atau WEBP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        onUploadCustomImage(event.target.result as string, file);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  // Clipboard Paste (Ctrl+V) support
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            handleProcessFile(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleClearCustom = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUploadCustomImage('', null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Main Upload Dropzone Card (Matches exact image mockup) */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`group relative rounded-3xl border-2 border-dashed transition-all p-6 sm:p-7 flex flex-col items-center justify-center text-center cursor-pointer select-none ${
          isDragging
            ? 'border-amber-500 bg-amber-50/60 scale-[1.01]'
            : 'border-stone-300 hover:border-stone-400 bg-[#f9f8f4] hover:bg-[#f3f2eb]'
        }`}
      >
        {/* If an image is currently loaded, display preview overlay or full card preview */}
        {activeImageUrl ? (
          <div className="w-full flex flex-col items-center">
            {/* Image Preview & Badges */}
            <div className="relative mb-3.5 group/preview">
              <div className="w-24 h-28 sm:w-28 sm:h-32 rounded-2xl overflow-hidden shadow-md border-2 border-white bg-stone-200">
                <img
                  src={activeImageUrl}
                  alt={isCustom ? 'Foto Kustom' : selectedCharacter?.name || 'Foto Karakter'}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover object-top"
                />
              </div>

              {isCustom && (
                <button
                  type="button"
                  onClick={handleClearCustom}
                  className="absolute -top-2 -right-2 p-1 rounded-full bg-stone-900 text-white hover:bg-red-600 shadow-md transition-colors"
                  title="Hapus foto kustom"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="space-y-1 mb-3">
              <div className="text-sm font-bold text-stone-800 flex items-center justify-center gap-1.5">
                <span>{isCustom ? customCharacterFile?.name || 'Foto Kustom' : selectedCharacter?.name || 'Karakter Pilihan'}</span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  {isCustom ? 'Foto Anda' : 'Dari Galeri'}
                </span>
              </div>
              <p className="text-xs text-stone-500">
                Klik kotak ini untuk ganti foto · atau Ctrl+V untuk tempel foto baru
              </p>
            </div>

            {/* Gallery Button */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                setIsGalleryOpen(true);
              }}
              className="mt-1"
            >
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-700 shadow-sm transition-all active:scale-95"
              >
                <History className="w-3.5 h-3.5 text-stone-500" />
                <span>Dari galeri</span>
              </button>
            </div>
          </div>
        ) : (
          /* Empty / Standby State (Matches exact mockup) */
          <>
            {/* Framed Picture Icon (Gold border, blue sky, green hill) */}
            <div className="w-12 h-12 rounded-xl border-2 border-amber-400 bg-gradient-to-b from-sky-300 via-sky-200 to-emerald-400 flex items-center justify-center shadow-sm p-1.5 mb-3.5">
              <div className="w-full h-full rounded-lg bg-white/80 backdrop-blur-xs flex items-center justify-center text-amber-600">
                <ImageIcon className="w-5 h-5" />
              </div>
            </div>

            {/* Title & Subtitle */}
            <h4 className="text-sm sm:text-base font-bold text-stone-800 mb-1">
              Gambar karakter
            </h4>
            <p className="text-xs text-stone-500 mb-4 max-w-xs leading-relaxed">
              JPG / PNG — maks 8 MP · atau Ctrl+V untuk tempel
            </p>

            {errorMessage && (
              <div className="mb-3 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 text-[11px] text-red-700 font-medium animate-in fade-in">
                {errorMessage}
              </div>
            )}

            {/* "Dari galeri" Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsGalleryOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-700 shadow-sm transition-all active:scale-95"
            >
              <History className="w-3.5 h-3.5 text-stone-500" />
              <span>Dari galeri</span>
            </button>
          </>
        )}
      </div>

      {/* Gallery Modal */}
      {isGalleryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-[#fbfbfa] border border-stone-300 shadow-2xl p-5 sm:p-6 overflow-hidden max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-stone-800">
                    Galeri Karakter Preset
                  </h3>
                  <p className="text-[11px] text-stone-500">
                    Pilih salah satu karakter siap pakai
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsGalleryOpen(false)}
                className="p-1.5 rounded-full hover:bg-stone-200 text-stone-500 hover:text-stone-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Grid of Preset Characters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-4 overflow-y-auto scrollbar-thin">
              {CHARACTER_PRESETS.map((char) => {
                const isSelected = selectedCharacter?.id === char.id && !customCharacterUrl;
                return (
                  <div
                    key={char.id}
                    onClick={() => {
                      onSelectCharacter(char);
                      onUploadCustomImage('', null);
                      setIsGalleryOpen(false);
                    }}
                    className={`group relative rounded-2xl overflow-hidden cursor-pointer border-2 transition-all text-left bg-white shadow-sm ${
                      isSelected
                        ? 'border-stone-900 ring-2 ring-stone-900/20'
                        : 'border-stone-200 hover:border-stone-400'
                    }`}
                  >
                    <div className="aspect-[3/4] w-full bg-stone-100 overflow-hidden relative">
                      <img
                        src={char.imageUrl}
                        alt={char.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                      {isSelected && (
                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-stone-900 text-white flex items-center justify-center shadow">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      )}
                      <div className="absolute bottom-2 left-2 right-2">
                        <div className="text-[11px] font-bold text-white truncate drop-shadow">
                          {char.name}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-stone-200 flex justify-end">
              <button
                type="button"
                onClick={() => setIsGalleryOpen(false)}
                className="px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold shadow-sm transition-colors"
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
