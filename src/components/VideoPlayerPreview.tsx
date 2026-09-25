import React, { useRef, useState, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Download,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Clock,
  Cpu,
  Film,
  Video,
  XCircle,
  PlusCircle,
  Layers,
  Trash2,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import { MotionPreset } from '../types/motion';

export interface JobItem {
  id: string;
  jobTitle?: string;
  status: 'WAITING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  createdAt: number;
  expiresAt: number | null;
  created_at_formatted: string;
  expires_at_formatted?: string;
  step: string;
  elapsedSeconds?: number;
  queuePosition?: number;
  totalWaitingInQueue?: number;
  apiKey?: string;
  videoUrl?: string;
  remoteVideoUrl?: string;
  webappId?: string;
  errorMessage?: string | null;
}

interface VideoPlayerPreviewProps {
  motion?: MotionPreset | null;
  customMotionDuration?: number | null;
  isGenerating: boolean;
  generationStatus: 'idle' | 'generating' | 'success' | 'failed' | 'cancelled';
  generationStep: string;
  elapsedSeconds: number;
  errorMessage: string | null;
  generatedVideoUrl: string | null;
  onRetry?: () => void;
  onCancel?: () => void;
  onNewJob?: () => void;
  // Multi-job queue management
  jobsList?: JobItem[];
  activeJobId?: string | null;
  onSelectJob?: (jobId: string) => void;
  onCancelJobById?: (jobId: string) => void;
  onDeleteJob?: (jobId: string) => void;
  onClearCompleted?: () => void;
  // Kept for backward compatibility
  character?: any;
  customCharacterUrl?: string | null;
  customMotionUrl?: string | null;
}

export const VideoPlayerPreview: React.FC<VideoPlayerPreviewProps> = ({
  motion,
  customMotionDuration,
  isGenerating,
  generationStatus,
  generationStep,
  elapsedSeconds,
  errorMessage,
  generatedVideoUrl,
  onRetry,
  onCancel,
  onNewJob,
  jobsList = [],
  activeJobId,
  onSelectJob,
  onCancelJobById,
  onDeleteJob,
  onClearCompleted,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [hasVideoError, setHasVideoError] = useState<boolean>(false);
  const [fallbackAttempted, setFallbackAttempted] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const outputVideoRef = useRef<HTMLVideoElement>(null);

  const effectiveMotionDuration = customMotionDuration || motion?.duration || 15;
  const activeJob = jobsList.find((j) => j.id === activeJobId) || null;

  // Format seconds to mm:ss format
  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    setHasVideoError(false);
    setFallbackAttempted(false);
    if (outputVideoRef.current && generatedVideoUrl && generationStatus !== 'generating') {
      outputVideoRef.current.load();
      if (isPlaying) outputVideoRef.current.play().catch(() => {});
    }
  }, [generatedVideoUrl, generationStatus, activeJobId]);

  const handleVideoError = () => {
    // If local video URL failed and remoteVideoUrl is available, try proxy fallback
    if (!fallbackAttempted && activeJob?.remoteVideoUrl && outputVideoRef.current) {
      setFallbackAttempted(true);
      const fallbackUrl = `/api/runninghub/proxy-video?url=${encodeURIComponent(activeJob.remoteVideoUrl)}`;
      outputVideoRef.current.src = fallbackUrl;
      outputVideoRef.current.load();
      outputVideoRef.current.play().catch(() => {});
      return;
    }
    setHasVideoError(true);
  };

  const togglePlay = () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);

    if (outputVideoRef.current) {
      if (nextState) outputVideoRef.current.play().catch(() => {});
      else outputVideoRef.current.pause();
    }
  };

  const handleReset = () => {
    if (outputVideoRef.current) {
      outputVideoRef.current.currentTime = 0;
      if (isPlaying) outputVideoRef.current.play().catch(() => {});
    }
  };

  const downloadFilename = `motion_studio_${activeJobId || Date.now()}.mp4`;
  const directDownloadUrl = activeJobId
    ? `/api/jobs/${activeJobId}/download?filename=${encodeURIComponent(downloadFilename)}`
    : generatedVideoUrl
    ? `/api/download?url=${encodeURIComponent(generatedVideoUrl)}&filename=${encodeURIComponent(downloadFilename)}`
    : '';

  const handleCopyLink = () => {
    if (!directDownloadUrl && !generatedVideoUrl) return;
    const targetPath = directDownloadUrl || generatedVideoUrl || '';
    const fullUrl = targetPath.startsWith('http')
      ? targetPath
      : `${window.location.origin}${targetPath}`;

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(fullUrl).then(() => {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2500);
      }).catch(() => {
        fallbackCopy(fullUrl);
      });
    } else {
      fallbackCopy(fullUrl);
    }
  };

  const fallbackCopy = (text: string) => {
    try {
      const input = document.createElement('input');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch (e) {
      console.warn('Copy failed:', e);
    }
  };

  const activeCount = jobsList.filter(
    (j) => j.status === 'RUNNING' || j.status === 'WAITING'
  ).length;

  return (
    <div className="space-y-3.5">
      {/* 1. Multi-Job Queue & Switcher (Simple & Minimalist) */}
      {jobsList.length > 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-stone-700 flex items-center gap-1.5">
              <span>Antrian & Riwayat</span>
              <span className="text-[11px] font-mono text-stone-500 font-medium">
                ({activeCount}/10 Aktif)
              </span>
            </span>

            <div className="flex items-center gap-1.5">
              {jobsList.some((j) => j.status === 'FAILED' || j.status === 'CANCELLED') && onClearCompleted && (
                <button
                  onClick={onClearCompleted}
                  className="text-[11px] font-medium text-stone-500 hover:text-red-600 px-2 py-0.5 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Bersihkan Gagal
                </button>
              )}
            </div>
          </div>

          {/* Job Chips List */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
            {jobsList.map((job, idx) => {
              const isActive = activeJobId === job.id;
              const statusLabel =
                job.status === 'RUNNING'
                  ? 'Render'
                  : job.status === 'WAITING'
                  ? `Antri #${job.queuePosition || 1}`
                  : job.status === 'SUCCESS'
                  ? 'Selesai'
                  : job.status === 'CANCELLED'
                  ? 'Batal'
                  : 'Gagal';

              return (
                <div
                  key={job.id}
                  className={`rounded-xl shrink-0 flex items-center transition-all ${
                    isActive
                      ? 'bg-stone-900 text-white shadow-xs font-semibold'
                      : 'bg-[#f4f3ec] text-stone-700 hover:bg-stone-200/80 border border-stone-200'
                  }`}
                >
                  <button
                    onClick={() => onSelectJob && onSelectJob(job.id)}
                    className="px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        job.status === 'RUNNING'
                          ? 'bg-amber-400 animate-pulse'
                          : job.status === 'WAITING'
                          ? 'bg-blue-400'
                          : job.status === 'SUCCESS'
                          ? 'bg-emerald-400'
                          : job.status === 'CANCELLED'
                          ? 'bg-stone-400'
                          : 'bg-red-400'
                      }`}
                    />
                    <span>Job #{idx + 1}</span>
                    <span className={`text-[10px] ${isActive ? 'text-stone-300' : 'text-stone-500'}`}>
                      · {statusLabel}
                    </span>
                  </button>

                  {/* Optional delete button for finished jobs */}
                  {(job.status === 'SUCCESS' || job.status === 'FAILED' || job.status === 'CANCELLED') && onDeleteJob && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteJob(job.id);
                      }}
                      className={`pr-2 pl-0.5 py-1.5 transition-colors ${
                        isActive
                          ? 'text-stone-400 hover:text-red-300'
                          : 'text-stone-400 hover:text-red-600'
                      }`}
                      title="Hapus job ini"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. Main Video Preview Card */}
      <div className="rounded-3xl border border-stone-300/80 bg-white/90 p-4 sm:p-5 flex flex-col shadow-sm">
        {/* Top Header with Status & Controls */}
        <div className="flex items-center justify-between pb-3 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wider">
              Hasil Video Render
            </h3>

            {/* Status Badge */}
            {generationStatus === 'generating' && (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-mono animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                Proses: {formatTime(elapsedSeconds)}
              </span>
            )}

            {generationStatus === 'success' && generatedVideoUrl && (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-mono">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                {elapsedSeconds > 0 ? `Selesai ${formatTime(elapsedSeconds)}` : 'Selesai (48 Jam)'}
              </span>
            )}

            {generationStatus === 'cancelled' && (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200 text-[11px] font-mono">
                <XCircle className="w-3 h-3" />
                Dibatalkan
              </span>
            )}

            {generationStatus === 'failed' && (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-[11px] font-mono">
                <AlertCircle className="w-3 h-3" />
                Gagal ({formatTime(elapsedSeconds)})
              </span>
            )}

            {generationStatus === 'idle' && !generatedVideoUrl && (
              <span className="px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-500 border border-stone-200 text-[11px] font-mono">
                Standby
              </span>
            )}
          </div>

          {/* Video Controls (only active when video exists) */}
          {generatedVideoUrl && generationStatus !== 'generating' && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={togglePlay}
                disabled={isGenerating || generationStatus === 'failed'}
                className="p-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 disabled:opacity-30 text-stone-700 text-xs transition-colors"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={handleReset}
                disabled={isGenerating || generationStatus === 'failed'}
                className="p-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 disabled:opacity-30 text-stone-700 text-xs transition-colors"
                title="Ulangi dari awal (0s)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Main Video Display Area */}
        <div className="my-3.5 rounded-2xl border border-stone-300 bg-stone-950 overflow-hidden relative shadow-inner">
          <div className="aspect-[9/16] sm:aspect-[4/5] max-h-[480px] w-full flex items-center justify-center relative bg-black mx-auto">
            {/* STATE 1: SEDANG MEMPROSES (Detik Berjalan & Tombol Batalkan) */}
            {generationStatus === 'generating' && (
              <div className="w-full h-full p-6 flex flex-col items-center justify-center text-center bg-stone-950/95 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 via-amber-500/10 to-transparent animate-pulse" />

                <div className="relative mb-3 flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full border-4 border-amber-500/20 border-t-amber-400 animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center font-mono font-bold text-sm text-amber-300">
                    {formatTime(elapsedSeconds)}
                  </div>
                </div>

                <span className="text-sm font-semibold text-white px-4 mb-2 relative z-10">
                  {generationStep}
                </span>

                {/* Cancel Button during Generation */}
                {onCancel && (
                  <button
                    onClick={onCancel}
                    className="relative z-10 my-2 px-4 py-2 rounded-xl bg-red-950/80 hover:bg-red-900 border border-red-800/80 text-red-200 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md active:scale-95"
                  >
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                    <span>Batalkan Generate</span>
                  </button>
                )}

                <div className="w-full max-w-xs mt-2 pt-2 border-t border-stone-800 flex flex-col gap-1.5 text-xs text-stone-400 font-mono relative z-10">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-amber-400" /> Waktu Berjalan:
                    </span>
                    <span className="text-amber-300 font-bold">{elapsedSeconds} detik</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Cpu className="w-3 h-3 text-stone-400" /> Model:
                    </span>
                    <span className="text-stone-300">Motion Control HD</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Resolusi:</span>
                    <span className="text-stone-300">1080p Full HD</span>
                  </div>
                </div>
              </div>
            )}

            {/* STATE 2: DIBATALKAN */}
            {generationStatus === 'cancelled' && (
              <div className="w-full h-full p-6 flex flex-col items-center justify-center text-center bg-stone-950 text-stone-400">
                <div className="w-12 h-12 rounded-full bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-400 mb-3">
                  <XCircle className="w-6 h-6 text-stone-400" />
                </div>
                <span className="text-sm font-bold text-white mb-1">
                  Generate Dibatalkan
                </span>
                <p className="text-xs text-stone-400 mb-4 px-4 max-w-sm">
                  Proses render untuk job ini telah dibatalkan. Anda dapat membuat job baru kapan saja.
                </p>
                {onNewJob && (
                  <button
                    onClick={onNewJob}
                    className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-white text-stone-900 text-xs font-semibold flex items-center gap-2 transition-colors shadow-sm"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Buat Job Baru</span>
                  </button>
                )}
              </div>
            )}

            {/* STATE 3: GAGAL / ERROR */}
            {generationStatus === 'failed' && (
              <div className="w-full h-full p-6 flex flex-col items-center justify-center text-center bg-red-950/40">
                <div className="w-12 h-12 rounded-full bg-red-900/50 border border-red-500/40 flex items-center justify-center text-red-400 mb-3">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <span className="text-sm font-bold text-red-200 mb-1">
                  Render Gagal ({formatTime(elapsedSeconds)})
                </span>
                <p className="text-xs text-red-300/90 mb-4 px-4 max-w-sm">
                  {errorMessage || 'Terjadi gangguan saat memproses video ke RunningHub.'}
                </p>
                <div className="flex items-center gap-2">
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors shadow-md"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Coba Ulangi</span>
                    </button>
                  )}
                  {onNewJob && (
                    <button
                      onClick={onNewJob}
                      className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-white text-xs font-semibold flex items-center gap-2 transition-colors"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>Job Baru</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* STATE 4: BELUM ADA VIDEO (STANDBY / KOSONG) */}
            {!generatedVideoUrl &&
              generationStatus !== 'generating' &&
              generationStatus !== 'failed' &&
              generationStatus !== 'cancelled' && (
                <div className="w-full h-full p-6 flex flex-col items-center justify-center text-center bg-stone-950 text-stone-400">
                  <div className="w-16 h-16 rounded-2xl bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-400 mb-4 shadow-inner">
                    <Film className="w-8 h-8 opacity-70" />
                  </div>
                  <h4 className="text-sm font-semibold text-white mb-1.5">
                    Belum Ada Hasil Render
                  </h4>
                  <p className="text-xs text-stone-400 max-w-xs leading-relaxed mb-4">
                    Pilih gambar karakter & video gerakan di sebelah kiri, lalu klik{' '}
                    <strong className="text-stone-200">"Generate Video Animasi"</strong>.
                  </p>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-stone-400 bg-stone-900 px-3 py-1.5 rounded-xl border border-stone-800">
                    <Video className="w-3.5 h-3.5 text-amber-400" />
                    <span>Output 1080p Full HD · Retensi 48 Jam</span>
                  </div>
                </div>
              )}

            {/* STATE 5: SUKSES / VIDEO PLAYER UTAMA MILIK USER */}
            {generatedVideoUrl &&
              generationStatus !== 'generating' &&
              generationStatus !== 'failed' &&
              generationStatus !== 'cancelled' && (
                <>
                  {hasVideoError ? (
                    <div className="w-full h-full p-6 flex flex-col items-center justify-center text-center bg-stone-950 text-stone-300">
                      <div className="w-12 h-12 rounded-full bg-amber-950/80 border border-amber-800/80 flex items-center justify-center text-amber-400 mb-3">
                        <AlertCircle className="w-6 h-6" />
                      </div>
                      <span className="text-sm font-bold text-white mb-1">
                        Video Tidak Dapat Diputar / Berkas Rusak
                      </span>
                      <p className="text-xs text-stone-400 mb-4 px-4 max-w-sm">
                        Berkas video tidak dapat dimuat oleh peramban. Silakan muat ulang atau generate ulang job ini.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setHasVideoError(false);
                            if (outputVideoRef.current) outputVideoRef.current.load();
                          }}
                          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-semibold flex items-center gap-2 transition-colors shadow-sm"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Muat Ulang Video</span>
                        </button>
                        {onRetry && (
                          <button
                            onClick={onRetry}
                            className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-white text-xs font-semibold flex items-center gap-2 transition-colors"
                          >
                            <PlusCircle className="w-3.5 h-3.5" />
                            <span>Generate Ulang</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <video
                        ref={outputVideoRef}
                        key={generatedVideoUrl}
                        src={generatedVideoUrl}
                        autoPlay
                        loop
                        playsInline
                        controls
                        onError={handleVideoError}
                        className="w-full h-full object-contain"
                      />
                      {elapsedSeconds > 0 && (
                        <div className="absolute top-3 left-3 pointer-events-none">
                          <span className="text-[10px] font-mono font-medium bg-stone-900/90 text-emerald-400 border border-stone-700 px-2.5 py-0.5 rounded-lg shadow">
                            ✓ Render {elapsedSeconds}s (Tersimpan 48 Jam)
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
          </div>
        </div>

        {/* Parameter Info Footer */}
        <div className="py-2.5 px-3.5 mb-3 rounded-2xl bg-stone-50 border border-stone-200 flex items-center justify-between text-xs font-mono text-stone-600">
          <div className="flex items-center gap-2 truncate">
            <span>
              Resolusi:{' '}
              <strong className="text-stone-900 font-semibold">
                {activeJob?.webappId === '2098087538199212034' ? '736p HD' : '1080p Full HD'}
              </strong>
            </span>
            <span>·</span>
            <span>
              Durasi: <strong className="text-stone-900 font-semibold">{effectiveMotionDuration}s</strong>
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={`w-2 h-2 rounded-full ${
                generationStatus === 'generating'
                  ? 'bg-amber-500 animate-ping'
                  : generationStatus === 'failed'
                  ? 'bg-red-500'
                  : generationStatus === 'cancelled'
                  ? 'bg-stone-400'
                  : generatedVideoUrl
                  ? 'bg-emerald-500'
                  : 'bg-stone-400'
              }`}
            />
            <span className="text-stone-700 font-sans font-medium">
              {generationStatus === 'generating'
                ? `Diproses (${elapsedSeconds}s)...`
                : generationStatus === 'failed'
                ? `Gagal (${elapsedSeconds}s)`
                : generationStatus === 'cancelled'
                ? 'Dibatalkan'
                : generatedVideoUrl
                ? `Selesai (${elapsedSeconds}s)`
                : 'Standby'}
            </span>
          </div>
        </div>

        {/* Action Button: Download Video Suite */}
        <div>
          {generatedVideoUrl &&
          !isGenerating &&
          generationStatus !== 'failed' &&
          generationStatus !== 'cancelled' ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <a
                href={directDownloadUrl || generatedVideoUrl}
                download={downloadFilename}
                target="_self"
                className="flex-1 py-3 px-4 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.99] text-center cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Video (.MP4)</span>
              </a>

              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href={generatedVideoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-3 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  title="Buka pemutar video di tab baru"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="text-[11px]">Buka Tab</span>
                </a>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-3.5 py-3 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  title="Salin tautan langsung berkas video"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-[11px] text-emerald-700 font-bold">Disalin!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span className="text-[11px]">Salin Link</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <button
              disabled
              className="w-full py-3 px-4 rounded-xl bg-stone-900/30 text-stone-400 text-xs font-bold flex items-center justify-center gap-2 cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              <span>Download Video (.MP4)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
