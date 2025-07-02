import { NextResponse } from "next/server";

// Environment variables
const LIVEKIT_URL = process.env.LIVEKIT_URL;

// Do not cache
export const revalidate = 0;

// Helper to pause execution – useful for debugging
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
  permissions: {
    audio: boolean;
    video: boolean;
    screen: boolean;
  };
};

export type PermissionRequest = {
  audio: boolean;
  video: boolean;
  screen: boolean;
};

// ---------------------------------------------------------------------------
// Helper – call the new backend create-session endpoint which **already**
// provisions a LiveKit room + participant token. We simply forward those
// details to the frontend.
// ---------------------------------------------------------------------------

async function callCreateSessionAPI(options: {
  video: boolean;
  screen: boolean;
}) {
  const studyId = "3_voice_sections_1749236892371"; // TODO: externalise when needed
  const participantId = Math.random().toString(36).substring(2, 12);

  const requestBody = {
    studyId,
    email: "N/A",
    name: "Sankeerth",
    participantId,
    contact: participantId,
    deviceDetails: {
      height: 1361,
      width: 1674,
      deviceType: "desktop",
      browser: "Chrome",
      browserVersion: "137",
    },
    preview: false,
    immediateRestart: false,
    platform: "livekit",
    callType: "web",
    phoneNumber: "",
    perimissions: {
      video: options.video,
      screen: options.screen,
    },
  };

  const resp = await fetch(`http://localhost:3001/api/session/${studyId}/create`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://participant-dev.userology.co",
      "x-tenant-id": "t1-8f9edb37-58f8-49fe-83f8-2116a10af5d2",
    },
    body: JSON.stringify(requestBody),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Create session failed – status ${resp.status}: ${errText}`);
  }

  return resp.json();
}

// ---------------------------------------------------------------------------
// REST Handlers (GET & POST) – they differ only in how they receive the
// permissions, afterwards the flow is identical.
// ---------------------------------------------------------------------------

async function handleRequest(permissions: PermissionRequest) {
  if (!LIVEKIT_URL) {
    throw new Error("LIVEKIT_URL environment variable is not set");
  }

  // 1️⃣ Call backend to create the session + LiveKit credentials
  const sessionResp = await callCreateSessionAPI({
    video: permissions.video,
    screen: permissions.screen,
  });

  // ⏱️ Wait 1 minute before continuing so we can observe what happens after the room is created
  //    NOTE: this will block the response; avoid in production environments with short execution timeouts.
  await sleep(10_000);

  if (!sessionResp?.data?.livekit) {
    console.error("LiveKit info missing in create-session response", sessionResp);
    throw new Error("LiveKit details missing in create-session response");
  }

  const livekit = sessionResp.data.livekit;

  // 2️⃣ Build object expected by the frontend
  const conn: ConnectionDetails = {
    serverUrl: LIVEKIT_URL,
    roomName: livekit.roomName,
    participantName: livekit.participant.id,
    participantToken: livekit.participant.token,
    permissions: {
      audio: true,
      video: permissions.video,
      screen: permissions.screen,
    },
  };

  const headers = new Headers({ "Cache-Control": "no-store" });
  return NextResponse.json(conn, { headers });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const permissions: PermissionRequest = {
      audio: true,
      video: searchParams.get("video") === "true",
      screen: searchParams.get("screen") === "true",
    };
    return await handleRequest(permissions);
  } catch (error: any) {
    console.error(error);
    return new NextResponse(error.message ?? "Unknown error", { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const reqBody = await request.json();
    const permissions: PermissionRequest = {
      audio: true,
      video: !!reqBody.video,
      screen: !!reqBody.screen,
    };
    return await handleRequest(permissions);
  } catch (error: any) {
    console.error(error);
    return new NextResponse(error.message ?? "Unknown error", { status: 500 });
  }
}

