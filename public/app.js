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

// Load folder list on start
async function loadFolders() {
    const res = await fetch('/api/folders');
    const folders = await res.json();
    foldersDiv.innerHTML = '';
    folders.forEach(folder => {
        const btn = document.createElement('button');
        btn.className = 'folder-btn';
        btn.textContent = folder;
        btn.onclick = () => selectFolder(folder);
        foldersDiv.appendChild(btn);
    });
}

async function selectFolder(folder) {
    currentFolder = folder;
    const res = await fetch(`/api/photos/${folder}`);
    photos = await res.json();
    currentIndex = 0;
    
    if (photos.length === 0) {
        alert('No photos in this folder');
        return;
    }
    
    folderSelectDiv.style.display = 'none';
    viewerDiv.style.display = 'block';
    showPhoto();
}

function showPhoto() {
    if (currentIndex >= photos.length) {
        // End of folder
        backToFolders();
        return;
    }
    
    const filename = photos[currentIndex];
    photoImg.src = `/api/photo/${currentFolder}/${filename}`;
    filenameDiv.textContent = filename;
    counterDiv.textContent = `${currentIndex + 1} / ${photos.length}`;
    
    // Load rating
    ratingDiv.textContent = '';
    fetch(`/api/rating/${currentFolder}/${filename}`)
        .then(r => r.json())
        .then(data => {
            if (data.rating !== null) {
                ratingDiv.textContent = '★'.repeat(data.rating) + '☆'.repeat(5 - data.rating);
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
        showPhoto();
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

