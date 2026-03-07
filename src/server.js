const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const ExifReader = require('exifreader');

const app = express();
const PORT = 3000;
const EXIF_READ_BYTES = 262144;
const EXIF_SORT_CONCURRENCY = 8;

// Base folders
// Photos live in: /home/jef/Pictures/photos/YYYY/
// Rejected/low-quality photos go to: /home/jef/Pictures/photo-low/YYYY/
const PHOTOS_BASE = '/home/jef/Pictures/photos/inprogress';
const LOW_BASE = '/home/jef/Pictures/photo-low';

// Any folders that should never be offered as "year" options.
// (This is defensive: if PHOTOS_BASE ever changes to a broader directory,
// we still won't show unrelated folders like "theframe".)
const EXCLUDED_FOLDERS = new Set(['theframe']);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

async function loadExifTagsFromStart(filePath, bytesToRead = EXIF_READ_BYTES) {
    const fd = await fs.open(filePath, 'r');
    try {
        const stat = await fd.stat();
        const length = Math.min(stat.size, bytesToRead);
        if (length <= 0) {
            return {};
        }

        const buffer = Buffer.alloc(length);
        const { bytesRead } = await fd.read(buffer, 0, length, 0);
        return ExifReader.load(buffer.subarray(0, bytesRead));
    } finally {
        await fd.close();
    }
}

function parseExifDateString(dateString) {
    if (typeof dateString !== 'string') {
        return null;
    }

    const trimmed = dateString.trim();
    if (!trimmed || trimmed === '0000:00:00 00:00:00') {
        return null;
    }

    const match = trimmed.match(
        /^(\d{4})[:\-](\d{2})[:\-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:\s*(Z|[+\-]\d{2}:?\d{2}))?$/
    );

    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const second = Number(match[6] || 0);
    const ms = Number((match[7] || '').padEnd(3, '0') || 0);
    const tz = match[8];

    if (tz) {
        const normalizedTz = tz === 'Z' ? 'Z' : `${tz.slice(0, 3)}:${tz.slice(-2)}`;
        const iso = `${year}-${match[2]}-${match[3]}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(ms).padStart(3, '0')}${normalizedTz}`;
        const parsed = Date.parse(iso);
        return Number.isNaN(parsed) ? null : parsed;
    }

    const localDate = new Date(year, month - 1, day, hour, minute, second, ms);
    const time = localDate.getTime();
    return Number.isNaN(time) ? null : time;
}

function parseExifDateValue(value) {
    if (value == null) {
        return null;
    }

    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isNaN(time) ? null : time;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 1e11) {
            return value;
        }
        if (value > 1e9) {
            return value * 1000;
        }
        return null;
    }

    if (typeof value === 'string') {
        return parseExifDateString(value);
    }

    if (Array.isArray(value)) {
        if (value.length === 1) {
            return parseExifDateValue(value[0]);
        }
        if (value.length >= 3 && value.slice(0, 3).every(v => typeof v === 'number')) {
            const year = value[0];
            const month = value[1];
            const day = value[2];
            const hour = value[3] || 0;
            const minute = value[4] || 0;
            const second = value[5] || 0;
            const localDate = new Date(year, month - 1, day, hour, minute, second, 0);
            const time = localDate.getTime();
            return Number.isNaN(time) ? null : time;
        }
    }

    return null;
}

function getCaptureTimeFromTags(tags) {
    const captureTagNames = [
        'SubSecDateTimeOriginal',
        'DateTimeOriginal',
        'SubSecDateTimeDigitized',
        'DateTimeDigitized',
        'DateCreated',
        'CreationDate',
        'CreateDate',
        'DateTime'
    ];

    for (const tagName of captureTagNames) {
        const tag = tags[tagName];
        if (!tag) {
            continue;
        }

        const parsedFromValue = parseExifDateValue(tag.value);
        if (parsedFromValue !== null) {
            return parsedFromValue;
        }

        const parsedFromComputed = parseExifDateValue(tag.computed);
        if (parsedFromComputed !== null) {
            return parsedFromComputed;
        }

        const parsedFromDescription = parseExifDateValue(tag.description);
        if (parsedFromDescription !== null) {
            return parsedFromDescription;
        }
    }

    return null;
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const current = nextIndex;
            nextIndex += 1;
            if (current >= items.length) {
                return;
            }
            results[current] = await mapper(items[current], current);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

// List year folders
app.get('/api/folders', async (req, res) => {
    try {
        const entries = await fs.readdir(PHOTOS_BASE, { withFileTypes: true });
        const folders = entries
            .filter(e => e.isDirectory() && !EXCLUDED_FOLDERS.has(e.name))
            .map(e => e.name)
            .sort();
        res.json(folders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List photos in a folder, sorted by capture time from EXIF metadata (oldest first)
app.get('/api/photos/:folder', async (req, res) => {
    try {
        const folderPath = path.join(PHOTOS_BASE, req.params.folder);
        const entries = await fs.readdir(folderPath);
        const photoFiles = entries.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));

        const photosWithDate = await mapWithConcurrency(
            photoFiles,
            EXIF_SORT_CONCURRENCY,
            async (filename) => {
                const filePath = path.join(folderPath, filename);
                let fallbackMtime = 0;
                try {
                    const stat = await fs.stat(filePath);
                    fallbackMtime = stat.mtimeMs;
                } catch (err) {
                    // Keep zero fallback mtime if stat fails.
                }

                try {
                    const tags = await loadExifTagsFromStart(filePath);
                    const captureTime = getCaptureTimeFromTags(tags);
                    return { filename, captureTime, fallbackMtime };
                } catch (err) {
                    return { filename, captureTime: null, fallbackMtime };
                }
            }
        );

        photosWithDate.sort((a, b) => {
            const aHasCapture = typeof a.captureTime === 'number';
            const bHasCapture = typeof b.captureTime === 'number';

            if (aHasCapture && bHasCapture && a.captureTime !== b.captureTime) {
                return a.captureTime - b.captureTime;
            }

            if (aHasCapture !== bHasCapture) {
                return aHasCapture ? -1 : 1;
            }

            if (a.fallbackMtime !== b.fallbackMtime) {
                return a.fallbackMtime - b.fallbackMtime;
            }

            return a.filename.localeCompare(b.filename, undefined, {
                numeric: true,
                sensitivity: 'base'
            });
        });

        res.json(photosWithDate.map(p => p.filename));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve a photo
app.get('/api/photo/:folder/:filename', async (req, res) => {
    const filePath = path.join(PHOTOS_BASE, req.params.folder, req.params.filename);
    res.sendFile(filePath);
});

// Get star rating from EXIF (only read first 64KB where EXIF lives)
app.get('/api/rating/:folder/:filename', async (req, res) => {
    try {
        const filePath = path.join(PHOTOS_BASE, req.params.folder, req.params.filename);

        // Read only the first 64KB where EXIF usually lives.
        const tags = await loadExifTagsFromStart(filePath, 65536);

        // Rating can be in different tags depending on software used
        let rating = tags.Rating?.value || tags.RatingPercent?.value || null;

        // Convert RatingPercent (0-100) to stars (0-5) if needed
        if (tags.RatingPercent && !tags.Rating) {
            rating = Math.round((tags.RatingPercent.value / 100) * 5);
        }

        res.json({ rating });
    } catch (err) {
        res.json({ rating: null });
    }
});

// Move photo to low folder
app.post('/api/move/:folder/:filename', async (req, res) => {
    try {
        const folder = req.params.folder;
        const filename = req.params.filename;
        const srcPath = path.join(PHOTOS_BASE, folder, filename);
        const destDir = path.join(LOW_BASE, folder);
        const destPath = path.join(destDir, filename);
        
        // Create destination folder if it doesn't exist
        await fs.mkdir(destDir, { recursive: true });
        
        // Move the file
        await fs.rename(srcPath, destPath);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Photo Review app running at http://localhost:${PORT}`);
});
