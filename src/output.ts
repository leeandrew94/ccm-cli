import readline from 'node:readline';

export function ok(msg: string): void {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

export function err(msg: string): void {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
}

export function info(msg: string): void {
  console.log(`\x1b[34m→\x1b[0m ${msg}`);
}

export function warn(msg: string): void {
  console.log(`\x1b[33m!\x1b[0m ${msg}`);
}

export async function ask(prompt: string, defaultValue = ''): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`  ${prompt}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}
