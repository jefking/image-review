let currentFolder = null;
let photos = [];
let currentIndex = 0;
let showPhotoRequestId = 0;

const ratingCache = new Map();

const folderSelectDiv = document.getElementById('folder-select');
const foldersDiv = document.getElementById('folders');
const viewerDiv = document.getElementById('viewer');
const photoImg = document.getElementById('photo');
const prevPreviewDiv = document.getElementById('prev-preview');
const prevPhotoImg = document.getElementById('prev-photo');
const prevMetaDiv = document.getElementById('prev-meta');
const nextPreviewDiv = document.getElementById('next-preview');
const nextPhotoImg = document.getElementById('next-photo');
const nextMetaDiv = document.getElementById('next-meta');
const filenameDiv = document.getElementById('filename');
const ratingDiv = document.getElementById('rating');
const counterDiv = document.getElementById('counter');

function photoUrl(filename) {
    return `/api/photo/${encodeURIComponent(currentFolder)}/${encodeURIComponent(filename)}`;
}

function ratingUrl(filename) {
    return `/api/rating/${encodeURIComponent(currentFolder)}/${encodeURIComponent(filename)}`;
}

function moveUrl(filename) {
    return `/api/move/${encodeURIComponent(currentFolder)}/${encodeURIComponent(filename)}`;
}

function normalizeRating(rating) {
    const value = Array.isArray(rating) ? rating[0] : rating;
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        return null;
    }

    return Math.max(0, Math.min(5, Math.round(numberValue)));
}

async function loadRating(filename) {
    if (ratingCache.has(filename)) {
        return ratingCache.get(filename);
    }

    try {
        const res = await fetch(ratingUrl(filename));
        const data = await res.json();
        const rating = normalizeRating(data.rating);
        ratingCache.set(filename, rating);
        return rating;
    } catch (e) {
        ratingCache.set(filename, null);
        return null;
    }
}

function isSelectableRating(rating) {
    return rating === null || rating < 4;
}

function formatRating(rating) {
    return rating === null ? 'No rating' : '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

function formatSideMeta(filename, rating) {
    return rating === null ? filename : `${filename} ${formatRating(rating)}`;
}

// Save state to localStorage
function saveState() {
    if (currentFolder && photos.length > 0 && photos[currentIndex]) {
        const state = {
            folder: currentFolder,
            filename: photos[currentIndex],
            index: currentIndex
        };
        localStorage.setItem('photoReviewState', JSON.stringify(state));
    }
}

// Load saved state
function getSavedState() {
    try {
        const saved = localStorage.getItem('photoReviewState');
        return saved ? JSON.parse(saved) : null;
    } catch (e) {
        return null;
    }
}

// Clear saved state
function clearState() {
    localStorage.removeItem('photoReviewState');
}

async function loadPhotoList(folder) {
    currentFolder = folder;
    ratingCache.clear();

    const res = await fetch(`/api/photos/${encodeURIComponent(folder)}`);
    photos = await res.json();
}

async function findSelectableIndex(startIndex, direction) {
    if (photos.length === 0) {
        return -1;
    }

    const step = direction < 0 ? -1 : 1;
    let index = startIndex;

    if (step > 0 && index < 0) {
        index = 0;
    } else if (step > 0 && index >= photos.length) {
        return -1;
    } else if (step < 0 && index >= photos.length) {
        index = photos.length - 1;
    } else if (step < 0 && index < 0) {
        return -1;
    }

    while (index >= 0 && index < photos.length) {
        const rating = await loadRating(photos[index]);
        if (isSelectableRating(rating)) {
            return index;
        }
        index += step;
    }

    return -1;
}

async function findNearestSelectableIndex(startIndex, preferredDirection = 1) {
    if (photos.length === 0) {
        return -1;
    }

    const step = preferredDirection < 0 ? -1 : 1;
    const boundedStart = Math.max(0, Math.min(startIndex, photos.length - 1));
    const preferredIndex = await findSelectableIndex(boundedStart, step);

    if (preferredIndex !== -1) {
        return preferredIndex;
    }

    return findSelectableIndex(boundedStart - step, -step);
}

// Load folder list on start
async function loadFolders() {
    const res = await fetch('/api/folders');
    const folders = await res.json();
    foldersDiv.innerHTML = '';

    // Check for saved state
    const saved = getSavedState();
    if (saved) {
        const resumeBtn = document.createElement('button');
        resumeBtn.className = 'folder-btn resume-btn';
        resumeBtn.textContent = `▶ Resume: ${saved.folder} (${saved.filename})`;
        resumeBtn.onclick = () => resumeSession(saved);
        foldersDiv.appendChild(resumeBtn);

        const divider = document.createElement('div');
        divider.style.cssText = 'height:1px;background:#444;width:200px;margin:10px 0;';
        foldersDiv.appendChild(divider);
    }

    folders.forEach(folder => {
        const btn = document.createElement('button');
        btn.className = 'folder-btn';
        btn.textContent = folder;
        btn.onclick = () => selectFolder(folder);
        foldersDiv.appendChild(btn);
    });
}

async function selectFolder(folder, startIndex = 0) {
    await loadPhotoList(folder);

    if (photos.length === 0) {
        alert('No photos in this folder');
        return;
    }

    currentIndex = await findNearestSelectableIndex(startIndex, 1);
    if (currentIndex === -1) {
        alert('No archive candidates in this folder');
        clearState();
        return;
    }

    folderSelectDiv.style.display = 'none';
    viewerDiv.style.display = 'block';
    showPhoto();
}

async function resumeSession(saved) {
    await loadPhotoList(saved.folder);

    if (photos.length === 0) {
        alert('No photos in this folder');
        clearState();
        return;
    }

    // Find the saved photo in the list (it might have moved due to deletions)
    const savedIndex = photos.indexOf(saved.filename);
    const fallbackIndex = Number.isInteger(saved.index) ? saved.index : 0;
    currentIndex = await findNearestSelectableIndex(savedIndex >= 0 ? savedIndex : fallbackIndex, 1);

    if (currentIndex === -1) {
        alert('No archive candidates in this folder');
        clearState();
        return;
    }

    folderSelectDiv.style.display = 'none';
    viewerDiv.style.display = 'block';
    showPhoto();
}

function clearSidePreview(previewDiv, img, metaDiv) {
    previewDiv.classList.add('empty');
    previewDiv.classList.remove('high-rated');
    img.removeAttribute('src');
    img.alt = '';
    metaDiv.textContent = '';
}

async function renderSidePreview(previewDiv, img, metaDiv, index, requestId) {
    if (requestId !== showPhotoRequestId) {
        return;
    }

    if (index < 0 || index >= photos.length) {
        clearSidePreview(previewDiv, img, metaDiv);
        return;
    }

    const filename = photos[index];
    const rating = await loadRating(filename);

    if (requestId !== showPhotoRequestId) {
        return;
    }

    previewDiv.classList.remove('empty');
    previewDiv.classList.toggle('high-rated', !isSelectableRating(rating));
    img.src = photoUrl(filename);
    img.alt = filename;
    metaDiv.textContent = formatSideMeta(filename, rating);
}

async function updateSidePreviews(requestId) {
    await Promise.all([
        renderSidePreview(prevPreviewDiv, prevPhotoImg, prevMetaDiv, currentIndex - 1, requestId),
        renderSidePreview(nextPreviewDiv, nextPhotoImg, nextMetaDiv, currentIndex + 1, requestId)
    ]);
}

async function showPhoto() {
    const requestId = ++showPhotoRequestId;

    if (currentIndex < 0 || currentIndex >= photos.length) {
        // End of folder
        clearState();
        backToFolders();
        return;
    }

    const filename = photos[currentIndex];

    // Load rating first to ensure the center photo is archive-eligible.
    ratingDiv.textContent = '...';
    const rating = await loadRating(filename);

    if (requestId !== showPhotoRequestId) {
        return;
    }

    if (!isSelectableRating(rating)) {
        const selectableIndex = await findNearestSelectableIndex(currentIndex, 1);

        if (requestId !== showPhotoRequestId) {
            return;
        }

        if (selectableIndex === -1) {
            clearState();
            backToFolders();
            return;
        }

        currentIndex = selectableIndex;
        showPhoto();
        return;
    }

    // Show this archive candidate in the center.
    photoImg.src = photoUrl(filename);
    photoImg.alt = filename;
    filenameDiv.textContent = filename;
    counterDiv.textContent = `${currentIndex + 1} / ${photos.length}`;
    ratingDiv.textContent = formatRating(rating);
    saveState();
    updateSidePreviews(requestId);
}

async function nextPhoto() {
    const nextIndex = await findSelectableIndex(currentIndex + 1, 1);

    if (nextIndex === -1) {
        clearState();
        backToFolders();
    } else {
        currentIndex = nextIndex;
        showPhoto();
    }
}

async function prevPhoto() {
    const previousIndex = await findSelectableIndex(currentIndex - 1, -1);

    if (previousIndex !== -1) {
        currentIndex = previousIndex;
        showPhoto();
    }
}

async function jumpToImage() {
    const input = prompt(`Jump to image (1-${photos.length}):`);
    if (input === null) return; // User cancelled

    const imageNum = parseInt(input, 10);
    if (isNaN(imageNum) || imageNum < 1 || imageNum > photos.length) {
        alert(`Please enter a number between 1 and ${photos.length}`);
        return;
    }

    const targetIndex = imageNum - 1; // Convert to 0-based index
    const targetRating = await loadRating(photos[targetIndex]);
    const selectableIndex = await findNearestSelectableIndex(targetIndex, 1);

    if (selectableIndex === -1) {
        alert('No archive candidates in this folder');
        clearState();
        backToFolders();
        return;
    }

    if (!isSelectableRating(targetRating)) {
        alert('That photo is rated 4 or 5 stars, so it stays out of the center selection.');
    }

    currentIndex = selectableIndex;
    showPhoto();
}

async function moveToLow() {
    const filename = photos[currentIndex];
    const rating = await loadRating(filename);

    if (!isSelectableRating(rating)) {
        alert('This photo is rated 4 or 5 stars and cannot be archived.');
        showPhoto();
        return;
    }

    const res = await fetch(moveUrl(filename), { method: 'POST' });

    if (res.ok) {
        // Remove from array and show next selectable candidate.
        photos.splice(currentIndex, 1);
        ratingCache.delete(filename);

        if (photos.length === 0) {
            backToFolders();
            return;
        }

        const nextIndex = await findSelectableIndex(currentIndex, 1);
        const selectableIndex = nextIndex !== -1
            ? nextIndex
            : await findSelectableIndex(currentIndex - 1, -1);

        if (selectableIndex === -1) {
            clearState();
            backToFolders();
            return;
        }

        currentIndex = selectableIndex;
        showPhoto();
    } else {
        alert('Could not move photo to low folder');
    }
}

function backToFolders() {
    showPhotoRequestId++;
    viewerDiv.style.display = 'none';
    folderSelectDiv.style.display = 'flex';
    loadFolders(); // Refresh folder list
}

// Keyboard navigation
document.addEventListener('keydown', (e) => {
    if (viewerDiv.style.display === 'block') {
        switch (e.key) {
            case 'ArrowRight':
                nextPhoto();
                break;
            case 'ArrowLeft':
                prevPhoto();
                break;
            case 'ArrowDown':
                e.preventDefault();
                moveToLow();
                break;
            case 'Escape':
                backToFolders();
                break;
        }
    }
});

// Counter click to jump to image
counterDiv.addEventListener('click', jumpToImage);

// Start
loadFolders();
