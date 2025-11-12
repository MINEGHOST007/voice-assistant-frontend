import { NextResponse } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";

export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const { roomName } = (await request.json()) as { roomName?: string };
    if (!roomName) {
      return new NextResponse("roomName is required", { status: 400 });
    }

    const host = process.env.LIVEKIT_URL?.replace(/^ws(s)?:\/\//, "http$1://");
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!host || !apiKey || !apiSecret) {
      return new NextResponse("LiveKit admin credentials not configured", { status: 500 });
    }

    const roomClient = new RoomServiceClient(host, apiKey, apiSecret);
    await roomClient.deleteRoom(roomName);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new NextResponse(message, { status: 500 });
  }
}


