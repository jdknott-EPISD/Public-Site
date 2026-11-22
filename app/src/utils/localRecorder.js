// Local recording for Live Studio: saves the finished program (the same picture and sound that
// go to the stream) as an MP4 on the streaming computer, with Chrome's MediaRecorder.
//
// With showSaveFilePicker (Chrome, Edge) the person picks the file first and the video is written
// into it every second, so a long service never piles up in memory. Chrome writes to a temporary
// file and swaps it in when the recording stops, so a crash mid-recording loses it. Browsers without
// the picker keep the recording in memory and download it at the end.

const TYPES = [
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' }
];

export const recordingType = () => {
  if (typeof MediaRecorder === 'undefined') return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t.mime)) || null;
};

export const canRecord = () => !!recordingType();
export const canPickFile = () => typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

// "Sunday Service 2026-11-22 10-30.mp4"
export const recordingName = (title, ext = recordingType()?.ext || 'mp4') => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const base = String(title || 'Live Studio').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Live Studio';
  return `${base} ${stamp}.${ext}`;
};

// Must be called from a click (the browser only shows the save window for one)
export const pickRecordingFile = async (suggestedName) => {
  const type = recordingType();
  const mp4 = type?.ext === 'mp4';
  return window.showSaveFilePicker({
    suggestedName,
    startIn: 'videos',
    types: [mp4 ? { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } } : { description: 'WebM video', accept: { 'video/webm': ['.webm'] } }]
  });
};

// ---------- The recordings folder (Desktop/Live) ----------
// A web page can't write to a path by itself, so the first time the person picks their Desktop
// (the window opens there) and the studio makes a "Live" folder in it, or uses the "Live" folder
// they picked. The folder is remembered in IndexedDB; Chrome may ask again on a later visit.

export const canUseFolder = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

const DB_NAME = 'liveStudioRecording';
const withStore = (mode, fn) => new Promise((resolve, reject) => {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore('folders');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction('folders', mode);
    const req = fn(tx.objectStore('folders'));
    tx.oncomplete = () => { open.result.close(); resolve(req?.result); };
    tx.onerror = () => { open.result.close(); reject(tx.error); };
  };
});

// { handle, label } or null
export const getSavedFolder = async () => {
  try { return (await withStore('readonly', (store) => store.get('recordings'))) || null; } catch { return null; }
};

// Must be called from a click. Returns { handle, label } for Desktop/Live (made if it isn't there).
export const chooseRecordingsFolder = async () => {
  const picked = await window.showDirectoryPicker({ id: 'live-studio-recordings', mode: 'readwrite', startIn: 'desktop' });
  const live = picked.name === 'Live' ? picked : await picked.getDirectoryHandle('Live', { create: true });
  const folder = { handle: live, label: picked.name === 'Live' ? 'Live' : `${picked.name}/Live` };
  await withStore('readwrite', (store) => store.put(folder, 'recordings')).catch(() => {});
  return folder;
};

// Must be called from a click if the browser hasn't kept the permission
export const folderAllowed = async (handle) => {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  return (await handle.requestPermission?.(opts)) === 'granted';
};

// A new file in the folder; "name (2).mp4" if the name is taken
export const createRecordingFile = async (folder, name) => {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? name : `${base} (${i})${ext}`;
    try {
      await folder.getFileHandle(candidate);
    } catch (error) {
      if (error?.name === 'NotFoundError') return folder.getFileHandle(candidate, { create: true });
      throw error;
    }
  }
  throw new Error('Too many recordings with the same name in that folder.');
};

export const formatBytes = (n) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(0, Math.round(n / 1e3))} KB`;
};

export class LocalRecorder {
  // handle: from pickRecordingFile, or null to keep it in memory and download it at the end
  constructor(videoTrack, audioTrack, handle, fileName) {
    this.type = recordingType();
    this.stream = new MediaStream([videoTrack, audioTrack].filter(Boolean));
    this.handle = handle;
    this.fileName = handle?.name || fileName;
    this.bytes = 0;
    this.startedAt = 0;
    this.parts = [];
    this.chain = Promise.resolve();
    this.error = null;
    this.onError = null;
  }

  async start() {
    if (!this.type) throw new Error('This browser can\'t record video. Use Chrome.');
    if (this.handle) this.writable = await this.handle.createWritable();
    this.recorder = new MediaRecorder(this.stream, { mimeType: this.type.mime, videoBitsPerSecond: 6000000, audioBitsPerSecond: 160000 });
    this.recorder.ondataavailable = (e) => {
      if (!e.data?.size) return;
      this.bytes += e.data.size;
      if (this.writable) {
        // In order, one piece at a time
        this.chain = this.chain.then(() => this.writable.write(e.data)).catch((error) => {
          if (this.error) return;
          this.error = error;
          console.error('Recording write failed:', error);
          this.onError?.('The recording could not be written (is the disk full?). It stopped.');
        });
      } else {
        this.parts.push(e.data);
      }
    };
    this.recorder.onerror = (e) => {
      console.error('Recorder error:', e.error || e);
      this.onError?.('The recording stopped because of an error.');
    };
    this.recorder.start(1000);
    this.startedAt = Date.now();
  }

  // Finishes the file. Resolves to { name, bytes }.
  stop() {
    if (this.stopping) return this.stopping;
    this.stopping = new Promise((resolve) => {
      const finish = async () => {
        await this.chain;
        if (this.writable) {
          await this.writable.close().catch((error) => console.error('Closing the recording failed:', error));
        } else if (this.parts.length) {
          const url = URL.createObjectURL(new Blob(this.parts, { type: this.type.mime.split(';')[0] }));
          const a = document.createElement('a');
          a.href = url;
          a.download = this.fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          this.parts = [];
        }
        resolve({ name: this.fileName, bytes: this.bytes });
      };
      if (this.recorder && this.recorder.state !== 'inactive') {
        this.recorder.onstop = finish;
        this.recorder.stop();
      } else {
        finish();
      }
    });
    return this.stopping;
  }
}
