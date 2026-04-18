export type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'phase';

export interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
  timestamp: number;
  elapsedMs: number;
  meta?: Record<string, unknown>;
}

export type LogCallback = (entry: LogEntry) => void;

export class BuildLogger {
  private startedAt: number;
  private counter = 0;
  private sink: LogCallback;

  constructor(sink: LogCallback) {
    this.startedAt = performance.now();
    this.sink = sink;
  }

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    this.counter += 1;
    const now = performance.now();
    this.sink({
      id: this.counter,
      level,
      message,
      timestamp: Date.now(),
      elapsedMs: Math.round(now - this.startedAt),
      meta,
    });
  }

  info(msg: string, meta?: Record<string, unknown>) {
    this.emit('info', msg, meta);
  }
  success(msg: string, meta?: Record<string, unknown>) {
    this.emit('success', msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>) {
    this.emit('warning', msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>) {
    this.emit('error', msg, meta);
  }
  phase(msg: string, meta?: Record<string, unknown>) {
    this.emit('phase', msg, meta);
  }
}
