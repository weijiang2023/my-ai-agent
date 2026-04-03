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

// Setup the model with the tools
const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{functionDeclarations: [runCommandTool, readFileTool]}],
    systemInstruction: `
        You are an autonomous Senior Software Engineer.
        Your goal is to fulfill the user's request by exploring the codebase.

        Rules:
        1. If you don't know the file structure, use 'run_command' with 'ls' to find it.
        2. If you need to search for text, use 'run_command' with 'grep'.
        3. Do not ask the user for file paths if you can find them yourself.
        4. Be proactive. Work step-by-step until the goal is achieved.
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