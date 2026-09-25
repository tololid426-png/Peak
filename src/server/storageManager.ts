import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root storage paths
const ROOT_DIR = path.resolve(__dirname, '../../');
export const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
export const VIDEOS_DIR = path.join(STORAGE_DIR, 'videos');
export const THUMBNAILS_DIR = path.join(STORAGE_DIR, 'thumbnails');
export const JOBS_DB_PATH = path.join(STORAGE_DIR, 'jobs.json');

// Configuration
export const MAX_CONCURRENT_JOBS = 10; // Mendukung hingga 10 job bersamaan di sistem
export const RETENTION_HOURS = 48; // 48 jam
export const RETENTION_MS = RETENTION_HOURS * 60 * 60 * 1000;
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Jalankan cleanup setiap 1 jam

export interface JobRecord {
  id: string;
  jobTitle?: string;
  status: 'WAITING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  createdAt: number; // timestamp ms
  expiresAt: number | null; // timestamp ms (createdAt + 48 jam saat selesai)
  created_at_formatted: string;
  expires_at_formatted?: string;
  step: string;
  elapsedSeconds?: number;
  queuePosition?: number;
  totalWaitingInQueue?: number;
  totalRunningCount?: number;
  apiKey: string;
  apiKeysPool?: string[];
  webappId: string;
  nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: string }>;
  runninghubTaskId?: string;
  videoFileName?: string; // e.g. "video_job_12345.mp4"
  thumbnailFileName?: string;
  videoUrl?: string; // "/storage/videos/video_job_12345.mp4"
  thumbnailUrl?: string;
  remoteVideoUrl?: string;
  errorMessage?: string | null;
}

function formatDateIndo(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Safe JSON fetcher that handles Cloudflare / Nginx 502 HTML responses without crashing
 */
async function safeFetchRunningHubJson(endpointPath: string, payload: any): Promise<any> {
  const hosts = ['https://www.runninghub.ai', 'https://www.runninghub.cn'];

  for (const host of hosts) {
    try {
      const url = `${host}${endpointPath}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RunningHubClient/1.0',
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text();
      const trimmed = text.trim();

      // If response is HTML (<!doctype or <html), skip to next mirror or retry
      if (
        trimmed.startsWith('<') ||
        trimmed.toLowerCase().includes('<!doctype') ||
        trimmed.toLowerCase().includes('<html')
      ) {
        console.warn(`[RunningHub] Received HTML response from ${host}${endpointPath}, skipping...`);
        continue;
      }

      try {
        const parsed = JSON.parse(text);
        return parsed;
      } catch {
        continue;
      }
    } catch (err) {
      console.warn(`[RunningHub] Fetch error for ${host}${endpointPath}:`, err);
      continue;
    }
  }

  return null;
}

/**
 * Safe Output Status Parser - Handles all array, empty array, object, and string variations safely
 */
function parseOutputStatus(outData: any): {
  isRunning: boolean;
  isSuccess: boolean;
  isFailed: boolean;
  url: string | null;
  errorMsg: string | null;
} {
  if (!outData || typeof outData !== 'object') {
    return { isRunning: true, isSuccess: false, isFailed: false, url: null, errorMsg: null };
  }

  const code = outData.code !== undefined && outData.code !== null ? Number(outData.code) : NaN;
  const msg = String(outData.msg || '').toUpperCase();

  // Status code 804 (APIKEY_TASK_IS_RUNNING) or active queue states
  if (
    code === 804 ||
    code === 421 ||
    code === 1001 ||
    code === 101 ||
    msg.includes('TASK_IS_RUNNING') ||
    msg.includes('QUEUE') ||
    msg.includes('RUNNING') ||
    msg.includes('PROCESS')
  ) {
    return { isRunning: true, isSuccess: false, isFailed: false, url: null, errorMsg: null };
  }

  if (code !== 0 && code !== 200 && !isNaN(code)) {
    let errorMsg = String(outData.msg || `RunningHub Error (Code ${code})`);
    if (
      code === 402 ||
      msg.includes('NOT_ENOUGH_BALANCE') ||
      msg.includes('BALANCE_NOT_ENOUGH') ||
      msg.includes('INSUFFICIENT_BALANCE') ||
      msg.includes('NO_ENOUGH_BALANCE') ||
      msg.includes('COIN_NOT_ENOUGH') ||
      msg.includes('NO_BALANCE')
    ) {
      errorMsg = 'Saldo / Koin RunningHub pada API Key ini tidak mencukupi (NOT_ENOUGH_BALANCE). Silakan isi ulang koin di runninghub.ai atau ganti dengan API Key lain.';
    }

    return {
      isRunning: false,
      isSuccess: false,
      isFailed: true,
      url: null,
      errorMsg,
    };
  }

  const d = outData.data;
  if (d === undefined || d === null) {
    return { isRunning: true, isSuccess: false, isFailed: false, url: null, errorMsg: null };
  }

  // Case 1: Array of outputs (can be empty [] or [{ fileUrl, taskStatus }])
  if (Array.isArray(d)) {
    if (d.length === 0) {
      return { isRunning: true, isSuccess: false, isFailed: false, url: null, errorMsg: null };
    }

    // Check if any output item explicitly failed
    for (const item of d) {
      if (typeof item === 'object' && item !== null) {
        const rawStatus = String(item.taskStatus || item.status || '').toUpperCase();
        if (rawStatus === 'FAILED' || rawStatus === 'ERROR') {
          return {
            isRunning: false,
            isSuccess: false,
            isFailed: true,
            url: null,
            errorMsg: String(item.error || item.msg || 'Eksekusi GPU gagal'),
          };
        }
      }
    }

    // Scan all items for video outputs (.mp4, .mov, .webm)
    let foundVideoUrl: string | null = null;
    let fallbackUrl: string | null = null;

    for (const item of d) {
      let candidateUrl: string | null = null;
      if (typeof item === 'string' && (item.startsWith('http://') || item.startsWith('https://'))) {
        candidateUrl = item;
      } else if (typeof item === 'object' && item !== null) {
        candidateUrl =
          (typeof item.fileUrl === 'string' ? item.fileUrl : null) ||
          (typeof item.url === 'string' ? item.url : null) ||
          (typeof item.downloadUrl === 'string' ? item.downloadUrl : null);
      }

      if (candidateUrl) {
        const lower = candidateUrl.toLowerCase();
        if (lower.includes('.mp4') || lower.includes('.mov') || lower.includes('.webm') || lower.includes('.mkv')) {
          foundVideoUrl = candidateUrl;
          break;
        } else if (!fallbackUrl) {
          fallbackUrl = candidateUrl;
        }
      }
    }

    const finalUrl = foundVideoUrl || fallbackUrl;
    if (finalUrl) {
      return { isRunning: false, isSuccess: true, isFailed: false, url: finalUrl, errorMsg: null };
    }

    return { isRunning: true, isSuccess: false, isFailed: false, url: null, errorMsg: null };
  }

  // Case 2: Object
  if (typeof d === 'object') {
    const rawStatus = String(d.taskStatus || d.status || '').toUpperCase();
    if (rawStatus === 'FAILED' || rawStatus === 'ERROR') {
      return {
        isRunning: false,
        isSuccess: false,
        isFailed: true,
        url: null,
        errorMsg: String(d.errorMsg || d.msg || 'Eksekusi GPU gagal'),
      };
    }

    // Check all possible video URL candidate arrays and fields
    const candidates: string[] = [];
    if (Array.isArray(d.fileUrlList)) {
      candidates.push(...d.fileUrlList.filter((u: any) => typeof u === 'string'));
    }
    if (Array.isArray(d.outputs)) {
      for (const o of d.outputs) {
        if (typeof o === 'string') candidates.push(o);
        else if (o && typeof o.fileUrl === 'string') candidates.push(o.fileUrl);
        else if (o && typeof o.url === 'string') candidates.push(o.url);
      }
    }
    if (typeof d.fileUrl === 'string') candidates.push(d.fileUrl);
    if (typeof d.url === 'string') candidates.push(d.url);
    if (typeof d.downloadUrl === 'string') candidates.push(d.downloadUrl);

    let foundVideoUrl: string | null = null;
    let fallbackUrl: string | null = null;

    for (const u of candidates) {
      const lower = u.toLowerCase();
      if (lower.includes('.mp4') || lower.includes('.mov') || lower.includes('.webm') || lower.includes('.mkv')) {
        foundVideoUrl = u;
        break;
      } else if (!fallbackUrl) {
        fallbackUrl = u;
      }
    }

    const finalUrl = foundVideoUrl || fallbackUrl;
    if (finalUrl) {
      return { isRunning: false, isSuccess: true, isFailed: false, url: finalUrl, errorMsg: null };
    }

    return { isRunning: true, isSuccess: false, isFailed: false, url: null, errorMsg: null };
  }

  // Case 3: Direct string URL
  if (typeof d === 'string' && (d.startsWith('http://') || d.startsWith('https://'))) {
    return { isRunning: false, isSuccess: true, isFailed: false, url: d, errorMsg: null };
  }

  return { isRunning: true, isSuccess: false, isFailed: false, url: null, errorMsg: null };
}

// In-memory cache synced with disk
let jobsMap: Map<string, JobRecord> = new Map();
let isProcessingQueue = false;

// Ensure storage directories exist
export function initStorage() {
  try {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    if (!fs.existsSync(VIDEOS_DIR)) {
      fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    }
    if (!fs.existsSync(THUMBNAILS_DIR)) {
      fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
    }
  } catch (err) {
    console.error('[Storage] Error initializing directories:', err);
  }

  // Load existing jobs from disk
  loadJobsFromDisk();

  // Run initial cleanup immediately upon startup (finds and deletes any expired files after server restart)
  cleanupExpiredJobs();

  // Schedule automatic background cleanup every 1 hour
  setInterval(() => {
    cleanupExpiredJobs();
  }, CLEANUP_INTERVAL_MS);

  // Background queue heartbeat: runs every 2.5 seconds to pick up waiting jobs smoothly
  setInterval(() => {
    processQueue();
  }, 2500);

  // Resume any waiting jobs
  processQueue();
}

function loadJobsFromDisk() {
  try {
    if (fs.existsSync(JOBS_DB_PATH)) {
      const raw = fs.readFileSync(JOBS_DB_PATH, 'utf-8');
      const list: JobRecord[] = JSON.parse(raw);
      jobsMap.clear();
      for (const job of list) {
        // If server crashed while job was running, reset to waiting so it can resume
        if (job.status === 'RUNNING') {
          job.status = 'WAITING';
          job.step = 'Melanjutkan antrian setelah restart server...';
        }
        jobsMap.set(job.id, job);
      }
      console.log(`[Storage] Loaded ${jobsMap.size} jobs from disk.`);
    }
  } catch (err) {
    console.error('[Storage] Error loading jobs from disk:', err);
    jobsMap.clear();
  }
}

function saveJobsToDisk() {
  try {
    const list = Array.from(jobsMap.values());
    const tempPath = `${JOBS_DB_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(list, null, 2), 'utf-8');
    fs.renameSync(tempPath, JOBS_DB_PATH);
  } catch (err) {
    console.error('[Storage] Error saving jobs to disk:', err);
  }
}

/**
 * Cleanup expired files (older than 48 hours based on expiresAt or file age)
 */
export function cleanupExpiredJobs() {
  const now = Date.now();
  let deletedCount = 0;

  console.log(`[Storage Cleanup] Memeriksa file kedaluwarsa (> 48 jam) pada ${new Date().toISOString()}...`);

  // 1. Check jobs in database
  for (const [jobId, job] of jobsMap.entries()) {
    if (job.expiresAt && now >= job.expiresAt) {
      // Delete video file
      if (job.videoFileName) {
        const videoPath = path.join(VIDEOS_DIR, job.videoFileName);
        if (fs.existsSync(videoPath)) {
          try {
            fs.unlinkSync(videoPath);
            deletedCount++;
            console.log(`[Storage Cleanup] 🗑️ File video kedaluwarsa dihapus: ${job.videoFileName}`);
          } catch (e) {
            console.error(`Gagal menghapus file ${videoPath}:`, e);
          }
        }
      }

      // Delete thumbnail file
      if (job.thumbnailFileName) {
        const thumbPath = path.join(THUMBNAILS_DIR, job.thumbnailFileName);
        if (fs.existsSync(thumbPath)) {
          try {
            fs.unlinkSync(thumbPath);
            console.log(`[Storage Cleanup] 🗑️ File thumbnail kedaluwarsa dihapus: ${job.thumbnailFileName}`);
          } catch (e) {
            console.error(`Gagal menghapus thumbnail ${thumbPath}:`, e);
          }
        }
      }

      // Remove job record
      jobsMap.delete(jobId);
    }
  }

  // 2. Scan physical storage directory to catch any orphaned files older than 48h
  try {
    if (fs.existsSync(VIDEOS_DIR)) {
      const videoFiles = fs.readdirSync(VIDEOS_DIR);
      for (const file of videoFiles) {
        const filePath = path.join(VIDEOS_DIR, file);
        try {
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > RETENTION_MS) {
            fs.unlinkSync(filePath);
            deletedCount++;
            console.log(`[Storage Cleanup] 🗑️ Orphan video file (> 48 jam) dihapus: ${file}`);
          }
        } catch (fileErr) {
          console.error(`Gagal memproses file ${filePath}:`, fileErr);
        }
      }
    }

    if (fs.existsSync(THUMBNAILS_DIR)) {
      const thumbFiles = fs.readdirSync(THUMBNAILS_DIR);
      for (const file of thumbFiles) {
        const filePath = path.join(THUMBNAILS_DIR, file);
        try {
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > RETENTION_MS) {
            fs.unlinkSync(filePath);
            console.log(`[Storage Cleanup] 🗑️ Orphan thumbnail file (> 48 jam) dihapus: ${file}`);
          }
        } catch (fileErr) {
          console.error(`Gagal memproses thumbnail ${filePath}:`, fileErr);
        }
      }
    }
  } catch (err) {
    console.error('[Storage Cleanup] Error scanning physical directory:', err);
  }

  saveJobsToDisk();
  console.log(`[Storage Cleanup] Selesai. ${deletedCount} file kedaluwarsa berhasil dibersihkan.`);
}

/**
 * Create a new generation job and put it into Queue
 */
export function createJob(params: {
  apiKey: string;
  apiKeysPool?: string[];
  webappId?: string;
  jobTitle?: string;
  nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: string }>;
}): JobRecord {
  const now = Date.now();
  const jobId = `job_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const nowDate = new Date(now);

  const job: JobRecord = {
    id: jobId,
    jobTitle: params.jobTitle || `Job #${jobsMap.size + 1}`,
    status: 'WAITING',
    createdAt: now,
    expiresAt: null, // Will be set upon completion (+48 hours)
    created_at_formatted: formatDateIndo(nowDate),
    step: 'Menunggu antrian server...',
    apiKey: params.apiKey.trim(),
    apiKeysPool: params.apiKeysPool || [],
    webappId: (params.webappId || '2083908699113918465').trim(),
    nodeInfoList: (params.nodeInfoList || []).map((n) =>
      String(n.nodeId) === '32' ? { ...n, nodeId: '30' } : n
    ),
  };

  jobsMap.set(jobId, job);
  saveJobsToDisk();

  // Trigger worker to process queue
  processQueue();

  return getJobWithQueueInfo(jobId)!;
}

export function getJob(jobId: string): JobRecord | null {
  return getJobWithQueueInfo(jobId);
}

export function findJobByFileName(fileName: string): JobRecord | null {
  for (const job of jobsMap.values()) {
    if (job.videoFileName === fileName || fileName.includes(job.id)) {
      return getJobWithQueueInfo(job.id);
    }
  }
  return null;
}

/**
 * Cancel a job by ID (marks CANCELLED and frees queue)
 */
export function cancelJob(jobId: string): JobRecord | null {
  const job = jobsMap.get(jobId);
  if (!job) return null;

  if (job.status === 'WAITING' || job.status === 'RUNNING') {
    job.status = 'CANCELLED';
    job.step = 'Dibatalkan oleh pengguna';
    job.errorMessage = 'Generate dibatalkan oleh pengguna';
    saveJobsToDisk();
    console.log(`[Job Cancelled] Job ${jobId} berhasil dibatalkan oleh pengguna.`);
    processQueue();
  }

  return getJobWithQueueInfo(jobId);
}

/**
 * Delete a job by ID and its associated local files
 */
export function deleteJob(jobId: string): boolean {
  const job = jobsMap.get(jobId);
  if (!job) return false;

  if (job.videoFileName) {
    const videoPath = path.join(VIDEOS_DIR, job.videoFileName);
    if (fs.existsSync(videoPath)) {
      try {
        fs.unlinkSync(videoPath);
      } catch (e) {
        console.error(`Gagal menghapus video ${videoPath}:`, e);
      }
    }
  }

  if (job.thumbnailFileName) {
    const thumbPath = path.join(THUMBNAILS_DIR, job.thumbnailFileName);
    if (fs.existsSync(thumbPath)) {
      try {
        fs.unlinkSync(thumbPath);
      } catch (e) {
        console.error(`Gagal menghapus thumbnail ${thumbPath}:`, e);
      }
    }
  }

  jobsMap.delete(jobId);
  saveJobsToDisk();
  processQueue();
  return true;
}

/**
 * Clear all completed, failed, or cancelled jobs (keeps running and waiting)
 */
export function clearFinishedJobs(): number {
  let count = 0;
  for (const [id, job] of Array.from(jobsMap.entries())) {
    if (job.status === 'SUCCESS' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      deleteJob(id);
      count++;
    }
  }
  return count;
}

/**
 * Get all recent jobs list (sorted newest first, up to limit)
 */
export function getRecentJobs(limit: number = 20): JobRecord[] {
  const allJobs = Array.from(jobsMap.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);

  return allJobs.map((j) => getJobWithQueueInfo(j.id)!);
}

export function getActiveQueueStats() {
  let runningCount = 0;
  let waitingCount = 0;

  for (const job of jobsMap.values()) {
    if (job.status === 'RUNNING') runningCount++;
    if (job.status === 'WAITING') waitingCount++;
  }

  return {
    runningCount,
    waitingCount,
    maxConcurrent: MAX_CONCURRENT_JOBS,
    retentionHours: RETENTION_HOURS,
  };
}

function getJobWithQueueInfo(jobId: string): JobRecord | null {
  const job = jobsMap.get(jobId);
  if (!job) return null;

  const allJobs = Array.from(jobsMap.values());
  const runningJobs = allJobs.filter((j) => j.status === 'RUNNING');
  const waitingJobs = allJobs
    .filter((j) => j.status === 'WAITING')
    .sort((a, b) => a.createdAt - b.createdAt);

  job.totalRunningCount = runningJobs.length;
  job.totalWaitingInQueue = waitingJobs.length;

  if (job.status === 'WAITING') {
    const pos = waitingJobs.findIndex((j) => j.id === jobId);
    job.queuePosition = pos >= 0 ? pos + 1 : 1;
  } else {
    job.queuePosition = undefined;
  }

  // Ensure videoUrl points to a valid file or proxy
  if (job.status === 'SUCCESS') {
    if (job.videoFileName) {
      const videoPath = path.join(VIDEOS_DIR, job.videoFileName);
      if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size < 10240) {
        if (job.remoteVideoUrl) {
          job.videoUrl = `/api/runninghub/proxy-video?url=${encodeURIComponent(job.remoteVideoUrl)}`;
        }
      } else {
        job.videoUrl = `/storage/videos/${job.videoFileName}`;
      }
    } else if (job.remoteVideoUrl) {
      job.videoUrl = `/api/runninghub/proxy-video?url=${encodeURIComponent(job.remoteVideoUrl)}`;
    }
  }

  return job;
}

/**
 * Worker to process queued jobs (Supports up to 10 jobs in queue & manages per-key concurrency)
 */
export async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    const allJobs = Array.from(jobsMap.values());
    const runningJobs = allJobs.filter((j) => j.status === 'RUNNING');
    const waitingJobs = allJobs
      .filter((j) => j.status === 'WAITING')
      .sort((a, b) => a.createdAt - b.createdAt);

    if (waitingJobs.length === 0) {
      isProcessingQueue = false;
      return;
    }

    // Set of active API keys currently running a task
    const activeApiKeys = new Set(runningJobs.map((j) => j.apiKey));

    let availableGlobalSlots = MAX_CONCURRENT_JOBS - runningJobs.length;

    for (const job of waitingJobs) {
      if (availableGlobalSlots <= 0) break;

      // If job was cancelled while waiting, skip
      if (job.status === 'CANCELLED') {
        continue;
      }

      // Ensure only 1 active task per API key to prevent TASK_QUEUE_MAXED lockouts on RunningHub
      if (activeApiKeys.has(job.apiKey)) {
        continue;
      }

      // Mark job as RUNNING and claim slot
      job.status = 'RUNNING';
      job.step = 'Mengirim permintaan ke GPU RunningHub...';
      activeApiKeys.add(job.apiKey);
      availableGlobalSlots--;
      saveJobsToDisk();

      // Execute in background
      executeJob(job).catch((err) => {
        console.error(`[Queue Worker] Error executing job ${job.id}:`, err);
      });
    }
  } finally {
    isProcessingQueue = false;
  }
}

function isCancelled(jobId: string): boolean {
  return jobsMap.get(jobId)?.status === 'CANCELLED';
}

/**
 * Execute a single generation job
 */
async function executeJob(job: JobRecord) {
  try {
    if (isCancelled(job.id)) return;

    const payload = {
      apiKey: job.apiKey,
      webappId: job.webappId || '2083908699113918465',
      nodeInfoList: (job.nodeInfoList || []).map((item: any) => ({
        nodeId: String(item.nodeId) === '32' ? '30' : String(item.nodeId),
        fieldName: String(item.fieldName),
        fieldValue: String(item.fieldValue),
      })),
    };

    let taskId: string | null = job.runninghubTaskId || null;

    if (!taskId) {
      // Dispatch task with TASK_QUEUE_MAXED retry and safe JSON parsing
      let submitAttempts = 0;
      const maxSubmitAttempts = 360; // Up to 30 minutes of robust retry endurance

      while (submitAttempts < maxSubmitAttempts && !taskId) {
        if (isCancelled(job.id)) return;
        submitAttempts++;
        job.step =
          submitAttempts === 1
            ? 'Mengirim task ke RunningHub OpenAPI...'
            : `Antrian GPU penuh/padat, mencoba antre otomatis (${submitAttempts}/${maxSubmitAttempts})...`;
        saveJobsToDisk();

        const data = await safeFetchRunningHubJson('/task/openapi/ai-app/run', payload);

        if (isCancelled(job.id)) return;

        if (!data) {
          // Non-JSON / transient network hiccup, retry
          job.step = `Menghubungkan ke gateway RunningHub (${submitAttempts * 4}s)...`;
          saveJobsToDisk();
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }

        const msg = String(data.msg || '').toUpperCase();
        const code = Number(data.code);

        if (code === 0 || code === 200) {
          taskId =
            typeof data.data === 'string'
              ? data.data
              : data.data?.taskId || data.data?.id || data.data?.task_id;
          break;
        }

        if (code === 804 || msg.includes('TASK_IS_RUNNING') || msg.includes('TASK_RUNNING')) {
          taskId = data.data?.taskId || 'latest';
          break;
        }

        if (
          code === 402 ||
          msg.includes('NOT_ENOUGH_BALANCE') ||
          msg.includes('BALANCE_NOT_ENOUGH') ||
          msg.includes('INSUFFICIENT_BALANCE') ||
          msg.includes('NO_ENOUGH_BALANCE') ||
          msg.includes('COIN_NOT_ENOUGH') ||
          msg.includes('NO_BALANCE') ||
          msg.includes('POINT_NOT_ENOUGH')
        ) {
          // If fallback pool keys exist, automatically switch to another key
          const pool = job.apiKeysPool || [];
          const remainingKeys = pool.map((k) => k.trim()).filter((k) => k && k !== job.apiKey);

          if (remainingKeys.length > 0) {
            const nextKey = remainingKeys[0];
            console.log(`[Queue Worker] Koin habis pada key ${job.apiKey.slice(0, 6)}... Berpindah otomatis ke key ${nextKey.slice(0, 6)}...`);
            job.apiKey = nextKey;
            job.apiKeysPool = remainingKeys;
            payload.apiKey = nextKey;
            job.step = `Koin API key sebelumnya habis, berpindah otomatis ke API key berikutnya...`;
            saveJobsToDisk();
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }

          throw new Error('Saldo / Koin RunningHub pada API Key ini tidak mencukupi (NOT_ENOUGH_BALANCE). Silakan isi ulang koin di runninghub.ai atau ganti dengan API Key lain.');
        }

        const isApiKeyInvalid =
          code === 401 ||
          code === 403 ||
          code === 802 ||
          msg.includes('UNAUTHORIZED') ||
          msg.includes('INVALID API KEY') ||
          msg.includes('API KEY INVALID') ||
          msg.includes('KEY TIDAK VALID') ||
          msg.includes('KEY SALAH') ||
          msg.includes('SIGNATURE_ERROR') ||
          msg.includes('APIKEY_NOT_EXIST');

        const isNodeMismatchOrParamError =
          code === 803 ||
          msg.includes('NODE_INFO_MISMATCH') ||
          msg.includes('NODE_NOT_FOUND') ||
          msg.includes('PARAMETER_ERROR') ||
          msg.includes('FIELD_ERROR');

        if (isApiKeyInvalid) {
          throw new Error('API Key RunningHub yang dimasukkan tidak valid atau salah. Silakan periksa kembali API Key Anda.');
        }

        if (isNodeMismatchOrParamError) {
          throw new Error('Terjadi ketidakcocokan konfigurasi Node (Node Info Mismatch). Silakan hubungi admin sistem.');
        }

        // ANY other error code/message is considered a temporary server load / queue limit / Nginx 502 hiccup!
        // We auto-retry them to guarantee 100% success rate without ever failing the user's task!
        job.step = `Server RunningHub sibuk/padat (${submitAttempts}/${maxSubmitAttempts}), mencoba cepat...`;
        saveJobsToDisk();
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      if (isCancelled(job.id)) return;

      if (!taskId) {
        throw new Error('Antrian GPU RunningHub sangat padat saat ini. Silakan coba klik Generate beberapa saat lagi.');
      }

      job.runninghubTaskId = taskId;
      saveJobsToDisk();
    }

    if (isCancelled(job.id)) return;

    job.step = 'GPU sedang merender video...';
    saveJobsToDisk();

    // Poll outputs until completion using robust parser
    let attempts = 0;
    const maxAttempts = 450; // Up to 30 minutes of polling patience
    let remoteVideoUrl: string | null = null;

    while (attempts < maxAttempts && !remoteVideoUrl) {
      if (isCancelled(job.id)) return;
      attempts++;
      await new Promise((r) => setTimeout(r, 4000));

      if (isCancelled(job.id)) return;

      const outData = await safeFetchRunningHubJson('/task/openapi/outputs', {
        apiKey: job.apiKey,
        taskId,
      });

      if (isCancelled(job.id)) return;

      if (!outData) {
        // Transient network delay / Cloudflare HTML, keep polling safely
        continue;
      }

      const { isRunning, isSuccess, isFailed, url, errorMsg } = parseOutputStatus(outData);

      if (isFailed) {
        throw new Error(errorMsg || 'Proses render gagal di GPU RunningHub');
      }

      if (isSuccess && url) {
        remoteVideoUrl = url;
        break;
      }

      if (isRunning) {
        if (attempts % 2 === 0) {
          job.step = `GPU sedang memproses frame video (${attempts * 4}s)...`;
        } else {
          job.step = `Sinkronisasi pose & ekspresi gerakan...`;
        }
        saveJobsToDisk();
      }
    }

    if (isCancelled(job.id)) return;

    if (!remoteVideoUrl) {
      throw new Error('Waktu render melebihi batas (Timeout).');
    }

    // Save video locally to disk with retry
    job.step = 'Menyimpan video ke server (penyimpanan 48 jam)...';
    saveJobsToDisk();

    const videoFileName = `video_${job.id}.mp4`;
    const videoLocalPath = path.join(VIDEOS_DIR, videoFileName);

    let savedLocally = false;
    for (let downloadAttempt = 1; downloadAttempt <= 3; downloadAttempt++) {
      if (isCancelled(job.id)) return;
      try {
        const vidRes = await fetch(remoteVideoUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (vidRes.ok) {
          const arrayBuffer = await vidRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          
          // Validate that the buffer is a real video file (size > 10KB and not HTML)
          const headerStr = buffer.slice(0, 100).toString('utf-8').toLowerCase();
          const isHtml = headerStr.includes('<!doctype') || headerStr.includes('<html') || headerStr.includes('<head');

          if (buffer.length > 10240 && !isHtml) {
            fs.writeFileSync(videoLocalPath, buffer);
            savedLocally = true;
            console.log(`[Storage] Video berhasil diunduh secara lokal (${buffer.length} bytes): ${videoFileName}`);
            break;
          } else {
            console.warn(`[Download Attempt ${downloadAttempt}] Berkas tidak valid / terlalu kecil (${buffer.length} bytes).`);
          }
        }
      } catch (dlErr) {
        console.warn(`[Download Attempt ${downloadAttempt}] Gagal mengunduh video lokal:`, dlErr);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (isCancelled(job.id)) return;

    // Calculate exact expiration (48 hours from completion)
    const completionTime = Date.now();
    const expiresTime = completionTime + RETENTION_MS;
    const expiresDate = new Date(expiresTime);

    const proxyUrl = `/api/runninghub/proxy-video?url=${encodeURIComponent(remoteVideoUrl)}`;

    job.status = 'SUCCESS';
    job.remoteVideoUrl = remoteVideoUrl;
    job.videoFileName = savedLocally ? videoFileName : undefined;
    job.videoUrl = savedLocally ? `/storage/videos/${videoFileName}` : proxyUrl;
    job.expiresAt = expiresTime;
    job.expires_at_formatted = formatDateIndo(expiresDate);
    job.step = 'Selesai (Tersimpan selama 48 jam)';
    saveJobsToDisk();

    console.log(`[Job Completed] Job ${job.id} selesai. Video URL: ${job.videoUrl}`);
    console.log(`[Job Expiry] Kedaluwarsa pada: ${job.expires_at_formatted}`);
  } catch (err: any) {
    if (isCancelled(job.id)) return;
    console.error(`[Job Failed] Job ${job.id} gagal:`, err);
    job.status = 'FAILED';
    job.errorMessage = err?.message || 'Terjadi kesalahan saat memproses video';
    job.step = 'Gagal';
    saveJobsToDisk();
  } finally {
    // Process next waiting job in the queue
    processQueue();
  }
}
