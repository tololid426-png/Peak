import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { CharacterSelector } from './components/CharacterSelector';
import { MotionSelector } from './components/MotionSelector';
import { VideoPlayerPreview, JobItem } from './components/VideoPlayerPreview';
import { ApiSettingsModal } from './components/ApiSettingsModal';
import { CHARACTER_PRESETS, MOTION_PRESETS } from './data/presets';
import { CharacterItem, MotionPreset } from './types/motion';
import { Sparkles, ArrowRight, AlertTriangle, CheckCircle2, XCircle, Layers } from 'lucide-react';

export default function App() {
  // Input 1: Character Foto (Default to null for clean empty standby card)
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterItem | null>(null);
  const [customCharacterUrl, setCustomCharacterUrl] = useState<string | null>(null);
  const [customCharacterFile, setCustomCharacterFile] = useState<File | null>(null);

  // Input 2: Video Gerakan (Default to null for clean empty standby card)
  const [selectedMotion, setSelectedMotion] = useState<MotionPreset | null>(null);
  const [customMotionUrl, setCustomMotionUrl] = useState<string | null>(null);
  const [customMotionFile, setCustomMotionFile] = useState<File | null>(null);
  const [customMotionDuration, setCustomMotionDuration] = useState<number | null>(null);

  // API Config (Motion Control 1080p Pipeline)
  const webappId = '2083908699113918465';
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('rh_api_key') || '');
  const [apiKeysPool, setApiKeysPool] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('rh_api_keys_pool');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [isApiSettingsOpen, setIsApiSettingsOpen] = useState<boolean>(false);

  // Multi-Job Queue State
  const [jobsList, setJobsList] = useState<JobItem[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Active Job specific display states
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Job Timers (tracks elapsed seconds per job)
  const [jobElapsedMap, setJobElapsedMap] = useState<Record<string, number>>({});

  // Active API Key balance / coins state
  const [keyBalance, setKeyBalance] = useState<string | null>(null);

  // Check active key balance whenever apiKey changes
  useEffect(() => {
    if (!apiKey || !apiKey.trim()) {
      setKeyBalance(null);
      return;
    }

    const checkBalance = async () => {
      try {
        const res = await fetch('/api/runninghub/check-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        });
        const data = await res.json();
        if (data.code === 0 && data.balance !== null && data.balance !== undefined) {
          setKeyBalance(String(data.balance));
        } else {
          setKeyBalance(null);
        }
      } catch {
        setKeyBalance(null);
      }
    };

    checkBalance();
  }, [apiKey]);

  // Sync apiKey & apiKeysPool to localStorage
  useEffect(() => {
    if (apiKey) {
      localStorage.setItem('rh_api_key', apiKey);
    }
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem('rh_api_keys_pool', JSON.stringify(apiKeysPool));
  }, [apiKeysPool]);

  // Initial load of recent jobs from backend
  useEffect(() => {
    const fetchInitialJobs = async () => {
      try {
        const res = await fetch('/api/jobs');
        const data = await res.json();
        if (data.code === 0 && Array.isArray(data.data) && data.data.length > 0) {
          setJobsList(data.data);
          setActiveJobId(data.data[0].id);
        }
      } catch {
        // silent fail on initial load
      }
    };
    fetchInitialJobs();
  }, []);

  // Background ticker for elapsed seconds on running/waiting jobs
  useEffect(() => {
    const interval = setInterval(() => {
      setJobElapsedMap((prev) => {
        const updated = { ...prev };
        for (const job of jobsList) {
          if (job.status === 'RUNNING' || job.status === 'WAITING') {
            const runningSeconds = Math.max(0, Math.floor((Date.now() - job.createdAt) / 1000));
            updated[job.id] = runningSeconds;
          }
        }
        return updated;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [jobsList]);

  // Background poller for all active jobs (RUNNING / WAITING)
  useEffect(() => {
    const hasActiveJobs = jobsList.some(
      (j) => j.status === 'RUNNING' || j.status === 'WAITING'
    );

    if (!hasActiveJobs) return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/jobs');
        const data = await res.json();
        if (data.code === 0 && Array.isArray(data.data)) {
          setJobsList(data.data);
        }
      } catch {
        // Ignore network blips
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [jobsList]);

  // Auto-dismiss success notice banner automatically after 2 seconds
  useEffect(() => {
    if (!successNotice) return;

    const timer = setTimeout(() => {
      setSuccessNotice(null);
    }, 2000);

    return () => clearTimeout(timer);
  }, [successNotice]);

  // Derive active job details
  const activeJob = jobsList.find((j) => j.id === activeJobId) || null;
  const activeElapsed = activeJob ? jobElapsedMap[activeJob.id] || 0 : 0;

  // Derive preview status
  const generationStatus: 'idle' | 'generating' | 'success' | 'failed' | 'cancelled' = activeJob
    ? activeJob.status === 'RUNNING' || activeJob.status === 'WAITING'
      ? 'generating'
      : activeJob.status === 'SUCCESS'
      ? 'success'
      : activeJob.status === 'CANCELLED'
      ? 'cancelled'
      : 'failed'
    : 'idle';

  const isGenerating = generationStatus === 'generating' || isSubmitting;
  const generationStep = activeJob ? activeJob.step : isSubmitting ? 'Memproses permintaan...' : 'Standby';
  const generatedVideoUrl = activeJob?.remoteVideoUrl || activeJob?.videoUrl || null;
  const activeErrorMessage = activeJob?.errorMessage || errorNotice;

  // Handle Cancel Active Job
  const handleCancelJob = async (jobIdToCancel?: string) => {
    const targetId = jobIdToCancel || activeJobId;
    if (!targetId) return;

    try {
      const res = await fetch(`/api/jobs/${targetId}/cancel`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.code === 0 && data.data) {
        setJobsList((prev) =>
          prev.map((j) => (j.id === targetId ? { ...j, ...data.data, status: 'CANCELLED' } : j))
        );
        setSuccessNotice('Generate berhasil dibatalkan. Anda dapat membuat job baru kapan saja.');
      }
    } catch {
      setErrorNotice('Gagal membatalkan generate.');
    }
  };

  // Handle Delete Single Job
  const handleDeleteJob = async (jobIdToDelete: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobIdToDelete}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.code === 0) {
        setJobsList((prev) => prev.filter((j) => j.id !== jobIdToDelete));
        if (activeJobId === jobIdToDelete) {
          const remaining = jobsList.filter((j) => j.id !== jobIdToDelete);
          setActiveJobId(remaining.length > 0 ? remaining[0].id : null);
        }
        setSuccessNotice('Job riwayat berhasil dihapus.');
      }
    } catch {
      setErrorNotice('Gagal menghapus job.');
    }
  };

  // Handle Clear Completed/Finished Jobs
  const handleClearCompletedJobs = async () => {
    try {
      const res = await fetch('/api/jobs/clear-finished', {
        method: 'POST',
      });
      const data = await res.json();
      if (data.code === 0) {
        setJobsList((prev) => prev.filter((j) => j.status === 'RUNNING' || j.status === 'WAITING'));
        const stillActive = jobsList.find((j) => j.status === 'RUNNING' || j.status === 'WAITING');
        setActiveJobId(stillActive ? stillActive.id : null);
        setSuccessNotice(`${data.deletedCount || 0} job riwayat telah dibersihkan.`);
      }
    } catch {
      setErrorNotice('Gagal membersihkan riwayat.');
    }
  };

  // Helper to convert dataUrl or URL to File object
  const urlToFile = async (url: string, filename: string, mimeType: string): Promise<File> => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const blob = await res.blob();
      if (blob.type && blob.type.includes('text/html')) {
        throw new Error('URL mengembalikan halaman web (HTML), bukan file gambar/video langsung.');
      }
      return new File([blob], filename, { type: mimeType || blob.type || 'application/octet-stream' });
    } catch (err: any) {
      throw new Error(`Gagal membaca berkas dari URL: ${err.message || 'Network error'}`);
    }
  };

  // Helper to upload file to RunningHub
  const uploadToRunningHub = async (
    file: File,
    fileType: 'image' | 'video',
    targetApiKey: string
  ): Promise<string> => {
    const formData = new FormData();
    formData.append('apiKey', targetApiKey.trim());
    formData.append('fileType', fileType);
    formData.append('file', file);

    const upRes = await fetch('/api/runninghub/upload', {
      method: 'POST',
      body: formData,
    });
    const upText = await upRes.text();
    let upData: any = {};
    try {
      upData = JSON.parse(upText);
    } catch {
      throw new Error(`Gagal memproses upload ${fileType} ke server RunningHub.`);
    }

    if (upData.code !== 0 || !upData.data?.fileName) {
      throw new Error(
        `Gagal upload ${fileType === 'image' ? 'foto' : 'video'}: ${
          upData.msg || 'Periksa API Key atau ukuran file'
        }`
      );
    }
    return upData.data.fileName;
  };

  // Helper to choose key with no active lock instantly
  const pickBestApiKey = async (defaultKey: string): Promise<string> => {
    const candidatePool = Array.from(new Set([defaultKey, ...apiKeysPool].map((k) => k.trim()).filter(Boolean)));
    if (candidatePool.length <= 1) return defaultKey.trim();

    // Determine keys currently running or waiting
    const activeKeysInUse = new Set(
      jobsList.filter((j) => j.status === 'RUNNING' || j.status === 'WAITING').map((j) => (j.apiKey || '').trim())
    );

    // If default key is free, use it immediately
    if (!activeKeysInUse.has(defaultKey.trim())) {
      return defaultKey.trim();
    }

    // Pick first available key that is not locked by another active job
    const freeKey = candidatePool.find((k) => !activeKeysInUse.has(k));
    return freeKey || defaultKey.trim();
  };

  // Handle Generate New Job
  const handleGenerate = async () => {
    // Resolve active key from apiKey or pool
    const effectiveApiKey = apiKey.trim() || (apiKeysPool.length > 0 ? apiKeysPool[0].trim() : '');

    if (!effectiveApiKey) {
      setErrorNotice('Silakan masukkan RunningHub API Key Anda terlebih dahulu pada tombol API Key di pojok kanan atas.');
      setIsApiSettingsOpen(true);
      return;
    }

    // Validate if character and motion inputs are present
    const hasCharacter = Boolean(customCharacterFile || customCharacterUrl || selectedCharacter);
    const hasMotion = Boolean(customMotionFile || customMotionUrl || selectedMotion);

    if (!hasCharacter || !hasMotion) {
      setErrorNotice(
        !hasCharacter && !hasMotion
          ? 'Silakan upload atau pilih foto karakter & video gerakan terlebih dahulu!'
          : !hasCharacter
          ? 'Silakan upload atau pilih foto karakter terlebih dahulu!'
          : 'Silakan upload atau pilih video gerakan terlebih dahulu!'
      );
      return;
    }

    setIsSubmitting(true);
    setErrorNotice(null);
    setSuccessNotice(null);

    try {
      // Smart pick key with highest credit balance automatically
      const keyForThisJob = await pickBestApiKey(effectiveApiKey);
      // Default RunningHub webapp assets (Verified for 2083908699113918465)
      let imageFileName = '716558c1dbf01471be2349c7dea3c0fcd7511eea631b98ddbe0e2d6186450f1a.jpg';
      let videoFileName = '2c03397af1ff379f2816d4d9e511f15cce947d70d235387796aef750a973bc30.mp4';

      // 1. Process Character Image (Node #30)
      if (customCharacterFile) {
        imageFileName = await uploadToRunningHub(customCharacterFile, 'image', keyForThisJob);
      } else if (customCharacterUrl) {
        const fileFromUrl = await urlToFile(customCharacterUrl, 'character_custom.png', 'image/png');
        imageFileName = await uploadToRunningHub(fileFromUrl, 'image', keyForThisJob);
      } else if (selectedCharacter?.imageUrl) {
        const presetImgFile = await urlToFile(selectedCharacter.imageUrl, `${selectedCharacter.id}.jpg`, 'image/jpeg');
        imageFileName = await uploadToRunningHub(presetImgFile, 'image', keyForThisJob);
      }

      // 2. Process Motion Video (Node #33)
      if (customMotionFile) {
        videoFileName = await uploadToRunningHub(customMotionFile, 'video', keyForThisJob);
      } else if (customMotionUrl) {
        const fileFromUrl = await urlToFile(customMotionUrl, 'motion_custom.mp4', 'video/mp4');
        videoFileName = await uploadToRunningHub(fileFromUrl, 'video', keyForThisJob);
      } else if (selectedMotion?.videoUrl) {
        const presetVidFile = await urlToFile(selectedMotion.videoUrl, `${selectedMotion.id}.mp4`, 'video/mp4');
        videoFileName = await uploadToRunningHub(presetVidFile, 'video', keyForThisJob);
      }

      // 3. Dispatch Job to Backend Queue (Up to 10 Jobs in Queue)
      const jobIndex = jobsList.length + 1;
      const characterLabel = customCharacterFile ? 'Foto Kustom' : selectedCharacter?.name || 'Contoh Foto';
      const motionLabel = customMotionFile ? 'Video Kustom' : selectedMotion?.name || 'Contoh Video';
      const jobTitle = `Job #${jobIndex} (${characterLabel} + ${motionLabel})`;

      // Optimal 8 sampler steps for Motion Control 1080p pipeline
      const stepsValue = '8';
      const randomSeed = String(Math.floor(Math.random() * 1000000000));

      const payload = {
        apiKey: keyForThisJob.trim(),
        apiKeysPool,
        webappId,
        jobTitle,
        nodeInfoList: [
          { nodeId: '32', fieldName: 'image', fieldValue: imageFileName },
          { nodeId: '33', fieldName: 'video', fieldValue: videoFileName },
          { nodeId: '331', fieldName: 'steps', fieldValue: stepsValue },
          { nodeId: '331', fieldName: 'seed', fieldValue: randomSeed },
        ],
      };

      const createRes = await fetch('/api/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const createData = await createRes.json();

      if (createData.code !== 0 || !createData.data?.id) {
        throw new Error(createData.msg || 'Gagal memasukkan task ke antrian backend.');
      }

      const newJob: JobItem = createData.data;

      // Add new job to list and make it active
      setJobsList((prev) => [newJob, ...prev.filter((j) => j.id !== newJob.id)]);
      setActiveJobId(newJob.id);
      setIsSubmitting(false);
      setSuccessNotice(`Job #${jobIndex} berhasil ditambahkan ke antrian! Anda bisa membuat job berikutnya kapan saja.`);
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorNotice(err.message || 'Gagal memproses render video.');
    }
  };

  // Handle Create New Job (prepare new inputs)
  const handlePrepareNewJob = () => {
    setActiveJobId(null);
    setErrorNotice(null);
    setCustomCharacterUrl(null);
    setCustomCharacterFile(null);
    setCustomMotionUrl(null);
    setCustomMotionFile(null);
    setCustomMotionDuration(null);
    setSelectedCharacter(null);
    setSelectedMotion(null);
    setSuccessNotice('Siap membuat job baru. Upload atau pilih foto & video gerakan.');
  };

  return (
    <div className="min-h-screen bg-[#f4f3ec] text-stone-900 flex flex-col antialiased selection:bg-stone-300 selection:text-stone-900">
      {/* Clean Global Header */}
      <Header
        hasApiKey={Boolean((apiKey && apiKey.trim().length > 0) || apiKeysPool.length > 0)}
        onOpenApiSettings={() => setIsApiSettingsOpen(true)}
        keyBalance={keyBalance}
        poolCount={apiKeysPool.length}
      />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Notice Alerts */}
        {errorNotice && (
          <div className="p-4 rounded-2xl border border-red-200 bg-red-50 text-red-800 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span className="font-medium">{errorNotice}</span>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              {(errorNotice.includes('NOT_ENOUGH_BALANCE') ||
                errorNotice.includes('API Key') ||
                errorNotice.includes('Koin') ||
                errorNotice.includes('Saldo')) && (
                <button
                  onClick={() => setIsApiSettingsOpen(true)}
                  className="text-xs px-3 py-1 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-semibold transition-colors shadow-xs"
                >
                  ⚙️ Ganti / Tambah API Key
                </button>
              )}
              <button
                onClick={() => setErrorNotice(null)}
                className="text-xs px-2.5 py-1 rounded-xl bg-red-200/80 hover:bg-red-300 text-red-900 font-medium transition-colors"
              >
                Tutup
              </button>
            </div>
          </div>
        )}

        {successNotice && (
          <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs flex items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-medium">{successNotice}</span>
            </div>
            <button
              onClick={() => setSuccessNotice(null)}
              className="text-xs px-2.5 py-1 rounded-lg bg-emerald-200/80 hover:bg-emerald-300 text-emerald-900 font-medium"
            >
              Tutup
            </button>
          </div>
        )}

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Input Steps & Multi-Job Generate Actions (6 cols) */}
          <div className="lg:col-span-6 space-y-4">
            {/* 1. Karakter Foto (Matches Top Box in Image) */}
            <CharacterSelector
              selectedCharacter={selectedCharacter}
              onSelectCharacter={(char) => {
                setSelectedCharacter(char);
                setCustomCharacterUrl(null);
                setCustomCharacterFile(null);
                if (char.pairedMotionId) {
                  const matchedMot = MOTION_PRESETS.find((m) => m.id === char.pairedMotionId);
                  if (matchedMot) {
                    setSelectedMotion(matchedMot);
                    setCustomMotionUrl(null);
                    setCustomMotionFile(null);
                    setCustomMotionDuration(null);
                  }
                }
              }}
              customCharacterUrl={customCharacterUrl}
              customCharacterFile={customCharacterFile}
              onUploadCustomImage={(url, file) => {
                setCustomCharacterUrl(url || null);
                setCustomCharacterFile(file || null);
              }}
            />

            {/* 2. Video Gerakan (Matches Segmented Switcher & Bottom Box in Image) */}
            <MotionSelector
              selectedMotion={selectedMotion}
              onSelectMotion={(mot) => {
                setSelectedMotion(mot);
                setCustomMotionUrl(null);
                setCustomMotionFile(null);
                setCustomMotionDuration(null);
                if (mot.pairedCharacterId) {
                  const matchedChar = CHARACTER_PRESETS.find((c) => c.id === mot.pairedCharacterId);
                  if (matchedChar) {
                    setSelectedCharacter(matchedChar);
                    setCustomCharacterUrl(null);
                    setCustomCharacterFile(null);
                  }
                }
              }}
              customMotionUrl={customMotionUrl}
              customMotionFile={customMotionFile}
              customMotionDuration={customMotionDuration}
              onUploadCustomVideo={(url, _fileName, file, dur) => {
                setCustomMotionUrl(url || null);
                setCustomMotionFile(file || null);
                  setCustomMotionDuration(dur ?? null);
              }}
            />

            {/* Generate & Cancel Action Area */}
            <div className="space-y-2.5 pt-1">
              <div className="flex gap-2">
                {/* Generate Button */}
                <button
                  onClick={handleGenerate}
                  disabled={isSubmitting}
                  className="flex-1 py-4 px-6 rounded-2xl font-bold text-sm text-white bg-stone-900 hover:bg-stone-800 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      <span>Memproses Job Baru...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-amber-300" />
                      <span>
                        {jobsList.length > 0
                          ? '+ Generate Job Baru (Antrian)'
                          : 'Generate Video Animasi (1080p)'}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {/* Cancel Button if active job is running / waiting */}
                {activeJob && (activeJob.status === 'RUNNING' || activeJob.status === 'WAITING') && (
                  <button
                    onClick={() => handleCancelJob(activeJob.id)}
                    className="px-4 py-4 rounded-2xl font-bold text-xs text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 transition-all flex items-center gap-1.5 shadow-xs active:scale-95 shrink-0"
                    title="Batalkan proses render job yang sedang aktif"
                  >
                    <XCircle className="w-4 h-4 text-red-600" />
                    <span>Batalkan</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Video Preview, Multi-Job Switcher & Live Render (6 cols) */}
          <div className="lg:col-span-6 sticky top-20">
            <VideoPlayerPreview
              character={selectedCharacter}
              customCharacterUrl={customCharacterUrl}
              motion={selectedMotion}
              customMotionUrl={customMotionUrl}
              customMotionDuration={customMotionDuration}
              isGenerating={isGenerating}
              generationStatus={generationStatus}
              generationStep={generationStep}
              elapsedSeconds={activeElapsed}
              errorMessage={activeErrorMessage}
              generatedVideoUrl={generatedVideoUrl}
              onRetry={handleGenerate}
              onCancel={() => handleCancelJob(activeJobId || undefined)}
              onNewJob={handlePrepareNewJob}
              jobsList={jobsList}
              activeJobId={activeJobId}
              onSelectJob={(id) => setActiveJobId(id)}
              onCancelJobById={(id) => handleCancelJob(id)}
              onDeleteJob={(id) => handleDeleteJob(id)}
              onClearCompleted={handleClearCompletedJobs}
            />
          </div>
        </div>
      </main>

      {/* API Settings Modal */}
      <ApiSettingsModal
        isOpen={isApiSettingsOpen}
        onClose={() => setIsApiSettingsOpen(false)}
        apiKey={apiKey}
        setApiKey={setApiKey}
        apiKeysPool={apiKeysPool}
        setApiKeysPool={setApiKeysPool}
        webappId={webappId}
        setWebappId={() => {}}
      />
    </div>
  );
}
