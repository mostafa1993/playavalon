/**
 * Logger — pino with per-agent name prefix and a developer-friendly pretty
 * formatter when stdout is a TTY. Machine-parseable JSON otherwise.
 */

import pino from 'pino';

const isTTY = Boolean(process.stdout.isTTY);

export interface AgentLogger {
  trace: (msg: string, fields?: Record<string, unknown>) => void;
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, err?: unknown, fields?: Record<string, unknown>) => void;
}

export function makeLogger(agentName: string): AgentLogger {
  const base = pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      base: { agent: agentName },
    },
    isTTY
      ? pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            messageFormat: '[{agent}] {msg}',
            ignore: 'pid,hostname,agent',
          },
        })
      : undefined,
  );

  const wrap = (level: 'trace' | 'debug' | 'info' | 'warn' | 'error') =>
    (msg: string, fields?: Record<string, unknown>) =>
      fields ? base[level](fields, msg) : base[level](msg);

  return {
    trace: wrap('trace'),
    debug: wrap('debug'),
    info: wrap('info'),
    warn: wrap('warn'),
    error: (msg, err, fields) => {
      const errFields = err instanceof Error
        ? { err_message: err.message, err_stack: err.stack }
        : err !== undefined
          ? { err: String(err) }
          : {};
      base.error({ ...fields, ...errFields }, msg);
    },
  };
}
