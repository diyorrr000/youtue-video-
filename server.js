const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const port = 3000;

// Set FFmpeg paths for Vercel/Static environment
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const os = require('os');

// Use /tmp for Vercel compatibility
const uploadDir = path.join(os.tmpdir(), 'uploads');
const outputDir = path.join(os.tmpdir(), 'output');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

app.use('/output', express.static(outputDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({ storage });

const jobs = new Map();

app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');

    const filePath = req.file.path;
    const jobId = uuidv4();
    const jobOutputDir = path.join(outputDir, jobId);

    if (!fs.existsSync(jobOutputDir)) fs.mkdirSync(jobOutputDir);

    console.log(`[${jobId}] New Job Started: ${filePath}`);

    // Initialize job state
    jobs.set(jobId, {
        status: 'processing',
        clips: [],
        segments: 0,
        completed: 0,
        clients: []
    });

    ffmpeg.ffprobe(filePath, async (err, metadata) => {
        if (err) {
            console.error('Error probing video:', err);
            return;
        }

        const duration = metadata.format.duration;
        const segmentDuration = 59;
        const segments = Math.ceil(duration / segmentDuration);

        const job = jobs.get(jobId);
        job.segments = segments;

        // Process segments in batches to avoid overwhelming the system
        const batchSize = 3;
        for (let i = 0; i < segments; i += batchSize) {
            const batch = [];
            for (let j = i; j < Math.min(i + batchSize, segments); j++) {
                batch.push(processSegment(jobId, filePath, j, jobOutputDir));
            }
            await Promise.all(batch);
        }

        // Cleanup: Delete original upload after processing is done
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            console.log(`[${jobId}] Original file deleted to save space.`);
        } catch (e) {
            console.error('Error deleting original file:', e);
        }

        // Schedule cleanup of output folder after 30 minutes
        setTimeout(() => {
            try {
                if (fs.existsSync(jobOutputDir)) {
                    fs.rmSync(jobOutputDir, { recursive: true, force: true });
                    console.log(`[${jobId}] Job output directory cleaned up.`);
                }
                jobs.delete(jobId);
            } catch (e) {
                console.error('Error during job cleanup:', e);
            }
        }, 30 * 60 * 1000); // 30 minutes
    });

    res.json({ success: true, jobId });
});

async function processSegment(jobId, filePath, i, jobOutputDir) {
    const job = jobs.get(jobId);
    if (!job) return;

    const startTime = i * 59;
    const outputFileName = `short_${i + 1}.mp4`;
    const outputPath = path.join(jobOutputDir, outputFileName);

    return new Promise((resolve) => {
        ffmpeg(filePath)
            .setStartTime(startTime)
            .setDuration(59)
            .videoFilters([
                { filter: 'crop', options: 'ih*9/16:ih' },
                { filter: 'scale', options: '1080:1920' }
            ])
            .output(outputPath)
            .on('end', () => {
                const clip = {
                    name: `Clip ${i + 1}`,
                    url: `/output/${jobId}/${outputFileName}`
                };
                job.clips.push(clip);
                job.completed++;

                // Notify clients
                const message = JSON.stringify({ type: 'clip', clip });
                job.clients.forEach(c => c.write(`data: ${message}\n\n`));

                if (job.completed === job.segments) {
                    job.status = 'done';
                    const doneMsg = JSON.stringify({ type: 'done', jobId });
                    job.clients.forEach(c => {
                        c.write(`data: ${doneMsg}\n\n`);
                        c.end();
                    });
                }
                resolve();
            })
            .on('error', (err) => {
                console.error(`[${jobId}] Segment ${i + 1} Error:`, err.message);
                job.completed++;
                resolve();
            })
            .run();
    });
}

app.get('/status/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    const job = jobs.get(jobId);

    if (!job) return res.status(404).json({ error: 'Job not found' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    job.clients.push(res);

    req.on('close', () => {
        job.clients = job.clients.filter(c => c !== res);
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
