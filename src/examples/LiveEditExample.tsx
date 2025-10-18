import React, { useState } from 'react';
import LiveEditChat from '../components/LiveEditChat';

// Mock RPC client for demonstration
class MockRPCClient {
  private listeners: Map<string, Function[]> = new Map();
  private messageId = 0;

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  async call(method: string, data: any) {
    console.log(`RPC Call: ${method}`, data);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Mock responses
    if (method === 'edit_chat_context') {
      const { edits } = data;
      const updates = edits.filter((edit: any) => !edit.delete).length;
      const deletions = edits.filter((edit: any) => edit.delete).length;
      
      return {
        success: true,
        data: {
          updated_count: updates,
          deleted_count: deletions,
          total_operations: edits.length
        }
      };
    }
    
    return { success: false, error: { message: 'Method not implemented' } };
  }

  // Simulate incoming messages
  simulateMessage(sessionId: string, role: 'user' | 'assistant', content: string) {
    const messageId = `msg_${++this.messageId}`;
    const timestamp = Date.now();
    
    const eventData = {
      chat_item: {
        id: messageId,
        role,
        content
      },
      session_id: sessionId,
      timestamp
    };
    
    const callbacks = this.listeners.get('chat_context_update') || [];
    callbacks.forEach(callback => callback(eventData));
  }
}

export const LiveEditExample: React.FC = () => {
  const [sessionId] = useState('session_123');
  const [rpcClient] = useState(() => new MockRPCClient());
  const [error, setError] = useState<string | null>(null);

  // Simulate some initial messages
  React.useEffect(() => {
    const timer = setTimeout(() => {
      rpcClient.simulateMessage(sessionId, 'user', 'Hello, how are you today?');
    }, 1000);

    const timer2 = setTimeout(() => {
      rpcClient.simulateMessage(sessionId, 'assistant', 'I\'m doing well, thank you for asking! How can I help you today?');
    }, 2000);

    const timer3 = setTimeout(() => {
      rpcClient.simulateMessage(sessionId, 'user', 'I need help with my project.');
    }, 3000);

    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [rpcClient, sessionId]);

  const handleError = (errorMessage: string) => {
    setError(errorMessage);
    setTimeout(() => setError(null), 5000); // Clear error after 5 seconds
  };

  const addTestMessage = () => {
    const messages = [
      'This is a test message for editing.',
      'Another message to demonstrate the live edit feature.',
      'You can edit or delete any of these messages.',
      'The changes are synchronized with the backend in real-time.'
    ];
    
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    const role = Math.random() > 0.5 ? 'user' : 'assistant';
    
    rpcClient.simulateMessage(sessionId, role, randomMessage);
  };

  return (
    <div className="live-edit-example">
      <div className="header">
        <h1>Live Edit Chat Demo</h1>
        <p>This demonstrates the live edit functionality for conversation messages.</p>
        
        <div className="controls">
          <button onClick={addTestMessage} className="add-message-btn">
            Add Test Message
          </button>
        </div>
        
        {error && (
          <div className="error-message">
            Error: {error}
          </div>
        )}
      </div>

      <LiveEditChat
        sessionId={sessionId}
        rpcClient={rpcClient}
        onError={handleError}
      />

      <div className="features">
        <h3>Features Demonstrated:</h3>
        <ul>
          <li>✅ Real-time message updates via RPC</li>
          <li>✅ Inline message editing</li>
          <li>✅ Message deletion</li>
          <li>✅ Batch operations</li>
          <li>✅ Optimistic updates</li>
          <li>✅ Loading states</li>
          <li>✅ Error handling</li>
          <li>✅ Debounced API calls</li>
        </ul>
      </div>

      <div className="instructions">
        <h3>How to Use:</h3>
        <ol>
          <li>Wait for test messages to appear</li>
          <li>Click "Edit" on any message to modify it</li>
          <li>Use Ctrl+Enter to save, Escape to cancel</li>
          <li>Click "Delete" to remove messages</li>
          <li>Try the batch operation button</li>
          <li>Add more messages with the "Add Test Message" button</li>
        </ol>
      </div>
    </div>
  );
};

// Additional styles for the example
const exampleStyles = `
.live-edit-example {
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.header {
  text-align: center;
  margin-bottom: 30px;
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 12px;
}

.header h1 {
  margin: 0 0 10px 0;
  font-size: 2.5rem;
  font-weight: 700;
}

.header p {
  margin: 0 0 20px 0;
  font-size: 1.1rem;
  opacity: 0.9;
}

.controls {
  margin: 20px 0;
}

.add-message-btn {
  background: #4caf50;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 6px;
  font-size: 16px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.add-message-btn:hover {
  background: #45a049;
}

.error-message {
  background: #f44336;
  color: white;
  padding: 12px;
  border-radius: 6px;
  margin: 10px 0;
  text-align: center;
}

.features, .instructions {
  margin-top: 30px;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
  border-left: 4px solid #2196f3;
}

.features h3, .instructions h3 {
  margin-top: 0;
  color: #333;
}

.features ul {
  list-style: none;
  padding: 0;
}

.features li {
  padding: 8px 0;
  border-bottom: 1px solid #e0e0e0;
}

.features li:last-child {
  border-bottom: none;
}

.instructions ol {
  padding-left: 20px;
}

.instructions li {
  margin: 8px 0;
  line-height: 1.6;
}
`;

// Add example styles
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = exampleStyles;
  document.head.appendChild(styleSheet);
}

export default LiveEditExample;













