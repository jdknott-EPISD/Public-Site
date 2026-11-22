// Phone camera for Live Studio: someone opens a link on their phone (/phone-cam/:token) and
// the phone's camera goes straight to the streaming computer over WebRTC, as a second picture.
//
// Firestore only carries the handshake, in livePhoneLinks/{token}:
//   uid        the member who made the link (any member can change or delete it)
//   offer      { id, sdp, at }    written by the phone; a new id each time it (re)connects
//   answer     { id, sdp }        written by the streaming computer for that offer id
//   phone      { facing, mic, at } what the phone is sending, for the studio's status line
//   kick       time the studio disconnected the phone (the phone stops when it sees a new one)
// The token is the secret: 40 random characters, never listed. A new link deletes the old doc.
// Both sides wait for all their network candidates before writing (no trickle ICE), so a
// connection is one offer and one answer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const OFFER_FRESH_MS = 2 * 60 * 1000;

export const phoneLinkDoc = (token) => doc(db, 'livePhoneLinks', token);
export const phoneLinkUrl = (token) => `${window.location.origin}/phone-cam/${token}`;

export const randomToken = (length = 40) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
};

// Resolves once the connection has gathered its network candidates (or after a few seconds)
export const waitForIce = (pc, ms = 4000) => new Promise((resolve) => {
  if (pc.iceGatheringState === 'complete') { resolve(); return; }
  const done = () => { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(timer); resolve(); };
  const check = () => { if (pc.iceGatheringState === 'complete') done(); };
  const timer = setTimeout(done, ms);
  pc.addEventListener('icegatheringstatechange', check);
});

const linkKey = (uid) => `kaStudioPhoneLink:${uid}`;
const readToken = (uid) => { try { return localStorage.getItem(linkKey(uid)) || ''; } catch { return ''; } };
const saveToken = (uid, token) => { try { if (token) localStorage.setItem(linkKey(uid), token); else localStorage.removeItem(linkKey(uid)); } catch { /* this visit only */ } };

// Streaming computer side. Returns the link, the phone's picture (a MediaStream) once it's
// connected, and what the phone says it's sending.
//   status: 'off' (no link yet) | 'waiting' (link made, no phone) | 'connecting' | 'connected'
export const usePhoneCamera = (uid, enabled) => {
  const [token, setToken] = useState(() => (uid ? readToken(uid) : ''));
  const [status, setStatus] = useState('off');
  const [stream, setStream] = useState(null);
  const [phoneInfo, setPhoneInfo] = useState(null);
  const [error, setError] = useState('');
  const pcRef = useRef(null);
  const answeredRef = useRef('');

  useEffect(() => { if (uid) setToken(readToken(uid)); }, [uid]);

  const closePeer = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    setStream(null);
  }, []);

  // Answer each new offer from the phone
  useEffect(() => {
    if (!enabled || !uid || !token) { closePeer(); setStatus('off'); return undefined; }
    setStatus((s) => (s === 'off' ? 'waiting' : s));
    let stopped = false;

    const answer = async (offer) => {
      closePeer();
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      setStatus('connecting');
      pc.ontrack = (e) => {
        if (pcRef.current !== pc) return;
        setStream(e.streams[0] || new MediaStream([e.track]));
      };
      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc) return;
        const s = pc.connectionState;
        if (s === 'connected') setStatus('connected');
        else if (s === 'failed' || s === 'closed') { setStream(null); setStatus('waiting'); }
        else if (s === 'disconnected') setStatus('connecting');
      };
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await waitForIce(pc);
        if (stopped || pcRef.current !== pc) return;
        await setDoc(phoneLinkDoc(token), { answer: { id: offer.id, sdp: pc.localDescription.sdp } }, { merge: true });
      } catch (e) {
        console.error('Phone camera answer failed:', e);
        if (pcRef.current === pc) { closePeer(); setStatus('waiting'); }
      }
    };

    const unsub = onSnapshot(phoneLinkDoc(token), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setPhoneInfo(data.phone || null);
      const offer = data.offer;
      if (offer?.id && offer.sdp && offer.id !== answeredRef.current && Date.now() - (offer.at || 0) < OFFER_FRESH_MS) {
        answeredRef.current = offer.id;
        answer(offer);
      }
    }, (e) => {
      console.error('Phone camera link error:', e);
      setError('The phone camera link could not be read. Make a new link.');
    });
    return () => { stopped = true; unsub(); closePeer(); };
  }, [enabled, uid, token, closePeer]);

  // Make the link the first time it's needed
  const ensureLink = useCallback(async () => {
    if (!uid) return '';
    if (token) return token;
    const t = randomToken();
    setError('');
    await setDoc(phoneLinkDoc(t), { uid, createdAt: Date.now() });
    saveToken(uid, t);
    setToken(t);
    return t;
  }, [uid, token]);

  // Turn the old link off and make another
  const newLink = useCallback(async () => {
    const old = token;
    closePeer();
    const t = randomToken();
    setError('');
    await setDoc(phoneLinkDoc(t), { uid, createdAt: Date.now() });
    saveToken(uid, t);
    setToken(t);
    if (old) deleteDoc(phoneLinkDoc(old)).catch(() => {});
    return t;
  }, [uid, token, closePeer]);

  // Stop the phone that's connected now (the link keeps working)
  const disconnect = useCallback(() => {
    closePeer();
    setStatus('waiting');
    if (token) setDoc(phoneLinkDoc(token), { kick: Date.now() }, { merge: true }).catch(() => {});
  }, [token, closePeer]);

  return { token, link: token ? phoneLinkUrl(token) : '', status, stream: status === 'connected' ? stream : null, phoneInfo, error, ensureLink, newLink, disconnect };
};
