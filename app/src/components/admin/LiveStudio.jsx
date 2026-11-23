// Live Studio (/admin/live): stream to YouTube, Facebook, and more at the same time, with
// scenes (countdown, title cards, live), layouts, graphics, lower thirds, ticker, QR codes,
// and music. No subscription: the video goes out through the free Church Stream Helper running
// on the streaming computer (public/stream-helper; utils/streamHelper.js).
//
// Each computer that opens the studio is either:
//   - the streaming computer: camera, microphone, screen share and music are here, and it
//     sends the stream (through the helper on the same computer), or
//   - a co-host: switches scenes, layouts, graphics, captions and QR codes from another
//     computer, and sees a preview picture of what's on air.
// What's on screen is shared through liveStudio/control, so either can change it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { collection, deleteDoc, doc, limitToLast, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase/config';
import { useMemberAuth } from '../../context/MemberAuthContext';
import { StudioMixer, LAYOUTS, WIDTH, HEIGHT, loadImage } from '../../utils/liveMixer';
import { addVideo, isGifAsset, isVideoAsset, loadClip, newId, postMonitor, useStudioControl, useStudioLibrary, useStudioMonitor } from '../../utils/liveStudioLibrary';
import { HelperStream, INSTALL_COMMAND, getHelperStatus } from '../../utils/streamHelper';
import { usePhoneCamera } from '../../utils/phoneCamera';
import { LocalRecorder, canPickFile, canRecord, canUseFolder, chooseRecordingsFolder, createRecordingFile, folderAllowed, formatBytes, getSavedFolder, pickRecordingFile, recordingName } from '../../utils/localRecorder';
import PhoneCameraModal from '../live/PhoneCameraModal';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CaptionsPanel, ChatPanel, DestinationsPanel, Field, GraphicsPanel, Icon, ICONS, Modal, MusicPanel, QrPanel,
  darkInput, qrDataUrl
} from '../live/StudioPanels';

const callLiveStream = httpsCallable(functions, 'liveStream');

const ROLE_KEY = 'studioRole';
const MONITOR_EVERY_MS = 4000;
const MONITOR_FRESH_MS = 15000;
const HELPER_VERSION = '1.2.0'; // the version in public/stream-helper/helper.mjs

const olderThan = (a, b) => {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  return false;
};

const readRole = () => {
  try { return localStorage.getItem(ROLE_KEY) === 'cohost' ? 'cohost' : 'stream'; } catch { return 'stream'; }
};

const errorText = (error) => error?.message?.replace(/^.*?: /, '') || 'Something went wrong.';

const formatElapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
};

const PANELS = [
  { id: 'channels', label: 'Channels', icon: ICONS.broadcast },
  { id: 'graphics', label: 'Graphics', icon: ICONS.graphics },
  { id: 'captions', label: 'Captions', icon: ICONS.captions },
  { id: 'chat', label: 'Chat', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { id: 'qr', label: 'QR codes', icon: ICONS.qr },
  { id: 'music', label: 'Music', icon: ICONS.music }
];

const SCENE_KINDS = {
  live: 'Live (camera and screen)',
  countdown: 'Countdown',
  card: 'Title card',
  media: 'Media (intro or outro video)'
};

// One scene in the list; children get the drag handle's props
const SortableScene = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 10 : undefined }}
      className="relative flex-shrink-0 w-40 lg:w-auto group">
      {children({ ...attributes, ...listeners, style: { touchAction: 'none' } })}
    </div>
  );
};

// A Media scene's "next scene in the list" (Live if it's the last one)
const NEXT_IN_LIST = 'next';
// A countdown's next scene: '' = Live, NEXT_IN_LIST, a scene id, or STAY. Older countdowns only had
// thenLive (true = Live, false = stay).
const STAY = 'stay';
const countdownThen = (scene) => scene.countdownThen ?? (scene.thenLive === false ? STAY : '');
const sceneAfter = (scenes, scene, liveScene) => {
  if (scene.thenSceneId === NEXT_IN_LIST) {
    const i = scenes.findIndex((s) => s.id === scene.id);
    return (i >= 0 && scenes[i + 1]) || liveScene;
  }
  return scenes.find((s) => s.id === scene.thenSceneId && s.id !== scene.id) || liveScene;
};

// ---------- Scene editor ----------

const TEXT_COLORS = [
  { value: '#ffffff', label: 'White' },
  { value: '#10295e', label: 'Navy' },
  { value: '#18202d', label: 'Black' },
  { value: '#e6252e', label: 'Red' },
  { value: '#e7bd49', label: 'Gold' }
];

// Swatches plus a custom color; '' (for the countdown numbers) means "same as the text"
const ColorChoice = ({ label, value, onChange, allowSame }) => (
  <div>
    <span className="block text-sm font-medium text-white/80 mb-1">{label}</span>
    <div className="flex flex-wrap items-center gap-2">
      {allowSame && (
        <button type="button" onClick={() => onChange('')}
          className={`px-2 h-8 rounded-full text-xs border ${!value ? 'border-church-blue ring-2 ring-church-blue' : 'border-white/20'}`}>Same as text</button>
      )}
      {TEXT_COLORS.map((c) => (
        <button key={c.value} type="button" onClick={() => onChange(c.value)} title={c.label} aria-label={c.label}
          className={`w-8 h-8 rounded-full border-2 ${value?.toLowerCase() === c.value ? 'border-church-blue ring-2 ring-church-blue' : 'border-white/30'}`}
          style={{ background: c.value }} />
      ))}
      <label className="flex items-center gap-1.5 text-xs text-white/70 cursor-pointer">
        <input type="color" value={value || '#ffffff'} onChange={(e) => onChange(e.target.value)} className="w-8 h-8 rounded cursor-pointer bg-transparent" />
        Custom
      </label>
    </div>
  </div>
);

const SceneForm = ({ scene, scenes, backgrounds, videos, onSave, onDelete, onClose }) => {
  const [draft, setDraft] = useState({ name: '', kind: 'card', text: '', minutes: 5, backgroundId: '', thenLive: true, textColor: '#ffffff', numberColor: '', videoId: '', thenSceneId: NEXT_IN_LIST, ...scene });
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const fileRef = useRef(null);
  const set = (changes) => setDraft((d) => ({ ...d, ...changes }));
  const otherScenes = scenes.filter((s) => s.id !== draft.id);
  const upload = async (file) => {
    if (!file) return;
    setError('');
    setProgress(0);
    try {
      const id = await addVideo(file, setProgress);
      setDraft((d) => ({ ...d, videoId: id, name: d.name || file.name.replace(/\.[^.]+$/, '').slice(0, 40) }));
    } catch (err) {
      console.error('Video upload failed:', err);
      setError(err.message || 'Upload failed.');
    }
    setProgress(null);
  };
  return (
    <Modal title={scene.id ? 'Edit scene' : 'Add a scene'} onClose={onClose} error={error}
      onSubmit={() => {
        if (progress !== null) { setError('Wait for the video to finish uploading.'); return; }
        if (!draft.name.trim()) { setError('Give the scene a name.'); return; }
        if (draft.kind === 'media' && !videos.some((v) => v.id === draft.videoId)) { setError('Choose or upload a video.'); return; }
        const minutes = Math.min(180, Math.max(0.25, Number(draft.minutes) || 5));
        onSave({ ...draft, id: draft.id || newId(), name: draft.name.trim().slice(0, 40), text: (draft.text || '').slice(0, 300), minutes });
      }}>
      <Field label="Name"><input autoFocus type="text" maxLength={40} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Before service" className={darkInput} /></Field>
      <Field label="Type">
        <select value={draft.kind} onChange={(e) => set({ kind: e.target.value })} className={darkInput}>
          {Object.entries(SCENE_KINDS).map(([id, label]) => <option key={id} value={id} className="text-black">{label}</option>)}
        </select>
      </Field>
      {draft.kind === 'media' && (
        <>
          <Field label="Video" hint="Plays full screen with its sound. MP4 works best (up to 300 MB).">
            <div className="flex gap-2">
              <select value={draft.videoId || ''} onChange={(e) => set({ videoId: e.target.value })} className={darkInput}>
                <option value="" className="text-black">Choose a video…</option>
                {videos.map((v) => <option key={v.id} value={v.id} className="text-black">{v.name}</option>)}
              </select>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={progress !== null}
                className="flex-shrink-0 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium disabled:opacity-60">
                {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : 'Upload'}
              </button>
              <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" className="hidden"
                onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </Field>
          <Field label="When the video ends, switch to">
            <select value={draft.thenSceneId || ''} onChange={(e) => set({ thenSceneId: e.target.value })} className={darkInput}>
              <option value={NEXT_IN_LIST} className="text-black">
                The next scene in the list{draft.id ? ` (now: ${sceneAfter(scenes, draft, { name: 'Live' }).name})` : ''}
              </option>
              <option value="" className="text-black">The Live scene</option>
              {otherScenes.filter((s) => s.kind !== 'live').map((s) => <option key={s.id} value={s.id} className="text-black">{s.name}</option>)}
            </select>
          </Field>
        </>
      )}
      {draft.kind !== 'live' && draft.kind !== 'media' && (
        <Field label="Text" hint="The first line is large. Press Enter for more lines.">
          <textarea rows={3} maxLength={300} value={draft.text} onChange={(e) => set({ text: e.target.value })} className={darkInput} />
        </Field>
      )}
      {draft.kind !== 'live' && draft.kind !== 'media' && (
        <ColorChoice label="Text color" value={draft.textColor || '#ffffff'} onChange={(v) => set({ textColor: v || '#ffffff' })} />
      )}
      {draft.kind === 'countdown' && (
        <ColorChoice label="Countdown numbers color" value={draft.numberColor || ''} onChange={(v) => set({ numberColor: v })} allowSame />
      )}
      {draft.kind === 'countdown' && (
        <>
          <Field label="Minutes"><input type="number" min="0.25" max="180" step="0.25" value={draft.minutes} onChange={(e) => set({ minutes: e.target.value })} className={darkInput} /></Field>
          <Field label="When it reaches zero, switch to">
            <select value={countdownThen(draft)} onChange={(e) => set({ countdownThen: e.target.value, thenLive: e.target.value !== STAY })} className={darkInput}>
              <option value="" className="text-black">The Live scene</option>
              <option value={NEXT_IN_LIST} className="text-black">
                The next scene in the list{draft.id ? ` (now: ${sceneAfter(scenes, { ...draft, thenSceneId: NEXT_IN_LIST }, { name: 'Live' }).name})` : ''}
              </option>
              {otherScenes.filter((s) => s.kind !== 'live').map((s) => <option key={s.id} value={s.id} className="text-black">{s.name}</option>)}
              <option value={STAY} className="text-black">Stay on the countdown (shows 0:00)</option>
            </select>
          </Field>
        </>
      )}
      <div>
        <span className="block text-sm font-medium text-white/80 mb-1">In this scene</span>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input type="checkbox" checked={!draft.micOff} onChange={(e) => set({ micOff: !e.target.checked })} className="w-4 h-4 accent-church-blue" />
            Microphone on
          </label>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input type="checkbox" checked={!draft.cameraOff} onChange={(e) => set({ cameraOff: !e.target.checked })} className="w-4 h-4 accent-church-blue" />
            Camera on
          </label>
        </div>
        <p className="mt-1 text-xs text-white/50">Only while this scene is on screen; other scenes keep their own setting.{draft.kind !== 'live' ? ' (Title cards, countdowns and videos never show the camera.)' : ''}</p>
      </div>
      <Field label="Background" hint={draft.kind === 'media' ? 'Shown for a moment while the video loads.' : 'Upload backgrounds under Graphics.'}>
        <select value={draft.backgroundId || ''} onChange={(e) => set({ backgroundId: e.target.value })} className={darkInput}>
          <option value="" className="text-black">The studio's background</option>
          {backgrounds.map((b) => <option key={b.id} value={b.id} className="text-black">{b.name}</option>)}
        </select>
      </Field>
      {scene.id && (
        <button type="button" onClick={onDelete} className="text-sm text-red-300 hover:underline">Delete this scene</button>
      )}
    </Modal>
  );
};

// ---------- Device settings ----------

const SettingsModal = ({ devices, cameraId, micId, onCamera, onMic, mirror, onMirror, onClose }) => (
  <Modal title="Camera and microphone" onClose={onClose} onSubmit={onClose} submitLabel="Done">
    <Field label="Camera">
      <select value={cameraId} onChange={(e) => onCamera(e.target.value)} className={darkInput}>
        <option value="" className="text-black">Default camera</option>
        {devices.cameras.map((d, i) => <option key={d.deviceId || i} value={d.deviceId} className="text-black">{d.label || `Camera ${i + 1}`}</option>)}
      </select>
    </Field>
    <Field label="Microphone" hint="For a sound board, choose its USB audio input. Echo cancellation and noise reduction are off so music sounds natural.">
      <select value={micId} onChange={(e) => onMic(e.target.value)} className={darkInput}>
        <option value="" className="text-black">Default microphone</option>
        {devices.mics.map((d, i) => <option key={d.deviceId || i} value={d.deviceId} className="text-black">{d.label || `Microphone ${i + 1}`}</option>)}
      </select>
    </Field>
    <label className="flex items-start gap-3 text-sm text-white/80">
      <input type="checkbox" checked={mirror} onChange={(e) => onMirror(e.target.checked)} className="mt-0.5 w-4 h-4 accent-church-blue" />
      <span>
        <span className="block font-medium">Mirror camera</span>
        <span className="block text-xs text-white/50">Flip the camera left-to-right, on the stream too. Leave it off if there's writing (signs, shirts, a whiteboard) in view, or it will read backwards.</span>
      </span>
    </label>
  </Modal>
);

// ---------- Stream helper setup ----------

const HelperSetupModal = ({ onClose, onCheck }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal title="Set up this computer to stream" onClose={onClose} onSubmit={() => { onCheck(); onClose(); }} submitLabel="Check again">
      <p className="text-sm text-white/80">
        The streaming computer needs the free <strong>Church Stream Helper</strong>. It sends the stream to YouTube, Facebook and your other channels. You only have to do this once per computer (Mac).
      </p>
      <ol className="text-sm text-white/80 space-y-3 list-decimal pl-5">
        <li>Open <strong>Terminal</strong> (press ⌘ Space, type <em>Terminal</em>, press Return).</li>
        <li>
          Paste this line and press Return:
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 min-w-0 block px-3 py-2 rounded-lg bg-black/40 text-xs font-mono break-all">{INSTALL_COMMAND}</code>
            <button type="button" onClick={copy} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium flex-shrink-0">{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </li>
        <li>Wait for "The Church Stream Helper is running." It starts by itself whenever this Mac starts.</li>
        <li>Back here, if Chrome asks to allow access to <em>apps and services on this device</em> or your <em>local network</em>, click <strong>Allow</strong>.</li>
      </ol>
      <p className="text-xs text-white/50">Use Google Chrome for the studio. To remove the helper later, run the same line with <code>-s -- --uninstall</code> added after <code>bash</code>.</p>
    </Modal>
  );
};

// ---------- Box style (shape and corner rounding), like Restream's Customization ----------

const SHAPES = [
  { id: 'rect', label: 'Rectangle', icon: <span className="block w-7 h-4 rounded-sm border-2 border-current" /> },
  { id: 'square', label: 'Square', icon: <span className="block w-5 h-5 rounded-sm border-2 border-current" /> },
  { id: 'circle', label: 'Circle', icon: <span className="block w-5 h-5 rounded-full border-2 border-current" /> }
];

// The 12 spots for the small box, laid out like Restream's grid (5 x 5, edges only)
const POSITION_CELLS = [
  [0, 1, 'top-start'], [0, 2, 'top-center'], [0, 3, 'top-end'],
  [1, 0, 'left-start'], [2, 0, 'left-center'], [3, 0, 'left-end'],
  [1, 4, 'right-start'], [2, 4, 'right-center'], [3, 4, 'right-end'],
  [4, 1, 'bottom-start'], [4, 2, 'bottom-center'], [4, 3, 'bottom-end']
];
const PLACEMENT_DEFAULTS = { side: { pos: 'right-center', size: 30 }, pip: { pos: 'bottom-end', size: 27 }, cameraPip: { pos: 'bottom-end', size: 30 } };

const PlacementControls = ({ layout, placement, onChange }) => {
  const current = { ...PLACEMENT_DEFAULTS[layout], ...((placement || {})[layout] || {}) };
  const set = (changes) => onChange({ placement: { ...(placement || {}), [layout]: { ...current, ...changes } } });
  return (
    <div className="space-y-3">
      <div>
        <span className="block text-sm font-medium text-white/80 mb-1">Small box position</span>
        <p className="text-xs text-white/50 mb-2">{layout === 'side' ? 'Beside the big box: the big box moves over to make room.' : 'Floating over the big picture.'}</p>
        <div className="grid grid-cols-5 grid-rows-5 gap-1 w-56 h-36 mx-auto rounded-lg bg-white/5 p-1.5">
          {POSITION_CELLS.map(([row, col, pos]) => (
            <button key={pos} type="button" onClick={() => set({ pos })} aria-label={pos.replace('-', ' ')} aria-pressed={current.pos === pos}
              style={{ gridRow: row + 1, gridColumn: col + 1 }}
              className={`rounded ${current.pos === pos ? 'bg-church-blue' : 'bg-white/10 hover:bg-white/20'}`} />
          ))}
          <span className="row-start-2 row-span-3 col-start-2 col-span-3 rounded bg-white/15 flex items-center justify-center text-[10px] text-white/50">big box</span>
        </div>
      </div>
      <label className="block">
        <span className="flex justify-between text-sm font-medium text-white/80 mb-1"><span>Small box size</span><span className="text-white/50">{current.size}%</span></span>
        <input type="range" min="10" max="45" step="1" value={current.size} onChange={(e) => set({ size: Number(e.target.value) })} className="w-full accent-church-blue" />
      </label>
    </div>
  );
};

const StyleModal = ({ shape, cameraRadius, screenRadius, layout, placement, onChange, onClose }) => {
  // Off by default: the camera and screen corners are set separately unless this is ticked
  const [linked, setLinked] = useState(false);
  const setRadius = (which, value) => onChange(linked ? { cameraRadius: value, screenRadius: value } : { [which]: value });
  const slider = (label, which, value) => (
    <label className="block">
      <span className="flex justify-between text-sm font-medium text-white/80 mb-1"><span>{label}</span><span className="text-white/50">{value}px</span></span>
      <input type="range" min="0" max="60" step="2" value={value} onChange={(e) => setRadius(which, Number(e.target.value))} className="w-full accent-church-blue" />
    </label>
  );
  return (
    <Modal title="Box style" onClose={onClose} onSubmit={onClose} submitLabel="Done">
      {PLACEMENT_DEFAULTS[layout]
        ? <PlacementControls layout={layout} placement={placement} onChange={onChange} />
        : <p className="text-xs text-white/50">Choose the "Screen large, camera beside" or a corner layout to move and resize the small box.</p>}
      <div>
        <span className="block text-sm font-medium text-white/80 mb-2">Camera shape</span>
        <div className="grid grid-cols-3 gap-2">
          {SHAPES.map((sh) => (
            <button key={sh.id} type="button" onClick={() => onChange({ cameraShape: sh.id })} aria-pressed={shape === sh.id}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-lg text-xs ${shape === sh.id ? 'bg-church-blue/25 ring-2 ring-church-blue' : 'bg-white/5 hover:bg-white/10'}`}>
              {sh.icon}{sh.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-white/50 mt-1">For the camera box in two-box layouts. A full-screen camera stays full screen.</p>
      </div>
      {slider('Camera corners', 'cameraRadius', cameraRadius)}
      {slider('Screen corners', 'screenRadius', screenRadius)}
      <label className="flex items-center gap-2 text-sm text-white/80">
        <input type="checkbox" checked={linked} onChange={(e) => {
          setLinked(e.target.checked);
          if (e.target.checked) onChange({ screenRadius: cameraRadius });
        }} className="w-4 h-4 accent-church-blue" />
        Same for both
      </label>
      <button type="button" onClick={() => { setLinked(false); onChange({ cameraShape: 'rect', cameraRadius: 12, screenRadius: 12, placement: {} }); }}
        className="text-sm text-white/60 underline hover:text-white">Reset</button>
    </Modal>
  );
};

// Layouts with a camera box and a screen box that can trade places
const TWO_BOX = ['pip', 'cameraPip', 'side', 'split', 'splitTall'];

// GO LIVE asks first: which channels, and whether to save a recording on this computer.
// With no channels ticked it only records (handy before YouTube or Facebook are set up).
const RECORD_KEY = 'studioRecordLocal';
const GoLiveModal = ({ channels, title, onStart, onClose, onChannels }) => {
  const recordable = canRecord();
  const [record, setRecord] = useState(() => {
    if (!recordable) return false;
    if (channels.length === 0) return true;
    try { return localStorage.getItem(RECORD_KEY) === '1'; } catch { return false; }
  });
  const [handle, setHandle] = useState(null); // a one-off file chosen with "Save somewhere else"
  const [folder, setFolder] = useState(null); // { handle, label }: Desktop/Live, once set up
  const [error, setError] = useState('');
  const recordOnly = channels.length === 0;
  const useFolder = canUseFolder();

  useEffect(() => { if (useFolder) getSavedFolder().then(setFolder); }, [useFolder]);

  const chooseFolder = async () => {
    setError('');
    try { setFolder(await chooseRecordingsFolder()); setHandle(null); } catch (e) { if (e?.name !== 'AbortError') setError('Could not use that folder. Choose your Desktop.'); }
  };

  const chooseFile = async () => {
    setError('');
    try { setHandle(await pickRecordingFile(recordingName(title))); } catch (e) { if (e?.name !== 'AbortError') setError('Could not choose that place. Try another folder.'); }
  };

  const start = async () => {
    setError('');
    if (recordOnly && !record) { setError('Tick a channel in Channels, or turn on the recording.'); return; }
    let file = handle;
    let where = handle ? '' : null;
    try {
      if (record && !file && useFolder) {
        // Still a click, so the browser may show its folder window or permission question now
        let f = folder;
        if (!f || !(await folderAllowed(f.handle))) f = await chooseRecordingsFolder();
        setFolder(f);
        file = await createRecordingFile(f.handle, recordingName(title));
        where = f.label;
      } else if (record && !file && canPickFile()) {
        file = await pickRecordingFile(recordingName(title));
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
      console.error('Choosing where to save failed:', e);
      setError('Could not save there. Use "Save somewhere else this time".');
      return;
    }
    try { localStorage.setItem(RECORD_KEY, record ? '1' : '0'); } catch { /* this visit only */ }
    onStart({ record, handle: file, where });
  };

  return (
    <Modal title={recordOnly ? 'Record' : 'Go live'} onClose={onClose} onSubmit={start}
      submitLabel={recordOnly ? 'Start recording' : record ? 'GO LIVE and record' : 'GO LIVE'} error={error}>
      {recordOnly ? (
        <p className="text-sm text-white/70">
          No channels are ticked, so this only records on this computer.{' '}
          <button type="button" onClick={onChannels} className="underline text-white/90">Choose channels</button> to stream too.
        </p>
      ) : (
        <p className="text-sm text-white/70">Streaming to <strong className="text-white">{channels.map((c) => c.name).join(', ')}</strong>.</p>
      )}
      {recordable ? (
        <div className="space-y-3 rounded-lg bg-white/5 p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} />
            Save a recording on this computer
          </label>
          {record && (
            handle ? (
              <div className="flex items-center gap-2 text-xs text-white/70">
                <span className="truncate">This time: <strong className="text-white">{handle.name}</strong></span>
                <button type="button" onClick={() => setHandle(null)} className="underline flex-shrink-0">Use {folder?.label || 'Desktop/Live'}</button>
              </div>
            ) : useFolder ? (
              <div className="space-y-1.5">
                <p className="text-sm">
                  Saves to <strong>{folder?.label || 'Desktop/Live'}</strong>
                  {folder && <button type="button" onClick={chooseFolder} className="ml-2 text-xs underline text-white/70">Change folder…</button>}
                </p>
                {!folder && (
                  <p className="text-xs text-white/60">
                    The first time, your Desktop opens: click <strong>Open</strong> (or Select) and the studio makes the <strong>Live</strong> folder there.
                  </p>
                )}
                {canPickFile() && <button type="button" onClick={chooseFile} className="text-xs underline text-white/60">Save somewhere else this time…</button>}
              </div>
            ) : canPickFile() ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={chooseFile} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium flex-shrink-0">Choose where to save…</button>
                <span className="text-xs text-white/60">You&apos;ll pick the folder and name when you start.</span>
              </div>
            ) : (
              <p className="text-xs text-white/60">The recording downloads when you stop.</p>
            )
          )}
          {record && (
            <p className="text-xs text-white/50">
              Records exactly what viewers see and hear, as a video file (MP4 in Chrome), about 2.7 GB an hour.
              Keep this tab open: if the browser closes unexpectedly, the recording is lost. It keeps recording if the stream drops.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-white/50">This browser can&apos;t record. Use Chrome to save a recording.</p>
      )}
    </Modal>
  );
};

const LayoutIcon = ({ boxes }) => (
  <span className="relative block w-14 h-8">
    {boxes.map(([x, y, w, h], i) => (
      <span key={i} className={`absolute rounded-sm ${i === 0 ? 'bg-white/35' : 'bg-white/60 ring-1 ring-[#2a2a2f]'}`}
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />
    ))}
  </span>
);

// ---------- The studio ----------

const LiveStudio = () => {
  const navigate = useNavigate();
  const { memberProfile } = useMemberAuth();
  const uid = memberProfile?.uid || memberProfile?.id || '';
  const previewRef = useRef(null);
  const meterRef = useRef(null);
  const phoneMeterRef = useRef(null);
  const outRef = useRef(null); // the HelperStream while this computer is sending
  const streamsRef = useRef({ camera: null, mic: null, screen: null });
  const tickerStartRef = useRef({ id: null, startedAt: 0 });
  const sendStartedAtRef = useRef(0); // when this computer started sending
  const [mixer, setMixer] = useState(null);

  const [role, setRoleState] = useState(readRole);
  const streamer = role === 'stream';
  const setRole = (r) => {
    if (outRef.current) return; // can't switch while this computer is sending
    setRoleState(r);
    try { localStorage.setItem(ROLE_KEY, r); } catch { /* remembered for this visit only */ }
  };

  const { library, assets, saveList } = useStudioLibrary();
  const { control, updateControl } = useStudioControl(uid);
  const [searchParams, setSearchParams] = useSearchParams();

  // Automatic setup (YouTube, Facebook): whether each is switched on (functions .env) and connected
  const [autoInfo, setAutoInfo] = useState(null);
  const [youtubeLink, setYoutubeLink] = useState(null);
  const [facebookLink, setFacebookLink] = useState(null);
  const [connectBusy, setConnectBusy] = useState('');
  const monitor = useStudioMonitor(!streamer);

  // Sources (streaming computer only)
  const [devices, setDevices] = useState({ cameras: [], mics: [] });
  const [cameraId, setCameraId] = useState('');
  const [micId, setMicId] = useState('');
  const [cameraOn, setCameraOn] = useState(true);
  const [micMuted, setMicMuted] = useState(false);
  // Flip the camera left-to-right (remembered on this computer)
  const [mirrorCamera, setMirrorCamera] = useState(() => { try { return localStorage.getItem('studioMirror') === '1'; } catch { return false; } });
  const changeMirror = (on) => {
    setMirrorCamera(on);
    try { localStorage.setItem('studioMirror', on ? '1' : '0'); } catch { /* this visit only */ }
  };
  const [sharing, setSharing] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const phone = usePhoneCamera(uid, streamer);
  const phoneLive = !!phone.stream;
  // The phone's microphone: sent only if turned on at the phone; the studio can mute it (on its own,
  // not with the computer's microphone). Scenes that turn the microphone off silence it too.
  const phoneHasMic = !!phone.stream?.getAudioTracks().length;
  const [phoneMicMuted, setPhoneMicMuted] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const [editingScene, setEditingScene] = useState(null);
  const [drag, setDrag] = useState(null); // dragging a box on the preview: { from, over } (canvas boxes)
  const [showStyle, setShowStyle] = useState(false);
  const [panel, setPanel] = useState('channels');

  // Channels, helper, and broadcast
  const [destinations, setDestinations] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [helper, setHelper] = useState(undefined); // undefined = checking, null = not found
  const [showHelperSetup, setShowHelperSetup] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | starting | live | stopping
  const [sendingHere, setSendingHere] = useState(false);
  const [broadcast, setBroadcast] = useState(null);
  const [notice, setNotice] = useState('');
  const [showGoLive, setShowGoLive] = useState(false);
  // Local recording (streaming computer only): { name, startedAt, bytes } while recording
  const recorderRef = useRef(null);
  const [recording, setRecording] = useState(null);
  const [savedNote, setSavedNote] = useState('');
  const [now, setNow] = useState(Date.now());

  const canShareScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  const scenes = useMemo(() => library?.scenes || [], [library]);
  const liveScene = useMemo(() => scenes.find((s) => s.kind === 'live') || { id: 'live', kind: 'live', name: 'Live' }, [scenes]);
  const scene = scenes.find((s) => s.id === control.sceneId) || liveScene;
  const sceneMicOff = !!scene.micOff;
  const sceneCameraOff = !!scene.cameraOff;
  const sceneCameraOffRef = useRef(sceneCameraOff);
  const monitorFresh = !streamer && monitor && Date.now() - Date.parse(monitor.updatedAt || 0) < MONITOR_FRESH_MS;
  // The screen's box can show the shared screen or a phone camera
  const sharingHere = streamer ? sharing : !!monitor?.sharing;
  const phoneHere = streamer ? phoneLive : !!monitor?.phone;
  const screenAvailable = sharingHere || phoneHere;
  // While a screen is shared, the phone can stand in for the webcam (control.cameraSource),
  // or take the screen's box (control.second). With all three on, the "trio" layout shows them all.
  const camIsPhone = sharingHere && phoneHere && control.cameraSource === 'phone';
  const secondIsPhone = phoneHere && !camIsPhone && (!sharingHere || control.second === 'phone');
  const webcamHere = streamer ? cameraOn && !sceneCameraOff : !!monitor?.cameraOn;
  const threeAvailable = sharingHere && phoneHere && webcamHere;
  const pictures = camIsPhone ? 'screen-phone' : secondIsPhone ? 'phone-webcam' : 'screen-webcam';
  const choosePictures = (id) => updateControl(
    id === 'screen-phone' ? { cameraSource: 'phone', second: 'screen' }
      : id === 'phone-webcam' ? { cameraSource: 'webcam', second: 'phone' }
        : { cameraSource: 'webcam', second: 'screen' });
  const boxName = secondIsPhone ? 'phone' : 'screen';
  const layoutLabel = (label) => {
    if (secondIsPhone) return label.replace('Screen', 'Phone').replace('screen', 'phone');
    if (camIsPhone) return label.replace('Camera', 'Phone').replace('camera', 'phone');
    return label;
  };

  // ----- Mixer -----
  useEffect(() => {
    const m = new StudioMixer();
    m.canvas.className = 'w-full h-full block';
    previewRef.current?.appendChild(m.canvas);
    setMixer(m);

    let frame;
    const meter = () => {
      if (meterRef.current) meterRef.current.style.height = `${Math.round(m.micLevel() * 100)}%`;
      if (phoneMeterRef.current) phoneMeterRef.current.style.height = `${Math.round(m.phoneLevel() * 100)}%`;
      frame = requestAnimationFrame(meter);
    };
    frame = requestAnimationFrame(meter);

    const streams = streamsRef.current;
    return () => {
      cancelAnimationFrame(frame);
      if (outRef.current) {
        outRef.current.stop();
        outRef.current = null;
        callLiveStream({ action: 'stop' }).catch(() => {});
      }
      Object.values(streams).forEach((s) => s?.getTracks().forEach((t) => t.stop()));
      m.destroy();
    };
  }, []);

  // Uploaded pictures, decoded once
  const [images, setImages] = useState({});
  useEffect(() => {
    let cancelled = false;
    Promise.all((assets || []).map(async (a) => [a.id, await loadImage(a.dataUrl)])).then((pairs) => {
      if (!cancelled) setImages(Object.fromEntries(pairs.filter(([, img]) => img)));
    });
    return () => { cancelled = true; };
  }, [assets]);

  const [qrImage, setQrImage] = useState(null);
  const qrUrl = control.qr?.url || '';
  useEffect(() => {
    let cancelled = false;
    if (!qrUrl) { setQrImage(null); return undefined; }
    qrDataUrl(qrUrl).then(loadImage).then((img) => { if (!cancelled) setQrImage(img); });
    return () => { cancelled = true; };
  }, [qrUrl]);

  // Tell the mixer what to draw
  useEffect(() => {
    if (!mixer) return;
    const tickerId = control.ticker?.id || null;
    if (tickerStartRef.current.id !== tickerId) tickerStartRef.current = { id: tickerId, startedAt: performance.now() };
    mixer.set({
      scene: { kind: scene.kind, text: scene.text || '', endsAt: control.sceneEndsAt || 0, textColor: scene.textColor || '', numberColor: scene.numberColor || '' },
      layout: control.layout,
      second: control.second || 'screen',
      cameraSource: control.cameraSource || 'webcam',
      trioTurn: control.trioTurn || 0,
      swap: !!control.swap,
      mirrorCamera,
      tickerSpeed: control.tickerSpeed || 110,
      chatShown: control.chatShown || null,
      cameraRadius: control.cameraRadius ?? 12,
      screenRadius: control.screenRadius ?? 12,
      cameraShape: control.cameraShape || 'rect',
      placement: control.placement || {},
      background: images[scene.backgroundId] || images[control.background] || null,
      logo: images[control.logo] || null,
      overlay: images[control.overlay] || null,
      lowerThird: control.lowerThird,
      ticker: control.ticker ? { ...control.ticker, startedAt: tickerStartRef.current.startedAt } : null,
      qr: control.qr && qrImage ? { image: qrImage, label: control.qr.label } : null
    });
  }, [mixer, scene, control, images, qrImage, mirrorCamera]);

  // ----- Moving background: the streaming computer downloads the video and loops it; elsewhere
  // (and while it loads) the picture taken from it is shown -----
  const bgId = images[scene.backgroundId] ? scene.backgroundId : control.background;
  const bgVideoId = (assets || []).some((a) => a.id === bgId && isVideoAsset(a)) ? bgId : '';
  useEffect(() => {
    if (!mixer) return undefined;
    if (!streamer || !bgVideoId) { mixer.setBackgroundVideo(null); return undefined; }
    let cancelled = false;
    loadClip(bgVideoId)
      .then((url) => { if (!cancelled) mixer.setBackgroundVideo(url); })
      .catch((error) => {
        console.error('Moving background failed:', error);
        if (!cancelled) setNotice(`The moving background couldn't load: ${error.message || error}`);
      });
    return () => { cancelled = true; };
  }, [mixer, streamer, bgVideoId]);

  // ----- Animated GIF overlay: the streaming computer downloads the GIF and plays it; the
  // still first frame shows meanwhile (and on a co-host's preview) -----
  const gifOverlayId = (assets || []).some((a) => a.id === control.overlay && isGifAsset(a)) ? control.overlay : '';
  useEffect(() => {
    if (!mixer) return undefined;
    if (!streamer || !gifOverlayId) { mixer.setOverlayGif(null); return undefined; }
    let cancelled = false;
    loadClip(gifOverlayId)
      .then((url) => { if (!cancelled) mixer.setOverlayGif(url); })
      .catch((error) => {
        console.error('GIF overlay failed:', error);
        if (!cancelled) setNotice(`The GIF overlay couldn't load: ${error.message || error}`);
      });
    return () => { cancelled = true; };
  }, [mixer, streamer, gifOverlayId]);

  // ----- Video clips: control.clip = { id, startedAt } while one plays (set from any computer);
  // the streaming computer downloads it once and plays it full screen, then clears it -----
  const [clipState, setClipState] = useState(null); // { id, status: 'loading' | 'playing' } here
  const clipId = control.clip?.id || '';
  const clipStartedAt = control.clip?.startedAt || 0;

  // What to put in control to show a scene. A Media scene also starts its video.
  const sceneChanges = useCallback((s) => ({
    sceneId: s.id,
    sceneEndsAt: s.kind === 'countdown' ? Date.now() + (Number(s.minutes) || 5) * 60000 : 0,
    ...(s.kind === 'media' && s.videoId ? { clip: { id: s.videoId, startedAt: Date.now(), sceneId: s.id } } : {})
  }), []);

  // A clip ended (or failed). If a Media scene started it and is still on screen, go on to its next scene.
  const latest = useRef({});
  latest.current = { control, scenes, liveScene };
  const finishClip = useCallback(() => {
    const { control: c, scenes: all, liveScene: live } = latest.current;
    const from = c.clip?.sceneId && c.sceneId === c.clip.sceneId ? all.find((s) => s.id === c.clip.sceneId) : null;
    if (!from) { updateControl({ clip: null }); return; }
    const next = sceneAfter(all, from, live);
    updateControl({ clip: null, ...sceneChanges(next) });
  }, [updateControl, sceneChanges]);

  useEffect(() => {
    if (!streamer || !mixer) return undefined;
    if (!clipId) { mixer.stopClip(); setClipState(null); return undefined; }
    let cancelled = false;
    setClipState({ id: clipId, status: 'loading' });
    loadClip(clipId)
      .then((url) => {
        if (cancelled) return undefined;
        setClipState({ id: clipId, status: 'playing' });
        return mixer.playClip(url).then(() => {
          if (!cancelled) { setClipState(null); finishClip(); }
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Clip failed:', error);
        setNotice(`The video clip couldn't play: ${error.message || error}`);
        setClipState(null);
        finishClip();
      });
    return () => { cancelled = true; };
  }, [streamer, mixer, clipId, clipStartedAt, finishClip]);

  // Download every clip ahead of time on the streaming computer, so clicking one plays at once
  useEffect(() => {
    if (!streamer) return;
    (assets || []).filter(isVideoAsset).forEach((a) => { loadClip(a.id).catch(() => {}); });
  }, [streamer, assets]);

  const toggleClip = (asset) => {
    mixer?.resumeAudio();
    updateControl({ clip: control.clip?.id === asset.id ? null : { id: asset.id, startedAt: Date.now() } });
  };
  const clipForPanel = streamer
    ? (clipState || (control.clip ? { id: control.clip.id, status: 'loading' } : null))
    : (control.clip ? { id: control.clip.id, status: 'playing' } : null);

  // Leaving a Media scene by hand stops its video
  const switchScene = useCallback((s) => {
    mixer?.resumeAudio();
    const stopClip = latest.current.control.clip?.sceneId && s.kind !== 'media' ? { clip: null } : {};
    updateControl({ ...stopClip, ...sceneChanges(s) });
  }, [mixer, updateControl, sceneChanges]);

  // Countdown finished: go to the scene it names (Live unless it says otherwise)
  useEffect(() => {
    if (scene.kind !== 'countdown' || !control.sceneEndsAt) return undefined;
    const then = countdownThen(scene);
    if (then === STAY) return undefined;
    const next = then ? sceneAfter(scenes, { ...scene, thenSceneId: then }, liveScene) : liveScene;
    if (next.id === scene.id) return undefined;
    const id = setTimeout(() => switchScene(next), Math.max(0, control.sceneEndsAt - Date.now()) + 1000);
    return () => clearTimeout(id);
  }, [scene, scenes, control.sceneEndsAt, liveScene, switchScene]);

  // ----- Sources (streaming computer only) -----
  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({ cameras: list.filter((d) => d.kind === 'videoinput'), mics: list.filter((d) => d.kind === 'audioinput') });
    } catch {
      // Device names are a nicety; the default devices still work
    }
  }, []);

  useEffect(() => {
    if (!mixer) return undefined;
    let cancelled = false;
    streamsRef.current.camera?.getTracks().forEach((t) => t.stop());
    streamsRef.current.camera = null;
    mixer.setCamera(null);
    if (!streamer || !cameraOn) return undefined;
    navigator.mediaDevices.getUserMedia({
      video: { deviceId: cameraId ? { exact: cameraId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
    }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamsRef.current.camera = stream;
      mixer.setCamera(sceneCameraOffRef.current ? null : stream);
      setMediaError('');
      refreshDevices();
    }).catch((error) => {
      console.error('Camera error:', error);
      if (!cancelled) setMediaError('The camera could not start. Allow camera access in the browser, or choose another camera in Settings.');
    });
    return () => { cancelled = true; };
  }, [mixer, streamer, cameraOn, cameraId, refreshDevices]);

  // Echo cancellation and noise suppression are off: nothing plays back in the studio, and
  // those filters make singing and music sound thin.
  useEffect(() => {
    if (!mixer) return undefined;
    let cancelled = false;
    streamsRef.current.mic?.getTracks().forEach((t) => t.stop());
    streamsRef.current.mic = null;
    mixer.setMic(null);
    if (!streamer) return undefined;
    navigator.mediaDevices.getUserMedia({
      audio: { deviceId: micId ? { exact: micId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } }
    }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamsRef.current.mic = stream;
      mixer.setMic(stream);
      refreshDevices();
    }).catch((error) => {
      console.error('Microphone error:', error);
      if (!cancelled) setMediaError('The microphone could not start. Allow microphone access in the browser, or choose another one in Settings.');
    });
    return () => { cancelled = true; };
  }, [mixer, streamer, micId, refreshDevices]);

  // A scene can turn the mic or camera off while it's on screen (the buttons stay as they are).
  // The camera keeps running, just hidden, so it's back at once on the next scene.
  useEffect(() => { mixer?.setMicMuted(micMuted || sceneMicOff); }, [mixer, micMuted, sceneMicOff]);
  useEffect(() => { mixer?.setPhoneMuted(phoneMicMuted || sceneMicOff); }, [mixer, phoneMicMuted, sceneMicOff]);
  useEffect(() => {
    sceneCameraOffRef.current = sceneCameraOff;
    mixer?.setCamera(sceneCameraOff ? null : streamsRef.current.camera || null);
  }, [mixer, sceneCameraOff]);

  const stopSharing = useCallback(() => {
    streamsRef.current.screen?.getTracks().forEach((t) => t.stop());
    streamsRef.current.screen = null;
    mixer?.setScreen(null);
    setSharing(false);
  }, [mixer]);

  // A co-host can't share this computer's screen into the stream
  useEffect(() => { if (!streamer) stopSharing(); }, [streamer, stopSharing]);

  const startSharing = async () => {
    mixer?.resumeAudio();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true // lets the person include tab or system audio (a video, music) if they tick the box
      });
      streamsRef.current.screen = stream;
      mixer?.setScreen(stream);
      stream.getVideoTracks()[0].addEventListener('ended', stopSharing); // the browser's own "Stop sharing"
      setSharing(true);
      // A phone that's already connected stays on, in the webcam's box
      updateControl({ layout: cameraOn || phoneLive ? 'pip' : 'screen', second: 'screen', cameraSource: phoneLive ? 'phone' : 'webcam', sceneId: liveScene.id, sceneEndsAt: 0 });
    } catch (error) {
      if (error?.name !== 'NotAllowedError') {
        console.error('Screen share error:', error);
        setMediaError('Screen sharing could not start.');
      }
    }
  };

  // ----- Phone camera (streaming computer only) -----
  useEffect(() => { mixer?.setPhone(phone.stream); }, [mixer, phone.stream]);
  // When a phone connects, show it: in the screen's box, or (while a screen is shared) in the
  // webcam's box, so the screen stays
  const phoneWasLive = useRef(false);
  useEffect(() => {
    if (phoneLive && !phoneWasLive.current) {
      const { control: c, liveScene: live } = latest.current;
      if (sharing) {
        updateControl({ cameraSource: 'phone', second: 'screen', ...(['camera', 'screen'].includes(c.layout) ? { layout: 'pip' } : {}) });
      } else {
        updateControl({ second: 'phone', cameraSource: 'webcam', ...(c.layout === 'camera' ? { layout: cameraOn ? 'pip' : 'screen', sceneId: live.id, sceneEndsAt: 0 } : {}) });
      }
    }
    phoneWasLive.current = phoneLive;
  }, [phoneLive, sharing, cameraOn, updateControl]);

  // ----- Stream helper (streaming computer only) -----
  const checkHelper = useCallback(async () => {
    const status = await getHelperStatus();
    setHelper(status && { ...status, checkedAt: Date.now() });
    return status;
  }, []);

  useEffect(() => {
    if (!streamer) return undefined;
    checkHelper();
    const id = setInterval(checkHelper, sendingHere ? 4000 : 10000);
    return () => clearInterval(id);
  }, [streamer, sendingHere, checkHelper]);

  // ----- Preview picture for co-hosts (posted by the streaming computer) -----
  useEffect(() => {
    if (!streamer || !mixer) return undefined;
    const small = document.createElement('canvas');
    small.width = 480;
    small.height = 270;
    const post = () => {
      small.getContext('2d').drawImage(mixer.canvas, 0, 0, small.width, small.height);
      postMonitor({
        image: small.toDataURL('image/jpeg', 0.6),
        sharing,
        phone: phoneLive,
        cameraOn: cameraOn && !sceneCameraOff,
        micMuted: micMuted || sceneMicOff,
        live: !!outRef.current,
        helper: helper ? { ok: !!helper.ok, outputs: helper.outputs || [] } : null,
        updatedBy: uid
      });
    };
    post();
    const id = setInterval(post, MONITOR_EVERY_MS);
    return () => clearInterval(id);
  }, [streamer, mixer, sharing, phoneLive, cameraOn, micMuted, sceneCameraOff, sceneMicOff, helper, uid]);

  // ----- Automatic setup (YouTube, Facebook) -----
  useEffect(() => {
    callLiveStream({ action: 'youtubeInfo' }).then(({ data }) => setAutoInfo(data)).catch(() => setAutoInfo({ configured: false, facebookConfigured: false }));
    const offYoutube = onSnapshot(doc(db, 'liveStream', 'youtube'), (snap) => setYoutubeLink(snap.data() || { connected: false }),
      () => setYoutubeLink({ connected: false }));
    const offFacebook = onSnapshot(doc(db, 'liveStream', 'facebook'), (snap) => setFacebookLink(snap.data() || { connected: false }),
      () => setFacebookLink({ connected: false }));
    return () => { offYoutube(); offFacebook(); };
  }, []);

  // Back from Google's or Facebook's sign-in page (?youtube=connected, ?facebook=choose, ...=error&message=...)
  useEffect(() => {
    const platform = searchParams.get('youtube') ? 'youtube' : searchParams.get('facebook') ? 'facebook' : '';
    if (!platform) return;
    const result = searchParams.get(platform);
    setPanel('channels');
    setNotice(result === 'error' ? (searchParams.get('message') || 'Connecting failed.') : '');
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const connectPlatform = async (platform) => {
    setConnectBusy(platform);
    try {
      const { data } = await callLiveStream({ action: platform === 'facebook' ? 'facebookConnect' : 'youtubeConnect' });
      window.location.href = data.url;
    } catch (error) {
      setNotice(errorText(error));
      setConnectBusy('');
    }
  };

  const disconnectPlatform = async (platform) => {
    const name = platform === 'facebook' ? 'Facebook Page' : 'YouTube channel';
    if (!window.confirm(`Disconnect the ${name}? GO LIVE will then use the saved stream key again, and each broadcast will need preparing on ${platform === 'facebook' ? 'Facebook' : 'YouTube'} by hand.`)) return;
    await callLiveStream({ action: platform === 'facebook' ? 'facebookDisconnect' : 'youtubeDisconnect' }).catch((error) => setNotice(errorText(error)));
  };

  const choosePage = (pageId) => callLiveStream({ action: 'facebookChoosePage', pageId }).catch((error) => setNotice(errorText(error)));

  const auto = autoInfo ? {
    ...autoInfo,
    channelTitle: youtubeLink?.channelTitle,
    connected: !!autoInfo.configured && !!youtubeLink?.connected,
    pageName: facebookLink?.pageName,
    choosePages: facebookLink?.choosePages,
    facebookConnected: !!autoInfo.facebookConfigured && !!facebookLink?.connected
  } : null;

  // ----- Live chat (YouTube + Facebook) -----
  const [chatMessages, setChatMessages] = useState([]);
  const [chatErrors, setChatErrors] = useState({});
  useEffect(() => onSnapshot(query(collection(db, 'liveChat'), orderBy('at'), limitToLast(300)),
    (snap) => setChatMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (error) => console.error('Error loading chat:', error)), []);

  // Only the streaming computer asks YouTube and Facebook for new messages (saves YouTube's daily allowance)
  useEffect(() => {
    if (!sendingHere) return undefined;
    let stopped = false;
    let timer;
    const poll = async () => {
      let wait = 10000;
      try {
        const { data } = await callLiveStream({ action: 'chatPoll' });
        setChatErrors(data.errors || {});
        wait = data.nextPollMs || 8000;
      } catch (error) {
        console.error('Chat check failed:', error);
      }
      if (!stopped) timer = setTimeout(poll, wait);
    };
    timer = setTimeout(poll, 4000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [sendingHere]);

  const showChat = (m) => updateControl({
    chatShown: control.chatShown?.id === m.id ? null : { id: m.id, author: m.author, text: m.text, platform: m.platform }
  });
  const sendChat = async (text, platforms) => (await callLiveStream({ action: 'chatSend', text, platforms })).data;

  // ----- Channels -----
  useEffect(() => {
    let first = true;
    return onSnapshot(collection(db, 'liveStreamDestinations'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      setDestinations(list);
      setSelected((prev) => {
        // Everything starts ticked, and new channels are ticked as they're added
        const next = new Set([...prev].filter((id) => list.some((d) => d.id === id)));
        snap.docChanges().forEach((c) => { if (first || c.type === 'added') next.add(c.doc.id); });
        first = false;
        return next;
      });
    }, (error) => {
      console.error('Error loading channels:', error);
      setDestinations([]);
    });
  }, []);

  const toggleSelected = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const removeDestination = async (d) => {
    if (!window.confirm(`Remove "${d.name}"? Its stream key will be deleted too.`)) return;
    try {
      await Promise.all([deleteDoc(doc(db, 'liveStreamDestinations', d.id)), deleteDoc(doc(db, 'liveStreamKeys', d.id))]);
    } catch (error) {
      console.error('Error removing channel:', error);
      setNotice('Could not remove that channel.');
    }
  };

  // ----- Broadcast -----
  const stopRecordingRef = useRef(null);
  const endHere = useCallback((message) => {
    const out = outRef.current;
    outRef.current = null;
    setSendingHere(false);
    out?.stop();
    if (message) setNotice(message);
  }, []);

  // What's on air. Also catches a stream ended from another computer (a co-host's End stream).
  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await callLiveStream({ action: 'status' });
      setBroadcast(data.status === 'live' ? data : null);
      if (data.status !== 'live' && outRef.current) {
        endHere(data.endedByName ? `${data.endedByName} ended the stream.` : 'The stream ended.');
        stopRecordingRef.current?.();
      }
      setPhase((p) => (p === 'starting' || p === 'stopping' ? p : data.status === 'live' ? 'live' : 'idle'));
    } catch (error) {
      console.error('Status check failed:', error);
    }
  }, [endHere]);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, phase === 'live' ? 8000 : 20000);
    return () => clearInterval(id);
  }, [refreshStatus, phase]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The streaming computer checks in every 30 seconds; without it, the stream counts as ended
  useEffect(() => {
    if (!sendingHere) return undefined;
    const id = setInterval(() => { callLiveStream({ action: 'heartbeat' }).catch(() => {}); }, 30000);
    return () => clearInterval(id);
  }, [sendingHere]);

  // The helper's ffmpeg stopped on its own (internet dropped, all channels refused).
  // Only a status checked after this stream started counts: an older one says "not live".
  useEffect(() => {
    if (sendingHere && helper && !helper.live && helper.checkedAt > sendStartedAtRef.current) {
      endHere(`${helper.lastError || 'The stream stopped.'}${recorderRef.current ? ' The recording on this computer is still going: click Stop recording when you\'re done.' : ''}`);
      callLiveStream({ action: 'stop' }).catch(() => {});
      setBroadcast(null);
      setPhase('idle');
    }
  }, [sendingHere, helper, endHere]);

  // Warn before closing the tab while sending (closing it ends the stream)
  // (and while recording: closing it loses the recording)
  useEffect(() => {
    if (!sendingHere && !recording) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sendingHere, recording]);

  // ----- Local recording -----
  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setRecording((r) => (r ? { ...r, finishing: true } : r));
    const { name, bytes } = await rec.stop();
    setRecording(null);
    setSavedNote(`Recording saved${rec.where ? ` to ${rec.where}` : ''}: ${name} (${formatBytes(bytes)}).`);
  }, []);

  stopRecordingRef.current = stopRecording;

  const startRecording = async (handle, where) => {
    const name = handle?.name || recordingName(library?.stream?.title);
    const rec = new LocalRecorder(mixer.videoTrack, mixer.audioTrack, handle, name);
    rec.where = where || '';
    rec.onError = (message) => { setNotice(message); stopRecording(); };
    await rec.start();
    recorderRef.current = rec;
    setSavedNote('');
    setRecording({ name: rec.fileName, startedAt: rec.startedAt, bytes: 0 });
  };

  // Size and time, once a second
  useEffect(() => {
    if (!recording || recording.finishing) return;
    const rec = recorderRef.current;
    if (rec && rec.bytes !== recording.bytes) setRecording((r) => (r ? { ...r, bytes: rec.bytes } : r));
  }, [now, recording]);

  // Stop recording if the studio closes inside the app
  useEffect(() => () => { recorderRef.current?.stop(); }, []);

  const selectedChannels = (destinations || []).filter((d) => selected.has(d.id));

  // GO LIVE (and Record): asks first, in GoLiveModal
  // ● Record: start recording now, straight to Desktop/Live (asks for the Desktop the first time)
  const savedFolderRef = useRef(null);
  useEffect(() => { if (streamer && canUseFolder()) getSavedFolder().then((f) => { savedFolderRef.current = f; }); }, [streamer]);
  const quickRecord = async () => {
    if (!mixer || !streamer || recorderRef.current) return;
    mixer.resumeAudio();
    setNotice('');
    const name = recordingName(library?.stream?.title);
    let file = null;
    let where = '';
    try {
      if (canUseFolder()) {
        let f = savedFolderRef.current;
        if (!f || !(await folderAllowed(f.handle))) f = await chooseRecordingsFolder();
        savedFolderRef.current = f;
        file = await createRecordingFile(f.handle, name);
        where = f.label;
      } else if (canPickFile()) {
        file = await pickRecordingFile(name);
      }
      await startRecording(file, where);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error('Recording failed to start:', error);
      setNotice(`The recording couldn't start: ${error.message || error}`);
    }
  };

  const openGoLive = () => {
    if (!mixer || !streamer) return;
    mixer.resumeAudio();
    setNotice('');
    setShowGoLive(true);
  };

  const startFromModal = async ({ record, handle, where }) => {
    setShowGoLive(false);
    if (record) {
      try {
        await startRecording(handle, where);
      } catch (error) {
        console.error('Recording failed to start:', error);
        setNotice(`The recording couldn't start: ${error.message || error}`);
        if (selectedChannels.length === 0) return;
      }
    }
    if (selectedChannels.length > 0) await goLive();
  };

  const goLive = async () => {
    if (!mixer || !streamer) return;
    const ids = (destinations || []).filter((d) => selected.has(d.id)).map((d) => d.id);
    if (ids.length === 0) {
      setPanel('channels');
      setNotice('Tick at least one channel to stream to.');
      return;
    }
    mixer.resumeAudio();
    setNotice('');
    const status = await checkHelper();
    if (!status) { setShowHelperSetup(true); return; }
    if (!status.ok) { setNotice('The stream helper is running but ffmpeg is missing. Run the installer again.'); return; }

    setPhase('starting');
    let out = null;
    try {
      const { data } = await callLiveStream({
        action: 'start',
        destinationIds: ids,
        title: library?.stream?.title || '',
        description: library?.stream?.description || '',
        privacy: library?.stream?.privacy || 'public'
      });
      out = new HelperStream(mixer.videoTrack, mixer.audioTrack);
      out.onFailure = (message) => {
        if (outRef.current !== out) return;
        endHere(message);
        callLiveStream({ action: 'stop' }).catch(() => {});
        setBroadcast(null);
        setPhase('idle');
      };
      await out.start(data.urls);
      sendStartedAtRef.current = Date.now();
      outRef.current = out;
      setSendingHere(true);
      const { urls, ...state } = data;
      setBroadcast(state);
      setPhase('live');
    } catch (error) {
      console.error('Go live failed:', error);
      out?.stop();
      callLiveStream({ action: 'stop' }).catch(() => {});
      setNotice(errorText(error));
      setPhase('idle');
    }
  };

  const endStream = async () => {
    if (!window.confirm(recording ? 'End the stream for everyone watching, and stop the recording?' : 'End the stream for everyone watching?')) return;
    setPhase('stopping');
    endHere();
    stopRecording();
    try {
      await callLiveStream({ action: 'stop' });
    } catch (error) {
      console.error('Stop failed:', error);
      setNotice(errorText(error));
    }
    setBroadcast(null);
    setPhase('idle');
  };

  const leave = () => {
    if ((sendingHere || recording) && !window.confirm(`Leaving the studio ends the ${sendingHere ? 'stream' : 'recording'}${sendingHere && recording ? ' and the recording' : ''}. Leave anyway?`)) return;
    if (recorderRef.current) stopRecording();
    navigate('/admin/dashboard');
  };

  // ----- Scenes -----
  const sceneSensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const moveScene = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = scenes.findIndex((x) => x.id === active.id);
    const to = scenes.findIndex((x) => x.id === over.id);
    if (from < 0 || to < 0) return;
    saveList('scenes', arrayMove(scenes, from, to)).catch((e) => console.error(e));
  };

  const saveScene = (s) => {
    const exists = scenes.some((x) => x.id === s.id);
    saveList('scenes', exists ? scenes.map((x) => (x.id === s.id ? s : x)) : [...scenes, s]).catch((e) => console.error(e));
    setEditingScene(null);
  };
  const deleteScene = (s) => {
    if (!window.confirm(`Delete the "${s.name}" scene?`)) return;
    saveList('scenes', scenes.filter((x) => x.id !== s.id)).catch((e) => console.error(e));
    setEditingScene(null);
  };

  // Each channel's state: from the helper here, or from the streaming computer's report
  const outputs = streamer ? helper?.outputs : monitor?.helper?.outputs;
  const broadcastWithResults = broadcast ? { ...broadcast, results: outputs || [] } : null;

  const backgrounds = useMemo(() => (assets || []).filter((a) => a.kind === 'background'), [assets]);
  const videos = useMemo(() => (assets || []).filter((a) => a.kind === 'video'), [assets]);
  const elapsed = broadcast?.startedAt ? formatElapsed(now - new Date(broadcast.startedAt).getTime()) : '';
  const busy = phase === 'starting' || phase === 'stopping';
  const countdownLeft = scene.kind === 'countdown' && control.sceneEndsAt ? Math.max(0, control.sceneEndsAt - now) : 0;
  const roundButton = (on) => `relative w-12 h-12 rounded-full flex items-center justify-center transition ${on ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-100 text-church-red-dark hover:bg-red-200'}`;
  const swapAvailable = scene.kind === 'live' && screenAvailable && TWO_BOX.includes(control.layout);
  // Dragging works where the boxes are actually drawn: on the streaming computer's preview
  const canDragSwap = streamer && swapAvailable && !!mixer;
  const slotUnder = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return mixer?.slotAt(((e.clientX - rect.left) / rect.width) * WIDTH, ((e.clientY - rect.top) / rect.height) * HEIGHT) || null;
  };
  const helperMissing = streamer && helper === null;
  const helperOld = streamer && helper && olderThan(helper.version, HELPER_VERSION);
  const liveElsewhere = phase === 'live' && !sendingHere;

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#18181b] text-white font-sans">
      {/* Top bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-3 sm:px-5 py-3 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={leave} className="p-2 rounded-lg hover:bg-white/10" aria-label="Back to dashboard"><Icon d={ICONS.back} /></button>
          <img src="/images/logo.png" alt="" className="w-8 h-8 object-contain bg-white rounded" />
          <h1 className="font-semibold truncate">Live Studio</h1>
        </div>

        <div className="flex items-center rounded-full bg-white/5 p-1 text-sm" role="group" aria-label="This computer is">
          {[['stream', 'Streaming computer'], ['cohost', 'Co-host']].map(([id, label]) => (
            <button key={id} onClick={() => setRole(id)} disabled={sendingHere && id !== role} aria-pressed={role === id}
              title={id === 'cohost' ? 'Control scenes and captions from this computer while another one streams' : 'This computer has the camera and sends the stream'}
              className={`px-3 py-1.5 rounded-full font-medium transition disabled:opacity-40 ${role === id ? 'bg-white text-[#18181b]' : 'text-white/70 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {streamer && (
            <button onClick={() => (helper ? checkHelper() : setShowHelperSetup(true))}
              className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${helper ? 'bg-green-500/15 text-green-300' : helper === null ? 'bg-church-gold/15 text-church-gold' : 'bg-white/5 text-white/50'}`}>
              <span className={`w-2 h-2 rounded-full ${helper ? 'bg-green-400' : helper === null ? 'bg-church-gold' : 'bg-white/40'}`} />
              {helper ? 'Stream helper ready' : helper === null ? 'Set up stream helper' : 'Checking helper…'}
            </button>
          )}
          {phase === 'live' && (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-church-red text-white text-sm font-semibold">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> LIVE {elapsed}
            </span>
          )}
          {recording && (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-sm font-semibold" title={`Recording to ${recording.name}`}>
              <span className={`w-2.5 h-2.5 rounded-full bg-red-500 ${recording.finishing ? '' : 'animate-pulse'}`} />
              {recording.finishing ? 'Saving…' : <>REC {formatElapsed(now - recording.startedAt)} <span className="font-normal text-white/60">{formatBytes(recording.bytes)}</span></>}
              {phase === 'live' && !recording.finishing && (
                <button onClick={() => { if (window.confirm('Stop the recording? The stream keeps going.')) stopRecording(); }}
                  className="ml-1 w-5 h-5 rounded bg-white/15 hover:bg-white/25 flex items-center justify-center" aria-label="Stop recording" title="Stop recording (the stream keeps going)">
                  <span className="w-2 h-2 bg-white" />
                </button>
              )}
            </span>
          )}
          {streamer && !recording && canRecord() && (
            <button onClick={quickRecord} disabled={busy}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-semibold transition"
              title="Record to Desktop/Live on this computer (works with or without going live)">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Record
            </button>
          )}
          {phase === 'live' ? (
            <button onClick={endStream} disabled={busy} className="px-5 py-2.5 rounded-full bg-white text-[#18181b] font-semibold hover:bg-white/90 disabled:opacity-60 transition">End stream</button>
          ) : streamer && recording ? (
            <button onClick={() => { if (window.confirm('Stop the recording?')) stopRecording(); }} disabled={!!recording.finishing}
              className="px-5 py-2.5 rounded-full bg-white text-[#18181b] font-semibold hover:bg-white/90 disabled:opacity-60 transition">
              Stop recording
            </button>
          ) : streamer ? (
            <button onClick={openGoLive} disabled={busy}
              className="px-6 py-2.5 rounded-full bg-church-red hover:bg-church-red-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold tracking-wide transition">
              {phase === 'starting' ? 'Starting…' : phase === 'stopping' ? 'Ending…' : 'GO LIVE'}
            </button>
          ) : (
            <span className="text-sm text-white/50">Not live</span>
          )}
        </div>
      </header>

      {(helperMissing || helperOld || helper?.warning || liveElsewhere || notice || savedNote || !streamer) && (
        <div className="px-3 sm:px-5 pt-3 space-y-2">
          {helperMissing && (
            <div className="p-3 rounded-lg bg-church-gold/15 border border-church-gold/40 text-sm flex flex-wrap items-center justify-between gap-3">
              <span>To go live from this computer, set up the free stream helper once. If it's already installed, Chrome may be blocking it: allow local network access for this site.</span>
              <button onClick={() => setShowHelperSetup(true)} className="px-3 py-1.5 rounded-lg bg-church-gold text-[#18181b] font-semibold">Set up</button>
            </div>
          )}
          {helperOld && !sendingHere && (
            <div className="p-3 rounded-lg bg-church-gold/15 border border-church-gold/40 text-sm flex flex-wrap items-center justify-between gap-3">
              <span>A newer stream helper is available (it fixes Facebook and keeps one slow channel from stopping the others). Run the setup line again to update it.</span>
              <button onClick={() => setShowHelperSetup(true)} className="px-3 py-1.5 rounded-lg bg-church-gold text-[#18181b] font-semibold">Update</button>
            </div>
          )}
          {streamer && helper?.warning && sendingHere && (
            <div className="p-3 rounded-lg bg-church-gold/15 border border-church-gold/40 text-sm">{helper.warning}</div>
          )}
          {!streamer && (
            <div className="p-3 rounded-lg bg-church-blue/15 border border-church-blue/40 text-sm">
              <strong>Co-host:</strong> scenes, layouts, graphics, captions and QR codes you choose here show on the stream right away.
              The camera, microphone, screen sharing, music and GO LIVE are on the streaming computer.
            </div>
          )}
          {liveElsewhere && streamer && (
            <div className="p-3 rounded-lg bg-church-blue/15 border border-church-blue/40 text-sm">
              The church is live from another computer{broadcast?.startedByName ? ` (started by ${broadcast.startedByName})` : ''}. Switch to <strong>Co-host</strong> above to help run it from here.
            </div>
          )}
          {savedNote && (
            <div className="p-3 rounded-lg bg-green-500/15 border border-green-400/40 text-sm flex justify-between gap-4">
              <span>{savedNote}</span>
              <button onClick={() => setSavedNote('')} aria-label="Dismiss"><Icon d={ICONS.close} className="w-4 h-4" /></button>
            </div>
          )}
          {notice && (
            <div className="p-3 rounded-lg bg-red-500/15 border border-red-400/40 text-sm flex justify-between gap-4">
              <span>{notice}</span>
              <button onClick={() => setNotice('')} aria-label="Dismiss"><Icon d={ICONS.close} className="w-4 h-4" /></button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Scenes */}
        <aside className="lg:w-56 flex-shrink-0 border-b lg:border-b-0 lg:border-r border-white/10 p-3 lg:overflow-y-auto">
          <button onClick={() => setEditingScene({})} className="w-full mb-3 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-sm font-semibold tracking-wide">+ ADD SCENE</button>
          <div className="flex lg:flex-col gap-3 overflow-x-auto lg:overflow-visible pb-1">
            <DndContext sensors={sceneSensors} collisionDetection={closestCenter} onDragEnd={moveScene}>
            <SortableContext items={scenes.map((s) => s.id)} strategy={rectSortingStrategy}>
            {scenes.map((s) => {
              const video = s.kind === 'media' ? videos.find((v) => v.id === s.videoId) : null;
              const bg = video?.dataUrl ? { src: video.dataUrl } : images[s.backgroundId] || images[control.background];
              const active = s.id === scene.id;
              return (
                <SortableScene key={s.id} id={s.id}>{(handle) => (<>
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-1 min-w-0">
                      <button type="button" {...handle} className="p-0.5 -ml-1 cursor-grab active:cursor-grabbing text-white/40 hover:text-white" aria-label={`Drag to reorder ${s.name}`} title="Drag to reorder">
                        <Icon d="M5 9h14M5 15h14" className="w-4 h-4" />
                      </button>
                      <span className="text-sm font-medium truncate">{s.name}</span>
                    </span>
                    <button onClick={() => setEditingScene(s)} className="p-1 text-white/50 hover:text-white" aria-label={`Edit ${s.name} scene`}><Icon d={ICONS.edit} className="w-4 h-4" /></button>
                  </div>
                  <button onClick={() => switchScene(s)} aria-label={`Show ${s.name} scene`}
                    className={`relative block w-full aspect-video rounded-lg overflow-hidden bg-gradient-to-br from-church-navy to-church-navy-deep ${active ? 'ring-2 ring-church-blue' : 'ring-1 ring-white/10 hover:ring-white/30'}`}>
                    {bg && <img src={bg.src} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />}
                    <span className="absolute inset-0 flex items-center justify-center text-white/80">
                      <Icon d={s.kind === 'live' ? ICONS.camera : s.kind === 'countdown' ? 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' : s.kind === 'media' ? 'M8 5v14l11-7z' : ICONS.captions} className="w-6 h-6" />
                    </span>
                    {s.kind === 'media' && (
                      <span className="absolute left-1.5 bottom-1.5 px-1.5 py-0.5 rounded bg-black/60 text-xs font-mono">
                        {video ? `${Math.floor((video.duration || 0) / 60)}:${String(Math.round(video.duration || 0) % 60).padStart(2, '0')}` : 'No video'}
                      </span>
                    )}
                    {s.kind === 'countdown' && (
                      <span className="absolute left-1.5 bottom-1.5 px-1.5 py-0.5 rounded bg-black/60 text-xs font-mono">
                        {active && control.sceneEndsAt ? formatElapsed(countdownLeft + 999) : formatElapsed((Number(s.minutes) || 5) * 60000)}
                      </span>
                    )}
                    {active && <span className="absolute right-1.5 top-1.5 px-1.5 py-0.5 rounded bg-church-blue text-[10px] font-bold uppercase">On screen</span>}
                  </button>
                </>)}</SortableScene>
              );
            })}
            </SortableContext>
            </DndContext>
          </div>
        </aside>

        {/* Preview, layouts, controls */}
        <main className="flex-1 min-w-0 flex flex-col items-center p-3 sm:p-5 lg:overflow-y-auto">
          <div className="w-full max-w-5xl">
            <div className={`relative w-full aspect-video rounded-xl overflow-hidden bg-black shadow-2xl ring-2 ${phase === 'live' ? 'ring-church-red' : 'ring-white/10'}`}>
              <div ref={previewRef} className="absolute inset-0" />
              {canDragSwap && (
                // Drag the camera box onto the screen box (or the other way) to trade places
                <div className={`absolute inset-0 touch-none ${drag ? 'cursor-grabbing' : 'cursor-grab'}`}
                  onPointerDown={(e) => {
                    const from = slotUnder(e);
                    if (!from) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDrag({ from, over: from });
                  }}
                  onPointerMove={(e) => { if (drag) setDrag({ ...drag, over: slotUnder(e) }); }}
                  onPointerUp={() => {
                    if (drag?.over && drag.over.source !== drag.from.source) updateControl({ swap: !control.swap });
                    setDrag(null);
                  }}
                  onPointerCancel={() => setDrag(null)}>
                  {drag && [drag.from, drag.over].filter(Boolean).map((r, i) => (
                    <span key={i} className={`absolute rounded-lg pointer-events-none ${i === 0 ? 'border-2 border-dashed border-white/80 bg-white/10' : drag.over.source !== drag.from.source ? 'ring-4 ring-church-blue bg-church-blue/20' : ''}`}
                      style={{ left: `${(r.x / WIDTH) * 100}%`, top: `${(r.y / HEIGHT) * 100}%`, width: `${(r.w / WIDTH) * 100}%`, height: `${(r.h / HEIGHT) * 100}%` }} />
                  ))}
                </div>
              )}
              {monitorFresh && monitor.image && <img src={monitor.image} alt="What the streaming computer is showing" className="absolute inset-0 w-full h-full object-cover" />}
              <span className="absolute top-3 left-3 px-2 py-1 rounded bg-black/55 text-xs font-medium">
                {streamer
                  ? (sendingHere ? 'On air: viewers see this' : 'Preview')
                  : monitorFresh ? 'From the streaming computer (updates every few seconds)' : 'Preview (graphics only: the streaming computer isn\'t open)'}
              </span>
            </div>

            {mediaError && streamer && <p className="mt-3 text-sm text-red-300">{mediaError}</p>}

            {scene.kind === 'live' ? (
              <div className="mt-4 flex flex-wrap justify-center gap-2" role="group" aria-label="Layout">
                {LAYOUTS.filter((l) => !l.needsThree || threeAvailable).map((l) => {
                  const disabled = l.needsScreen && !screenAvailable;
                  const current = (!screenAvailable ? 'camera' : control.layout === 'trio' && !threeAvailable ? 'side' : control.layout) === l.id;
                  const label = layoutLabel(l.label);
                  return (
                    <button key={l.id} onClick={() => updateControl({ layout: l.id })} disabled={disabled}
                      title={disabled ? `${label} (share a screen or connect a phone camera on the streaming computer first)` : label} aria-label={label} aria-pressed={current}
                      className={`p-2 rounded-lg bg-white/5 transition disabled:opacity-30 disabled:cursor-not-allowed ${current ? 'ring-2 ring-church-blue' : 'hover:bg-white/10'}`}>
                      <LayoutIcon boxes={l.boxes} />
                    </button>
                  );
                })}
                {control.layout === 'trio' && threeAvailable ? (
                <button onClick={() => updateControl({ trioTurn: ((control.trioTurn || 0) + 1) % 3 })}
                  title="Turn the three pictures clockwise: each one moves to the next box (large, top right, bottom right)"
                  aria-label="Rotate the three pictures clockwise"
                  className="px-3 rounded-lg bg-white/5 hover:bg-white/10 transition text-sm font-medium flex items-center gap-1.5">
                  <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" className="w-5 h-5" /> Rotate
                </button>
                ) : (
                <button onClick={() => updateControl({ swap: !control.swap })} disabled={!swapAvailable}
                  title={swapAvailable ? `Swap the camera and the ${boxName} (or drag one onto the other in the preview)` : 'Choose a layout with two boxes to swap them'}
                  aria-label={`Swap camera and ${boxName}`} aria-pressed={!!control.swap}
                  className={`px-3 rounded-lg bg-white/5 transition text-sm font-medium flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed ${control.swap ? 'ring-2 ring-church-blue' : 'hover:bg-white/10'}`}>
                  <Icon d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" className="w-5 h-5" /> Swap
                </button>
                )}
                <button onClick={() => setShowStyle(true)} title="Camera shape and rounded corners" aria-label="Box style"
                  className="px-3 rounded-lg bg-white/5 hover:bg-white/10 transition text-sm font-medium flex items-center gap-1.5">
                  <Icon d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" className="w-5 h-5" /> Style
                </button>
                {sharingHere && phoneHere && control.layout !== 'trio' && (
                  <div className="flex items-center rounded-lg bg-white/5 p-1 text-sm" role="group" aria-label="Which two pictures">
                    {[['screen-webcam', 'Screen + Webcam'], ['screen-phone', 'Screen + Phone'], ['phone-webcam', 'Phone + Webcam']].map(([id, label]) => (
                      <button key={id} onClick={() => choosePictures(id)} aria-pressed={pictures === id}
                        title={`Show the ${label.toLowerCase().replace(' + ', ' and the ')}`}
                        className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap ${pictures === id ? 'bg-white text-[#18181b]' : 'text-white/70 hover:text-white'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-4 text-center text-sm text-white/50">
                Showing the "{scene.name}" scene. Click a Live scene to show the camera{screenAvailable ? ` and ${boxName}` : ''}.
              </p>
            )}

            {streamer ? (
              <div className="mt-5 flex items-center justify-center gap-3">
                <button onClick={() => { mixer?.resumeAudio(); setMicMuted((v) => !v); }} className={roundButton(!micMuted)} aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'} title={micMuted ? 'Unmute' : 'Mute'}>
                  <Icon d={ICONS.mic} className="w-6 h-6" />
                  {(micMuted || sceneMicOff) && <span className="absolute w-7 h-0.5 bg-current rotate-45 rounded" />}
                  <span className="absolute -right-1 bottom-1 w-1.5 h-8 rounded-full bg-white/10 overflow-hidden flex items-end">
                    <span ref={meterRef} className={`block w-full ${micMuted || sceneMicOff ? 'bg-white/30' : 'bg-green-400'}`} style={{ height: '0%' }} />
                  </span>
                </button>
                <button onClick={() => { mixer?.resumeAudio(); setCameraOn((v) => !v); }} className={roundButton(cameraOn)} aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'} title={cameraOn ? 'Camera off' : 'Camera on'}>
                  <Icon d={ICONS.camera} className="w-6 h-6" />
                  {(!cameraOn || sceneCameraOff) && <span className="absolute w-7 h-0.5 bg-current rotate-45 rounded" />}
                </button>
                {canShareScreen && (
                  <button onClick={sharing ? stopSharing : startSharing}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition ${sharing ? 'bg-church-blue text-white hover:brightness-110' : 'bg-white/10 hover:bg-white/20'}`}
                    aria-label={sharing ? 'Stop sharing screen' : 'Share screen'} title={sharing ? 'Stop sharing' : 'Share screen'}>
                    <Icon d={ICONS.screen} className="w-6 h-6" />
                  </button>
                )}
                <button onClick={() => { mixer?.resumeAudio(); setShowPhone(true); }}
                  className={`relative w-12 h-12 rounded-full flex items-center justify-center transition ${phoneLive ? 'bg-church-blue text-white hover:brightness-110' : 'bg-white/10 hover:bg-white/20'}`}
                  aria-label="Phone camera" title={phoneLive ? 'Phone camera connected' : 'Add a phone camera'}>
                  <Icon d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" className="w-6 h-6" />
                  {phone.status === 'connecting' && <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />}
                </button>
                {phoneLive && (
                  <button onClick={() => { mixer?.resumeAudio(); setPhoneMicMuted((v) => !v); }} disabled={!phoneHasMic}
                    className={`${roundButton(phoneHasMic && !phoneMicMuted)} disabled:opacity-40 disabled:cursor-not-allowed`}
                    aria-label={!phoneHasMic ? 'Phone microphone is off on the phone' : phoneMicMuted ? 'Unmute phone microphone' : 'Mute phone microphone'}
                    title={!phoneHasMic ? 'The phone isn\'t sending sound. Tap "Mic off" on the phone to turn it on.' : phoneMicMuted ? 'Unmute the phone' : 'Mute the phone (the computer microphone stays as it is)'}>
                    <Icon d={ICONS.mic} className="w-5 h-5" />
                    <span className="absolute -bottom-1 text-[9px] font-bold tracking-wide">PHONE</span>
                    {(!phoneHasMic || phoneMicMuted || sceneMicOff) && <span className="absolute w-7 h-0.5 bg-current rotate-45 rounded" />}
                    <span className="absolute -right-1 bottom-1 w-1.5 h-8 rounded-full bg-white/10 overflow-hidden flex items-end">
                      <span ref={phoneMeterRef} className={`block w-full ${!phoneHasMic || phoneMicMuted || sceneMicOff ? 'bg-white/30' : 'bg-green-400'}`} style={{ height: '0%' }} />
                    </span>
                  </button>
                )}
                <button onClick={() => setShowSettings(true)} className="w-12 h-12 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition" aria-label="Camera and microphone settings" title="Settings">
                  <Icon d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" className="w-6 h-6" />
                </button>
              </div>
            ) : null}
            {(sceneMicOff || sceneCameraOff) && (
              <p className="mt-2 text-center text-xs text-white/60">
                The "{scene.name}" scene turns the {[sceneMicOff && 'microphone', sceneCameraOff && 'camera'].filter(Boolean).join(' and ')} off. They come back on the next scene.
              </p>
            )}
            {!streamer && (
              monitorFresh && (
                <p className="mt-5 text-center text-sm text-white/60">
                  Streaming computer: camera {monitor.cameraOn ? 'on' : 'off'} · microphone {monitor.micMuted ? 'muted' : 'on'} · screen {monitor.sharing ? 'shared' : 'not shared'}{monitor.phone ? ' · phone camera connected' : ''}
                </p>
              )
            )}
            {streamer && phoneLive && phoneHasMic && !phoneMicMuted && !micMuted && !sceneMicOff && (
              <p className="mt-3 text-center text-xs text-amber-300">
                The computer microphone and the phone microphone are both on. If they&apos;re in the same room, viewers may hear an echo: mute one of them.
              </p>
            )}
            {streamer && sharing && <p className="mt-3 text-center text-xs text-white/40">Sharing a tab with a video? Tick "Also share tab audio" in the browser's share window.</p>}
          </div>
        </main>

        {/* Right panel + icon rail */}
        <div className="flex flex-col-reverse lg:flex-row border-t lg:border-t-0 lg:border-l border-white/10">
          <section className="lg:w-[340px] p-4 lg:overflow-y-auto bg-[#1f1f23]" aria-label={PANELS.find((p) => p.id === panel)?.label}>
            <h2 className="text-lg font-semibold mb-4">{PANELS.find((p) => p.id === panel)?.label}</h2>
            {/* All panels stay mounted (music keeps playing when you switch) */}
            <div className={panel === 'channels' ? '' : 'hidden'}>
              <DestinationsPanel destinations={destinations} selected={selected} onToggle={toggleSelected}
                phase={streamer ? phase : (phase === 'idle' ? 'idle' : 'live')}
                broadcast={broadcastWithResults} uid={uid} onRemove={removeDestination}
                auto={auto} stream={library?.stream} onStream={(value) => saveList('stream', value).catch((e) => console.error(e))}
                onConnect={connectPlatform} onDisconnect={disconnectPlatform} onChoosePage={choosePage} connectBusy={connectBusy} />
            </div>
            <div className={panel === 'graphics' ? '' : 'hidden'}>
              <GraphicsPanel assets={assets} active={{ logo: control.logo, overlay: control.overlay, background: control.background }}
                onToggle={(kind, id) => updateControl({ [kind]: control[kind] === id ? '' : id })}
                clip={clipForPanel} onClip={toggleClip} />
            </div>
            <div className={panel === 'captions' ? '' : 'hidden'}>
              {library && (
                <CaptionsPanel library={library} saveList={saveList}
                  activeLowerThird={control.lowerThird?.id} activeTicker={control.ticker?.id}
                  onLowerThird={(item) => updateControl({ lowerThird: control.lowerThird?.id === item.id ? null : { id: item.id, title: item.title, subtitle: item.subtitle || '', style: item.style || 'classic', frame: !!item.frame } })}
                  onTicker={(item) => updateControl({ ticker: control.ticker?.id === item.id ? null : { id: item.id, text: item.text } })}
                  tickerSpeed={control.tickerSpeed || 110} onTickerSpeed={(v) => updateControl({ tickerSpeed: v })} />
              )}
            </div>
            <div className={panel === 'chat' ? '' : 'hidden'}>
              <ChatPanel messages={chatMessages} live={phase === 'live'} errors={chatErrors}
                available={{ youtube: !!auto?.connected, facebook: !!auto?.facebookConnected }}
                shownId={control.chatShown?.id} onShow={showChat} onSend={sendChat} facebookScopes={autoInfo?.facebookScopes} />
            </div>
            <div className={panel === 'qr' ? '' : 'hidden'}>
              {library && (
                <QrPanel library={library} saveList={saveList} activeQr={control.qr?.id}
                  onQr={(item) => updateControl({ qr: control.qr?.id === item.id ? null : { id: item.id, label: item.label || '', url: item.url } })} />
              )}
            </div>
            <div className={panel === 'music' ? '' : 'hidden'}>
              {streamer
                ? <MusicPanel mixer={mixer} />
                : <p className="text-sm text-white/60">Music plays from files on the streaming computer, so it's chosen there.</p>}
            </div>
          </section>
          <nav className="flex lg:flex-col gap-1 p-2 overflow-x-auto bg-[#18181b]" aria-label="Studio panels">
            {PANELS.map((p) => (
              <button key={p.id} onClick={() => setPanel(p.id)} aria-pressed={panel === p.id}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg min-w-[64px] text-xs transition ${panel === p.id ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>
                <Icon d={p.icon} className="w-5 h-5" />
                {p.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {editingScene && (
        <SceneForm scene={editingScene} scenes={scenes} backgrounds={backgrounds} videos={videos} onSave={saveScene} onDelete={() => deleteScene(editingScene)} onClose={() => setEditingScene(null)} />
      )}
      {showGoLive && streamer && (
        <GoLiveModal channels={selectedChannels} title={library?.stream?.title} onStart={startFromModal}
          onClose={() => setShowGoLive(false)} onChannels={() => { setShowGoLive(false); setPanel('channels'); }} />
      )}
      {showPhone && streamer && <PhoneCameraModal phone={phone} onClose={() => setShowPhone(false)} />}
      {showStyle && (
        <StyleModal shape={control.cameraShape || 'rect'} cameraRadius={control.cameraRadius ?? 12} screenRadius={control.screenRadius ?? 12}
          layout={screenAvailable ? control.layout : 'camera'} placement={control.placement}
          onChange={(changes) => updateControl(changes)} onClose={() => setShowStyle(false)} />
      )}
      {showSettings && (
        <SettingsModal devices={devices} cameraId={cameraId} micId={micId} onCamera={setCameraId} onMic={setMicId}
          mirror={mirrorCamera} onMirror={changeMirror} onClose={() => setShowSettings(false)} />
      )}
      {showHelperSetup && <HelperSetupModal onClose={() => setShowHelperSetup(false)} onCheck={checkHelper} />}
    </div>
  );
};

export default LiveStudio;
