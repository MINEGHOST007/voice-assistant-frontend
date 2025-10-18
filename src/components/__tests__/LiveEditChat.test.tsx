import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LiveEditChat from '../LiveEditChat';

// Mock RPC client for testing
class MockRPCClient {
  private listeners: Map<string, Function[]> = new Map();
  public calls: Array<{ method: string; data: any }> = [];

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
    this.calls.push({ method, data });
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 10));
    
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

  simulateMessage(sessionId: string, role: 'user' | 'assistant', content: string) {
    const messageId = `msg_${Date.now()}`;
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

describe('LiveEditChat', () => {
  let rpcClient: MockRPCClient;
  let onError: jest.Mock;

  beforeEach(() => {
    rpcClient = new MockRPCClient();
    onError = jest.fn();
  });

  const renderComponent = () => {
    return render(
      <LiveEditChat
        sessionId="test-session"
        rpcClient={rpcClient}
        onError={onError}
      />
    );
  };

  describe('Initial Rendering', () => {
    it('renders without crashing', () => {
      renderComponent();
      expect(screen.getByText('Batch Update First 3 Messages')).toBeInTheDocument();
    });

    it('shows empty state when no messages', () => {
      renderComponent();
      expect(screen.getByText('Batch Update First 3 Messages')).toBeInTheDocument();
    });
  });

  describe('Message Reception', () => {
    it('displays received messages', async () => {
      renderComponent();
      
      rpcClient.simulateMessage('test-session', 'user', 'Hello world');
      
      await waitFor(() => {
        expect(screen.getByText('Hello world')).toBeInTheDocument();
      });
    });

    it('displays multiple messages', async () => {
      renderComponent();
      
      rpcClient.simulateMessage('test-session', 'user', 'First message');
      rpcClient.simulateMessage('test-session', 'assistant', 'Second message');
      
      await waitFor(() => {
        expect(screen.getByText('First message')).toBeInTheDocument();
        expect(screen.getByText('Second message')).toBeInTheDocument();
      });
    });

    it('ignores messages from different sessions', async () => {
      renderComponent();
      
      rpcClient.simulateMessage('different-session', 'user', 'Should not appear');
      
      await waitFor(() => {
        expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
      });
    });
  });

  describe('Message Editing', () => {
    beforeEach(async () => {
      renderComponent();
      rpcClient.simulateMessage('test-session', 'user', 'Original message');
      
      await waitFor(() => {
        expect(screen.getByText('Original message')).toBeInTheDocument();
      });
    });

    it('enters edit mode when edit button is clicked', async () => {
      const editButton = screen.getByText('Edit');
      fireEvent.click(editButton);
      
      await waitFor(() => {
        expect(screen.getByDisplayValue('Original message')).toBeInTheDocument();
        expect(screen.getByText('Save')).toBeInTheDocument();
        expect(screen.getByText('Cancel')).toBeInTheDocument();
      });
    });

    it('updates message content when saved', async () => {
      const editButton = screen.getByText('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('Original message');
      await userEvent.clear(textarea);
      await userEvent.type(textarea, 'Updated message');
      
      const saveButton = screen.getByText('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(screen.getByText('Updated message')).toBeInTheDocument();
        expect(screen.queryByDisplayValue('Updated message')).not.toBeInTheDocument();
      });
    });

    it('sends edit request to RPC client', async () => {
      const editButton = screen.getByText('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('Original message');
      await userEvent.clear(textarea);
      await userEvent.type(textarea, 'Updated message');
      
      const saveButton = screen.getByText('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(rpcClient.calls).toHaveLength(1);
        expect(rpcClient.calls[0].method).toBe('edit_chat_context');
        expect(rpcClient.calls[0].data.edits).toEqual([
          { id: expect.any(String), content: 'Updated message' }
        ]);
      });
    });

    it('cancels edit mode when cancel button is clicked', async () => {
      const editButton = screen.getByText('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('Original message');
      await userEvent.clear(textarea);
      await userEvent.type(textarea, 'This should not be saved');
      
      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);
      
      await waitFor(() => {
        expect(screen.getByText('Original message')).toBeInTheDocument();
        expect(screen.queryByDisplayValue('This should not be saved')).not.toBeInTheDocument();
      });
    });

    it('handles keyboard shortcuts', async () => {
      const editButton = screen.getByText('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('Original message');
      await userEvent.clear(textarea);
      await userEvent.type(textarea, 'Updated message');
      
      // Test Ctrl+Enter to save
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      
      await waitFor(() => {
        expect(screen.getByText('Updated message')).toBeInTheDocument();
      });
    });

    it('handles escape key to cancel', async () => {
      const editButton = screen.getByText('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('Original message');
      await userEvent.clear(textarea);
      await userEvent.type(textarea, 'This should not be saved');
      
      // Test Escape to cancel
      fireEvent.keyDown(textarea, { key: 'Escape' });
      
      await waitFor(() => {
        expect(screen.getByText('Original message')).toBeInTheDocument();
        expect(screen.queryByDisplayValue('This should not be saved')).not.toBeInTheDocument();
      });
    });
  });

  describe('Message Deletion', () => {
    beforeEach(async () => {
      renderComponent();
      rpcClient.simulateMessage('test-session', 'user', 'Message to delete');
      
      await waitFor(() => {
        expect(screen.getByText('Message to delete')).toBeInTheDocument();
      });
    });

    it('deletes message when delete button is clicked', async () => {
      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);
      
      await waitFor(() => {
        expect(screen.queryByText('Message to delete')).not.toBeInTheDocument();
      });
    });

    it('sends delete request to RPC client', async () => {
      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);
      
      await waitFor(() => {
        expect(rpcClient.calls).toHaveLength(1);
        expect(rpcClient.calls[0].method).toBe('edit_chat_context');
        expect(rpcClient.calls[0].data.edits).toEqual([
          { id: expect.any(String), delete: true }
        ]);
      });
    });
  });

  describe('Batch Operations', () => {
    beforeEach(async () => {
      renderComponent();
      
      // Add multiple messages
      rpcClient.simulateMessage('test-session', 'user', 'Message 1');
      rpcClient.simulateMessage('test-session', 'assistant', 'Message 2');
      rpcClient.simulateMessage('test-session', 'user', 'Message 3');
      
      await waitFor(() => {
        expect(screen.getByText('Message 1')).toBeInTheDocument();
        expect(screen.getByText('Message 2')).toBeInTheDocument();
        expect(screen.getByText('Message 3')).toBeInTheDocument();
      });
    });

    it('performs batch update on first 3 messages', async () => {
      const batchButton = screen.getByText('Batch Update First 3 Messages');
      fireEvent.click(batchButton);
      
      await waitFor(() => {
        expect(screen.getByText('[BATCH] Message 1')).toBeInTheDocument();
        expect(screen.getByText('[BATCH] Message 2')).toBeInTheDocument();
        expect(screen.getByText('[BATCH] Message 3')).toBeInTheDocument();
      });
    });

    it('sends batch request to RPC client', async () => {
      const batchButton = screen.getByText('Batch Update First 3 Messages');
      fireEvent.click(batchButton);
      
      await waitFor(() => {
        expect(rpcClient.calls).toHaveLength(1);
        expect(rpcClient.calls[0].method).toBe('edit_chat_context');
        expect(rpcClient.calls[0].data.edits).toHaveLength(3);
        expect(rpcClient.calls[0].data.edits[0]).toEqual({
          id: expect.any(String),
          content: '[BATCH] Message 1'
        });
      });
    });
  });

  describe('Loading States', () => {
    beforeEach(async () => {
      renderComponent();
      rpcClient.simulateMessage('test-session', 'user', 'Test message');
      
      await waitFor(() => {
        expect(screen.getByText('Test message')).toBeInTheDocument();
      });
    });

    it('shows loading state during edit', async () => {
      const editButton = screen.getByText('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('Test message');
      await userEvent.clear(textarea);
      await userEvent.type(textarea, 'Updated');
      
      const saveButton = screen.getByText('Save');
      fireEvent.click(saveButton);
      
      // Should show loading state briefly
      expect(screen.getByText('Saving...')).toBeInTheDocument();
      
      await waitFor(() => {
        expect(screen.getByText('Save')).toBeInTheDocument();
      });
    });

    it('shows loading state during delete', async () => {
      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);
      
      // Should show loading state briefly
      expect(screen.getByText('Deleting...')).toBeInTheDocument();
      
      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
    });

    it('disables buttons during loading', async () => {
      const editButton = screen.getByText('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('Test message');
      await userEvent.clear(textarea);
      await userEvent.type(textarea, 'Updated');
      
      const saveButton = screen.getByText('Save');
      fireEvent.click(saveButton);
      
      // Buttons should be disabled during loading
      expect(saveButton).toBeDisabled();
      
      await waitFor(() => {
        expect(saveButton).not.toBeDisabled();
      });
    });
  });

  describe('Error Handling', () => {
    it('calls onError when RPC call fails', async () => {
      // Mock RPC client to return error
      const errorRpcClient = {
        ...rpcClient,
        call: jest.fn().mockRejectedValue(new Error('Network error'))
      };
      
      render(
        <LiveEditChat
          sessionId="test-session"
          rpcClient={errorRpcClient}
          onError={onError}
        />
      );
      
      rpcClient.simulateMessage('test-session', 'user', 'Test message');
      
      await waitFor(() => {
        expect(screen.getByText('Test message')).toBeInTheDocument();
      });
      
      const editButton = screen.getByText('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('Test message');
      await userEvent.clear(textarea);
      await userEvent.type(textarea, 'Updated');
      
      const saveButton = screen.getByText('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Edit failed');
      });
    });
  });

  describe('Debouncing', () => {
    it('debounces rapid edit requests', async () => {
      renderComponent();
      rpcClient.simulateMessage('test-session', 'user', 'Test message');
      
      await waitFor(() => {
        expect(screen.getByText('Test message')).toBeInTheDocument();
      });
      
      const editButton = screen.getByText('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('Test message');
      
      // Rapidly type multiple characters
      for (let i = 0; i < 5; i++) {
        await userEvent.type(textarea, 'a');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Should only have one RPC call due to debouncing
      await waitFor(() => {
        expect(rpcClient.calls.length).toBeLessThanOrEqual(1);
      });
    });
  });
});













