#!/usr/bin/env node

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const configDirectory = path.join(os.homedir(), '.purplemux');
const configPath = path.join(configDirectory, 'config.json');

const readConfig = async () => {
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch {
    return {};
  }
};

const askForConfirmation = async () => {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let settled = false;
    input.once('close', () => {
      if (settled) return;
      settled = true;
      resolve(null);
    });
    input.question('Use this prompt prefix? [Y/n] ', (answer) => {
      if (settled) return;
      settled = true;
      resolve(answer);
      input.close();
    });
  });
};

const main = async () => {
  const config = await readConfig();
  if (typeof config.promptPrefix === 'string') return;
  if (!process.stdin.isTTY && process.env.PURPLEMUX_FORCE_PROMPT !== '1') return;

  const candidate = `${os.userInfo().username}@${os.hostname()}:`;
  process.stdout.write(`Prompt prefix: ${candidate}\n`);

  const answer = await askForConfirmation();
  // A convenience prompt must never prevent service/CI launches from starting.
  if (answer === null) return;

  const accepted = !answer.trim() || /^y(?:es)?$/i.test(answer.trim());

  await fs.mkdir(configDirectory, { recursive: true });
  const temporaryPath = `${configPath}.tmp`;
  try {
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify({ ...config, promptPrefix: accepted ? candidate : '', updatedAt: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await fs.rename(temporaryPath, configPath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
};

main().catch((error) => {
  console.error(`[purplemux] Failed to configure prompt prefix: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
