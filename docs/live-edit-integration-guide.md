# Live Edit Feature - Frontend Integration Guide

## Overview

The live edit feature allows real-time editing of conversation messages during agent sessions. This guide covers the essential integration points.

## What Frontend Receives

### Real-time Message Updates
Frontend receives `chat_context_update` events via RPC with this structure:

```typescript
interface ChatUpdateEvent {
  chat_item: {
    id: string;           // Unique message ID for editing
    role: 'user' | 'assistant';
    content: string;
  };
  session_id: string;
  timestamp: number;
}
```

## How Frontend Receives Updates

### RPC Event Subscription
```typescript
// Subscribe to real-time updates
rpcClient.on('chat_context_update', (data: ChatUpdateEvent) => {
  const { chat_item, session_id, timestamp } = data;
  
  // Only process messages for current session
  if (session_id === currentSessionId) {
    addMessageToChat({
      id: chat_item.id,
      role: chat_item.role,
      content: chat_item.content,
      timestamp
    });
  }
});
```

## How to Send Edit Requests

### Single Message Edit
```typescript
// Update message content
const editRequest = {
  edits: [{
    id: "message_123",
    content: "Updated message content"
  }]
};

const response = await rpcClient.call('edit_chat_context', editRequest);
```

### Delete Message
```typescript
// Delete message
const deleteRequest = {
  edits: [{
    id: "message_123",
    delete: true
  }]
};

const response = await rpcClient.call('edit_chat_context', deleteRequest);
```

### Batch Operations
```typescript
// Multiple edits in one request
const batchRequest = {
  edits: [
    { id: "msg1", content: "Updated content" },
    { id: "msg2", delete: true },
    { id: "msg3", content: "Another update" }
  ]
};

const response = await rpcClient.call('edit_chat_context', batchRequest);
```

## Response Format

```typescript
interface EditResponse {
  success: boolean;
  data?: {
    updated_count: number;
    deleted_count: number;
    total_operations: number;
  };
  error?: {
    code: string;
    message: string;
  };
}
```

## Implementation Example

```typescript
class ChatManager {
  private messages = new Map<string, ChatMessage>();
  
  // Listen for updates
  constructor(rpcClient: any, sessionId: string) {
    rpcClient.on('chat_context_update', (data) => {
      if (data.session_id === sessionId) {
        this.addMessage(data.chat_item);
      }
    });
  }
  
  // Send edit request
  async editMessage(id: string, content: string) {
    try {
      const response = await this.rpcClient.call('edit_chat_context', {
        edits: [{ id, content }]
      });
      
      if (response.success) {
        // Update local state
        this.updateMessage(id, content);
      }
    } catch (error) {
      console.error('Edit failed:', error);
    }
  }
  
  // Send delete request
  async deleteMessage(id: string) {
    try {
      const response = await this.rpcClient.call('edit_chat_context', {
        edits: [{ id, delete: true }]
      });
      
      if (response.success) {
        // Remove from local state
        this.messages.delete(id);
      }
    } catch (error) {
      console.error('Delete failed:', error);
    }
  }
}
```

## Key Points

1. **Message IDs**: Preserved from backend for editing operations
2. **Session Scoping**: Only process messages for current session
3. **Batch Support**: Multiple edits in single request for efficiency
4. **Error Handling**: Check response.success and handle errors
5. **Real-time**: Updates received via RPC events, not polling

That's it! The backend handles message processing and timing - frontend just needs to listen for updates and send edit requests.
