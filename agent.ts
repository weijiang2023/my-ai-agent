import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { execSync } from 'child_process';
import * as fs from 'fs';

// 1. Setup the Brain
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// 2. Define the "Tools" (The Agent's Hands)
const runCommandTool = {
    name: 'run_command',
    description: 'Execute a shell command and return the output.',
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            command: { type: SchemaType.STRING, description: 'The bash command to run' },
        },
        required: ['command'],
    },
};

const readFileTool = {
    name: 'read_file',
    description: 'Read the contents of a file',
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            path: { type: SchemaType.STRING, description: 'The file path' },
        },
        required: ['path'],
    },
};

const writeFileTool = {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing one with new content.',
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            path: { type: SchemaType.STRING, description: 'The file path' },
            content: { type: SchemaType.STRING, description: 'The full content to write to the file' },
        },
        required: ['path', 'content'],
    },
};

const appendFileTool = {
    name: 'append_to_file',
    description: 'Add text to the very end of an existing file safely.',
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            path: { type: SchemaType.STRING },
            content: { type: SchemaType.STRING },
        },
        required: ['path', 'content'],
    },
};

// Setup the model with the tools
const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{functionDeclarations: [runCommandTool, readFileTool, writeFileTool, appendFileTool]}],
    systemInstruction: `
        You are a world-class autonomous Senior Software Engineer.

        MISSION:
        Your goal is to complete the user's request using your tools immediately.

        RULES:
        1. NEVER ask for clarification or permission if the request is even slightly clear.
        2. If a user says "Add a TODO", just make up a reasonable TODO (like "// TODO: Add more tools") or use the specific text if provided.
        3. Use your tools (run_command, read_file, append_to_file, write_file) proactively.
        4. If you don't know something, find it using 'ls' or 'grep'.
        5. Be concise. Once the task is done, say "Task completed: [brief description]".
    `,
});

// 3. The Core Agent Loop (ReAct Pattern)
async function startAgent(userGoal: string) {
    console.log(`\n🚀 Goal: ${userGoal}\n`);

    // startChat() automatically maintains the conversation history!
    const chat = model.startChat();
    
    // The first payload is the user's string. Subsequent payloads will be tool results.
    let payload: string | Array<any> = userGoal;
    
    while (true) {
        try{
            // --- THINKING PHASE ---
            const result = await chat.sendMessage(payload);
            const response = result.response;

            // Check if Gemini wants to use a tool
            const functionCalls = response.functionCalls();

            if (!functionCalls || functionCalls.length === 0) {
                // No more tools? We are done.
                console.log(`\n✅ Finished: ${response.text()}`);
                break;
            }

            // --- ACTING PHASE ---
            const call = functionCalls[0];
            console.log(`\n🛠️  Action: [${call.name}] ${JSON.stringify(call.args)}`);

            let toolOutput = "";
            try {
                if (call.name === 'run_command') {
                    const cmd = call.args.command as string;
                    toolOutput = execSync(cmd, { encoding: 'utf8' });
                } else if (call.name === 'read_file') {
                    const path = call.args.path as string;
                    toolOutput = fs.readFileSync(path, 'utf8');
                } else if (call.name === 'write_file') {
                    const path = call.args.path as string;
                    const content = call.args.content as string;
                    fs.writeFileSync(path, content, 'utf8');
                    toolOutput = `File written successfully to ${path}`;
                } else if (call.name === 'append_to_file') {
                    fs.appendFileSync(call.args.path as string, '\n' + call.args.content as string, 'utf8');
                    toolOutput = `Successfully appended to ${call.args.path}`;
                }
            } catch (e: any) {
                toolOutput = `Error: ${e.message}`;
            }

            // --- OBSERVING PHASE ---
            console.log(`\n👀 Observation: (Output received, feeding back to AI...)`);

            // Format the result so Gemini understands it's the answer to its tool call
            payload = [{
                functionResponse: {
                    name: call.name,
                    response: { output: toolOutput } // Gemini requires the response to be an object
                }
            }];

        } catch (error) {
            console.error(error);
            break;
        }
    }
}

// 4. Entry Point
const goal = process.argv.slice(2).join(' ') || "List the files in this directory and tell me what is in package.json";
startAgent(goal).catch(console.error);
// TODO: Implement advanced planning
// TODO: Implement more sophisticated reasoning
// TODO: Implement a more sophisticated decision-making process
// TODO: Implement advanced planning strategies
// TODO: Implement advanced planning strategies
// TODO: Implement advanced planning
// TODO: Implement more sophisticated decision making