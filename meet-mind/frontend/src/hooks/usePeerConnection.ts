import { useCallback, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import type { MediaConnection } from 'peerjs';
import { signalingSocket } from '../services/socket';
import { api } from '../services/api';
import { useMeetingStore } from '../store/meetingStore';
import type { SignalingMessage } from '../types';

export function usePeerConnection() {
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, MediaConnection>>(new Map());
  const screenConnectionsRef = useRef<Map<string, MediaConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const { addParticipant, removeParticipant, updateParticipant } =
    useMeetingStore();

  const addParticipantRef = useRef(addParticipant);
  const removeParticipantRef = useRef(removeParticipant);
  const updateParticipantRef = useRef(updateParticipant);

  useEffect(() => {
    addParticipantRef.current = addParticipant;
    removeParticipantRef.current = removeParticipant;
    updateParticipantRef.current = updateParticipant;
  }, [addParticipant, removeParticipant, updateParticipant]);

  const handleIncomingCall = useCallback((call: MediaConnection) => {
    const isScreen = call.metadata?.type === 'screen';

    if (isScreen) {
      call.answer();

      call.on('stream', (remoteScreenStream) => {
        const fromId = call.metadata?.userId ?? call.peer;
        updateParticipantRef.current(fromId, {
          screenStream: remoteScreenStream,
          isScreenSharing: true,
        });
      });

      call.on('close', () => {
        const fromId = call.metadata?.userId ?? call.peer;
        updateParticipantRef.current(fromId, {
          screenStream: undefined,
          isScreenSharing: false,
        });
        screenConnectionsRef.current.delete(call.peer);
      });

      screenConnectionsRef.current.set(call.peer, call);
      return;
    }

    const stream = localStreamRef.current;
    if (!stream) return;

    call.answer(stream);

    call.on('stream', (remoteStream) => {
      const remoteId = call.metadata?.userId ?? call.peer;
      const remoteName = call.metadata?.userName ?? 'Participant';

      addParticipantRef.current({
        id: remoteId,
        name: remoteName,
        peerId: call.peer,
        stream: remoteStream,
        isMuted: false,
        isVideoOff: false,
        isSpeaking: false,
        isScreenSharing: false,
      });
    });

    call.on('close', () => {
      const remoteId = call.metadata?.userId ?? call.peer;
      removeParticipantRef.current(remoteId);
      connectionsRef.current.delete(call.peer);
    });

    connectionsRef.current.set(call.peer, call);
  }, []);

  const initPeer = useCallback(
    async (roomId: string, userId: string, userName: string, stream: MediaStream) => {
      if (peerRef.current) return;

      localStreamRef.current = stream;

      let iceServers: RTCIceServer[] = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ];

      try {
        const config = await api.getTurnConfig();
        iceServers = config.iceServers;
      } catch {
        console.warn('[Peer] Could not fetch TURN config, using STUN only');
      }

      const peer = new Peer({
        debug: 1,
        config: { iceServers },
      });

      peer.on('open', (id) => {
        signalingSocket.connect(roomId, userId);
        signalingSocket.send({
          type: 'join',
          roomId,
          peerId: id,
          userName,
        });
      });

      peer.on('call', handleIncomingCall);

      peer.on('error', (err) => {
        console.error('[Peer] Error:', err);
      });

      peerRef.current = peer;

      const unsubscribe = signalingSocket.onMessage((msg: SignalingMessage) => {
        const currentStream = localStreamRef.current;

        if (msg.type === 'peer_joined' && msg.peerId && currentStream) {
          if (connectionsRef.current.has(msg.peerId)) return;

          const call = peer.call(msg.peerId, currentStream, {
            metadata: { userId, userName },
          });

          call.on('stream', (remoteStream) => {
            addParticipantRef.current({
              id: msg.from ?? msg.peerId!,
              name: msg.userName ?? 'Participant',
              peerId: msg.peerId!,
              stream: remoteStream,
              isMuted: false,
              isVideoOff: false,
              isSpeaking: false,
              isScreenSharing: false,
            });
          });

          call.on('close', () => {
            removeParticipantRef.current(msg.from ?? msg.peerId!);
            connectionsRef.current.delete(msg.peerId!);
          });

          connectionsRef.current.set(msg.peerId!, call);

          const { screenStream, isScreenSharing } = useMeetingStore.getState();
          if (isScreenSharing && screenStream) {
            const screenCall = peer.call(msg.peerId, screenStream, {
              metadata: { userId, userName, type: 'screen' },
            });
            screenConnectionsRef.current.set(msg.peerId!, screenCall);
          }
        }

        if (msg.type === 'peer_left') {
          const targetPeerId = msg.peerId;
          if (targetPeerId) {
            connectionsRef.current.get(targetPeerId)?.close();
            connectionsRef.current.delete(targetPeerId);
            screenConnectionsRef.current.get(targetPeerId)?.close();
            screenConnectionsRef.current.delete(targetPeerId);
            removeParticipantRef.current(msg.from ?? targetPeerId);
          }
        }

        if (msg.type === 'media_state' && msg.from) {
          const state = msg.data as { isMuted?: boolean; isVideoOff?: boolean } | undefined;
          if (state) {
            updateParticipantRef.current(msg.from, {
              isMuted: state.isMuted ?? false,
              isVideoOff: state.isVideoOff ?? false,
            });
          }
        }
      });

      unsubRef.current = unsubscribe;
    },
    [handleIncomingCall],
  );

  const shareScreen = useCallback(
    (screenStream: MediaStream, userId: string, userName: string) => {
      const peer = peerRef.current;
      if (!peer) return;

      connectionsRef.current.forEach((_conn, peerId) => {
        if (screenConnectionsRef.current.has(peerId)) return;

        const call = peer.call(peerId, screenStream, {
          metadata: { userId, userName, type: 'screen' },
        });

        call.on('close', () => {
          screenConnectionsRef.current.delete(peerId);
        });

        screenConnectionsRef.current.set(peerId, call);
      });
    },
    [],
  );

  const stopScreenShare = useCallback(() => {
    screenConnectionsRef.current.forEach((conn) => conn.close());
    screenConnectionsRef.current.clear();
  }, []);

  const cleanup = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    connectionsRef.current.forEach((conn) => conn.close());
    connectionsRef.current.clear();
    screenConnectionsRef.current.forEach((conn) => conn.close());
    screenConnectionsRef.current.clear();
    peerRef.current?.destroy();
    peerRef.current = null;
    localStreamRef.current = null;
    signalingSocket.disconnect();
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return { initPeer, cleanup, shareScreen, stopScreenShare };
}
