"use client";

import { CloseIcon } from "@/components/CloseIcon";
import { NoAgentNotification } from "@/components/NoAgentNotification";
import TranscriptionView from "@/components/TranscriptionView";
import {
  BarVisualizer,
  RoomAudioRenderer,
  RoomContext,
  VideoTrack,
  VoiceAssistantControlBar,
  useVoiceAssistant,
} from "@livekit/components-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  LocalTrack,
  TrackPublication,
  createLocalAudioTrack,
  createLocalScreenTracks,
  createLocalVideoTrack,
} from "livekit-client";
import { Room, RoomEvent } from "livekit-client";
import { useCallback, useContext, useEffect, useState } from "react";
import type { ConnectionDetails } from "./api/connection-details/route";

// Types for the RPC calls
interface HelloWorldRequest {
  name?: string;
}

interface HelloWorldResponse {
  success: boolean;
  message: string;
  timestamp?: number; // Unix timestamp in milliseconds
}

interface InteractionRequest {
  event: string;
  data: Record<string, unknown>;
}

interface InteractionResponse {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

interface ChatEditRequest {
  edits: Array<{
    id: string;
    content?: string;
    delete?: boolean;
  }>;
}

interface RpcLogEntry {
  id: string;
  timestamp: number;
  event: string;
  data: Record<string, unknown>;
}

// RPC Client for agent communication
class AgentRPCClient {
  private room: Room;

  constructor(room: Room) {
    this.room = room;
  }

  async callHelloWorld(name?: string): Promise<HelloWorldResponse> {
    try {
      const agentParticipant = Array.from(this.room.remoteParticipants.values()).find(
        (p) => p.identity.includes("voice_assistant") || p.identity.includes("agent")
      );

      if (!agentParticipant) {
        throw new Error("Agent participant not found");
      }

      const requestData: HelloWorldRequest = {};
      if (name) {
        requestData.name = name;
      }

      const response = await this.room.localParticipant.performRpc({
        destinationIdentity: agentParticipant.identity,
        method: "agent.hello",
        payload: JSON.stringify(requestData),
        responseTimeout: 30000,
      });

      const result: HelloWorldResponse = JSON.parse(response);
      console.log("[RPC] agent.hello response:", result);
      return result;
    } catch (error) {
      console.error("Error calling hello world RPC:", error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  async callInteraction(
    event: string,
    data: Record<string, unknown>
  ): Promise<InteractionResponse> {
    try {
      const agentParticipant = Array.from(this.room.remoteParticipants.values()).find(
        (p) => p.identity.includes("voice_assistant") || p.identity.includes("agent")
      );

      if (!agentParticipant) {
        throw new Error("Agent participant not found");
      }

      const requestData: InteractionRequest = { event, data };

      const response = await this.room.localParticipant.performRpc({
        destinationIdentity: agentParticipant.identity,
        method: "agent.interaction",
        payload: JSON.stringify(requestData),
        responseTimeout: 30000,
      });

      const result: InteractionResponse = JSON.parse(response);
      console.log("[RPC] agent.interaction response:", result);
      return result;
    } catch (error) {
      console.error("Error calling interaction RPC:", error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  async callClose(callId: string): Promise<InteractionResponse> {
    try {
      const agentParticipant = Array.from(this.room.remoteParticipants.values()).find(
        (p) => p.identity.includes("voice_assistant") || p.identity.includes("agent")
      );

      if (!agentParticipant) {
        throw new Error("Agent participant not found");
      }

      const response = await this.room.localParticipant.performRpc({
        destinationIdentity: agentParticipant.identity,
        method: "agent.close",
        payload: JSON.stringify({ call_id: callId }),
        responseTimeout: 30000,
      });

      const result: InteractionResponse = JSON.parse(response);
      console.log("[RPC] agent.close response:", result);
      return result;
    } catch (error) {
      console.error("Error calling close RPC:", error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  async callPing(message?: string): Promise<InteractionResponse> {
    try {
      const agentParticipant = Array.from(this.room.remoteParticipants.values()).find(
        (p) => p.identity.includes("voice_assistant") || p.identity.includes("agent")
      );
      if (!agentParticipant) {
        throw new Error("Agent participant not found");
      }
      const payload = message ? { message } : {};

      // Try primary ping method first
      const response = await this.room.localParticipant.performRpc({
        destinationIdentity: agentParticipant.identity,
        method: "agent.ping",
        payload: JSON.stringify(payload),
        responseTimeout: 30000,
      });
      const result = JSON.parse(response);
      console.log("[RPC] agent.ping response:", result);
      return result;
    } catch (error) {
      // If ping is not supported, gracefully fall back to agent.hello
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.toLowerCase().includes("not supported")) {
        try {
          const helloRes = await this.callHelloWorld(message ?? "frontend");
          console.log("[RPC] agent.ping fallback (agent.hello) response:", helloRes);
          return helloRes as unknown as InteractionResponse;
        } catch {
          /* ignore */
        }
      }
      console.error("Error calling ping RPC:", error);
      return {
        success: false,
        message: `Error: ${errMsg}`,
      } as InteractionResponse;
    }
  }

  async callClick(data: Record<string, unknown>): Promise<InteractionResponse> {
    return this.genericCall("agent.click", data);
  }

  async callScreenChange(data: Record<string, unknown>): Promise<InteractionResponse> {
    return this.genericCall("agent.screenChange", data);
  }

  async callTranscription(data: Record<string, unknown>): Promise<InteractionResponse> {
    return this.genericCall("agent.transcription", data);
  }

  async callMoveToNextTask(
    taskId: string | number | undefined,
    reason?: string
  ): Promise<InteractionResponse> {
    return this.genericCall("agent.moveToTask", { task_id: taskId, reason });
  }

  async callEndTask(
    taskId: string | number,
    reason?: string,
    markCompleted = true
  ): Promise<InteractionResponse> {
    return this.genericCall("agent.endTask", {
      task_id: taskId,
      reason,
      mark_completed: markCompleted,
    });
  }

  async callEditChatContext(edits: Array<{id: string; content?: string; delete?: boolean}>): Promise<InteractionResponse> {
    return this.genericCall("agent.editChatContext", { edits });
  }

  async callPauseSession(reason?: string): Promise<InteractionResponse> {
    return this.genericCall("agent.pauseSession", { reason });
  }

  async callResumeSession(reason?: string): Promise<InteractionResponse> {
    return this.genericCall("agent.resumeSession", { reason });
  }

  private async genericCall(
    method: string,
    data: Record<string, unknown>
  ): Promise<InteractionResponse> {
    try {
      const agentParticipant = Array.from(this.room.remoteParticipants.values()).find(
        (p) => p.identity.includes("voice_assistant") || p.identity.includes("agent")
      );
      if (!agentParticipant) {
        throw new Error("Agent participant not found");
      }
      const response = await this.room.localParticipant.performRpc({
        destinationIdentity: agentParticipant.identity,
        method,
        payload: JSON.stringify(data ?? {}),
        responseTimeout: 30000,
      });
      const result = JSON.parse(response);
      console.log(`[RPC] ${method} response:`, result);
      return result;
    } catch (error) {
      console.error(`Error calling ${method} RPC:`, error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      } as InteractionResponse;
    }
  }
}

type PermissionSettings = {
  audio: boolean;
  video: boolean;
  screen: boolean;
};

type RoomSession = {
  roomName: string;
  serverUrl: string;
  participantToken: string;
  permissions: PermissionSettings;
  timestamp: number;
};

// Helper to gracefully leave the room and stop local media (no room deletion)
async function gracefulDisconnectAndShutdown(room: Room) {
  try {
    // If we are not connected there is nothing to do
    if (room.state !== "connected") {
      console.log("⚠️  gracefulDisconnectAndShutdown called while room is not connected");
      return;
    }

    // 1️⃣ Unpublish & stop every local track (audio / video / screenshare)
    const publicationMap: Map<string, TrackPublication> =
      (
        room.localParticipant as unknown as {
          trackPublications?: Map<string, TrackPublication>;
          tracks?: Map<string, TrackPublication>;
        }
      ).trackPublications ??
      (
        room.localParticipant as unknown as {
          tracks?: Map<string, TrackPublication>;
        }
      ).tracks ??
      new Map<string, TrackPublication>();

    for (const publication of Array.from(publicationMap.values())) {
      const track = publication.track;
      if (track) {
        try {
          // Cast to expected type for unpublishTrack signature
          room.localParticipant.unpublishTrack(track as unknown as MediaStreamTrack);
          track.stop();
        } catch (trackErr) {
          console.error("❌ Error cleaning up local track", trackErr);
        }
      }
    }

    // 2️⃣ Disconnect from the room
    await room.disconnect();
    console.log("✅ Graceful disconnect completed (room kept alive for restart)");
  } catch (err) {
    console.error("❌ gracefulDisconnectAndShutdown failed:", err);
  }
}

export default function Page() {
  const [room] = useState(new Room());
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionSettings | null>(null);
  const [rpcLogs, setRpcLogs] = useState<RpcLogEntry[]>([]);
  const [shouldAutoDisconnect, setShouldAutoDisconnect] = useState(false);
  const [availableRestart, setAvailableRestart] = useState<RoomSession | null>(null);

  // Save room session to localStorage for restart
  const saveRoomSession = useCallback((roomName: string, serverUrl: string, participantToken: string, permissions: PermissionSettings) => {
    const session: RoomSession = {
      roomName,
      serverUrl,
      participantToken,
      permissions,
      timestamp: Date.now()
    };
    localStorage.setItem('lastRoomSession', JSON.stringify(session));
    console.log('💾 Room session saved for restart:', roomName);
  }, []);

  // Check for available restart session
  const checkRestartSession = useCallback(() => {
    try {
      const saved = localStorage.getItem('lastRoomSession');
      if (!saved) return null;
      
      const session: RoomSession = JSON.parse(saved);
      const ageMinutes = (Date.now() - session.timestamp) / (1000 * 60);
      
      if (ageMinutes <= 5) {
        console.log(`🔄 Found restart session (${ageMinutes.toFixed(1)} min old):`, session.roomName);
        return session;
      } else {
        console.log(`⏰ Restart session too old (${ageMinutes.toFixed(1)} min), removing`);
        localStorage.removeItem('lastRoomSession');
        return null;
      }
    } catch (error) {
      console.error('❌ Error checking restart session:', error);
      localStorage.removeItem('lastRoomSession');
      return null;
    }
  }, []);

  // Clear restart session
  const clearRestartSession = useCallback(() => {
    localStorage.removeItem('lastRoomSession');
    setAvailableRestart(null);
    console.log('🗑️ Restart session cleared');
  }, []);

  const addRpcLog = useCallback((event: string, data: Record<string, unknown>) => {
    const currentTimeMs = Date.now();
    const logEntry = {
      id: Math.random().toString(36),
      timestamp: currentTimeMs,
      event,
      data,
    };
    console.log(
      "🕒 Adding RPC log with timestamp (ms):",
      currentTimeMs,
      "ISO:",
      new Date(currentTimeMs).toISOString(),
      "Display:",
      new Date(currentTimeMs).toLocaleTimeString()
    );
    setRpcLogs((prev) => [logEntry, ...prev.slice(0, 49)]); // Keep last 50 logs

    // Check for session_shutdown event
    console.log(`🔍 Checking event type: "${event}" for session_shutdown`);
    if (event === "session_shutdown") {
      console.log("🔥 SESSION SHUTDOWN RPC RECEIVED - Auto disconnect will trigger");
      setShouldAutoDisconnect(true);
    }
  }, []);

  // Auto disconnect when session_shutdown is received
  useEffect(() => {
    if (shouldAutoDisconnect && room.state === "connected") {
      console.log("🚨 Auto disconnecting due to session shutdown...");
      const autoDisconnect = async () => {
        try {
          await gracefulDisconnectAndShutdown(room);
          console.log("✅ Auto disconnect completed");
        } catch (error) {
          console.error("❌ Auto disconnect failed:", error);
        }
        setShouldAutoDisconnect(false);
      };
      autoDisconnect();
    }
  }, [shouldAutoDisconnect, room]);

  // Check for available restart on component mount
  useEffect(() => {
    const restartSession = checkRestartSession();
    if (restartSession) {
      setAvailableRestart(restartSession);
    }
  }, [checkRestartSession]);

  const onPermissionSelected = useCallback((permissions: PermissionSettings) => {
    setSelectedPermissions(permissions);
    // Clear any restart session when selecting new permissions
    clearRestartSession();
  }, [clearRestartSession]);

  // Restart with previous session
  const onRestartButtonClicked = useCallback(async () => {
    if (!availableRestart) {
      console.error("No restart session available");
      return;
    }

    try {
      console.log("🔄 Restarting with previous session:", availableRestart.roomName);
      
      // Set permissions from saved session
      setSelectedPermissions(availableRestart.permissions);

      // Create local tracks based on saved permissions
      const localTracks: LocalTrack[] = [];

      if (availableRestart.permissions.audio) {
        try {
          const audioTrack = await createLocalAudioTrack();
          localTracks.push(audioTrack);
        } catch (micError) {
          console.error("❌ Microphone access denied:", micError);
          alert("Microphone access denied. Please grant microphone permission and try again.");
          return;
        }
      }

      if (availableRestart.permissions.video) {
        try {
          const videoTrack = await createLocalVideoTrack();
          localTracks.push(videoTrack);
        } catch (cameraError) {
          console.error("❌ Camera access denied:", cameraError);
          alert("Camera access denied or failed. The session will continue without video.");
        }
      }

      if (availableRestart.permissions.screen) {
        try {
          const screenTracks = await createLocalScreenTracks();
          localTracks.push(...screenTracks);
        } catch (screenError) {
          console.error("❌ Screen share access denied:", screenError);
          alert("Screen share access denied or failed. The session will continue without screen sharing.");
        }
      }

      // Connect to the same room
      console.log("🔌 Reconnecting to previous room...");
      await room.connect(availableRestart.serverUrl, availableRestart.participantToken);
      console.log("✅ Reconnected to room");

      // Publish all tracks
      for (const track of localTracks) {
        try {
          await room.localParticipant.publishTrack(track);
          console.log(`✅ Published ${track.kind} track`);
        } catch (publishError) {
          console.error(`❌ Failed to publish ${track.kind} track:`, publishError);
        }
      }

      // Update the timestamp for this session
      saveRoomSession(availableRestart.roomName, availableRestart.serverUrl, availableRestart.participantToken, availableRestart.permissions);
      
      console.log("🎉 Successfully restarted session!");
    } catch (error) {
      console.error("❌ Restart failed:", error);
      alert("Failed to restart the session. Please start a new session.");
      clearRestartSession();
    }
  }, [room, availableRestart, saveRoomSession, clearRestartSession]);

  const onConnectButtonClicked = useCallback(async () => {
    if (!selectedPermissions) {
      console.error("No permissions selected");
      return;
    }

    try {
      console.log("🚀 Starting connection with permissions:", selectedPermissions);

      // FIRST: Create local tracks (this will request browser permissions)
      console.log("🔧 Creating local tracks and requesting permissions...");
      const localTracks: LocalTrack[] = [];

      if (selectedPermissions.audio) {
        try {
          console.log("🎤 Creating audio track and requesting microphone permission...");
          const audioTrack = await createLocalAudioTrack();
          localTracks.push(audioTrack);
          console.log("✅ Audio track created successfully");
        } catch (micError) {
          console.error("❌ Microphone access denied:", micError);
          alert("Microphone access denied. Please grant microphone permission and try again.");
          return;
        }
      }

      if (selectedPermissions.video) {
        try {
          console.log("🎥 Creating video track and requesting camera permission...");
          const videoTrack = await createLocalVideoTrack();
          localTracks.push(videoTrack);
          console.log("✅ Video track created successfully");
        } catch (cameraError) {
          console.error("❌ Camera access denied:", cameraError);
          alert("Camera access denied or failed. The session will continue without video.");
        }
      }

      if (selectedPermissions.screen) {
        try {
          console.log("🖥️ Creating screen share tracks and requesting permission...");
          const screenTracks = await createLocalScreenTracks();
          localTracks.push(...screenTracks);
          console.log("✅ Screen share tracks created successfully");
        } catch (screenError) {
          console.error("❌ Screen share access denied:", screenError);
          alert(
            "Screen share access denied or failed. The session will continue without screen sharing."
          );
        }
      }

      console.log(
        `✅ Created ${localTracks.length} local tracks. Now fetching connection details...`
      );

      // SECOND: Fetch connection details with permissions
      const url = new URL(
        process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? "/api/connection-details",
        window.location.origin
      );

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(selectedPermissions),
      });

      const connectionDetailsData: ConnectionDetails = await response.json();
      console.log("✅ Connection details received");

      // THIRD: Connect to room WITH pre-created tracks
      console.log("🔌 Connecting to room with pre-created tracks...");
      await room.connect(connectionDetailsData.serverUrl, connectionDetailsData.participantToken);
      console.log("✅ Connected to room");

      // Save session for restart capability
      if (room.name) {
        saveRoomSession(room.name, connectionDetailsData.serverUrl, connectionDetailsData.participantToken, selectedPermissions);
      }

      // FOURTH: Publish all pre-created tracks immediately
      console.log("📡 Publishing pre-created tracks...");
      for (const track of localTracks) {
        try {
          await room.localParticipant.publishTrack(track);
          console.log(`✅ Published ${track.kind} track`);
        } catch (publishError) {
          console.error(`❌ Failed to publish ${track.kind} track:`, publishError);
        }
      }

      console.log("🎉 All tracks published - agent should see them immediately!");
    } catch (error) {
      console.error("❌ Connection failed:", error);
      alert("Failed to connect to the session. Please try again.");
    }
  }, [room, selectedPermissions]);

  const onDeviceFailure = useCallback((error: Error) => {
    console.error(error);
    alert(
      "Error acquiring camera or microphone permissions. Please make sure you grant the necessary permissions in your browser and reload the tab"
    );
  }, []);

  useEffect(() => {
    console.log("🔧 Setting up room event listeners and RPC methods");

    // Register RPC method to receive session events
    const handleAgentInteraction = async (data: unknown): Promise<string> => {
      try {
        console.log("📨 Session Event RPC Received:", data);

        // Handle the RPC data
        let eventData: Record<string, unknown>;
        if (typeof data === "object" && data !== null && "payload" in data) {
          const payload = (data as Record<string, unknown>).payload;
          eventData =
            typeof payload === "string"
              ? JSON.parse(payload)
              : (payload as Record<string, unknown>);
        } else {
          eventData = data as Record<string, unknown>;
        }

        console.log("📨 Parsed session event:", eventData);

        // Extract event type from the correct location
        let eventType: string;
        if (eventData && typeof eventData === "object") {
          // Check for top-level 'type' field first (new format)
          const type = eventData.type;
          const eventTypeField = eventData.event_type;
          const event = eventData.event;

          eventType =
            typeof type === "string"
              ? type
              : typeof eventTypeField === "string"
                ? eventTypeField
                : typeof event === "string"
                  ? event
                  : "unknown";
        } else {
          eventType = "unknown";
        }

        console.log("📨 Event type:", eventType, "Full data:", eventData);
        addRpcLog(eventType, eventData);

        return "Success";
      } catch (error) {
        console.error("❌ Failed to process session event RPC:", error);
        return "Error: " + (error instanceof Error ? error.message : String(error));
      }
    };

    // Register the RPC method
    room.registerRpcMethod("interaction", handleAgentInteraction);

    room.on(RoomEvent.MediaDevicesError, onDeviceFailure);

    // Add debug listener for all disconnect events
    room.on(RoomEvent.Disconnected, (reason) => {
      console.log(`🔌 Room disconnected, reason: ${reason}`);
    });

    // Graceful shutdown on page unload/refresh/close
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const handleBeforeUnload = async (_event: BeforeUnloadEvent) => {
      if (room.state === "connected") {
        console.log("🚨 Page unloading - performing graceful disconnect");

        // Disconnect from room without signaling agent
        console.log("👋 Performing graceful disconnect...");
        await gracefulDisconnectAndShutdown(room);
      }
    };

    return () => {
      console.log("🧹 Cleaning up room event listeners and RPC methods");
      room.off(RoomEvent.MediaDevicesError, onDeviceFailure);
      room.unregisterRpcMethod("interaction");
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [room, addRpcLog, onDeviceFailure]);

  const handlePing = useCallback(async () => {
    if (!room) return;
    const client = new AgentRPCClient(room);
    const res = await client.callPing("Ping from UI");
    console.log("Ping response", res);
    alert(res.success ? `Pong: ${JSON.stringify(res.data ?? res)}` : `Ping failed: ${res.message}`);
  }, [room]);

  const handleScreenChange = useCallback(async () => {
    if (!room) return;
    const client = new AgentRPCClient(room);
    const payload = {
      studyId: "trial_be_dev_1747032012869",
      participantId: "d14a8c2e6c",
      sessionId: "828",
      frameId: "5:2",
      fileKey: "OffWxM3U1J3PpskRMuGDbZ",
      timestamp: Date.now(),
      taskNumber: 3,
    };
    const res = await client.callScreenChange(payload);
    console.log("ScreenChange response", res);
  }, [room]);

  const handleClick = useCallback(async () => {
    if (!room) return;
    const client = new AgentRPCClient(room);
    const payload = {
      studyId: "trial_be_dev_1747032012869",
      participantId: "d14a8c2e6c",
      sessionId: "828",
      frameId: "5:2",
      fileKey: "OffWxM3U1J3PpskRMuGDbZ",
      nodeId: "125:471",
      newFrameId: "23:294",
      timestamp: Date.now(),
      taskNumber: 3,
      coordinates: { x: -1, y: -1 },
      animation: false,
    };
    const res = await client.callClick(payload);
    console.log("Click response", res);
  }, [room]);

  const handleTranscription = useCallback(async () => {
    if (!room) return;
    const client = new AgentRPCClient(room);
    const payload = { transcribedText: "Hello agent", timestamp: Date.now() };
    const res = await client.callTranscription(payload);
    console.log("Transcription response", res);
  }, [room]);

  const handleMoveNext = useCallback(async () => {
    if (!room) return;
    const client = new AgentRPCClient(room);
    const res = await client.callMoveToNextTask(2, "UI test");
    console.log("MoveNext response", res);
  }, [room]);

  const handleEndTask = useCallback(async () => {
    if (!room) return;
    const client = new AgentRPCClient(room);
    const res = await client.callMoveToNextTask(undefined, "UI test");
    console.log("EndTask response", res);
  }, [room]);

  const handlePause = useCallback(async () => {
    if (!room) return;
    const client = new AgentRPCClient(room);
    const res = await client.callPauseSession("UI pause request");
    console.log("Pause response", res);
    alert(res.success ? `Session paused: ${res.message}` : `Pause failed: ${res.message}`);
  }, [room]);

  const handleResume = useCallback(async () => {
    if (!room) return;
    const client = new AgentRPCClient(room);
    const res = await client.callResumeSession("UI resume request");
    console.log("Resume response", res);
    alert(res.success ? `Session resumed: ${res.message}` : `Resume failed: ${res.message}`);
  }, [room]);

  const handleEditChat = useCallback(async () => {
    if (!room) return;
    const client = new AgentRPCClient(room);
    const payload = {
      edits: [
        {
          id: "test_message_123",
          content: "Updated message content",
          delete: false
        }
      ]
    };
    const res = await client.callEditChatContext(payload.edits);
    console.log("EditChat response", res);
  }, [room]);

  return (
    <main data-lk-theme="default" className="h-full grid content-center bg-[var(--lk-bg)]">
      <RoomContext.Provider value={room}>
        <div className="lk-room-container max-w-[1024px] w-[90vw] mx-auto max-h-[90vh]">
          <SimpleVoiceAssistant
            onConnectButtonClicked={onConnectButtonClicked}
            onPermissionSelected={onPermissionSelected}
            selectedPermissions={selectedPermissions}
            availableRestart={availableRestart}
            onRestartButtonClicked={onRestartButtonClicked}
            onClearRestart={clearRestartSession}
            rpcLogs={rpcLogs}
            handlePing={handlePing}
            handleScreenChange={handleScreenChange}
            handleClick={handleClick}
            handleTranscription={handleTranscription}
            handleMoveNext={handleMoveNext}
            handleEndTask={handleEndTask}
            handlePause={handlePause}
            handleResume={handleResume}
            handleEditChat={handleEditChat}
          />
        </div>
      </RoomContext.Provider>
    </main>
  );
}

function SimpleVoiceAssistant(props: {
  onConnectButtonClicked: () => void;
  onPermissionSelected: (permissions: PermissionSettings) => void;
  selectedPermissions: PermissionSettings | null;
  availableRestart: RoomSession | null;
  onRestartButtonClicked: () => void;
  onClearRestart: () => void;
  rpcLogs: RpcLogEntry[];
  handlePing: () => void;
  handleScreenChange: () => void;
  handleClick: () => void;
  handleTranscription: () => void;
  handleMoveNext: () => void;
  handleEndTask: () => void;
  handlePause: () => void;
  handleResume: () => void;
  handleEditChat: () => void;
}) {
  const { state: agentState } = useVoiceAssistant();

  return (
    <>
      <AnimatePresence mode="wait">
        {agentState === "disconnected" ? (
          <motion.div
            key="disconnected"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="grid items-center justify-center h-full"
          >
            <RestartOptions
              availableRestart={props.availableRestart}
              selectedPermissions={props.selectedPermissions}
              onPermissionSelected={props.onPermissionSelected}
              onConnectButtonClicked={props.onConnectButtonClicked}
              onRestartButtonClicked={props.onRestartButtonClicked}
              onClearRestart={props.onClearRestart}
            />
          </motion.div>
        ) : (
          <motion.div
            key="connected"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="flex flex-col items-center gap-4 h-full"
          >
            <AgentVisualizer />
            <div className="flex-1 w-full">
              <TranscriptionView />
            </div>
            <div className="w-full">
              <ControlBar
                onConnectButtonClicked={props.onConnectButtonClicked}
                handlePing={props.handlePing}
                handleScreenChange={props.handleScreenChange}
                handleClick={props.handleClick}
                handleTranscription={props.handleTranscription}
                handleMoveNext={props.handleMoveNext}
                handleEndTask={props.handleEndTask}
                handlePause={props.handlePause}
                handleResume={props.handleResume}
                handleEditChat={props.handleEditChat}
              />
            </div>
            <div className="w-full">
              <RpcLogger logs={props.rpcLogs} />
            </div>
            <RoomAudioRenderer />
            <NoAgentNotification state={agentState} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function AgentVisualizer() {
  const { state: agentState, videoTrack, audioTrack } = useVoiceAssistant();

  if (videoTrack) {
    return (
      <div className="h-[512px] w-[512px] rounded-lg overflow-hidden">
        <VideoTrack trackRef={videoTrack} />
      </div>
    );
  }
  return (
    <div className="h-[300px] w-full">
      <BarVisualizer
        state={agentState}
        barCount={5}
        trackRef={audioTrack}
        className="agent-visualizer"
        options={{ minHeight: 24 }}
      />
    </div>
  );
}

function ControlBar(props: {
  onConnectButtonClicked: () => void;
  handlePing: () => void;
  handleScreenChange: () => void;
  handleClick: () => void;
  handleTranscription: () => void;
  handleMoveNext: () => void;
  handleEndTask: () => void;
  handlePause: () => void;
  handleResume: () => void;
  handleEditChat: () => void;
}) {
  const { state: agentState } = useVoiceAssistant();
  const room = useContext(RoomContext);
  const [showEditForm, setShowEditForm] = useState(false);

  // RPC test handler
  const handleRPCTest = useCallback(async () => {
    if (!room) {
      console.error("❌ No room available for RPC");
      return;
    }

    console.log("🚀 Testing RPC call to agent...");
    const rpcClient = new AgentRPCClient(room);

    try {
      const response = await rpcClient.callHelloWorld("Frontend User");
      console.log("✅ RPC Response:", response);
      alert(`RPC Success: ${response.message}`);
    } catch (error) {
      console.error("❌ RPC Error:", error);
      alert(`RPC Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [room]);

  // Custom disconnect handler - just disconnect immediately without RPC calls
  const handleCustomDisconnect = useCallback(async () => {
    console.log("🚨 DISCONNECTING WITHOUT RPC SIGNALS");

    if (!room) {
      console.error("❌ No room available");
      return;
    }

    try {
      console.log("🔄 Performing graceful disconnect...");
      await gracefulDisconnectAndShutdown(room);
      console.log("✅ Graceful disconnect completed");
    } catch (error) {
      console.error("❌ Disconnect failed:", error);
    }
  }, [room]);

  return (
    <div className="relative h-[60px]">
      <AnimatePresence>
        {agentState === "disconnected" && (
          <motion.button
            initial={{ opacity: 0, top: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, top: "-10px" }}
            transition={{ duration: 1, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="uppercase absolute left-1/2 -translate-x-1/2 px-4 py-2 bg-white text-black rounded-md"
            onClick={() => props.onConnectButtonClicked()}
          >
            Start a conversation
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {agentState !== "disconnected" && agentState !== "connecting" && (
          <motion.div
            initial={{ opacity: 0, top: "10px" }}
            animate={{ opacity: 1, top: 0 }}
            exit={{ opacity: 0, top: "-10px" }}
            transition={{ duration: 0.4, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="flex h-8 absolute left-1/2 -translate-x-1/2  justify-center"
          >
            <VoiceAssistantControlBar controls={{ leave: false }} />
            <button
              onClick={handleRPCTest}
              className="h-[36px] hover:bg-[#1a226b] hover:text-[white] bg-[#0c1031] border-[#1a6b22] px-3 rounded border text-xs"
            >
              RPC
            </button>
            <button
              onClick={handleCustomDisconnect}
              className="h-[36px] hover:bg-[#6b221a] hover:text-[white] bg-[#31100c] border-[#6b221a] px-3 rounded border"
            >
              <CloseIcon />
            </button>
            <button
              onClick={props.handlePing}
              className="h-[36px] bg-[#0c3110] hover:bg-[#1a6b22] text-white px-3 rounded text-xs"
            >
              Ping
            </button>
            <button
              onClick={props.handleScreenChange}
              className="h-[36px] bg-[#10310c] hover:bg-[#226b1a] text-white px-3 rounded text-xs"
            >
              Screen
            </button>
            <button
              onClick={props.handleClick}
              className="h-[36px] bg-[#101031] hover:bg-[#1a226b] text-white px-3 rounded text-xs"
            >
              Click
            </button>
            <button
              onClick={props.handleTranscription}
              className="h-[36px] bg-[#31100c] hover:bg-[#6b221a] text-white px-3 rounded text-xs"
            >
              Transcribe
            </button>
            <button
              onClick={props.handleMoveNext}
              className="h-[36px] bg-[#310c31] hover:bg-[#6b1a6b] text-white px-3 rounded text-xs"
            >
              NextTask
            </button>
            <button
              onClick={props.handleEndTask}
              className="h-[36px] bg-[#31210c] hover:bg-[#6b3a1a] text-white px-3 rounded text-xs"
            >
              EndTask
            </button>
            <button
              onClick={props.handlePause}
              className="h-[36px] bg-[#31200c] hover:bg-[#6b3a1a] text-white px-3 rounded text-xs"
            >
              ⏸️ Pause
            </button>
            <button
              onClick={props.handleResume}
              className="h-[36px] bg-[#0c3120] hover:bg-[#1a6b3a] text-white px-3 rounded text-xs"
            >
              ▶️ Resume
            </button>
            <button
              onClick={() => setShowEditForm(true)}
              className="h-[36px] bg-[#0c3120] hover:bg-[#1a6b3a] text-white px-3 rounded text-xs"
            >
              EditChat
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Edit Form Modal */}
      <AnimatePresence>
        {showEditForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            onClick={() => setShowEditForm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-800 p-6 rounded-lg border border-gray-600 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <ChatEditForm 
                onClose={() => setShowEditForm(false)}
                onSubmit={props.handleEditChat}
                room={room || null}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RestartOptions(props: {
  availableRestart: RoomSession | null;
  selectedPermissions: PermissionSettings | null;
  onPermissionSelected: (permissions: PermissionSettings) => void;
  onConnectButtonClicked: () => void;
  onRestartButtonClicked: () => void;
  onClearRestart: () => void;
}) {
  if (props.availableRestart) {
    const ageMinutes = (Date.now() - props.availableRestart.timestamp) / (1000 * 60);
    const permissionText = Object.entries(props.availableRestart.permissions)
      .filter(([_, enabled]) => enabled)
      .map(([key, _]) => key)
      .join(" + ");

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md mx-auto space-y-4"
      >
        <div className="bg-blue-900/50 border border-blue-600 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">🔄</span>
            <h2 className="text-lg font-semibold text-white">Rejoin Previous Session</h2>
          </div>
          <div className="text-sm text-gray-300 space-y-1">
            <p>Room: <span className="font-mono text-blue-300">{props.availableRestart.roomName}</span></p>
            <p>Permissions: <span className="text-blue-300">{permissionText || "none"}</span></p>
            <p>Age: <span className="text-blue-300">{ageMinutes.toFixed(1)} minutes ago</span></p>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={props.onRestartButtonClicked}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors"
            >
              🚀 Rejoin Session
            </button>
            <button
              onClick={props.onClearRestart}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
        
        <div className="text-center text-gray-400">
          <p>or</p>
        </div>
        
        <div className="bg-gray-800/50 border border-gray-600 rounded-lg p-4">
          <h3 className="text-white font-medium mb-3">Start New Session</h3>
          <button
            onClick={props.onClearRestart}
            className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors"
          >
            Choose New Permissions
          </button>
        </div>
      </motion.div>
    );
  }

  if (!props.selectedPermissions) {
    return <PermissionSelector onPermissionSelected={props.onPermissionSelected} />;
  }

  return (
    <motion.button
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="uppercase px-4 py-2 bg-white text-black rounded-md"
      onClick={props.onConnectButtonClicked}
    >
      Start a conversation
    </motion.button>
  );
}

function PermissionSelector(props: {
  onPermissionSelected: (permissions: PermissionSettings) => void;
}) {
  const permissionOptions = [
    {
      name: "All recordings",
      description: "Audio, Video, and Screen recording",
      permissions: { audio: true, video: true, screen: true },
      icon: "🎥📱🖥️",
    },
    {
      name: "Audio + Video only",
      description: "Audio and Video recording only",
      permissions: { audio: true, video: true, screen: false },
      icon: "🎥📱",
    },
    {
      name: "Audio + Screen only",
      description: "Audio and Screen recording only",
      permissions: { audio: true, video: false, screen: true },
      icon: "🎤🖥️",
    },
    {
      name: "Audio only",
      description: "Audio recording only",
      permissions: { audio: true, video: false, screen: false },
      icon: "🎤",
    },
    {
      name: "No recording",
      description: "No recording permissions",
      permissions: { audio: false, video: false, screen: false },
      icon: "🚫",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-full max-w-md mx-auto"
    >
      <h2 className="text-xl font-semibold text-white mb-6 text-center">
        Choose Recording Permissions
      </h2>
      <div className="space-y-3">
        {permissionOptions.map((option, index) => (
          <motion.button
            key={index}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
            onClick={() => props.onPermissionSelected(option.permissions)}
            className="w-full p-4 bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-600 hover:border-gray-500 transition-all duration-200 text-left group"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-white group-hover:text-gray-100">
                  {option.icon} {option.name}
                </div>
                <div className="text-sm text-gray-400 group-hover:text-gray-300 mt-1">
                  {option.description}
                </div>
              </div>
              <div className="text-gray-400 group-hover:text-white">→</div>
            </div>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

function RpcLogger(props: { logs: RpcLogEntry[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-full mt-4"
    >
      <div className="bg-gray-800 rounded-lg border border-gray-600">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full p-3 text-left flex items-center justify-between hover:bg-gray-700 transition-colors rounded-t-lg"
        >
          <div className="flex items-center gap-2">
            <span className="text-white font-medium">📨 RPC Events</span>
            <span className="bg-blue-600 text-white px-2 py-1 rounded-full text-xs">
              {props.logs.length}
            </span>
          </div>
          <span
            className="text-gray-400 transform transition-transform"
            style={{
              transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            ▼
          </span>
        </button>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="max-h-64 overflow-y-auto p-3 pt-0">
                {props.logs.length === 0 ? (
                  <div className="text-gray-400 text-center py-4">No RPC events received yet</div>
                ) : (
                  <div className="space-y-2">
                    {props.logs.map((log) => (
                      <div
                        key={log.id}
                        className="bg-gray-700 rounded p-3 border-l-4 border-blue-500"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-blue-300 font-medium text-sm">{log.event}</span>
                          <span
                            className="text-gray-400 text-xs"
                            title={`Full timestamp: ${new Date(log.timestamp).toISOString()} (${log.timestamp}ms)`}
                          >
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <details className="text-gray-300 text-xs">
                          <summary className="cursor-pointer hover:text-white">View Data</summary>
                          <pre className="mt-2 p-2 bg-gray-800 rounded text-xs overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(log.data, null, 2)}
                          </pre>
                        </details>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function ChatEditForm({ onClose, onSubmit, room }: { 
  onClose: () => void; 
  onSubmit: () => void;
  room: Room | null;
}) {
  const [edits, setEdits] = useState<Array<{id: string; content: string; delete: boolean}>>([
    { id: "", content: "", delete: false }
  ]);

  const addEdit = () => {
    setEdits([...edits, { id: "", content: "", delete: false }]);
  };

  const removeEdit = (index: number) => {
    if (edits.length > 1) {
      setEdits(edits.filter((_, i) => i !== index));
    }
  };

  const updateEdit = (index: number, field: 'id' | 'content' | 'delete', value: string | boolean) => {
    const newEdits = [...edits];
    newEdits[index] = { ...newEdits[index], [field]: value };
    setEdits(newEdits);
  };

  const handleSubmit = async () => {
    if (!room) return;
    
    const client = new AgentRPCClient(room);
    const validEdits = edits.filter(edit => edit.id.trim());
    
    if (validEdits.length === 0) {
      alert("Please enter at least one valid message ID");
      return;
    }

    const payload = {
      edits: validEdits.map(edit => ({
        id: edit.id.trim(),
        ...(edit.content.trim() && { content: edit.content.trim() }),
        ...(edit.delete && { delete: true })
      }))
    };

    try {
      const res = await client.callEditChatContext(payload.edits);
      console.log("EditChat response", res);
      alert(res.success ? `Success: ${res.message}` : `Error: ${res.message}`);
      if (res.success) {
        onClose();
      }
    } catch (error) {
      console.error("EditChat error", error);
      alert(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">Edit Chat Context</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white"
        >
          ✕
        </button>
      </div>
      
      <div className="space-y-3 max-h-64 overflow-y-auto">
        {edits.map((edit, index) => (
          <div key={index} className="bg-gray-700 p-3 rounded border border-gray-600">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-300">Edit #{index + 1}</span>
              {edits.length > 1 && (
                <button
                  onClick={() => removeEdit(index)}
                  className="text-red-400 hover:text-red-300 text-sm"
                >
                  Remove
                </button>
              )}
            </div>
            
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Message ID"
                value={edit.id}
                onChange={(e) => updateEdit(index, 'id', e.target.value)}
                className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded text-white placeholder-gray-400"
              />
              
              <input
                type="text"
                placeholder="New content (leave empty to keep current)"
                value={edit.content}
                onChange={(e) => updateEdit(index, 'content', e.target.value)}
                className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded text-white placeholder-gray-400"
              />
              
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={edit.delete}
                  onChange={(e) => updateEdit(index, 'delete', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-gray-300">Delete message</span>
              </label>
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex space-x-2">
        <button
          onClick={addEdit}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
        >
          Add Another Edit
        </button>
        
        <button
          onClick={handleSubmit}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm flex-1"
        >
          Submit Edits
        </button>
      </div>
      
      <div className="text-xs text-gray-400">
        <p>• Enter message ID to identify the message to edit</p>
        <p>• Enter new content to update, or leave empty to keep current</p>
        <p>• Check "Delete message" to remove the message entirely</p>
      </div>
    </div>
  );
}
