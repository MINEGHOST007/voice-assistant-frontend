import { NextRequest, NextResponse } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

export async function POST(req: NextRequest) {
  try {
    if (!API_KEY || !API_SECRET || !LIVEKIT_URL) {
      return NextResponse.json({ error: "Missing LiveKit environment variables" }, { status: 500 });
    }

    const { roomName } = await req.json();
    
    if (!roomName) {
      return NextResponse.json({ error: "Room name is required" }, { status: 400 });
    }

    console.log(`🔥 Shutting down room: ${roomName}`);
    
    const roomService = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
    
    // Delete the room
    await roomService.deleteRoom(roomName);
    
    console.log(`✅ Room ${roomName} shut down successfully`);
    
    return NextResponse.json({ success: true, message: "Room shut down successfully" });
    
  } catch (error) {
    console.error("❌ Error shutting down room:", error);
    return NextResponse.json({ 
      error: `Failed to shutdown room: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }, { status: 500 });
  }
} 