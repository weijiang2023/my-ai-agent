import React, { useState, useEffect } from 'react';
import { render, Text, Box, Newline } from 'ink';
import Spinner from 'ink-spinner';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// --- MEMORY SYSTEM ---
const MEMORY_FILE = path.join(process.cwd(), '.agent_memory.json');

function loadMemory(){
    if (fs.existsSync(MEMORY_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'))
        } catch (e) {
            return [];
        }
    }
    return [];
}

function saveMemory(history: any[]){
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

// --- AGENT LOGIC (Your existing tools and model setup) ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [
        {
            functionDeclarations: [
                { name: 'run_command', description: 'Run bash command', parameters: { type: SchemaType.OBJECT, properties: { command: { type: SchemaType.STRING } }, required: ['command'] } },
                { name: 'read_file', description: 'Read file', parameters: { type: SchemaType.OBJECT, properties: { path: { type: SchemaType.STRING } }, required: ['path'] } }
            ]
        }
    ],
    systemInstruction: `
        You are a world-class autonomous Senior Software Engineer.
        Your goal is to complete the user's request using your tools.

        CRITICAL RULES:
        1. NEVER say "I do not have the ability". You have the 'run_command' tool, which means you can do ANYTHING a terminal can do.
        2. If you need to search for text in the codebase, use 'run_command' with 'grep -rnw . -e "search_term"'.
        3. If you need to find files, use 'run_command' with 'find . -name "pattern"' or 'ls -R'.
        4. Do NOT ask the user for file paths. You are autonomous. Find them yourself.
    `,
});

// --- TUI COMPONENT ---
const AgentTUI = ({ goal }: { goal: string }) => {
    const [status, setStatus] = useState<'thinking' | 'acting' | 'done'>('thinking');
    const [lastAction, setLastAction] = useState<string>('');
    const [history, setHistory] = useState<string[]>([]);
    const [finalAnswer, setFinalAnswer] = useState<string>('');
    const [memoryStatus, setMemoryStatus] = useState<string>('No memory found.');

    useEffect(() => {
        async function startLoop() {
            // 1. LOAD MEMORY
            const previousHistory = loadMemory();
            if (previousHistory.length > 0) {
                setMemoryStatus(`Loaded ${previousHistory.length} previous messages.`);
            }
            
            // 2. START CHAT WITH HISTORY
            const chat = model.startChat({
                history: previousHistory,
            });

            let payload: any = goal;

            while (true) {
                setStatus('thinking');
                
                try {
                    const result = await chat.sendMessage(payload);
                    const response = result.response;
                    const calls = response.functionCalls();
                    
                    if (!calls || calls.length === 0) {
                        setFinalAnswer(response.text());
                        setStatus('done');

                        // 3. Save the updated history to disk before exiting!
                        const fullHistory = await chat.getHistory();
                        saveMemory(fullHistory);

                        break;
                    }

                    const call = calls[0];
                    setLastAction(`${call.name}: ${JSON.stringify(call.args)}`);
                    setStatus('acting');

                    let output = "";
                    try {
                        if (call.name === 'run_command') output = execSync(call.args.command as string, { encoding: 'utf8' });
                        if (call.name === 'read_file') output = fs.readFileSync(call.args.path as string, 'utf8');
                    } catch (e: any) { output = `Error: ${e.message}`; }

                    setHistory(prev => [...prev, `✔ ${call.name}`]);
                    payload = [{ functionResponse: { name: call.name, response: { output } } }];
                } catch (error: any) {
                    setFinalAnswer(`Fatal Error: ${error.message}`);
                    setStatus('done');
                    break;
                }
            }
        }
        startLoop();
    }, [goal]);

    return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
            <Text color="blue" dimColor>🧠 {memoryStatus}</Text>
            <Text bold color="yellow">🚀 GOAL: {goal}</Text>
            <Newline />
            
            <Box flexDirection="column">
                {history.map((item, i) => (
                    <Text key={i} color="gray">{item}</Text>
                ))}
            </Box>
            
            {status === 'thinking' && (
                <Text color="magenta">
                    <Spinner type="dots" /> Thinking...
                </Text>
            )}

            {status === 'acting' && (
                <Text color="cyan">
                    ⚙️  Executing: <Text italic>{lastAction}</Text>
                </Text>
            )}
            
            {status === 'done' && (
                <Box flexDirection="column" marginTop={1}>
                    <Text color="green" bold>✅ TASK COMPLETED</Text>
                    <Text>{finalAnswer}</Text>
                </Box>
            )}
        </Box>
    );
};

// --- ENTRY POINT ---
const userGoal = process.argv.slice(2).join(' ') || "List files";
render(<AgentTUI goal={userGoal} />);