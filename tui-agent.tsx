import React, { useState, useEffect } from 'react';
import { render, Text, Box, Newline } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// --- MEMORY SYSTEM ---
const MEMORY_FILE = path.join(process.cwd(), '.agent_memory.json');

function loadMemory() {
  if (fs.existsSync(MEMORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    } catch (e) {
      return [];
    }
  }
  return [];
}

function saveMemory(history: any[]) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

// --- AGENT LOGIC ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash',
  tools: [
    {
      functionDeclarations: [
        { name: 'run_command', description: 'Run bash command', parameters: { type: SchemaType.OBJECT, properties: { command: { type: SchemaType.STRING } }, required: ['command'] } },
        { name: 'read_file', description: 'Read file', parameters: { type: SchemaType.OBJECT, properties: { path: { type: SchemaType.STRING } }, required: ['path'] } },
        { name: 'write_file', description: 'Create or overwrite a file with new content. MUST provide the ENTIRE file content.', parameters: { type: SchemaType.OBJECT, properties: { path: { type: SchemaType.STRING }, content: { type: SchemaType.STRING } }, required: ['path', 'content'] } }
      ]
    }
  ],
  systemInstruction: `
        You are a world-class autonomous Senior Software Engineer.
        Your goal is to complete the user's request using your tools.

        WORKSPACE RULES:
        1. Your workspace is the CURRENT DIRECTORY only. Do NOT search outside of it (e.g. do not use 'find /').
        2. ALWAYS use relative paths (e.g. './src' instead of '/src').
        3. Ignore 'node_modules', '.git', and other system noise unless explicitly asked.
        4. CONSISTENCY: When you update a variable (like a port number or database URL), ALWAYS search the entire file and update every other place that value is mentioned (including logs and strings).

        TOOL RULES:
        1. NEVER say "I do not have the ability". You have 'run_command', so you can do anything a shell can do.
        2. Do NOT ask the user for file paths. Find them yourself using 'ls -R' or 'find . -name "pattern"'.
        3. If a tool returns an error, analyze the error and try a different approach (e.g. if 'grep' fails, try 'find').
        4. When writing code (JavaScript/TypeScript/Python), ALWAYS ensure the syntax is correct. Double-check quotes, semicolons, and brackets before calling 'write_file'.

        COMMUNICATION:
        1. Be proactive and concise.
        2. Once a task is done, provide a brief summary of what you did.
    `
});

// We keep the session outside the render cycle to prevent resets
let chatSession: any = null;

// --- TUI COMPONENT ---
const AgentTUI = () => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'thinking' | 'acting'>('idle');
  const [lastAction, setLastAction] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<{ role: 'You' | 'Agent' | 'Error', text: string }[]>([]);
  const [toolHistory, setToolHistory] = useState<string[]>([]);
  const [memoryStatus, setMemoryStatus] = useState<string>('Initializing...');

  // 1. Setup Chat on Startup
  useEffect(() => {
    const previousHistory = loadMemory();
    if (previousHistory.length > 0) {
      setMemoryStatus(`Loaded ${previousHistory.length} previous messages.`);
    } else {
      setMemoryStatus('Ready. New session started.');
    }
    chatSession = model.startChat({ history: previousHistory });
  }, []);

  // 2. Handle User Submission
  const handleSubmit = async (userText: string) => {
    if (!userText.trim() || status !== 'idle' || !chatSession) return;

    // Clear UI state for new turn
    setChatHistory(prev => [...prev, { role: 'You', text: userText }]);
    setQuery('');
    setToolHistory([]);
    
    let payload: any = userText;
    let isTurnComplete = false;

    // 3. The ReAct Loop
    while (!isTurnComplete) {
      setStatus('thinking');
      try {
        const result = await chatSession.sendMessage(payload);
        const response = result.response;
        const calls = response.functionCalls();

        if (!calls || calls.length === 0) {
          // Final Text Reply
          setChatHistory(prev => [...prev, { role: 'Agent', text: response.text() }]);
          setStatus('idle');
          
          // Save Memory
          const fullHistory = await chatSession.getHistory();
          saveMemory(fullHistory);
          isTurnComplete = true;
          break;
        }

        // Handle Tool Call
        const call = calls[0];
        setLastAction(`${call.name}: ${JSON.stringify(call.args)}`);
        setStatus('acting');

        let output = "";
        try {
          if (call.name === 'run_command') output = execSync(call.args.command as string, { encoding: 'utf8' });
          if (call.name === 'read_file') output = fs.readFileSync(call.args.path as string, 'utf8');
          if (call.name === 'write_file') {
            fs.writeFileSync(call.args.path as string, call.args.content as string, 'utf8');
            output = `File successfully written to ${call.args.path}`;
          }
        } catch (e: any) { output = `Error: ${e.message}` }

        setToolHistory(prev => [...prev, `✔ ${call.name}`]);
        payload = [{ functionResponse: { name: call.name, response: { output } } }];

      } catch (err: any) {
        setChatHistory(prev => [...prev, { role: 'Error', text: err.message }]);
        setStatus('idle');
        isTurnComplete = true;
      }
    }
  };

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      {/* Header */}
      <Box borderBottomStyle="single" borderColor="gray" paddingBottom={1} marginBottom={1}>
        <Text bold color="yellow">🤖 AI AGENT TERMINAL</Text>
        <Text color="gray">  |  🧠 {memoryStatus}</Text>
      </Box>

      {/* Chat Messages */}
      <Box flexDirection="column" marginBottom={1}>
        {chatHistory.map((msg, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Text bold color={msg.role === 'You' ? 'green' : msg.role === 'Agent' ? 'cyan' : 'red'}>
              {msg.role}:
            </Text>
            <Text>{msg.text}</Text>
          </Box>
        ))}
      </Box>

      {/* Background Processing Logs */}
      {status !== 'idle' && (
        <Box flexDirection="column" marginY={1}>
          {toolHistory.map((h, i) => <Text key={i} color="gray">{h}</Text>)}
          {status === 'thinking' && <Text color="magenta"><Spinner type="dots" /> Thinking...</Text>}
          {status === 'acting' && <Text color="yellow">⚙️  Executing: <Text italic>{lastAction}</Text></Text>}
        </Box>
      )}

      {/* Input Prompt */}
      {status === 'idle' && (
        <Box>
          <Text bold color="green">❯ </Text>
          <TextInput 
            value={query} 
            onChange={setQuery} 
            onSubmit={handleSubmit} 
            placeholder="What should we build today?"
          />
        </Box>
      )}
    </Box>
  );
};

render(<AgentTUI />);