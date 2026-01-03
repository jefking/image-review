let currentFolder = null;
let photos = [];
let currentIndex = 0;

const folderSelectDiv = document.getElementById('folder-select');
const foldersDiv = document.getElementById('folders');
const viewerDiv = document.getElementById('viewer');
const photoImg = document.getElementById('photo');
const filenameDiv = document.getElementById('filename');
const ratingDiv = document.getElementById('rating');
const counterDiv = document.getElementById('counter');

// Save state to localStorage
function saveState() {
    if (currentFolder && photos.length > 0) {
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
    currentFolder = folder;
    const res = await fetch(`/api/photos/${folder}`);
    photos = await res.json();
    currentIndex = startIndex;

    if (photos.length === 0) {
        alert('No photos in this folder');
        return;
    }

    // Make sure index is valid
    if (currentIndex >= photos.length) {
        currentIndex = 0;
    }

    folderSelectDiv.style.display = 'none';
    viewerDiv.style.display = 'block';
    showPhoto();
}

async function resumeSession(saved) {
    currentFolder = saved.folder;
    const res = await fetch(`/api/photos/${saved.folder}`);
    photos = await res.json();

    if (photos.length === 0) {
        alert('No photos in this folder');
        clearState();
        return;
    }

    // Find the saved photo in the list (it might have moved due to deletions)
    const savedIndex = photos.indexOf(saved.filename);
    currentIndex = savedIndex >= 0 ? savedIndex : 0;

    folderSelectDiv.style.display = 'none';
    viewerDiv.style.display = 'block';
    showPhoto();
}

function showPhoto(skipHighRated = true) {
    if (currentIndex >= photos.length) {
        // End of folder
        clearState();
        backToFolders();
        return;
    }

    const filename = photos[currentIndex];

    // Load rating first to check if we should skip
    ratingDiv.textContent = '...';
    fetch(`/api/rating/${currentFolder}/${filename}`)
        .then(r => r.json())
        .then(data => {
            const rating = data.rating;

            // Skip photos rated 4 or higher
            if (skipHighRated && rating !== null && rating >= 4) {
                if (currentIndex < photos.length - 1) {
                    currentIndex++;
                    showPhoto(true);
                    return;
                } else {
                    // No more photos
                    clearState();
                    backToFolders();
                    return;
                }
            }

            // Show this photo
            photoImg.src = `/api/photo/${currentFolder}/${filename}`;
            filenameDiv.textContent = filename;
            counterDiv.textContent = `${currentIndex + 1} / ${photos.length}`;
            saveState();

            if (rating !== null) {
                ratingDiv.textContent = '★'.repeat(rating) + '☆'.repeat(5 - rating);
            } else {
                ratingDiv.textContent = 'No rating';
            }
        });
}

function nextPhoto() {
    if (currentIndex < photos.length - 1) {
        currentIndex++;
        showPhoto();
    } else {
        backToFolders();
    }
}

function prevPhoto() {
    if (currentIndex > 0) {
        currentIndex--;
        showPhoto(false); // Don't skip when going back - let user see all photos
    }
}

async function moveToLow() {
    const filename = photos[currentIndex];
    const res = await fetch(`/api/move/${currentFolder}/${filename}`, { method: 'POST' });
    
    if (res.ok) {
        // Remove from array and show next
        photos.splice(currentIndex, 1);
        if (photos.length === 0) {
            backToFolders();
        } else if (currentIndex >= photos.length) {
            currentIndex = photos.length - 1;
            showPhoto();
        } else {
            showPhoto();
        }
    }
}

function backToFolders() {
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

// Start
loadFolders();

