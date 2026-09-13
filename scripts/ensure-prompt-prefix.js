#!/usr/bin/env node

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline/promises');

const configDirectory = path.join(os.homedir(), '.purplemux');
const configPath = path.join(configDirectory, 'config.json');

const readConfig = async () => {
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
};

const main = async () => {
  const config = await readConfig();
  if (typeof config.promptPrefix === 'string' && config.promptPrefix.length > 0) return;

  const candidate = `${os.userInfo().username}@${os.hostname()}:`;
  process.stdout.write(`Prompt prefix: ${candidate}\n`);

  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try {
    answer = await input.question('Use this prompt prefix? [Y/n] ');
  } finally {
    input.close();
  }

  if (answer.trim() && !/^y(?:es)?$/i.test(answer.trim())) return;

  await fs.mkdir(configDirectory, { recursive: true });
  const temporaryPath = `${configPath}.tmp`;
  try {
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify({ ...config, promptPrefix: candidate, updatedAt: new Date().toISOString() }, null, 2)}\n`,
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
