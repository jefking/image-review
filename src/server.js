const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const ExifReader = require('exifreader');

const app = express();
const PORT = 3000;

// Base folders
// Photos live in: /home/jef/Pictures/photos/YYYY/
// Rejected/low-quality photos go to: /home/jef/Pictures/photo-low/YYYY/
const PHOTOS_BASE = '/home/jef/Pictures/photos';
const LOW_BASE = '/home/jef/Pictures/photo-low';

// Any folders that should never be offered as "year" options.
// (This is defensive: if PHOTOS_BASE ever changes to a broader directory,
// we still won't show unrelated folders like "theframe".)
const EXCLUDED_FOLDERS = new Set(['theframe']);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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

// List photos in a folder, sorted by file modification time (fast)
app.get('/api/photos/:folder', async (req, res) => {
    try {
        const folderPath = path.join(PHOTOS_BASE, req.params.folder);
        const entries = await fs.readdir(folderPath);
        const photoFiles = entries.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));

        // Get file stats for sorting by modification time (fast - no file reading)
        const photosWithMtime = await Promise.all(
            photoFiles.map(async (filename) => {
                try {
                    const stat = await fs.stat(path.join(folderPath, filename));
                    return { filename, mtime: stat.mtimeMs };
                } catch (e) {
                    return { filename, mtime: 0 };
                }
            })
        );

        // Sort by modification time (oldest first)
        photosWithMtime.sort((a, b) => a.mtime - b.mtime);

        res.json(photosWithMtime.map(p => p.filename));
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

        // Only read first 64KB - EXIF data is always at the start of the file
        const fd = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(65536);
        await fd.read(buffer, 0, 65536, 0);
        await fd.close();

        const tags = ExifReader.load(buffer);

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

