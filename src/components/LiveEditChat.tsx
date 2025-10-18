import React, { useState, useEffect, useCallback } from 'react';
import { debounce } from 'lodash';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface EditOperation {
  id: string;
  content?: string;
  delete?: boolean;
}

interface EditRequest {
  edits: EditOperation[];
}

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

interface LiveEditChatProps {
  sessionId: string;
  rpcClient: any; // Replace with your actual RPC client type
  onError?: (error: string) => void;
}

export const LiveEditChat: React.FC<LiveEditChatProps> = ({
  sessionId,
  rpcClient,
  onError
}) => {
  const [messages, setMessages] = useState<Map<string, ChatMessage>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [loadingStates, setLoadingStates] = useState<Set<string>>(new Set());

  // Debounced edit function to avoid excessive API calls
  const debouncedEdit = useCallback(
    debounce(async (edits: EditOperation[]) => {
      try {
        const response: EditResponse = await rpcClient.call('edit_chat_context', { edits });
        
        if (response.success) {
          console.log(`Edit completed: ${response.data?.updated_count} updated, ${response.data?.deleted_count} deleted`);
        } else {
          throw new Error(response.error?.message || 'Edit failed');
        }
      } catch (error) {
        console.error('Edit failed:', error);
        onError?.(error instanceof Error ? error.message : 'Edit failed');
      }
    }, 500),
    [rpcClient, onError]
  );

  // Listen for real-time chat updates
  useEffect(() => {
    const handleChatUpdate = (data: any) => {
      const { chat_item, session_id, timestamp } = data;
      
      if (session_id === sessionId) {
        const newMessage: ChatMessage = {
          id: chat_item.id,
          role: chat_item.role,
          content: chat_item.content,
          timestamp
        };
        
        setMessages(prev => new Map(prev).set(chat_item.id, newMessage));
      }
    };

    // Subscribe to chat context updates
    rpcClient.on('chat_context_update', handleChatUpdate);
    
    return () => {
      rpcClient.off('chat_context_update', handleChatUpdate);
    };
  }, [rpcClient, sessionId]);

  // Handle message update
  const handleUpdateMessage = async (id: string, content: string) => {
    setLoadingStates(prev => new Set(prev).add(id));
    
    try {
      await debouncedEdit([{ id, content }]);
      
      // Optimistic update
      setMessages(prev => {
        const newMap = new Map(prev);
        const message = newMap.get(id);
        if (message) {
          newMap.set(id, { ...message, content });
        }
        return newMap;
      });
      
      setEditingId(null);
      setEditContent('');
    } catch (error) {
      // Revert optimistic update on error
      console.error('Update failed:', error);
    } finally {
      setLoadingStates(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  // Handle message deletion
  const handleDeleteMessage = async (id: string) => {
    setLoadingStates(prev => new Set(prev).add(id));
    
    try {
      await debouncedEdit([{ id, delete: true }]);
      
      // Optimistic update
      setMessages(prev => {
        const newMap = new Map(prev);
        newMap.delete(id);
        return newMap;
      });
    } catch (error) {
      console.error('Delete failed:', error);
      onError?.(error instanceof Error ? error.message : 'Delete failed');
    } finally {
      setLoadingStates(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  // Start editing a message
  const startEditing = (message: ChatMessage) => {
    setEditingId(message.id);
    setEditContent(message.content);
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    setEditContent('');
  };

  // Save edit
  const saveEdit = () => {
    if (editingId && editContent.trim()) {
      handleUpdateMessage(editingId, editContent.trim());
    }
  };

  // Handle batch operations
  const handleBatchEdit = async (operations: EditOperation[]) => {
    try {
      const response: EditResponse = await rpcClient.call('edit_chat_context', { edits: operations });
      
      if (response.success) {
        console.log(`Batch edit completed: ${response.data?.updated_count} updated, ${response.data?.deleted_count} deleted`);
        
        // Update local state based on operations
        setMessages(prev => {
          const newMap = new Map(prev);
          
          operations.forEach(op => {
            if (op.delete) {
              newMap.delete(op.id);
            } else if (op.content) {
              const message = newMap.get(op.id);
              if (message) {
                newMap.set(op.id, { ...message, content: op.content });
              }
            }
          });
          
          return newMap;
        });
      } else {
        throw new Error(response.error?.message || 'Batch edit failed');
      }
    } catch (error) {
      console.error('Batch edit failed:', error);
      onError?.(error instanceof Error ? error.message : 'Batch edit failed');
    }
  };

  return (
    <div className="live-edit-chat">
      <div className="messages-container">
        {Array.from(messages.values()).map(message => (
          <div key={message.id} className={`message ${message.role}`}>
            {editingId === message.id ? (
              <div className="edit-mode">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.ctrlKey) {
                      saveEdit();
                    } else if (e.key === 'Escape') {
                      cancelEditing();
                    }
                  }}
                  disabled={loadingStates.has(message.id)}
                  className="edit-textarea"
                />
                <div className="edit-actions">
                  <button 
                    onClick={saveEdit}
                    disabled={loadingStates.has(message.id)}
                    className="save-btn"
                  >
                    {loadingStates.has(message.id) ? 'Saving...' : 'Save'}
                  </button>
                  <button 
                    onClick={cancelEditing}
                    disabled={loadingStates.has(message.id)}
                    className="cancel-btn"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="view-mode">
                <div className="message-content">{message.content}</div>
                <div className="message-actions">
                  <button 
                    onClick={() => startEditing(message)}
                    disabled={loadingStates.has(message.id)}
                    className="edit-btn"
                  >
                    Edit
                  </button>
                  <button 
                    onClick={() => handleDeleteMessage(message.id)}
                    disabled={loadingStates.has(message.id)}
                    className="delete-btn"
                  >
                    {loadingStates.has(message.id) ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            )}
            <div className="message-meta">
              <span className="role">{message.role}</span>
              <span className="timestamp">
                {new Date(message.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}
      </div>
      
      {/* Batch operations example */}
      <div className="batch-operations">
        <h4>Batch Operations</h4>
        <button 
          onClick={() => {
            const operations: EditOperation[] = Array.from(messages.values())
              .slice(0, 3)
              .map(msg => ({ id: msg.id, content: `[BATCH] ${msg.content}` }));
            
            if (operations.length > 0) {
              handleBatchEdit(operations);
            }
          }}
          className="batch-update-btn"
        >
          Batch Update First 3 Messages
        </button>
      </div>
    </div>
  );
};

// CSS styles (you can move these to a separate CSS file)
const styles = `
.live-edit-chat {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.messages-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  background: #f9f9f9;
}

.message.user {
  background: #e3f2fd;
  border-color: #2196f3;
}

.message.assistant {
  background: #f3e5f5;
  border-color: #9c27b0;
}

.edit-mode {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.edit-textarea {
  width: 100%;
  min-height: 80px;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  resize: vertical;
}

.edit-actions {
  display: flex;
  gap: 8px;
}

.view-mode {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-content {
  line-height: 1.5;
  white-space: pre-wrap;
}

.message-actions {
  display: flex;
  gap: 8px;
}

.message-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #666;
  margin-top: 8px;
}

button {
  padding: 6px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 14px;
}

button:hover:not(:disabled) {
  background: #f0f0f0;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.save-btn {
  background: #4caf50;
  color: white;
  border-color: #4caf50;
}

.cancel-btn {
  background: #f44336;
  color: white;
  border-color: #f44336;
}

.edit-btn {
  background: #2196f3;
  color: white;
  border-color: #2196f3;
}

.delete-btn {
  background: #f44336;
  color: white;
  border-color: #f44336;
}

.batch-operations {
  margin-top: 24px;
  padding: 16px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #f5f5f5;
}

.batch-update-btn {
  background: #ff9800;
  color: white;
  border-color: #ff9800;
}
`;

// Add styles to document
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}

export default LiveEditChat;













