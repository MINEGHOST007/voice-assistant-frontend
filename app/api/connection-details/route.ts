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
  const studyId = "bottom_bar_test_1752651553019";
  const participantId = "6c1c81b9ee";

  const requestBody = {
    studyId,
    email: "N/A",
    name: "Shanks Restart Test",
    participantId,
    contact: participantId,
    deviceDetails: {
      height: 988,
      width: 1699,
      deviceType: "desktop",
      browser: "Chrome",
      browserVersion: "140",
    },
    isTest: false,
    preview: false,
    restartSessionId: "1705",
    restartData: {
      sessions: ["1705"],
      tasksMap: {
        "0": {
          section: 1,
          status: "Ended",
          session: "1705"
        },
        "1": {
          section: 2,
          status: "Started",
          session: "1705"
        },
        "2": {
          section: 3,
          status: "Not Started",
          session: "1705"
        },
        "3": {
          section: 4,
          status: "Not Started",
          session: "1705"
        }
      },
      section: 1,
      frameId: "1:133"
    },
    platform: "livekit",
    language: "en-US",
    perimissions: {
      video: options.video,
      screen: options.screen,
    },
  };

  const resp = await fetch(`https://dev.userology.co/participant/api/session/${studyId}/create`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://participant-dev.userology.co",
      "x-tenant-id": "playground",
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
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new NextResponse(message, { status: 500 });
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
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new NextResponse(message, { status: 500 });
  }
}

