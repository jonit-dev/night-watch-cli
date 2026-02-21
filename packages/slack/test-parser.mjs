import { MessageParser } from './dist/message-parser.js';

const parser = new MessageParser();

console.log('Test 1 - claude direct provider:', parser.parseSlackProviderRequest('night watch claude fix the tests'));
console.log('Test 2 - codex direct provider:', parser.parseSlackProviderRequest('codex refactor this function'));
console.log('Test 3 - provider with hint:', parser.parseSlackProviderRequest('nw claude on beta: fix bug'));
console.log('Test 4 - job with PR:', parser.parseSlackJobRequest('https://github.com/org/alpha/pull/123 please review'));
console.log('Test 5 - priority test:', parser.parseSlackProviderRequest('night watch claude run tests'));
