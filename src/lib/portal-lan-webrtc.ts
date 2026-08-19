import { relayWS } from '@/lib/relay-ws';

export type PortalLanPath = 'direct' | 'relay' | 'checking';
export interface PortalLanConnection {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  close: () => void;
}

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const turnUrl = String(import.meta.env.VITE_PORTAL_TURN_URL || '').trim();
  const turnUsername = String(import.meta.env.VITE_PORTAL_TURN_USERNAME || '').trim();
  const turnCredential = String(import.meta.env.VITE_PORTAL_TURN_CREDENTIAL || '').trim();
  if (turnUrl && turnUsername && turnCredential) servers.push({ urls: turnUrl, username: turnUsername, credential: turnCredential });
  return servers;
}

function pathOf(pc: RTCPeerConnection): PortalLanPath {
  const candidate = pc.currentLocalDescription?.sdp || '';
  if (candidate.includes(' typ relay ')) return 'relay';
  if (pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'new') return 'checking';
  return 'direct';
}

export async function connectPortalLan(myUuid: string, peerUuid: string, onPath: (path: PortalLanPath) => void, signal?: AbortSignal): Promise<PortalLanConnection> {
  if (!myUuid || !peerUuid) throw new Error('Нужен Millida ID друга');
  if (signal?.aborted) throw new DOMException('Portal LAN connection cancelled', 'AbortError');
  const pc = new RTCPeerConnection({ iceServers: iceServers(), iceCandidatePoolSize: 4 });
  const channel = pc.createDataChannel('portal-lan-control', { ordered: true });
  let unsubscribe = () => {};
  const abortHandler = () => { unsubscribe(); pc.close(); };
  signal?.addEventListener('abort', abortHandler, { once: true });
  unsubscribe = relayWS.subscribe(async msg => {
    if (msg.toId !== myUuid || msg.fromId !== peerUuid) return;
    if (msg.type === 'portal_lan_answer' && typeof msg.sdp === 'string' && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).catch(() => {});
    }
    if (msg.type === 'portal_lan_ice' && typeof msg.candidate === 'string') {
      await pc.addIceCandidate({ candidate: msg.candidate, sdpMid: typeof msg.sdpMid === 'string' ? msg.sdpMid : null, sdpMLineIndex: typeof msg.sdpMLineIndex === 'number' ? msg.sdpMLineIndex : null }).catch(() => {});
    }
    if (msg.type === 'portal_lan_close') pc.close();
  });
  pc.onicecandidate = event => {
    if (!event.candidate) return;
    relayWS.send({ type: 'portal_lan_ice', toId: peerUuid, candidate: event.candidate.candidate, sdpMid: event.candidate.sdpMid, sdpMLineIndex: event.candidate.sdpMLineIndex });
  };
  pc.oniceconnectionstatechange = () => onPath(pathOf(pc));
  pc.onconnectionstatechange = () => onPath(pathOf(pc));
  channel.onopen = () => onPath(pathOf(pc));
  const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
  await pc.setLocalDescription(offer);
  if (signal?.aborted || pc.signalingState === 'closed') throw new DOMException('Portal LAN connection cancelled', 'AbortError');
  relayWS.send({ type: 'portal_lan_offer', toId: peerUuid, sdp: offer.sdp });
  onPath('checking');
  return { pc, channel, close: () => { signal?.removeEventListener('abort', abortHandler); unsubscribe(); relayWS.send({ type: 'portal_lan_close', toId: peerUuid }); pc.close(); } };
}

export function acceptPortalLanOffer(myUuid: string, peerUuid: string, sdp: string, onPath: (path: PortalLanPath) => void, onReady: (connection: PortalLanConnection) => void, signal?: AbortSignal) {
  const pc = new RTCPeerConnection({ iceServers: iceServers(), iceCandidatePoolSize: 4 });
  let channel: RTCDataChannel | null = null;
  let closed = false;
  const unsubscribe = relayWS.subscribe(async msg => {
    if (closed || msg.toId !== myUuid || msg.fromId !== peerUuid) return;
    if (msg.type === 'portal_lan_ice' && typeof msg.candidate === 'string') {
      await pc.addIceCandidate({ candidate: msg.candidate, sdpMid: typeof msg.sdpMid === 'string' ? msg.sdpMid : null, sdpMLineIndex: typeof msg.sdpMLineIndex === 'number' ? msg.sdpMLineIndex : null }).catch(() => {});
    }
    if (msg.type === 'portal_lan_close') close();
  });
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (pc.signalingState !== 'closed') pc.close();
  };
  const abortHandler = () => close();
  signal?.addEventListener('abort', abortHandler, { once: true });
  const removeAbort = () => signal?.removeEventListener('abort', abortHandler);
  pc.ondatachannel = event => {
    channel = event.channel;
    channel.onopen = () => { if (closed) return; onPath(pathOf(pc)); onReady({ pc, channel: channel!, close: () => { removeAbort(); close(); } }); };
  };
  pc.onicecandidate = event => {
    if (!event.candidate) return;
    relayWS.send({ type: 'portal_lan_ice', toId: peerUuid, candidate: event.candidate.candidate, sdpMid: event.candidate.sdpMid, sdpMLineIndex: event.candidate.sdpMLineIndex });
  };
  pc.oniceconnectionstatechange = () => onPath(pathOf(pc));
  void pc.setRemoteDescription({ type: 'offer', sdp }).then(async () => {
    if (signal?.aborted) throw new DOMException('Portal LAN connection cancelled', 'AbortError');
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (signal?.aborted || closed) throw new DOMException('Portal LAN connection cancelled', 'AbortError');
    relayWS.send({ type: 'portal_lan_answer', toId: peerUuid, sdp: answer.sdp });
    onPath('checking');
  }).catch(() => { removeAbort(); close(); });
}
