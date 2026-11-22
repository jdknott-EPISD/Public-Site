// Phone camera page: /phone-cam/:token (no sign-in; the token in the link is the key).
// Sends this phone's camera (and, if turned on, its microphone) to the teacher's Live Studio
// over WebRTC. See utils/phoneCamera.js for the handshake.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { onSnapshot, setDoc } from 'firebase/firestore';
import { ICE_SERVERS, phoneLinkDoc, randomToken, waitForIce } from '../../utils/phoneCamera';

const CONNECT_TIMEOUT_MS = 25000;
const DROP_GRACE_MS = 6000;

const PhoneCameraPage = () => {
  const { token } = useParams();
  const [link, setLink] = useState(undefined); // undefined = loading, null = turned off
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | starting | connecting | connected | retrying
  const [facing, setFacing] = useState('environment');
  const [mic, setMic] = useState(false);
  const [error, setError] = useState('');
  const [kicked, setKicked] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const pcRef = useRef(null);
  const offerIdRef = useRef('');
  const timersRef = useRef({});
  const startedAtRef = useRef(0);
  const runningRef = useRef(false);
  const wakeRef = useRef(null);
  const connectRef = useRef(null);

  const clearTimers = () => {
    Object.values(timersRef.current).forEach(clearTimeout);
    timersRef.current = {};
  };

  const getMedia = useCallback(async (face, withMic) => {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: face }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: withMic ? { echoCancellation: true, noiseSuppression: true } : false
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = s;
    if (videoRef.current) {
      videoRef.current.srcObject = s;
      videoRef.current.play().catch(() => {});
    }
    return s;
  }, []);

  const closePeer = () => {
    pcRef.current?.close();
    pcRef.current = null;
  };

  // Send a fresh offer; the studio answers it
  const connect = useCallback(async () => {
    if (!runningRef.current || !streamRef.current) return;
    clearTimers();
    closePeer();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    streamRef.current.getTracks().forEach((t) => pc.addTrack(t, streamRef.current));
    setStatus((s) => (s === 'connected' ? 'retrying' : 'connecting'));

    const retry = (ms) => {
      clearTimeout(timersRef.current.retry);
      timersRef.current.retry = setTimeout(() => { if (pcRef.current === pc) connectRef.current?.(); }, ms);
    };
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      const s = pc.connectionState;
      if (s === 'connected') {
        clearTimeout(timersRef.current.retry);
        setStatus('connected');
        // A clearer picture than the browser's cautious default
        pc.getSenders().filter((x) => x.track?.kind === 'video').forEach((sender) => {
          const p = sender.getParameters();
          if (!p.encodings?.length) p.encodings = [{}];
          p.encodings[0].maxBitrate = 2500000;
          sender.setParameters(p).catch(() => {});
        });
      } else if (s === 'disconnected') {
        setStatus('retrying');
        retry(DROP_GRACE_MS);
      } else if (s === 'failed') {
        setStatus('retrying');
        retry(1500);
      }
    };
    retry(CONNECT_TIMEOUT_MS);

    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc);
      if (pcRef.current !== pc) return;
      const id = randomToken(12);
      offerIdRef.current = id;
      await setDoc(phoneLinkDoc(token), {
        offer: { id, sdp: pc.localDescription.sdp, at: Date.now() },
        phone: { facing, mic, at: Date.now() }
      }, { merge: true });
    } catch (e) {
      console.error('Phone camera offer failed:', e);
      if (pcRef.current === pc) {
        setError('Could not reach the studio. Trying again…');
        retry(5000);
      }
    }
  }, [token, facing, mic]);
  connectRef.current = connect;

  // The link, the studio's answer, and the studio's Disconnect
  useEffect(() => {
    if (!token) { setLink(null); return undefined; }
    return onSnapshot(phoneLinkDoc(token), (snap) => {
      if (!snap.exists()) { setLink(null); return; }
      const data = snap.data();
      setLink(data);
      const pc = pcRef.current;
      if (pc && data.answer?.id && data.answer.id === offerIdRef.current && pc.signalingState === 'have-local-offer') {
        pc.setRemoteDescription({ type: 'answer', sdp: data.answer.sdp }).catch((e) => console.error('Answer failed:', e));
      }
      if (data.kick && data.kick > startedAtRef.current && runningRef.current) {
        setKicked(true);
        stopRef.current?.();
      }
    }, () => setLink(null));
  }, [token]);

  // Keep the screen on while sending
  const keepAwake = async () => {
    try { wakeRef.current = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
  };
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible' && runningRef.current) keepAwake(); };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, []);

  const start = async () => {
    setError('');
    setKicked(false);
    setStatus('starting');
    try {
      await getMedia(facing, mic);
    } catch (e) {
      console.error('Camera error:', e);
      setStatus('idle');
      setError('The camera could not start. Allow camera access for this site in your phone\'s browser settings, then try again.');
      return;
    }
    startedAtRef.current = Date.now();
    runningRef.current = true;
    setRunning(true);
    keepAwake();
  };

  const stop = useCallback(() => {
    runningRef.current = false;
    clearTimers();
    closePeer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    wakeRef.current?.release?.().catch(() => {});
    wakeRef.current = null;
    setRunning(false);
    setStatus('idle');
  }, []);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // Connect once running; reconnect when the microphone is turned on or off
  useEffect(() => {
    if (running) connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, mic]);

  useEffect(() => () => stopRef.current?.(), []);

  // Front/back: swap the picture without reconnecting
  const flip = async () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    if (!runningRef.current) return;
    try {
      const s = await getMedia(next, mic);
      const track = s.getVideoTracks()[0];
      const audio = s.getAudioTracks()[0];
      const senders = pcRef.current?.getSenders() || [];
      await Promise.all(senders.map((sender) => {
        if (sender.track?.kind === 'video' || (!sender.track && track)) return sender.replaceTrack(track);
        if (sender.track?.kind === 'audio' && audio) return sender.replaceTrack(audio);
        return null;
      }));
      setDoc(phoneLinkDoc(token), { phone: { facing: next, mic, at: Date.now() } }, { merge: true }).catch(() => {});
    } catch (e) {
      console.error('Flip failed:', e);
      setError('Could not switch cameras.');
    }
  };

  const toggleMic = async () => {
    const next = !mic;
    if (runningRef.current) {
      try { await getMedia(facing, next); } catch { setError('The microphone could not start.'); return; }
    }
    setMic(next);
  };

  const statusText = {
    idle: '', starting: 'Starting the camera…', connecting: 'Connecting to Live Studio…',
    connected: 'Connected: this camera is in Live Studio', retrying: 'Reconnecting…'
  }[status];

  if (link === undefined) {
    return <div className="min-h-screen bg-[#18181b] text-white flex items-center justify-center">Loading…</div>;
  }
  if (link === null) {
    return (
      <div className="min-h-screen bg-[#18181b] text-white flex flex-col items-center justify-center p-6 text-center gap-3">
        <h1 className="text-xl font-semibold">This phone camera link is turned off</h1>
        <p className="text-white/60">Open Live Studio and scan the new QR code under Phone camera.</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="relative flex-1 min-h-0">
        <video ref={videoRef} muted playsInline autoPlay className={`absolute inset-0 w-full h-full object-contain ${facing === 'user' ? '-scale-x-100' : ''}`} />
        {!running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center gap-4">
            <img src="/images/logo.png" alt="" className="w-16 h-16 object-contain bg-white rounded-xl p-1" />
            <h1 className="text-2xl font-semibold">Phone camera for Live Studio</h1>
            <p className="text-white/70 max-w-sm">
              {kicked ? 'The studio disconnected this phone.' : 'This phone\'s camera will show up in Live Studio on the streaming computer.'}
              {' '}Turn the phone sideways for a wide picture.
            </p>
            <button onClick={start} className="px-8 py-3 rounded-full bg-red-600 font-semibold text-lg">Start camera</button>
          </div>
        )}
        {running && (
          <span className={`absolute top-3 left-3 right-3 sm:right-auto px-3 py-1.5 rounded-full text-sm font-medium text-center ${status === 'connected' ? 'bg-green-600/90' : 'bg-black/60'}`}
            style={{ marginTop: 'env(safe-area-inset-top)' }}>
            {statusText}
          </span>
        )}
      </div>
      {error && <p className="px-4 py-2 text-sm text-red-300 bg-red-900/40">{error}</p>}
      {running && (
        <div className="flex items-center justify-center gap-3 p-3 bg-[#18181b]">
          <button onClick={flip} className="px-4 py-3 rounded-full bg-white/10 font-medium">{facing === 'environment' ? 'Use front camera' : 'Use back camera'}</button>
          <button onClick={toggleMic} className={`px-4 py-3 rounded-full font-medium ${mic ? 'bg-church-blue' : 'bg-white/10'}`}>{mic ? 'Mic on' : 'Mic off'}</button>
          <button onClick={stop} className="px-4 py-3 rounded-full bg-white text-black font-semibold">Stop</button>
        </div>
      )}
    </div>
  );
};

export default PhoneCameraPage;
