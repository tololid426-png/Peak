import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import multer from 'multer';
import {
  initStorage,
  createJob,
  getJob,
  findJobByFileName,
  cancelJob,
  deleteJob,
  clearFinishedJobs,
  getRecentJobs,
  getActiveQueueStats,
  STORAGE_DIR,
  VIDEOS_DIR,
} from './src/server/storageManager.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  // Initialize persistent storage and automatic 48-hour cleanup worker
  initStorage();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB limit
    },
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Helper for safe JSON response from fetch
  const safeParseResponse = async (res: any) => {
    try {
      const text = await res.text();
      if (!text || text.trim().startsWith('<') || text.toLowerCase().includes('<!doctype')) {
        return { code: 502, msg: 'Gateway mengembalikan respon HTML (Server padat)' };
      }
      return JSON.parse(text);
    } catch (err: any) {
      return { code: 500, msg: err?.message || 'Gagal memproses respon server' };
    }
  };

  // Flawless byte-range video streaming endpoint (Safari / Chrome / iOS / Android support)
  app.get('/storage/videos/:filename', (req: Request, res: Response) => {
    const filePath = path.join(VIDEOS_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).send('Video not found');
      return;
    }

    try {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize) {
          res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
          return;
        }

        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
          'Access-Control-Allow-Origin': '*',
        };

        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
      }
    } catch (streamErr) {
      console.error('Error streaming local video file:', streamErr);
      if (!res.headersSent) {
        res.status(500).send('Error streaming video file');
      }
    }
  });

  // Serve persistent stored videos & thumbnails (Accessible for 48 hours)
  app.use(
    '/storage',
    express.static(STORAGE_DIR, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.mp4')) {
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Accept-Ranges', 'bytes');
        }
      },
    })
  );

  // === BACKEND QUEUE & 48-HOUR STORAGE ENDPOINTS ===

  // 1. Submit Generation Job to Queue (Max 10 Concurrent, Job 11+ WAITING)
  app.post('/api/jobs/create', (req: Request, res: Response) => {
    try {
      const { apiKey, apiKeysPool, webappId, nodeInfoList, jobTitle } = req.body;
      if (!apiKey || String(apiKey).trim() === '') {
        res.status(400).json({ code: 400, msg: 'API Key wajib diisi' });
        return;
      }

      const normalizedNodes = (Array.isArray(nodeInfoList) ? nodeInfoList : []).map((n: any) => {
        // Automatically map node 32 to node 30 for photo input
        if (String(n.nodeId) === '32') {
          return { ...n, nodeId: '30' };
        }
        return n;
      });

      const job = createJob({
        apiKey: String(apiKey).trim(),
        apiKeysPool: Array.isArray(apiKeysPool) ? apiKeysPool.map((k) => String(k).trim()).filter(Boolean) : [],
        webappId: webappId ? String(webappId).trim() : '2083908699113918465',
        jobTitle: jobTitle ? String(jobTitle).trim() : undefined,
        nodeInfoList: normalizedNodes,
      });

      res.json({
        code: 0,
        msg: 'Job berhasil ditambahkan ke antrian',
        data: job,
      });
    } catch (err: any) {
      console.error('Error creating job:', err);
      res.status(500).json({ code: 500, msg: err?.message || 'Gagal membuat job' });
    }
  });

  // 2. Poll Job Status (WAITING, RUNNING, SUCCESS, FAILED, CANCELLED)
  app.get('/api/jobs/:jobId', (req: Request, res: Response) => {
    const { jobId } = req.params;
    const job = getJob(jobId);

    if (!job) {
      res.status(404).json({ code: 404, msg: 'Job tidak ditemukan atau file telah kedaluwarsa (> 48 jam)' });
      return;
    }

    res.json({
      code: 0,
      msg: 'success',
      data: job,
    });
  });

  // 3. Cancel Job (Batalkan Generate)
  app.post('/api/jobs/:jobId/cancel', (req: Request, res: Response) => {
    const { jobId } = req.params;
    const job = cancelJob(jobId);

    if (!job) {
      res.status(404).json({ code: 404, msg: 'Job tidak ditemukan' });
      return;
    }

    res.json({
      code: 0,
      msg: 'Job berhasil dibatalkan',
      data: job,
    });
  });

  // 4. Delete Job (Hapus job dari riwayat)
  app.delete('/api/jobs/:jobId', (req: Request, res: Response) => {
    const { jobId } = req.params;
    const success = deleteJob(jobId);
    if (!success) {
      res.status(404).json({ code: 404, msg: 'Job tidak ditemukan' });
      return;
    }
    res.json({
      code: 0,
      msg: 'Job berhasil dihapus',
    });
  });

  // 5. Clear all finished/cancelled/failed jobs
  app.post('/api/jobs/clear-finished', (_req: Request, res: Response) => {
    const deletedCount = clearFinishedJobs();
    res.json({
      code: 0,
      msg: `${deletedCount} job riwayat dibersihkan`,
      deletedCount,
    });
  });

  // 6. Get list of recent jobs (up to 20)
  app.get('/api/jobs', (_req: Request, res: Response) => {
    const jobs = getRecentJobs(20);
    res.json({
      code: 0,
      msg: 'success',
      data: jobs,
    });
  });

  // 6b. Direct Video Download for a specific Job ID
  app.get('/api/jobs/:jobId/download', async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const filename = (req.query.filename as string) || `motion_studio_${jobId}.mp4`;
    const job = getJob(jobId);

    if (!job) {
      res.status(404).send('Job tidak ditemukan');
      return;
    }

    try {
      // 1. Check if local video file exists and is valid
      if (job.videoFileName) {
        const localPath = path.join(VIDEOS_DIR, job.videoFileName);
        if (fs.existsSync(localPath) && fs.statSync(localPath).size > 10240) {
          const stat = fs.statSync(localPath);
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Length', stat.size);
          res.setHeader('Access-Control-Allow-Origin', '*');
          fs.createReadStream(localPath).pipe(res);
          return;
        }
      }

      // 2. Fallback to remote RunningHub video URL
      if (job.remoteVideoUrl) {
        const remoteRes = await fetch(job.remoteVideoUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });

        if (!remoteRes.ok) {
          res.status(remoteRes.status).send('Gagal mengunduh berkas video dari RunningHub');
          return;
        }

        const contentLength = remoteRes.headers.get('content-length');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (contentLength) res.setHeader('Content-Length', contentLength);

        const arrayBuffer = await remoteRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Auto-heal local file
        if (buffer.length > 10240) {
          const saveName = job.videoFileName || `video_${job.id}.mp4`;
          fs.writeFileSync(path.join(VIDEOS_DIR, saveName), buffer);
        }

        res.end(buffer);
        return;
      }

      res.status(404).send('Berkas video belum siap atau tidak ditemukan');
    } catch (err: any) {
      console.error('Job download error:', err);
      if (!res.headersSent) {
        res.status(500).send('Gagal mengunduh video');
      }
    }
  });

  // 7. Queue Statistics (Running & Waiting Counts)
  app.get('/api/jobs/stats/active', (_req: Request, res: Response) => {
    const stats = getActiveQueueStats();
    res.json({
      code: 0,
      msg: 'success',
      data: stats,
    });
  });

  // === RUNNINGHUB PROXY ENDPOINTS ===

  // Live Webapp Info parser directly from RunningHub page
  app.get('/api/runninghub/webapp-info/:webappId', async (req: Request, res: Response) => {
    const { webappId } = req.params;
    try {
      const targetUrl = `https://www.runninghub.ai/ai-detail/${webappId}`;
      const htmlRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      const html = await htmlRes.text();
      const match = html.match(/id="__NUXT_DATA__">([\s\S]*?)<\/script>/i);
      if (match) {
        try {
          const arr = JSON.parse(match[1]);
          const unflatten = (data: any[]) => {
            const memo = new Map();
            const resolve = (idx: any): any => {
              if (typeof idx !== 'number' || idx < 0 || idx >= data.length) return idx;
              if (memo.has(idx)) return memo.get(idx);
              const val = data[idx];
              if (val === null || typeof val !== 'object') return val;
              if (Array.isArray(val)) {
                const r: any[] = [];
                memo.set(idx, r);
                for (const item of val) r.push(resolve(item));
                return r;
              } else {
                const r: Record<string, any> = {};
                memo.set(idx, r);
                for (const [k, v] of Object.entries(val)) r[k] = resolve(v);
                return r;
              }
            };
            return resolve(0);
          };
          const hydrated = unflatten(arr);
          const detailKey = Object.keys(hydrated[1]?.data[1] || {}).find((k) => k.includes(webappId));
          if (detailKey && hydrated[1].data[1][detailKey]?.detail) {
            res.json({
              code: 0,
              msg: 'success',
              data: hydrated[1].data[1][detailKey].detail,
            });
            return;
          }
        } catch {
          // fallback below
        }
      }

      // Verified schema for 2083908699113918465 (Motion Control 1080p Upscale)
      if (webappId === '2083908699113918465') {
        res.json({
          code: 0,
          msg: 'success',
          data: {
            id: '2083908699113918465',
            name: 'Motion Control Output 1080HD',
            description: 'Motion Control HD Pipeline. Input: Foto Karakter (Node 32) + Video Gerakan (Node 33). Output: 1080p Full HD Upscale dengan Face Enhancement.',
            inputNodes: [
              {
                nodeId: '32',
                nodeName: 'LoadImage',
                fieldName: 'image',
                fieldValue: '716558c1dbf01471be2349c7dea3c0fcd7511eea631b98ddbe0e2d6186450f1a.jpg',
                fieldData: '[["example.png", "None", "keep_this_dic"], {"image_upload": true}]',
                fieldType: 'IMAGE',
                description: 'Input Foto Karakter (Target Character Image)',
              },
              {
                nodeId: '33',
                nodeName: 'VHS_LoadVideo',
                fieldName: 'video',
                fieldValue: '2c03397af1ff379f2816d4d9e511f15cce947d70d235387796aef750a973bc30.mp4',
                fieldData: '["STRING", {"default": "None", "vhs_path_extensions": ["webm", "mp4", "mkv", "gif", "mov"]}]',
                fieldType: 'VIDEO',
                description: 'Input Video Gerakan (Driving Motion Video)',
              },
            ],
          },
        });
        return;
      }

      // Verified schema for 2098087538199212034
      if (webappId === '2098087538199212034') {
        res.json({
          code: 0,
          msg: 'success',
          data: {
            id: '2098087538199212034',
            name: 'Eposcents MC Motion Control HD',
            description: 'Motion Control / Motion Transfer = INPUT >> Image Photo + Video reff. ( max 29 sec )\nPowered by WAN model + SCAIL\nOutput: 736p HD , For saving cost ( Paket Hemat )',
            inputNodes: [
              {
                nodeId: '30',
                nodeName: 'LoadImage',
                fieldName: 'image',
                fieldValue: '516c954a2e3816ee6ea440210b090ef25af59b46fdfbfa1ea44d794f0741bf4d.jpg',
                fieldData: '[["example.png", "None", "keep_this_dic"], {"image_upload": true}]',
                fieldType: 'IMAGE',
                description: 'Target Character Image (Foto Karakter)',
              },
              {
                nodeId: '33',
                nodeName: 'VHS_LoadVideo',
                fieldName: 'video',
                fieldValue: '0b25c4f60ba991aa54883e3f9e46efe4786e6a1144f9c1dde150e8f5117f7d58.mp4',
                fieldData: '["STRING", {"default": "None", "vhs_path_extensions": ["webm", "mp4", "mkv", "gif", "mov"]}]',
                fieldType: 'VIDEO',
                description: 'Driving Motion Reference Video (Video Gerakan Max 29 detik)',
              },
            ],
          },
        });
        return;
      }

      res.status(404).json({ code: 404, msg: 'Webapp detail not found on RunningHub' });
    } catch (err: any) {
      console.error('Error fetching webapp info:', err);
      res.status(500).json({ code: 500, msg: err?.message || 'Error parsing webapp detail' });
    }
  });

  // API Proxy to RunningHub for uploading resource (Image or Video)
  app.post('/api/runninghub/upload', upload.single('file'), async (req: Request, res: Response) => {
    try {
      const { apiKey, fileType } = req.body;
      const file = req.file;

      if (!apiKey) {
        res.status(400).json({ code: 400, msg: 'API Key is required to upload files to RunningHub' });
        return;
      }

      if (!file) {
        res.status(400).json({ code: 400, msg: 'No file received for upload' });
        return;
      }

      const form = new FormData();
      form.append('apiKey', String(apiKey).trim());
      form.append('fileType', fileType || 'image');
      const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
      form.append('file', blob, file.originalname);

      let rhResponse = await fetch('https://www.runninghub.ai/task/openapi/upload', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'RunningHubClient/1.0',
        },
        body: form,
      });

      if (!rhResponse.ok && rhResponse.status >= 500) {
        rhResponse = await fetch('https://www.runninghub.cn/task/openapi/upload', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'RunningHubClient/1.0',
          },
          body: form,
        });
      }

      const data = await safeParseResponse(rhResponse);
      res.json(data);
    } catch (err: any) {
      console.error('Error in /api/runninghub/upload proxy:', err);
      res.status(500).json({ code: 500, msg: err?.message || 'Failed to upload resource to RunningHub' });
    }
  });

  // API Proxy to RunningHub for submitting AI App task
  app.post('/api/runninghub/run', async (req: Request, res: Response) => {
    const { apiKey, webappId, nodeInfoList } = req.body;

    if (!apiKey) {
      res.status(400).json({ code: 400, msg: 'API Key is required to call RunningHub' });
      return;
    }

    try {
      const payload = {
        apiKey: String(apiKey).trim(),
        webappId: String(webappId || '2083908699113918465').trim(),
        nodeInfoList: Array.isArray(nodeInfoList)
          ? nodeInfoList.map((item: any) => ({
              nodeId: String(item.nodeId) === '32' ? '30' : String(item.nodeId),
              fieldName: String(item.fieldName),
              fieldValue: String(item.fieldValue),
            }))
          : [],
      };

      let response = await fetch('https://www.runninghub.ai/task/openapi/ai-app/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'RunningHubClient/1.0',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok && response.status >= 500) {
        response = await fetch('https://www.runninghub.cn/task/openapi/ai-app/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'RunningHubClient/1.0',
          },
          body: JSON.stringify(payload),
        });
      }

      const data = await safeParseResponse(response);
      res.json(data);
    } catch (err: any) {
      console.error('Error in ai-app/run proxy:', err);
      res.status(500).json({ code: 500, msg: err?.message || 'Failed to submit task to RunningHub' });
    }
  });

  // API Proxy to stream remote video from RunningHub with full video/mp4 headers and CORS
  app.get('/api/runninghub/proxy-video', async (req: Request, res: Response) => {
    const videoUrl = req.query.url as string;
    if (!videoUrl) {
      res.status(400).send('Missing video URL');
      return;
    }

    try {
      const videoRes = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!videoRes.ok) {
        res.status(videoRes.status).send('Failed to fetch remote video');
        return;
      }

      const arrayBuffer = await videoRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const fileSize = buffer.length;

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize) {
          res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
          return;
        }

        const chunksize = (end - start) + 1;
        const sliced = buffer.slice(start, end + 1);

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(sliced);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(buffer);
      }
    } catch (err: any) {
      console.error('Error streaming proxy video:', err);
      if (!res.headersSent) {
        res.status(500).send('Proxy video streaming error');
      }
    }
  });

  // API Download endpoint with Content-Disposition header for seamless mobile & desktop download
  app.get('/api/download', async (req: Request, res: Response) => {
    const videoUrl = req.query.url as string;
    const filename = (req.query.filename as string) || `motion_video_${Date.now()}.mp4`;

    if (!videoUrl) {
      res.status(400).send('Missing video URL');
      return;
    }

    try {
      // 1. If it's a local storage file
      if (videoUrl.startsWith('/storage/videos/')) {
        const localFileName = path.basename(videoUrl);
        const localPath = path.join(VIDEOS_DIR, localFileName);
        if (fs.existsSync(localPath) && fs.statSync(localPath).size > 10240) {
          const stat = fs.statSync(localPath);
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Length', stat.size);
          res.setHeader('Access-Control-Allow-Origin', '*');
          fs.createReadStream(localPath).pipe(res);
          return;
        }

        // Try to heal from matching Job in memory/disk
        const matchedJob = findJobByFileName(localFileName);
        if (matchedJob?.remoteVideoUrl) {
          const remoteRes = await fetch(matchedJob.remoteVideoUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
          });
          if (remoteRes.ok) {
            const arrayBuffer = await remoteRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            if (buffer.length > 10240) {
              fs.writeFileSync(localPath, buffer);
              res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
              res.setHeader('Content-Type', 'video/mp4');
              res.setHeader('Content-Length', buffer.length);
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(buffer);
              return;
            }
          }
        }

        res.status(404).send('Berkas video lokal tidak ditemukan atau telah kedaluwarsa');
        return;
      }

      // 2. If it's a proxy or remote URL
      let targetUrl = videoUrl;
      if (videoUrl.startsWith('/api/runninghub/proxy-video?url=')) {
        targetUrl = decodeURIComponent(videoUrl.split('url=')[1] || '');
      }

      const remoteRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!remoteRes.ok) {
        res.status(remoteRes.status).send('Gagal mengunduh berkas video dari server');
        return;
      }

      const contentLength = remoteRes.headers.get('content-length');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', remoteRes.headers.get('content-type') || 'video/mp4');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      if (remoteRes.body) {
        const reader = remoteRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } else {
        res.end();
      }
    } catch (err: any) {
      console.error('Download error:', err);
      if (!res.headersSent) {
        res.status(500).send('Download failed');
      }
    }
  });

  // API Proxy to RunningHub for checking API Key status and coin/credit balance
  app.post('/api/runninghub/check-key', async (req: Request, res: Response) => {
    const { apiKey } = req.body;

    if (!apiKey || !String(apiKey).trim()) {
      res.status(400).json({ code: 400, msg: 'API Key required' });
      return;
    }

    const cleanKey = String(apiKey).trim();

    const extractNumericBalance = (obj: any): string | null => {
      if (obj === null || obj === undefined) return null;
      if (typeof obj === 'number') return String(obj);
      if (typeof obj === 'string' && obj.trim() !== '' && !isNaN(Number(obj))) return obj.trim();

      if (typeof obj === 'object') {
        const priorityFields = [
          'userCoins',
          'coins',
          'user_coins',
          'balance',
          'remainMoney',
          'remain_money',
          'remainCoins',
          'remain_coins',
          'points',
          'credit',
          'credits',
          'remains',
          'amount',
          'coinBalance',
          'surplusCoins',
        ];

        for (const f of priorityFields) {
          if (obj[f] !== undefined && obj[f] !== null) {
            const val = obj[f];
            if (typeof val === 'number') return String(val);
            if (typeof val === 'string' && val.trim() !== '' && !isNaN(Number(val))) return val.trim();
          }
        }

        // Deep search in nested objects if data is wrapped
        if (obj.data) {
          const nested = extractNumericBalance(obj.data);
          if (nested !== null) return nested;
        }
      }
      return null;
    };

    try {
      const endpoints = [
        'https://www.runninghub.ai/uc/openapi/apiKeyStatus',
        'https://www.runninghub.ai/uc/openapi/getApiKey',
        'https://www.runninghub.ai/uc/openapi/user/info',
        'https://www.runninghub.ai/uc/openapi/accountInfo',
        'https://www.runninghub.ai/task/openapi/user/balance',
        'https://www.runninghub.ai/task/openapi/account/balance',
        'https://www.runninghub.cn/uc/openapi/apiKeyStatus',
        'https://www.runninghub.cn/uc/openapi/getApiKey',
        'https://www.runninghub.cn/uc/openapi/user/info',
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'RunningHubClient/1.0',
            },
            body: JSON.stringify({ apiKey: cleanKey }),
          });

          if (response.ok) {
            const data = await safeParseResponse(response);
            if (data && (data.code === 0 || data.code === 200)) {
              const numBal = extractNumericBalance(data.data) || extractNumericBalance(data);
              if (numBal !== null) {
                res.json({
                  code: 0,
                  valid: true,
                  balance: numBal,
                  data: data.data || data,
                });
                return;
              }
            }
          }
        } catch {
          // Try next endpoint
        }
      }

      // If specific balance endpoint didn't respond with numeric value, test with outputs query to verify validity
      const testRes = await fetch('https://www.runninghub.ai/task/openapi/outputs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ apiKey: cleanKey, taskId: 'test_check' }),
      });

      const testData = await safeParseResponse(testRes);
      const code = Number(testData?.code);
      const isInvalid =
        code === 401 ||
        String(testData?.msg || '').toUpperCase().includes('KEY_INVALID') ||
        String(testData?.msg || '').toUpperCase().includes('UNAUTHORIZED');

      if (isInvalid) {
        res.json({ code: 401, valid: false, balance: null, msg: 'API Key tidak valid atau tidak terdaftar' });
      } else {
        const numBal = extractNumericBalance(testData?.data) || extractNumericBalance(testData);
        res.json({
          code: 0,
          valid: true,
          balance: numBal !== null ? numBal : 'Terhubung',
          msg: 'API Key valid',
        });
      }
    } catch (err: any) {
      res.status(500).json({ code: 500, msg: err?.message || 'Gagal memeriksa status API Key' });
    }
  });

  // API Proxy to RunningHub for querying outputs
  app.post('/api/runninghub/outputs', async (req: Request, res: Response) => {
    const { apiKey, taskId } = req.body;

    if (!apiKey || !taskId) {
      res.status(400).json({ code: 400, msg: 'Missing apiKey or taskId' });
      return;
    }

    try {
      const payload = {
        apiKey: String(apiKey).trim(),
        taskId: String(taskId).trim(),
      };

      let response = await fetch('https://www.runninghub.ai/task/openapi/outputs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'RunningHubClient/1.0',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok && response.status >= 500) {
        response = await fetch('https://www.runninghub.cn/task/openapi/outputs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'RunningHubClient/1.0',
          },
          body: JSON.stringify(payload),
        });
      }

      const data = await safeParseResponse(response);
      res.json(data);
    } catch (err: any) {
      console.error('Error in outputs proxy:', err);
      res.status(500).json({ code: 500, msg: err?.message || 'Failed to fetch outputs from RunningHub' });
    }
  });

  // Serve public static directory
  app.use(express.static(path.join(__dirname, 'public')));

  // Vite middleware in dev or static files in production
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
