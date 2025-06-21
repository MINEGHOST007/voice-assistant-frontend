import { NextRequest, NextResponse } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";

export async function POST(req: NextRequest) {
    try {
        const { roomName, roomMetadata } = await req.json();
        const API_KEY = process.env.LIVEKIT_API_KEY;
        const API_SECRET = process.env.LIVEKIT_API_SECRET;
        const LIVEKIT_URL = process.env.LIVEKIT_URL;
        if (!API_KEY || !API_SECRET || !LIVEKIT_URL) {
            return NextResponse.json({ error: "Missing LiveKit environment variables" }, { status: 500 });
        }
        const roomService = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
        await roomService.updateRoomMetadata(roomName, JSON.stringify(roomMetadata));
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
