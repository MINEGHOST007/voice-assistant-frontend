import { AccessToken, AccessTokenOptions, VideoGrant, RoomServiceClient, CreateOptions } from "livekit-server-sdk";
import { NextResponse } from "next/server";

// NOTE: you are expected to define the following environment variables in `.env.local`:
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

// don't cache the results
export const revalidate = 0;

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

async function createSessionAPI(studyId: string, participantId: string) {
  const response = await fetch('https://dev.userology.co/participant/api/session/' + studyId + '/create', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'origin': 'https://participant-dev.userology.co',
      'x-tenant-id': 't1-8f9edb37-58f8-49fe-83f8-2116a10af5d2'
    },
    body: JSON.stringify({
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
        browserVersion: "137"
      },
      isTest: false,
      preview: false,
      tenantId: "t1-8f9edb37-58f8-49fe-83f8-2116a10af5d2"
    })
  });

  if (!response.ok) {
    throw new Error('Failed to create session');
  }

  return response.json();
}

export async function GET(request: Request) {
  try {
    if (LIVEKIT_URL === undefined) {
      throw new Error("LIVEKIT_URL is not defined");
    }
    if (API_KEY === undefined) {
      throw new Error("LIVEKIT_API_KEY is not defined");
    }
    if (API_SECRET === undefined) {
      throw new Error("LIVEKIT_API_SECRET is not defined");
    }

    // Get permissions from query parameters
    const { searchParams } = new URL(request.url);
    const audioPermission = searchParams.get('audio') === 'true';
    const videoPermission = searchParams.get('video') === 'true';
    const screenPermission = searchParams.get('screen') === 'true';

    // Generate participant and room names
    const participantIdentity = `voice_assistant_user_${Math.floor(Math.random() * 10_000)}`;
    const roomName = `voice_assistant_room_${Math.floor(Math.random() * 10_000)}`;

    // First create session
    const studyId = "3_voice_sections_1749236892371";
    const participantId = Math.random().toString(36).substring(2, 12);
    const sessionResponse = await createSessionAPI(studyId, participantId);

    // Room metadata payload with updated fields from session response
    const payload = {
      agentId: "",
      organizationId: "t1-8f9edb37-58f8-49fe-83f8-2116a10af5d2",
      callId: roomName,
      studyId: sessionResponse.data.studyId,
      participantId: sessionResponse.data.participantId,
      sessionId: sessionResponse.data.sessionId,
      tenantId: "t1-8f9edb37-58f8-49fe-83f8-2116a10af5d2",
      name: "Sankeerth",
      llm_config: "pc-modera-ce0173",
      timestamp: Date.now(),
      callType: "web",
      phoneNumber: "",
      user_plan: "dev",
      isTest: false,
      preview: false,
      permissions: {
        audio: audioPermission,
        video: videoPermission,
        screen: screenPermission
      },
      device: {
        height: 1361,
        width: 1674,
        deviceType: "desktop",
        browser: "Chrome",
        browserVersion: "137"
      },
      recordingStartTimestamp: Date.now(),
      thread_ts: sessionResponse.data.thread_ts
    };

    // Create room and set metadata before generating token
    const roomService = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);

    try {
      const metadataString = JSON.stringify(payload);
      console.log('Creating room with metadata:', metadataString);

      const createRoomOpts: CreateOptions = {
        name: roomName,
        metadata: metadataString,
        emptyTimeout: 10 * 60,
        maxParticipants: 2
      };

      await roomService.createRoom(createRoomOpts);
      console.log(`Created room ${roomName} with metadata`);

      const participantToken = await createParticipantToken(
        {
          identity: participantIdentity,
        },
        roomName
      );

      const data: ConnectionDetails = {
        serverUrl: LIVEKIT_URL,
        roomName,
        participantToken: participantToken,
        participantName: participantIdentity,
        permissions: {
          audio: audioPermission,
          video: videoPermission,
          screen: screenPermission
        }
      };

      const headers = new Headers({
        "Cache-Control": "no-store",
      });
      return NextResponse.json(data, { headers });

    } catch (e: unknown) {
      console.error(`Failed to create room: ${e}`);
      throw e;
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(error);
      return new NextResponse(error.message, { status: 500 });
    }
  }
}

function createParticipantToken(userInfo: AccessTokenOptions, roomName: string) {
  const at = new AccessToken(API_KEY, API_SECRET, {
    ...userInfo,
    ttl: "15m",
  });
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);
  return at.toJwt();
}

export async function POST(request: Request) {
  try {
    if (LIVEKIT_URL === undefined) {
      throw new Error("LIVEKIT_URL is not defined");
    }
    if (API_KEY === undefined) {
      throw new Error("LIVEKIT_API_KEY is not defined");
    }
    if (API_SECRET === undefined) {
      throw new Error("LIVEKIT_API_SECRET is not defined");
    }

    // Get permissions from request body
    const { audio: audioPermission, video: videoPermission, screen: screenPermission }: PermissionRequest = await request.json();

    console.log('🎯 Received permissions:', { audioPermission, videoPermission, screenPermission });

    // Validate permissions are boolean
    if (typeof audioPermission !== 'boolean' || typeof videoPermission !== 'boolean' || typeof screenPermission !== 'boolean') {
      throw new Error('Invalid permission types - must be boolean');
    }

    // Generate participant and room names
    const participantIdentity = `voice_assistant_user_${Math.floor(Math.random() * 10_000)}`;
    const roomName = `voice_assistant_room_${Math.floor(Math.random() * 10_000)}`;

    // First create session
    const studyId = "3_voice_sections_1749236892371";
    const participantId = Math.random().toString(36).substring(2, 12);
    const sessionResponse = await createSessionAPI(studyId, participantId);

    // Room metadata payload with updated fields from session response
    const payload = {
      agentId: "",
      organizationId: "t1-8f9edb37-58f8-49fe-83f8-2116a10af5d2",
      callId: roomName,
      llm_config: "pc-modera-ce0173",
      studyId: sessionResponse.data.studyId,
      participantId: sessionResponse.data.participantId,
      sessionId: sessionResponse.data.sessionId,
      tenantId: "t1-8f9edb37-58f8-49fe-83f8-2116a10af5d2",
      name: "Sankeerth",
      timestamp: Date.now(),
      callType: "web",
      phoneNumber: "",
      user_plan: "dev",
      isTest: false,
      preview: false,
      permissions: {
        audio: audioPermission,
        video: videoPermission,
        screen: screenPermission
      },
      device: {
        height: 1361,
        width: 1674,
        deviceType: "desktop",
        browser: "Chrome",
        browserVersion: "137"
      },
      recordingStartTimestamp: Date.now(),
      thread_ts: sessionResponse.data.thread_ts
    };

    // Create room and set metadata before generating token
    const roomService = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);

    try {
      const metadataString = JSON.stringify(payload);
      console.log('🎯 Creating room with metadata permissions:', payload.permissions);
      console.log('📋 Full metadata:', metadataString);

      const createRoomOpts: CreateOptions = {
        name: roomName,
        metadata: metadataString,
        emptyTimeout: 10 * 60,
        maxParticipants: 2
      };

      await roomService.createRoom(createRoomOpts);
      console.log(`✅ Created room ${roomName} with metadata`);

      // Ensure metadata propagation with delay before token generation
      await new Promise(resolve => setTimeout(resolve, 200));

      const participantToken = await createParticipantToken(
        {
          identity: participantIdentity,
        },
        roomName
      );

      const data: ConnectionDetails = {
        serverUrl: LIVEKIT_URL,
        roomName,
        participantToken: participantToken,
        participantName: participantIdentity,
        permissions: {
          audio: audioPermission,
          video: videoPermission,
          screen: screenPermission
        }
      };

      const headers = new Headers({
        "Cache-Control": "no-store",
      });
      return NextResponse.json(data, { headers });

    } catch (e: unknown) {
      console.error(`Failed to create room: ${e}`);
      throw e;
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(error);
      return new NextResponse(error.message, { status: 500 });
    }
  }
}