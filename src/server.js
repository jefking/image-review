const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const ExifReader = require('exifreader');

const app = express();
const PORT = 3000;

const PHOTOS_BASE = '/media/jef/1.44.1-72806/photos';
const LOW_BASE = '/media/jef/1.44.1-72806/photo-low';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// List year folders
app.get('/api/folders', async (req, res) => {
    try {
        const entries = await fs.readdir(PHOTOS_BASE, { withFileTypes: true });
        const folders = entries
            .filter(e => e.isDirectory())
            .map(e => e.name)
            .sort();
        res.json(folders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List photos in a folder
app.get('/api/photos/:folder', async (req, res) => {
    try {
        const folderPath = path.join(PHOTOS_BASE, req.params.folder);
        const entries = await fs.readdir(folderPath);
        const photos = entries
            .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
            .sort();
        res.json(photos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve a photo
app.get('/api/photo/:folder/:filename', async (req, res) => {
    const filePath = path.join(PHOTOS_BASE, req.params.folder, req.params.filename);
    res.sendFile(filePath);
});

// Get star rating from EXIF
app.get('/api/rating/:folder/:filename', async (req, res) => {
    try {
        const filePath = path.join(PHOTOS_BASE, req.params.folder, req.params.filename);
        const buffer = await fs.readFile(filePath);
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

