/** Positive native evidence only; an ordinary CLI fork/resume is still a root. */
export const isCodexSubagent = (meta: {
  source?: unknown; thread_source?: unknown; agent_path?: unknown;
}): boolean => {
  const source = meta.source;
  return (typeof source === 'object' && source !== null && Object.hasOwn(source, 'subagent'))
    || meta.thread_source === 'subagent'
    || (typeof meta.agent_path === 'string' && meta.agent_path.startsWith('/root/'));
};
