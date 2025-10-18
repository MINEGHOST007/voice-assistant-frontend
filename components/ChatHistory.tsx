import React from 'react';
import useCombinedChatMessages, { CombinedChatMessage } from '../hooks/useCombinedChatMessages';
import ChatInput from './ChatInput';

interface ChatHistoryProps {
  className?: string;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({ className = '' }) => {
  const chatMessages = useCombinedChatMessages();

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const renderMessage = (message: CombinedChatMessage) => {
    const isAssistant = message.role === 'assistant';
    
    return (
      <div
        key={message.id}
        className={`mb-3 p-3 rounded-lg ${
          isAssistant 
            ? 'bg-blue-50 border-l-4 border-blue-400' 
            : 'bg-gray-50 border-l-4 border-gray-400'
        }`}
      >
        <div className="flex justify-between items-start mb-1">
          <span className={`text-sm font-medium ${
            isAssistant ? 'text-blue-700' : 'text-gray-700'
          }`}>
            {isAssistant ? '🤖 Assistant' : '👤 User'}
            {message.from?.identity && ` (${message.from.identity})`}
          </span>
          <span className="text-xs text-gray-500">
            {formatTimestamp(message.timestamp)}
          </span>
        </div>
        <p className="text-gray-800 leading-relaxed">{message.message}</p>
      </div>
    );
  };

  return (
    <div className={`chat-history ${className}`}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-800 border-b border-gray-200 pb-2">
          💬 Chat History
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          {chatMessages.length} messages
        </p>
      </div>
      
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {chatMessages.length > 0 ? (
          chatMessages.map(renderMessage)
        ) : (
          <div className="text-center py-8 text-gray-500">
            <p>No chat messages yet</p>
            <p className="text-sm mt-1">Messages will appear here as the conversation progresses</p>
          </div>
        )}
      </div>
      
      <div className="mt-4 pt-4 border-t border-gray-200">
        <ChatInput />
      </div>
    </div>
  );
};

export default ChatHistory; 