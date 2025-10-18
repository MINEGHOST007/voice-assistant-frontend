import { useChat, useRoomContext } from "@livekit/components-react";
import { useMemo } from "react";

export interface CombinedChatMessage {
  id: string;
  message: string;
  timestamp: number;
  role: "user" | "assistant";
  from?: {
    identity?: string;
    name?: string;
  };
}

export default function useCombinedChatMessages() {
  const room = useRoomContext();
  const { chatMessages, send, isSending } = useChat();
  
  // Log room state for debugging
  console.log("🔍 Room state:", room?.state);
  console.log("🔍 Room connected:", room?.state === 'connected');
  console.log("🔍 Room participants:", room?.remoteParticipants?.size || 0);

  // Log the raw chat messages for debugging
  console.log("🔍 Raw chatMessages from useChat():", chatMessages);
  console.log("🔍 Number of chat messages:", chatMessages.length);
  console.log("🔍 Chat send function:", send);
  console.log("🔍 Is sending:", isSending);

  const combinedChatMessages = useMemo(() => {
    console.log("🔄 Processing chat messages in useMemo:", chatMessages);
    
    return chatMessages.map((msg) => {
      console.log("📨 Processing individual message:", msg);
      console.log("📨 Message structure:", {
        id: msg.id,
        message: msg.message,
        timestamp: msg.timestamp,
        from: msg.from
      });
      // Determine role based on participant identity or other criteria
      // You might need to adjust this logic based on how you identify the assistant
      const isAssistant = msg.from?.identity?.includes('agent') || 
                         msg.from?.identity?.includes('assistant') ||
                         msg.from?.name?.includes('agent') ||
                         msg.from?.name?.includes('assistant');
      
      const processedMessage = {
        id: msg.id || `${msg.timestamp}`,
        message: msg.message,
        timestamp: msg.timestamp,
        role: isAssistant ? "assistant" as const : "user" as const,
        from: msg.from
      };
      
      console.log("✅ Processed message:", processedMessage);
      return processedMessage;
    }).sort((a, b) => a.timestamp - b.timestamp);
    
    console.log("🎯 Final combined chat messages:", combinedChatMessages);
  }, [chatMessages]);

  console.log("🚀 Returning combined chat messages:", combinedChatMessages);
  return combinedChatMessages;
} 