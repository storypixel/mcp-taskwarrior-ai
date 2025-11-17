#!/usr/bin/env node

import { spawn } from 'child_process';
import { createInterface } from 'readline';

// Start the MCP server
const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

// Create interface for reading server output
const rl = createInterface({
  input: server.stdout,
  crlfDelay: Infinity
});

// Log all server responses
rl.on('line', (line) => {
  try {
    const json = JSON.parse(line);
    console.log('Server response:', JSON.stringify(json, null, 2));
  } catch {
    // Not JSON, ignore
  }
});

// Wait for server to be ready
setTimeout(async () => {
  console.log('Testing MCP Taskwarrior AI Bridge...\n');

  // Test 1: Initialize
  console.log('1. Sending initialize request...');
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '1.0.0',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    },
    id: 1
  }) + '\n');

  await new Promise(resolve => setTimeout(resolve, 500));

  // Test 2: List tools
  console.log('\n2. Listing available tools...');
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {},
    id: 2
  }) + '\n');

  await new Promise(resolve => setTimeout(resolve, 500));

  // Test 3: Call task_natural tool
  console.log('\n3. Testing natural language: "add test the taskwarrior bridge"');
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'task_natural',
      arguments: {
        query: 'add test the taskwarrior bridge'
      }
    },
    id: 3
  }) + '\n');

  await new Promise(resolve => setTimeout(resolve, 500));

  // Test 4: List tasks
  console.log('\n4. Testing natural language: "show me all tasks"');
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'task_natural',
      arguments: {
        query: 'show me all tasks'
      }
    },
    id: 4
  }) + '\n');

  await new Promise(resolve => setTimeout(resolve, 500));

  // Test 5: Where am I
  console.log('\n5. Testing context awareness...');
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'task_where_am_i',
      arguments: {}
    },
    id: 5
  }) + '\n');

  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('\nTests complete. Press Ctrl+C to exit.');
}, 1000);

server.on('error', (err) => {
  console.error('Server error:', err);
});

server.on('exit', (code) => {
  console.log('Server exited with code:', code);
  process.exit(code || 0);
});