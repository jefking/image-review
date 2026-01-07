# Image Review

A fast, minimal photo review app for quickly sorting through large photo collections.

## Setup

```bash
npm install
```

## Running

```bash
npm start
```

Then open http://localhost:3000 in your browser.

## Keyboard Controls

| Key | Action |
|-----|--------|
| `→` Right Arrow | Next photo |
| `←` Left Arrow | Previous photo |
| `↓` Down Arrow | Move photo to rejection folder |
| `Esc` | Back to folder selection |

## How It Works

1. On startup, select a year folder from `/media/jef/1.44.1-72806/photos/`
2. Photos display full-screen with star rating (from EXIF metadata) and filename
3. Use arrow keys to navigate or reject photos
4. Rejected photos are moved to `/media/jef/1.44.1-72806/photo-low/[year]/`
5. When you reach the end of a folder, you return to folder selection