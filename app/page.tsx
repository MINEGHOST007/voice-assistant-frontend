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
        responseTimeout: 5000,
      });

      const result: HelloWorldResponse = JSON.parse(response);
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
        responseTimeout: 5000,
      });

      const result: InteractionResponse = JSON.parse(response);
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
        responseTimeout: 5000,
      });

      const result: InteractionResponse = JSON.parse(response);
      return result;
    } catch (error) {
      console.error("Error calling close RPC:", error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }
}

type PermissionSettings = {
  audio: boolean;
  video: boolean;
  screen: boolean;
};

export default function Page() {
  const [room] = useState(new Room());
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionSettings | null>(null);
  const [rpcLogs, setRpcLogs] = useState<RpcLogEntry[]>([]);
  const [shouldAutoDisconnect, setShouldAutoDisconnect] = useState(false);

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
        const roomName = room.name;
        try {
          await room.disconnect();
          console.log("✅ Auto disconnect completed");

          // Now delete the room since session is complete
          if (roomName) {
            console.log("🔥 Deleting room after session shutdown...");
            const response = await fetch("/api/shutdown-room", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ roomName }),
            });

            const result = await response.json();

            if (response.ok) {
              console.log("✅ Room deletion successful:", result.message);
            } else {
              console.error("❌ Room deletion failed:", result.error);
            }
          }
        } catch (error) {
          console.error("❌ Auto disconnect failed:", error);
        }
        setShouldAutoDisconnect(false);
      };
      autoDisconnect();
    }
  }, [shouldAutoDisconnect, room]);

  const onPermissionSelected = useCallback((permissions: PermissionSettings) => {
    setSelectedPermissions(permissions);
  }, []);

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
    room.on(RoomEvent.Disconnected, () => {
      console.log("🔌 Room disconnected event fired!");
    });

    // Graceful shutdown on page unload/refresh/close
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const handleBeforeUnload = async (_event: BeforeUnloadEvent) => {
      if (room.state === "connected") {
        console.log("🚨 Page unloading - attempting graceful disconnect");

        // Try to signal agent to close gracefully
        try {
          const rpcClient = new AgentRPCClient(room);
          const callId = room.name || "session_" + Date.now();
          await rpcClient.callClose(callId);

          // Wait briefly for agent to start disconnecting
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          console.error("❌ Failed to send close signal on unload:", error);
        }

        // Disconnect from room
        try {
          await room.disconnect();
        } catch (error) {
          console.error("❌ Failed to disconnect on unload:", error);
        }
      }
    };

    // Add event listener for page unload
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      console.log("🧹 Cleaning up room event listeners and RPC methods");
      room.off(RoomEvent.MediaDevicesError, onDeviceFailure);
      room.unregisterRpcMethod("interaction");
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [room, addRpcLog, onDeviceFailure]);

  return (
    <main data-lk-theme="default" className="h-full grid content-center bg-[var(--lk-bg)]">
      <RoomContext.Provider value={room}>
        <div className="lk-room-container max-w-[1024px] w-[90vw] mx-auto max-h-[90vh]">
          <SimpleVoiceAssistant
            onConnectButtonClicked={onConnectButtonClicked}
            onPermissionSelected={onPermissionSelected}
            selectedPermissions={selectedPermissions}
            rpcLogs={rpcLogs}
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
  rpcLogs: RpcLogEntry[];
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
            {!props.selectedPermissions ? (
              <PermissionSelector onPermissionSelected={props.onPermissionSelected} />
            ) : (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="uppercase px-4 py-2 bg-white text-black rounded-md"
                onClick={() => props.onConnectButtonClicked()}
              >
                Start a conversation
              </motion.button>
            )}
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
              <ControlBar onConnectButtonClicked={props.onConnectButtonClicked} />
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

function ControlBar(props: { onConnectButtonClicked: () => void }) {
  const { state: agentState } = useVoiceAssistant();
  const room = useContext(RoomContext);

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

  // Custom disconnect handler - only signal agent, don't disconnect yet
  const handleCustomDisconnect = useCallback(async () => {
    console.log("🚨 SENDING CLOSE SIGNAL TO AGENT");

    if (!room) {
      console.error("❌ No room available");
      return;
    }

    try {
      // Only send RPC close signal - DO NOT disconnect participant yet
      console.log("🔄 Sending RPC close signal to agent...");
      const rpcClient = new AgentRPCClient(room);
      const callId = room.name || "session_" + Date.now();

      await rpcClient.callClose(callId);
      console.log("✅ RPC close signal sent - waiting for agent to send session_shutdown");
      console.log("⏳ Agent will now process shutdown and send session_shutdown RPC...");

      // That's it! Don't disconnect here. Let the agent send session_shutdown RPC
      // which will trigger the auto-disconnect in the useEffect
    } catch (error) {
      console.error("❌ Error sending close signal:", error);

      // Fallback: if RPC fails, disconnect manually after a delay
      console.log("🚨 RPC failed, falling back to manual disconnect in 5 seconds...");
      setTimeout(async () => {
        try {
          await room.disconnect();
          console.log("✅ Manual fallback disconnect completed");
        } catch (disconnectError) {
          console.error("❌ Manual fallback disconnect failed:", disconnectError);
        }
      }, 5000);
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
