// Live Studio's Phone camera window: a QR code and link to open on a phone, and the connection status.
import { useEffect, useState } from 'react';
import { Modal, qrDataUrl } from './StudioPanels';

const STATUS = {
  off: ['bg-white/40', 'Making the link…'],
  waiting: ['bg-amber-400', 'Waiting for the phone'],
  connecting: ['bg-amber-400 animate-pulse', 'Phone found, connecting…'],
  connected: ['bg-green-400', 'Phone connected']
};

const PhoneCameraModal = ({ phone, onClose }) => {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    phone.ensureLink().catch((e) => { console.error(e); setError('The link could not be made. Check your connection and try again.'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!phone.link) { setQr(''); return undefined; }
    qrDataUrl(phone.link).then((url) => { if (!cancelled) setQr(url); });
    return () => { cancelled = true; };
  }, [phone.link]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phone.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setError('Copy did not work: select the link and copy it.'); }
  };

  const remake = async () => {
    if (!window.confirm('Make a new link? The old link (and any phone using it) stops working.')) return;
    setBusy(true);
    try { await phone.newLink(); } catch (e) { console.error(e); setError('The new link could not be made.'); }
    setBusy(false);
  };

  const [dot, label] = STATUS[phone.status] || STATUS.off;
  const info = phone.status === 'connected' && phone.phoneInfo
    ? ` · ${phone.phoneInfo.facing === 'user' ? 'front' : 'back'} camera · mic ${phone.phoneInfo.mic ? 'on' : 'off'}`
    : '';

  return (
    <Modal title="Phone camera" onClose={onClose} onSubmit={onClose} submitLabel="Done" error={error || phone.error}>
      <p className="text-sm text-white/70">
        Scan this with your phone&apos;s camera (or send yourself the link). Tap <strong>Start camera</strong> on the phone,
        and it shows up here as a second picture, next to or in place of a shared screen.
      </p>
      <div className="flex justify-center">
        {qr ? <img src={qr} alt="QR code for the phone camera link" className="w-52 h-52 rounded-lg bg-white p-2" /> : <div className="w-52 h-52 rounded-lg bg-white/5" />}
      </div>
      {phone.link && (
        <div className="flex gap-2">
          <input readOnly value={phone.link} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-xs text-white/80" />
          <button type="button" onClick={copy} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium">{copied ? 'Copied' : 'Copy'}</button>
        </div>
      )}
      <p className="flex items-center gap-2 text-sm">
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} /> {label}{info}
      </p>
      <p className="text-xs text-white/50">
        Keep the phone on that page with the screen on. Anyone with this link can send a picture to your studio, so only share it with people you trust.
        If the phone won&apos;t connect, try putting the phone and this computer on the same Wi-Fi network.
      </p>
      <div className="flex flex-wrap gap-2">
        {phone.status === 'connected' && (
          <button type="button" onClick={phone.disconnect} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm">Disconnect phone</button>
        )}
        <button type="button" onClick={remake} disabled={busy} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm disabled:opacity-50">New link</button>
      </div>
    </Modal>
  );
};

export default PhoneCameraModal;
